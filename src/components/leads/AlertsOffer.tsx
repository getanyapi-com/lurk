"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Mail, X } from "lucide-react";
import { discordAlertsAction, dismissAlertsOfferAction, emailAlertsAction } from "@/app/app/leads/actions";
import { ChannelMark } from "@/components/alerts/ChannelMark";
import { Fleeting } from "@/components/Fleeting";
import { PillTabs } from "@/components/PillTabs";
import { Button, buttonVariants } from "@/components/ui/button";
import { errorFrom } from "@/lib/actionError";
import type { ActionResult } from "@/lib/actionResult";
import type { AlertsOffer as Offer, OfferPreview } from "@/lib/alerts/offer";
import { EMAIL_COLORS } from "@/lib/alerts/tokens";
import { cn } from "@/lib/utils";

type AlertsOfferProps = {
  projectId: string;
  offer: Offer;
  /** The messages as the digest job would send them; null once the offer stops asking. */
  preview: OfferPreview | null;
  /** True when this instance has a Slack app, so Slack is one click rather than a pasted URL. */
  slackInstall: boolean;
  /** The same for Discord. */
  discordInstall: boolean;
};

type Shown = "email" | "slack" | "discord";

/** The email's own width plus the gutter its outer table leaves, so it scales as one picture. */
const EMAIL_WIDTH = 616;
/** How long the feed is on screen before the offer opens over it, so the first leads are seen first. */
const OPEN_AFTER_MS = 2500;
/** Past this the email is cut with a fade: the header and first cards say enough. */
const PREVIEW_MAX_HEIGHT = 420;

/** The real digest email, rendered by the sender and shrunk to the column. */
function EmailBody({ html }: { html: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const element = box.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = width / EMAIL_WIDTH;
  const shown = height ? Math.min(height * scale, PREVIEW_MAX_HEIGHT) : PREVIEW_MAX_HEIGHT;
  return (
    <div ref={box} className="relative overflow-hidden" style={{ height: shown, background: EMAIL_COLORS.bg }}>
      {width ? (
        <iframe
          title="The daily email"
          srcDoc={html}
          // Same origin so its height can be read; no scripts, and it takes no clicks.
          sandbox="allow-same-origin"
          tabIndex={-1}
          aria-hidden="true"
          onLoad={(event) => setHeight(event.currentTarget.contentDocument?.documentElement.scrollHeight ?? 0)}
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
          style={{ width: EMAIL_WIDTH, height: height || 1600, transform: `scale(${scale})` }}
        />
      ) : null}
      {height * scale > PREVIEW_MAX_HEIGHT ? (
        <div
          className="absolute inset-x-0 bottom-0 h-16"
          style={{ background: `linear-gradient(to bottom, transparent, ${EMAIL_COLORS.bg})` }}
        />
      ) : null}
    </div>
  );
}

/** A light mail client's colours, since the email itself is always light. */
const MAIL = { chrome: "#f3f3f5", line: "#e4e4e7", fg: "#18181b", muted: "#71717a" };

type EmailPreviewProps = { html: string; subject: string; from: string; to: string | null };

/**
 * The email as it opens in an inbox: the window, the subject, who it is from and
 * when, above the message, so it reads as an email and not as a web page.
 */
function EmailPreview({ html, subject, from, to }: EmailPreviewProps) {
  return (
    <div className="overflow-hidden rounded-card border" style={{ background: "#fff", color: MAIL.fg, borderColor: MAIL.line }}>
      <div className="flex items-center gap-1.5 px-3 py-2" style={{ background: MAIL.chrome, borderBottom: `1px solid ${MAIL.line}` }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((dot) => (
          <span key={dot} className="size-2.5 rounded-full" style={{ background: dot }} />
        ))}
        <span className="ml-2 text-[11px]" style={{ color: MAIL.muted }}>
          Inbox
        </span>
      </div>
      <div className="flex flex-col gap-2.5 px-4 py-3" style={{ borderBottom: `1px solid ${MAIL.line}` }}>
        <span className="text-[15px] leading-5" style={{ fontWeight: 600 }}>
          {subject}
        </span>
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/lurk-mark.svg" alt="" width={32} height={32} className="shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col text-[12px] leading-4">
            <span className="truncate">
              <span style={{ fontWeight: 600 }}>lurk</span> <span style={{ color: MAIL.muted }}>&lt;{from}&gt;</span>
            </span>
            <span className="truncate" style={{ color: MAIL.muted }}>
              to {to ?? "me"}
            </span>
          </div>
          <span className="shrink-0 self-start text-[11px]" style={{ color: MAIL.muted }}>
            9:00 AM
          </span>
        </div>
      </div>
      <EmailBody html={html} />
    </div>
  );
}

/** Slack's dark theme, which is how most people see it. */
const SLACK = { bg: "#1a1d21", fg: "#d1d2d3", strong: "#f8f8f8", muted: "#ababad", link: "#1d9bd1", rail: "#4a4d52" };

function unescapeSlack(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** The slice of Slack mrkdwn the payload uses: `<url|label>` links and `*bold*`. */
function SlackText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const pattern = /(\*?)<[^|>]+\|([^>]+)>\1|\*([^*\n]+)\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(unescapeSlack(text.slice(last, match.index)));
    if (match[2] !== undefined) {
      parts.push(
        <span key={match.index} style={{ color: SLACK.link, fontWeight: match[1] ? 700 : 400 }}>
          {unescapeSlack(match[2])}
        </span>,
      );
    } else {
      parts.push(
        <b key={match.index} style={{ color: SLACK.strong }}>
          {unescapeSlack(match[3])}
        </b>,
      );
    }
    last = match.index + match[0].length;
  }
  parts.push(unescapeSlack(text.slice(last)));
  return <span className="whitespace-pre-line">{parts}</span>;
}

