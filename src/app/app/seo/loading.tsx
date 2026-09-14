import { HeadingSkeleton, ListSkeleton, PillsSkeleton } from "@/components/Skeleton";

/** The rankings, which open as pills over one long list of threads. */
export default function SeoLoading() {
  return (
    <div className="flex flex-col gap-5">
      <HeadingSkeleton />
      <PillsSkeleton count={3} />
      <ListSkeleton rows={10} />
    </div>
  );
}
