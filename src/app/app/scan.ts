"use server";

import { revalidatePath } from "next/cache";
import { enqueueJob } from "@/jobs/enqueue";
import { requireLocalUser } from "@/lib/auth";
import { projectForUser } from "@/lib/projects";
import { canScanNow } from "@/lib/scan/scanNow";

/** Queues a scan for one of the caller's projects, replacing any queued scan. */
export async function scanNowAction(projectId: string) {
  const user = await requireLocalUser();
  if (!(await projectForUser(user.id, projectId))) {
    throw new Error("That project is not yours");
  }
  // The button is disabled on free, so only a stale page gets here.
  if (!(await canScanNow(user.id))) {
    throw new Error("Scan now needs a connected wallet. Free scans once a day on its schedule.");
  }
  await enqueueJob("scan", projectId);
  revalidatePath("/app", "layout");
}
