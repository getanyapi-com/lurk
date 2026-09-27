import { eq, inArray, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { discoveryEvidence } from "@/db/schema";
import type { Relevance, ThreadLabel } from "./label";
import type { Destination } from "./queries";

/** One Google result about one thread, before anything has judged it. */
export type Observation = {
  postId: string;
  canonicalUrl: string;
  subreddit: string;
  query: string;
  family: string | null;
  destination: string | null;
  position: number | null;
  title: string | null;
  snippet: string | null;
};

export type EvidenceRow = typeof discoveryEvidence.$inferSelect;

/** What a thread is worth until the model has read it. */
export const UNLABELED: Relevance = "unlabeled";

/**
 * Writes what each query saw. One thread returned by four queries is one
 * thread and four rows: the plan is ranked on unique threads, but which query
 * found it is the only thing that can tell a working query from a dead one.
 * A row already written stands, so re-running a query costs no evidence.
 */
export async function writeObservations(
  projectId: string,
  observations: Observation[],
): Promise<void> {
  if (observations.length === 0) {
    return;
  }
  await db()
    .insert(discoveryEvidence)
    .values(
      observations.map((item) => ({
        projectId,
        postId: item.postId,
        canonicalUrl: item.canonicalUrl,
        subreddit: item.subreddit,
        query: item.query,
        family: item.family,
        destination: item.destination,
        position: item.position,
        title: item.title,
        snippet: item.snippet,
        relevance: UNLABELED,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Files the model's verdict on a thread against every row that saw it, and the
 * place it named where no query supplied one.
 */
export async function applyRelevance(
  projectId: string,
  postId: string,
  relevance: Relevance,
  destination: string | null,
): Promise<void> {
  await db()
    .update(discoveryEvidence)
    .set(destination ? { relevance, destination } : { relevance })
    .where(and(eq(discoveryEvidence.projectId, projectId), eq(discoveryEvidence.postId, postId)));
}

/**
 * Files a whole round's labels in one database trip. Initial discovery spent
 * 4-6 seconds on the 2026-09-25 signup path; its old per-thread await added a
 * round trip for every label before the next Google round or the sweep could
 * start. The verdicts and destinations are unchanged, and every observation
 * of a thread still gets its verdict. A missing destination leaves the query's
 * own place standing, just as applyRelevance does.
 */
export async function applyRelevances(projectId: string, labels: ThreadLabel[]): Promise<void> {
  const kept = new Map<string, { relevance: Relevance; destination: string | null }>();
  for (const label of labels) {
    kept.set(label.id, {
      relevance: label.relevance,
      destination: label.destination || kept.get(label.id)?.destination || null,
    });
  }
  if (kept.size === 0) {
    return;
  }
  const values = [...kept].map(([id, label]) =>
    sql`(${id}::text, ${label.relevance}::text, ${label.destination}::text)`,
  );
  await db().execute(sql`
    update ${discoveryEvidence}
    set relevance = verdict.relevance,
        destination = coalesce(verdict.destination, ${discoveryEvidence.destination})
    from (values ${sql.join(values, sql`, `)}) as verdict(post_id, relevance, destination)
    where ${discoveryEvidence.projectId} = ${projectId}
      and ${discoveryEvidence.postId} = verdict.post_id
  `);
}

/** Every observation this project has collected, newest plan included. */
export function loadEvidence(projectId: string): Promise<EvidenceRow[]> {
  return db().select().from(discoveryEvidence).where(eq(discoveryEvidence.projectId, projectId));
}

/** The rows of one set of threads, used to merge a delta into what we hold. */
export function loadEvidenceForPosts(
  projectId: string,
  postIds: string[],
): Promise<EvidenceRow[]> {
  if (postIds.length === 0) {
    return Promise.resolve([]);
  }
  return db()
    .select()
    .from(discoveryEvidence)
    .where(
      and(eq(discoveryEvidence.projectId, projectId), inArray(discoveryEvidence.postId, postIds)),
    );
}

/** The destination seeds a project holds, as the jsonb column returns them. */
export function parseDestinations(value: unknown): Destination[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Destination => typeof (item as Destination)?.name === "string")
    .map((item) => ({ name: item.name, sourceText: String(item.sourceText ?? "") }))
    .filter((item) => item.name.trim().length > 0);
}

/**
 * One of a project's jsonb string lists, as the column returns it: its problem
 * phrasings, what it can do, or what it does not cover. Anything that is not a
 * non-empty string is dropped, so a half-written column can never be read as one.
 */
export function parseTextList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
