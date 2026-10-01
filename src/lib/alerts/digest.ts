import { PRODUCT_NAME, PRODUCT_NAME_WITH_PROVIDER } from "@/lib/brand";
import { shortAge } from "@/lib/format";
import {
  avatarHtml,
  EMAIL_COLORS as C,
  EMAIL_FONT,
  EMAIL_RADIUS,
  escapeHtml,
  hourLabel,
  scoreColor,
  startOfDay,
} from "./tokens";
import {
  actLinksOf,
  FEED_PATH,
  handleOf,
  headlineOf,
  MORE_LINK,
  moreLine,
  newLeadsPhrase,
  PLATFORM_ICON,
  PLATFORM_NAME,
  platformsOf,
  quoteOf,
  quoteText,
  repliesPhrase,
  showsScore,
  totalOf,
  venueOf,
  windowPhrase,
} from "./platform";
import { ANYAPI_PLUG, ANYAPI_PLUG_CTA, anyapiAlertUrl } from "./plug";
import type { Digest, DigestLead, LeadPlatform } from "./types";

const WIDTH = 600;
const AXIS_MARKS = [0, 6, 12, 18];

export function digestSubject(digest: Digest): string {
  return `${newLeadsPhrase(totalOf(digest))} for ${digest.projectName}`;
}

/**
 * Every email the app sends, around its rows: table layout and inline styles,
 * with no stylesheet for a mail client to strip, 600 pixels at most.
 */
export function emailDocument(title: string, rows: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}">
<tr><td align="center" style="padding:24px 8px">
<table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${WIDTH}px;max-width:100%;background:${C.bg};border:1px solid ${C.border};border-radius:20px">
${rows}
</table></td></tr></table></body></html>`;
}

/** The mark and the name across the top of an email, and on the right whatever the email dates itself by. */
export function brandRow(appUrl: string, right?: string): string {
  const aside = right
    ? `<td align="right" style="font-family:${EMAIL_FONT};font-size:13px;color:${C.fgMuted}">${escapeHtml(right)}</td>\n`
    : "";
  return `<tr><td style="padding:20px 24px;border-bottom:1px solid ${C.border}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="left" style="font-family:${EMAIL_FONT};font-size:15px;font-weight:500;color:${C.fg}">
<img src="${escapeHtml(appUrl)}/email/lurk.png" width="20" height="20" alt="" style="vertical-align:-4px;margin-right:8px" />${escapeHtml(PRODUCT_NAME)}</td>
${aside}</tr></table></td></tr>`;
}

function headerRow(digest: Digest): string {
  const date = digest.generatedAt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return brandRow(digest.appUrl, date);
}

function headlineRow(digest: Digest): string {
  return `<tr><td style="padding:24px 24px 8px;font-family:${EMAIL_FONT};font-size:20px;line-height:1.3;font-weight:500;color:${C.fg}">${escapeHtml(headlineOf(digest))}</td></tr>`;
}

function earlierPills(leads: DigestLead[], today: number): string {
  const counts = new Map<number, number>();
  for (const lead of leads) {
    const day = startOfDay(lead.createdAt);
    if (day < today) {
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([day, total]) => {
      const label = new Date(day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return `<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:${EMAIL_RADIUS.control};background:${C.surface2};font-size:12px;color:${C.fgMuted}">${escapeHtml(label)} +${total}</span>`;
    })
    .join("");
}

