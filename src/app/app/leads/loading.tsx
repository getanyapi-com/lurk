import { HeadingSkeleton, ListSkeleton, PillsSkeleton, Skeleton } from "@/components/Skeleton";

/** The feed's own shape: the pills, the list and the pane the thread opens in. */
export default function LeadsLoading() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <HeadingSkeleton />
        <Skeleton className="h-9 w-24" />
      </div>
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
