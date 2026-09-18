"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { enqueueJob } from "@/jobs/enqueue";
import { kickScheduler } from "@/jobs/scheduler";
import { requireLocalUser } from "@/lib/auth";
import { createProject } from "@/lib/projects";

export type NewProjectState = { error: string | null };

function sentence(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * The name the project carries until the page read names it: the host, less
 * its "www.", so a broken read still leaves a project the switcher can show.
 */
function nameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Creates the project and hands everything else to a job, then opens the leads
 * page, where the work is drawn as it happens. Nothing is read inside the
 * request: the page read alone held the form for 28 seconds, and the profile it
 * produced is not what a person who just pasted a URL came to look at.
 */
export async function createProjectAndProfileAction(
  _previous: NewProjectState,
  formData: FormData,
): Promise<NewProjectState> {
  const user = await requireLocalUser();
  const url = String(formData.get("url") ?? "").trim();
  if (!url) {
    return { error: "A product URL is needed before we can read your site." };
  }
  // The field is plain text with the scheme drawn beside it, so the browser
  // no longer refuses an address that is not one.
  if (!URL.canParse(url) || !new URL(url).hostname.includes(".")) {
    return { error: "That does not look like a web address. Try something like yourproduct.com." };
  }
  const name = nameFromUrl(url);

  let projectId: string;
  try {
    const project = await createProject(user.id, name, url);
    if (!project) {
      return { error: "The project could not be created." };
    }
    projectId = project.id;
  } catch (error) {
    return { error: sentence(error) };
  }

  try {
    await enqueueJob("discovery_initial", projectId);
    kickScheduler();
  } catch (error) {
    return { error: `${name} was created but its setup could not be queued: ${sentence(error)}` };
  }

  revalidatePath("/app", "layout");
  redirect(`/app/leads?project=${projectId}`);
}
