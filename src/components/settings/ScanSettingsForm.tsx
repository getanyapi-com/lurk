"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { saveScanSettingsAction } from "@/app/app/settings/scanning/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/searchSelect";
import { Select } from "@/components/ui/select";
import { errorFrom } from "@/lib/actionError";
import type { EditableKey, ScanSettings } from "@/lib/settings/types";

type ScanSettingsFormProps = {
  settings: ScanSettings;
  /** The keys this user's tier lets them change. Everything else is read-only. */
  editable: EditableKey[];
  /** Whether the timezone shown is the user's own pick, or the preset's. */
  timezoneChosen: boolean;
};

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];
const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00`,
}));

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

const LOCKED_TITLE = "Set by the free template. Connect an AnyAPI wallet to change it.";

/**
 * A value the preset owns: an input that looks like the editable ones but
 * cannot be changed, and says why on hover.
 */
function Fixed({ label, hint, value }: { label: string; hint?: string; value: string }) {
  return (
    <Field label={label} hint={hint}>
      <span className="relative flex items-center" title={LOCKED_TITLE}>
        <Input
          type="text"
          value={value}
          readOnly
          disabled
          aria-label={label}
          title={LOCKED_TITLE}
          className="w-full cursor-not-allowed bg-surface-2 pr-8 text-fg-muted"
        />
        <Lock className="pointer-events-none absolute right-2.5 size-4 text-fg-muted" aria-hidden="true" />
      </span>
    </Field>
  );
}

/** The line under a section whose values this tier does not let you change. */
function LockedNote() {
  return (
    <p className="text-small text-fg-muted">
      Connecting an AnyAPI wallet unlocks these.{" "}
      <Link href="/app/settings" className="underline">
        Connect a wallet
      </Link>
    </p>
  );
}

/**
 * The timezone the daily scan hour is read in. It rides to the server on a
 * hidden field so the browser's own zone can fill it in before anybody picks
 * one, and the list is every zone the browser knows.
 */
function TimezoneField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const zones = useMemo(
    () => Intl.supportedValuesOf("timeZone").map((zone) => ({ value: zone, label: zone })),
    [],
  );
  useEffect(() => {
    if (!value) {
      onChange(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, [value, onChange]);
  return (
    <>
      <input type="hidden" name="timezone" value={value} />
      <SearchSelect
        options={zones}
        value={value}
        onValueChange={onChange}
        ariaLabel="Timezone"
        placeholder="Pick a timezone"
        searchPlaceholder="Search timezones"
        className="h-10 w-full px-3 text-body"
      />
    </>
  );
}

/** Every scan setting this person can see, with the ones they may change editable. */
export function ScanSettingsForm({ settings, editable, timezoneChosen }: ScanSettingsFormProps) {
  const can = useMemo(() => new Set(editable), [editable]);
  const { cadence, threads } = settings;
  /** A zone the preset owns starts empty, so the browser's own zone fills it. */
  const [timezone, setTimezone] = useState(
    cadence.kind === "daily" && timezoneChosen ? cadence.timezone : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const cadenceLocked =
    cadence.kind === "daily"
      ? !can.has("cadence.hour") && !can.has("cadence.timezone")
      : !can.has("cadence.hours");
  const threadsLocked = !(
    can.has("replyWindowDays") ||
    can.has("minReplies") ||
    can.has("threadsPerScan") ||
    can.has("readOldThreadsOnce") ||
    can.has("readSeoReplies")
  );

  async function submit(formData: FormData) {
    setError(null);
    setSaved(false);
    const problem = await errorFrom(() => saveScanSettingsAction(formData));
    setError(problem);
    setSaved(problem === null);
  }

  return (
    <form action={submit} className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-card border bg-surface p-6">
        <h2 className="text-h3" style={{ fontWeight: 500 }}>
          How often
        </h2>
        {cadence.kind === "daily" ? (
          <div className="grid gap-4 md:grid-cols-2">
            {can.has("cadence.hour") ? (
              <Field label="Scan once a day at">
                <Select
                  key={`hour-${cadence.hour}`}
                  name="hour"
                  ariaLabel="Scan hour"
                  defaultValue={String(cadence.hour)}
                  options={HOURS}
                  className="h-10 px-3 text-body"
                />
              </Field>
            ) : (
              <Fixed label="Scan once a day at" value={hourLabel(cadence.hour)} />
            )}
            {can.has("cadence.timezone") ? (
              <Field label="In this timezone">
                <TimezoneField value={timezone} onChange={setTimezone} />
              </Field>
            ) : (
              <Fixed label="In this timezone" value={cadence.timezone} />
            )}
          </div>
        ) : can.has("cadence.hours") ? (
          <Field label="Hours between scans">
            <Input
              name="hours"
              type="number"
              min={1}
              max={24}
              step={1}
              defaultValue={cadence.hours}
              className="w-32 tabular-nums"
            />
          </Field>
        ) : (
          <Fixed
            label="Hours between scans"
            value={cadence.hours === 1 ? "Every hour" : `Every ${cadence.hours} hours`}
          />
        )}
        {cadenceLocked ? <LockedNote /> : null}
      </section>

      <section className="flex flex-col gap-4 rounded-card border bg-surface p-6">
        <h2 className="text-h3" style={{ fontWeight: 500 }}>
          Which threads a scan opens
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {can.has("replyWindowDays") ? (
            <Field label="Reply window, in days" hint="A lead's replies are bought while the post is younger than this.">
              <Input
                name="replyWindowDays"
                type="number"
                min={1}
                max={30}
                step={1}
                defaultValue={threads.replyWindowDays}
                className="w-32 tabular-nums"
              />
            </Field>
          ) : (
            <Fixed
              label="Reply window, in days"
              hint="A lead's replies are bought while the post is younger than this."
              value={threads.replyWindowDays === 1 ? "1 day" : `${threads.replyWindowDays} days`}
            />
          )}
          {can.has("minReplies") ? (
            <Field label="Minimum replies" hint="A quieter thread is never bought.">
              <Input
                name="minReplies"
                type="number"
                min={0}
                max={100}
                step={1}
                defaultValue={threads.minReplies}
                className="w-32 tabular-nums"
              />
            </Field>
          ) : (
            <Fixed
              label="Minimum replies"
              hint="A quieter thread is never bought."
              value={String(threads.minReplies)}
            />
          )}
          {can.has("threadsPerScan") ? (
            <Field label="Threads per scan" hint="Leave it empty for no cap.">
              <Input
                name="threadsPerScan"
                type="number"
                min={1}
                max={500}
                step={1}
                placeholder="No cap"
                defaultValue={threads.threadsPerScan ?? ""}
                className="w-32 tabular-nums"
              />
            </Field>
          ) : (
            <Fixed
              label="Threads per scan"
              value={threads.threadsPerScan === null ? "No cap" : String(threads.threadsPerScan)}
            />
          )}
          {can.has("readOldThreadsOnce") ? (
            <Field label="Read older lead threads once" hint="One read of a thread past the window, for what your competitors said in it.">
              <Select
                key={`old-${threads.readOldThreadsOnce}`}
                name="readOldThreadsOnce"
                ariaLabel="Read older lead threads once"
                defaultValue={threads.readOldThreadsOnce ? "yes" : "no"}
                options={YES_NO}
                className="h-10 px-3 text-body"
              />
            </Field>
          ) : (
            <Fixed
              label="Read older lead threads once"
              hint="One read of a thread past the window, for what your competitors said in it."
              value={threads.readOldThreadsOnce ? "Yes" : "No"}
            />
          )}
          {can.has("readSeoReplies") ? (
            <Field label="Read replies on Google-ranked threads" hint="The threads on your SEO screen, read for who is recommended in them.">
              <Select
                key={`seo-${threads.readSeoReplies}`}
                name="readSeoReplies"
                ariaLabel="Read replies on Google-ranked threads"
                defaultValue={threads.readSeoReplies ? "yes" : "no"}
                options={YES_NO}
                className="h-10 px-3 text-body"
              />
            </Field>
          ) : (
            <Fixed
              label="Read replies on Google-ranked threads"
              hint="The threads on your SEO screen, read for who is recommended in them."
              value={threads.readSeoReplies ? "Yes" : "No"}
            />
          )}
        </div>
        {threadsLocked ? <LockedNote /> : null}
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg">
          Save scanning
        </Button>
        {error ? <span className="text-small text-reddit">{error}</span> : null}
        {saved && !error ? (
          <span aria-live="polite" className="text-small text-fg-muted">
            Saved
          </span>
        ) : null}
      </div>
    </form>
  );
}
