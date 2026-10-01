import { Suspense } from "react";
import { PlanSections } from "@/components/product/PlanSections";
import { ListSkeleton } from "@/components/Skeleton";
import { requireLocalUser } from "@/lib/auth";
import { requireActiveProject } from "@/lib/projects";

type SourcesPageProps = { searchParams: Promise<{ project?: string }> };

/**
 * Where a scan looks: the searches, the communities and the competitors that
 * discovery wrote, apart from the product page, which is what the scorer is told.
 */
export default async function SourcesPage({ searchParams }: SourcesPageProps) {
  const user = await requireLocalUser();
  const project = await requireActiveProject(user.id, (await searchParams).project);


  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2" style={{ fontWeight: 500 }}>
          Sources
        </h1>
        <p className="text-body text-fg-muted">
          Where lurk looks for your buyers on Reddit.
        </p>
      </div>
      <Suspense fallback={<ListSkeleton rows={5} />}>
        <PlanSections projectId={project.id} userId={user.id} />
      </Suspense>
    </div>
  );
}
