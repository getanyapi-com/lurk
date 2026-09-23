"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  projectCompetitors,
  projectKeywords,
  projectSubreddits,
  projects,
} from "@/db/schema";
import { scanNowAction } from "@/app/app/scan";
import { enqueueJob } from "@/jobs/enqueue";
import { requireLocalUser } from "@/lib/auth";
import { competitorHost } from "@/lib/competitors/host";
import type { Destination } from "@/lib/discovery/queries";
import { parseDestinations, parseTextList } from "@/lib/discovery/store";
import { buildProfile } from "@/lib/profile";
import { forgetProjectFeed } from "@/lib/projectFeedCache";
import { projectForUser } from "@/lib/projects";
import { spendAllowance } from "@/lib/throttle";
import { tierForUser } from "@/lib/tier";

export type ChipKind = "keyword" | "subreddit" | "competitor";
/** What a person has decided about one row of the plan. */
export type ChipState = "active" | "pinned" | "excluded";
/** The lists read off the product page itself, editable by hand. */
export type ListKind = "destination" | "phrasing" | "capability" | "exclusion" | "not_buyer";
/** Every one of those except places, all of which are plain lists of phrases. */
type TextListKind = Exclude<ListKind, "destination">;
export type ProfileState = { error: string | null; saved: boolean };
export type ChipResult = { error: string | null };

async function ownedProject(projectId: string) {
  const user = await requireLocalUser();
  const project = await projectForUser(user.id, projectId);
  if (!project) {
    throw new Error("That project is not yours");
  }
  return { user, project };
}

function text(formData: FormData, field: string): string {
  return String(formData.get(field) ?? "").trim();
}

function threshold(raw: string): number | null {
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(
      "The minimum score has to be a whole number between 0 and 100.",
    );
  }
  return value;
}

/**
 * Bumps the version of the facts a judgement is made against, so the next scan
 * judges every candidate again instead of trusting a verdict made against the
 * old product. The minimum score is not one of those facts: the feed applies it
 * when it is read, so moving it changes the next page load and nothing else.
 */
async function bumpProfileVersion(projectId: string) {
  await db()
    .update(projects)
    .set({ profileVersion: sql`${projects.profileVersion} + 1` })
    .where(eq(projects.id, projectId));
}

/** Saves the editable profile fields for one of the caller's projects. */
export async function saveProfileAction(
  _previous: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  try {
    const { project } = await ownedProject(text(formData, "projectId"));
    const name = text(formData, "name");
    if (!name) {
      return { error: "A project needs a name.", saved: false };
    }
    const facts = {
      name,
      url: text(formData, "url") || null,
      pain: text(formData, "pain") || null,
      solution: text(formData, "solution") || null,
      targetUsers: text(formData, "targetUsers") || null,
      // Asked only of a product with places. One that is not asked keeps what it had.
      ...(formData.has("geography") ? { geography: text(formData, "geography") || null } : {}),
    };
    const edited = Object.entries(facts).some(
      ([field, value]) => project[field as keyof typeof facts] !== value,
    );
    await db()
      .update(projects)
      .set({
        ...facts,
        scoreThreshold: threshold(text(formData, "scoreThreshold")),
        ...(edited ? { profileVersion: sql`${projects.profileVersion} + 1` } : {}),
      })
      .where(eq(projects.id, project.id));
    // The brief was written for the product as it was. A new one is read, and
    // the verdicts are judged again once it is written.
    if (edited) {
      await enqueueJob("brief", project.id);
    }
    // The feed applies this project's own minimum score when it is read, so the
    // read it is holding was made against the old floor.
    forgetProjectFeed(project.id);
    revalidatePath("/app", "layout");
    return { error: null, saved: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Nothing was saved.",
      saved: false,
    };
  }
}

