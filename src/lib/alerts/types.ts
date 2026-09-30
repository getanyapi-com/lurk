/** Alert vocabulary shared by the job, the renderers and the settings screen. */

export const ALERT_CHANNELS = ["email", "slack", "discord", "webhook"] as const;

export type AlertChannel = (typeof ALERT_CHANNELS)[number];

/**
 * The only capped channel: posting a Slack or Discord message costs us nothing,
 * so a project may have as many of those as it likes.
 */
export const CUSTOM_WEBHOOK_CHANNEL: AlertChannel = "webhook";

export type AlertCadence = "daily" | "hourly";

export const CHANNEL_LABELS: Record<AlertChannel, string> = {
  email: "Email digest",
  slack: "Slack",
  discord: "Discord",
  webhook: "Webhook",
};

/** Where a lead was posted. An X lead is always an ask (src/lib/x/read.ts), never a reply. */
export type LeadPlatform = "reddit" | "x";

/** One lead as the digest shows it. Everything a message needs, nothing else. */
export type DigestLead = {
  id: string;
  platform: LeadPlatform;
  title: string;
  url: string;
  /** Null on X, which has no venue a post is in. */
  subreddit: string | null;
  author: string | null;
  avatarUrl: string | null;
  score: number;
  reason: string | null;
  matchedPhrase: string | null;
  /** The author's own words, trimmed by `excerptOf`. Null for a link post. */
  excerpt: string | null;
  /** True when the lead is a comment inside the thread rather than the post. */
  isComment: boolean;
  /** The post the lead is in, so replies can sit under their thread. */
  threadId?: string;
  numComments: number | null;
  createdAt: Date;
  /** One click that marks the thread replied, so nothing in it is sent again. Absent in the invite. */
  repliedUrl?: string;
  /** One click that mutes the lead's subreddit. Absent on X and in the invite. */
  muteUrl?: string;
};

/** One message: which project, what window, and the leads inside it. */
export type Digest = {
  projectName: string;
  generatedAt: Date;
  since: Date;
  cadence: AlertCadence;
  leads: DigestLead[];
  /** How many more the window held than the message lists. */
  more?: number;
  /** The platforms those are on, Reddit first, so the email links where they are listed. */
  morePlatforms?: LeadPlatform[];
  appUrl: string;
};

export function isAlertChannel(value: string): value is AlertChannel {
  return (ALERT_CHANNELS as readonly string[]).includes(value);
}
