import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { limitsFor } from "./tiers";
import { config } from "./config";
import { walletConnection } from "./anyapi";

export type Project = typeof projects.$inferSelect;

export async function listProjects(userId: string): Promise<Project[]> {
  return db().select().from(projects).where(eq(projects.userId, userId)).orderBy(asc(projects.createdAt));
}

/**
 * Creates a project, refusing when the user's tier is already at its limit. The
 * count and the insert share a transaction that holds the user's row, so two
 * requests arriving together are counted one after the other, not both at once.
 */
export async function createProject(userId: string, name: string, url: string | null) {
  const connected = (await walletConnection(userId)) !== null;
  const limits = limitsFor(connected ? "connected" : "free", config().SELF_HOSTED);
  return db().transaction(async (tx) => {
    if (limits?.projects != null) {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
      const existing = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.userId, userId));
      if (existing.length >= limits.projects) {
        throw new Error(`This tier allows ${limits.projects} projects. Connect a wallet for more.`);
      }
    }
    const rows = await tx.insert(projects).values({ userId, name, url }).returning();
    return rows[0];
  });
}

/** One project, only when it belongs to the caller. */
export async function projectForUser(userId: string, projectId: string): Promise<Project | null> {
  const rows = await db()
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.id, projectId)));
  return rows[0] ?? null;
}

/** The project the screen is showing: the one asked for, else the first. */
export async function activeProject(userId: string, requested?: string): Promise<Project | null> {
  const all = await listProjects(userId);
  return all.find((project) => project.id === requested) ?? all[0] ?? null;
}
