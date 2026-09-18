/**
 * Where the database-backed tests write. Never the app's own database: a
 * dev server with RUN_SCHEDULER=true scans every project it finds, and on
 * 2026-09-17 it found 6,900 fixture projects the tests had left behind and
 * spent the whole TypeSafe balance judging them.
 *
 * TEST_DATABASE_URL wins when set. Otherwise the tests use a sibling of
 * DATABASE_URL named `<database>_test` on the same server, which the global
 * setup creates and migrates. Without either the tests skip, as before.
 */
export function testDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  if (env.TEST_DATABASE_URL) {
    return env.TEST_DATABASE_URL;
  }
  if (!env.DATABASE_URL) {
    return undefined;
  }
  const url = new URL(env.DATABASE_URL);
  const name = url.pathname.replace(/^\//, "");
  if (!name || name.endsWith("_test")) {
    return env.DATABASE_URL;
  }
  url.pathname = `/${name}_test`;
  return url.toString();
}

/** The keys a test must never be able to spend. Every model call is mocked. */
export const PAID_KEYS = [
  "OPENROUTER_API_KEY",
  "ANYAPI_HOUSE_API_KEY",
] as const;
