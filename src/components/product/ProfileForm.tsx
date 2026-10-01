"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
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
};

type ProfileFormProps = { project: ProfileFields };

const INITIAL: ProfileState = { error: null, saved: false };

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
        <Field label="Project name">
          <Input name="name" required defaultValue={project.name} />
        </Field>
        <Field label="Product URL">
          <Input name="url" type="url" defaultValue={project.url} />
        </Field>
      </div>
      <Field label="The problem it solves">
        <Textarea name="pain" rows={3} defaultValue={project.pain} />
      </Field>
      <Field label="How it solves it">
        <Textarea name="solution" rows={3} defaultValue={project.solution} />
      </Field>
      <Field label="Who buys it">
        <Textarea name="targetUsers" rows={3} defaultValue={project.targetUsers} />
      </Field>
      {project.geography === null ? null : (
        <Field label="Where the product works">
          <Input name="geography" defaultValue={project.geography} />
        </Field>
      )}
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
