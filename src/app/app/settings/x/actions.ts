"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { xProjects } from "@/db/schema";
import { requireLocalUser } from "@/lib/auth";
import { projectForUser } from "@/lib/projects";
import { xEnabledFor } from "@/lib/x/enabled";

/**
 * Whether the project's alert channels carry its X asks. A project X has not
 * started for has no row, and nothing to send, so this changes nothing there.
 */
export async function setXAlertsAction(projectId: string, on: boolean) {
  const user = await requireLocalUser();
  if (!xEnabledFor(user.id)) {
    throw new Error("X leads is not turned on");
  }
  if (!(await projectForUser(user.id, projectId))) {
    throw new Error("That project is not yours");
  }
  await db().update(xProjects).set({ alerts: on }).where(eq(xProjects.projectId, projectId));
  revalidatePath("/app/settings/x");
}
