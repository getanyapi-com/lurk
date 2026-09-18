"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  saveProfileAction,
  type ProfileState,
} from "@/app/app/product/actions";

export type ProfileFields = {
  id: string;
  name: string;
  url: string;
  pain: string;
  solution: string;
  targetUsers: string;
  /** Null for a product with no places, which is not asked where it works. */
  geography: string | null;
  scoreThreshold: number;
};

type ProfileFormProps = { project: ProfileFields };

const INITIAL: ProfileState = { error: null, saved: false };
const INPUT = "h-10 rounded-control border bg-surface px-2 text-body text-fg";
const AREA = "rounded-control border bg-surface p-2 text-body text-fg";

function Line({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-small text-fg-muted">
      {label}
      {children}
    </label>
  );
}

/** The product profile a scan scores against, editable by hand. */
export function ProfileForm({ project }: ProfileFormProps) {
  const [state, formAction, pending] = useActionState(
    saveProfileAction,
    INITIAL,
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-card border bg-surface p-6"
    >
      <input type="hidden" name="projectId" value={project.id} />
      <div className="grid gap-4 md:grid-cols-2">
        <Line label="Project name">
          <input
            name="name"
            required
            defaultValue={project.name}
            className={INPUT}
          />
        </Line>
        <Line label="Product URL">
          <input
            name="url"
            type="url"
            defaultValue={project.url}
            className={INPUT}
          />
        </Line>
      </div>
      <Line label="The problem it solves">
        <textarea
          name="pain"
          rows={3}
          defaultValue={project.pain}
          className={AREA}
        />
      </Line>
      <Line label="How it solves it">
        <textarea
          name="solution"
          rows={3}
          defaultValue={project.solution}
          className={AREA}
        />
      </Line>
      <Line label="Who buys it">
        <textarea
          name="targetUsers"
          rows={3}
          defaultValue={project.targetUsers}
          className={AREA}
        />
      </Line>
      {project.geography === null ? null : (
        <Line label="Where the product works">
          <input name="geography" defaultValue={project.geography} className={INPUT} />
        </Line>
      )}
      <Line label="Minimum score to show a lead (0 to 100)">
        <input
          name="scoreThreshold"
          type="number"
          min={0}
          max={100}
          step={1}
          defaultValue={project.scoreThreshold}
          className={`${INPUT} w-32 tabular-nums`}
        />
      </Line>
      <p className="text-small text-fg-muted">
        A post scoring below this is left out of your leads. Lower it to see
        more, raise it to see only the closest matches.
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving" : "Save profile"}
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
