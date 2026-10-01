import { tierNameFor } from "./anyapi";
import { config } from "./config";
import { presetFor, settingsForPreset } from "./settings/resolve";
import type { ResolvedSettings } from "./settings/types";
import { limitsFor, type TierLimits, type TierName } from "./tiers";

/** Which tier a user is on and the limits that go with it. */
export type TierWithLimits = {
  name: TierName;
  limits: TierLimits | null;
};

export type UserTier = TierWithLimits & {
  /** Cadence and thread policy, which the tier presets and the user may edit. */
  settings: ResolvedSettings;
};

/**
 * Which tier a user is on and the limits that go with it, for the many callers
 * that need nothing else: every allowance check and cap.
 */
export async function limitsForUser(userId: string): Promise<TierWithLimits> {
  const name = await tierNameFor(userId);
  return { name, limits: limitsFor(name, config().SELF_HOSTED) };
}

/** Which tier a user is on, the limits that go with it, and their settings. */
export async function tierForUser(userId: string): Promise<UserTier> {
  const { name, limits } = await limitsForUser(userId);
  return {
    name,
    limits,
    settings: await settingsForPreset(userId, presetFor(name, config().SELF_HOSTED)),
  };
}

/** Trims a list to a tier cap, keeping the model's own ordering. */
export function capped<T>(values: T[], limit: number | null | undefined): T[] {
  return limit == null ? values : values.slice(0, limit);
}
