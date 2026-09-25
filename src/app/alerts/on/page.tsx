import Link from "next/link";
import { eq } from "drizzle-orm";
import { Wordmark } from "@/components/Wordmark";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { userForToken } from "@/lib/alerts/invite";
import { acceptInviteAction } from "./actions";
import { AutoAccept } from "./AutoAccept";

type InvitePageProps = { searchParams: Promise<{ t?: string; done?: string }> };

/**
 * Where "Turn on email alerts" in the invite lands. The server does nothing on
 * the visit, since mail scanners fetch every link in a message; the page's own
 * script presses the button, so a person who clicked is signed up at once.
 */
export default async function InvitePage({ searchParams }: InvitePageProps) {
  const { t = "", done } = await searchParams;
  const userId = done === "invalid" ? null : userForToken(t);
  const [user] = userId ? await db().select().from(users).where(eq(users.id, userId)) : [];
  const names = userId
    ? (await db().select({ name: projects.name }).from(projects).where(eq(projects.userId, userId))).map(
        (row) => row.name,
      )
    : [];
  const list = names.join(", ");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-8">
      <Wordmark homeHref="/" />
      <div className="flex w-full max-w-md flex-col gap-4 rounded-card border bg-surface p-8">
        {!user?.email ? (
          <>
            <h1 className="text-h3" style={{ fontWeight: 500 }}>
              That link does not work
            </h1>
            <p className="text-body text-fg-muted">
              Turn alerts on from{" "}
              <Link href="/app/settings/alerts" className="underline">
                alert settings
              </Link>{" "}
              instead.
            </p>
          </>
        ) : done ? (
          <>
            <h1 className="text-h3" style={{ fontWeight: 500 }}>
              Email alerts are on
            </h1>
            <p className="text-body text-fg-muted">
              New leads for {list} go to {user.email}, once a day and only when there is something
              new.
            </p>
            <Link href="/app/settings/alerts" className="text-small text-fg-muted underline">
              Add Slack or Discord, or change this
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-h3" style={{ fontWeight: 500 }}>
              Turning on email alerts…
            </h1>
            <p className="text-body text-fg-muted">
              One email a day to {user.email} with new leads for {list}, only on days there are
              some. Free.
            </p>
            <AutoAccept action={acceptInviteAction.bind(null, t)} />
            <Link href="/app/settings/alerts" className="text-small text-fg-muted underline">
              Rather use Slack or Discord
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
