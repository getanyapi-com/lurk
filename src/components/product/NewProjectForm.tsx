"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  createProjectAndProfileAction,
  type NewProjectState,
} from "@/app/app/projects/new/actions";

const INITIAL: NewProjectState = { error: null };

/** The scheme is drawn in front of the field, so one that is typed or pasted is dropped. */
function bareAddress(value: string): string {
  return value.trim().replace(/^(?:https?:)?\/\//i, "");
}

/**
 * The product URL, then one submit that reads the site and opens the project.
 * The site names the project, so nothing else is asked. Everything after the
 * page read happens in the background, so the wait here is one page read and
 * the copy says exactly that.
 */
export function NewProjectForm() {
  const [state, formAction, pending] = useActionState(
    createProjectAndProfileAction,
    INITIAL,
  );
  const [address, setAddress] = useState("");

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-card border bg-surface p-6"
    >
      <label className="flex flex-col gap-1 text-small text-fg-muted">
        Product URL
        <span className="flex h-10 items-center rounded-control border bg-surface px-2 text-body focus-within:ring-2 focus-within:ring-fg-muted/40">
          <span aria-hidden="true" className="select-none text-fg-muted opacity-60">
            https://
          </span>
          <input
            type="text"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            required
            disabled={pending}
            value={address}
            onChange={(event) => setAddress(bareAddress(event.target.value))}
            placeholder="yourproduct.com"
            className="h-full min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-muted placeholder:opacity-60"
          />
        </span>
        <input type="hidden" name="url" value={address ? `https://${address}` : ""} />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Reading your site" : "Create project"}
        </Button>
        {pending ? (
          <span aria-live="polite" className="text-small text-fg-muted">
            Reading your site now. Your subreddits, your keywords and the
            first year of leads are found in the background over the next few
            minutes.
          </span>
        ) : null}
      </div>
      {state.error ? (
        <p aria-live="polite" className="text-body text-fg-muted">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
