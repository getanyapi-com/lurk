import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { leadEvaluations, leads, redditComments, redditPosts } from "@/db/schema";
import { writeProgress } from "@/jobs/enqueue";
import { SCORER_VERSION, writeEvaluations, type EvaluationRecord } from "./evaluations";
import { routeLead, type LeadKind } from "./gates";
import type { Judgement, ScorableItem } from "./judgement";
import { demoteLeads, leadKey, writeLeads } from "./leads";
import { loadScanProject } from "./project";
import { readPosts, splitByReading } from "./reading";
import { judgeItems } from "./score";
import { toLead } from "./run";

/**
 * Judging every stored verdict again under a new scorer, once. A scorer version
 * says what a stored verdict means, so the moment it changes a project's feed
 * is a mix of two scorers: the posts a scan happens to see again get the new
 * reading and everything else keeps the old one. This sweep settles the whole
 * project at once, and reconciles the leads table with what it found.
 *
 * It buys no Reddit data. Every post and comment it judges is text the tables
 * already hold, and the shared reading of a post is cached, so the only spend
 * is the judgement call itself.
 */

const HOUR_MS = 60 * 60 * 1000;

export type RescoreOutcome = {
  /** Candidates re-judged, which is every stale verdict the project held. */
  judged: number;
  /** Leads withdrawn because the new verdict no longer puts them in the feed. */
  demoted: number;
  /** Candidates that now route to the feed and had no lead row before. */
  promoted: number;
  /** Leads whose new verdict kept them exactly where they were. */
  unchanged: number;
};

const NOTHING: RescoreOutcome = { judged: 0, demoted: 0, promoted: 0, unchanged: 0 };

/** One stale verdict, with the text it was made on. */
type Stale = {
  postId: string;
  commentId: string | null;
  profileVersion: number;
  contentHash: string;
  item: ScorableItem;
};

/**
 * Every project holding a verdict an older scorer made. One query for all of
 * them, because the caller is a loop over every project at boot and a query
 * inside that loop is a round trip per project for a single boolean.
 */
export async function projectsWithStaleEvaluations(): Promise<Set<string>> {
  const rows = await db()
    .selectDistinct({ projectId: leadEvaluations.projectId })
    .from(leadEvaluations)
    .where(ne(leadEvaluations.scorerVersion, SCORER_VERSION));
  return new Set(rows.map((row) => row.projectId));
}

/**
 * Every stale verdict this project holds, as the judge reads it. A comment is
 * judged as its author's own words with the post it replies to for context,
 * exactly as the scan judges one; a post is judged as itself.
 */
async function staleItems(projectId: string): Promise<Stale[]> {
  const rows = await db()
    .select({
      postId: leadEvaluations.postId,
      commentId: leadEvaluations.commentId,
      profileVersion: leadEvaluations.profileVersion,
      contentHash: leadEvaluations.contentHash,
      post: redditPosts,
      comment: redditComments,
    })
    .from(leadEvaluations)
    .innerJoin(redditPosts, eq(redditPosts.id, leadEvaluations.postId))
    .leftJoin(redditComments, eq(redditComments.id, leadEvaluations.commentId))
    .where(
      and(
        eq(leadEvaluations.projectId, projectId),
        ne(leadEvaluations.scorerVersion, SCORER_VERSION),
      ),
    );
  return rows.map((row) => ({
    postId: row.postId,
    commentId: row.commentId,
    profileVersion: row.profileVersion,
    contentHash: row.contentHash,
    item: row.comment
      ? {
          id: row.comment.id,
          title: row.post.title,
          subreddit: row.post.subreddit,
          body: row.comment.body ?? "",
          author: row.comment.author,
          ageHours: (Date.now() - row.comment.createdAt.getTime()) / HOUR_MS,
          upvotes: row.comment.score,
          numComments: row.post.numComments,
          parentBody: row.post.body ?? "",
        }
      : {
          id: row.post.id,
          title: row.post.title,
          subreddit: row.post.subreddit,
          body: row.post.body ?? "",
          author: row.post.author,
          ageHours: (Date.now() - row.post.createdAt.getTime()) / HOUR_MS,
          upvotes: row.post.score,
          numComments: row.post.numComments,
          parentBody: null,
        },
  }));
}

