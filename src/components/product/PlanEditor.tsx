"use client";

import { X } from "lucide-react";
import { useState, useTransition } from "react";
import { Avatar } from "@/components/Avatar";
import { Favicon } from "@/components/Favicon";
import { Button } from "@/components/ui/button";
import {
  addChipAction,
  removeChipAction,
  setChipStateAction,
  setCompetitorDomainAction,
  type ChipKind,
} from "@/app/app/product/actions";
import { competitorHost } from "@/lib/competitors/host";

/** One row of the retrieval plan, with where it came from and what backs it. */
export type PlanRow = {
  value: string;
  source: string;
  state: string;
  evidence: number;
  /** What this row has found and turned into leads since it was added. */
  freshCandidates: number;
  freshLeads: number;
  /** The site a competitor sells from, which is where its logo comes from. */
  domain?: string | null;
  /** Null until a scan has actually covered this row, which is what makes a
   * zero a measurement rather than a row nobody has read yet. */
  lastCoveredAt: Date | null;
  /** True when the next scan will spend one of its calls on this row. */
  next?: boolean;
};

type PlanEditorProps = {
  title: string;
  hint: string;
  placeholder: string;
  kind: ChipKind;
  projectId: string;
  rows: PlanRow[];
  limit: number | null;
  /** What the add box is for, in the words on its button. */
  addLabel: string;
  /** Why the folded rows are not scanned, and what switching one on does. */
  idleHint: string;
  /** Community icons, keyed by the lowercased subreddit name. */
  icons?: Record<string, string | null>;
};

/**
 * A subreddit shows its own icon; a competitor shows the favicon of the site we
 * know it sells from. A competitor with no site wears its initials, because a
 * domain guessed off the spelling is how a row ends up wearing somebody else's
 * logo - the box below the row is there to be told the right one.
 */
function RowMark({
  kind,
  row,
  icons,
}: {
  kind: ChipKind;
  row: PlanRow;
  icons?: Record<string, string | null>;
}) {
  if (kind === "subreddit") {
    return <Avatar name={row.value} src={icons?.[row.value.toLowerCase()] ?? null} size={16} />;
  }
  if (kind === "competitor") {
    return <Favicon url={row.domain ?? competitorHost(row.value)} name={row.value} size={16} />;
  }
  return null;
}

/**
 * The site a competitor sells from, as a box a person can correct. It saves on
 * blur and on Enter rather than behind a button, because the only thing it can
 * change is which picture the row wears.
 */
function DomainField({
  row,
  disabled,
  onSave,
}: {
  row: PlanRow;
  disabled: boolean;
  onSave: (raw: string) => void;
}) {
  const [draft, setDraft] = useState(row.domain ?? "");
  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim() !== (row.domain ?? "")) {
          onSave(draft);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      disabled={disabled}
      placeholder="site"
      aria-label={`Website for ${row.value}`}
      title={`The site ${row.value} sells from, which is where its logo comes from`}
      className="h-7 w-32 rounded-control border bg-surface px-2 text-small text-fg-muted"
    />
  );
}

/**
 * What the row is doing right now, in one phrase. The scan's own ranking says
 * whether it is next; everything else follows from the state.
 */
function statusOf(kind: ChipKind, row: PlanRow): string {
  if (row.state === "excluded") {
    return "Off";
  }
  if (row.state === "candidate") {
    return "Found, not scanned";
  }
  if (kind === "competitor") {
    return "Watching for mentions";
  }
  return row.next ? "Runs in the next scan" : "Takes turns with the others";
}

/** What the row has produced, and that it has not run rather than a zero. */
function resultOf(kind: ChipKind, row: PlanRow): string | null {
  if (kind === "competitor") {
    return null;
  }
  if (!row.lastCoveredAt) {
    return row.state === "candidate" || row.state === "excluded" ? null : "Not run yet";
  }
  return `${row.freshLeads} ${row.freshLeads === 1 ? "lead" : "leads"} from ${row.freshCandidates} posts`;
}

/**
 * A search aimed at one community is stored in Reddit's own syntax; the
 * community reads better as where the search runs than as part of the query.
 */
function RowName({ kind, row }: { kind: ChipKind; row: PlanRow }) {
  const off = row.state === "excluded";
  const tone = off ? "text-fg-muted line-through" : "text-fg";
  const scoped = kind === "keyword" ? /^subreddit:(\S+) AND (.+)$/.exec(row.value) : null;
  if (!scoped) {
    return (
      <span className={`text-body ${tone}`}>
        {kind === "subreddit" ? `r/${row.value}` : row.value}
      </span>
    );
  }
  return (
    <span className={`text-body ${tone}`}>
      {scoped[2]} <span className="text-fg-muted">in r/{scoped[1]}</span>
    </span>
  );
}

