"use server";

import { revalidatePath } from "next/cache";
import { enqueueJob } from "@/jobs/enqueue";
import { requireLocalUser } from "@/lib/auth";
import { projectForUser } from "@/lib/projects";
import { manualScanOpensAt } from "@/lib/scan/manual";

/** Queues a scan for one of the caller's projects, replacing any queued scan. */
export async function scanNowAction(projectId: string) {
  const user = await requireLocalUser();
  if (!(await projectForUser(user.id, projectId))) {
    throw new Error("That project is not yours");
  }
  // The button is disabled while this holds, so only a stale page gets here.
  if (await manualScanOpensAt(user.id, projectId)) {
    throw new Error("Today's Scan now is used. Connect a wallet to scan as often as you like.");
  }
  await enqueueJob("scan", projectId, new Date(), true);
  revalidatePath("/app", "layout");
}
