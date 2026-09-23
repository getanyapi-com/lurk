import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projectCompetitors, projects, subreddits } from "@/db/schema";
import { clientForUser } from "./anyapi";
import { competitorHost } from "./competitors/host";
import { generateStructured } from "./llm";
import { BRIEF_INSTRUCTIONS, briefSchema, usableBrief, type ProductBrief } from "./brief";
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

/** The profile as one reading of the site returns it, with the brief beside it. */
export type SiteReading = ProductProfile & { brief: ProductBrief };

/** One limit as the model returns it: the claim, and the page's own words it rests on. */
const groundedSchema = z.object({ text: z.string(), sourceText: z.string() });

/**
 * What the model is asked for: the profile, with every limit carrying its
 * source, and the brief the scan's judge reads (lib/brief.ts). They are one
 * call because they read the same pages. Asked together on 167 sites on
 * 2026-09-22, every exclusion still quoted the site and the brief judged as
 * well as one asked on its own (.context/exp, AUC 0.871 against 0.874).
 */
const readingSchema = profileSchema.extend({
  exclusions: z.array(groundedSchema),
  notBuyers: z.array(groundedSchema),
  brief: briefSchema,
});

const READING_SYSTEM = `${PROFILE_SYSTEM}

- brief: one more field, for a different reader, and the one field where the rule above does not hold. ${BRIEF_INSTRUCTIONS}`;

