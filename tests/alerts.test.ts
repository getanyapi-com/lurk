import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const azureSend = vi.fn();
const smtpSend = vi.fn();
const smtpTransport = vi.fn();

vi.mock("@azure/communication-email", () => ({
  EmailClient: class {
    constructor(public connectionString: string) {}
    beginSend = (message: unknown) => azureSend(this.connectionString, message);
  },
}));

vi.mock("nodemailer", () => ({
  createTransport: (url: string) => {
    smtpTransport(url);
    return { sendMail: smtpSend };
  },
}));
import { digestSubject, renderDigestHtml, renderDigestText } from "@/lib/alerts/digest";
import { payloadFor, sendToChannel } from "@/lib/alerts/send";
import { emailSender, slackApp } from "@/lib/alerts/config";
import {
  exchangeSlackCode,
  slackInstallUrl,
  slackLabel,
  slackRedirectUri,
} from "@/lib/alerts/slack";
import {
  CADENCE_MS,
  CHAT_LEAD_CAP,
  effectiveCadence,
  isDue,
  selectLeads,
  customWebhookAllowance,
  customWebhookCapText,
  type SelectableLead,
} from "@/lib/alerts/select";
import { describeTarget, normalizeTarget } from "@/lib/alerts/channels";
import { isPublicAddress } from "@/lib/alerts/outbound";
import type { Digest, DigestLead } from "@/lib/alerts/types";
import { TIERS } from "@/lib/tiers";

/** Local time on purpose: the timeline axis is drawn in the reader's hours. */
const NOW = new Date(2026, 8, 5, 9, 0, 0);
const SINCE = new Date(2026, 8, 5, 6, 0, 0);

function lead(overrides: Partial<SelectableLead> & { id: string }): SelectableLead {
  return {
    title: "Paying too much for a scraper",
    url: "https://www.reddit.com/r/SaaS/comments/x/",
    subreddit: "SaaS",
    author: "ella_builds",
    avatarUrl: null,
    score: 70,
    reason: "Names the tool and the price.",
    matchedPhrase: "paying too much",
    createdAt: new Date(2026, 8, 5, 7, 0, 0),
    status: "new",
    scoredAt: new Date(2026, 8, 5, 8, 0, 0),
    ...overrides,
  };
}

function digestOf(leads: DigestLead[]): Digest {
  return {
    projectName: "Acme",
    generatedAt: NOW,
    since: new Date(NOW.getTime() - CADENCE_MS.daily),
    cadence: "daily",
    leads,
    appUrl: "https://leads.example.com",
  };
}

describe("cadence", () => {
  it("holds a free channel to daily whatever it asked for", () => {
    expect(effectiveCadence("hourly", TIERS.free)).toBe("daily");
  });

  it("gives a connected wallet and a self-hosted instance what they asked", () => {
    expect(effectiveCadence("hourly", TIERS.connected)).toBe("hourly");
    expect(effectiveCadence("hourly", null)).toBe("hourly");
    expect(effectiveCadence("daily", TIERS.connected)).toBe("daily");
  });

  it("is due on the first run and once the cadence has elapsed", () => {
    expect(isDue(null, "daily", NOW)).toBe(true);
    expect(isDue(new Date(NOW.getTime() - CADENCE_MS.daily + 1000), "daily", NOW)).toBe(false);
    expect(isDue(new Date(NOW.getTime() - CADENCE_MS.daily), "daily", NOW)).toBe(true);
    expect(isDue(new Date(NOW.getTime() - CADENCE_MS.hourly), "hourly", NOW)).toBe(true);
  });
});

describe("what one message carries", () => {
  const since = SINCE;

  it("takes only new leads scored inside the window, best first", () => {
    const rows = [
      lead({ id: "old", scoredAt: new Date(2026, 8, 5, 5, 0, 0), score: 99 }),
      lead({ id: "hidden", status: "hidden", score: 98 }),
      lead({ id: "low", score: 61 }),
      lead({ id: "high", score: 88 }),
    ];
    expect(selectLeads(rows, since, null).map((one) => one.id)).toEqual(["high", "low"]);
  });

  it("caps a chat channel at the top five and leaves email uncapped", () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      lead({ id: `l${index}`, score: 90 - index }),
    );
    expect(selectLeads(rows, since, CHAT_LEAD_CAP)).toHaveLength(CHAT_LEAD_CAP);
    expect(selectLeads(rows, since, null)).toHaveLength(8);
  });

  it("hands back digest leads without the selection columns", () => {
    const [only] = selectLeads([lead({ id: "a" })], since, null);
    expect(only).not.toHaveProperty("status");
    expect(only).not.toHaveProperty("scoredAt");
  });
});

