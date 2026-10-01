import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiCaller } from "@/lib/api/auth";
import { me, publicLimits } from "@/lib/api/handlers";
import { DEFAULT_LIMIT, MAX_LIMIT, STATUSES } from "@/lib/api/leadsQuery";
import type { ApiLead } from "@/lib/api/leadsRead";
import { TOOLS } from "@/lib/api/mcpTools";
import type {
  ApiPainTheme,
  ApiProject,
  ApiProjectDetail,
  ApiSeoOpportunity,
  ApiUsage,
} from "@/lib/api/resources";
import { NO_FILTERS } from "@/lib/leadFilters";
import { TIERS } from "@/lib/tiers";

vi.mock("@/lib/api/limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/limit")>()),
  requestsToday: async () => 7,
}));

/**
 * public/openapi.json is written by hand, and it went three weeks describing
 * tier limits that no longer existed, a status list missing two statuses and a
 * project without its filters. These hold it to what /api/v1 returns: every
 * property each response carries, no property it does not, and the statuses and
 * page size the leads call reads. MCP's list_leads is held to the same lists.
 *
 * The constructed responses below are typed as the API's own types, so a field
 * added to one fails the typecheck here until it is added to the literal, and
 * then this test until it is added to the spec.
 */

type Schema = {
  properties: Record<string, Schema & { enum?: string[]; maximum?: number; default?: unknown }>;
  required?: string[];
  allOf?: Schema[];
};
type Parameter = { name: string; schema: { enum?: string[]; maximum?: number; default?: unknown } };

const spec = JSON.parse(readFileSync("public/openapi.json", "utf8")) as {
  paths: Record<string, { get: { parameters?: Parameter[] } }>;
  components: { schemas: Record<string, Schema> };
};
const schemas = spec.components.schemas;

const sorted = (names: Iterable<string>) => [...names].sort();
const propertiesOf = (schema: Schema) => sorted(Object.keys(schema.properties));
const requiredOf = (schema: Schema) => sorted(schema.required ?? []);
const keysOf = (value: object) => sorted(Object.keys(value));

function leadsParameter(name: string): Parameter {
  const found = spec.paths["/projects/{id}/leads"].get.parameters?.find((one) => one.name === name);
  if (!found) {
    throw new Error(`The leads call publishes no ${name} parameter`);
  }
  return found;
}

const caller = {
  user: { id: "u1", email: null, createdAt: new Date(0) },
  keyId: "00000000-0000-0000-0000-000000000000",
  keyPrefix: "rl_sk_test",
  scopes: [],
  tier: "connected",
  limits: TIERS.connected,
  selfHosted: false,
} as unknown as ApiCaller;

describe("the leads call's filters", () => {
  it("publishes every status the call reads, and every status a lead holds", () => {
    expect(leadsParameter("status").schema.enum).toEqual([...STATUSES]);
    expect(schemas.Lead.properties.status.enum).toEqual(STATUSES.filter((status) => status !== "all"));
  });

  it("publishes the page size the call reads", () => {
    expect(leadsParameter("limit").schema).toMatchObject({ maximum: MAX_LIMIT, default: DEFAULT_LIMIT });
  });

  it("gives MCP's list_leads the same statuses and page size", () => {
    const listLeads = TOOLS.find((tool) => tool.name === "list_leads");
    const properties = listLeads?.inputSchema.properties as Record<string, { enum?: string[]; maximum?: number }>;
    expect(properties.status.enum).toEqual([...STATUSES]);
    expect(properties.limit.maximum).toBe(MAX_LIMIT);
  });
});

