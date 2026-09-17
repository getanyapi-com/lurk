import { digestSubject, renderDigestHtml, renderDigestText } from "./digest";
import { sendEmail } from "./email";
import { discordPayload, genericPayload, postWebhook, slackPayload } from "./webhooks";
import type { AlertChannel, Digest } from "./types";

/** What a webhook channel would receive, so a test can read it without sending. */
export function payloadFor(channel: AlertChannel, digest: Digest) {
  if (channel === "slack") {
    return slackPayload(digest);
  }
  return channel === "discord" ? discordPayload(digest) : genericPayload(digest);
}

/** Delivers one digest down one channel. Throws so the caller can record why. */
export async function sendToChannel(
  channel: AlertChannel,
  target: string,
  digest: Digest,
): Promise<void> {
  if (channel === "email") {
    await sendEmail({
      to: target,
      subject: digestSubject(digest),
      html: renderDigestHtml(digest),
      text: renderDigestText(digest),
    });
    return;
  }
  await postWebhook(target, payloadFor(channel, digest));
}
