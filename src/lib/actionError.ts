import { unstable_rethrow } from "next/navigation";
import type { ActionResult } from "@/lib/actionResult";

/** What a form says when an action failed without putting it into words. */
export const ACTION_FAILED = "That did not go through. Try again.";

/**
 * Calls an action that returns ActionResult, from the client that shows its
 * sentence. Most refusals come back as that result, but some still throw: a
 * dropped connection, an action a deploy has since replaced, or a refusal
 * thrown before the action's own catch. A form action or transition that
 * throws hands the whole page to app/error.tsx, so those say ACTION_FAILED
 * under the form instead. A redirect, the one to sign in among them, is thrown
 * on for the router to follow.
 */
export async function errorFrom(action: () => Promise<ActionResult>): Promise<string | null> {
  try {
    return (await action()).error;
  } catch (error) {
    unstable_rethrow(error);
    return ACTION_FAILED;
  }
}
