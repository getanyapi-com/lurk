import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Feed } from "@/components/leads/Feed";
import { ListSkeleton, PillsSkeleton, Skeleton } from "@/components/Skeleton";
import { PaidButton } from "@/components/PaidButton";
import { scanNowAction } from "@/app/app/scan";
import { requireLocalUser } from "@/lib/auth";
import type { FeedParams } from "@/lib/feed";
import { activeProject } from "@/lib/projects";
import { allowanceFor } from "@/lib/throttle";

type LeadsPageProps = { searchParams: Promise<FeedParams> };

/** What stands in for the feed while it is read, in the feed's own shape. */
function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-4 w-80 max-w-full" />
      <div className="flex flex-col gap-3 rounded-card border bg-surface px-3 py-2.5">
        <PillsSkeleton count={4} />
        <Skeleton className="h-16 w-full" />
      </div>
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
  const scanNow = await allowanceFor(user.id, "scan_now");

  return (
    // From lg up the page is exactly the window under the header, and never
    // scrolls: the list and the thread take whatever the rows over them leave,
    // and each scrolls inside itself. A page that grew with the thread meant
    // scrolling the window to reach the list's tenth row.
    <div className="flex flex-col gap-1 lg:h-[calc(100dvh_-_var(--header-height)_-_var(--page-gutter)_*_2)]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="text-h3" style={{ fontWeight: 500 }}>
          {project.name}
        </h2>
        <form action={scanNowAction.bind(null, project.id)}>
          <PaidButton label="Scan now" allowance={scanNow} note="beside" />
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
