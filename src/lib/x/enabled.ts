import { config } from "@/lib/config";

/**
 * Whether this user may see and run X leads. X_LEADS is the switch: off, the
 * tab is a 404, nothing queues an X job, and a queued one books nothing, for
 * everyone including the allowlist. X_LEADS_USERS only narrows it while on.
 * Every X entry point asks here and nowhere else.
 */
export function xEnabledFor(userId: string | null | undefined): boolean {
  const { X_LEADS, X_LEADS_USERS } = config();
  if (!X_LEADS || !userId) {
    return false;
  }
  return X_LEADS_USERS.length === 0 || X_LEADS_USERS.includes(userId);
}
