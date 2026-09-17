import { enqueueJob, writeProgress } from "@/jobs/enqueue";
import { clientForUser } from "@/lib/anyapi";
import type { FetchContext } from "@/lib/reddit/fetch";
import { fetchAuthorProfile, fetchPost } from "@/lib/reddit/skus";
import type { StoredPost } from "@/lib/reddit/store";
import { scanIntervalHours, tierForUser } from "@/lib/tier";
import { RETENTION_DAYS } from "@/lib/tiers";
import { writeThreadMentions } from "@/lib/competitors/threads";
import { judgeThreads, readThreads } from "./comments";
import { hydrationCap, inFlight } from "./constants";
import { isSentinel } from "./evidence";
import { routeLead, type LeadKind } from "./gates";
import {
  alreadyJudged,
  loadEvaluations,
  postHash,
  writeEvaluations,
  type EvaluationRecord,
  type StoredJudgement,
} from "./evaluations";
import { demoteLeads, leadKey, threadsToRead, writeLeads, type LeadRow } from "./leads";
import { loadScanProject, type ScanProject } from "./project";
import { retrieve } from "./retrieve";
import { creditSources, markCovered, type CandidateSource } from "./sources";
import type { Judgement, ScorableItem } from "./judgement";
import { readPosts, splitByReading } from "./reading";
import { judgeItems, readOrder, triageTitles } from "./score";

const HOUR_MS = 60 * 60 * 1000;
const RETENTION_MS = RETENTION_DAYS * 24 * HOUR_MS;

/** A Reddit avatar changes rarely, so one lookup covers a whole month. */
const AUTHOR_MAX_AGE_MS = 30 * 24 * HOUR_MS;

export type ScanOutcome = {
  candidates: number;
  read: number;
  leads: number;
  /** Windows this scan could not finish covering, said in plain words. */
  gaps: string[];
};

export function toLead(
  project: ScanProject,
  judgement: Judgement,
  postId: string,
  commentId: string | null,
  kind: LeadKind,
): LeadRow {
  return {
    projectId: project.id,
    postId,
    commentId,
    kind,
    score: judgement.score,
    fit: judgement.fit,
    intent: judgement.intent,
    engagement: judgement.engagement,
    stage: judgement.stage,
    reason: judgement.reason,
    matchedPhrase: judgement.matchedPhrase,
  };
}

/**
 * Only a qualified judgement reaches the feed. The gates in gates.ts settled
 * that; the project's own minimum score is applied when the feed is read, so
 * moving it never has to mean scanning again.
 */
function qualified<T extends { judgement: Judgement }>(items: T[]): T[] {
  return items.filter((item) => item.judgement.decision === "qualify");
}

/**
 * The posts that reach the feed, each with the lane it belongs in. A buyer is
 * the lead the project asked for; a thread the product plainly fits where
 * nobody is asking is kept as context, because a comment there is still worth
 * writing. Everything gates.ts rejects outright is dropped here.
 */
export function routed<T extends { judgement: Judgement }>(items: T[]): (T & { kind: LeadKind })[] {
  return items.flatMap((item) => {
    const kind = routeLead(item.judgement);
    return kind === null ? [] : [{ ...item, kind }];
  });
}

export function postItem(post: StoredPost): ScorableItem {
  return {
    id: post.id,
    title: post.title,
    subreddit: post.subreddit,
    body: post.body ?? "",
    author: post.author,
    ageHours: (Date.now() - post.createdAt.getTime()) / HOUR_MS,
    upvotes: post.score,
    numComments: post.numComments,
    parentBody: null,
  };
}

/**
 * Faces for the feed, bought once a month per author. A failure here is not a
 * failed scan: the card falls back to the author's initials.
 */
async function fetchAvatars(ctx: FetchContext, usernames: string[]): Promise<void> {
  await inFlight([...new Set(usernames.filter(Boolean))], async (username) => {
    try {
      await fetchAuthorProfile(ctx, username, AUTHOR_MAX_AGE_MS);
    } catch {
      // An avatar is decoration; the lead is already written.
    }
  });
}

/**
 * The posts this project has no current verdict on, given what it has read. A
 * post Reddit has taken away is dropped here, before a title is triaged or a
 * body is bought: there is nothing left to read and nobody left to answer.
 */
export function unjudged(
  project: ScanProject,
  stored: Map<string, StoredJudgement>,
  posts: StoredPost[],
): StoredPost[] {
  return posts.filter(
    (post) =>
      !isSentinel(post) &&
      !alreadyJudged(
        stored,
        leadKey(post.id, null),
        project.profileVersion,
        postHash(post.title, post.body),
      ),
  );
}

export function evaluationsFor(
  project: ScanProject,
  posts: StoredPost[],
  judgements: Judgement[],
): EvaluationRecord[] {
  const byId = new Map(posts.map((post) => [post.id, post]));
  return judgements.map((judgement) => {
    const post = byId.get(judgement.id) as StoredPost;
    return {
      projectId: project.id,
      postId: post.id,
      commentId: null,
      judgement,
      profileVersion: project.profileVersion,
      contentHash: postHash(post.title, post.body),
    };
  });
}

/**
 * One scan: run the retrieval plan, triage the titles, read the shortlist in
 * full, take the shared reading of each one, judge whatever that reading left,
 * and write what qualified. Only then are comment threads bought, once per
 * lead and again only when the reply count moves, for two purposes: naming
 * the competitors being recommended in the thread, and finding the other
 * people in it who have a need of their own. Leads are already committed by
 * that point, so a thread we cannot read costs a scan nothing.
 */
