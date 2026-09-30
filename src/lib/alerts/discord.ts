import { config } from "@/lib/config";
import { discordApp } from "./config";
import { randomSlackState, type SlackInstallState } from "./slack";

/** The one scope Add to Discord asks for: a webhook into a channel the person picks. */
export const DISCORD_SCOPE = "webhook.incoming";

export const DISCORD_COOKIE = "discord_oauth";

/** The same stash Add to Slack keeps between its two legs. */
export type DiscordInstallState = SlackInstallState;

export const randomDiscordState = randomSlackState;

export function discordRedirectUri(): string {
  return `${config().APP_URL.replace(/\/$/, "")}/connect/discord/callback`;
}

/** Where the person goes to pick a server and channel. Throws when no Discord app is configured. */
export function discordInstallUrl(state: string): string {
  const app = discordApp();
  if (!app) {
    throw new Error("Add to Discord needs DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET");
  }
  const query = new URLSearchParams({
    client_id: app.clientId,
    response_type: "code",
    scope: DISCORD_SCOPE,
    redirect_uri: discordRedirectUri(),
    state,
  });
  return `https://discord.com/oauth2/authorize?${query.toString()}`;
}

/** What one install hands back: the webhook, and the channel it posts to. */
export type DiscordInstall = { webhookUrl: string; channelId: string };

type TokenResponse = {
  error?: string;
  error_description?: string;
  webhook?: { id?: string; token?: string; url?: string; channel_id?: string };
};

/** Swaps the code Discord sent back for the webhook the channel will use. */
export async function exchangeDiscordCode(code: string): Promise<DiscordInstall> {
  const app = discordApp();
  if (!app) {
    throw new Error("Add to Discord needs DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET");
  }
  const response = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: discordRedirectUri(),
    }),
  });
  const body = (await response.json().catch(() => ({}))) as TokenResponse;
  const webhook = body.webhook;
  const url =
    webhook?.url ?? (webhook?.id && webhook.token ? `https://discord.com/api/webhooks/${webhook.id}/${webhook.token}` : null);
  if (!response.ok || !url) {
    throw new Error(`Discord refused the install: ${body.error_description ?? body.error ?? `status ${response.status}`}`);
  }
  return { webhookUrl: url, channelId: webhook?.channel_id ?? "" };
}
