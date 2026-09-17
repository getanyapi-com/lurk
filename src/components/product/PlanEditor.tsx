"use client";

import { Pin, PinOff, X } from "lucide-react";
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
};

type PlanEditorProps = {
  title: string;
  hint: string;
  placeholder: string;
  kind: ChipKind;
  projectId: string;
  rows: PlanRow[];
  limit: number | null;
  /** Community icons, keyed by the lowercased subreddit name. */
  icons?: Record<string, string | null>;
};

const SOURCE_LABEL: Record<string, string> = {
  serp: "Google",
  llm: "Model",
  user: "You",
};

const STATE_LABEL: Record<string, string> = {
  active: "Reading",
  pinned: "Pinned",
  excluded: "Excluded",
  candidate: "Waiting",
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
 * What the row produced, and nothing at all before a scan has covered it: a
 * zero next to a query nobody has run yet reads as a verdict on the query.
 */
function Yield({ row }: { row: PlanRow }) {
  if (!row.lastCoveredAt) {
    return null;
  }
  return (
    <span className="font-mono text-mono text-fg-muted tabular-nums">
      {row.freshCandidates} found, {row.freshLeads} leads
    </span>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-control bg-surface-2 px-2 py-0.5 text-small text-fg-muted">
      {children}
    </span>
  );
}

/**
 * The plan as a person can argue with it: what we are reading, who put it
 * there, how much evidence stands behind it, and the two buttons that make a
 * row theirs - pin it so a rebuild cannot take it away, or exclude it so
 * discovery stops offering it.
 */
export function PlanEditor({
  title,
  hint,
  placeholder,
  kind,
  projectId,
  rows,
  limit,
  icons,
}: PlanEditorProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const reading = rows.filter((row) => row.state !== "excluded" && row.state !== "candidate");
  const count = limit == null ? String(reading.length) : `${reading.length} of ${limit}`;

  function run(work: () => Promise<{ error: string | null } | void>) {
    startTransition(async () => {
      const result = await work();
      setError(result?.error ?? null);
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-card border bg-surface p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-h3" style={{ fontWeight: 500 }}>
          {title}
        </h2>
        <span className="text-small text-fg-muted tabular-nums">{count}</span>
      </div>
      <p className="text-small text-fg-muted">{hint}</p>
      <ul className="flex flex-col gap-2">
        {rows.length === 0 ? (
          <li className="text-body text-fg-muted">Nothing here yet.</li>
        ) : (
          rows.map((row) => (
            <li
              key={row.value}
              className="flex flex-wrap items-center gap-2 rounded-control border bg-surface-2 px-3 py-2"
            >
              <RowMark kind={kind} row={row} icons={icons} />
              <span
                className={`text-body ${row.state === "excluded" ? "text-fg-muted line-through" : "text-fg"}`}
              >
                {row.value}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <Yield row={row} />
                {kind === "competitor" ? (
                  <DomainField
                    // A saved site is normalised - a pasted URL comes back as a
                    // bare host - so the box is redrawn from what was stored.
                    key={row.domain ?? ""}
                    row={row}
                    disabled={pending}
                    onSave={(raw) =>
                      run(() => setCompetitorDomainAction(projectId, row.value, raw))
                    }
                  />
                ) : null}
                <Badge>{SOURCE_LABEL[row.source] ?? row.source}</Badge>
                <Badge>
                  {row.evidence} {row.evidence === 1 ? "thread" : "threads"}
                </Badge>
                <Badge>{STATE_LABEL[row.state] ?? row.state}</Badge>
                <button
                  type="button"
                  aria-label={row.state === "pinned" ? `Unpin ${row.value}` : `Pin ${row.value}`}
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      setChipStateAction(
                        kind,
                        projectId,
                        row.value,
                        row.state === "pinned" ? "active" : "pinned",
                      ),
                    )
                  }
                  className="transition-motion text-fg-muted transition-colors hover:text-fg"
                >
                  {row.state === "pinned" ? (
                    <PinOff className="size-4" />
                  ) : (
                    <Pin className="size-4" />
                  )}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      setChipStateAction(
                        kind,
                        projectId,
                        row.value,
                        row.state === "excluded" ? "active" : "excluded",
                      ),
                    )
                  }
                  className="transition-motion text-small text-fg-muted transition-colors hover:text-fg"
                >
                  {row.state === "excluded" ? "Put back" : "Exclude"}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${row.value}`}
                  disabled={pending}
                  onClick={() => run(() => removeChipAction(kind, projectId, row.value))}
                  className="transition-motion text-fg-muted transition-colors hover:text-fg"
                >
                  <X className="size-3" />
                </button>
              </span>
            </li>
          ))
        )}
      </ul>
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
          aria-label={`Add to ${title}`}
          className="h-10 flex-1 rounded-control border bg-surface px-2 text-body text-fg"
        />
        <Button type="submit" variant="outline" size="lg" disabled={pending}>
          Add
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
