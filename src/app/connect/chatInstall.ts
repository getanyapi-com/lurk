import { NextResponse, type NextRequest } from "next/server";
import { addChannel } from "@/lib/alerts/channels";
import { CHAT_APPS, type ChatInstallState } from "@/lib/alerts/chatApps";
import type { ChatApp } from "@/lib/alerts/config";
import { safeReturnPath } from "@/lib/alerts/offer";
import { requireLocalUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { randomState } from "@/lib/oauth";
import { projectForUser } from "@/lib/projects";

/**
 * The two legs of Add to Slack and Add to Discord, which /connect/slack and
 * /connect/discord and their callbacks hand straight here. The callback paths
 * are the redirect URIs each service's app has registered, and an install under
 * way across a deploy still carries the old cookie, so both names stay.
 */

/** Starts the install: remember which project asked, then send the person to the service. */
export async function startChatInstall(app: ChatApp, request: NextRequest): Promise<NextResponse> {
  const user = await requireLocalUser();
  const projectId = request.nextUrl.searchParams.get("project") ?? "";
  const project = await projectForUser(user.id, projectId);
  if (!project) {
    return NextResponse.redirect(new URL("/app/settings/alerts", request.nextUrl));
  }
  const stash: ChatInstallState = {
    state: randomState(),
    projectId,
    cadence: request.nextUrl.searchParams.get("cadence") === "hourly" ? "hourly" : "daily",
    back: safeReturnPath(request.nextUrl.searchParams.get("back")),
  };
  const response = NextResponse.redirect(CHAT_APPS[app].installUrl(stash.state));
  response.cookies.set(CHAT_APPS[app].cookie, JSON.stringify(stash), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/connect",
    maxAge: 600,
  });
  return response;
}

/** Finishes the install: check the state, take the webhook, add the channel. */
export async function finishChatInstall(app: ChatApp, request: NextRequest): Promise<NextResponse> {
  const { cookie, exchange } = CHAT_APPS[app];
  const appUrl = config().APP_URL;
  // The settings page says how it went, under ?slack= or ?discord=.
  const alertsUrl = (projectId: string | null, status: string) => {
    const query = new URLSearchParams({ [app]: status });
    if (projectId) {
      query.set("project", projectId);
    }
    return `${appUrl}/app/settings/alerts?${query.toString()}`;
  };
  const clearing = (response: NextResponse) => {
    response.cookies.set(cookie, "", { path: "/connect", maxAge: 0 });
    return response;
  };

  const stashed = request.cookies.get(cookie)?.value;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!stashed || !code || !state) {
    return clearing(NextResponse.redirect(alertsUrl(null, "failed")));
  }
  const stash = JSON.parse(stashed) as ChatInstallState;
  if (state !== stash.state) {
    return clearing(NextResponse.redirect(alertsUrl(stash.projectId, "failed")));
  }
  const user = await requireLocalUser();
  const project = await projectForUser(user.id, stash.projectId);
  if (!project) {
    return clearing(NextResponse.redirect(alertsUrl(null, "failed")));
  }
  try {
    const install = await exchange(code);
    await addChannel({
      projectId: project.id,
      userId: user.id,
      channel: app,
      target: install.webhookUrl,
      label: install.label,
      cadence: stash.cadence,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return clearing(NextResponse.redirect(alertsUrl(project.id, `failed:${reason}`)));
  }
  // The offer on a new project's feed asks for a channel mid-sweep, so the
  // person goes back to the leads they were watching rather than to settings.
  const back = safeReturnPath(stash.back);
  return clearing(NextResponse.redirect(back ? `${appUrl}${back}` : alertsUrl(project.id, "connected")));
}