function clean(kind: ChipKind, value: string): string {
  const trimmed = value.trim();
  return kind === "subreddit"
    ? trimmed.replace(/^\/?r\//i, "").toLowerCase()
    : trimmed;
}

async function chipLimit(
  kind: ChipKind,
  userId: string,
): Promise<number | null> {
  const { limits } = await tierForUser(userId);
  if (!limits) {
    return null;
  }
  if (kind === "keyword") {
    return limits.keywordsPerProject;
  }
  return kind === "subreddit"
    ? limits.subredditsPerProject
    : limits.competitors;
}

const NOUNS: Record<ChipKind, string> = {
  keyword: "keywords",
  subreddit: "subreddits",
  competitor: "competitors",
};

/**
 * A row a person typed is theirs: it is marked `user`, which is what makes the
 * next discovery rebuild leave it exactly where it is.
 */
async function insertChip(kind: ChipKind, projectId: string, value: string) {
  const owned = { projectId, source: "user", state: "active" };
  if (kind === "keyword") {
    await db()
      .insert(projectKeywords)
      .values({ ...owned, keyword: value })
      .onConflictDoNothing();
    return;
  }
  if (kind === "subreddit") {
    await db()
      .insert(projectSubreddits)
      .values({ ...owned, name: value })
      .onConflictDoNothing();
    return;
  }
  await db()
    .insert(projectCompetitors)
    // Somebody who types a competitor in as a domain has already told us its
    // site, so the row wears its logo from the moment it is added.
    .values({ ...owned, name: value, domain: competitorHost(value) })
    .onConflictDoNothing();
}

/** Adds one keyword, subreddit or competitor, refusing past the tier cap. */
export async function addChipAction(
  kind: ChipKind,
  projectId: string,
  raw: string,
): Promise<ChipResult> {
  try {
    const { user, project } = await ownedProject(projectId);
    const value = clean(kind, raw);
    if (!value) {
      return { error: "Type something first." };
    }
    const limit = await chipLimit(kind, user.id);
    if (limit != null && (await chipsOn(kind, project.id)) >= limit) {
      return {
        error: `This tier allows ${limit} ${NOUNS[kind]} per project. Connect an AnyAPI wallet for more.`,
      };
    }
    await insertChip(kind, project.id, value);
    if (kind === "competitor") {
      await bumpProfileVersion(project.id);
    }
    revalidatePath("/app/product");
    revalidatePath("/app/sources");
    return { error: null };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "That could not be added.",
    };
  }
}

/** Removes one keyword, subreddit or competitor from the project. */
export async function removeChipAction(
  kind: ChipKind,
  projectId: string,
  value: string,
) {
  const { project } = await ownedProject(projectId);
  if (kind === "keyword") {
    await db()
      .delete(projectKeywords)
      .where(
        and(
          eq(projectKeywords.projectId, project.id),
          eq(projectKeywords.keyword, value),
        ),
      );
  } else if (kind === "subreddit") {
    await db()
      .delete(projectSubreddits)
      .where(
        and(
          eq(projectSubreddits.projectId, project.id),
          eq(projectSubreddits.name, value),
        ),
      );
  } else {
    await db()
      .delete(projectCompetitors)
      .where(
        and(
          eq(projectCompetitors.projectId, project.id),
          eq(projectCompetitors.name, value),
        ),
      );
    await bumpProfileVersion(project.id);
  }
  revalidatePath("/app/product");
  revalidatePath("/app/sources");
}

/** The rows of one kind a scan may use: everything switched on. */
async function chipsOn(kind: ChipKind, projectId: string): Promise<number> {
  const table =
    kind === "keyword"
      ? projectKeywords
      : kind === "subreddit"
        ? projectSubreddits
        : projectCompetitors;
  const rows = await db()
    .select({ state: table.state })
    .from(table)
    .where(eq(table.projectId, projectId));
  return rows.filter((row) => row.state === "active" || row.state === "pinned").length;
}

/**
 * Pins, excludes or restores one row of the plan. A pinned row is retrieved
 * and survives every rebuild; an excluded row is never retrieved and is not
 * offered again. Both outlive discovery, which is the point of them.
 */
export async function setChipStateAction(
  kind: ChipKind,
  projectId: string,
  value: string,
  state: ChipState,
): Promise<ChipResult> {
  try {
    const { user, project } = await ownedProject(projectId);
    // Switching a row on spends a place under the tier cap, the same as adding one.
    if (state !== "excluded") {
      const limit = await chipLimit(kind, user.id);
      if (limit != null && (await chipsOn(kind, project.id)) >= limit) {
        return {
          error: `This tier allows ${limit} ${NOUNS[kind]} per project. Switch one off first, or connect an AnyAPI wallet for more.`,
        };
      }
    }
    if (kind === "keyword") {
      await db()
        .update(projectKeywords)
        .set({ state })
        .where(
          and(
            eq(projectKeywords.projectId, project.id),
            eq(projectKeywords.keyword, value),
          ),
        );
    } else if (kind === "subreddit") {
      await db()
        .update(projectSubreddits)
        .set({ state })
        .where(
          and(
            eq(projectSubreddits.projectId, project.id),
            eq(projectSubreddits.name, value),
          ),
        );
    } else {
      await db()
        .update(projectCompetitors)
        .set({ state })
        .where(
          and(
            eq(projectCompetitors.projectId, project.id),
            eq(projectCompetitors.name, value),
          ),
        );
      await bumpProfileVersion(project.id);
    }
    revalidatePath("/app/product");
    revalidatePath("/app/sources");
    return { error: null };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "That could not be changed.",
    };
  }
}

/**
 * Points one competitor at the site it sells from, which is where its logo
 * comes from. An empty box clears it and puts the initials back. No verdict
 * ever rested on a logo, so this does not invalidate the profile the way a
 * competitor being added or removed does.
 */
