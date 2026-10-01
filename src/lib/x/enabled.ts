import { config } from "@/lib/config";

/**
 * Whether this user may see and run X leads. X_LEADS is the switch: off, the
 * tab is a 404, nothing queues an X job, and a queued one books nothing. On,
 * it is on for every signed-in user. Every X entry point asks here and nowhere
 * else.
 */
export function xEnabledFor(userId: string | null | undefined): boolean {
  return config().X_LEADS && Boolean(userId);
}
