import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { postReadings } from "@/db/schema";
import { askJev } from "@/lib/jev";
import { askInBatches } from "./batches";
import { SCORE_BATCH_SIZE } from "./constants";
import { readingFrom, type ReadingAnswers } from "./derive";
import { contentHash } from "./evaluations";
import { isSentinel } from "./evidence";
import { judge } from "./gates";
import type { Assessment, Judgement, ScorableItem } from "./judgement";
import { keyed, readingQuestions } from "./questions";
import { itemState, spans } from "./spans";

/**
 * The shared reading: who is speaking, what state their own need is in, and
 * which of their sentences says so, answered before any product is
 * considered. Every project watching a post reads the same answer, so the
 * first project to see it pays for all of them, and the judge asks these
 * three questions only for a candidate no reading covers.
 *
 * It keeps the judgement away from posts no product would ever qualify. Over
 * the 540 judged posts replayed in .context/embed-test/report3.md, requiring a
 * buyer whose need is open cut 55 to 78% of the rejections on all five
 * products and lost no lead on any of them.
 */

export type Reading = ReadingAnswers;

/**
 * Bumped when the questions or this shape change what a stored reading means.
 * A reading made under an older version is read again.
 */
export const READING_VERSION = "2026-09-17.1";

/** The hash of the post's own words. Replies do not change who is speaking. */
export function readingHash(title: string, body: string | null): string {
  return contentHash([title, body]);
}

/** True when this reading found a buyer whose own need is not settled. */
export function isAskingBuyer(reading: Reading): boolean {
  return (
    reading.relationship === "buyer" &&
    (reading.needState === "open" || reading.needState === "evaluating")
  );
}

/** The readings already held for these posts, still current for their text. */
async function cached(items: ScorableItem[]): Promise<Map<string, Reading>> {
  if (items.length === 0) {
    return new Map();
  }
  const rows = await db()
    .select()
    .from(postReadings)
    .where(inArray(postReadings.postId, items.map((item) => item.id)));
  const wanted = new Map(items.map((item) => [item.id, readingHash(item.title, item.body)]));
  return new Map(
    rows
      .filter(
        (row) =>
          row.readingVersion === READING_VERSION && row.contentHash === wanted.get(row.postId),
      )
      .map((row) => [
        row.postId,
        {
          relationship: row.relationship as Reading["relationship"],
          needState: row.needState as Reading["needState"],
          quote: row.quote,
        },
      ]),
  );
}

async function store(item: ScorableItem, reading: Reading): Promise<void> {
  await db()
    .insert(postReadings)
    .values({
      postId: item.id,
      ...reading,
      contentHash: readingHash(item.title, item.body),
      readingVersion: READING_VERSION,
      readAt: new Date(),
    })
    .onConflictDoUpdate({
      target: postReadings.postId,
      set: {
        relationship: sql`excluded.relationship`,
        needState: sql`excluded.need_state`,
        quote: sql`excluded.quote`,
        contentHash: sql`excluded.content_hash`,
        readingVersion: sql`excluded.reading_version`,
        readAt: sql`excluded.read_at`,
      },
    });
}

/** One request: these posts, the three shared questions each. */
async function readBatch(
  projectId: string,
  batch: ScorableItem[],
): Promise<[string, Reading][]> {
  const posts: Record<string, unknown> = {};
  let questions = {};
  batch.forEach((item, index) => {
    const key = `p${index}`;
    posts[key] = itemState(item);
    questions = { ...questions, ...keyed(key, readingQuestions(`posts.${key}`, Object.keys(spans(item.title, item.body)))) };
  });
  const answers = await askJev({
    purpose: "reading",
    projectId,
    state: { posts },
    questions,
    itemsAsked: batch.length,
  });
  const readings = batch.map((item, index): [string, Reading] => [
    item.id,
    readingFrom(answers, `p${index}`, spans(item.title, item.body)),
  ]);
  // A reading that could not be stored is still a reading: the answer is paid
  // for and serves this scan, and the next one buys it again.
  await Promise.all(
    readings.map(([id, reading]) =>
      store(batch.find((item) => item.id === id) as ScorableItem, reading).catch(() => undefined),
    ),
  );
  return readings;
}

/**
 * A reading for every post that has one. A post the model could not read is
 * left out and goes to the judge as it always did: an outage upstream must cost
 * money, never a lead.
 */
export async function readPosts(
  projectId: string,
  items: ScorableItem[],
): Promise<Map<string, Reading>> {
  const live = items.filter((item) => !isSentinel(item));
  const readings = await cached(live);
  const todo = live.filter((item) => !readings.has(item.id));
  const read = await askInBatches(
    todo,
    SCORE_BATCH_SIZE,
    (batch) => readBatch(projectId, batch),
    () => [],
  );
  for (const [id, reading] of read) {
    readings.set(id, reading);
  }
  return readings;
}

/** What the reading found, in the words the verdict is written in. */
const SPEAKER_PHRASE: Record<Reading["relationship"], string> = {
  buyer: "a buyer whose need is not open",
  seller: "someone announcing or promoting something of their own",
  helper: "someone answering others rather than asking",
  discussion: "a discussion with nobody asking for anything",
  unknown: "nobody clearly asking for anything",
};

/**
 * The verdict for a post the reading kept away from the judge. It claims only
 * what the reading saw: who was speaking, and the state of their need. Every
 * score is left null, so the existing gates in gates.ts settle the decision
 * from that reading alone and no second set of rules has to agree with them.
 */
function notAsking(reading: Reading): Assessment {
  return {
    id: "",
    relationship: reading.relationship,
    needState: reading.needState,
    fit: null,
    intent: null,
    stage: "none",
    decision: "reject",
    // Every reading that reaches here fails a gate, so the gate names it.
    reasonCode: "insufficient_evidence",
    needEvidence: reading.quote === null ? null : { quote: reading.quote },
    reason: `A first reading of this post found ${SPEAKER_PHRASE[reading.relationship]}, so it was not scored against the product.`,
  };
}

/**
 * The posts the judge should read, and the verdicts for the ones it should not.
 * A post with no reading is judged, because only a reading that says the author
 * is not a buyer with an open need may keep a post off the judge's list.
 */
export function splitByReading(
  items: ScorableItem[],
  readings: Map<string, Reading>,
): { toJudge: ScorableItem[]; cut: Judgement[] } {
  const toJudge: ScorableItem[] = [];
  const cut: Judgement[] = [];
  for (const item of items) {
    const reading = readings.get(item.id);
    if (!reading || isAskingBuyer(reading)) {
      toJudge.push(item);
      continue;
    }
    cut.push(judge({ ...notAsking(reading), id: item.id }, item));
  }
  return { toJudge, cut };
}
