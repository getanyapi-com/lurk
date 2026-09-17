/**
 * Scan settings: how often a project is scanned and what a scan may buy from
 * a comment thread. Every value here has a preset per tier (`presets.ts`),
 * a user may override the keys their tier allows (`resolve.ts`), and the
 * scan reads only the resolved result. Nothing outside this module owns one
 * of these numbers.
 */

/** Hosted free wallet, hosted with the user's own AnyAPI wallet, or self-host. */
export type SettingsPreset = "free" | "connected" | "selfHost";

export type ScanCadenceSettings =
  /** Every `hours` hours, from whenever the last scan finished. */
  | { kind: "interval"; hours: number }
  /** Once a day at `hour` (0-23) in the IANA `timezone`. */
  | { kind: "daily"; hour: number; timezone: string };

export type ThreadPolicySettings = {
  /** A lead's thread is bought while the post is younger than this. */
  replyWindowDays: number;
  /** A thread with fewer replies than this is never bought. */
  minReplies: number;
  /** Threads bought per scan; null is no cap. */
  threadsPerScan: number | null;
  /** Read a lead's thread once even when the post is older than the window. */
  readOldThreadsOnce: boolean;
  /** Read the replies of Google-ranked threads on the SEO screen. */
  readSeoReplies: boolean;
};

export type ScanSettings = {
  cadence: ScanCadenceSettings;
  threads: ThreadPolicySettings;
};

/** The keys a user on a preset may change. Everything else is the preset's. */
export type EditableKey = "cadence.hour" | "cadence.timezone" | "cadence.hours" | keyof ThreadPolicySettings;

/** What the settings screen shows: the effective values and what may be edited. */
export type ResolvedSettings = {
  preset: SettingsPreset;
  settings: ScanSettings;
  editable: ReadonlySet<EditableKey>;
  /** Which of the settings the user chose themselves, as opposed to the preset's. */
  chosen: { timezone: boolean };
};

/**
 * How a project's scans are spaced. `interval` and `daily` are the two
 * strategies; the scan and the scheduler only ever call these two methods.
 */
export interface ScanCadence {
  /** Hours the scan treats as "since the last scan": cache age, search overlap. */
  intervalHours(): number;
  /** When the next scan runs, given when this one finished. */
  nextRunAt(now: Date): Date;
}

/** What `threadsToRead` and the SEO refresh ask before buying a thread. */
export interface ThreadPolicy {
  minReplies: number;
  threadsPerScan: number | null;
  readSeoReplies: boolean;
  /** Posts created before this instant are outside the reply window. */
  freshSince(now: Date): Date;
  /** Whether a post outside the window is still bought once. */
  readOldThreadsOnce: boolean;
}