describe("custom webhook allowance", () => {
  it("counts only custom webhooks against the free cap", () => {
    expect(customWebhookAllowance(["email", "slack", "discord"], TIERS.free)).toMatchObject({
      used: 0,
      atCap: false,
    });
    expect(customWebhookAllowance(["slack", "webhook"], TIERS.free)).toMatchObject({
      used: 1,
      atCap: true,
    });
    expect(customWebhookCapText(["slack", "webhook"], TIERS.free)).toBe("1 of 1 custom webhook");
  });

  it("caps nothing for a connected wallet or a self-hosted instance", () => {
    expect(customWebhookAllowance(["webhook", "webhook"], TIERS.connected).atCap).toBe(false);
    expect(customWebhookCapText(["webhook"], null)).toBeNull();
  });
});

describe("targets", () => {
  it("takes the hosts Slack and Discord actually publish", () => {
    expect(normalizeTarget("slack", " https://hooks.slack.com/services/T/B/x ")).toBe(
      "https://hooks.slack.com/services/T/B/x",
    );
    expect(normalizeTarget("discord", "https://discord.com/api/webhooks/1/x")).toBe(
      "https://discord.com/api/webhooks/1/x",
    );
    expect(normalizeTarget("webhook", "https://example.com/hooks")).toBe(
      "https://example.com/hooks",
    );
    expect(normalizeTarget("email", "you@company.com")).toBe("you@company.com");
  });

  it("refuses an address that cannot be that channel", () => {
    expect(() => normalizeTarget("slack", "https://example.com/x")).toThrow(/hooks.slack.com/);
    expect(() => normalizeTarget("discord", "https://example.com/x")).toThrow(/discord.com/);
    expect(() => normalizeTarget("slack", "https://notslack.com/x")).toThrow(/hooks.slack.com/);
    expect(() => normalizeTarget("slack", "http://hooks.slack.com/x")).toThrow(/hooks.slack.com/);
    expect(() => normalizeTarget("discord", "https://notdiscord.com/x")).toThrow(/discord.com/);
    expect(() => normalizeTarget("webhook", "ftp://example.com/x")).toThrow(/http or https/);
    expect(() => normalizeTarget("email", "not-an-address")).toThrow(/email address/);
  });

  it("describes a pasted webhook without its secret segment", () => {
    expect(
      describeTarget("discord", "https://discord.com/api/webhooks/1550230446191808572/tok3n", null),
    ).toBe("discord.com/api/webhooks/1550230446191808572/...");
    expect(describeTarget("slack", "https://hooks.slack.com/services/T1/B2/s3cret", null)).toBe(
      "hooks.slack.com/services/T1/B2/...",
    );
    expect(describeTarget("slack", "https://hooks.slack.com/services/T1/B2/s3cret", "#alerts")).toBe(
      "#alerts",
    );
    expect(describeTarget("email", "you@company.com", null)).toBe("you@company.com");
    expect(describeTarget("webhook", "not-a-url", null)).toBe("Webhook");
  });
});

