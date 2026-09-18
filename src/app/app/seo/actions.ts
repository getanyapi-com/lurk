"use server";

import { revalidatePath } from "next/cache";
import { enqueueJob } from "@/jobs/enqueue";
import { requireLocalUser } from "@/lib/auth";
import { projectForUser } from "@/lib/projects";
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
  await enqueueJob("seo_refresh", projectId);
  revalidatePath("/app", "layout");
}
