import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { ListEditor } from "@/components/product/ListEditor";
import { ProfileForm } from "@/components/product/ProfileForm";
import { PaidButton } from "@/components/PaidButton";
import { Button } from "@/components/ui/button";
import {
  rebuildProfileAction,
  scanAndOpenLeadsAction,
} from "@/app/app/product/actions";
import { requireLocalUser } from "@/lib/auth";
import { parseDestinations, parseTextList } from "@/lib/discovery/store";
import { activeProject } from "@/lib/projects";
import { activitySentence, isOnboarding, projectActivity } from "@/lib/projectActivity";
import { DEFAULT_SCORE_THRESHOLD } from "@/lib/scan/constants";
import { allowanceFor } from "@/lib/throttle";

type ProductPageProps = { searchParams: Promise<{ project?: string }> };

export default async function ProductPage({ searchParams }: ProductPageProps) {
  const user = await requireLocalUser();
  const project = await activeProject(user.id, (await searchParams).project);

  if (!project) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <EmptyState
          title="Product"
          sentence="Your product profile appears here once a project has been analysed."
        />
        <Button
          size="lg"
          nativeButton={false}
          className="self-start"
          render={<Link href="/app/projects/new">New project</Link>}
        />
      </div>
    );
  }

  const [activity, scanNow, rebuild] = await Promise.all([
    projectActivity(project.id),
    allowanceFor(user.id, "scan_now"),
    allowanceFor(user.id, "rebuild_profile"),
  ]);
  const places = parseDestinations(project.destinations).map((place) => ({
    value: place.name,
    sourceText: place.sourceText,
  }));

  // Every form below holds what was typed in it, and a textarea only reads its
  // default once, so switching projects has to draw them all afresh.
  return (
    <div key={project.id} className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2" style={{ fontWeight: 500 }}>
          Product
        </h1>
        <p className="text-body text-fg-muted">
          What we tell the scorer about your product. Edit anything that reads
          wrong; the next scan uses what is here. Where it looks is under{" "}
          <Link href={`/app/sources?project=${project.id}`} className="underline">
            Sources
          </Link>
          .
        </p>
        <p className="text-small text-fg-muted">{activitySentence(activity)}</p>
      </div>

      <ProfileForm
        project={{
          id: project.id,
          name: project.name,
          url: project.url ?? "",
          pain: project.pain ?? "",
          solution: project.solution ?? "",
          targetUsers: project.targetUsers ?? "",
          geography: places.length > 0 || project.geography ? (project.geography ?? "") : null,
          scoreThreshold: project.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD,
        }}
      />

      {/* A product sold everywhere has no places, and an empty list of them only asks a question it has no use for. */}
      {places.length > 0 ? (
        <ListEditor
          title="Places you serve"
          hint="Read off your own page. Discovery asks Google about each of these."
          placeholder="Las Vegas"
          kind="destination"
          projectId={project.id}
          items={places}
        />
      ) : null}
      <ListEditor
        title="How buyers say it"
        hint="The problem in their words, which is what we search for."
        placeholder="hotels that let 19 year olds check in"
        kind="phrasing"
        projectId={project.id}
        items={parseTextList(project.problemPhrasings).map((phrase) => ({
          value: phrase,
          sourceText: null,
        }))}
      />

      <ListEditor
        title="What it can do"
        hint="Read off your own page. The scorer judges a person's need against these."
        placeholder="check in guests aged 18 and over"
        kind="capability"
        projectId={project.id}
        items={parseTextList(project.capabilities).map((phrase) => ({
          value: phrase,
          sourceText: null,
        }))}
      />
      <ListEditor
        title="Keep out"
        hint="What you cannot do, and people who talk like your buyers but never buy. Both keep the wrong person out of the feed."
        placeholder="students looking for a free plan"
        kind="not_buyer"
        kinds={[
          { value: "not_buyer", label: "Never buys" },
          { value: "exclusion", label: "Not covered" },
        ]}
        projectId={project.id}
        items={[
          ...parseTextList(project.exclusions).map((phrase) => ({
            value: phrase,
            sourceText: null,
            kind: "exclusion" as const,
          })),
          ...parseTextList(project.notBuyers).map((phrase) => ({
            value: phrase,
            sourceText: null,
            kind: "not_buyer" as const,
          })),
        ]}
      />

      <div className="flex flex-wrap items-center gap-3">
        {isOnboarding(activity) ? null : (
          <form action={scanAndOpenLeadsAction}>
            <input type="hidden" name="projectId" value={project.id} />
            <PaidButton label="Scan now" allowance={scanNow} align="start" />
          </form>
        )}
        {/* Rebuilding reads the product page again, so a project with no page has nothing to rebuild from. */}
        {project.url ? (
          <>
            <form action={rebuildProfileAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <PaidButton
                label="Rebuild profile"
                allowance={rebuild}
                variant="secondary"
                align="start"
              />
            </form>
            <span className="text-small text-fg-muted">
              Rebuilding reads your site again and replaces everything above, and your sources.
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
