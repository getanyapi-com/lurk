import { cn } from "@/lib/utils";

/**
 * One block standing in for something the server is still reading. Every page
 * under /app takes about a second to answer against a real project, and until
 * this existed a person spent that second looking at the page they had just
 * left, with nothing anywhere saying a new one was coming.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-control bg-surface-2", className)} />;
}

/** The heading and sentence every app page opens with. */
export function HeadingSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

/** The row of filter pills over a feed. */
export function PillsSkeleton({ count }: { count: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-8 w-32" />
      ))}
    </div>
  );
}

/** A card holding a list of rows, the shape most of this app is made of. */
export function ListSkeleton({ rows, className }: { rows: number; className?: string }) {
  return (
    <div className={cn("flex flex-col rounded-card border bg-surface", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b p-3 last:border-b-0">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-full max-w-80" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}
