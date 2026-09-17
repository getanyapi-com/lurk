import { walletConnection } from "./anyapi";
import { config } from "./config";
import { presetFor, settingsForPreset } from "./settings";
import type { ResolvedSettings } from "./settings";
import { limitsFor, type TierLimits, type TierName } from "./tiers";

export type UserTier = {
  name: TierName;
  limits: TierLimits | null;
  /** Cadence and thread policy, which the tier presets and the user may edit. */
  settings: ResolvedSettings;
};

/** Which tier a user is on, the limits that go with it, and their settings. */
export async function tierForUser(userId: string): Promise<UserTier> {
  const name: TierName = (await walletConnection(userId)) ? "connected" : "free";
  const selfHosted = config().SELF_HOSTED;
  return {
    name,
    limits: limitsFor(name, selfHosted),
    settings: await settingsForPreset(userId, presetFor(name, selfHosted)),
  };
}

/** Trims a list to a tier cap, keeping the model's own ordering. */
export function capped<T>(values: T[], limit: number | null | undefined): T[] {
  return limit == null ? values : values.slice(0, limit);
}
