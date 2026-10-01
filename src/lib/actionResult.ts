import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { ACTION_FAILED } from "@/lib/actionError";
import { isFailedQuery } from "@/lib/format";

/**
 * What a Server Action hands back when it can fail in a way the person should
 * read. A production build replaces any message a Server Action throws with a
 * generic sentence and a digest, so "A Discord webhook URL is on discord.com"
 * thrown from an action never reaches the form that asked. Lib functions keep
 * throwing; the action catches at its edge and returns the sentence instead.
 */
export type ActionResult = { error: string | null };

/**
 * The sentence a caught error gives a person. A schema says its first
 * complaint. A failed statement leads with its SQL, which is for whoever
 * debugs it, so that one, like anything that is not an Error, says `fallback`.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? fallback;
  }
  if (!(error instanceof Error) || isFailedQuery(error.message)) {
    return fallback;
  }
  return error.message;
}

/**
 * A caught error as the result an action returns. Next's own control flow, the
 * redirect to sign in among it, is thrown on rather than shown as a message.
 */
export function failure(error: unknown, fallback = ACTION_FAILED): { error: string } {
  unstable_rethrow(error);
  return { error: errorMessage(error, fallback) };
}
