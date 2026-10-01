import { config } from "@/lib/config";
import { CHANNEL_LABELS, type AlertCadence } from "./types";
import { CHAT_APP_ENV, chatAppCredentials, type ChatApp, type ChatAppCredentials } from "./config";

/**
 * Add to Slack and Add to Discord are one OAuth flow with different strings:
 * the person is sent to the service to pick a channel, and the code they come
 * back with is swapped for that channel's webhook. The webhook is the whole
 * channel, the same as one pasted by hand; nothing else is asked for or kept.
 */

/** What the cookie carries between the two legs of the flow. */
export type ChatInstallState = {
  state: string;
  projectId: string;
  cadence: AlertCadence;
  /** A path in the app to land on once the channel is added, when it was asked from somewhere other than settings. */
  back?: string | null;
};

/** What one install hands back: the webhook, and how the list names it when the service says. */
export type ChatInstall = { webhookUrl: string; label?: string };

type ChatAppSpec = {
  /** Holds the stash between the two legs, on /connect only. */
  cookie: string;
  /** Where the person picks a channel, and what is asked for there besides the app and the state. */
  authorize: { url: string; params: Record<string, string> };
  /** Where the code is swapped, and what the form carries besides the app, the code and the redirect. */
  token: { url: string; params: Record<string, string> };
  /** The webhook out of the service's answer, or the service's own reason it refused. */
  parse: (body: Record<string, unknown>, response: Response) => ChatInstall;
};

export type ChatAppFlow = {
  cookie: string;
  /** Where the person goes to pick a channel. Throws when no app is configured. */
  installUrl: (state: string) => string;
  /** Swaps the code the service sent back for the webhook the channel will use. */
  exchange: (code: string) => Promise<ChatInstall>;
};

/** Where the service sends the person back to, which each app registers with it. */
export function chatRedirectUri(app: ChatApp): string {
  return `${config().APP_URL.replace(/\/$/, "")}/connect/${app}/callback`;
}

function credentials(app: ChatApp): ChatAppCredentials {
  const found = chatAppCredentials(app);
  if (!found) {
    const env = CHAT_APP_ENV[app];
    throw new Error(`Add to ${CHANNEL_LABELS[app]} needs ${env.id} and ${env.secret}`);
  }
  return found;
}

function flow(app: ChatApp, spec: ChatAppSpec): ChatAppFlow {
  return {
    cookie: spec.cookie,
    installUrl(state) {
      const query = new URLSearchParams({
        client_id: credentials(app).clientId,
        ...spec.authorize.params,
        redirect_uri: chatRedirectUri(app),
        state,
      });
      return `${spec.authorize.url}?${query.toString()}`;
    },
    async exchange(code) {
      const { clientId, clientSecret } = credentials(app);
      const response = await fetch(spec.token.url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          ...spec.token.params,
          code,
          redirect_uri: chatRedirectUri(app),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return spec.parse(body, response);
    },
  };
}

type SlackAccess = {
  ok?: boolean;
  error?: string;
  team?: { name?: string };
  incoming_webhook?: { url?: string; channel?: string };
};

type DiscordToken = {
  error?: string;
  error_description?: string;
  webhook?: { id?: string; token?: string; url?: string };
};

export const CHAT_APPS: Record<ChatApp, ChatAppFlow> = {
  slack: flow("slack", {
    cookie: "slack_oauth",
    // The one scope it asks for: a webhook into a channel the person picks.
    authorize: { url: "https://slack.com/oauth/v2/authorize", params: { scope: "incoming-webhook" } },
    token: { url: "https://slack.com/api/oauth.v2.access", params: {} },
    parse: (raw, response) => {
      if (!response.ok) {
        throw new Error(`Slack returned ${response.status}`);
      }
      const body = raw as SlackAccess;
      if (!body.ok || !body.incoming_webhook?.url) {
        throw new Error(`Slack refused the install: ${body.error ?? "no webhook in the reply"}`);
      }
      // The list names it by the channel and the workspace.
      const label = [body.incoming_webhook.channel ?? "", body.team?.name ?? ""]
        .filter((one) => one.length > 0)
        .join(" in ");
      return { webhookUrl: body.incoming_webhook.url, label };
    },
  }),
  discord: flow("discord", {
    cookie: "discord_oauth",
    // The same one scope, a webhook into a channel of a server the person picks.
    authorize: {
      url: "https://discord.com/oauth2/authorize",
      params: { response_type: "code", scope: "webhook.incoming" },
    },
    token: { url: "https://discord.com/api/v10/oauth2/token", params: { grant_type: "authorization_code" } },
    parse: (raw, response) => {
      const body = raw as DiscordToken;
      const webhook = body.webhook;
      // When Discord leaves the URL out it is built from the webhook's id and token.
      const url =
        webhook?.url ??
        (webhook?.id && webhook.token ? `https://discord.com/api/webhooks/${webhook.id}/${webhook.token}` : null);
      if (!response.ok || !url) {
        throw new Error(
          `Discord refused the install: ${body.error_description ?? body.error ?? `status ${response.status}`}`,
        );
      }
      return { webhookUrl: url };
    },
  }),
};
