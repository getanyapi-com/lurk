import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  leads,
  painThemes,
  projectCompetitors,
  projectKeywords,
  projectSubreddits,
  projects,
  redditPosts,
  seoOpportunities,
} from "@/db/schema";
import { parseLeadFilters, type LeadFilters } from "@/lib/leadFilters";
import { projectForUser, type Project } from "@/lib/projects";
import { RETRIEVED_STATES } from "@/lib/scan/planStates";
import { usageToday } from "@/lib/usage";
import { ApiError } from "./responses";

export type ApiProject = {
  id: string;
  name: string;
  url: string | null;
  pain: string | null;
  solution: string | null;
  targetUsers: string | null;
  geography: string | null;
  budgetFit: string | null;
  scoreThreshold: number | null;
  /** The owner's word lists and alert floors. Like the minimum score, the app's feed and alerts apply them and the leads endpoint does not. */
  leadFilters: LeadFilters;
  createdAt: string;
  newLeads: number;
};

function base(project: Project, newLeads: number): ApiProject {
  return {
    id: project.id,
    name: project.name,
    url: project.url,
    pain: project.pain,
    solution: project.solution,
    targetUsers: project.targetUsers,
    geography: project.geography,
    budgetFit: project.budgetFit,
    scoreThreshold: project.scoreThreshold,
    leadFilters: parseLeadFilters(project.leadFilters),
    createdAt: project.createdAt.toISOString(),
    newLeads,
  };
}

/** The caller's project, or the 404 the caller should see. */
export async function requireProject(userId: string, projectId: string): Promise<Project> {
  const project = await projectForUser(userId, projectId);
  if (!project) {
    throw new ApiError("not_found", "No project with that id.");
  }
  return project;
}

export async function listApiProjects(userId: string): Promise<ApiProject[]> {
  const rows = await db()
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(asc(projects.createdAt));
  const counts = await db()
    .select({ projectId: leads.projectId, total: count() })
    .from(leads)
    .innerJoin(projects, eq(projects.id, leads.projectId))
    .where(and(eq(projects.userId, userId), eq(leads.status, "new")))
    .groupBy(leads.projectId);
  const byProject = new Map(counts.map((row) => [row.projectId, row.total]));
  return rows.map((row) => base(row, byProject.get(row.id) ?? 0));
}

export type ApiProjectDetail = ApiProject & {
  keywords: string[];
  subreddits: string[];
  competitors: string[];
};

/** One project with the plan it is reading now: a candidate or an excluded row is not listed. */
export async function getApiProject(project: Project): Promise<ApiProjectDetail> {
  const [keywords, subreddits, competitors, newLeads] = await Promise.all([
    db()
      .select()
      .from(projectKeywords)
      .where(
        and(
          eq(projectKeywords.projectId, project.id),
          inArray(projectKeywords.state, RETRIEVED_STATES),
        ),
      ),
    db()
      .select()
      .from(projectSubreddits)
      .where(
        and(
          eq(projectSubreddits.projectId, project.id),
          inArray(projectSubreddits.state, RETRIEVED_STATES),
        ),
      ),
    db()
      .select()
      .from(projectCompetitors)
      .where(
        and(
          eq(projectCompetitors.projectId, project.id),
          inArray(projectCompetitors.state, RETRIEVED_STATES),
        ),
      ),
    db()
      .select({ total: count() })
      .from(leads)
      .where(and(eq(leads.projectId, project.id), eq(leads.status, "new"))),
  ]);
  return {
    ...base(project, newLeads[0]?.total ?? 0),
    keywords: keywords.map((row) => row.keyword),
    subreddits: subreddits.map((row) => row.name),
    competitors: competitors.map((row) => row.name),
  };
}

export type ApiSeoOpportunity = {
  id: string;
  keyword: string;
  position: number | null;
  competitorPresent: boolean;
  refreshedAt: string;
  post: { id: string; title: string; subreddit: string; url: string } | null;
};

/** Reddit threads already ranking for the project's keywords, best rank first. */
export async function listApiSeoOpportunities(projectId: string): Promise<ApiSeoOpportunity[]> {
  const rows = await db()
    .select({
      id: seoOpportunities.id,
      keyword: seoOpportunities.keyword,
      position: seoOpportunities.position,
      competitorPresent: seoOpportunities.competitorPresent,
      refreshedAt: seoOpportunities.refreshedAt,
      postId: redditPosts.id,
      title: redditPosts.title,
      subreddit: redditPosts.subreddit,
      url: redditPosts.url,
    })
    .from(seoOpportunities)
    .leftJoin(redditPosts, eq(redditPosts.id, seoOpportunities.postId))
    .where(eq(seoOpportunities.projectId, projectId))
    .orderBy(asc(seoOpportunities.position));
  return rows.map((row) => ({
    id: row.id,
    keyword: row.keyword,
    position: row.position,
    competitorPresent: row.competitorPresent,
    refreshedAt: row.refreshedAt.toISOString(),
    post: row.postId
      ? { id: row.postId, title: row.title ?? "", subreddit: row.subreddit ?? "", url: row.url ?? "" }
      : null,
  }));
}

export type ApiPainTheme = {
  id: string;
  label: string;
  summary: string | null;
  leadIds: string[];
  generatedAt: string;
};

/** What the project's leads keep complaining about, newest clustering first. */
export async function listApiPainThemes(projectId: string): Promise<ApiPainTheme[]> {
  const rows = await db()
    .select()
    .from(painThemes)
    .where(eq(painThemes.projectId, projectId))
    .orderBy(desc(painThemes.generatedAt));
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    summary: row.summary,
    leadIds: row.leadIds ?? [],
    generatedAt: row.generatedAt.toISOString(),
  }));
}

export type ApiUsage = {
  calls: number;
  costUsd: number;
  fetched: number;
  reused: number;
  perApi: { api: string; calls: number; costUsd: number; reused: number }[];
};

/**
 * Today's spend for one project. The ledger names the endpoint it called; the
 * wire says "api" because that is the word a reader of this API knows.
 */
export async function projectUsageToday(projectId: string): Promise<ApiUsage> {
  const today = await usageToday([projectId]);
  return {
    calls: today.calls,
    costUsd: today.costUsd,
    fetched: today.fetched,
    reused: today.reused,
    perApi: today.perSku.map((row) => ({
      api: row.sku,
      calls: row.calls,
      costUsd: row.costUsd,
      reused: row.reused,
    })),
  };
}
