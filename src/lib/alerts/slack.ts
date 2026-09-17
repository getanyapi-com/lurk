import { randomBytes } from "node:crypto";
import { config } from "@/lib/config";
import { slackApp } from "./config";
import type { AlertCadence } from "./types";

/** The one scope Add to Slack asks for: a webhook into a channel the person picks. */
export const SLACK_SCOPE = "incoming-webhook";

export const SLACK_COOKIE = "slack_oauth";

/** What the cookie carries between the two legs of the flow. */
export type SlackInstallState = {
  state: string;
  projectId: string;
  cadence: AlertCadence;
};

export function slackRedirectUri(): string {
  return `${config().APP_URL.replace(/\/$/, "")}/connect/slack/callback`;
}

export function randomSlackState(): string {
  return randomBytes(24).toString("base64url");
}

/** Where the person goes to pick a channel. Throws when no Slack app is configured. */
export function slackInstallUrl(state: string): string {
  const app = slackApp();
  if (!app) {
    throw new Error("Add to Slack needs SLACK_CLIENT_ID and SLACK_CLIENT_SECRET");
  }
  const query = new URLSearchParams({
    client_id: app.clientId,
    scope: SLACK_SCOPE,
    redirect_uri: slackRedirectUri(),
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${query.toString()}`;
}

/** What one install hands back: the webhook, and where it lands, for the list. */
export type SlackInstall = {
  webhookUrl: string;
  channel: string;
  teamName: string;
};

type AccessResponse = {
  ok: boolean;
  error?: string;
  team?: { name?: string };
  incoming_webhook?: { url?: string; channel?: string };
};

/** Swaps the code Slack sent back for the webhook the channel will use. */
export async function exchangeSlackCode(code: string): Promise<SlackInstall> {
  const app = slackApp();
  if (!app) {
    throw new Error("Add to Slack needs SLACK_CLIENT_ID and SLACK_CLIENT_SECRET");
  }
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
      redirect_uri: slackRedirectUri(),
    }),
  });
  if (!response.ok) {
    throw new Error(`Slack returned ${response.status}`);
  }
  const body = (await response.json()) as AccessResponse;
  if (!body.ok || !body.incoming_webhook?.url) {
    throw new Error(`Slack refused the install: ${body.error ?? "no webhook in the reply"}`);
  }
  return {
    webhookUrl: body.incoming_webhook.url,
    channel: body.incoming_webhook.channel ?? "",
    teamName: body.team?.name ?? "",
  };
}

/** How the list names an installed channel: the channel and the workspace. */
export function slackLabel(install: SlackInstall): string {
  const parts = [install.channel, install.teamName].filter((one) => one.length > 0);
  return parts.join(" in ");
}
