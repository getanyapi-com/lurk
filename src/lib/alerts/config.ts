import { config } from "@/lib/config";

/**
 * Which service carries the digest email: Azure Communication Services, which
 * the hosted instance uses, or any plain SMTP server.
 */
export type EmailSender =
  | { kind: "azure"; connectionString: string; from: string }
  | { kind: "smtp"; url: string; from: string };

export const EMAIL_SENDER_ENV = "AZURE_EMAIL_CONNECTION_STRING or SMTP_URL";

/** What a real send needs, or null when no email service is configured. */
export function emailSender(): EmailSender | null {
  const { AZURE_EMAIL_CONNECTION_STRING, SMTP_URL, ALERTS_FROM_EMAIL } = config();
  if (!ALERTS_FROM_EMAIL) {
    return null;
  }
  const from = ALERTS_FROM_EMAIL;
  if (AZURE_EMAIL_CONNECTION_STRING) {
    return { kind: "azure", connectionString: AZURE_EMAIL_CONNECTION_STRING, from };
  }
  if (SMTP_URL) {
    return { kind: "smtp", url: SMTP_URL, from };
  }
  return null;
}

/**
 * Whether the one-time ask to turn alerts on goes out: ALERT_INVITES is on and
 * there is an email service to carry it. A pass marks each person asked before
 * it sends, so one with nothing to send through would spend everybody's ask.
 */
export function alertInvitesOn(): boolean {
  return config().ALERT_INVITES && emailSender() !== null;
}

/** The chat services a person can add a channel from in one click, rather than by pasting a webhook. */
export type ChatApp = "slack" | "discord";

export type ChatAppCredentials = { clientId: string; clientSecret: string };

/** The two settings each service's app is made of. */
export const CHAT_APP_ENV = {
  slack: { id: "SLACK_CLIENT_ID", secret: "SLACK_CLIENT_SECRET" },
  discord: { id: "DISCORD_CLIENT_ID", secret: "DISCORD_CLIENT_SECRET" },
} as const;

/** The app behind Add to Slack or Add to Discord, or null when only paste-a-URL is on. */
export function chatAppCredentials(app: ChatApp): ChatAppCredentials | null {
  const env = config();
  const clientId = env[CHAT_APP_ENV[app].id];
  const clientSecret = env[CHAT_APP_ENV[app].secret];
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret };
}

/** Whether the screens offer Add to Slack or Add to Discord at all. */
export function chatAppConfigured(app: ChatApp): boolean {
  return chatAppCredentials(app) !== null;
}
