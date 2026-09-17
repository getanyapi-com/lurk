import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { testDatabaseUrl } from "./testDatabase";

/**
 * Runs once before the workers start: creates the `_test` database when it
 * is missing and brings it up to date, so `npm test` needs nothing beyond the
 * .env a dev server already has.
 */
export default async function setup(): Promise<void> {
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }
  const url = testDatabaseUrl(process.env);
  if (!url || url === process.env.TEST_DATABASE_URL) {
    if (url) {
      await migrateDatabase(url);
    }
    return;
  }
  const target = new URL(url);
  const name = target.pathname.replace(/^\//, "");
  const admin = new URL(process.env.DATABASE_URL!);
  const sql = postgres(admin.toString(), { max: 1 });
  try {
    const [row] = await sql`select 1 from pg_database where datname = ${name}`;
    if (!row) {
      await sql.unsafe(`create database "${name.replaceAll('"', '""')}"`);
    }
  } finally {
    await sql.end();
  }
  await migrateDatabase(url);
}

async function migrateDatabase(url: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  } finally {
    await sql.end();
  }
}
