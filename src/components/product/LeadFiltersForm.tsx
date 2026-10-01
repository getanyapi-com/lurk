"use client";

import Link from "next/link";
import { useActionState } from "react";
import { TermInput } from "@/components/product/TermInput";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import type { HiddenLead } from "@/lib/leads";
import {
  saveLeadFiltersAction,
  type ProfileState,
} from "@/app/app/product/actions";

export type LeadFiltersFields = {
  projectId: string;
  scoreThreshold: number;
  alertMinScore: number | null;
  /** Undefined when X is not on for this owner, who is not asked about X. */
  xMinScore: number | null | undefined;
  mustMention: string[];
  /** The project's keyword mutes, which an alert's one-click links add to as well. */
  muted: string[];
  /** How many subreddits are muted, which the Alerts page lists. */
  mutedSubreddits: number;
  /** The house floors, shown as placeholders so an empty box says what it means. */
  defaultAlertScore: number;
};

type LeadFiltersFormProps = {
  filters: LeadFiltersFields;
  /** How many of the month's new Reddit leads the word lists keep out right now, and the best of them. */
  hidden: { hidden: number; total: number; leads: HiddenLead[] } | null;
};

const INITIAL: ProfileState = { error: null, saved: false };

function Score({
  name,
  value,
  placeholder,
}: {
  name: string;
  value: number | null;
  placeholder?: string;
}) {
  return (
    <Input
      name={name}
      type="number"
      min={0}
      max={100}
      step={1}
      defaultValue={value ?? ""}
      placeholder={placeholder}
      className="w-32 tabular-nums"
    />
  );
}

/**
 * What the saved word lists keep out of this month's leads, by name, so a skip
 * word that also catches real buyers, who mention it in passing, is seen.
 */
function HiddenLeads({ hidden }: { hidden: NonNullable<LeadFiltersFormProps["hidden"]> }) {
  const unnamed = hidden.hidden - hidden.leads.length;
  return (
    <div className="flex flex-col gap-2 rounded-control bg-surface-2 p-3">
      <p className="text-small text-fg-muted">
        Right now these and your mutes keep {hidden.hidden} of this month&apos;s {hidden.total} new
        Reddit leads out. If one of these is someone you want, loosen what hides it.
      </p>
      <ul className="flex flex-col gap-1.5">
        {hidden.leads.map((lead) => (
          <li key={lead.id} className="flex items-baseline gap-2 text-small">
            <span className="w-6 shrink-0 text-right tabular-nums text-fg-muted">{lead.score}</span>
            <a href={lead.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-fg hover:underline">
              {lead.title}
            </a>
            <span className="shrink-0 text-fg-muted">
              {lead.because}
            </span>
          </li>
        ))}
      </ul>
      {unnamed > 0 ? <p className="text-small text-fg-muted">And {unnamed} more.</p> : null}
    </div>
  );
}

/**
 * Which of the judge's leads this project wants shown and sent. The judge
 * decides whether someone is asking; these say which of them the owner cares
 * about, applied when leads are read, so saving never rescans.
 */
export function LeadFiltersForm({ filters, hidden }: LeadFiltersFormProps) {
  const [state, formAction, pending] = useActionState(saveLeadFiltersAction, INITIAL);

  return (
    <form id="lead-filters" action={formAction} className="flex scroll-mt-24 flex-col gap-4 rounded-card border bg-surface p-6">
      <input type="hidden" name="projectId" value={filters.projectId} />
      <div className="flex flex-col gap-1">
        <h2 className="text-h3" style={{ fontWeight: 500 }}>
          Lead filters
        </h2>
        <p className="text-small text-fg-muted">
          Which leads you see and get alerts for. Unlike Keep out on the Product
          page, which the scorer weighs as a hint, these are exact rules. They apply to
          Reddit and X, take effect at once, and never delete a lead: loosen
          one and what it held back comes back.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TermInput
          name="mustMention"
          label="Only leads that mention one of"
          initial={filters.mustMention}
          placeholder="invoice, billing software"
          tone="keep"
        />
        <TermInput
          name="muted"
          label="Never leads that mention (muted words)"
          initial={filters.muted}
          placeholder="hiring, homework"
          tone="skip"
        />
      </div>
      <p className="text-small text-fg-muted">
        Press Enter or type a comma after each word or phrase. Each matches
        as whole words in any case, plurals included, in the thread&apos;s title and the
        lead&apos;s own words. Leave the first empty to allow every topic. Muted words are the
        same list as the mutes under{" "}
        <Link href={`/app/settings/alerts?project=${filters.projectId}`} className="underline">
          Alerts
        </Link>
        {filters.mutedSubreddits > 0
          ? `, where your ${filters.mutedSubreddits} muted ${filters.mutedSubreddits === 1 ? "subreddit is" : "subreddits are"} listed too`
          : ""}
        .
      </p>
      {hidden && hidden.hidden > 0 ? <HiddenLeads hidden={hidden} /> : null}
      <div className="flex flex-wrap gap-6">
        <Field label="Minimum score to show a lead">
          <Score name="scoreThreshold" value={filters.scoreThreshold} />
        </Field>
        <Field label="Minimum score to alert">
          <Score
            name="alertMinScore"
            value={filters.alertMinScore}
            placeholder={String(filters.defaultAlertScore)}
          />
        </Field>
        {filters.xMinScore === undefined ? null : (
          <Field label="Minimum score for an X ask">
            <Score name="xMinScore" value={filters.xMinScore} placeholder="None" />
          </Field>
        )}
      </div>
      <p className="text-small text-fg-muted">
        Scores run 0 to 100. A Reddit lead under the first is left out of your
        leads; one under the second stays in them but is not sent to your
        alert channels, which never send what the feed hides.
        {filters.xMinScore === undefined
          ? null
          : " An X ask under the third is left out of both."}
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving" : "Save filters"}
        </Button>
        {state.error ? (
          <span aria-live="polite" className="text-small text-fg-muted">
            {state.error}
          </span>
        ) : null}
        {state.saved && !state.error ? (
          <span aria-live="polite" className="text-small text-fg-muted">
            Saved.
          </span>
        ) : null}
      </div>
    </form>
  );
}
