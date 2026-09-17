import { NextResponse, type NextRequest } from "next/server";
import { requireLocalUser } from "@/lib/auth";
import { randomSlackState, slackInstallUrl, SLACK_COOKIE, type SlackInstallState } from "@/lib/alerts/slack";
import { projectForUser } from "@/lib/projects";

/** Starts Add to Slack: remember which project asked, then send the person to Slack. */
export async function GET(request: NextRequest) {
  const user = await requireLocalUser();
  const projectId = request.nextUrl.searchParams.get("project") ?? "";
  const project = await projectForUser(user.id, projectId);
  if (!project) {
    return NextResponse.redirect(new URL("/app/settings/alerts", request.nextUrl));
  }
  const stash: SlackInstallState = {
    state: randomSlackState(),
    projectId,
    cadence: request.nextUrl.searchParams.get("cadence") === "hourly" ? "hourly" : "daily",
  };
  const response = NextResponse.redirect(slackInstallUrl(stash.state));
  response.cookies.set(SLACK_COOKIE, JSON.stringify(stash), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/connect",
    maxAge: 600,
  });
  return response;
}
