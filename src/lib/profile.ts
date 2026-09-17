import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projectSubreddits, projects, subreddits } from "@/db/schema";
import { clientForUser } from "./anyapi";
import { generateStructured } from "./llm";
import { PROFILE_SYSTEM, PROMO_POLICY_SYSTEM } from "./prompts";
import { normalizeQuery, recordUsage } from "./reddit/fetch";
import { fetchSubredditDetails } from "./reddit/skus";
import { assertHouseDataUnderCap } from "./usage";

/** How long a subreddit sidebar is reused before we buy it again. */
const SUBREDDIT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What one product page can tell us. Communities, searches and competitors are
 * absent on purpose: those are discovered from Google evidence, so a model
 * that has heard of this company cannot hand the scan a community nobody has
 * ever seen a relevant thread in.
 */
export const profileSchema = z.object({
  name: z.string(),
  pain: z.string(),
  solution: z.string(),
  targetUsers: z.string(),
  capabilities: z.array(z.string()),
  exclusions: z.array(z.string()),
  notBuyers: z.array(z.string()),
  serviceGeography: z.string(),
  destinations: z.array(z.object({ name: z.string(), sourceText: z.string() })),
  problemPhrasings: z.array(z.string()),
  /** The systems, sites and kinds of data the page says it works with. */
  platforms: z.array(z.string()),
  budgetFit: z.string(),
});

export type ProductProfile = z.infer<typeof profileSchema>;

export type ProfileStep = "scrape" | "profile" | "done";

/**
 * What a buyer types for one platform, in both forms they type it in. On Google
 * "<platform> api" outsells "<platform> scraper api" by ten to seventy times,
 * and on Reddit the same person says scraper, so discovery asks both: one
 * Google query is $0.0005 and the two forms return different threads.
 *
 * They are built here and not asked for. Asked for, the count moved run to run
 * against one unchanged page - 25, 5, 25 phrasings over three runs of
 * getanyapi.com on 2026-09-16 - so a platform the page names silently had no
 * search bought for it at all, and the name itself drifted between "twitter
 * api", "x twitter scraper" and "github api".
 */
export function platformPhrasings(platforms: string[]): string[] {
  const phrasings: string[] = [];
  const said = new Set<string>();
  for (const platform of platforms) {
    const name = platform.trim().replace(/\s+/g, " ").toLowerCase();
    if (!name) {
      continue;
    }
    for (const phrasing of [`${name} api`, `${name} scraper`]) {
      if (!said.has(phrasing)) {
        said.add(phrasing);
        phrasings.push(phrasing);
      }
    }
  }
  return phrasings;
}

/**
 * Reads the product page. It buys no shared run, so it counts against the house
 * cap through the same seam every Reddit fetch uses, and is refused by it.
 */
async function scrapeProduct(projectId: string, userId: string, url: string) {
  const funded = await clientForUser(userId);
  if (funded.funding === "house") {
    await assertHouseDataUnderCap();
  }
  const { result: res, requestId } = await funded.call(() => funded.client.web.scrape({ url }));
  await recordUsage({
    projectId,
    sku: "web.scrape",
    costUsd: res.costUsd,
    requestId,
    searchRunId: null,
    fundedBy: funded.funding,
    reused: false,
  });
  if (!res.output.found) {
    throw new Error(`AnyAPI could not read ${url}`);
  }
  return res.output.data;
}

/** Fills the shared subreddit row and its one-sentence self-promotion rule. */
async function resolveSubreddit(
  projectId: string,
  userId: string,
  name: string,
): Promise<string | null> {
  const funded = await clientForUser(userId);
  const result = await fetchSubredditDetails(
    { projectId, funded, maxAgeMs: SUBREDDIT_MAX_AGE_MS },
    name,
    SUBREDDIT_MAX_AGE_MS,
  );
  if (!result.value) {
    return null;
  }
  const key = normalizeQuery(name);
  const existing = await db().select().from(subreddits).where(eq(subreddits.name, key));
  if (!existing[0]?.promoPolicy) {
    const summary = await generateStructured({
      purpose: "promo_policy",
      projectId,
      schema: z.object({ policy: z.string() }),
      system: PROMO_POLICY_SYSTEM,
      prompt: `Subreddit r/${name} sidebar:\n\n${result.value.description}`,
    });
    await db()
      .update(subreddits)
      .set({ promoPolicy: summary.policy })
      .where(eq(subreddits.name, key));
  }
  return key;
}

/**
 * Buys the sidebar and the self-promotion rule for every community the plan
 * will actually read. Discovery has already proved each one carries relevant
 * threads, so this spends only on communities that earned a slot.
 */
export async function resolveActiveSubreddits(projectId: string, userId: string): Promise<string[]> {
  const rows = await db()
    .select()
    .from(projectSubreddits)
    .where(
      and(
        eq(projectSubreddits.projectId, projectId),
        inArray(projectSubreddits.state, ["active", "pinned"]),
      ),
    );
  const resolved: string[] = [];
  for (const row of rows) {
    const key = await resolveSubreddit(projectId, userId, row.name);
    if (key) {
      resolved.push(key);
    }
  }
  return resolved;
}

export type ProfileOptions = {
  /**
   * Whether the facts written here invalidate every verdict made against the
   * old ones. A rebuild does; the first build of a brand new project has no
   * verdicts to invalidate. The bump is written in the same statement as the
   * facts, so no job can ever read the new facts under the old version.
   */
  rejudge?: boolean;
};

/**
 * Reads the product's own page and writes what the page says the product is.
 * That is all it does: where and how the buyers ask is learned by the initial
 * discovery job, which the caller queues, because reading Google takes minutes
 * and nobody should hold a browser open for it.
 */
export async function buildProfile(
  projectId: string,
  userId: string,
  url: string,
  options: ProfileOptions = {},
  onStep?: (step: ProfileStep) => Promise<void> | void,
): Promise<ProductProfile> {
  await onStep?.("scrape");
  const page = await scrapeProduct(projectId, userId, url);

  await onStep?.("profile");
  const profile = await generateStructured({
    purpose: "profile",
    projectId,
    schema: profileSchema,
    system: PROFILE_SYSTEM,
    prompt: [
      `Website: ${page.url}`,
      `Title: ${page.title}`,
      `Description: ${page.description}`,
      "",
      (page.markdown ?? "").slice(0, 12000),
    ].join("\n"),
  });

  const problemPhrasings = [
    ...profile.problemPhrasings,
    ...platformPhrasings(profile.platforms),
  ];

  await db()
    .update(projects)
    .set({
      name: profile.name || undefined,
      pain: profile.pain,
      solution: profile.solution,
      targetUsers: profile.targetUsers,
      geography: profile.serviceGeography || null,
      budgetFit: profile.budgetFit,
      capabilities: profile.capabilities,
      exclusions: profile.exclusions,
      notBuyers: profile.notBuyers,
      destinations: profile.destinations,
      problemPhrasings,
      ...(options.rejudge
        ? { profileVersion: sql`${projects.profileVersion} + 1` }
        : {}),
    })
    .where(eq(projects.id, projectId));

  await onStep?.("done");
  return { ...profile, problemPhrasings };
}
