import { config } from "@/lib/config";

/**
 * Which service carries the digest email. Azure Communication Services and a
 * plain SMTP server are the self-hosted choices; Resend is the hosted default.
 */
export type EmailSender =
  | { kind: "azure"; connectionString: string; from: string }
  | { kind: "smtp"; url: string; from: string }
  | { kind: "resend"; apiKey: string; from: string };

export const EMAIL_SENDER_ENV = "AZURE_EMAIL_CONNECTION_STRING, SMTP_URL or RESEND_API_KEY";

/** What a real send needs, or null when no email service is configured. */
export function emailSender(): EmailSender | null {
  const { AZURE_EMAIL_CONNECTION_STRING, SMTP_URL, RESEND_API_KEY, ALERTS_FROM_EMAIL } = config();
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
  if (RESEND_API_KEY) {
    return { kind: "resend", apiKey: RESEND_API_KEY, from };
  }
  return null;
}

export type SlackApp = { clientId: string; clientSecret: string };

/** The Slack app behind Add to Slack, or null when only paste-a-URL is on. */
export function slackApp(): SlackApp | null {
  const { SLACK_CLIENT_ID, SLACK_CLIENT_SECRET } = config();
  if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET) {
    return null;
  }
  return { clientId: SLACK_CLIENT_ID, clientSecret: SLACK_CLIENT_SECRET };
}
