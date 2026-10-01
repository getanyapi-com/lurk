import { writeProgress } from "@/jobs/enqueue";
import { clusterLeads, clusterableLeads, replaceThemes } from "@/lib/insights/themes";

export type InsightsOutcome = { leads: number; themes: number };

/**
 * Groups a project's recent leads into pain themes. Reads only rows the scan
 * already paid for, so this job spends nothing on AnyAPI.
 */
export async function runInsights(projectId: string, jobId: string): Promise<InsightsOutcome> {
  const items = await clusterableLeads(projectId);
  if (items.length === 0) {
    await replaceThemes(projectId, []);
    await writeProgress(jobId, "No leads to group yet");
    return { leads: 0, themes: 0 };
  }
  await writeProgress(jobId, `Grouping ${items.length} leads`);
  const themes = await clusterLeads(projectId, items);
  await replaceThemes(projectId, themes);
  await writeProgress(jobId, "Finished");
  return { leads: items.length, themes: themes.length };
}
