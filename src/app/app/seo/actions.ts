"use server";

import { revalidatePath } from "next/cache";
import { requireLocalUser } from "@/lib/auth";
import { projectForUser } from "@/lib/projects";
import { pressForJob } from "@/lib/throttle";
import { startOnOpen } from "@/lib/startOnOpen";

/** The tab's first refresh, which nothing else books. */
export async function openSeoAction(projectId: string) {
  if (await startOnOpen("seo_refresh", projectId)) {
    revalidatePath("/app", "layout");
  }
}

/** Queues a Reddit SEO refresh, replacing any refresh that has not started. */
export async function refreshSeoAction(projectId: string) {
  const user = await requireLocalUser();
  if (!(await projectForUser(user.id, projectId))) {
    throw new Error("That project is not yours");
  }
  await pressForJob(user.id, "seo_refresh", "seo_refresh", projectId);
  revalidatePath("/app", "layout");
}
