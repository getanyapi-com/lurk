"use server";

import { revalidatePath } from "next/cache";
import { requireLocalUser } from "@/lib/auth";
import { toRow } from "@/components/leads/stream";
import { FEED_PAGE_SIZE, feedFilter, type FeedRow } from "@/lib/feed";
import { listLeads, setLeadStatus } from "@/lib/leads";
import { projectForUser } from "@/lib/projects";
import { sweepSnapshot, type SweepSnapshot } from "@/lib/sweep";

async function ownedProject(projectId: string) {
  const user = await requireLocalUser();
  if (!(await projectForUser(user.id, projectId))) {
    throw new Error("That project is not yours");
  }
}

/** Takes a lead out of the feed without saying anything about why. */
export async function hideLeadAction(projectId: string, leadId: string) {
  await ownedProject(projectId);
  await setLeadStatus(projectId, leadId, "hidden", null);
  revalidatePath("/app", "layout");
}

/** Records that a lead was a miss, with the reason the user picked. */
export async function markNotFitAction(projectId: string, leadId: string, formData: FormData) {
  await ownedProject(projectId);
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    throw new Error("Pick a reason before marking a lead as not a fit");
  }
  await setLeadStatus(projectId, leadId, "not_fit", reason);
  revalidatePath("/app", "layout");
}

/**
 * The next page of the feed the list is already showing, read in the same
 * order it is drawn in. The filters arrive as the query string the page is on
 * and are read back through `feedFilter`, so a caller can only ask for a feed
 * the pills can ask for.
 */
export async function moreLeadsAction(
  projectId: string,
  search: string,
  offset: number,
): Promise<FeedRow[]> {
  await ownedProject(projectId);
  const params = Object.fromEntries(new URLSearchParams(search));
  const page = { limit: FEED_PAGE_SIZE, offset: Math.max(0, Math.trunc(offset)) };
  const rows = await listLeads(projectId, feedFilter(params), page);
  return rows.map(toRow);
}

/** The first sweep as it stands, for the board that draws it while it runs. */
export async function sweepAction(projectId: string): Promise<SweepSnapshot | null> {
  await ownedProject(projectId);
  return sweepSnapshot(projectId);
}
