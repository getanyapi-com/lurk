import { HeadingSkeleton, ListSkeleton } from "@/components/Skeleton";

/** The lists discovery wrote. */
export default function SourcesLoading() {
  return (
    <div className="flex flex-col gap-5">
      <HeadingSkeleton />
      <ListSkeleton rows={5} />
    </div>
  );
}
