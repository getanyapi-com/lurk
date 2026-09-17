import { existsSync } from "node:fs";
import { PAID_KEYS, testDatabaseUrl } from "./testDatabase";

/**
 * The database-backed tests read DATABASE_URL, which lives in .env like every
 * other local secret. Without this they silently skip on a machine that has a
 * database, which is the same as not having written them.
 *
 * .env also holds the app's own database and its paid model keys, so both are
 * swapped out before any test imports the app: the tests write to a `_test`
 * database (tests/testDatabase.ts) and see no key that could be billed.
 */
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}
const url = testDatabaseUrl(process.env);
if (url) {
  process.env.DATABASE_URL = url;
}
for (const key of PAID_KEYS) {
  delete process.env[key];
}
process.env.RUN_SCHEDULER = "false";