describe("chat payloads", () => {
  it("puts the headline and every lead in the Slack blocks", () => {
    const payload = payloadFor("slack", digestOf(selectLeads([lead({ id: "a" })], SINCE, null)));
    expect(payload).toMatchObject({ text: "1 new lead for Acme in the last 24 hours." });
    expect(JSON.stringify(payload)).toContain("https://www.reddit.com/r/SaaS/comments/x/");
  });

  it("keeps the Slack reason on its own line under the title", () => {
    const one = lead({ id: "a", reason: "Ready to switch." });
    const payload = payloadFor("slack", digestOf(selectLeads([one], SINCE, null)));
    const section = (payload as { blocks: Array<{ text: { text: string } }> }).blocks[1];
    expect(section.text.text).toMatch(/- .*\n_Ready to switch\._\n<https/);
  });

  it("gives Discord one embed per lead with the score and subreddit", () => {
    const payload = payloadFor("discord", digestOf(selectLeads([lead({ id: "a" })], SINCE, null)));
    expect(payload).toMatchObject({
      embeds: [
        {
          title: "Paying too much for a scraper",
          fields: [
            { name: "Score", value: "70" },
            { name: "Subreddit", value: "r/SaaS" },
          ],
        },
        { description: expect.stringContaining("utm_medium=discord") },
      ],
    });
  });

  it("ends every chat message and email with the AnyAPI line, tagged by channel", () => {
    const digest = digestOf(selectLeads([lead({ id: "a" })], SINCE, null));
    const slack = (payloadFor("slack", digest) as { blocks: unknown[] }).blocks.at(-1);
    expect(JSON.stringify(slack)).toContain("utm_source=lurk&utm_medium=slack");
    expect(renderDigestHtml(digest)).toContain("utm_medium=email");
    expect(renderDigestText(digest)).toContain("utm_medium=email");
    expect(JSON.stringify(payloadFor("webhook", digest))).not.toContain("AnyAPI");
  });

  it("hands a generic endpoint the digest unstyled", () => {
    const payload = payloadFor("webhook", digestOf(selectLeads([lead({ id: "a" })], SINCE, null)));
    expect(payload).toMatchObject({ project: "Acme", cadence: "daily" });
  });
});

/** Tag names in document order, so the snapshot is the table structure only. */
function structure(html: string): string {
  return (html.match(/<\/?[a-z!][a-z0-9]*/gi) ?? [])
    .map((tag) => tag.replace("<", ""))
    .join(" ");
}

describe("the digest email", () => {
  const html = renderDigestHtml(digestOf(selectLeads([lead({ id: "a" })], SINCE, null)));

  it("names the project and the count in the subject", () => {
    expect(digestSubject(digestOf([]))).toBe("0 new leads for Acme");
    expect(digestSubject(digestOf(selectLeads([lead({ id: "a" })], SINCE, null)))).toBe(
      "1 new lead for Acme",
    );
  });

  it("carries the headline, the author, the phrase and a source link", () => {
    expect(html).toContain("1 new lead for Acme in the last 24 hours.");
    expect(html).toContain("u/ella_builds");
    expect(html).toContain("r/SaaS");
    expect(html).toContain("paying too much");
    expect(html).toContain('<a href="https://www.reddit.com/r/SaaS/comments/x/"');
    expect(html).toContain("Source");
  });

  it("stays email safe: tables, inline styles, no stylesheet or class", () => {
    expect(html).not.toContain("<style");
    expect(html).not.toContain("class=");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("oklch");
    expect(html).toContain('role="presentation"');
  });

  it("draws one timeline column per hour from midnight to now", () => {
    const columns = (html.match(/valign="bottom"/g) ?? []).length;
    expect(columns).toBe(NOW.getHours() + 1);
  });

  it("escapes what a Reddit title can contain", () => {
    const nasty = renderDigestHtml(
      digestOf(selectLeads([lead({ id: "a", title: '<script>"x"</script>' })], SINCE, null)),
    );
    expect(nasty).not.toContain("<script>");
    expect(nasty).toContain("&lt;script&gt;");
  });

  it("keeps the same table structure", () => {
    expect(structure(html)).toMatchInlineSnapshot(`"!doctype html head meta meta title /title /head body table tr td table tr td table tr td img /td td /td /tr /table /td /tr tr td /td /tr tr td table tr td /td /tr tr td table tr td div /div div /div /td td div /div div /div /td td div /div div /div /td td div /div div /div /td td div /div div /div /td td div /div div /div /td td div /div div /div /td td div img /div div /div div /div /td td div /div div /div /td td div /div div /div /td /tr /table /td /tr /table /td /tr tr td table tr td img img /td td div /div div /div div /div div /div /td td div /div a /a /td /tr /table /td /tr tr td table tr td a /a /td /tr /table /td /tr tr td a /a a /a /td /tr /table /td /tr /table /body /html"`);
  });

  it("says plainly when nothing came in", () => {
    const quiet = renderDigestHtml(digestOf([]));
    expect(quiet).toContain("Nothing new in the last 24 hours.");
    expect(renderDigestText(digestOf([]))).toContain("0 new leads for Acme");
  });
});

