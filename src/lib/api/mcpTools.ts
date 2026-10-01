import type { ApiCaller } from "./auth";
import { agentGuide } from "./guide";
import {
  lead,
  projectLeads,
  projectPainThemes,
  projectSeoOpportunities,
  projectUsage,
  projects,
} from "./handlers";
import { MAX_LIMIT, STATUSES } from "./leadsQuery";
import { ApiError } from "./responses";

type JsonSchema = { type: "object"; properties: Record<string, unknown>; required?: string[] };

export type McpTool = { name: string; description: string; inputSchema: JsonSchema };

type ToolArgs = Record<string, unknown>;

/** A tool as this server holds it: what tools/list shows, and the call that answers it. */
type ToolEntry = McpTool & { run: (caller: ApiCaller, args: ToolArgs) => Promise<string> };

const projectArg = {
  type: "object",
  properties: { projectId: { type: "string", description: "Project id from list_projects." } },
  required: ["projectId"],
} satisfies JsonSchema;

const SCORE_NOTE =
  "The score is a sort order for a human's attention, not a probability that the person will buy.";

const SOURCE_NOTE =
  "Leads are scored output over Reddit posts and comments this app bought per call from AnyAPI, not raw Reddit access.";

function stringArg(args: ToolArgs, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value === "") {
    throw new ApiError("invalid_request", `${name} is required.`);
  }
  return value;
}

function leadParams(args: ToolArgs): URLSearchParams {
  const params = new URLSearchParams();
  for (const name of ["status", "minScore", "since", "limit", "offset"]) {
    const value = args[name];
    if (value !== undefined && value !== null) {
      params.set(name, String(value));
    }
  }
  if (args.includeBody === true) {
    params.set("include", "body");
  }
  return params;
}

/** A handler's answer as the text an MCP client receives. */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Every tool, each with the call that answers it, so the list a client is
 * shown and the calls this server answers cannot name different tools.
 */
const ENTRIES: ToolEntry[] = [
  {
    name: "list_projects",
    description: `Every project on this account, with how many leads are waiting in each. ${SOURCE_NOTE}`,
    inputSchema: { type: "object", properties: {} },
    run: async (caller) => json(await projects(caller)),
  },
  {
    name: "list_leads",
    description: `One page of a project's leads, highest score first, each with the reason it was scored, the phrase that matched, and what its Reddit data cost in USD. ${SOURCE_NOTE} ${SCORE_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project id from list_projects." },
        status: {
          type: "string",
          enum: [...STATUSES],
          description: "Defaults to new, which is the untriaged queue.",
        },
        minScore: { type: "integer", minimum: 0, maximum: 100 },
        since: {
          type: "string",
          description: "ISO 8601. Only leads scored after this moment, for incremental syncs.",
        },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
        offset: { type: "integer", minimum: 0 },
        includeBody: { type: "boolean", description: "Return the full post or comment text." },
      },
      required: ["projectId"],
    },
    run: async (caller, args) => json(await projectLeads(caller, stringArg(args, "projectId"), leadParams(args))),
  },
  {
    name: "get_lead",
    description: `One lead with its full text, its written reason and its data cost. ${SCORE_NOTE}`,
    inputSchema: {
      type: "object",
      properties: { leadId: { type: "string", description: "Lead id from list_leads." } },
      required: ["leadId"],
    },
    run: async (caller, args) => json(await lead(caller, stringArg(args, "leadId"))),
  },
  {
    name: "list_seo_opportunities",
    description:
      "Reddit threads already ranking on Google for this project's keywords, best position first, flagged when a competitor is named in the thread.",
    inputSchema: projectArg,
    run: async (caller, args) => json(await projectSeoOpportunities(caller, stringArg(args, "projectId"))),
  },
  {
    name: "list_pain_themes",
    description:
      "What this project's leads keep complaining about, clustered from leads already stored. No new data is bought to answer this.",
    inputSchema: projectArg,
    run: async (caller, args) => json(await projectPainThemes(caller, stringArg(args, "projectId"))),
  },
  {
    name: "get_usage",
    description:
      "Today's AnyAPI spend for one project: calls, USD, and how many were served from data another project already paid for.",
    inputSchema: projectArg,
    run: async (caller, args) => json(await projectUsage(caller, stringArg(args, "projectId"))),
  },
  {
    name: "describe",
    description: "The agent guide for this product: what a lead is, how to triage one, and what it cost.",
    inputSchema: { type: "object", properties: {} },
    run: () => agentGuide(),
  },
];

/** What tools/list shows: each tool without the call that answers it. */
export const TOOLS: McpTool[] = ENTRIES.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

/** Runs one tool and returns the text an MCP client receives. */
export async function callTool(caller: ApiCaller, name: string, args: ToolArgs): Promise<string> {
  const entry = ENTRIES.find((one) => one.name === name);
  if (!entry) {
    throw new ApiError("not_found", `No tool named ${name}.`);
  }
  return entry.run(caller, args);
}