type SlackBlock = { type: string; text?: { text: string }; elements?: Array<{ type: string; text?: string; image_url?: string }> };

/** The Slack post, drawn from the payload the digest job posts. */
function SlackPreview({ payload }: { payload: OfferPreview["slack"] }) {
  return (
    <div className="flex gap-2.5 rounded-card p-3 text-[13px] leading-[1.45]" style={{ background: SLACK.bg, color: SLACK.fg }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/lurk-mark.svg" alt="" width={36} height={36} className="shrink-0 self-start rounded-[8px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-baseline gap-1.5">
          <span style={{ fontWeight: 700, color: SLACK.strong }}>lurk</span>
          <span className="rounded-[3px] px-1 text-[10px]" style={{ background: "#ffffff1a", color: SLACK.muted }}>
            APP
          </span>
          <span className="text-[11px]" style={{ color: SLACK.muted }}>
            9:00 AM
          </span>
        </span>
        {payload.blocks.map((block, index) => (
          <span key={index} className="text-[14px]" style={{ fontWeight: 700, color: SLACK.strong }}>
            {block.text.text}
          </span>
        ))}
        {payload.attachments.map((attachment, index) => (
          <div
            key={index}
            className="flex flex-col gap-1 border-l-4 pl-2.5"
            style={{ borderColor: "color" in attachment ? attachment.color : SLACK.rail }}
          >
            {(attachment.blocks as SlackBlock[]).map((block, at) =>
              block.type === "section" && block.text ? (
                <span key={at} className="line-clamp-4">
                  <SlackText text={block.text.text} />
                </span>
              ) : (
                <span key={at} className="text-[11px] [word-spacing:1px]" style={{ color: SLACK.muted }}>
                  {block.elements?.map((element, e) =>
                    element.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={e} src={element.image_url} alt="" width={16} height={16} className="mr-1.5 inline-block rounded-[4px] align-[-4px]" />
                    ) : (
                      <SlackText key={e} text={element.text ?? ""} />
                    ),
                  )}
                </span>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Discord's dark theme, its default. */
const DISCORD = { bg: "#313338", embed: "#2b2d31", fg: "#dbdee1", strong: "#f2f3f5", muted: "#949ba4", link: "#00a8fc", blurple: "#5865f2" };

/** The one Discord markdown shape the payload uses: `[label](url)`. */
function DiscordText({ text }: { text: string }) {
  const parts = text.split(/\[([^\]]+)\]\([^)]+\)/);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 ? (
          <span key={index} style={{ color: DISCORD.link }}>
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** How Discord dates an embed: "Today at 9:00 AM", or the day in full before that. */
function discordTime(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString()
    ? `Today at ${time}`
    : `${date.toLocaleDateString("en-US")} ${time}`;
}

/** The Discord post, drawn from the payload the digest job posts. */
function DiscordPreview({ payload }: { payload: OfferPreview["discord"] }) {
  return (
    <div className="flex gap-3 rounded-card p-3 text-[13px] leading-[1.4]" style={{ background: DISCORD.bg, color: DISCORD.fg }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/email/lurk-discord.png" alt="" width={36} height={36} className="shrink-0 self-start rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-baseline gap-1.5">
          <span style={{ fontWeight: 600, color: DISCORD.strong }}>{payload.username}</span>
          <span className="rounded-[3px] px-1 text-[10px] text-white" style={{ background: DISCORD.blurple, fontWeight: 600 }}>
            APP
          </span>
          <span className="text-[11px]" style={{ color: DISCORD.muted }}>
            Today at 9:00 AM
          </span>
        </span>
        <span>{payload.content}</span>
        {payload.embeds.map((embed, index) => (
          <div
            key={index}
            className="flex max-w-full flex-col gap-1.5 rounded-[4px] border-l-4 px-3 py-2.5"
            style={{
              background: DISCORD.embed,
              borderColor: "color" in embed ? `#${embed.color.toString(16).padStart(6, "0")}` : "#1e1f22",
            }}
          >
            {"author" in embed ? (
              <>
                <span className="flex items-center gap-2 text-[12px]" style={{ fontWeight: 600, color: DISCORD.strong }}>
                  {embed.author.icon_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={embed.author.icon_url} alt="" width={20} height={20} className="rounded-full" />
                  ) : null}
                  {embed.author.name}
                </span>
                <span className="line-clamp-2" style={{ fontWeight: 600, color: DISCORD.link }}>
                  {embed.title}
                </span>
                {embed.description ? <span className="line-clamp-3">{embed.description}</span> : null}
                <span className="flex gap-6">
                  {embed.fields.map((field) => (
                    <span key={field.name} className="flex flex-col">
                      <span className="text-[12px]" style={{ fontWeight: 600, color: DISCORD.strong }}>
                        {field.name}
                      </span>
                      <span>{field.value}</span>
                    </span>
                  ))}
                </span>
                <span className="text-[11px]" style={{ color: DISCORD.muted }} suppressHydrationWarning>
                  {embed.footer.text} • {discordTime(embed.timestamp)}
                </span>
              </>
            ) : (
              <span>
                <DiscordText text={embed.description} />
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The offer a new project makes while its first leads are found: a daily email,
 * a Slack post or a Discord post, with the message drawn as it will land, so
 * the person sees what they are saying yes to. Once a channel is on it names
 * where leads go, in one line shown once for a few seconds.
 */
export function AlertsOffer({ projectId, offer, preview, slackInstall, discordInstall }: AlertsOfferProps) {
  const [shown, setShown] = useState<Shown>("email");
  const [discordOpen, setDiscordOpen] = useState(false);
  const [discordUrl, setDiscordUrl] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const asking = offer.state === "ask";
  useEffect(() => {
    if (!asking) {
      return;
    }
    const timer = setTimeout(() => dialog.current?.showModal(), OPEN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [asking]);
  const settingsHref = `/app/settings/alerts?${new URLSearchParams({ project: projectId })}`;

  if (offer.state === "dismissed") {
    return null;
  }
  if (offer.state === "on") {
    const where = offer.channels.map((one) => one.where).join(", ");
    // Said once, when a channel is turned on; Settings says it after that.
    return (
      <Fleeting id={`alerts-on:${projectId}:${where}`}>
        <div className="text-small flex items-center gap-2.5 rounded-card border bg-surface px-4 py-2.5">
          <Check size={14} className="shrink-0" style={{ color: "var(--score-hot)" }} />
          <span className="min-w-0 flex-1">New leads go to {where}.</span>
          <Link href={settingsHref} className="shrink-0 text-fg-muted underline">
            Change
          </Link>
        </div>
      </Fleeting>
    );
  }

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      setError(null);
      setError(await errorFrom(action));
    });
  const back = `/app/leads?${new URLSearchParams({ project: projectId })}`;
  const connect = new URLSearchParams({ project: projectId, cadence: "daily", back });
  const slackHref = `/connect/slack?${connect}`;
  const discordHref = `/connect/discord?${connect}`;
  // Closing it any way at all, Esc and the backdrop included, is "Not now".
  const notNow = () => {
    dialog.current?.close();
    run(() => dismissAlertsOfferAction(projectId));
  };

  return (
    <dialog
      ref={dialog}
      aria-label="Free alerts"
      onCancel={notNow}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          notNow();
        }
      }}
      className="m-auto w-[min(56rem,calc(100vw-2rem))] max-w-none rounded-card border bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/60"
    >
      <section className="relative grid max-h-[calc(100dvh-4rem)] gap-5 overflow-y-auto p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] sm:p-7">
        <button
          type="button"
          aria-label="Not now"
          onClick={notNow}
          className="absolute top-3 right-3 rounded-control p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <X size={16} />
        </button>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5">
            <ChannelMark channel="email" size={14} />
            <ChannelMark channel="slack" size={14} />
            <ChannelMark channel="discord" size={14} />
            <span className="text-mono tracking-wide text-fg-muted uppercase">Free alerts</span>
          </div>
          <h2 className="text-h3" style={{ fontWeight: 500 }}>Hear about new leads while the thread is still open.</h2>
          <p className="text-small text-fg-muted">
            Most threads go quiet within a day, and the first useful replies get the clicks. lurk keeps
            checking after you close this tab and sends only new leads worth a reply, with what each
            person wrote. It&rsquo;s free, and you can turn it off any time.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {offer.email ? (
              <Button size="lg" disabled={pending} onClick={() => run(() => emailAlertsAction(projectId))} onMouseEnter={() => setShown("email")}>
                <Mail />
                Email me daily
              </Button>
            ) : null}
            <a
              href={slackInstall ? slackHref : settingsHref}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
              onMouseEnter={() => setShown("slack")}
            >
              <ChannelMark channel="slack" size={14} />
              {slackInstall ? "Add to Slack" : "Slack"}
            </a>
            {discordInstall ? (
              <a
                href={discordHref}
                className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
                onMouseEnter={() => setShown("discord")}
              >
                <ChannelMark channel="discord" size={14} />
                Add to Discord
              </a>
            ) : (
              <Button
                variant="outline"
                size="lg"
                aria-expanded={discordOpen}
                onMouseEnter={() => setShown("discord")}
                onClick={() => {
                  setShown("discord");
                  setDiscordOpen((open) => !open);
                }}
              >
                <ChannelMark channel="discord" size={14} />
                Discord
              </Button>
            )}
            <Button
              variant="ghost"
              size="lg"
              className="text-fg-muted"
              disabled={pending}
              onClick={notNow}
            >
              Not now
            </Button>
          </div>
          {discordOpen ? (
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                run(() => discordAlertsAction(projectId, discordUrl));
              }}
            >
              <div className="flex gap-2">
                <input
                  value={discordUrl}
                  onChange={(event) => setDiscordUrl(event.target.value)}
                  required
                  autoFocus
                  placeholder="https://discord.com/api/webhooks/..."
                  aria-label="Discord webhook URL"
                  className="h-10 min-w-0 flex-1 rounded-control border bg-bg px-3 text-body text-fg"
                />
                <Button type="submit" size="lg" disabled={pending}>
                  Post daily
                </Button>
              </div>
              <p className="text-[12px] text-fg-muted">
                In Discord: channel settings, Integrations, Webhooks, New Webhook, then Copy Webhook URL.
              </p>
            </form>
          ) : null}
          {offer.email ? <p className="text-[12px] text-fg-muted">Email goes to {offer.email}.</p> : null}
          {error ? <p className="text-small text-destructive">{error}</p> : null}
        </div>
        {preview ? (
          <div className="flex min-w-0 flex-col gap-2">
            <PillTabs
              className="self-start"
              activeId={shown}
              onSelect={(id) => setShown(id === "slack" || id === "discord" ? id : "email")}
              tabs={[
                { id: "email", label: "Email", icon: <ChannelMark channel="email" size={13} /> },
                { id: "slack", label: "Slack", icon: <ChannelMark channel="slack" size={13} /> },
                { id: "discord", label: "Discord", icon: <ChannelMark channel="discord" size={13} /> },
              ]}
            />
            {shown === "email" ? (
              <EmailPreview html={preview.emailHtml} subject={preview.emailSubject} from={preview.emailFrom} to={offer.email} />
            ) : null}
            {shown === "slack" ? <SlackPreview payload={preview.slack} /> : null}
            {shown === "discord" ? <DiscordPreview payload={preview.discord} /> : null}
            <p className="text-[12px] text-fg-muted">
              {preview.sample ? "An example. Your own leads fill in as they are found." : "With your leads so far."}
            </p>
          </div>
        ) : null}
      </section>
    </dialog>
  );
}