/** The status of every lead this project already holds, by candidate key. */
async function leadStatuses(projectId: string): Promise<Map<string, string>> {
  const rows = await db()
    .select({ postId: leads.postId, commentId: leads.commentId, status: leads.status })
    .from(leads)
    .where(eq(leads.projectId, projectId));
  return new Map(
    rows
      .filter((row): row is typeof row & { postId: string } => row.postId !== null)
      .map((row) => [leadKey(row.postId, row.commentId), row.status]),
  );
}

type Reconciled = {
  write: { judgement: Judgement; stale: Stale; kind: LeadKind }[];
  demote: { postId: string; commentId: string | null }[];
  promoted: number;
  unchanged: number;
};

/**
 * What each new verdict does to the leads table. A lead a person has already
 * acted on - hidden, called a miss, or marked resolved - is never touched,
 * whichever way its verdict moved: that row is their record of a decision they
 * made, and re-scoring is not a reason to overwrite or withdraw it.
 */
export function reconcile(
  judged: { judgement: Judgement; stale: Stale }[],
  statuses: Map<string, string>,
): Reconciled {
  const out: Reconciled = { write: [], demote: [], promoted: 0, unchanged: 0 };
  for (const { judgement, stale } of judged) {
    const status = statuses.get(leadKey(stale.postId, stale.commentId));
    if (status !== undefined && status !== "new") {
      continue;
    }
    const kind = routeLead(judgement);
    if (kind === null) {
      if (status === "new") {
        out.demote.push({ postId: stale.postId, commentId: stale.commentId });
      }
      continue;
    }
    out.write.push({ judgement, stale, kind });
    if (status === "new") {
      out.unchanged += 1;
    } else {
      out.promoted += 1;
    }
  }
  return out;
}

/**
 * Re-judges everything this project decided under an older scorer, and makes
 * the feed say what the new verdicts say. The shared reading still decides who
 * reaches the judge, so a post an earlier reading called a seller costs no
 * model call here either.
 */
export async function runRescore(projectId: string, jobId: string): Promise<RescoreOutcome> {
  const project = await loadScanProject(projectId);
  if (!project) {
    throw new Error("This project no longer exists");
  }
  const stale = await staleItems(projectId);
  if (stale.length === 0) {
    return NOTHING;
  }

  await writeProgress(jobId, `Judging ${stale.length} stored verdicts again`);
  const byId = new Map(stale.map((row) => [row.item.id, row]));
  const posts = stale.filter((row) => row.commentId === null).map((row) => row.item);
  const comments = stale.filter((row) => row.commentId !== null).map((row) => row.item);
  const readings = await readPosts(projectId, posts);
  const { toJudge, cut } = splitByReading(posts, readings);
  const judgements = [
    ...cut,
    ...(await judgeItems(projectId, project.product, [...toJudge, ...comments], readings)),
  ];
  const judged = judgements.flatMap((judgement) => {
    const row = byId.get(judgement.id);
    return row ? [{ judgement, stale: row }] : [];
  });

  await writeEvaluations(
    judged.map(({ judgement, stale: row }) => rewrite(projectId, row, judgement)),
  );
  const outcome = reconcile(judged, await leadStatuses(projectId));
  await writeLeads(
    outcome.write.map((entry) =>
      toLead(project, entry.judgement, entry.stale.postId, entry.stale.commentId, entry.kind),
    ),
  );
  const demoted = await demoteLeads(projectId, outcome.demote);
  await writeProgress(jobId, "Finished");
  return {
    judged: judged.length,
    demoted,
    promoted: outcome.promoted,
    unchanged: outcome.unchanged,
  };
}

/**
 * The stored verdict replaced by the new one. The text has not changed, so the
 * hash and the profile version the old verdict was made under are kept: a
 * rescore must not make the next scan judge everything a third time.
 */
function rewrite(projectId: string, row: Stale, judgement: Judgement): EvaluationRecord {
  return {
    projectId,
    postId: row.postId,
    commentId: row.commentId,
    judgement,
    profileVersion: row.profileVersion,
    contentHash: row.contentHash,
  };
}
