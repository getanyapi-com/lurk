import Link from "next/link";
import { eq } from "drizzle-orm";
import { AutoAccept } from "@/app/alerts/on/AutoAccept";
import { Wordmark } from "@/components/Wordmark";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { actForToken, type AlertAct } from "@/lib/alerts/act";
import { doActAction, undoActAction } from "./actions";

type ActPageProps = {
  searchParams: Promise<{ t?: string; done?: string; undone?: string; sample?: string }>;
};

/** What the act is, in the words of the page's heading, before and after. */
function wordsFor(act: AlertAct, projectName: string) {
  if (act.act === "replied") {
    return {
      doing: "Marking the thread replied…",
      done: "Marked replied",
      undone: "Back in your alerts",
      sentence: `Nothing more from this thread will be sent for ${projectName}, by email, Slack or Discord, and it has moved out of New in the feed.`,
      undoneSentence: `The thread is back in New for ${projectName}. Leads already sent are not sent again.`,
      button: "Mark replied",
    };
  }
  return {
    doing: `Muting r/${act.subreddit}…`,
    done: `Muted r/${act.subreddit}`,
    undone: `r/${act.subreddit} is back`,
    sentence: `Leads from r/${act.subreddit} are no longer sent or shown for ${projectName}. Mutes are listed under alert settings.`,
    undoneSentence: `Leads from r/${act.subreddit} show and send for ${projectName} again.`,
    button: `Mute r/${act.subreddit}`,
  };
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
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

/**
 * Where an alert's Mark replied and Mute links land. As with the invite, the
 * visit does nothing, since mail scanners fetch every link in a message; the
 * page's own script presses the button, so a person's click is one click.
 */
export default async function ActPage({ searchParams }: ActPageProps) {
  const { t = "", done, undone, sample } = await searchParams;
  if (sample) {
    return (
      <Card title="That was a sample">
        <p className="text-body text-fg-muted">
          In a real alert this link marks the thread replied, or mutes the subreddit, so it stops
          coming back. Nothing was changed.
        </p>
      </Card>
    );
  }
  const act = done === "invalid" ? null : actForToken(t);
  const [project] = act
    ? await db().select({ name: projects.name }).from(projects).where(eq(projects.id, act.projectId))
    : [];
  if (!act || !project) {
    return (
      <Card title="That link does not work">
        <p className="text-body text-fg-muted">
          Mark the thread replied from{" "}
          <Link href="/app/leads" className="underline">
            the feed
          </Link>{" "}
          instead.
        </p>
      </Card>
    );
  }
  const words = wordsFor(act, project.name);
  if (undone) {
    return (
      <Card title={words.undone}>
        <p className="text-body text-fg-muted">{words.undoneSentence}</p>
      </Card>
    );
  }
  if (done) {
    return (
      <Card title={words.done}>
        <p className="text-body text-fg-muted">{words.sentence}</p>
        <div className="flex items-center gap-3">
          <form action={undoActAction.bind(null, t)}>
            <Button type="submit" variant="outline" size="sm">
              Undo
            </Button>
          </form>
          <Link href="/app/settings/alerts" className="text-small text-fg-muted underline">
            Alert settings
          </Link>
        </div>
      </Card>
    );
  }
  return (
    <Card title={words.doing}>
      <AutoAccept action={doActAction.bind(null, t)} label={words.button} />
    </Card>
  );
}
