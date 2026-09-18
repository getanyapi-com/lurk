import { randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { displayPrefix, generateApiKey, hashApiKey, KEY_PREFIX, PREFIX_LENGTH } from "@/lib/api/keys";
import { DEFAULT_LIMIT, MAX_LIMIT, leadConditions, parseLeadQuery } from "@/lib/api/leadsQuery";
import { secondsUntilReset, utcDay } from "@/lib/api/limit";
import { ApiError } from "@/lib/api/responses";

describe("api key hashing", () => {
  it("mints a recognizable key and keeps only its hash", () => {
    const key = generateApiKey();
    expect(key.startsWith(KEY_PREFIX)).toBe(true);
    expect(key.length).toBeGreaterThan(PREFIX_LENGTH);
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key)).not.toContain(key);
  });

  it("hashes the same key the same way and a different key differently", () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).not.toBe(hashApiKey(generateApiKey()));
  });

  it("shows exactly the first twelve characters", () => {
    const key = generateApiKey();
    expect(displayPrefix(key)).toHaveLength(PREFIX_LENGTH);
    expect(key.startsWith(displayPrefix(key))).toBe(true);
  });
});

describe("daily counter arithmetic", () => {
  it("counts a request against the UTC day, not the local one", () => {
    expect(utcDay(new Date("2026-09-05T23:30:00Z"))).toBe("2026-09-05");
    expect(utcDay(new Date("2026-09-06T00:30:00Z"))).toBe("2026-09-06");
  });

  it("retries after the seconds left until UTC midnight", () => {
    expect(secondsUntilReset(new Date("2026-09-05T23:00:00Z"))).toBe(3600);
    expect(secondsUntilReset(new Date("2026-09-05T00:00:00Z"))).toBe(86400);
  });
});

describe("leads filter query builder", () => {
  const parse = (query: string) => parseLeadQuery(new URLSearchParams(query));

  it("defaults to the untriaged queue and one page", () => {
    expect(parse("")).toMatchObject({
      status: "new",
      minScore: null,
      since: null,
      limit: DEFAULT_LIMIT,
      offset: 0,
      includeBody: false,
    });
  });

  it("reads every filter the API publishes", () => {
    const query = parse("status=all&minScore=70&since=2026-09-01T00:00:00Z&limit=10&offset=20&include=body");
    expect(query.status).toBe("all");
    expect(query.minScore).toBe(70);
    expect(query.since?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(query).toMatchObject({ limit: 10, offset: 20, includeBody: true });
  });

  it("refuses what it cannot read exactly", () => {
    expect(() => parse("status=deleted")).toThrow(ApiError);
    expect(() => parse("minScore=101")).toThrow(ApiError);
    expect(() => parse("minScore=high")).toThrow(ApiError);
    expect(() => parse("since=yesterday")).toThrow(ApiError);
    expect(() => parse(`limit=${MAX_LIMIT + 1}`)).toThrow(ApiError);
    expect(() => parse("offset=-1")).toThrow(ApiError);
  });

  const compile = (query: string) =>
    new PgDialect().sqlToQuery(leadConditions("project-1", parse(query), 30)!);

  it("filters by project, status and the feed window by default", () => {
    const { sql, params } = compile("");
    expect(sql).toContain('"leads"."project_id" = $1');
    expect(sql).toContain('"leads"."status" = $2');
    expect(sql).toContain(
      'coalesce("reddit_comments"."created_at", "reddit_posts"."created_at") >=',
    );
    expect(params[0]).toBe("project-1");
    expect(params[1]).toBe("new");
  });

  it("drops the status condition for status=all", () => {
    expect(compile("status=all").sql).not.toContain('"leads"."status"');
  });

  it("adds a score floor and asks scored_at, not created_at, for since", () => {
    const { sql } = compile("minScore=80&since=2026-09-01T00:00:00Z");
    expect(sql).toContain('"leads"."score" >=');
    expect(sql).toContain('"leads"."scored_at" >=');
  });
});

/**
 * Storage is proven against a real database, because the lookup is a hash match
 * and the counter is an upsert; neither has anything to say in isolation. Skips
 * when DATABASE_URL is absent, like the other database-backed test here.
 */
describe.skipIf(!process.env.DATABASE_URL)("api keys and the counter against a database", () => {
  it("finds a key by its hash, and nothing by a wrong one", async () => {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    const { db } = await import("@/db");
    const { users } = await import("@/db/schema");
    const { createApiKey, findApiKey, listApiKeys, revokeApiKey } = await import("@/lib/api/keys");

    const [user] = await db()
      .insert(users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const { key, id } = await createApiKey(user.id, "Test key");

    const found = await findApiKey(key);
    expect(found?.id).toBe(id);
    expect(found?.prefix).toBe(displayPrefix(key));
    expect(await findApiKey(generateApiKey())).toBeNull();
    expect(await findApiKey("not-a-key")).toBeNull();

    const listed = await listApiKeys(user.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: "Test key", scopes: ["read"] });

    await revokeApiKey(user.id, id);
    expect(await findApiKey(key)).toBeNull();
  });

  it("counts requests per key per day and refuses the one over the limit", async () => {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    const { db } = await import("@/db");
    const { users } = await import("@/db/schema");
    const { createApiKey } = await import("@/lib/api/keys");
    const { consumeDailyRequest, requestsToday } = await import("@/lib/api/limit");

    const [user] = await db()
      .insert(users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const { id } = await createApiKey(user.id, "Counter key");

    expect(await requestsToday(id)).toBe(0);
    expect((await consumeDailyRequest(id, 2)).allowed).toBe(true);
    expect((await consumeDailyRequest(id, 2)).allowed).toBe(true);
    const third = await consumeDailyRequest(id, 2);
    expect(third.allowed).toBe(false);
    expect(third.used).toBe(3);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    expect(await requestsToday(id)).toBe(3);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect((await consumeDailyRequest(id, 2, yesterday)).allowed).toBe(true);

    const uncapped = await consumeDailyRequest(id, null);
    expect(uncapped.allowed).toBe(true);
    expect(uncapped.limit).toBeNull();
    expect(uncapped.used).toBe(4);
  });
});
