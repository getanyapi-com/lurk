"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveScoringAction } from "@/app/app/product/actions";
import {
  DEFAULT_SCORING,
  FACTORS,
  FACTOR_HINT,
  FACTOR_LABEL,
  LEVELS,
  communityKey,
  rankingSentence,
  redditScore,
  type ScoringFactor,
  type ScoringSettings,
  type WeightLevel,
} from "@/lib/scoring/weights";
import { cn } from "@/lib/utils";

/** One stored lead, with the factors its score folds, for the preview. */
export type PreviewLead = {
  id: string;
  title: string;
  subreddit: string;
  score: number;
  quality: number | null;
  intent: number | null;
  engagement: number | null;
};

type ScoringPanelProps = {
  projectId: string;
  /** What is saved, or null when the owner never chose. */
  saved: ScoringSettings | null;
  /** Subreddits this project has found leads in, busiest first, then the ones it only searches. */
  communities: string[];
  leads: PreviewLead[];
};

const LEVEL_LABEL: Record<WeightLevel, string> = { off: "Off", low: "Low", normal: "Normal", high: "High" };

/** How many communities show before "Show all", busiest first. */
const COMMUNITIES_SHOWN = 20;

/** How many leads the preview lists, which is about what the feed shows above the fold. */
const PREVIEW_SIZE = 8;

function same(a: ScoringSettings, b: ScoringSettings): boolean {
  return (
    FACTORS.every((factor) => a.weights[factor] === b.weights[factor]) &&
    [...a.communities].sort().join() === [...b.communities].sort().join()
  );
}

function LevelPicker({
  factor,
  value,
  onChange,
}: {
  factor: ScoringFactor;
  value: WeightLevel;
  onChange: (level: WeightLevel) => void;
}) {
  return (
    <div role="radiogroup" aria-label={FACTOR_LABEL[factor]} className="flex rounded-control border bg-surface-2 p-0.5">
      {LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={value === level}
          onClick={() => onChange(level)}
          className={cn(
            "transition-motion rounded-control px-2.5 py-1 text-small transition-colors",
            value === level ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
          )}
        >
          {LEVEL_LABEL[level]}
        </button>
      ))}
    </div>
  );
}

function Moved({ by }: { by: number }) {
  if (by === 0) {
    return <span className="text-mono inline-flex w-8 shrink-0 text-fg-muted">-</span>;
  }
  const Icon = by > 0 ? ArrowUp : ArrowDown;
  return (
    <span className="text-mono inline-flex w-8 shrink-0 items-center gap-0.5 tabular-nums text-fg-muted">
      <Icon className="size-3" aria-hidden="true" />
      {Math.abs(by)}
    </span>
  );
}

/**
 * What counts most when this project's leads are ranked, with the feed's top
 * leads re-ranked live under the weights being tried, so a change is seen
 * before it is saved. Saving re-ranks every stored lead in place.
 */