function timelineRow(digest: Digest): string {
  const today = startOfDay(digest.generatedAt);
  const todays = digest.leads.filter((lead) => lead.createdAt.getTime() >= today);
  const hours = Array.from({ length: digest.generatedAt.getHours() + 1 }, (_, hour) => hour);
  const cells = hours
    .map((hour) => {
      const inHour = todays.filter((lead) => lead.createdAt.getHours() === hour);
      const faces = inHour
        .map(
          (lead) =>
            `<div style="margin-top:2px" title="${escapeHtml(handleOf(lead))}">${avatarHtml(lead.author, lead.avatarUrl, 24, lead.platform)}</div>`,
        )
        .join("");
      return `<td valign="bottom" align="center" style="width:26px;padding:0 1px">${faces}<div style="height:6px;border-left:1px solid ${C.border};margin:4px auto 2px;width:1px"></div><div style="font-family:${EMAIL_FONT};font-size:10px;color:${C.fgMuted};height:12px">${AXIS_MARKS.includes(hour) ? hourLabel(hour) : ""}</div></td>`;
    })
    .join("");
  return `<tr><td style="padding:8px 24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.surface};border:1px solid ${C.border};border-radius:${EMAIL_RADIUS.card}">
<tr><td style="padding:14px 16px 6px;font-family:${EMAIL_FONT};font-size:12px;letter-spacing:0.06em;color:${C.fgMuted}">TODAY - ${todays.length} ${todays.length === 1 ? "lead" : "leads"}${earlierPills(digest.leads, today)}</td></tr>
<tr><td style="padding:0 16px 12px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table></td></tr>
</table></td></tr>`;
}

function authorCell(lead: DigestLead, appUrl: string): string {
  return `<td valign="top" width="44" style="padding:16px 0 16px 16px">
${avatarHtml(lead.author, lead.avatarUrl, 28, lead.platform)}
<img src="${escapeHtml(appUrl)}/email/${PLATFORM_ICON[lead.platform]}" width="14" height="14" alt="${PLATFORM_NAME[lead.platform]}" style="display:block;margin:-8px 0 0 16px;border-radius:7px" /></td>`;
}

/**
 * How long ago, in hours until two days: a card saying "2d" under a headline
 * about the last 24 hours reads as a contradiction when it means 37 hours.
 */
export function leadAge(date: Date, now: Date): string {
  const hours = (now.getTime() - date.getTime()) / 3_600_000;
  return hours >= 1 && hours < 48 ? `${Math.round(hours)}h` : shortAge(date, now);
}

function commentsPhrase(count: number | null, platform: LeadPlatform): string[] {
  return count == null ? [] : [repliesPhrase(count, platform)];
}

/** What the person wrote, as `quoteOf` picks it: the phrase set as a quote, the excerpt as muted text. */
function wordsOf(lead: DigestLead, size: number): string {
  const quote = quoteOf(lead);
  if (!quote) {
    return "";
  }
  return quote.kind === "phrase"
    ? `<div style="margin-top:6px;padding:6px 10px;border-radius:${EMAIL_RADIUS.control};background:${C.surface2};font-family:${EMAIL_FONT};font-size:${size}px;color:${C.fg}">&ldquo;${escapeHtml(quote.text)}&rdquo;</div>`
    : `<div style="margin-top:6px;font-family:${EMAIL_FONT};font-size:${size}px;line-height:1.5;color:${C.fgMuted}">${escapeHtml(quote.text)}</div>`;
}

/**
 * A comment that is a lead, set under the thread it replies to. On X it is
 * another ask in the same conversation, which is not always a reply to the
 * one heading the card.
 */
