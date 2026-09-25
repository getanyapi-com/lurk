"use server";

import { redirect } from "next/navigation";
import { enqueueOnce } from "@/jobs/enqueue";
import { acceptInvite, userForToken } from "@/lib/alerts/invite";

/** The press on the page the invite links to. The token is the only credential. */
export async function acceptInviteAction(token: string) {
  const userId = userForToken(token);
  if (!userId) {
    redirect("/alerts/on?done=invalid");
  }
  const accepted = await acceptInvite(userId);
  if (!accepted) {
    redirect("/alerts/on?done=invalid");
  }
  await enqueueOnce("digest");
  redirect(`/alerts/on?done=1&t=${encodeURIComponent(token)}`);
}
