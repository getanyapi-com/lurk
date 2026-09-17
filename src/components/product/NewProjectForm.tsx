"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  createProjectAndProfileAction,
  type NewProjectState,
} from "@/app/app/projects/new/actions";

const INITIAL: NewProjectState = { error: null };

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

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-card border bg-surface p-6"
    >
      <label className="flex flex-col gap-1 text-small text-fg-muted">
        Product URL
        <input
          name="url"
          type="url"
          required
          disabled={pending}
          placeholder="https://yourproduct.com"
          className="h-10 rounded-control border bg-surface px-2 text-body text-fg"
        />
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
