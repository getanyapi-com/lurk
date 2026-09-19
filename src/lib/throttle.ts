import { and, asc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { userActions } from "@/db/schema";
import { enqueueJob, nextQueuedJob } from "@/jobs/enqueue";
import { tierForUser } from "./tier";
import type { ActionWindow, PaidAction } from "./tiers";

const DAY_MS = 24 * 60 * 60 * 1000;

/** One tier's ration of one button: this many presses, per day or for good. */
type Ration = { limit: number; window: ActionWindow };

/**
 * What a user has left of one paid button. A null `limit` means no limit,
 * which is what a self-hosted instance gets. `spent` is true once no press is
 * left, and `opensAt` is when the next comes back, which a press spent for
 * good never does.
 */
export type Allowance = {
  limit: number | null;
  window: ActionWindow;
  spent: boolean;
  opensAt: Date | null;
};

/** Raised when a user has no press of a paid button left. */
export class ActionThrottledError extends Error {
  constructor({ limit, window }: Ration) {
    super(
      window === "ever"
        ? "Free includes this once. Connect a wallet to run it again."
        : `You have used all ${limit} of today's presses. Try again later.`,
    );
    this.name = "ActionThrottledError";
  }
}

async function rationFor(userId: string, action: PaidAction): Promise<Ration | null> {
  const { limits } = await tierForUser(userId);
  return limits ? { limit: limits.actions.presses[action], window: limits.actions.window } : null;
}

/** The presses that still count under a window: the last 24 hours, or all of them. */
function counted(userId: string, action: PaidAction, window: ActionWindow, now: Date) {
  return and(
    eq(userActions.userId, userId),
    eq(userActions.action, action),
    window === "day" ? gte(userActions.at, new Date(now.getTime() - DAY_MS)) : undefined,
  );
}

/**
 * When the next press comes back, given the presses that count oldest first,
 * or null while one is left: each press counts for 24 hours, so the press that
 * frees a slot is the one `limit` from the newest.
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
  const ration = await rationFor(userId, action);
  if (!ration) {
    return { limit: null, window: "day", spent: false, opensAt: null };
  }
  const rows = await db()
    .select({ at: userActions.at })
    .from(userActions)
    .where(counted(userId, action, ration.window, now))
    .orderBy(asc(userActions.at));
  const spent = rows.length >= ration.limit;
  const opensAt =
    spent && ration.limit > 0 && ration.window === "day"
      ? opensAtFrom(
          rows.map((row) => row.at),
          ration.limit,
        )
      : null;
  return { ...ration, spent, opensAt };
}

/**
 * Takes one press of a paid button, or throws when none is left. The count and
 * the insert are one transaction under a per-user lock, so two tabs pressing
 * at once cannot both take the last press.
 */
export async function spendAllowance(userId: string, action: PaidAction): Promise<void> {
  const ration = await rationFor(userId, action);
  if (!ration) {
    return;
  }
  await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`throttle:${userId}`}))`);
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(userActions)
      .where(counted(userId, action, ration.window, new Date()));
    if ((row?.count ?? 0) >= ration.limit) {
      throw new ActionThrottledError(ration);
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
