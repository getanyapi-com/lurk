import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { kickScheduler } from "@/jobs/scheduler";

export type LocalUser = typeof users.$inferSelect;

/**
 * The local row for the signed-in Clerk user, created on first authenticated
 * request. Returns null when there is no session.
 */
export async function currentLocalUser(): Promise<LocalUser | null> {
  const clerkUser = await currentUser();
  if (!clerkUser) {
    return null;
  }
  const primary = clerkUser.primaryEmailAddress;
  return localUserFor({
    clerkUserId: clerkUser.id,
    email: primary?.emailAddress ?? null,
    emailVerified: primary?.verification?.status === "verified",
  });
}

/**
 * Finds or creates the row for a Clerk identity. A Clerk id we have never seen
 * whose verified email already owns a row takes that row over instead of
 * starting an empty account: Clerk does not carry user ids from one instance to
 * another, so this is what keeps a person's projects theirs across a move. An
 * unverified address proves nothing and never adopts.
 */
export async function localUserFor(identity: {
  clerkUserId: string;
  email: string | null;
  emailVerified: boolean;
}): Promise<LocalUser | null> {
  const { clerkUserId, email, emailVerified } = identity;
  const known = await db().select().from(users).where(eq(users.clerkUserId, clerkUserId));
  if (!known[0] && email && emailVerified) {
    const adopted = await db().transaction(async (tx) => {
      const owners = await tx
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = lower(${email})`)
        .orderBy(asc(users.createdAt))
        .limit(1)
        .for("update");
      if (!owners[0]) {
        return null;
      }
      const moved = await tx
        .update(users)
        .set({ clerkUserId, email })
        .where(eq(users.id, owners[0].id))
        .returning();
      return moved[0] ?? null;
    });
    if (adopted) {
      return adopted;
    }
  }
  const rows = await db()
    .insert(users)
    .values({ clerkUserId, email })
    .onConflictDoUpdate({ target: users.clerkUserId, set: { email } })
    .returning();
  if (rows[0]) {
    return rows[0];
  }
  const existing = await db().select().from(users).where(eq(users.clerkUserId, clerkUserId));
  return existing[0] ?? null;
}

/**
 * The row for the caller, or a redirect to sign-in. Every page, route handler
 * and server action that touches tenant data calls this; nothing relies on the
 * proxy matching a path.
 */
export async function requireLocalUser(): Promise<LocalUser> {
  const user = await currentLocalUser();
  if (!user) {
    redirect("/sign-in");
  }
  await noteSeen(user.id);
  return user;
}

/** How often a visit is written down; the queue only needs it to the hour. */
const SEEN_EVERY_MS = 5 * 60 * 1000;

/**
 * Stamps the visit, and hands out work at once when it is the first in a
 * while: the routine jobs of a project nobody attended are due and waiting
 * (see ATTENDED_KINDS), and without the kick they would sit for up to a minute
 * while the person looks at yesterday's feed.
 */
export async function noteSeen(userId: string, now = new Date()): Promise<void> {
  const stamped = await db()
    .update(users)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(users.id, userId),
        or(isNull(users.lastSeenAt), lt(users.lastSeenAt, new Date(now.getTime() - SEEN_EVERY_MS))),
      ),
    )
    .returning({ id: users.id });
  if (stamped.length > 0) {
    kickScheduler();
  }
}
