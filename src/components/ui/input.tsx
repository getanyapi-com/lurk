/**
 * The app's form fields: a line of text, a box of it, and the label a form
 * wraps either in.
 *
 * A caller's classes are added after the field's own rather than merged with
 * cn(), which reads the text-body size as a colour and drops it beside text-fg.
 */

const SURFACE = "rounded-control border bg-surface text-body text-fg";

function withClasses(own: string, extra: string | undefined): string {
  return extra ? `${own} ${extra}` : own;
}

/** One line of text, as tall as a large button. */
export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input {...props} className={withClasses(`h-10 px-2 ${SURFACE}`, className)} />;
}

/** Several lines of text. */
export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea {...props} className={withClasses(`p-2 ${SURFACE}`, className)} />;
}

/** A field under its label, with a line saying more under it when there is one. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-small text-fg-muted">
      {label}
      {children}
      {hint ? <span className="text-small text-fg-muted">{hint}</span> : null}
    </label>
  );
}
