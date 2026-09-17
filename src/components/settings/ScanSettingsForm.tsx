"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { saveScanSettingsAction } from "@/app/app/settings/scanning/actions";
import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/searchSelect";
import { Select } from "@/components/ui/select";
import type { EditableKey, ScanSettings } from "@/lib/settings/types";

type ScanSettingsFormProps = {
  settings: ScanSettings;
  /** The keys this user's tier lets them change. Everything else is read-only. */
  editable: EditableKey[];
  /** Whether the timezone shown is the user's own pick, or the preset's. */
  timezoneChosen: boolean;
};

const INPUT = "h-10 rounded-control border bg-surface px-2 text-body text-fg";
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

/** One labelled row, whether it holds a control or a value you cannot change. */
function Line({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-small text-fg-muted">
      {label}
      {children}
      {hint ? <span className="text-small text-fg-muted">{hint}</span> : null}
    </label>
  );
}

/** A value the preset owns: shown, not edited. */
function Fixed({ label, hint, value }: { label: string; hint?: string; value: string }) {
  return (
    <Line label={label} hint={hint}>
      <span className="text-body text-fg">{value}</span>
    </Line>
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
    try {
      await saveScanSettingsAction(formData);
      setSaved(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
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
              <Line label="Scan once a day at">
                <Select
                  key={`hour-${cadence.hour}`}
                  name="hour"
                  ariaLabel="Scan hour"
                  defaultValue={String(cadence.hour)}
                  options={HOURS}
                  className="h-10 px-3 text-body"
                />
              </Line>
            ) : (
              <Fixed label="Scan once a day at" value={hourLabel(cadence.hour)} />
            )}
            {can.has("cadence.timezone") ? (
              <Line label="In this timezone">
                <TimezoneField value={timezone} onChange={setTimezone} />
              </Line>
            ) : (
              <Fixed label="In this timezone" value={cadence.timezone} />
            )}
          </div>
        ) : can.has("cadence.hours") ? (
          <Line label="Hours between scans">
            <input
              name="hours"
              type="number"
              min={1}
              max={24}
              step={1}
              defaultValue={cadence.hours}
              className={`${INPUT} w-32 tabular-nums`}
            />
          </Line>
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
            <Line label="Reply window, in days" hint="A lead's replies are bought while the post is younger than this.">
              <input
                name="replyWindowDays"
                type="number"
                min={1}
                max={30}
                step={1}
                defaultValue={threads.replyWindowDays}
                className={`${INPUT} w-32 tabular-nums`}
              />
            </Line>
          ) : (
            <Fixed
              label="Reply window, in days"
              hint="A lead's replies are bought while the post is younger than this."
              value={threads.replyWindowDays === 1 ? "1 day" : `${threads.replyWindowDays} days`}
            />
          )}
          {can.has("minReplies") ? (
            <Line label="Minimum replies" hint="A quieter thread is never bought.">
              <input
                name="minReplies"
                type="number"
                min={0}
                max={100}
                step={1}
                defaultValue={threads.minReplies}
                className={`${INPUT} w-32 tabular-nums`}
              />
            </Line>
          ) : (
            <Fixed
              label="Minimum replies"
              hint="A quieter thread is never bought."
              value={String(threads.minReplies)}
            />
          )}
          {can.has("threadsPerScan") ? (
            <Line label="Threads per scan" hint="Leave it empty for no cap.">
              <input
                name="threadsPerScan"
                type="number"
                min={1}
                max={500}
                step={1}
                placeholder="No cap"
                defaultValue={threads.threadsPerScan ?? ""}
                className={`${INPUT} w-32 tabular-nums`}
              />
            </Line>
          ) : (
            <Fixed
              label="Threads per scan"
              value={threads.threadsPerScan === null ? "No cap" : String(threads.threadsPerScan)}
            />
          )}
          {can.has("readOldThreadsOnce") ? (
            <Line label="Read older lead threads once" hint="One read of a thread past the window, for what your competitors said in it.">
              <Select
                key={`old-${threads.readOldThreadsOnce}`}
                name="readOldThreadsOnce"
                ariaLabel="Read older lead threads once"
                defaultValue={threads.readOldThreadsOnce ? "yes" : "no"}
                options={YES_NO}
                className="h-10 px-3 text-body"
              />
            </Line>
          ) : (
            <Fixed
              label="Read older lead threads once"
              hint="One read of a thread past the window, for what your competitors said in it."
              value={threads.readOldThreadsOnce ? "Yes" : "No"}
            />
          )}
          {can.has("readSeoReplies") ? (
            <Line label="Read replies on Google-ranked threads" hint="The threads on your SEO screen, read for who is recommended in them.">
              <Select
                key={`seo-${threads.readSeoReplies}`}
                name="readSeoReplies"
                ariaLabel="Read replies on Google-ranked threads"
                defaultValue={threads.readSeoReplies ? "yes" : "no"}
                options={YES_NO}
                className="h-10 px-3 text-body"
              />
            </Line>
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