/** Text as a quote is compared against it: no markdown, no case, no spacing. */
function flat(text: string): string {
  return text
    .toLowerCase()
    // The address may not hold a space: a page cut mid-link leaves "[text](https://a.com"
    // open, and an address that ran on to the next ")" took a whole page of text with it.
    .replace(/\[([^\]]*)\]\([^)\s]*\)/g, "$1")
    .replace(/[*_#`>|~\\]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The limits whose source really is on the site. A limit is the one kind of
 * fact that loses leads silently when it is wrong, and asked to infer them the
 * model wrote "does not host applications" for a host whose own menu sells
 * application hosting (2026-09-19: 19 false exclusions in 58 profiles, nearly
 * all a thing the homepage did not mention and another page sold). So a limit
 * stands only on words the site says, and the code checks that it says them.
 */
export function groundedLimits(items: z.infer<typeof groundedSchema>[], siteText: string): string[] {
  const site = flat(siteText);
  return items
    .filter((item) => {
      const source = flat(item.sourceText);
      return item.text.trim().length > 0 && source.length >= 4 && site.includes(source);
    })
    .map((item) => item.text.trim());
}

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

/** The pages that say what a homepage leaves out, in the order they are worth reading. */
const SITE_PAGES = [/pric|plans/i, /feature|product|solution|how-it-works|services/i, /faq|help/i, /about/i];
/**
 * Where a site keeps writing about things rather than the thing it sells. A
 * post titled "2024 popular javascript products" is not the product page its
 * address looks like (ihatereading.in, 2026-09-19).
 */
const NOT_A_SITE_PAGE = /^(blogs?|posts?|news|articles?|stories|docs?|guides?|changelog|legal|privacy|terms|tag|category)$/i;
const MAX_SITE_PAGES = 3;
const HOME_CHARS = 12000;
const PAGE_CHARS = 8000;

/** The same-site links on this page that lead to one of SITE_PAGES, best first. */
export function sitePageLinks(pageUrl: string, markdown: string): string[] {
  let home: URL;
  try {
    home = new URL(pageUrl);
  } catch {
    return [];
  }
  const found = new Map<string, number>();
  for (const match of markdown.matchAll(/\]\(([^)\s]+)/g)) {
    let link: URL;
    try {
      link = new URL(match[1], home);
    } catch {
      continue;
    }
    const path = link.pathname.replace(/\/$/, "");
    if (link.host !== home.host || path === home.pathname.replace(/\/$/, "") || !/^https?:$/.test(link.protocol)) {
      continue;
    }
    const segments = path.split("/").filter(Boolean);
    const rank = SITE_PAGES.findIndex((pattern) => pattern.test(path));
    const key = `${link.origin}${path}`;
    const written = segments.some((segment) => NOT_A_SITE_PAGE.test(segment));
    if (rank !== -1 && segments.length <= 2 && !written && !found.has(key)) {
      found.set(key, rank);
    }
  }
  return [...found].sort((a, b) => a[1] - b[1]).slice(0, MAX_SITE_PAGES).map(([url]) => url);
}

/**
 * The product's page and the few pages beside it that say what a homepage does
 * not: the price, the plans, the platforms, who it is for. Read from the
 * homepage alone, a profile was right for 5 of 19 products on 2026-09-19; the
 * pricing page was the richest thing missed. A page that will not load is left
 * out, because the homepage is still a profile and its neighbours are a bonus.
 */
export async function readSite(projectId: string, userId: string, url: string) {
  const home = await scrapeProduct(projectId, userId, url);
  const links = sitePageLinks(home.url ?? url, home.markdown ?? "");
  const others = await Promise.all(
    links.map((link) => scrapeProduct(projectId, userId, link).catch(() => null)),
  );
  const markdown = [
    (home.markdown ?? "").slice(0, HOME_CHARS),
    ...others.flatMap((page, index) =>
      page?.markdown ? [`\n\n--- Page: ${links[index]} ---\n\n${page.markdown.slice(0, PAGE_CHARS)}`] : [],
    ),
  ].join("");
  return { ...home, markdown };
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
  /** True when nobody had touched the profile, so the new reading replaced all of it. */
  refreshed: boolean;
  /** The exclusions and not-buyers written, which is none when the project already had its own. */
  exclusions: string[];
  notBuyers: string[];
};

/** What `platformPhrasings` builds, recognised by its shape: nothing else may end this way. */
const PLATFORM_PHRASING = / (?:api|scraper)$/;

/**
 * Brings an older project up to what a new one gets. The site is read again:
 * the platform searches are dropped when the product does not sell its
 * platforms' data, and the competitors the reading names are written. A profile
 * nobody has touched (still on its first version) is replaced whole by the new
 * reading, because the old one was made from the homepage alone and asked for
 * limits only where the page stated them (54 of 79 projects had none). A profile
 * somebody edited or rebuilt keeps every fact it has, and only an empty list of
 * exclusions or not-buyers is filled. Either way the profile version is bumped
 * when a fact changed, because a verdict made without it is a verdict about a
 * different product. Where and how buyers ask is left to the weekly refresh.
 */
export async function reseedFromPage(
  project: {
    id: string;
    userId: string;
    url: string;
    problemPhrasings: string[];
    exclusions: string[];
    notBuyers: string[];
    profileVersion: number;
  },
  options: { dryRun?: boolean } = {},
): Promise<PageReseed> {
  const page = await readSite(project.id, project.userId, project.url);
  const profile = await profileFromPage(project.id, page);
  const droppedPhrasings = profile.sellsPlatformData
    ? []
    : project.problemPhrasings.filter((item) => PLATFORM_PHRASING.test(item));
  const refreshed = project.profileVersion === 1 && profile.pain.trim() !== "";
  const exclusions = refreshed || project.exclusions.length === 0 ? profile.exclusions : [];
  const notBuyers = refreshed || project.notBuyers.length === 0 ? profile.notBuyers : [];
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
    if (refreshed) {
      await db()
        .update(projects)
        .set({
          pain: profile.pain,
          solution: profile.solution,
          targetUsers: profile.targetUsers,
          geography: profile.serviceGeography || null,
          budgetFit: profile.budgetFit,
          capabilities: profile.capabilities,
          exclusions,
          notBuyers,
          profileVersion: sql`${projects.profileVersion} + 1`,
        })
        .where(eq(projects.id, project.id));
    } else if (exclusions.length > 0 || notBuyers.length > 0) {
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
    // Last, so it is stamped with whatever version the updates above left.
    await db()
      .update(projects)
      .set({ brief: usableBrief(profile.brief), briefProfileVersion: sql`${projects.profileVersion}` })
      .where(eq(projects.id, project.id));
  }
  return {
    sellsPlatformData: profile.sellsPlatformData,
    droppedPhrasings,
    competitors: competitors.map((item) => item.name),
    refreshed,
    exclusions,
    notBuyers,
  };
}

/** What the site's pages say the product is. Reads them and writes nothing. */
export async function profileFromPage(
  projectId: string,
  page: { url: string; title?: string | null; description?: string | null; markdown?: string | null },
): Promise<SiteReading> {
  const markdown = page.markdown ?? "";
  const reading = await generateStructured({
    purpose: "profile",
    projectId,
    schema: readingSchema,
    system: READING_SYSTEM,
    prompt: [`Website: ${page.url}`, `Title: ${page.title}`, `Description: ${page.description}`, "", markdown].join("\n"),
    effort: "high",
  });
  const siteText = `${page.title ?? ""}\n${page.description ?? ""}\n${markdown}`;
  return {
    ...reading,
    exclusions: groundedLimits(reading.exclusions, siteText),
    notBuyers: groundedLimits(reading.notBuyers, siteText),
  };
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
): Promise<SiteReading> {
  await onStep?.("scrape");
  const page = await readSite(projectId, userId, url);

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
      brief: usableBrief(profile.brief),
      // Postgres reads the old row on the right, so this is the version being written.
      briefProfileVersion: options.rejudge
        ? sql`${projects.profileVersion} + 1`
        : sql`${projects.profileVersion}`,
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
