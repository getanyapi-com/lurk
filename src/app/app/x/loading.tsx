import { HeadingSkeleton, ListSkeleton, PillsSkeleton, Skeleton } from "@/components/Skeleton";

/** The tab's own shape: the heading, the pills and a column of posts. */
export default function XLoading() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <HeadingSkeleton />
        <Skeleton className="h-9 w-24" />
      </div>
      <PillsSkeleton count={5} />
      <ListSkeleton rows={4} />
    </div>
  );
}
