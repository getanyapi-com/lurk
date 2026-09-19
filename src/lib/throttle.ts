import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { userActions } from "@/db/schema";
import { enqueueJob, nextQueuedJob } from "@/jobs/enqueue";
import { tierForUser } from "./tier";
import type { PaidAction } from "./tiers";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What a user has left of one paid button. A null `limit` means no limit,
 * which is what a self-hosted instance gets, and zero means the button is off.
 * `opensAt` is when the next press comes back once they are all used, and null
 * while one is left.
 */
export type Allowance = { limit: number | null; opensAt: Date | null };

/** Whether the button can be pressed now. */
export function canPress(allowance: Allowance): boolean {
  return allowance.limit !== 0 && allowance.opensAt === null;
}

/** Raised when a user has used every press of a paid button for the day. */
export class ActionThrottledError extends Error {
  constructor(limit: number) {
    super(
      limit === 0
        ? "This needs a connected wallet."
        : `You have used all ${limit} of today's presses. Try again later.`,
    );
    this.name = "ActionThrottledError";
  }
}

async function limitFor(userId: string, action: PaidAction): Promise<number | null> {
  const { limits } = await tierForUser(userId);
  return limits ? limits.actionsPerDay[action] : null;
}

/** The presses of this button in the 24 hours before `now`, oldest first. */
async function pressesSince(userId: string, action: PaidAction, now: Date): Promise<Date[]> {
  const rows = await db()
    .select({ at: userActions.at })
    .from(userActions)
    .where(
      and(
        eq(userActions.userId, userId),
        eq(userActions.action, action),
        gte(userActions.at, new Date(now.getTime() - DAY_MS)),
      ),
    )
    .orderBy(asc(userActions.at));
  return rows.map((row) => row.at);
}

/**
 * When the next press comes back, given the presses of the last 24 hours oldest
 * first, or null while one is left: each press counts for 24 hours, so the
 * press that frees a slot is the one `limit` from the newest.
 */
export function opensAtFrom(presses: Date[], limit: number): Date | null {
  if (presses.length < limit) {
    return null;
  }
  return new Date(presses[presses.length - limit].getTime() + DAY_MS);
}

/** What this user has left of a paid button, for a page to draw it with. */
export async function allowanceFor(
  userId: string,
  action: PaidAction,
  now = new Date(),
): Promise<Allowance> {
  const limit = await limitFor(userId, action);
  if (limit === null || limit === 0) {
    return { limit, opensAt: null };
  }
  return { limit, opensAt: opensAtFrom(await pressesSince(userId, action, now), limit) };
}

/**
 * Takes one press of a paid button, or throws when none is left. The count and
 * the insert are one transaction under a per-user lock, so two tabs pressing
 * at once cannot both take the last press.
 */
export async function spendAllowance(userId: string, action: PaidAction): Promise<void> {
  const limit = await limitFor(userId, action);
  if (limit === null) {
    return;
  }
  await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`throttle:${userId}`}))`);
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(userActions)
      .where(
        and(
          eq(userActions.userId, userId),
          eq(userActions.action, action),
          gte(userActions.at, new Date(Date.now() - DAY_MS)),
        ),
      );
    if ((row?.count ?? 0) >= limit) {
      throw new ActionThrottledError(limit);
    }
    await tx.insert(userActions).values({ userId, action });
  });
}

/**
 * Queues the job a paid button asks for and takes one press for it. When a job
 * of that kind is already due the press would buy nothing new, so it neither
 * queues nor counts, and a double click costs one press, not two.
 */
export async function pressForJob(
  userId: string,
  action: PaidAction,
  kind: string,
  projectId: string,
): Promise<void> {
  const queued = await nextQueuedJob(kind, projectId);
  if (queued && queued.runAt.getTime() <= Date.now()) {
    return;
  }
  await spendAllowance(userId, action);
  await enqueueJob(kind, projectId);
}

/** Drops presses too old to count against anything, which the retention job runs. */
export async function deleteOldUserActions(now = new Date()): Promise<void> {
  await db()
    .delete(userActions)
    .where(lt(userActions.at, new Date(now.getTime() - 2 * DAY_MS)));
}
