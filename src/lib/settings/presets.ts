import type { EditableKey, ScanSettings, SettingsPreset } from "./types";

/**
 * The values each tier gets before the user changes anything. Free scans once a
 * day and reads only fresh threads; a connected wallet and a self-hosted
 * instance scan hourly and read everything a scan can use. These numbers are
 * the product plan's, and nothing outside this file holds a copy.
 */

/** Where a daily cadence starts: free's own, and what a switch to daily uses. */
export const DAILY_DEFAULT = { kind: "daily", hour: 9, timezone: "UTC" } as const;

export const PRESETS: Record<SettingsPreset, ScanSettings> = {
  free: {
    cadence: DAILY_DEFAULT,
    threads: {
      replyWindowDays: 3,
      minReplies: 3,
      threadsPerScan: 20,
      readOldThreadsOnce: false,
      readSeoReplies: false,
    },
  },
  connected: {
    cadence: { kind: "interval", hours: 1 },
    threads: {
      replyWindowDays: 3,
      minReplies: 3,
      threadsPerScan: null,
      readOldThreadsOnce: true,
      readSeoReplies: true,
    },
  },
  selfHost: {
    cadence: { kind: "interval", hours: 1 },
    threads: {
      replyWindowDays: 3,
      minReplies: 3,
      threadsPerScan: null,
      readOldThreadsOnce: true,
      readSeoReplies: true,
    },
  },
};

/** Every key a user could ever be allowed to change. */
export const EDITABLE_KEYS: readonly EditableKey[] = [
  "cadence.hour",
  "cadence.timezone",
  "cadence.hours",
  "replyWindowDays",
  "minReplies",
  "threadsPerScan",
  "readOldThreadsOnce",
  "readSeoReplies",
];

/**
 * What each preset lets the user change. Free picks the hour of its daily scan
 * and the timezone that hour is read in; everything else on free is the house
 * wallet's budget, not a preference. A user paying their own calls decides all
 * of it.
 */
export const EDITABLE: Record<SettingsPreset, ReadonlySet<EditableKey>> = {
  free: new Set<EditableKey>(["cadence.hour", "cadence.timezone"]),
  connected: new Set<EditableKey>(EDITABLE_KEYS),
  selfHost: new Set<EditableKey>(EDITABLE_KEYS),
};
