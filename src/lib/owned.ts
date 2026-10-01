import { requireLocalUser, type LocalUser } from "@/lib/auth";
import { projectForUser, type Project } from "@/lib/projects";
import { xEnabledFor } from "@/lib/x/enabled";

type Owned = { user: LocalUser; project: Project };

async function owned(user: LocalUser, projectId: string): Promise<Owned> {
  const project = await projectForUser(user.id, projectId);
  if (!project) {
    throw new Error("That project is not yours");
  }
  return { user, project };
}

/**
 * The caller and one of their projects, for a server action or start-on-open
 * that was handed a project id. An id that is not the caller's is refused
 * before anything is read or written for it. This lives apart from projects.ts
 * because jobs and the API import that, and neither has a signed-in caller.
 */
export async function requireOwnedProject(projectId: string): Promise<Owned> {
  return owned(await requireLocalUser(), projectId);
}

/**
 * The same for an X action, once X is on for the caller. It is here rather
 * than beside xEnabledFor because jobs and the API import that file too.
 */
export async function requireXProject(projectId: string): Promise<Owned> {
  const user = await requireLocalUser();
  if (!xEnabledFor(user.id)) {
    throw new Error("X leads is not turned on");
  }
  return owned(user, projectId);
}