export function ScoringPanel({ projectId, saved, communities, leads }: ScoringPanelProps) {
  const start = saved ?? DEFAULT_SCORING;
  const [draft, setDraft] = useState<ScoringSettings>(start);
  const [committed, setCommitted] = useState<ScoringSettings>(start);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [allCommunities, setAllCommunities] = useState(false);

  const allOff = FACTORS.every((factor) => draft.weights[factor] === "off");
  const dirty = !same(draft, committed);
  const favoured = new Set(draft.communities);
  // A favoured community always shows, however far down the list it sits.
  const shownCommunities = allCommunities
    ? communities
    : communities.filter((name, index) => index < COMMUNITIES_SHOWN || favoured.has(communityKey(name)));

  const preview = useMemo(() => {
    const before = [...leads].sort((a, b) => b.score - a.score).map((lead) => lead.id);
    return leads
      .map((lead) => ({ lead, score: allOff ? lead.score : redditScore(lead, draft) }))
      .sort((a, b) => b.score - a.score || before.indexOf(a.lead.id) - before.indexOf(b.lead.id))
      .slice(0, PREVIEW_SIZE)
      .map((entry, index) => ({ ...entry, moved: before.indexOf(entry.lead.id) - index }));
  }, [leads, draft, allOff]);

  function setWeight(factor: ScoringFactor, level: WeightLevel) {
    setStatus(null);
    setDraft((current) => ({ ...current, weights: { ...current.weights, [factor]: level } }));
  }

  function toggleCommunity(name: string) {
    setStatus(null);
    const key = communityKey(name);
    setDraft((current) => ({
      ...current,
      communities: current.communities.includes(key)
        ? current.communities.filter((one) => one !== key)
        : [...current.communities, key],
    }));
  }

  function save(next: ScoringSettings | null) {
    startTransition(async () => {
      const result = await saveScoringAction(projectId, next);
      if (result.error) {
        setStatus(result.error);
        return;
      }
      const settled = next ?? DEFAULT_SCORING;
      setDraft(settled);
      setCommitted(settled);
      setStatus(`Saved. ${result.moved} ${result.moved === 1 ? "lead" : "leads"} re-scored.`);
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-card border bg-surface p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-h3" style={{ fontWeight: 500 }}>
          What counts most in a lead&rsquo;s score
        </h2>
        <p className="text-small text-fg-muted">
          Every lead in your feed already passed the scorer. These decide their order and their 50-100 score on
          Reddit and X, never which posts get in. Nothing is scanned again.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {FACTORS.map((factor) => (
            <div key={factor} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-col">
                  <span className="text-body text-fg">{FACTOR_LABEL[factor]}</span>
                  <span className="text-small text-fg-muted">{FACTOR_HINT[factor]}</span>
                </div>
                <LevelPicker factor={factor} value={draft.weights[factor]} onChange={(level) => setWeight(factor, level)} />
              </div>
              {factor === "community" ? (
                communities.length === 0 ? (
                  <p className="text-small text-fg-muted">No communities yet. They appear once a scan has run.</p>
                ) : (
                  <ul
                    className={cn(
                      "flex flex-wrap gap-1.5",
                      draft.weights.community === "off" && "opacity-60",
                    )}
                  >
                    {shownCommunities.map((name) => (
                      <li key={name}>
                        <button
                          type="button"
                          aria-pressed={favoured.has(communityKey(name))}
                          onClick={() => toggleCommunity(name)}
                          className={cn(
                            "transition-motion text-mono rounded-control border px-2 py-0.5 transition-colors",
                            favoured.has(communityKey(name))
                              ? "border-fg bg-surface-2 text-fg"
                              : "text-fg-muted hover:text-fg",
                          )}
                        >
                          r/{name}
                        </button>
                      </li>
                    ))}
                    {shownCommunities.length < communities.length ? (
                      <li>
                        <button
                          type="button"
                          onClick={() => setAllCommunities(true)}
                          className="text-small px-2 py-0.5 text-fg-muted underline hover:text-fg"
                        >
                          Show all {communities.length}
                        </button>
                      </li>
                    ) : null}
                  </ul>
                )
              ) : null}
            </div>
          ))}
          {factorsNote(draft)}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-mono tracking-wide text-fg-muted uppercase">Your top leads under these weights</span>
          {preview.length === 0 ? (
            <p className="text-small text-fg-muted">Your leads show here once a scan has found some.</p>
          ) : (
            <ol className="flex flex-col divide-y rounded-card border">
              {preview.map(({ lead, score, moved }) => (
                <li key={lead.id} className="flex flex-col gap-1 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-mono w-7 shrink-0 tabular-nums text-fg" style={{ fontWeight: 500 }}>
                      {score}
                    </span>
                    <Moved by={moved} />
                    <span className="truncate text-small text-fg">{lead.title}</span>
                  </div>
                  <span className="text-small pl-[3.75rem] text-fg-muted">
                    r/{lead.subreddit} · {allOff ? "Turn a factor on to rank." : rankingSentence(lead, draft)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="lg" disabled={pending || !dirty || allOff} onClick={() => save(draft)}>
          {pending ? "Saving" : "Save weights"}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          disabled={pending || (saved === null && !dirty && same(committed, DEFAULT_SCORING))}
          onClick={() => save(null)}
        >
          Reset to default
        </Button>
        {status || allOff ? (
          <span aria-live="polite" className="text-small text-fg-muted">
            {allOff ? "Turn at least one factor on." : status}
          </span>
        ) : null}
      </div>
    </section>
  );
}

/** A word on the one setting that reads as a mistake: favouring communities with none picked. */
function factorsNote(draft: ScoringSettings) {
  if (draft.weights.community !== "off" && draft.communities.length === 0) {
    return <p className="text-small text-fg-muted">Pick at least one community above, or this factor holds every lead back.</p>;
  }
  return null;
}
