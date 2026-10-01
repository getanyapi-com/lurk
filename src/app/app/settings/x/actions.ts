"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { xProjects } from "@/db/schema";
import { requireXProject } from "@/lib/owned";

/**
 * Whether the project's alert channels carry its X asks. A project X has not
 * started for has no row, and nothing to send, so this changes nothing there.
 */
export async function setXAlertsAction(projectId: string, on: boolean) {
  await requireXProject(projectId);
  await db().update(xProjects).set({ alerts: on }).where(eq(xProjects.projectId, projectId));
  revalidatePath("/app/settings/x");
}
