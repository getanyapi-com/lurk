import { and, count, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads, projectSubreddits, projects, redditComments, redditPosts, xLeads } from "@/db/schema";
import { redditWordsWhere } from "@/lib/leadFilters";
import { redditLeadNotMuted } from "@/lib/mutes";
import { forgetProjectFeed } from "@/lib/projectFeedCache";
import { RETRIEVED_STATES } from "@/lib/scan/planStates";
import { foldScore } from "@/lib/x/gates";
import { communityKey, redditScore, xAskScore, type LeadFactors, type ScoringSettings } from "./weights";

/**
 * Re-ranking a project's stored leads under new weights. No verdict changes
 * and nothing is judged again: every factor a score is folded from is already
 * on the lead row, so a new score is arithmetic and one write per distinct
 * score, and the feed shows the new order on its next read.
 */

/** Ids grouped by the score they now hold, only where it moved. */
function moved<T extends { id: string; score: number }>(rows: T[], next: (row: T) => number | null): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const row of rows) {
    const score = next(row);
    if (score === null || score === row.score) {
      continue;
    }
    out.set(score, [...(out.get(score) ?? []), row.id]);
  }
  return out;
}

/** Every buyer lead the project holds, with the factors its score folds. */
export async function rankableLeads(projectId: string) {
  return db()
    .select({
      id: leads.id,
      score: leads.score,
      quality: leads.quality,
      intent: leads.intent,
      engagement: leads.engagement,
      subreddit: redditPosts.subreddit,
    })
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .where(and(eq(leads.projectId, projectId), eq(leads.kind, "buyer"), isNotNull(leads.quality)));
}

/**
 * Rewrites every stored score this project's weights decide: its Reddit buyer
 * leads, and its X asks. X replies are ranked against each other on what a
 * founder would answer, not on these factors, so they are left alone. Returns
 * how many leads moved.
 */
export async function rerankProject(projectId: string, scoring: ScoringSettings | null): Promise<number> {
  const reddit = moved(await rankableLeads(projectId), (row: LeadFactors & { id: string; score: number }) =>
    redditScore(row, scoring),
  );
  const asks = await db()
    .select({ id: xLeads.id, score: xLeads.score, fit: xLeads.fit, intent: xLeads.intent, engagement: xLeads.engagement })
    .from(xLeads)
    .where(and(eq(xLeads.projectId, projectId), eq(xLeads.kind, "ask")));
  // With no weights chosen an ask goes back to the X judge's own fold.
  const x = moved(asks, (row) => xAskScore(row, scoring) ?? foldScore(row.fit ?? 0, row.intent ?? 0, row.engagement ?? 0));

  let count = 0;
  await db().transaction(async (tx) => {
    for (const [score, ids] of reddit) {
      await tx.update(leads).set({ score }).where(inArray(leads.id, ids));
      count += ids.length;
    }
    for (const [score, ids] of x) {
      await tx.update(xLeads).set({ score }).where(inArray(xLeads.id, ids));
      count += ids.length;
    }
  });
  forgetProjectFeed(projectId);
  return count;
}

/** How many of the feed's leads the Product page re-ranks live. Enough that a weight can pull one up from well down the feed. */
const PREVIEW_LEADS = 60;

/**
 * What the Product page needs to show a weight change before it is saved: the
 * feed's best new leads with the factors they fold from, and every community
 * the owner could favour, which is where the project searches and where its
 * leads were found.
 */
export async function scoringPreview(projectId: string) {
  const top = await db()
    .select({
      id: leads.id,
      title: redditPosts.title,
      subreddit: redditPosts.subreddit,
      score: leads.score,
      quality: leads.quality,
      intent: leads.intent,
      engagement: leads.engagement,
    })
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .leftJoin(redditComments, eq(redditComments.id, leads.commentId))
    .innerJoin(projects, eq(projects.id, leads.projectId))
    .where(
      and(
        eq(leads.projectId, projectId),
        eq(leads.kind, "buyer"),
        eq(leads.status, "new"),
        isNotNull(leads.quality),
        gte(leads.quality, 0.5),
        // A lead the owner's word lists keep out of the feed is not one to re-rank in front of them.
        redditWordsWhere(),
        redditLeadNotMuted(),
      ),
    )
    .orderBy(desc(leads.score))
    .limit(PREVIEW_LEADS);
  const searched = await db()
    .select({ name: projectSubreddits.name })
    .from(projectSubreddits)
    .where(and(eq(projectSubreddits.projectId, projectId), inArray(projectSubreddits.state, RETRIEVED_STATES)));
  const name = sql<string>`lower(${redditPosts.subreddit})`;
  const found = await db()
    .select({ name })
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .where(and(eq(leads.projectId, projectId), eq(leads.kind, "buyer")))
    .groupBy(name)
    .orderBy(desc(count()), name);
  // Where leads were found first, busiest first, since those are the ones worth
  // favouring; then the communities searched that have found nothing yet.
  const communities = [
    ...new Set([...found, ...searched.sort((a, b) => a.name.localeCompare(b.name))].map((row) => communityKey(row.name))),
  ].filter(Boolean);
  return { leads: top, communities };
}