describe("delivery", () => {
  /** Email delivery reads the app config, which wants these two whatever it is asked. */
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://reddit_leads@localhost:5433/reddit_leads");
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  /** A receiver on loopback, which only a self-hosted instance may deliver to. */
  async function receiver(status = 200, headers: Record<string, string> = {}) {
    const seen: { path: string; body: string }[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        seen.push({ path: request.url ?? "", body });
        response.writeHead(status, headers).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return { seen, url: `http://127.0.0.1:${port}/hooks`, close: () => server.close() };
  }

  it("posts the digest as JSON to a generic webhook", async () => {
    vi.stubEnv("ALERTS_ALLOW_PRIVATE_WEBHOOKS", "true");
    const hook = await receiver();
    try {
      await sendToChannel(
        "webhook",
        hook.url,
        digestOf(selectLeads([lead({ id: "a" })], SINCE, null)),
      );
      expect(hook.seen[0].path).toBe("/hooks");
      expect(JSON.parse(hook.seen[0].body)).toMatchObject({ project: "Acme" });
    } finally {
      hook.close();
    }
  });

  it("never sends to an address that is not on the public internet", async () => {
    const hook = await receiver();
    try {
      for (const target of [
        hook.url,
        hook.url.replace("127.0.0.1", "localhost"),
        hook.url.replace("127.0.0.1", "[::1]"),
        hook.url.replace("127.0.0.1", "[::ffff:127.0.0.1]"),
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/",
      ]) {
        await expect(sendToChannel("webhook", target, digestOf([]))).rejects.toThrow(
          /not on the public internet/,
        );
      }
      expect(hook.seen).toEqual([]);
    } finally {
      hook.close();
    }
  });

  it("treats a redirect as a failure instead of following it", async () => {
    vi.stubEnv("ALERTS_ALLOW_PRIVATE_WEBHOOKS", "true");
    const inner = await receiver();
    const hook = await receiver(307, { location: inner.url });
    try {
      await expect(sendToChannel("webhook", hook.url, digestOf([]))).rejects.toThrow(
        "Webhook returned 307",
      );
      expect(inner.seen).toEqual([]);
    } finally {
      hook.close();
      inner.close();
    }
  });

  it("knows a public address from a private one", () => {
    for (const address of ["8.8.8.8", "140.82.112.3", "2606:4700:4700::1111"]) {
      expect(isPublicAddress(address)).toBe(true);
    }
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "::",
      "fe80::1",
      "fd00::1",
      "::ffff:10.0.0.1",
      "not-an-address",
    ]) {
      expect(isPublicAddress(address)).toBe(false);
    }
  });

  it("reads a blank variable as an unset one and says what is missing", async () => {
    vi.stubEnv("AZURE_EMAIL_CONNECTION_STRING", "");
    vi.stubEnv("SMTP_URL", "");
    vi.stubEnv("ALERTS_FROM_EMAIL", "");
    expect(emailSender()).toBeNull();
    await expect(sendToChannel("email", "you@company.com", digestOf([]))).rejects.toThrow(
      "Email alerts need ALERTS_FROM_EMAIL and one of AZURE_EMAIL_CONNECTION_STRING or SMTP_URL",
    );
  });

  it("hands Azure the sender, the recipient and both bodies", async () => {
    vi.stubEnv("AZURE_EMAIL_CONNECTION_STRING", "endpoint=https://x.communication.azure.com/;accesskey=k");
    vi.stubEnv("ALERTS_FROM_EMAIL", "alerts@lurk.so");
    azureSend.mockReset();
    await sendToChannel(
      "email",
      "you@company.com",
      digestOf(selectLeads([lead({ id: "a" })], SINCE, null)),
    );
    expect(azureSend).toHaveBeenCalledTimes(1);
    const [connection, message] = azureSend.mock.calls[0];
    expect(connection).toContain("accesskey=k");
    expect(message).toMatchObject({
      senderAddress: "alerts@lurk.so",
      recipients: { to: [{ address: "you@company.com" }] },
      content: { subject: "1 new lead for Acme" },
    });
    expect(message.content.html).toContain("1 new lead for Acme in the last 24 hours.");
    expect(message.content.plainText).toContain("Paying too much for a scraper");
  });

  it("hands an SMTP server the same message through its URL", async () => {
    vi.stubEnv("SMTP_URL", "smtps://user:pass@smtp.example.com:465");
    vi.stubEnv("ALERTS_FROM_EMAIL", "alerts@lurk.so");
    smtpSend.mockReset();
    smtpTransport.mockReset();
    await sendToChannel("email", "you@company.com", digestOf([]));
    expect(smtpTransport).toHaveBeenCalledWith("smtps://user:pass@smtp.example.com:465");
    expect(smtpSend.mock.calls[0][0]).toMatchObject({
      from: "alerts@lurk.so",
      to: "you@company.com",
      subject: "0 new leads for Acme",
    });
  });

  it("prefers Azure over SMTP when both are set", () => {
    vi.stubEnv("ALERTS_FROM_EMAIL", "alerts@lurk.so");
    vi.stubEnv("SMTP_URL", "smtp://localhost:25");
    expect(emailSender()?.kind).toBe("smtp");
    vi.stubEnv("AZURE_EMAIL_CONNECTION_STRING", "endpoint=https://x/;accesskey=k");
    expect(emailSender()?.kind).toBe("azure");
  });

  it("needs a From address whichever service is set", () => {
    vi.stubEnv("AZURE_EMAIL_CONNECTION_STRING", "endpoint=https://x/;accesskey=k");
    vi.stubEnv("ALERTS_FROM_EMAIL", "");
    expect(emailSender()).toBeNull();
  });
});

