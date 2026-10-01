import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projectCompetitors, projects, subreddits } from "@/db/schema";
import { clientForUser } from "./anyapi";
import { competitorHost } from "./competitors/host";
import { generateStructured } from "./llm";
import { BRIEF_INSTRUCTIONS, briefSchema, usableBrief, type ProductBrief } from "./brief";
import { COMPETITORS_SYSTEM, FAST_READING_SYSTEM, PROFILE_SYSTEM, PROMO_POLICY_SYSTEM } from "./prompts";
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

/**
 * What the fast reading is asked for: the facts the judge reads, the limits
 * grounded as the full reading's are, the searches the first sweep starts from,
 * and a shorter brief. Geography, destinations, platforms and competitors wait
 * for the full reading, since nothing before the first leads reads them.
 */
const fastReadingSchema = z.object({
  name: z.string(),
  pain: z.string(),
  solution: z.string(),
  targetUsers: z.string(),
  budgetFit: z.string(),
  capabilities: z.array(z.string()),
  problemPhrasings: z.array(z.string()),
  brief: briefSchema,
  exclusions: z.array(groundedSchema),
  notBuyers: z.array(groundedSchema),
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
  // Markdown alone. The default also sends the whole page's HTML, which nothing
  // here reads: on 20 product homepages 2026-09-24 asking for markdown only
  // took the median from 3.0 s to 2.4 s and the slowest from 8.6 s to 6.2 s,
  // on the same lane at the same price.
  const { result: res, requestId } = await funded.call(() =>
    funded.client.web.scrape({ url, formats: ["markdown"] }),
  );
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
 * Replaces the competitors the last reading of the page named with this one's,
 * as many as the tier's cap allows. They are rows of their own source, which a
 * discovery plan leaves standing (see publishDiscoveryPlan), and a name a
 * person already typed in is theirs.
 */
async function writePageCompetitors(
  projectId: string,
  reading: SiteReading,
  cap: number | null | undefined,
): Promise<void> {
  const rows = capped(pageCompetitors(reading.name, reading.competitors), cap);
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

/** A page as readSite returns it, which is what every reading of the site is asked about. */
type SitePage = { url: string; title?: string | null; description?: string | null; markdown?: string | null };

/** What the model is shown of the site: where it is, its title and description, and its pages. */
function pagePrompt(page: SitePage): string {
  return [`Website: ${page.url}`, `Title: ${page.title}`, `Description: ${page.description}`, "", page.markdown ?? ""].join("\n");
}

/** The site's own words, which a limit's quote has to be found in (groundedLimits). */
function siteText(page: SitePage): string {
  return `${page.title ?? ""}\n${page.description ?? ""}\n${page.markdown ?? ""}`;
}

const competitorsSchema = z.object({
  job: z.string(),
  category: z.string(),
  competitors: z.array(z.object({ name: z.string(), domain: z.string(), reason: z.string() })),
});

/**
 * The product's competitors, from the buyer's job and the market rather than
 * from what the page happens to name (COMPETITORS_SYSTEM). Asked beside the
 * full reading, so it costs no wait the reading does not already take.
 */
export async function competitorsFromPage(
  projectId: string,
  page: SitePage,
): Promise<{ name: string; domain: string }[]> {
  const answer = await generateStructured({
    purpose: "competitors",
    projectId,
    schema: competitorsSchema,
    system: COMPETITORS_SYSTEM,
    prompt: pagePrompt(page),
  });
  return answer.competitors.map(({ name, domain }) => ({ name, domain }));
}

/** What the site's pages say the product is. Reads them and writes nothing. */
export async function profileFromPage(projectId: string, page: SitePage): Promise<SiteReading> {
  const [reading, rivals] = await Promise.all([
    generateStructured({
      purpose: "profile",
      projectId,
      schema: readingSchema,
      system: READING_SYSTEM,
      prompt: pagePrompt(page),
    }),
    // The reading still names competitors of its own, kept for when this fails.
    competitorsFromPage(projectId, page).catch((error: unknown) => {
      console.warn(`[profile] the competitor reading failed, keeping the page's: ${messageOf(error)}`);
      return [];
    }),
  ]);
  return {
    ...reading,
    competitors: rivals.length > 0 ? rivals : reading.competitors,
    exclusions: groundedLimits(reading.exclusions, siteText(page)),
    notBuyers: groundedLimits(reading.notBuyers, siteText(page)),
  };
}

/**
 * The fast reading of the same pages (FAST_READING_SYSTEM), as a SiteReading
 * with the fields it does not ask for left empty.
 */
export async function fastProfileFromPage(projectId: string, page: SitePage): Promise<SiteReading> {
  const reading = await generateStructured({
    purpose: "profile_fast",
    projectId,
    schema: fastReadingSchema,
    system: FAST_READING_SYSTEM,
    effort: "minimal",
    prompt: pagePrompt(page),
  });
  return {
    name: reading.name,
    pain: reading.pain,
    solution: reading.solution,
    targetUsers: reading.targetUsers,
    budgetFit: reading.budgetFit,
    capabilities: reading.capabilities.slice(0, 10),
    problemPhrasings: reading.problemPhrasings,
    exclusions: groundedLimits(reading.exclusions, siteText(page)),
    notBuyers: groundedLimits(reading.notBuyers, siteText(page)),
    serviceGeography: "",
    destinations: [],
    platforms: [],
    sellsPlatformData: false,
    competitors: [],
    brief: reading.brief,
  };
}

/**
 * Reads the product's own page again and writes what the page now says the
 * product is, over a profile that already has verdicts made against it, so
 * those are all judged again. That is all it does: where and how the buyers
 * ask is learned by the initial discovery job, which the caller queues,
 * because reading Google takes minutes and nobody should hold a browser open
 * for it.
 */
export async function buildProfile(projectId: string, userId: string, url: string): Promise<SiteReading> {
  const page = await readSite(projectId, userId, url);
  // The tier only caps the competitors written below; it supplies nothing to
  // the model. Read it during the profile call, measured at about 30 seconds
  // on 2026-09-25, instead of adding its database reads after that call.
  const [profile, { limits }] = await Promise.all([
    profileFromPage(projectId, page),
    tierForUser(userId),
  ]);
  return writeReading(projectId, profile, limits?.competitors, true);
}

/** The profile a reading gives, with the searches built for its platforms added. */
function withPlatformPhrasings(profile: SiteReading): SiteReading {
  return {
    ...profile,
    problemPhrasings: [
      ...profile.problemPhrasings,
      ...platformPhrasings(profile.platforms, profile.sellsPlatformData),
    ],
  };
}

/** The project's columns a reading of the site fills: the facts, the plan's phrasings and the brief. */
function profileColumns(profile: SiteReading) {
  return {
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
    problemPhrasings: profile.problemPhrasings,
    brief: usableBrief(profile.brief),
  };
}

/**
 * Writes a reading over the project's profile, its brief and its competitors.
 * `rejudge` says whether the facts written here invalidate every verdict made
 * against the old ones. A rebuild does; the first build of a brand new project
 * has no verdicts to invalidate. The bump is written in the same statement as
 * the facts, so no job can ever read the new facts under the old version.
 */
async function writeReading(
  projectId: string,
  reading: SiteReading,
  competitorCap: number | null | undefined,
  rejudge: boolean,
): Promise<SiteReading & { profileVersion: number }> {
  const profile = withPlatformPhrasings(reading);
  const [row] = await db()
    .update(projects)
    .set({
      ...profileColumns(profile),
      // Postgres reads the old row on the right, so this is the version being written.
      briefProfileVersion: rejudge
        ? sql`${projects.profileVersion} + 1`
        : sql`${projects.profileVersion}`,
      ...(rejudge
        ? { profileVersion: sql`${projects.profileVersion} + 1` }
        : {}),
    })
    .where(eq(projects.id, projectId))
    .returning({ profileVersion: projects.profileVersion });
  await writePageCompetitors(projectId, profile, competitorCap);
  return { ...profile, profileVersion: row?.profileVersion ?? 1 };
}

/** A new project's first reading, and the full one still on its way. */
export type FastProfile = {
  reading: SiteReading;
  /**
   * Settles once the full reading has landed: true when it replaced the fast
   * one, false when it failed or somebody had changed the profile first. It
   * never rejects.
   */
  full: Promise<boolean>;
};

/**
 * A new project's profile, written as soon as the fast reading is back, so the
 * first sweep starts about 15 seconds sooner. The full reading of the same
 * pages runs beside it and replaces the facts and the brief when it lands,
 * and adds what only it reads: geography, destinations, platforms and
 * competitors. It keeps the profile version, so no verdict is judged again: the
 * two readings judged alike (see FAST_READING_SYSTEM), and a rescore of the
 * first sweep would cost more than the difference. It writes only over the
 * fast reading: a profile somebody changed in between is theirs.
 *
 * Whichever reading lands first with an answer is written; when the fast one
 * fails the full one is waited for, as before there was a fast one.
 */
export async function buildProfileFast(
  projectId: string,
  userId: string,
  url: string,
  onStep?: (step: ProfileStep) => Promise<void> | void,
): Promise<FastProfile> {
  await onStep?.("scrape");
  const page = await readSite(projectId, userId, url);

  await onStep?.("profile");
  const tier = tierForUser(userId);
  const fullRead = profileFromPage(projectId, page).then(
    (reading) => ({ reading }),
    (error: unknown) => ({ error }),
  );
  const fastRead = fastProfileFromPage(projectId, page).catch((error: unknown) => {
    console.warn(`[profile] the fast reading failed, waiting for the full one: ${messageOf(error)}`);
    return null;
  });
  const first = await Promise.race([
    fastRead.then((reading) => (reading ? { fast: reading } : null)),
    fullRead,
  ]);
  const { limits } = await tier;

  if (first && "fast" in first) {
    const written = await writeReading(projectId, first.fast, limits?.competitors, false);
    await onStep?.("done");
    return {
      reading: written,
      full: fullRead.then(async (landed) => {
        if ("error" in landed) {
          console.warn(`[profile] the full reading failed, keeping the fast one: ${messageOf(landed.error)}`);
          return false;
        }
        return replaceFastReading(projectId, written, landed.reading, limits?.competitors);
      }),
    };
  }
  // The full reading answered first, or the fast one failed: write the full
  // one, or failing that the fast one, as the only reading there is.
  const landed = first && "reading" in first ? first : await fullRead;
  let reading: SiteReading;
  if ("reading" in landed) {
    reading = landed.reading;
  } else {
    const fast = await fastRead;
    if (!fast) {
      throw landed.error;
    }
    reading = fast;
  }
  const written = await writeReading(projectId, reading, limits?.competitors, false);
  await onStep?.("done");
  return { reading: written, full: Promise.resolve(false) };
}

/**
 * Puts the full reading where the fast one was, unless the profile has moved
 * on since: a new version, or facts that are no longer the fast reading's.
 */
async function replaceFastReading(
  projectId: string,
  fast: SiteReading & { profileVersion: number },
  reading: SiteReading,
  competitorCap: number | null | undefined,
): Promise<boolean> {
  const profile = withPlatformPhrasings(reading);
  const replaced = await db()
    .update(projects)
    .set(profileColumns(profile))
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.profileVersion, fast.profileVersion),
        eq(projects.pain, fast.pain),
        eq(projects.solution, fast.solution),
        eq(projects.targetUsers, fast.targetUsers),
      ),
    )
    .returning({ id: projects.id });
  if (replaced.length === 0) {
    return false;
  }
  await writePageCompetitors(projectId, profile, competitorCap);
  return true;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
