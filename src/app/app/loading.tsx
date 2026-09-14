import { HeadingSkeleton, ListSkeleton } from "@/components/Skeleton";

/** What every page under /app shows while the server reads it. */
export default function AppLoading() {
  return (
    <div className="flex flex-col gap-5">
      <HeadingSkeleton />
      <ListSkeleton rows={6} />
    </div>
  );
}
