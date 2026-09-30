"use client";

import { useState } from "react";
import { BellOff, X } from "lucide-react";
import { addMuteAction, removeMuteAction } from "@/app/app/settings/alerts/actions";
import { PillTabs } from "@/components/PillTabs";
import { Button } from "@/components/ui/button";
import type { Mute, MuteKind } from "@/lib/mutes";

type MuteListProps = { projectId: string; mutes: Mute[] };

const PLACEHOLDERS: Record<MuteKind, string> = {
  keyword: "a word or phrase, like hiring",
  subreddit: "r/forhire",
};

const FIELD = "h-10 min-w-64 flex-1 rounded-control border bg-surface px-3 text-body text-fg";

/**
 * What the project never wants to hear about: a word or phrase anywhere in a
 * thread's title or the lead's own words, or a whole community. A mute hides
 * the leads it touches from the feed and from every channel, and taking it off
 * brings them back.
 */
export function MuteList({ projectId, mutes }: MuteListProps) {
  const [kind, setKind] = useState<MuteKind>("keyword");
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setError(null);
    try {
      await addMuteAction(projectId, formData);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {mutes.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {mutes.map((mute) => (
            <li
              key={mute.id}
              className="flex items-center gap-1.5 rounded-control border bg-surface py-1 pr-1 pl-3 text-body text-fg"
            >
              <BellOff className="size-3.5 text-fg-muted" aria-hidden="true" />
              {mute.kind === "subreddit" ? `r/${mute.value}` : `“${mute.value}”`}
              <form action={removeMuteAction.bind(null, projectId, mute.id)}>
                <Button type="submit" variant="ghost" size="sm" aria-label={`Unmute ${mute.value}`}>
                  <X className="size-3.5 text-fg-muted" aria-hidden="true" />
                </Button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-fg-muted">Nothing muted.</p>
      )}
      <form action={submit} className="flex flex-col gap-3 rounded-card border bg-surface p-4">
        <input type="hidden" name="kind" value={kind} />
        <PillTabs
          className="self-start"
          activeId={kind}
          onSelect={(id) => setKind(id as MuteKind)}
          tabs={[
            { id: "keyword", label: "Keyword" },
            { id: "subreddit", label: "Subreddit" },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            key={kind}
            name="value"
            required
            aria-label={kind === "keyword" ? "Keyword to mute" : "Subreddit to mute"}
            placeholder={PLACEHOLDERS[kind]}
            className={FIELD}
          />
          <Button type="submit" variant="outline">
            Mute
          </Button>
        </div>
        {error ? <p className="text-small text-reddit">{error}</p> : null}
      </form>
    </div>
  );
}
