import { postJson } from "./outbound";
import { ANYAPI_PLUG, ANYAPI_PLUG_CTA, anyapiAlertUrl } from "./plug";
import type { Digest, DigestLead } from "./types";

function headline(digest: Digest): string {
  const count = digest.leads.length;
  const window = digest.cadence === "hourly" ? "in the last hour" : "in the last 24 hours";
  return `${count} new ${count === 1 ? "lead" : "leads"} for ${digest.projectName} ${window}.`;
}

function line(lead: DigestLead): string {
  const reason = lead.reason ? `\n_${lead.reason}_` : "";
  return `*${lead.score}* r/${lead.subreddit} - ${lead.title}${reason}`;
}

/** Slack Block Kit: a headline and one section per lead with its link. */
export function slackPayload(digest: Digest) {
  return {
    text: headline(digest),
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: headline(digest) } },
      ...digest.leads.map((lead) => ({
        type: "section",
        text: { type: "mrkdwn", text: `${line(lead)}\n<${lead.url}|Source>` },
      })),
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
        title: lead.title.slice(0, 256),
        url: lead.url,
        description: lead.reason ?? undefined,
        fields: [
          { name: "Score", value: String(lead.score), inline: true },
          { name: "Subreddit", value: `r/${lead.subreddit}`, inline: true },
        ],
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
