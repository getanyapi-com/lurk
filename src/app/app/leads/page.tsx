import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Feed } from "@/components/leads/Feed";
import { ListSkeleton, PillsSkeleton, Skeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { scanNowAction } from "@/app/app/scan";
import { requireLocalUser } from "@/lib/auth";
import type { FeedParams } from "@/lib/feed";
import { activeProject } from "@/lib/projects";

type LeadsPageProps = { searchParams: Promise<FeedParams> };

/** What stands in for the feed while it is read, in the feed's own shape. */
function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-4 w-80 max-w-full" />
      <PillsSkeleton count={4} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,9fr)]">
        <ListSkeleton rows={8} />
        <div className="flex flex-col gap-3 rounded-card border bg-surface p-4">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * The page answers with the project's name and its Scan now button, and lets
 * the feed arrive behind a skeleton. Reading the feed is nearly all of the
 * second this page takes, and the heading was never waiting on any of it.
 */
export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const user = await requireLocalUser();
  const params = await searchParams;
  const project = await activeProject(user.id, params.project);
  // An account with no project has one thing to do, so it is taken there. This
  // is where a new signup lands, and an empty leads page telling them to go and
  // find the button was the whole of their welcome.
  if (!project) {
    redirect("/app/projects/new");
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 className="text-h2" style={{ fontWeight: 500 }}>
          {project.name}
        </h2>
        <form action={scanNowAction.bind(null, project.id)}>
          <Button type="submit" size="lg">
            Scan now
          </Button>
        </form>
      </div>
      {/*
        Deliberately unkeyed. Arriving on the page has nothing to show, so it
        shows the skeleton; narrowing a feed that is already on screen keeps
        it there and lets the pill that changed say it is working. Replacing a
        feed you can read with a skeleton is the worse of the two.
      */}
      <Suspense fallback={<FeedSkeleton />}>
        <Feed projectId={project.id} params={params} />
      </Suspense>
    </div>
  );
}
