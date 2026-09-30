"use server";

import { redirect } from "next/navigation";
import { actForToken } from "@/lib/alerts/act";
import { markThreadReplied, reopenThread } from "@/lib/handled";
import { addMute, removeMuteValue } from "@/lib/mutes";

/** The press on the page an alert's link opens. The token is the only credential. */
export async function doActAction(token: string) {
  const act = actForToken(token);
  if (!act) {
    redirect("/alerts/act?done=invalid");
  }
  if (act.act === "replied") {
    await markThreadReplied(act.projectId, act.platform, act.threadId);
  } else {
    await addMute(act.projectId, "subreddit", act.subreddit);
  }
  redirect(`/alerts/act?done=1&t=${encodeURIComponent(token)}`);
}

/** Undo, from the same page, with the same token. */
export async function undoActAction(token: string) {
  const act = actForToken(token);
  if (!act) {
    redirect("/alerts/act?done=invalid");
  }
  if (act.act === "replied") {
    await reopenThread(act.projectId, act.platform, act.threadId);
  } else {
    await removeMuteValue(act.projectId, "subreddit", act.subreddit.toLowerCase());
  }
  redirect(`/alerts/act?undone=1&t=${encodeURIComponent(token)}`);
}