function Switch({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`transition-motion relative h-5 w-9 shrink-0 rounded-full border transition-colors ${on ? "bg-fg" : "bg-surface"}`}
    >
      <span
        className={`transition-motion absolute top-0.5 size-3.5 rounded-full transition-all ${on ? "left-[18px] bg-surface" : "left-0.5 bg-fg-muted"}`}
      />
    </button>
  );
}

/**
 * One list of the plan, with one control per row: a switch. On means a scan
 * may use the row, off means it never will. Switching on a row discovery only
 * proposed pins it, because a person chose it and a rebuild should not undo
 * that; only a row a person typed in can be deleted outright, since discovery
 * would offer any other one again.
 */
export function PlanEditor({
  title,
  hint,
  placeholder,
  kind,
  projectId,
  rows,
  limit,
  addLabel,
  idleHint,
  icons,
}: PlanEditorProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const on = rows.filter((row) => row.state !== "excluded" && row.state !== "candidate");
  const idle = rows.filter((row) => row.state === "excluded" || row.state === "candidate");
  const count = limit == null ? `${on.length} on` : `${on.length} of ${limit} on`;

  function run(work: () => Promise<{ error: string | null } | void>) {
    startTransition(async () => {
      const result = await work();
      setError(result?.error ?? null);
    });
  }

  const renderRow = (row: PlanRow) => {
    const isOn = row.state === "active" || row.state === "pinned";
    const result = resultOf(kind, row);
    return (
      <li
        key={row.value}
        className="flex flex-wrap items-center gap-3 rounded-control border bg-surface-2 px-3 py-2"
      >
        <Switch
          on={isOn}
          label={`${isOn ? "Turn off" : "Turn on"} ${row.value}`}
          disabled={pending}
          onChange={() =>
            run(() =>
              setChipStateAction(
                kind,
                projectId,
                row.value,
                isOn ? "excluded" : row.state === "candidate" ? "pinned" : "active",
              ),
            )
          }
        />
        <RowMark kind={kind} row={row} icons={icons} />
        <span className="flex min-w-0 flex-1 flex-col">
          <RowName kind={kind} row={row} />
          <span className="text-small text-fg-muted">
            {[statusOf(kind, row), result, row.source === "user" ? "Added by you" : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        {kind === "competitor" ? (
          <DomainField
            // A saved site is normalised - a pasted URL comes back as a
            // bare host - so the box is redrawn from what was stored.
            key={row.domain ?? ""}
            row={row}
            disabled={pending}
            onSave={(raw) => run(() => setCompetitorDomainAction(projectId, row.value, raw))}
          />
        ) : null}
        {row.source === "user" ? (
          <button
            type="button"
            aria-label={`Delete ${row.value}`}
            title="Delete"
            disabled={pending}
            onClick={() => run(() => removeChipAction(kind, projectId, row.value))}
            className="transition-motion text-fg-muted transition-colors hover:text-fg"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </li>
    );
  };

  return (
    <section className="flex flex-col gap-3 rounded-card border bg-surface p-4 md:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-h3" style={{ fontWeight: 500 }}>
          {title}
        </h2>
        <span className="text-small text-fg-muted tabular-nums">{count}</span>
      </div>
      <p className="text-small text-fg-muted">{hint}</p>
      <ul className="flex flex-col gap-2">
        {on.length === 0 ? (
          <li className="text-body text-fg-muted">Nothing on yet.</li>
        ) : (
          on.map(renderRow)
        )}
      </ul>
      {idle.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-small text-fg-muted">
            {idle.length} switched off or not scanned
          </summary>
          <p className="mt-2 text-small text-fg-muted">{idleHint}</p>
          <ul className="mt-2 flex flex-col gap-2">{idle.map(renderRow)}</ul>
        </details>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(async () => {
            const result = await addChipAction(kind, projectId, draft);
            if (!result.error) {
              setDraft("");
            }
            return result;
          });
        }}
        className="flex gap-2"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          aria-label={addLabel}
          className="h-10 flex-1 rounded-control border bg-surface px-2 text-body text-fg"
        />
        <Button type="submit" variant="outline" size="lg" disabled={pending}>
          {addLabel}
        </Button>
      </form>
      {error ? (
        <p aria-live="polite" className="text-small text-fg-muted">
          {error}
        </p>
      ) : null}
    </section>
  );
}