describe("add to Slack", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://reddit_leads@localhost:5433/reddit_leads");
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
    vi.stubEnv("APP_URL", "https://lurk.so/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("is off until both halves of the app are set", () => {
    vi.stubEnv("SLACK_CLIENT_ID", "1.2");
    expect(slackApp()).toBeNull();
    expect(() => slackInstallUrl("s")).toThrow("SLACK_CLIENT_ID and SLACK_CLIENT_SECRET");
  });

  it("sends the person to Slack asking only for a webhook, back to this instance", () => {
    vi.stubEnv("SLACK_CLIENT_ID", "1.2");
    vi.stubEnv("SLACK_CLIENT_SECRET", "shh");
    const url = new URL(slackInstallUrl("state-1"));
    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(url.searchParams.get("scope")).toBe("incoming-webhook");
    expect(url.searchParams.get("client_id")).toBe("1.2");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://lurk.so/connect/slack/callback");
    expect(slackRedirectUri()).toBe("https://lurk.so/connect/slack/callback");
  });

  it("swaps the code for the webhook and names the channel and workspace", async () => {
    vi.stubEnv("SLACK_CLIENT_ID", "1.2");
    vi.stubEnv("SLACK_CLIENT_SECRET", "shh");
    const seen: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input), body: String(init?.body ?? "") });
      return Response.json({
        ok: true,
        team: { name: "AnyAPI" },
        incoming_webhook: { url: "https://hooks.slack.com/services/T/B/x", channel: "#leads" },
      });
    });
    const install = await exchangeSlackCode("code-9");
    expect(seen[0].url).toBe("https://slack.com/api/oauth.v2.access");
    const form = new URLSearchParams(seen[0].body);
    expect(form.get("code")).toBe("code-9");
    expect(form.get("client_secret")).toBe("shh");
    expect(form.get("redirect_uri")).toBe("https://lurk.so/connect/slack/callback");
    expect(install.webhookUrl).toBe("https://hooks.slack.com/services/T/B/x");
    expect(slackLabel(install)).toBe("#leads in AnyAPI");
  });

  it("says why Slack refused", async () => {
    vi.stubEnv("SLACK_CLIENT_ID", "1.2");
    vi.stubEnv("SLACK_CLIENT_SECRET", "shh");
    vi.stubGlobal("fetch", async () => Response.json({ ok: false, error: "invalid_code" }));
    await expect(exchangeSlackCode("stale")).rejects.toThrow("invalid_code");
  });
});
