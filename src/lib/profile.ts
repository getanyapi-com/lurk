import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projectCompetitors, projects, subreddits } from "@/db/schema";
import { clientForUser } from "./anyapi";
import { competitorHost } from "./competitors/host";
import { generateStructured } from "./llm";
import { PROFILE_SYSTEM, PROMO_POLICY_SYSTEM } from "./prompts";
import { normalizeQuery, recordUsage } from "./reddit/fetch";
import { capped, tierForUser } from "./tier";
import { fetchSubredditDetails } from "./reddit/skus";
import { assertHouseDataUnderCap } from "./usage";

/** How long a subreddit sidebar is reused before we buy it again. */
const SUBREDDIT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What one product page can tell us. Communities and searches are absent on
 * purpose: those are discovered from Google evidence, so a model that has heard
 * of this company cannot hand the scan a community nobody has ever seen a
 * relevant thread in. Competitors are asked for; see PROFILE_SYSTEM for why.
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
  /** Whether the product is itself a way to get those platforms' data. */
  sellsPlatformData: z.boolean(),
  /** The products a buyer would use instead, as the model names them. */
  competitors: z.array(z.object({ name: z.string(), domain: z.string() })),
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
 *
 * Only a product that sells the platform's data gets them. They were tuned on
 * getanyapi.com and then bought for everybody: on 2026-09-19 yarooms.com, room
 * booking that connects to Microsoft 365, was searched as "azure ad scraper"
 * and "outlook add-in api", and 81 of its 98 threads came back irrelevant.
 */
