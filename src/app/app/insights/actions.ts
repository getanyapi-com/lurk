"use server";

import { revalidatePath } from "next/cache";
import { requireLocalUser } from "@/lib/auth";
import { projectForUser } from "@/lib/projects";
import { pressForJob } from "@/lib/throttle";

/** Queues a fresh grouping of this project's leads, replacing any queued one. */
export async function refreshInsightsAction(projectId: string) {
  const user = await requireLocalUser();
  if (!(await projectForUser(user.id, projectId))) {
    throw new Error("That project is not yours");
  }
  await pressForJob(user.id, "insights", "insights", projectId);
  revalidatePath("/app/insights");
}
