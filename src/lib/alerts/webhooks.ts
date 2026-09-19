import { shortAge } from "@/lib/format";
import { postJson } from "./outbound";
import { ANYAPI_PLUG, ANYAPI_PLUG_CTA, anyapiAlertUrl } from "./plug";
import { scoreColor } from "./tokens";
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

/** Where the lead sits: the subreddit, who wrote it, how old, how busy the thread is. */
function where(lead: DigestLead, now: Date): string[] {
  const comments =
    lead.numComments == null
      ? []
      : [`${lead.numComments} ${lead.numComments === 1 ? "comment" : "comments"}`];
  return [
    `r/${lead.subreddit}`,
    `${lead.isComment ? "comment by " : ""}u/${lead.author ?? "unknown"}`,
    `${shortAge(lead.createdAt, now)} ago`,
    ...comments,
  ];
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
    ? [{ type: "image", image_url: lead.avatarUrl, alt_text: `u/${lead.author ?? "unknown"}` }]
    : [];
  return {
    color: scoreColor(lead.score),
    fallback: `${lead.score} r/${lead.subreddit} - ${lead.title}`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: quote ? `${title}\n${slackEscape(quote)}` : title },
      },
      {
        type: "context",
        elements: [
          ...face,
          { type: "mrkdwn", text: [`*Score ${lead.score}*`, ...where(lead, now)].join("  ·  ") },
        ],
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
    content: headline(digest),
    embeds: [
      ...digest.leads.map((lead) => ({
        author: {
          name: `${lead.isComment ? "comment by " : ""}u/${lead.author ?? "unknown"}`,
          icon_url: lead.avatarUrl ?? undefined,
        },
        title: lead.title.slice(0, 256),
        url: lead.url,
        description: quoted(lead) ?? undefined,
        color: parseInt(scoreColor(lead.score).slice(1), 16),
        timestamp: lead.createdAt.toISOString(),
        fields: [
          { name: "Score", value: String(lead.score), inline: true },
          { name: "Subreddit", value: `r/${lead.subreddit}`, inline: true },
        ],
        footer: {
          text:
            lead.numComments == null
              ? "Reddit"
              : `${lead.numComments} ${lead.numComments === 1 ? "comment" : "comments"}`,
        },
      })),
      {
        description: `${ANYAPI_PLUG} [${ANYAPI_PLUG_CTA}](${anyapiAlertUrl("discord")})`,
      },
    ],
  };
}

/** The shape a generic endpoint gets: the digest, unstyled. */
export function genericPayload(digest: Digest) {
  return {
    project: digest.projectName,
    generatedAt: digest.generatedAt.toISOString(),
    since: digest.since.toISOString(),
    cadence: digest.cadence,
    leads: digest.leads.map((lead) => ({
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
    })),
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
