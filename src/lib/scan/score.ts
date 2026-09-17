import { askJev } from "@/lib/jev";
import { productState, type ProductFacts } from "@/lib/product";
import { askInBatches } from "./batches";
import { SCORE_BATCH_SIZE, TRIAGE_BATCH_SIZE } from "./constants";
import { assessmentFrom, readingFrom, triageFrom, type ReadingAnswers } from "./derive";
import { isSentinel } from "./evidence";
import { judge } from "./gates";
import type { Judgement, ScorableItem, TriageCandidate, TriageItem } from "./judgement";
import { judgeQuestions, keyed, readingQuestions, triageQuestions } from "./questions";
import { itemState, spans } from "./spans";
import { withCheckedEvidence } from "./validate";

/** A candidate the triage returned no verdict for is unread, never rejected. */
function unevaluated(id: string): TriageItem {
  return { id, disposition: "uncertain", asking: 0 };
}

async function triageBatch(
  projectId: string,
  product: ProductFacts,
  candidates: TriageCandidate[],
): Promise<TriageItem[]> {
  const titles: Record<string, unknown> = {};
  let questions = {};
  candidates.forEach((candidate, index) => {
    const key = `c${index}`;
    titles[key] = {
      subreddit: candidate.subreddit,
      title: candidate.title,
      author: candidate.author ?? "unknown",
      upvotes: candidate.score ?? 0,
      age_hours: Math.round(candidate.ageHours),
    };
    questions = { ...questions, ...keyed(key, triageQuestions(`titles.${key}`)) };
  });
  const answers = await askJev({
    purpose: "triage",
    projectId,
    state: { product: productState(product), titles },
    questions,
    itemsAsked: candidates.length,
  });
  return candidates.map((candidate, index) => triageFrom(candidate.id, answers, `c${index}`));
}

/**
 * Reads every new title in batches. Costs no Reddit data, and decides which
 * posts are worth buying in full. The list comes back in the order the caller
 * should spend its reading budget once readOrder has put every batch's verdicts
 * into one order.
 */
export async function triageTitles(
  projectId: string,
  product: ProductFacts,
  candidates: TriageCandidate[],
): Promise<TriageItem[]> {
  return askInBatches(
    candidates,
    TRIAGE_BATCH_SIZE,
    (batch) => triageBatch(projectId, product, batch),
    (batch) => batch.map((candidate) => unevaluated(candidate.id)),
  );
}

/** What a candidate's own facts say about how urgent reading it is. */
export type ReadFacts = { ageHours: number; upvotes: number | null };

/**
 * The ids to read, best first, in one order over everything this scan found,
 * never in the order the sources happened to return them. A candidate the
 * triage wants read outranks one it is unsure about; inside that, the more
 * likely the author is asking; then the younger post, because a thread cools
 * while it waits; then the more upvoted one. Rejects are left out and
 * uncertain ones stay in the queue.
 */
export function readOrder(triage: TriageItem[], facts: Map<string, ReadFacts>): string[] {
  const rank = (item: TriageItem) => ({
    disposition: item.disposition === "read" ? 0 : 1,
    asking: item.asking,
    ageHours: facts.get(item.id)?.ageHours ?? Number.POSITIVE_INFINITY,
    upvotes: facts.get(item.id)?.upvotes ?? 0,
  });
  return triage
    .filter((item) => item.disposition !== "reject")
    .map((item) => ({ item, key: rank(item) }))
    .sort(
      (a, b) =>
        a.key.disposition - b.key.disposition ||
        b.key.asking - a.key.asking ||
        a.key.ageHours - b.key.ageHours ||
        b.key.upvotes - a.key.upvotes,
    )
    .map((entry) => entry.item.id);
}

/**
 * One request: these candidates against this product. The three shared
 * reading questions are asked only for a candidate no reading covers, which
 * is every comment and any post the reading could not read.
 */
async function judgeBatch(
  projectId: string,
  product: ProductFacts,
  batch: ScorableItem[],
  readings: Map<string, ReadingAnswers>,
): Promise<Judgement[]> {
  const posts: Record<string, unknown> = {};
  let questions = {};
  batch.forEach((item, index) => {
    const key = `p${index}`;
    posts[key] = itemState(item);
    questions = { ...questions, ...keyed(key, judgeQuestions(`posts.${key}`)) };
    if (!readings.has(item.id)) {
      const ids = Object.keys(spans(item.title, item.body));
      questions = { ...questions, ...keyed(key, readingQuestions(`posts.${key}`, ids)) };
    }
  });
  const answers = await askJev({
    purpose: "score",
    projectId,
    state: { product: productState(product), posts },
    questions,
    itemsAsked: batch.length,
  });
  return batch.map((item, index) => {
    const key = `p${index}`;
    const reading = readings.get(item.id) ?? readingFrom(answers, key, spans(item.title, item.body));
    return withCheckedEvidence(judge(assessmentFrom(item.id, reading, answers, key), item), item);
  });
}

/**
 * Called with each batch of verdicts the moment it lands, so a caller can
 * commit them while the rest of the run is still going. A first sweep judges
 * for several minutes, and a feed that fills as it goes is the difference
 * between waiting and reading.
 */
export type OnJudged = (batch: Judgement[]) => Promise<void>;

/**
 * Judges items in batches. Every quote is a sentence the code cut from the
 * text the model was shown, so it is verbatim by construction and checked once
 * more against the person's own words. An item Reddit has taken away is never
 * sent at all, and so never judged; a batch the model never answered keeps no
 * verdict, so the next run judges it again.
 */
export async function judgeItems(
  projectId: string,
  product: ProductFacts,
  items: ScorableItem[],
  readings: Map<string, ReadingAnswers> = new Map(),
  onJudged?: OnJudged,
): Promise<Judgement[]> {
  const live = items.filter((item) => !isSentinel(item));
  return askInBatches(
    live,
    SCORE_BATCH_SIZE,
    async (batch) => {
      const judged = await judgeBatch(projectId, product, batch, readings);
      if (onJudged) {
        // A failed commit of ten must not lose the other batches' verdicts, for
        // the same reason a dropped model call does not lose the sweep.
        try {
          await onJudged(judged);
        } catch {
          // The caller writes again from the returned list when the run ends.
        }
      }
      return judged;
    },
    () => [],
  );
}
