import { openCompetitorsAction, scanCompetitorsAction } from "@/app/app/jobs";
import { StartOnOpen } from "@/components/StartOnOpen";
import { MentionCard } from "@/components/competitors/MentionCard";
import { MentionsBar } from "@/components/competitors/MentionsBar";
import { TopCompetitors } from "@/components/competitors/TopCompetitors";
import { EmptyState } from "@/components/EmptyState";
import { JobStatus, type JobWords } from "@/components/JobStatus";
import { lastRunJob, nextQueuedJob } from "@/jobs/enqueue";
import { requireLocalUser } from "@/lib/auth";
import { allowanceFor } from "@/lib/throttle";
import { PaidButton } from "@/components/PaidButton";
import {
  domainsByName,
  listMentions,
  mentionSeries,
  topCompetitors,
  watchedCompetitors,
} from "@/lib/competitors/read";
import { requireActiveProject } from "@/lib/projects";

type CompetitorsPageProps = { searchParams: Promise<{ project?: string }> };

/** The competitor scan's status line. */
const SCAN_WORDS: JobWords = {
  noun: "scan",
  running: "Scanning now",
  finished: (_job, ago) => `Last scanned ${ago}.`,
  stopped: "Last scan stopped",
  never: "No competitor scan has run yet.",
  button: "Scan now",
};

export default async function CompetitorsPage({ searchParams }: CompetitorsPageProps) {
  const user = await requireLocalUser();
  const params = await searchParams;
  const project = await requireActiveProject(user.id, params.project);

  const [competitors, mentions, last, next, allowance] = await Promise.all([
    watchedCompetitors(project.id),
    listMentions(project.id),
    lastRunJob("competitor_scan", project.id),
    nextQueuedJob("competitor_scan", project.id),
    allowanceFor(user.id, "competitor_scan"),
  ]);
  const names = competitors.map((row) => row.name);
  const domains = domainsByName(competitors);
  const ranked = topCompetitors(mentions);

  // Keyed so switching projects mounts StartOnOpen again for the new one.
  return (
    <div key={project.id} className="flex flex-col gap-5">
      {last ? null : <StartOnOpen start={openCompetitorsAction.bind(null, project.id)} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-h2" style={{ fontWeight: 500 }}>
            Competitors
          </h1>
          <JobStatus last={last} next={next} words={SCAN_WORDS} />
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
