import type { NextRequest } from "next/server";
import { startChatInstall } from "@/app/connect/chatInstall";

/** Starts Add to Slack: remember which project asked, then send the person to Slack. */
export async function GET(request: NextRequest) {
  return startChatInstall("slack", request);
}