describe("TierLimits", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://reddit_leads@localhost:5433/reddit_leads");
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
    vi.stubEnv("X_LEADS_USERS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("names every limit a tier has, and requires all but X's", () => {
    for (const limits of Object.values(TIERS)) {
      expect(propertiesOf(schemas.TierLimits)).toEqual(keysOf(limits));
    }
    expect(requiredOf(schemas.TierLimits)).toEqual(keysOf(TIERS.connected).filter((key) => key !== "x"));
    expect(propertiesOf(schemas.XLimits)).toEqual(keysOf(TIERS.connected.x));
    expect(requiredOf(schemas.XLimits)).toEqual(keysOf(TIERS.connected.x));
  });

  it("names every paid button, and requires all but X's", () => {
    const actions = schemas.TierLimits.properties.actions;
    expect(propertiesOf(actions)).toEqual(keysOf(TIERS.connected.actions));
    expect(propertiesOf(actions.properties.presses)).toEqual(keysOf(TIERS.connected.actions.presses));
    expect(requiredOf(actions.properties.presses)).toEqual(
      keysOf(TIERS.connected.actions.presses).filter((key) => key !== "x_scan_now"),
    );
  });

  it("matches what /me shows with X off and with X on", () => {
    vi.stubEnv("X_LEADS", "false");
    const off = publicLimits(caller) as Record<string, unknown> & { actions: { presses: object } };
    expect(keysOf(off)).toEqual(requiredOf(schemas.TierLimits));
    expect(keysOf(off.actions.presses)).toEqual(requiredOf(schemas.TierLimits.properties.actions.properties.presses));

    vi.stubEnv("X_LEADS", "true");
    const on = publicLimits(caller) as Record<string, unknown> & { actions: { presses: object } };
    expect(keysOf(on)).toEqual(propertiesOf(schemas.TierLimits));
    expect(keysOf(on.actions.presses)).toEqual(propertiesOf(schemas.TierLimits.properties.actions.properties.presses));
  });

  it("describes /me as it answers", async () => {
    vi.stubEnv("X_LEADS", "false");
    const answer = await me(caller);
    expect(keysOf(answer)).toEqual(propertiesOf(schemas.Me));
    expect(requiredOf(schemas.Me)).toEqual(propertiesOf(schemas.Me));
    expect(keysOf(answer.user)).toEqual(propertiesOf(schemas.Me.properties.user));
    expect(keysOf(answer.key)).toEqual(propertiesOf(schemas.Me.properties.key));
  });
});

describe("the resources", () => {
  const project: ApiProject = {
    id: "p1",
    name: "Formcraft",
    url: null,
    pain: null,
    solution: null,
    targetUsers: null,
    geography: null,
    budgetFit: null,
    scoreThreshold: null,
    leadFilters: NO_FILTERS,
    createdAt: new Date(0).toISOString(),
    newLeads: 0,
  };

  it("describes a project as the API builds one, every field always present", () => {
    expect(propertiesOf(schemas.Project)).toEqual(keysOf(project));
    expect(requiredOf(schemas.Project)).toEqual(keysOf(project));
    expect(propertiesOf(schemas.LeadFilters)).toEqual(keysOf(NO_FILTERS));
    expect(requiredOf(schemas.LeadFilters)).toEqual(keysOf(NO_FILTERS));
  });

  it("describes what a project's detail adds", () => {
    const detail: ApiProjectDetail = { ...project, keywords: [], subreddits: [], competitors: [] };
    const added = schemas.ProjectDetail.allOf?.[1] as Schema;
    expect(propertiesOf(added)).toEqual(keysOf(detail).filter((key) => !(key in project)));
  });

  it("describes a lead as the API builds one, its body only on request", () => {
    const lead: Required<ApiLead> = {
      id: "l1",
      postId: null,
      commentId: null,
      title: "",
      subreddit: "",
      author: null,
      url: "",
      score: 0,
      stage: null,
      reason: null,
      matchedPhrase: null,
      sellerSide: false,
      status: "new",
      postedAt: "",
      scoredAt: "",
      costUsd: null,
      body: null,
    };
    expect(propertiesOf(schemas.Lead)).toEqual(keysOf(lead));
    expect(requiredOf(schemas.Lead)).toEqual(keysOf(lead).filter((key) => key !== "body"));
  });

  it("describes SEO opportunities, pain themes and usage as the API builds them", () => {
    const opportunity: ApiSeoOpportunity = {
      id: "s1",
      keyword: "",
      position: null,
      competitorPresent: false,
      refreshedAt: "",
      post: null,
    };
    const theme: ApiPainTheme = { id: "t1", label: "", summary: null, leadIds: [], generatedAt: "" };
    const usage: ApiUsage = { calls: 0, costUsd: 0, fetched: 0, reused: 0, perApi: [] };
    const perApi: ApiUsage["perApi"][number] = { api: "", calls: 0, costUsd: 0, reused: 0 };
    for (const [name, value] of [
      ["SeoOpportunity", opportunity],
      ["PainTheme", theme],
      ["Usage", usage],
    ] as const) {
      expect(propertiesOf(schemas[name]), name).toEqual(keysOf(value));
      expect(requiredOf(schemas[name]), name).toEqual(keysOf(value));
    }
    const perApiSchema = (schemas.Usage.properties.perApi as unknown as { items: Schema }).items;
    expect(propertiesOf(perApiSchema)).toEqual(keysOf(perApi));
  });
});
