import { Suspense } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PlanSections } from "@/components/product/PlanSections";
import { ListSkeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { requireLocalUser } from "@/lib/auth";
import { activeProject } from "@/lib/projects";

type SourcesPageProps = { searchParams: Promise<{ project?: string }> };

/**
 * Where a scan looks: the searches, the communities and the competitors that
 * discovery wrote, apart from the product page, which is what the scorer is told.
 */
export default async function SourcesPage({ searchParams }: SourcesPageProps) {
  const user = await requireLocalUser();
  const project = await activeProject(user.id, (await searchParams).project);

  if (!project) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <EmptyState
          title="Sources"
          sentence="The searches and communities we scan appear here once a project has been analysed."
        />
        <Button
          size="lg"
          nativeButton={false}
          className="self-start"
          render={<Link href="/app/projects/new">New project</Link>}
        />
      </div>
    );
  }

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
