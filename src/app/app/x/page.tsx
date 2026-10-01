import { notFound } from "next/navigation";
import { XTab, type XParams } from "@/components/x/XTab";
import { requireLocalUser } from "@/lib/auth";
import { requireActiveProject } from "@/lib/projects";
import { xEnabledFor } from "@/lib/x/enabled";

type XPageProps = { searchParams: Promise<XParams> };

/** The X tab: a 404 unless X leads is on for this user, then the project's X leads. */
export default async function XPage({ searchParams }: XPageProps) {
  const user = await requireLocalUser();
  if (!xEnabledFor(user.id)) {
    notFound();
  }
  const params = await searchParams;
  const project = await requireActiveProject(user.id, params.project);
  return <XTab userId={user.id} project={project} params={params} />;
}