export function platformPhrasings(platforms: string[], sellsPlatformData: boolean): string[] {
  if (!sellsPlatformData) {
    return [];
  }
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
export async function scrapeProduct(projectId: string, userId: string, url: string) {
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

/**
 * A community's self-promotion rule in one sentence, read the first time
 * anybody needs it and kept on the shared row for everyone after. It is one
 * person's call on one reply, so it is bought when a lead in that community is
 * opened and never while a new project waits on its first sweep.
 */
export async function promoPolicyFor(
  projectId: string,
  userId: string,
  name: string,
): Promise<string | null> {
  const key = normalizeQuery(name);
  const known = await db().select().from(subreddits).where(eq(subreddits.name, key));
  if (known[0]?.promoPolicy) {
    return known[0].promoPolicy;
  }
  const funded = await clientForUser(userId);
  const result = await fetchSubredditDetails(
    { projectId, funded, maxAgeMs: SUBREDDIT_MAX_AGE_MS },
    name,
    SUBREDDIT_MAX_AGE_MS,
  );
  if (!result.value) {
    return null;
  }
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
  return summary.policy;
}

/** How many competitors one reading of the page may name. */
const PAGE_COMPETITORS = 5;

/** The names worth keeping: said once, not the product itself, a domain only when it is one. */
export function pageCompetitors(
  productName: string,
  named: { name: string; domain: string }[],
): { name: string; domain: string | null }[] {
  const own = productName.trim().toLowerCase();
  const seen = new Set<string>();
  const kept: { name: string; domain: string | null }[] = [];
  for (const item of named) {
    const name = item.name.trim().replace(/\s+/g, " ");
    const key = name.toLowerCase();
    if (!name || key === own || seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push({ name, domain: competitorHost(item.domain) });
  }
  return kept.slice(0, PAGE_COMPETITORS);
}

/**
 * Replaces the competitors the last reading of the page named with this one's.
 * They are rows of their own source, which a discovery plan leaves standing
 * (see publishDiscoveryPlan), and a name a person already typed in is theirs.
 */
async function writePageCompetitors(
  projectId: string,
  rows: { name: string; domain: string | null }[],
): Promise<void> {
  await db().transaction(async (tx) => {
    await tx
      .delete(projectCompetitors)
      .where(
        and(
          eq(projectCompetitors.projectId, projectId),
          eq(projectCompetitors.source, "page"),
          eq(projectCompetitors.state, "active"),
        ),
      );
    if (rows.length > 0) {
      await tx
        .insert(projectCompetitors)
        .values(
          rows.map((row) => ({
            projectId,
            name: row.name,
            domain: row.domain,
            role: "direct_substitute",
            source: "page",
            state: "active",
          })),
        )
        .onConflictDoNothing();
    }
  });
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

export type PageReseed = {
  sellsPlatformData: boolean;
  droppedPhrasings: string[];
  competitors: string[];
  /** The exclusions and not-buyers written, which is none when the project already had its own. */
  exclusions: string[];
  notBuyers: string[];
};

/** What `platformPhrasings` builds, recognised by its shape: nothing else may end this way. */
const PLATFORM_PHRASING = / (?:api|scraper)$/;

/**
 * Brings an older project up to what a new one gets, and touches nothing else.
 * The page is read again for what it was never asked: the platform searches are
 * dropped when the product does not sell its platforms' data, the competitors
 * the reading names are written, and a project with no exclusions or no
 * not-buyers gets the ones the page implies (before 2026-09-19 they were asked
 * for only where the page stated them, and 54 of 79 projects had none). A list
 * that holds anything is a person's or an earlier reading's and stays as it is.
 * Filling either one bumps the profile version, because a verdict made without
 * them is a verdict about a different product. The caller queues the discovery
 * that turns the corrected searches into a plan.
 */
export async function reseedFromPage(
  project: {
    id: string;
    userId: string;
    url: string;
    problemPhrasings: string[];
    exclusions: string[];
    notBuyers: string[];
  },
  options: { dryRun?: boolean } = {},
): Promise<PageReseed> {
  const page = await scrapeProduct(project.id, project.userId, project.url);
  const profile = await profileFromPage(project.id, page);
  const droppedPhrasings = profile.sellsPlatformData
    ? []
    : project.problemPhrasings.filter((item) => PLATFORM_PHRASING.test(item));
  const exclusions = project.exclusions.length === 0 ? profile.exclusions : [];
  const notBuyers = project.notBuyers.length === 0 ? profile.notBuyers : [];
  const { limits } = await tierForUser(project.userId);
  const competitors = capped(
    pageCompetitors(profile.name, profile.competitors),
    limits?.competitors,
  );
  if (!options.dryRun) {
    if (droppedPhrasings.length > 0) {
      const dropped = new Set(droppedPhrasings);
      await db()
        .update(projects)
        .set({ problemPhrasings: project.problemPhrasings.filter((item) => !dropped.has(item)) })
        .where(eq(projects.id, project.id));
    }
    if (exclusions.length > 0 || notBuyers.length > 0) {
      await db()
        .update(projects)
        .set({
          ...(exclusions.length > 0 ? { exclusions } : {}),
          ...(notBuyers.length > 0 ? { notBuyers } : {}),
          profileVersion: sql`${projects.profileVersion} + 1`,
        })
        .where(eq(projects.id, project.id));
    }
    await writePageCompetitors(project.id, competitors);
  }
  return {
    sellsPlatformData: profile.sellsPlatformData,
    droppedPhrasings,
    competitors: competitors.map((item) => item.name),
    exclusions,
    notBuyers,
  };
}

/** What one scraped page says the product is. Reads the page and writes nothing. */
export async function profileFromPage(
  projectId: string,
  page: { url: string; title?: string | null; description?: string | null; markdown?: string | null },
): Promise<ProductProfile> {
  return generateStructured({
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
}

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
  const profile = await profileFromPage(projectId, page);

  const problemPhrasings = [
    ...profile.problemPhrasings,
    ...platformPhrasings(profile.platforms, profile.sellsPlatformData),
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
  const { limits } = await tierForUser(userId);
  await writePageCompetitors(
    projectId,
    capped(pageCompetitors(profile.name, profile.competitors), limits?.competitors),
  );

  await onStep?.("done");
  return { ...profile, problemPhrasings };
}
