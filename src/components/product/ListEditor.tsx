"use client";

import { X } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  addListItemAction,
  removeListItemAction,
  type ListKind,
} from "@/app/app/product/actions";

/** One place or one phrasing, with the page text it was read from. */
export type ListItem = { value: string; sourceText: string | null };

type ListEditorProps = {
  title: string;
  hint: string;
  placeholder: string;
  kind: ListKind;
  projectId: string;
  items: ListItem[];
};

/**
 * The two lists discovery builds its questions from: the places this product
 * serves and the way its buyers say the problem. Both are read off the product
 * page, and both are worth correcting by hand when the page is thin.
 */
export function ListEditor({
  title,
  hint,
  placeholder,
  kind,
  projectId,
  items,
}: ListEditorProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section className="flex flex-col gap-3 rounded-card border bg-surface p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-h3" style={{ fontWeight: 500 }}>
          {title}
        </h2>
        <span className="text-small text-fg-muted tabular-nums">{items.length}</span>
      </div>
      <p className="text-small text-fg-muted">{hint}</p>
      <ul className="flex flex-wrap gap-2">
        {items.length === 0 ? (
          <li className="text-body text-fg-muted">The page named none.</li>
        ) : (
          items.map((item) => (
            <li
              key={item.value}
              className="flex max-w-full items-start gap-2 rounded-control border bg-surface-2 px-3 py-1.5"
            >
              <span className="flex flex-col gap-1">
                <span className="text-body text-fg">{item.value}</span>
                {/* A place the page names outright quotes itself, which says nothing twice. */}
                {item.sourceText && item.sourceText !== item.value ? (
                  <span className="text-small text-fg-muted">{item.sourceText}</span>
                ) : null}
              </span>
              <button
                type="button"
                aria-label={`Remove ${item.value}`}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    await removeListItemAction(kind, projectId, item.value);
                  })
                }
                className="transition-motion ml-auto mt-1.5 text-fg-muted transition-colors hover:text-fg"
              >
                <X className="size-3" />
              </button>
            </li>
          ))
        )}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await addListItemAction(kind, projectId, draft);
            setError(result.error);
            if (!result.error) {
              setDraft("");
            }
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
