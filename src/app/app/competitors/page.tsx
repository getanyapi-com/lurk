import { openCompetitorsAction, scanCompetitorsAction } from "@/app/app/competitors/actions";
import { StartOnOpen } from "@/components/StartOnOpen";
import { MentionCard } from "@/components/competitors/MentionCard";
import { MentionsBar } from "@/components/competitors/MentionsBar";
import { TopCompetitors } from "@/components/competitors/TopCompetitors";
import { EmptyState } from "@/components/EmptyState";
import { relativeAge, relativeUntil } from "@/lib/format";
import { lastRunJob, nextQueuedJob } from "@/jobs/enqueue";
import { requireLocalUser } from "@/lib/auth";
import { allowanceFor } from "@/lib/throttle";
import { PaidButton } from "@/components/PaidButton";
import {
  domainsByName,
  listCompetitors,
  listMentions,
  mentionSeries,
  topCompetitors,
} from "@/lib/competitors/read";
import { activeProject } from "@/lib/projects";

type CompetitorsPageProps = { searchParams: Promise<{ project?: string }> };

type Job = Awaited<ReturnType<typeof lastRunJob>>;

function lastSentence(job: Job): string | null {
  if (!job?.startedAt) {
    return null;
  }
  if (!job.finishedAt) {
    return job.progress ? `Scanning now: ${job.progress}` : "Scanning now.";
  }
  if (job.error) {
    return `Last scan stopped: ${job.error.split("\n")[0].trim()}`;
  }
  return `Last scanned ${relativeAge(job.finishedAt)}.`;
}

function nextSentence(job: Job): string {
  if (!job) {
    return "No scan is scheduled. Press Scan now.";
  }
  const until = relativeUntil(job.runAt);
  return until === "now" ? "The next scan is due now." : `Next scan ${until}.`;
}

/** What the last scan did and when the next one runs, as one line. */
function statusLine(last: Job, next: Job): string {
  if (last?.startedAt && !last.finishedAt) {
    return lastSentence(last) ?? "";
  }
  return [lastSentence(last) ?? "No competitor scan has run yet.", nextSentence(next)].join(" ");
}

export default async function CompetitorsPage({ searchParams }: CompetitorsPageProps) {
  const user = await requireLocalUser();
  const params = await searchParams;
  const project = await activeProject(user.id, params.project);
  if (!project) {
    return (
      <EmptyState
        title="Competitors"
        sentence="Create a project first, then we can watch what Reddit says about the products you compete with."
      />
    );
  }

  const [competitors, mentions, last, next, allowance] = await Promise.all([
    listCompetitors(project.id),
    listMentions(project.id),
    lastRunJob("competitor_scan", project.id),
    nextQueuedJob("competitor_scan", project.id),
    allowanceFor(user.id, "competitor_scan"),
  ]);
  const names = competitors.map((row) => row.name);
  const domains = domainsByName(competitors);
  const ranked = topCompetitors(mentions);

  return (
    <div className="flex flex-col gap-5">
      {last ? null : <StartOnOpen start={openCompetitorsAction.bind(null, project.id)} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-h2" style={{ fontWeight: 500 }}>
            Competitors
          </h1>
          <p className="text-small text-fg-muted">{statusLine(last, next)}</p>
        </div>
        <form action={scanCompetitorsAction.bind(null, project.id)}>
          <PaidButton label="Scan now" allowance={allowance} />
        </form>
      </div>

      {names.length === 0 ? (
        <EmptyState
          title="No competitors yet"
          sentence="Add the products you compete with on the Product screen, then scan for what Reddit says about them."
        />
      ) : (
        <>
          {ranked.length > 0 ? <TopCompetitors rows={ranked} domains={domains} /> : null}
          <MentionsBar series={mentionSeries(mentions, names)} />
          {mentions.length === 0 ? (
            <EmptyState
              title="No mentions yet"
              sentence="Nothing on Reddit named these products in the last 30 days, or no scan has run."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {mentions.map((mention) => (
                <MentionCard key={mention.id} mention={mention} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
