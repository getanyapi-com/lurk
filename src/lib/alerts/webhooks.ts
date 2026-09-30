import { PRODUCT_NAME } from "@/lib/brand";
import { shortAge } from "@/lib/format";
import { postJson } from "./outbound";
import { actLinksOf, handleOf, PLATFORM_NAME, repliesPhrase, showsScore, venueOf, X_ASK_LABEL } from "./platform";
import { ANYAPI_PLUG, ANYAPI_PLUG_CTA, anyapiAlertUrl } from "./plug";
import { EMAIL_COLORS, scoreColor } from "./tokens";
import type { Digest, DigestLead } from "./types";

function headline(digest: Digest): string {
  const count = digest.leads.length;
  const window = digest.cadence === "hourly" ? "in the last hour" : "in the last 24 hours";
  return `${count} new ${count === 1 ? "lead" : "leads"} for ${digest.projectName} ${window}.`;
}

/** Slack reads these three as markup wherever they appear, a Reddit title included. */
function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * What the author wrote, or the matched phrase when there is no body to quote.
 * The rubric sentence in `reason` reads the same on every lead, so an alert
 * leaves it to the feed and spends the room on the thread.
 */
function quoted(lead: DigestLead): string | null {
  if (lead.excerpt) {
    return lead.excerpt;
  }
  return lead.matchedPhrase && lead.matchedPhrase !== lead.title ? lead.matchedPhrase : null;
}

/** Where the lead sits: the subreddit or X, who wrote it, how old, how busy the thread is. */
function where(lead: DigestLead, now: Date): string[] {
  const comments = lead.numComments == null ? [] : [repliesPhrase(lead.numComments, lead.platform)];
  return [
    venueOf(lead),
    `${lead.isComment ? "comment by " : ""}${handleOf(lead)}`,
    `${shortAge(lead.createdAt, now)} ago`,
    ...comments,
  ];
}

/** The score badge's colour, or on X, which has no score to show, the ink's. */
function stripeColor(lead: DigestLead): string {
  return showsScore(lead) ? scoreColor(lead.score) : EMAIL_COLORS.fg;
}

/**
 * What a Slack byline opens with: the score, then the subreddit. An X ask says
 * what it is in the score's place, which names X as well.
 */
function slackByline(lead: DigestLead, now: Date): string {
  const [venue, ...rest] = where(lead, now);
  const head = showsScore(lead) ? [`*Score ${lead.score}*`, venue] : [`*${X_ASK_LABEL}*`];
  const acts = actLinksOf(lead).map((link) => `<${link.url}|${link.label}>`);
  return [...head, ...rest, ...acts].join("  ·  ");
}

/** Mark replied and the mute as Discord markdown, under the author's words. */
function discordDescription(lead: DigestLead): string | undefined {
  const acts = actLinksOf(lead)
    .map((link) => `[${link.label}](${link.url})`)
    .join(" · ");
  const quote = quoted(lead);
  const text = [quote, acts].filter((part): part is string => !!part).join("\n\n");
  return text || undefined;
}

/**
 * One lead as a Slack attachment, the only Slack shape with a coloured stripe:
 * the stripe is the score badge's colour, the byline carries the author's face.
 * No button, because a link button makes Slack call an interactivity endpoint
 * the incoming-webhook app does not have, and shows the reader a warning.
 */
function slackLead(lead: DigestLead, now: Date) {
  const quote = quoted(lead);
  const title = `*<${lead.url}|${slackEscape(lead.title)}>*`;
  const face = lead.avatarUrl
    ? [{ type: "image", image_url: lead.avatarUrl, alt_text: handleOf(lead) }]
    : [];
  return {
    color: stripeColor(lead),
    fallback: showsScore(lead)
      ? `${lead.score} ${venueOf(lead)} - ${lead.title}`
      : `${X_ASK_LABEL} - ${lead.title}`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: quote ? `${title}\n${slackEscape(quote)}` : title },
      },
      {
        type: "context",
        elements: [...face, { type: "mrkdwn", text: slackByline(lead, now) }],
      },
    ],
  };
}

/**
 * Slack: a headline, then one attachment per lead with the linked title over
 * the author's own words and a quiet byline saying where it is.
 */
