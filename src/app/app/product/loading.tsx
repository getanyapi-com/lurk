import { HeadingSkeleton, ListSkeleton, Skeleton } from "@/components/Skeleton";

/** The profile form, then the lists discovery wrote under it. */
export default function ProductLoading() {
  return (
    <div className="flex flex-col gap-5">
      <HeadingSkeleton />
      <div className="flex flex-col gap-3 rounded-card border bg-surface p-4">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
      <ListSkeleton rows={5} />
    </div>
  );
}
