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
import { ApiError } from "./responses";

type JsonSchema = { type: "object"; properties: Record<string, unknown>; required?: string[] };

export type McpTool = { name: string; description: string; inputSchema: JsonSchema };

const projectArg = {
  type: "object",
  properties: { projectId: { type: "string", description: "Project id from list_projects." } },
  required: ["projectId"],
} satisfies JsonSchema;

const SCORE_NOTE =
  "The score is a sort order for a human's attention, not a probability that the person will buy.";

const SOURCE_NOTE =
  "Leads are scored output over Reddit posts and comments this app bought per call from AnyAPI, not raw Reddit access.";

export const TOOLS: McpTool[] = [
  {
    name: "list_projects",
    description: `Every project on this account, with how many leads are waiting in each. ${SOURCE_NOTE}`,
    inputSchema: { type: "object", properties: {} },
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
          enum: ["new", "replied", "hidden", "not_fit", "all"],
          description: "Defaults to new, which is the untriaged queue.",
        },
        minScore: { type: "integer", minimum: 0, maximum: 100 },
        since: {
          type: "string",
          description: "ISO 8601. Only leads scored after this moment, for incremental syncs.",
        },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        offset: { type: "integer", minimum: 0 },
        includeBody: { type: "boolean", description: "Return the full post or comment text." },
      },
      required: ["projectId"],
    },
  },
  {
    name: "get_lead",
    description: `One lead with its full text, its written reason and its data cost. ${SCORE_NOTE}`,
    inputSchema: {
      type: "object",
      properties: { leadId: { type: "string", description: "Lead id from list_leads." } },
      required: ["leadId"],
    },
  },
  {
    name: "list_seo_opportunities",
    description:
      "Reddit threads already ranking on Google for this project's keywords, best position first, flagged when a competitor is named in the thread.",
    inputSchema: projectArg,
  },
  {
    name: "list_pain_themes",
    description:
      "What this project's leads keep complaining about, clustered from leads already stored. No new data is bought to answer this.",
    inputSchema: projectArg,
  },
  {
    name: "get_usage",
    description:
      "Today's AnyAPI spend for one project: calls, USD, and how many were served from data another project already paid for.",
    inputSchema: projectArg,
  },
  {
    name: "describe",
    description: "The agent guide for this product: what a lead is, how to triage one, and what it cost.",
    inputSchema: { type: "object", properties: {} },
  },
];

function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value === "") {
    throw new ApiError("invalid_request", `${name} is required.`);
  }
  return value;
}

function leadParams(args: Record<string, unknown>): URLSearchParams {
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

/** Runs one tool and returns the text an MCP client receives. */
export async function callTool(
  caller: ApiCaller,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === "describe") {
    return agentGuide();
  }
  if (name === "list_projects") {
    return JSON.stringify(await projects(caller), null, 2);
  }
  if (name === "list_leads") {
    const projectId = stringArg(args, "projectId");
    return JSON.stringify(await projectLeads(caller, projectId, leadParams(args)), null, 2);
  }
  if (name === "get_lead") {
    return JSON.stringify(await lead(caller, stringArg(args, "leadId")), null, 2);
  }
  if (name === "list_seo_opportunities") {
    return JSON.stringify(await projectSeoOpportunities(caller, stringArg(args, "projectId")), null, 2);
  }
  if (name === "list_pain_themes") {
    return JSON.stringify(await projectPainThemes(caller, stringArg(args, "projectId")), null, 2);
  }
  if (name === "get_usage") {
    return JSON.stringify(await projectUsage(caller, stringArg(args, "projectId")), null, 2);
  }
  throw new ApiError("not_found", `No tool named ${name}.`);
}