export function slackPayload(digest: Digest) {
  return {
    text: headline(digest),
    blocks: [{ type: "header", text: { type: "plain_text", text: headline(digest) } }],
    attachments: [
      ...digest.leads.map((lead) => slackLead(lead, digest.generatedAt)),
      {
        blocks: [
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `${ANYAPI_PLUG} <${anyapiAlertUrl("slack")}|${ANYAPI_PLUG_CTA}>`,
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Discord embeds, one per lead, so each carries its own clickable title. The
 * AnyAPI line is its own embed after them: Discord allows ten, and the digest
 * carries five leads.
 */
export function discordPayload(digest: Digest) {
  return {
    // A webhook posts under whatever name it was made with; this keeps it lurk.
    username: PRODUCT_NAME,
    avatar_url: `${digest.appUrl}/email/lurk-discord.png`,
    content: headline(digest),
    embeds: [
      ...digest.leads.map((lead) => ({
        author: {
          name: `${lead.isComment ? "comment by " : ""}${handleOf(lead)}`,
          icon_url: lead.avatarUrl ?? undefined,
        },
        title: lead.title.slice(0, 256),
        url: lead.url,
        description: discordDescription(lead),
        color: parseInt(stripeColor(lead).slice(1), 16),
        timestamp: lead.createdAt.toISOString(),
        fields: showsScore(lead)
          ? [
              { name: "Score", value: String(lead.score), inline: true },
              { name: "Subreddit", value: `r/${lead.subreddit}`, inline: true },
            ]
          : [{ name: "Lead", value: X_ASK_LABEL, inline: true }],
        footer: {
          text:
            lead.numComments == null
              ? PLATFORM_NAME[lead.platform]
              : repliesPhrase(lead.numComments, lead.platform),
        },
      })),
      {
        description: `${ANYAPI_PLUG} [${ANYAPI_PLUG_CTA}](${anyapiAlertUrl("discord")})`,
      },
    ],
  };
}

/**
 * The shape a generic endpoint gets: the digest, unstyled. `leads` is Reddit's
 * and keeps the shape it had before X, so a receiver built against it never
 * meets a lead it cannot read. X asks come in their own `xLeads`, there only
 * when the message carries one: no subreddit, no comment flag, since an X lead
 * is always an ask, and no score, which only orders asks.
 */
export function genericPayload(digest: Digest) {
  const asks = digest.leads.filter((lead) => lead.platform === "x");
  return {
    project: digest.projectName,
    generatedAt: digest.generatedAt.toISOString(),
    since: digest.since.toISOString(),
    cadence: digest.cadence,
    leads: digest.leads.filter((lead) => lead.platform === "reddit").map((lead) => ({
      id: lead.id,
      title: lead.title,
      url: lead.url,
      subreddit: lead.subreddit,
      author: lead.author,
      score: lead.score,
      reason: lead.reason,
      matchedPhrase: lead.matchedPhrase,
      excerpt: lead.excerpt,
      isComment: lead.isComment,
      numComments: lead.numComments,
      createdAt: lead.createdAt.toISOString(),
      repliedUrl: lead.repliedUrl,
      muteUrl: lead.muteUrl,
    })),
    ...(asks.length > 0
      ? {
          xLeads: asks.map((lead) => ({
            id: lead.id,
            platform: "x" as const,
            title: lead.title,
            url: lead.url,
            author: lead.author,
            reason: lead.reason,
            matchedPhrase: lead.matchedPhrase,
            excerpt: lead.excerpt,
            numReplies: lead.numComments,
            createdAt: lead.createdAt.toISOString(),
            repliedUrl: lead.repliedUrl,
          })),
        }
      : {}),
  };
}

export type WebhookBody = ReturnType<
  typeof slackPayload | typeof discordPayload | typeof genericPayload
>;

/**
 * Posts one message. A non-2xx is an error the job records against the run, and
 * that includes a redirect: the address checked is the only one ever contacted.
 */
export async function postWebhook(url: string, body: WebhookBody): Promise<void> {
  const status = await postJson(url, body);
  if (status < 200 || status >= 300) {
    throw new Error(`Webhook returned ${status}`);
  }
}
