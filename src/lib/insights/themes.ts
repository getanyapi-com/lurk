import { and, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { leads, painThemes, redditComments, redditPosts } from "@/db/schema";
import { generateStructured } from "@/lib/llm";
import { forgetProjectFeed } from "@/lib/projectFeedCache";

/** How many leads one clustering call reads. */
export const THEME_BATCH_SIZE = 40;

/** The most themes a project is shown, so the screen stays readable. */
export const MAX_THEMES = 8;

/** The feed window, which is also the window worth clustering. */
export const INSIGHTS_WINDOW_DAYS = 30;

/**
 * Kept here rather than in the scan prompts file because it is the only prompt
 * that reads judgements the scan already wrote instead of Reddit itself.
 */
export const THEMES_SYSTEM = `You are reading sales leads one product's scan already scored on Reddit. Group them by the problem the person has, not by subreddit and not by wording. Return at most ${MAX_THEMES} groups, largest first. For each group give:
- label: three to five plain words a person would recognise, in title case.
- summary: one sentence saying what these people are struggling with and what they asked for.
- leadIds: the ids of every lead in the group, copied exactly.
Put a lead in one group only. Leave out a lead that fits nothing rather than inventing a group for it.`;

export type ThemeInput = {
  id: string;
  title: string;
  reason: string | null;
  matchedPhrase: string | null;
  stage: string | null;
};

export type Theme = { label: string; summary: string; leadIds: string[] };

const themesSchema = z.object({
  themes: z.array(
    z.object({
      label: z.string(),
      summary: z.string(),
      leadIds: z.array(z.string()),
    }),
  ),
});

function windowStart(days = INSIGHTS_WINDOW_DAYS): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** The leads worth clustering: still in the feed or hidden, inside the window. */
export async function clusterableLeads(projectId: string): Promise<ThemeInput[]> {
  const rows = await db()
    .select({
      id: leads.id,
      title: redditPosts.title,
      commentBody: redditComments.body,
      reason: leads.reason,
      matchedPhrase: leads.matchedPhrase,
      stage: leads.stage,
    })
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .leftJoin(redditComments, eq(redditComments.id, leads.commentId))
    .where(
      and(
        eq(leads.projectId, projectId),
        inArray(leads.status, ["new", "hidden"]),
        gte(leads.scoredAt, windowStart()),
      ),
    );
  return rows.map((row) => ({
    id: row.id,
    title: row.commentBody ? `Reply on: ${row.title}` : row.title,
    reason: row.reason,
    matchedPhrase: row.matchedPhrase,
    stage: row.stage,
  }));
}

function describe(item: ThemeInput): string {
  return [
    `id: ${item.id}`,
    `title: ${item.title}`,
    `stage: ${item.stage ?? "unknown"}`,
    `why it scored: ${item.reason ?? ""}`,
    `their words: ${item.matchedPhrase ?? ""}`,
  ].join(" | ");
}

/**
 * Folds every batch's groups into one set: same label means same theme, a lead
 * counts once, and only leads that were actually sent survive. Largest first,
 * trimmed to what the screen shows.
 */
export function mergeThemes(batches: Theme[][], validIds: Iterable<string>): Theme[] {
  const allowed = new Set(validIds);
  const claimed = new Set<string>();
  const byLabel = new Map<string, Theme>();
  for (const batch of batches) {
    for (const theme of batch) {
      const key = theme.label.trim().toLowerCase();
      if (!key) {
        continue;
      }
      const existing = byLabel.get(key) ?? {
        label: theme.label.trim(),
        summary: theme.summary.trim(),
        leadIds: [],
      };
      for (const id of theme.leadIds) {
        if (allowed.has(id) && !claimed.has(id)) {
          claimed.add(id);
          existing.leadIds.push(id);
        }
      }
      byLabel.set(key, existing);
    }
  }
  return [...byLabel.values()]
    .filter((theme) => theme.leadIds.length > 0)
    .sort((a, b) => b.leadIds.length - a.leadIds.length)
    .slice(0, MAX_THEMES);
}

/** One clustering call per batch of leads, then one merged set of themes. */
export async function clusterLeads(projectId: string, items: ThemeInput[]): Promise<Theme[]> {
  const batches: Theme[][] = [];
  for (let start = 0; start < items.length; start += THEME_BATCH_SIZE) {
    const batch = items.slice(start, start + THEME_BATCH_SIZE);
    const result = await generateStructured({
      purpose: "insights",
      projectId,
      schema: themesSchema,
      system: THEMES_SYSTEM,
      prompt: ["Leads:", ...batch.map(describe)].join("\n"),
    });
    batches.push(result.themes);
  }
  return mergeThemes(
    batches,
    items.map((item) => item.id),
  );
}

/** The new set replaces the old one, so a theme never outlives its leads. */
export async function replaceThemes(projectId: string, themes: Theme[]): Promise<void> {
  await db().delete(painThemes).where(eq(painThemes.projectId, projectId));
  // A theme owns the list of leads the feed shows when it is narrowed to one.
  forgetProjectFeed(projectId);
  if (themes.length === 0) {
    return;
  }
  await db()
    .insert(painThemes)
    .values(
      themes.map((theme) => ({
        projectId,
        label: theme.label,
        summary: theme.summary,
        leadIds: theme.leadIds,
        generatedAt: new Date(),
      })),
    );
}
