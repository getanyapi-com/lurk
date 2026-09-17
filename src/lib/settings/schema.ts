import { z } from "zod";

/**
 * What a user may have saved in `users.settings`. Every key is optional: the
 * row holds only what the user actually changed, and the preset owns the rest.
 * A key the user's preset does not allow is dropped at resolve time, so this
 * schema only has to say what a valid value looks like.
 */

/** A zone Intl can actually format in; anything else is a typo or an attack. */
function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const positive = z.number().int().positive();

export const settingsOverridesSchema = z.object({
  cadence: z
    .object({
      hour: z.number().int().min(0).max(23),
      timezone: z.string().refine(isTimezone, "That is not a timezone"),
      hours: positive,
    })
    .partial()
    .optional(),
  threads: z
    .object({
      replyWindowDays: positive,
      minReplies: positive,
      threadsPerScan: positive.nullable(),
      readOldThreadsOnce: z.boolean(),
      readSeoReplies: z.boolean(),
    })
    .partial()
    .optional(),
});

/** The stored override object, as saved and as read back. */
export type SettingsOverrides = z.infer<typeof settingsOverridesSchema>;

/** What the jsonb column gave us, or null when it holds nothing usable. */
export function parseOverrides(stored: unknown): SettingsOverrides | null {
  const parsed = settingsOverridesSchema.safeParse(stored ?? {});
  return parsed.success ? parsed.data : null;
}
