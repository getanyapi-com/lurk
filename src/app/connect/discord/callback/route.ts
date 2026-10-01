import type { NextRequest } from "next/server";
import { finishChatInstall } from "@/app/connect/chatInstall";

/** Finishes Add to Discord: check the state, take the webhook, add the channel. */
export async function GET(request: NextRequest) {
  return finishChatInstall("discord", request);
}
