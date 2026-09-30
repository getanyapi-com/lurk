import { NextResponse, type NextRequest } from "next/server";
import { requireLocalUser } from "@/lib/auth";
import { randomDiscordState, discordInstallUrl, DISCORD_COOKIE, type DiscordInstallState } from "@/lib/alerts/discord";
import { safeReturnPath } from "@/lib/alerts/offer";
import { projectForUser } from "@/lib/projects";

/** Starts Add to Discord: remember which project asked, then send the person to Discord. */
export async function GET(request: NextRequest) {
  const user = await requireLocalUser();
  const projectId = request.nextUrl.searchParams.get("project") ?? "";
  const project = await projectForUser(user.id, projectId);
  if (!project) {
    return NextResponse.redirect(new URL("/app/settings/alerts", request.nextUrl));
  }
  const stash: DiscordInstallState = {
    state: randomDiscordState(),
    projectId,
    cadence: request.nextUrl.searchParams.get("cadence") === "hourly" ? "hourly" : "daily",
    back: safeReturnPath(request.nextUrl.searchParams.get("back")),
  };
  const response = NextResponse.redirect(discordInstallUrl(stash.state));
  response.cookies.set(DISCORD_COOKIE, JSON.stringify(stash), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/connect",
    maxAge: 600,
  });
  return response;
}
