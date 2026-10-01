import Link from "next/link";
import { eq } from "drizzle-orm";
import { AutoAccept } from "@/components/alerts/AutoAccept";
import { LinkLanding } from "@/components/alerts/LinkLanding";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { userForToken } from "@/lib/alerts/invite";
import { acceptInviteAction } from "./actions";

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

  if (!user?.email) {
    return (
      <LinkLanding title="That link does not work">
        <p className="text-body text-fg-muted">
          Turn alerts on from{" "}
          <Link href="/app/settings/alerts" className="underline">
            alert settings
          </Link>{" "}
          instead.
        </p>
      </LinkLanding>
    );
  }
  if (done) {
    return (
      <LinkLanding title="Email alerts are on">
        <p className="text-body text-fg-muted">
          New leads for {list} go to {user.email}, once a day and only when there is something new.
        </p>
        <Link href="/app/settings/alerts" className="text-small text-fg-muted underline">
          Add Slack or Discord, or change this
        </Link>
      </LinkLanding>
    );
  }
  return (
    <LinkLanding title="Turning on email alerts…">
      <p className="text-body text-fg-muted">
        One email a day to {user.email} with new leads for {list}, only on days there are some.
        Free.
      </p>
      <AutoAccept action={acceptInviteAction.bind(null, t)} />
      <Link href="/app/settings/alerts" className="text-small text-fg-muted underline">
        Rather use Slack or Discord
      </Link>
    </LinkLanding>
  );
}