export async function setCompetitorDomainAction(
  projectId: string,
  name: string,
  raw: string,
): Promise<ChipResult> {
  try {
    const { project } = await ownedProject(projectId);
    const typed = raw.trim();
    const domain = typed ? competitorHost(typed) : null;
    if (typed && !domain) {
      return { error: `"${typed}" is not a website. Try typeform.com.` };
    }
    await db()
      .update(projectCompetitors)
      .set({ domain })
      .where(
        and(
          eq(projectCompetitors.projectId, project.id),
          eq(projectCompetitors.name, name),
        ),
      );
    revalidatePath("/app/product");
    revalidatePath("/app/sources");
    return { error: null };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "That could not be changed.",
    };
  }
}

/** The lists a person edits by hand, as the project's jsonb columns hold them. */
type ProductLists = {
  destinations: Destination[];
  phrasings: string[];
  capabilities: string[];
  exclusions: string[];
  notBuyers: string[];
};

const TEXT_LIST: Record<
  TextListKind,
  "phrasings" | "capabilities" | "exclusions" | "notBuyers"
> = {
  phrasing: "phrasings",
  capability: "capabilities",
  exclusion: "exclusions",
  not_buyer: "notBuyers",
};

/**
 * What the product can and cannot do, and who is not its buyer, are facts the
 * scorer judges against, so editing one bumps the profile version exactly as a
 * competitor edit does. A place or a phrasing only changes what discovery asks
 * next, and no verdict ever rested on it, so those are saved without
 * invalidating anything.
 */
const JUDGED: ListKind[] = ["capability", "exclusion", "not_buyer"];

function productLists(project: typeof projects.$inferSelect): ProductLists {
  return {
    destinations: parseDestinations(project.destinations),
    phrasings: parseTextList(project.problemPhrasings),
    capabilities: parseTextList(project.capabilities),
    exclusions: parseTextList(project.exclusions),
    notBuyers: parseTextList(project.notBuyers),
  };
}

async function saveLists(projectId: string, kind: ListKind, lists: ProductLists) {
  await db()
    .update(projects)
    .set({
      destinations: lists.destinations,
      problemPhrasings: lists.phrasings,
      capabilities: lists.capabilities,
      exclusions: lists.exclusions,
      notBuyers: lists.notBuyers,
    })
    .where(eq(projects.id, projectId));
  if (JUDGED.includes(kind)) {
    await bumpProfileVersion(projectId);
  }
  revalidatePath("/app/product");
  revalidatePath("/app/sources");
}

/**
 * Adds a place, a phrasing, a capability, an exclusion or a person who is not
 * a buyer, none of which the page said. Places and phrasings feed the next
 * round of discovery queries; the rest go to the scorer. This is how a person
 * teaches the app what their own page does not spell out.
 */
export async function addListItemAction(
  kind: ListKind,
  projectId: string,
  raw: string,
): Promise<ChipResult> {
  try {
    const { project } = await ownedProject(projectId);
    const value = raw.trim();
    if (!value) {
      return { error: "Type something first." };
    }
    const lists = productLists(project);
    if (kind === "destination") {
      if (!lists.destinations.some((place) => place.name === value)) {
        lists.destinations.push({ name: value, sourceText: "Added by you" });
      }
    } else {
      const field = TEXT_LIST[kind];
      if (!lists[field].includes(value)) {
        lists[field] = [...lists[field], value];
      }
    }
    await saveLists(project.id, kind, lists);
    return { error: null };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "That could not be added.",
    };
  }
}

/** Removes one item from any of the lists a person edits by hand. */
export async function removeListItemAction(
  kind: ListKind,
  projectId: string,
  value: string,
) {
  const { project } = await ownedProject(projectId);
  const lists = productLists(project);
  if (kind === "destination") {
    lists.destinations = lists.destinations.filter((place) => place.name !== value);
  } else {
    const field = TEXT_LIST[kind];
    lists[field] = lists[field].filter((item) => item !== value);
  }
  await saveLists(project.id, kind, lists);
}

/**
 * Reads the product page again, replaces the facts it produced, and asks for
 * the plan to be learned again from them. The new facts and the bumped version
 * are one write, so no job can read the new facts under the old version and
 * keep a verdict that was made against a product we no longer describe.
 */
export async function rebuildProfileAction(formData: FormData) {
  const { user, project } = await ownedProject(
    String(formData.get("projectId") ?? ""),
  );
  if (!project.url) {
    throw new Error("This project has no product URL to read.");
  }
  await spendAllowance(user.id, "rebuild_profile");
  await buildProfile(project.id, user.id, project.url, { rejudge: true });
  await enqueueJob("discovery_initial", project.id);
  revalidatePath("/app", "layout");
}

/** Queues a scan and opens the leads the scan will fill. */
export async function scanAndOpenLeadsAction(formData: FormData) {
  const { project } = await ownedProject(
    String(formData.get("projectId") ?? ""),
  );
  await scanNowAction(project.id);
  redirect(`/app/leads?project=${project.id}`);
}
