import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { leadEvaluations } from "@/db/schema";
import { forgetProjectFeed } from "@/lib/projectFeedCache";
import type { Judgement } from "./judgement";
import { lastPerKey, leadKey } from "./leads";

/**
 * Every candidate this scan judged, kept whatever the verdict. A rejection that
 * is still the same text under the same product profile is never bought again,
 * and a review is something the user can look at instead of a lost model call.
 */

/**
 * Bumped when the prompts or the gates change what a stored verdict means.
 * 2026-09-22.2: one post a request; five narrow signal questions and, where
 * the product has a brief, three questions built from it; a lead is whoever a
 * logistic model over every answer puts over its threshold, and the feed is
 * sorted by it. At the gates' own recall on 2,362 labelled posts, 69% good and
 * 5% bad against 62% and 7% (leadModelWeights.ts).
 * 2026-09-22.1: the judge asks whether the person wants the same kind of
 * product and could use it, a lead needs the audience, same-kind and can-use
 * answers all to be yes, and the feed is sorted by how well the five match
 * answers agree. On 442 production leads labelled 2026-09-22 the buyer lane
 * went from 27% good and 28% bad to 38% and 18%, keeping 78 of 95 good leads.
 * 2026-09-19.1: the judge asks whether the author would welcome a product at
 * all, holds fit to the product's own job and the buyer to who can use it, and
 * a promoter or a fit-2 thread is no longer a context lead. On 1,463 labelled
 * production posts (scripts/scorer-eval.ts) the buyer lane went from 36% real
 * leads and 33% wrong to 53% and 18%, keeping 143 of the 156 strongest, with profiles read from several pages
 * and every limit checked against the site's own words.
 * 2026-09-13.1: the judgement call asks a slim prompt for ten fields instead of
 * thirteen, and a rejection now has to rest on a settled disqualifier, so every
 * verdict made before this is re-judged by the `rescore` job.
 * 2026-09-07.1: a shared, product-agnostic reading now decides which posts the
 * judgement call sees at all, so a rejection may be the reading's rather than
 * the judge's.
 * 2026-09-06.2: a settled no-need or wrong-job reading rejects whoever the
 * person is, a mis-quoted met requirement no longer holds a lead, and the model
 * reads plain typography so its quotes verify.
 */
export const SCORER_VERSION = "2026-09-22.2";

export type StoredJudgement = { profileVersion: number; contentHash: string };

/** One judged candidate, ready to be stored. */
export type EvaluationRecord = {
  projectId: string;
  postId: string;
  commentId: string | null;
  judgement: Judgement;
  profileVersion: number;
  contentHash: string;
};

/** The hash of the text a verdict was made on, and of nothing else. */
export function contentHash(parts: (string | null | undefined)[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part ?? "");
    hash.update("\u0000");
  }
  return hash.digest("hex");
}

/**
 * The judged text of one post: its own words and nothing else. Its replies are
 * read for competitors and for other buyers, never to judge the post again.
 */
export function postHash(title: string, body: string | null): string {
  return contentHash([title, body]);
}

/** Every verdict this project holds, by post or comment key. */
export async function loadEvaluations(projectId: string): Promise<Map<string, StoredJudgement>> {
  const rows = await db()
    .select({
      postId: leadEvaluations.postId,
      commentId: leadEvaluations.commentId,
      profileVersion: leadEvaluations.profileVersion,
      contentHash: leadEvaluations.contentHash,
      scorerVersion: leadEvaluations.scorerVersion,
    })
    .from(leadEvaluations)
    .where(eq(leadEvaluations.projectId, projectId));
  return new Map(
    rows
      .filter((row) => row.scorerVersion === SCORER_VERSION)
      .map((row) => [
        leadKey(row.postId, row.commentId),
        { profileVersion: row.profileVersion, contentHash: row.contentHash },
      ]),
  );
}

/**
 * True when this project already holds a verdict on exactly this text, made
 * against exactly this product profile. Anything else is judged again.
 */
export function alreadyJudged(
  stored: Map<string, StoredJudgement>,
  key: string,
  profileVersion: number,
  hash: string,
): boolean {
  const found = stored.get(key);
  return found?.profileVersion === profileVersion && found.contentHash === hash;
}

function values(record: EvaluationRecord) {
  const { judgement } = record;
  return {
    projectId: record.projectId,
    postId: record.postId,
    commentId: record.commentId,
    decision: judgement.decision,
    relationship: judgement.relationship,
    needState: judgement.needState,
    fit: judgement.fit,
    intent: judgement.intent,
    engagement: judgement.engagement,
    score: judgement.score,
    // The column is an array; one verdict now settles on exactly one code.
    reasonCodes: [judgement.reasonCode],
    evidenceQuote: judgement.needEvidence?.quote ?? null,
    reason: judgement.reason,
    profileVersion: record.profileVersion,
    contentHash: record.contentHash,
    scorerVersion: SCORER_VERSION,
    judgedAt: new Date(),
  };
}

/** Every column the second verdict on the same candidate replaces. */
const REPLACED = {
  decision: sql`excluded.decision`,
  relationship: sql`excluded.relationship`,
  needState: sql`excluded.need_state`,
  fit: sql`excluded.fit`,
  intent: sql`excluded.intent`,
  engagement: sql`excluded.engagement`,
  score: sql`excluded.score`,
  reasonCodes: sql`excluded.reason_codes`,
  evidenceQuote: sql`excluded.evidence_quote`,
  reason: sql`excluded.reason`,
  profileVersion: sql`excluded.profile_version`,
  contentHash: sql`excluded.content_hash`,
  scorerVersion: sql`excluded.scorer_version`,
  judgedAt: sql`excluded.judged_at`,
};

/** Stores one scan's verdicts, replacing the verdict a candidate already had. */
export async function writeEvaluations(input: EvaluationRecord[]): Promise<number> {
  const records = lastPerKey(
    input,
    (record) => `${record.projectId} ${leadKey(record.postId, record.commentId)}`,
  );
  const groups = [
    { rows: records.filter((record) => record.commentId === null), onComment: false },
    { rows: records.filter((record) => record.commentId !== null), onComment: true },
  ];
  let written = 0;
  for (const group of groups) {
    if (group.rows.length === 0) {
      continue;
    }
    const done = await db()
      .insert(leadEvaluations)
      .values(group.rows.map(values))
      .onConflictDoUpdate({
        target: group.onComment
          ? [leadEvaluations.projectId, leadEvaluations.commentId]
          : [leadEvaluations.projectId, leadEvaluations.postId],
        targetWhere: group.onComment
          ? sql`comment_id is not null`
          : sql`comment_id is null`,
        set: REPLACED,
      })
      .returning({ id: leadEvaluations.id });
    written += done.length;
  }
  forgetProjectFeed(new Set(records.map((record) => record.projectId)));
  return written;
}
