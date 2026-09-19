import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "@/lib/config";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

/*
 * Next bundles this module once per layer - server components, server actions,
 * route handlers, instrumentation - so a module-level cache gave one process a
 * pool per bundle. The global is shared by all of them.
 */
const holder = globalThis as typeof globalThis & { __lurkDb?: Db };

/**
 * One pooled Drizzle client for the process. The server takes 50 connections
 * and a deploy briefly runs two revisions, so the pool is small and lets idle
 * connections go.
 */
export function db() {
  if (!holder.__lurkDb) {
    const sql = postgres(config().DATABASE_URL, { max: 10, idle_timeout: 30 });
    holder.__lurkDb = drizzle(sql, { schema });
  }
  return holder.__lurkDb;
}
