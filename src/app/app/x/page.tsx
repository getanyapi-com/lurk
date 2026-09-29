import { notFound } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { XTab, type XParams } from "@/components/x/XTab";
import { requireLocalUser } from "@/lib/auth";
import { activeProject } from "@/lib/projects";
import { xEnabledFor } from "@/lib/x/enabled";

type XPageProps = { searchParams: Promise<XParams> };

/** The X tab: a 404 unless X leads is on for this user, then the project's X leads. */
export default async function XPage({ searchParams }: XPageProps) {
  const user = await requireLocalUser();
  if (!xEnabledFor(user.id)) {
    notFound();
  }
  const params = await searchParams;
  const project = await activeProject(user.id, params.project);
  if (!project) {
    return <EmptyState title="X leads" sentence="Create a project first, then lurk can watch X for people leaving your competitors." />;
  }
  return <XTab userId={user.id} project={project} params={params} />;
}
