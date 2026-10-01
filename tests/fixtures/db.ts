import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { db } from "@/db";
import { projects, redditPosts, users } from "@/db/schema";

/**
 * The rows nearly every database-backed test starts from, written once. Every
 * test file writes to the one test database at the same time as the others, so
 * each row gets an id no other file can be holding.
 */

/** describe for tests that need the database, skipped on a machine without one. */
export const describeDb = describe.skipIf(!process.env.DATABASE_URL);

/** A user nobody signs in as. The test_ prefix marks the row as a fixture. */
export async function makeUser(values: Partial<typeof users.$inferInsert> = {}) {
  const [user] = await db()
    .insert(users)
    .values({ clerkUserId: `test_${randomUUID()}`, ...values })
    .returning();
  return user;
}

/** A project of `userId`'s, named Formcraft unless the test names it. */
export async function makeProject(
  userId: string,
  values: Omit<Partial<typeof projects.$inferInsert>, "userId"> = {},
) {
  const [project] = await db()
    .insert(projects)
    .values({ name: "Formcraft", ...values, userId })
    .returning();
  return project;
}

/** A thread asked in r/SaaS just now, unless the test says otherwise. */
export async function makePost(values: Partial<typeof redditPosts.$inferInsert> = {}) {
  const [post] = await db()
    .insert(redditPosts)
    .values({
      id: `p${randomUUID().slice(0, 8)}`,
      subreddit: "SaaS",
      author: "asker",
      title: "Form question",
      url: "https://www.reddit.com/r/SaaS/comments/x/form/",
      createdAt: new Date(),
      ...values,
    })
    .returning();
  return post;
}

let counter = 0;

/**
 * A snowflake-shaped id no other test uses: the prefix, the time and a count.
 * Two files can write in the same millisecond, and each counts from one, so
 * the prefix is what keeps them apart: each file passes one no other file
 * uses. Taken so far: 6 xRetention, 7 xRescore, 8 xFiltered, 9 xRun.
 */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now()}${String(counter).padStart(5, "0")}`;
}