export async function runScan(projectId: string, jobId: string): Promise<ScanOutcome> {
  const project = await loadScanProject(projectId);
  if (!project) {
    throw new Error("This project no longer exists");
  }
  const { limits } = await tierForUser(project.userId);
  const funded = await clientForUser(project.userId);
  const ctx: FetchContext = {
    projectId,
    funded,
    maxAgeMs: scanIntervalHours(limits) * HOUR_MS,
  };
  const windowMs = (limits?.feedWindowDays ?? RETENTION_DAYS) * 24 * HOUR_MS;
  const hydration = hydrationCap(limits);

  await writeProgress(jobId, "Looking for new posts");
  const stored = await loadEvaluations(projectId);
  const retrieval = await retrieve({
    project,
    ctx,
    limits,
    windowMs,
    scanIntervalHours: scanIntervalHours(limits),
    hydration,
  });
  const sourcesByPost = new Map<string, CandidateSource[]>(
    retrieval.candidates.map((candidate) => [candidate.post.id, candidate.sources]),
  );
  const candidates = await unjudged(
    project,
    stored,
    retrieval.candidates.map((candidate) => candidate.post),
  );

  await writeProgress(jobId, `Reading ${candidates.length} titles`);
  const triage = await triageTitles(
    projectId,
    project.product,
    candidates.map((post) => ({
      id: post.id,
      title: post.title,
      subreddit: post.subreddit,
      author: post.author,
      score: post.score,
      ageHours: (Date.now() - post.createdAt.getTime()) / HOUR_MS,
    })),
  );
  const left = hydration === null ? candidates.length : Math.max(hydration - retrieval.hydrated, 0);
  const byId = new Map(candidates.map((post) => [post.id, post]));
  const facts = new Map(
    candidates.map((post) => [
      post.id,
      { ageHours: (Date.now() - post.createdAt.getTime()) / HOUR_MS, upvotes: post.score },
    ]),
  );
  const ordered = readOrder(triage, facts)
    .map((id) => byId.get(id))
    .filter((post): post is StoredPost => post !== undefined);
  /**
   * A post whose text a search already carried needs no `reddit.post` call, so
   * it is read for free and the hydration budget is spent only on the posts we
   * still have to open.
   */
  let budget = left;
  const shortlist = ordered.filter((post) => {
    if (post.bodyObservedAt) {
      return true;
    }
    if (budget === 0) {
      return false;
    }
    budget -= 1;
    return true;
  });
  const opening = shortlist.filter((post) => !post.bodyObservedAt);

  await writeProgress(jobId, `Opening ${opening.length} posts`);
  const full = await inFlight(shortlist, async (post) => {
    if (post.bodyObservedAt) {
      return post;
    }
    const result = await fetchPost(ctx, post.url, RETENTION_MS);
    return result.value[0] ?? post;
  });

  await writeProgress(jobId, `Checking who is asking in ${full.length} posts`);
  const unjudgedPosts = unjudged(project, stored, full);
  const sources = unjudgedPosts.map(postItem);
  const readings = await readPosts(projectId, sources);
  const { toJudge, cut } = splitByReading(sources, readings);

  await writeProgress(jobId, `Scoring ${toJudge.length} of ${sources.length} posts`);
  const judgements = [...cut, ...(await judgeItems(projectId, project.product, toJudge, readings))];
  await writeEvaluations(evaluationsFor(project, unjudgedPosts, judgements));
  for (const entry of retrieval.covered) {
    await markCovered(entry.row, entry.at);
  }
  const scored = judgements.map((judgement) => ({ judgement }));
  const fullById = new Map(unjudgedPosts.map((post) => [post.id, post]));
  const postLeads = routed(scored).map((item) =>
    toLead(project, item.judgement, item.judgement.id, null, item.kind),
  );
  await writeLeads(postLeads);
  /**
   * A post this run judged again and no longer routes anywhere loses its lead.
   * The feed is what the current verdict says, so a lead a profile edit turned
   * into a review belongs in the held pile, not in front of a person as a
   * buyer we no longer believe in.
   */
  const kept = new Set(postLeads.map((lead) => lead.postId));
  await demoteLeads(
    projectId,
    judgements
      .filter((judgement) => !kept.has(judgement.id))
      .map((judgement) => ({ postId: judgement.id, commentId: null })),
  );

  await writeProgress(jobId, "Reading comment threads");
  const threadPosts = await threadsToRead(projectId, limits?.commentThreadsPerScan ?? null);
  const { threads } = await readThreads(ctx, threadPosts);
  await writeThreadMentions(projectId, project.competitors, threads);
  const judged = await judgeThreads(project, threads, stored);
  await writeEvaluations(judged.records);
  const commentLeads = qualified(judged.discovery).map((item) =>
    toLead(project, item.judgement, item.postId, item.comment.id, "buyer"),
  );
  await writeLeads(commentLeads);
  const committed = new Set(
    [...postLeads, ...commentLeads].map((lead) => leadKey(lead.postId, lead.commentId)),
  );

  await writeProgress(jobId, "Looking up who posted");
  await fetchAvatars(ctx, [
    ...postLeads.map((lead) => fullById.get(lead.postId)?.author ?? ""),
    ...qualified(judged.discovery).map((item) => item.comment.author ?? ""),
  ]);

  await creditSources(
    sourcesByPost,
    unjudgedPosts.map((post) => post.id),
    postLeads.map((lead) => lead.postId),
  );

  await writeProgress(
    jobId,
    retrieval.gaps.length === 0 ? "Finished" : `Finished. ${retrieval.gaps.join(" ")}`,
  );
  await enqueueJob("scan", projectId, new Date(Date.now() + scanIntervalHours(limits) * HOUR_MS));
  return {
    candidates: candidates.length,
    read: full.length,
    leads: committed.size,
    gaps: retrieval.gaps,
  };
}
