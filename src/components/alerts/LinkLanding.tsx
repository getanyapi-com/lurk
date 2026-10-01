import { Wordmark } from "@/components/Wordmark";

/**
 * The page a link in an email lands on, signed in or not: the wordmark, and
 * one card saying what the link did or is about to do.
 */
export function LinkLanding({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-8">
      <Wordmark homeHref="/" />
      <div className="flex w-full max-w-md flex-col gap-4 rounded-card border bg-surface p-8">
        <h1 className="text-h3" style={{ fontWeight: 500 }}>
          {title}
        </h1>
        {children}
      </div>
    </main>
  );
}