function replyBlock(lead: DigestLead, digest: Pick<Digest, "generatedAt">): string {
  const verb = lead.platform === "x" ? "also asked" : "replied";
  const meta = [`${handleOf(lead)} ${verb}`, leadAge(lead.createdAt, digest.generatedAt)]
    .map(escapeHtml)
    .join(" &middot; ");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px"><tr>
<td valign="top" width="26" style="padding:2px 0 0 10px;border-left:2px solid ${C.border}">${avatarHtml(lead.author, lead.avatarUrl, 20, lead.platform)}</td>
<td valign="top" style="padding:0 0 0 8px">
<div style="font-family:${EMAIL_FONT};font-size:12px;color:${C.fgMuted}">${meta} &middot; ${showsScore(lead) ? `<span style="font-weight:500;color:${scoreColor(lead.score)}">${lead.score}</span> &middot; ` : ""}<a href="${escapeHtml(lead.url)}" style="color:${C.fgMuted};text-decoration:underline">Source</a></div>
${wordsOf(lead, 13)}</td></tr></table>`;
}

/**
 * The thread's own links under its card: Mark replied, so nothing in it is sent
 * again, and a mute for its community. Quiet, since reading is the point.
 */
function actsRow(lead: DigestLead): string {
  const links = actLinksOf(lead);
  if (links.length === 0) {
    return "";
  }
  const anchors = links
    .map(
      (link) =>
        `<a href="${escapeHtml(link.url)}" style="color:${C.fgMuted};text-decoration:underline">${escapeHtml(link.label)}</a>`,
    )
    .join(" &middot; ");
  return `<div style="margin-top:12px;font-family:${EMAIL_FONT};font-size:12px;color:${C.fgMuted}">${anchors}</div>`;
}

/**
 * One thread as a card: the post when it is a lead itself, and every reply
 * that is a lead beneath it, so a busy thread reads as one conversation. Two
 * X asks in one conversation are both posts, so the second is set beneath the
 * first rather than lost. The invite shows the same cards, so it is shared.
 */
export function threadRow(group: DigestLead[], digest: Pick<Digest, "appUrl" | "generatedAt">): string {
  const post = group.find((lead) => !lead.isComment) ?? null;
  const replies = group.filter((lead) => lead !== post);
  const first = post ?? replies[0];
  const best = Math.max(...group.map((lead) => lead.score));
  const meta = (
    post
      ? [handleOf(post), venueOf(post), leadAge(post.createdAt, digest.generatedAt), ...commentsPhrase(post.numComments, post.platform)]
      : [`Thread in ${venueOf(first)}`, ...commentsPhrase(first.numComments, first.platform)]
  )
    .map(escapeHtml)
    .join(" &middot; ");
  const face = post
    ? authorCell(post, digest.appUrl)
    : `<td valign="top" width="44" style="padding:16px 0 16px 16px"><img src="${escapeHtml(digest.appUrl)}/email/${PLATFORM_ICON[first.platform]}" width="28" height="28" alt="${PLATFORM_NAME[first.platform]}" style="display:block;border-radius:14px" /></td>`;
  return `<tr><td style="padding:0 24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.surface};border:1px solid ${C.border};border-radius:${EMAIL_RADIUS.card}"><tr>
${face}
<td valign="top" style="padding:16px 12px">
<div style="font-family:${EMAIL_FONT};font-size:12px;color:${C.fgMuted}">${meta}</div>
<div style="margin-top:4px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.4;color:${C.fg}">${escapeHtml(first.title)}</div>
${post ? wordsOf(post, 13) : ""}${replies.map((reply) => replyBlock(reply, digest)).join("")}${actsRow(first)}</td>
<td valign="top" align="right" width="72" style="padding:16px 16px 16px 0">
${showsScore(first) ? `<div style="font-family:${EMAIL_FONT};font-size:15px;font-weight:500;color:${scoreColor(best)}">${best}</div>\n` : ""}<a href="${escapeHtml(first.url)}" style="display:inline-block;margin-top:8px;font-family:${EMAIL_FONT};font-size:13px;color:${C.fgMuted};text-decoration:underline">Source</a></td>
</tr></table></td></tr>`;
}

/** Leads grouped by thread, in the order each thread's best lead came. */
export function byThread(leads: DigestLead[]): DigestLead[][] {
  const groups = new Map<string, DigestLead[]>();
  for (const lead of leads) {
    const key = lead.threadId ?? lead.id;
    groups.set(key, [...(groups.get(key) ?? []), lead]);
  }
  return [...groups.values()];
}

function anyapiRow(): string {
  return `<tr><td style="padding:4px 24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.surface2};border-radius:${EMAIL_RADIUS.card}"><tr>
<td style="padding:12px 16px;font-family:${EMAIL_FONT};font-size:13px;line-height:1.5;color:${C.fgMuted}">${escapeHtml(ANYAPI_PLUG)}
<a href="${escapeHtml(anyapiAlertUrl("email"))}" style="color:${C.fg};text-decoration:underline">${escapeHtml(ANYAPI_PLUG_CTA)}</a></td>
</tr></table></td></tr>`;
}

const FEED_LINK: Record<LeadPlatform, string> = { reddit: "Open the feed", x: "Open X leads" };

/** Every platform the message lists a lead on or leaves one out on, so each gets its link. */
function linkedPlatforms(digest: Digest): LeadPlatform[] {
  return platformsOf([
    ...digest.leads,
    ...(digest.morePlatforms ?? []).map((platform) => ({ platform })),
  ]);
}

function footerRow(digest: Digest): string {
  const feeds = linkedPlatforms(digest)
    .map(
      (platform) =>
        `<a href="${escapeHtml(digest.appUrl)}${FEED_PATH[platform]}" style="color:${C.fgMuted}">${FEED_LINK[platform]}</a> &middot;\n`,
    )
    .join("");
  return `<tr><td style="padding:8px 24px 28px;font-family:${EMAIL_FONT};font-size:12px;color:${C.fgMuted}">
${feeds}<a href="${escapeHtml(digest.appUrl)}/app/settings/alerts" style="color:${C.fgMuted}">Alert settings</a>
&middot; ${escapeHtml(PRODUCT_NAME_WITH_PROVIDER)}</td></tr>`;
}

function moreRow(digest: Digest): string {
  const line = moreLine(
    digest,
    (platform) =>
      `<a href="${escapeHtml(digest.appUrl)}${FEED_PATH[platform]}" style="color:${C.fg};text-decoration:underline">${MORE_LINK[platform]}</a>`,
  );
  return line
    ? `<tr><td style="padding:0 24px 24px;font-family:${EMAIL_FONT};font-size:14px;color:${C.fgMuted}">${line}</td></tr>`
    : "";
}

function emptyRow(digest: Digest): string {
  return `<tr><td style="padding:0 24px 24px;font-family:${EMAIL_FONT};font-size:15px;color:${C.fgMuted}">Nothing new ${windowPhrase(digest)}. The next scan runs on your schedule.</td></tr>`;
}

/** The whole email. */
export function renderDigestHtml(digest: Digest): string {
  const body = digest.leads.length
    ? `${timelineRow(digest)}${byThread(digest.leads).map((group) => threadRow(group, digest)).join("")}${moreRow(digest)}`
    : emptyRow(digest);
  return emailDocument(
    digestSubject(digest),
    `${headerRow(digest)}${headlineRow(digest)}${body}${anyapiRow()}${footerRow(digest)}`,
  );
}

/** The same digest as plain text, for clients that refuse HTML. */
export function renderDigestText(digest: Digest): string {
  const lines = digest.leads.map(
    (lead) =>
      `${showsScore(lead) ? `${lead.score} - ` : ""}${lead.isComment ? "Reply in: " : ""}${lead.title} (${venueOf(lead)}, ${handleOf(lead)}, ${leadAge(lead.createdAt, digest.generatedAt)})\n${quoteText(lead) ?? ""}\n${lead.url}${actLinksOf(lead)
        .map((link) => `\n${link.label}: ${link.url}`)
        .join("")}`,
  );
  const more = moreLine(digest, (platform) => MORE_LINK[platform]);
  return [
    headlineOf(digest),
    ...lines,
    ...(more ? [more] : []),
    ...linkedPlatforms(digest).map((platform) => `${digest.appUrl}${FEED_PATH[platform]}`),
    `${ANYAPI_PLUG} ${anyapiAlertUrl("email")}`,
  ].join("\n\n");
}
