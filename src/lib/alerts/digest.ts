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
import { ANYAPI_PLUG, ANYAPI_PLUG_CTA, anyapiAlertUrl } from "./plug";
import type { Digest, DigestLead } from "./types";

const WIDTH = 600;
const AXIS_MARKS = [0, 6, 12, 18];

function windowPhrase(digest: Digest): string {
  return digest.cadence === "hourly" ? "in the last hour" : "in the last 24 hours";
}

export function digestSubject(digest: Digest): string {
  const count = digest.leads.length;
  return `${count} new ${count === 1 ? "lead" : "leads"} for ${digest.projectName}`;
}

function headerRow(digest: Digest): string {
  const date = digest.generatedAt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `<tr><td style="padding:20px 24px;border-bottom:1px solid ${C.border}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="left" style="font-family:${EMAIL_FONT};font-size:15px;font-weight:500;color:${C.fg}">
<img src="${escapeHtml(digest.appUrl)}/icon.svg" width="20" height="20" alt="" style="vertical-align:-4px;margin-right:8px" />${escapeHtml(PRODUCT_NAME)}</td>
<td align="right" style="font-family:${EMAIL_FONT};font-size:13px;color:${C.fgMuted}">${escapeHtml(date)}</td>
</tr></table></td></tr>`;
}

function headlineRow(digest: Digest): string {
  const count = digest.leads.length;
  const noun = count === 1 ? "new lead" : "new leads";
  return `<tr><td style="padding:24px 24px 8px;font-family:${EMAIL_FONT};font-size:20px;line-height:1.3;font-weight:500;color:${C.fg}">${count} ${noun} for ${escapeHtml(digest.projectName)} ${windowPhrase(digest)}.</td></tr>`;
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
            `<div style="margin-top:2px" title="u/${escapeHtml(lead.author ?? "unknown")}">${avatarHtml(lead.author, lead.avatarUrl, 24)}</div>`,
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
${avatarHtml(lead.author, lead.avatarUrl, 28)}
<img src="${escapeHtml(appUrl)}/brands/reddit.svg" width="14" height="14" alt="Reddit" style="display:block;margin:-8px 0 0 16px;border-radius:7px" /></td>`;
}

function leadRow(lead: DigestLead, digest: Digest): string {
  const meta = [
    `u/${lead.author ?? "unknown"}`,
    `r/${lead.subreddit}`,
    shortAge(lead.createdAt, digest.generatedAt),
  ]
    .map(escapeHtml)
    .join(" &middot; ");
  const reason = lead.reason
    ? `<div style="margin-top:6px;font-family:${EMAIL_FONT};font-size:13px;color:${C.fgMuted}">${escapeHtml(lead.reason)}</div>`
    : "";
  const phrase = lead.matchedPhrase
    ? `<div style="margin-top:6px;padding:6px 10px;border-radius:${EMAIL_RADIUS.control};background:${C.surface2};font-family:${EMAIL_FONT};font-size:13px;color:${C.fg}">&ldquo;${escapeHtml(lead.matchedPhrase)}&rdquo;</div>`
    : "";
  return `<tr><td style="padding:0 24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.surface};border:1px solid ${C.border};border-radius:${EMAIL_RADIUS.card}"><tr>
${authorCell(lead, digest.appUrl)}
<td valign="top" style="padding:16px 12px">
<div style="font-family:${EMAIL_FONT};font-size:12px;color:${C.fgMuted}">${meta}</div>
<div style="margin-top:4px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.4;color:${C.fg}">${escapeHtml(lead.title)}</div>
${reason}${phrase}</td>
<td valign="top" align="right" width="72" style="padding:16px 16px 16px 0">
<div style="font-family:${EMAIL_FONT};font-size:15px;font-weight:500;color:${scoreColor(lead.score)}">${lead.score}</div>
<a href="${escapeHtml(lead.url)}" style="display:inline-block;margin-top:8px;font-family:${EMAIL_FONT};font-size:13px;color:${C.fgMuted};text-decoration:underline">Source</a></td>
</tr></table></td></tr>`;
}

function anyapiRow(): string {
  return `<tr><td style="padding:4px 24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.surface2};border-radius:${EMAIL_RADIUS.card}"><tr>
<td style="padding:12px 16px;font-family:${EMAIL_FONT};font-size:13px;line-height:1.5;color:${C.fgMuted}">${escapeHtml(ANYAPI_PLUG)}
<a href="${escapeHtml(anyapiAlertUrl("email"))}" style="color:${C.fg};text-decoration:underline">${escapeHtml(ANYAPI_PLUG_CTA)}</a></td>
</tr></table></td></tr>`;
}

function footerRow(digest: Digest): string {
  return `<tr><td style="padding:8px 24px 28px;font-family:${EMAIL_FONT};font-size:12px;color:${C.fgMuted}">
<a href="${escapeHtml(digest.appUrl)}/app/leads" style="color:${C.fgMuted}">Open the feed</a> &middot;
<a href="${escapeHtml(digest.appUrl)}/app/settings/alerts" style="color:${C.fgMuted}">Alert settings</a>
&middot; ${escapeHtml(PRODUCT_NAME_WITH_PROVIDER)}</td></tr>`;
}

function emptyRow(digest: Digest): string {
  return `<tr><td style="padding:0 24px 24px;font-family:${EMAIL_FONT};font-size:15px;color:${C.fgMuted}">Nothing new ${windowPhrase(digest)}. The next scan runs on your schedule.</td></tr>`;
}

/** The whole email: table layout, inline styles, no stylesheet to strip. */
export function renderDigestHtml(digest: Digest): string {
  const body = digest.leads.length
    ? `${timelineRow(digest)}${digest.leads.map((lead) => leadRow(lead, digest)).join("")}`
    : emptyRow(digest);
  return `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /><title>${escapeHtml(digestSubject(digest))}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}">
<tr><td align="center" style="padding:24px 8px">
<table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${WIDTH}px;max-width:100%;background:${C.bg};border:1px solid ${C.border};border-radius:20px">
${headerRow(digest)}${headlineRow(digest)}${body}${anyapiRow()}${footerRow(digest)}
</table></td></tr></table></body></html>`;
}

/** The same digest as plain text, for clients that refuse HTML. */
export function renderDigestText(digest: Digest): string {
  const lines = digest.leads.map(
    (lead) =>
      `${lead.score} - ${lead.title} (r/${lead.subreddit}, u/${lead.author ?? "unknown"}, ${shortAge(lead.createdAt, digest.generatedAt)})\n${lead.reason ?? ""}\n${lead.url}`,
  );
  return [
    `${digest.leads.length} new leads for ${digest.projectName} ${windowPhrase(digest)}.`,
    ...lines,
    `${digest.appUrl}/app/leads`,
    `${ANYAPI_PLUG} ${anyapiAlertUrl("email")}`,
  ].join("\n\n");
}
