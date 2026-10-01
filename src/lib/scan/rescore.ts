import { and, eq, isNull, lt, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { leadEvaluations, leads, redditComments, redditPosts } from "@/db/schema";
import { writeProgress } from "@/jobs/enqueue";
import type { StoredPost } from "@/lib/reddit/store";
import { SCORER_VERSION, writeEvaluations, type EvaluationRecord } from "./evaluations";
import type { Judgement, ScorableItem } from "./judgement";
import { commentItem, judgePosts, postItem, toLead } from "./judging";
import { demoteLeads, leadKey, writeLeads } from "./leads";
import { requireScanProject } from "./project";

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

export type RescoreOutcome = {
  /** Candidates re-judged, which is every stale verdict the project held that a scan would judge. */
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
  post: StoredPost;
  item: ScorableItem;
};

/**
 * The verdicts a rescore may judge again: a post's, or a comment's that answers
 * the post. The scan judges no other comment (comments.ts
 * representativeComments): a reply to another comment, or one whose parent
 * Reddit did not give, reads against the post alone as a need it is not.
 * Judged again here it could reach the feed the scan keeps it out of, so its
 * old verdict is left as it is. Reads the comment the verdict is on, which the
 * query has to join.
 */
function judgedAsTheScanWould() {
  return or(isNull(leadEvaluations.commentId), eq(redditComments.parentId, leadEvaluations.postId));
}

/**
 * Every project holding a verdict an older scorer made that a rescore would
 * judge. One query for all of them, because the caller is a loop over every
 * project at boot and a query inside that loop is a round trip per project for
 * a single boolean.
 */
export async function projectsWithStaleEvaluations(): Promise<Set<string>> {
  const rows = await db()
    .selectDistinct({ projectId: leadEvaluations.projectId })
    .from(leadEvaluations)
    .leftJoin(redditComments, eq(redditComments.id, leadEvaluations.commentId))
    .where(and(ne(leadEvaluations.scorerVersion, SCORER_VERSION), judgedAsTheScanWould()));
  return new Set(rows.map((row) => row.projectId));
}

/**
 * Every stale verdict this project holds, as the judge reads it: one an older
 * scorer made, or one made against an older profile than the project has now. A comment is
 * judged as its author's own words with the post it replies to for context,
 * exactly as the scan judges one, and only when it answers the post; a post is
 * judged as itself.
 */
async function staleItems(projectId: string, profileVersion: number): Promise<Stale[]> {
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
        or(
          ne(leadEvaluations.scorerVersion, SCORER_VERSION),
          lt(leadEvaluations.profileVersion, profileVersion),
        ),
        judgedAsTheScanWould(),
      ),
    );
  return rows.map((row) => ({
    postId: row.postId,
    commentId: row.commentId,
    profileVersion: row.profileVersion,
    contentHash: row.contentHash,
    post: row.post,
    item: row.comment ? commentItem(row.post, row.comment) : postItem(row.post),
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
  write: { judgement: Judgement; stale: Stale }[];
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
    if (judgement.decision !== "qualify") {
      if (status === "new") {
        out.demote.push({ postId: stale.postId, commentId: stale.commentId });
      }
      continue;
    }
    out.write.push({ judgement, stale });
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
  const project = await requireScanProject(projectId);
  const stale = await staleItems(projectId, project.profileVersion);
  if (stale.length === 0) {
    return NOTHING;
  }

  await writeProgress(jobId, `Judging ${stale.length} stored verdicts again`);
  const byId = new Map(stale.map((row) => [row.item.id, row]));
  const posts = stale.filter((row) => row.commentId === null).map((row) => row.post);
  const comments = stale.filter((row) => row.commentId !== null).map((row) => row.item);
  const judgements = await judgePosts(project, posts, comments);
  const judged = judgements.flatMap((judgement) => {
    const row = byId.get(judgement.id);
    return row ? [{ judgement, stale: row }] : [];
  });

  const outcome = reconcile(judged, await leadStatuses(projectId));
  await writeLeads(
    outcome.write.map((entry) =>
      toLead(project, entry.judgement, entry.stale.postId, entry.stale.commentId),
    ),
  );
  const demoted = await demoteLeads(projectId, outcome.demote);
  // Verdicts last: once rewritten a row is no longer stale, so a rescore that
  // died before the feed was settled would never come back for it.
  await writeEvaluations(
    judged.map(({ judgement, stale: row }) => rewrite(projectId, project.profileVersion, row, judgement)),
  );
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
 * hash is kept, and the verdict is stored under the profile it was just made
 * against: a rescore must not make the next scan judge everything a third time.
 */
function rewrite(
  projectId: string,
  profileVersion: number,
  row: Stale,
  judgement: Judgement,
): EvaluationRecord {
  return {
    projectId,
    postId: row.postId,
    commentId: row.commentId,
    judgement,
    profileVersion,
    contentHash: row.contentHash,
  };
}
