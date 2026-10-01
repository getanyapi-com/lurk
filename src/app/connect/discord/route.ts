import type { NextRequest } from "next/server";
import { startChatInstall } from "@/app/connect/chatInstall";

/** Starts Add to Discord: remember which project asked, then send the person to Discord. */
export async function GET(request: NextRequest) {
  return startChatInstall("discord", request);
}
