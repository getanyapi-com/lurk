"use server";

import { revalidatePath } from "next/cache";
import { requireLocalUser } from "@/lib/auth";
import { projectForUser } from "@/lib/projects";
import { pressForJob } from "@/lib/throttle";

/** Queues a scan for one of the caller's projects, replacing any queued scan. */
export async function scanNowAction(projectId: string) {
  const user = await requireLocalUser();
  if (!(await projectForUser(user.id, projectId))) {
    throw new Error("That project is not yours");
  }
  // Free has no presses at all: it scans once a day on its schedule.
  await pressForJob(user.id, "scan_now", "scan", projectId);
  revalidatePath("/app", "layout");
}
