"use client";

import { useActionState, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { buttonVariants } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { CopyField } from "@/components/api/CopyField";
import { createApiKeyAction, type CreateKeyState } from "@/app/app/settings/api/actions";

const INITIAL: CreateKeyState = { key: null, error: null };

/**
 * Name a key, get the secret once. The dialog deliberately does not close on
 * success, because closing it would throw away the only copy of the key.
 */
export function CreateKeyDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createApiKeyAction, INITIAL);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className={buttonVariants({ size: "lg" })}>Create key</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-fg/20" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 flex w-[min(30rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-card border bg-surface p-6">
          <Dialog.Title className="text-h3" style={{ fontWeight: 500 }}>
            {state.key ? "Your new key" : "Create an API key"}
          </Dialog.Title>
          {state.key ? (
            <>
              <p className="text-body text-fg-muted">
                Copy it now. It is stored as a hash, so this is the only time it can be shown.
              </p>
              <CopyField label="Secret key" value={state.key} />
              <Dialog.Close className={buttonVariants({ variant: "outline", size: "lg" })}>
                Done
              </Dialog.Close>
            </>
          ) : (
            <form action={formAction} className="flex flex-col gap-4">
              <Field label="Key name">
                <Input name="name" required disabled={pending} placeholder="My agent" />
              </Field>
              <p className="text-small text-fg-muted">
                Keys are read-only. They can read your projects, leads, Reddit SEO, themes and
                spend, and they can change nothing.
              </p>
              {state.error ? (
                <p aria-live="polite" className="text-body text-fg-muted">
                  {state.error}
                </p>
              ) : null}
              <div className="flex items-center gap-2">
                <button type="submit" disabled={pending} className={buttonVariants({ size: "lg" })}>
                  {pending ? "Creating" : "Create key"}
                </button>
                <Dialog.Close className={buttonVariants({ variant: "ghost", size: "lg" })}>
                  Cancel
                </Dialog.Close>
              </div>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
