"use server";

import { revalidatePath } from "next/cache";
import { enqueueJob } from "@/jobs/enqueue";
import { requireLocalUser } from "@/lib/auth";
import { projectForUser } from "@/lib/projects";
import { startOnOpen } from "@/lib/startOnOpen";

/** The tab's first scan, which nothing else books. */
export async function openCompetitorsAction(projectId: string) {
  if (await startOnOpen("competitor_scan", projectId)) {
    revalidatePath("/app", "layout");
  }
}

/** Queues a look at what Reddit said about this project's competitors this week. */
export async function scanCompetitorsAction(projectId: string) {
  const user = await requireLocalUser();
  if (!(await projectForUser(user.id, projectId))) {
    throw new Error("That project is not yours");
  }
  await enqueueJob("competitor_scan", projectId);
  revalidatePath("/app/competitors");
}
