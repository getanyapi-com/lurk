import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { enqueueJob, nextScanJob } from "@/jobs/enqueue";
import { walletConnection } from "@/lib/anyapi";
import { config } from "@/lib/config";
import type { TierName } from "@/lib/tiers";
import { cadenceFor } from "./cadence";
import { DAILY_DEFAULT, EDITABLE, PRESETS } from "./presets";
import { parseOverrides, settingsOverridesSchema, type SettingsOverrides } from "./schema";
import type {
  EditableKey,
  ResolvedSettings,
  ScanCadenceSettings,
  SettingsPreset,
  ThreadPolicySettings,
} from "./types";

/** Which preset a user is on. Self-host is its own, whatever the tier says. */
export function presetFor(tier: TierName, selfHosted: boolean): SettingsPreset {
  return selfHosted ? "selfHost" : tier;
}

/** Drops the keys this preset does not let the user change, and the empty ones. */
function kept<T extends object>(
  source: T | undefined,
  allowed: (key: string) => boolean,
): Partial<T> {
  const entries = Object.entries(source ?? {}).filter(
    ([key, value]) => value !== undefined && allowed(key),
  );
  return Object.fromEntries(entries) as Partial<T>;
}

/**
 * The overrides this preset actually permits. Anything else is dropped in
 * silence: a free user posting a thread setting is not an error, it is a
 * setting they do not have.
 */
export function allowedOverrides(
  preset: SettingsPreset,
  overrides: SettingsOverrides,
): SettingsOverrides {
  const editable = EDITABLE[preset];
  return {
    cadence: kept(overrides.cadence, (key) => editable.has(`cadence.${key}` as EditableKey)),
    threads: kept(overrides.threads, (key) => editable.has(key as EditableKey)),
  };
}

/**
 * Picking an hour is picking a daily scan, which is the only thing an hour can
 * mean; asking for an interval is asking for the hourly one back. A preset that
 * is already daily keeps its own hour and zone as the starting point.
 */
function cadenceWith(
  base: ScanCadenceSettings,
  overrides: NonNullable<SettingsOverrides["cadence"]>,
): ScanCadenceSettings {
  if (overrides.hours !== undefined) {
    return { kind: "interval", hours: overrides.hours };
  }
  if (overrides.hour === undefined && overrides.timezone === undefined) {
    return base;
  }
  const daily = base.kind === "daily" ? base : DAILY_DEFAULT;
  return {
    kind: "daily",
    hour: overrides.hour ?? daily.hour,
    timezone: overrides.timezone ?? daily.timezone,
  };
}

function threadsWith(
  base: ThreadPolicySettings,
  overrides: NonNullable<SettingsOverrides["threads"]>,
): ThreadPolicySettings {
  return { ...base, ...overrides };
}

/** The preset, with the user's own choices laid over the keys they may change. */
export function resolveSettings(
  preset: SettingsPreset,
  overrides: SettingsOverrides | null | undefined,
): ResolvedSettings {
  const allowed = allowedOverrides(preset, overrides ?? {});
  const base = PRESETS[preset];
  return {
    preset,
    settings: {
      cadence: cadenceWith(base.cadence, allowed.cadence ?? {}),
      threads: threadsWith(base.threads, allowed.threads ?? {}),
    },
    editable: EDITABLE[preset],
    chosen: { timezone: allowed.cadence?.timezone !== undefined },
  };
}

/** What this user saved, or null when they have never saved anything valid. */
async function storedOverrides(userId: string): Promise<SettingsOverrides | null> {
  const rows = await db()
    .select({ settings: users.settings })
    .from(users)
    .where(eq(users.id, userId));
  return rows[0] ? parseOverrides(rows[0].settings) : null;
}

/**
 * The settings of a user whose preset the caller already knows. `tierForUser`
 * uses this so asking for the tier and the settings together costs one wallet
 * lookup, not two.
 */
export async function settingsForPreset(
  userId: string,
  preset: SettingsPreset,
): Promise<ResolvedSettings> {
  return resolveSettings(preset, await storedOverrides(userId));
}

/** The settings in force for a user: their preset, with their own choices on it. */
export async function settingsForUser(userId: string): Promise<ResolvedSettings> {
  const tier: TierName = (await walletConnection(userId)) ? "connected" : "free";
  return settingsForPreset(userId, presetFor(tier, config().SELF_HOSTED));
}

/**
 * Saves what the user changed and moves their schedule to match. A project
 * with a scan already waiting is rescheduled to the new cadence, because a
 * free user moving their daily hour means the next scan, not the one after it.
 * A project with no scan waiting is left alone: something else owns its queue.
 */
export async function saveUserSettings(
  userId: string,
  overrides: unknown,
): Promise<ResolvedSettings> {
  const parsed = settingsOverridesSchema.parse(overrides);
  const current = await settingsForUser(userId);
  const allowed = allowedOverrides(current.preset, parsed);
  await db().update(users).set({ settings: allowed }).where(eq(users.id, userId));
  const resolved = resolveSettings(current.preset, allowed);
  const runAt = cadenceFor(resolved.settings.cadence).nextRunAt(new Date());
  const rows = await db()
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, userId));
  for (const row of rows) {
    if (await nextScanJob(row.id)) {
      await enqueueJob("scan", row.id, runAt);
    }
  }
  return resolved;
}
