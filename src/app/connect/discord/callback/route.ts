import { NextResponse, type NextRequest } from "next/server";
import { enqueueOnce } from "@/jobs/enqueue";
import { addChannel } from "@/lib/alerts/channels";
import { DISCORD_COOKIE, exchangeDiscordCode, type DiscordInstallState } from "@/lib/alerts/discord";
import { safeReturnPath } from "@/lib/alerts/offer";
import { requireLocalUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { projectForUser } from "@/lib/projects";
import { tierForUser } from "@/lib/tier";

function alertsUrl(projectId: string | null, status: string): string {
  const query = new URLSearchParams({ discord: status });
  if (projectId) {
    query.set("project", projectId);
  }
  return `${config().APP_URL.replace(/\/$/, "")}/app/settings/alerts?${query.toString()}`;
}

function clearing(response: NextResponse): NextResponse {
  response.cookies.set(DISCORD_COOKIE, "", { path: "/connect", maxAge: 0 });
  return response;
}

/** Finishes Add to Discord: check the state, take the webhook, add the channel. */
export async function GET(request: NextRequest) {
  const stashed = request.cookies.get(DISCORD_COOKIE)?.value;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!stashed || !code || !state) {
    return clearing(NextResponse.redirect(alertsUrl(null, "failed")));
  }
  const stash = JSON.parse(stashed) as DiscordInstallState;
  if (state !== stash.state) {
    return clearing(NextResponse.redirect(alertsUrl(stash.projectId, "failed")));
  }
  const user = await requireLocalUser();
  const project = await projectForUser(user.id, stash.projectId);
  if (!project) {
    return clearing(NextResponse.redirect(alertsUrl(null, "failed")));
  }
  try {
    const install = await exchangeDiscordCode(code);
    const { limits } = await tierForUser(user.id);
    await addChannel({
      projectId: project.id,
      channel: "discord",
      target: install.webhookUrl,
      cadence: stash.cadence,
      limits,
    });
    await enqueueOnce("digest");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return clearing(NextResponse.redirect(alertsUrl(project.id, `failed:${reason}`)));
  }
  // Asked from the offer on a new project's feed, the person goes back to the leads.
  const back = safeReturnPath(stash.back);
  return clearing(
    NextResponse.redirect(
      back ? `${config().APP_URL.replace(/\/$/, "")}${back}` : alertsUrl(project.id, "connected"),
    ),
  );
}
