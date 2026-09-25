import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { alerts, projects, userActions, users } from "@/db/schema";
import { PRODUCT_NAME, PRODUCT_NAME_WITH_PROVIDER } from "@/lib/brand";
import { config } from "@/lib/config";
import { enqueueOnce } from "@/jobs/enqueue";
import { hasActiveSearch } from "@/lib/scan/widen";
import { tierForUser } from "@/lib/tier";
import { addChannel } from "./channels";
import { sendEmail, type EmailMessage } from "./email";
import { leadRow } from "./digest";
import { newLeadsSince } from "./leads";
import { ALERT_SCORE_FLOOR, selectLeads } from "./select";
import { EMAIL_COLORS as C, EMAIL_FONT, EMAIL_RADIUS, escapeHtml } from "./tokens";
import type { DigestLead } from "./types";

/** Recorded once per person, so nobody is asked twice. */
export const INVITE_SENT = "alert_invite_sent";
export const INVITE_ACCEPTED = "alert_invite_accepted";

/**
 * A pass sends at most this many. Azure Communication Services caps a custom
 * domain at 100 emails an hour, and the digests share that allowance.
 */
export const INVITES_PER_PASS = 40;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A new project gets a day to find its first leads before its owner is asked. */
const SETTLE_MS = DAY_MS;

/**
 * The invite shows leads posted this recently, best first, and widens to the
 * longer window only to fill its three. A person with nothing posted inside
 * the longer one is not asked yet: a year-old thread is no reason to sign up.
 */
const SAMPLE_RECENT_MS = 7 * DAY_MS;
const SAMPLE_WINDOW_MS = 30 * DAY_MS;

function signingKey(): Buffer {
  return Buffer.from(config().APP_ENCRYPTION_KEY, "base64");
}

function signatureFor(userId: string): string {
  return createHmac("sha256", signingKey()).update(`alert-invite:${userId}`).digest("base64url");
}

/** A link token that names one person and cannot be forged without the app key. */
export function inviteToken(userId: string): string {
  return `${userId}.${signatureFor(userId)}`;
}

/** The person a token names, or null when it was altered or never issued. */
export function userForToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  const userId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signatureFor(userId));
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}

export type Invitee = {
  userId: string;
  email: string;
  /** The project with the most leads, which the email names. */
  projectId: string;
  projectName: string;
  leadCount: number;
  /** Of those, how many were posted in the last month: the "new" the email counts. */
  recentCount: number;
};

/**
 * People who have recent leads and nowhere for new ones to go: every project
 * of theirs has no alert channel, the oldest is a day old, they were never
 * asked, and the project the email names has a lead posted in the last month.
 */
export async function invitees(now: Date, limit: number): Promise<Invitee[]> {
  const settled = new Date(now.getTime() - SETTLE_MS);
  const recent = new Date(now.getTime() - SAMPLE_WINDOW_MS);
  const rows = await db().execute<{
    user_id: string;
    email: string;
    project_id: string;
    project_name: string;
    lead_count: number;
    recent_count: number;
  }>(sql`
    select distinct on (u.id) u.id as user_id, u.email, p.id as project_id, p.name as project_name,
      (select count(*)::int from leads l
        where l.project_id = p.id and l.kind = 'buyer' and l.score >= ${ALERT_SCORE_FLOOR}) as lead_count,
      (select count(*)::int from leads rl
        join reddit_posts rp on rp.id = rl.post_id
        left join reddit_comments rc on rc.id = rl.comment_id
        where rl.project_id = p.id and rl.kind = 'buyer' and rl.status = 'new'
          and rl.score >= ${ALERT_SCORE_FLOOR}
          and coalesce(rc.created_at, rp.created_at) >= ${recent.toISOString()}) as recent_count
    from ${users} u
    join ${projects} p on p.user_id = u.id
    where u.email is not null
      and not exists (select 1 from ${alerts} a join ${projects} ap on ap.id = a.project_id where ap.user_id = u.id)
      and not exists (select 1 from ${userActions} ua where ua.user_id = u.id and ua.action = ${INVITE_SENT})
      and (select min(created_at) from ${projects} op where op.user_id = u.id) <= ${settled.toISOString()}
      and exists (select 1 from leads rl
        join reddit_posts rp on rp.id = rl.post_id
        left join reddit_comments rc on rc.id = rl.comment_id
        where rl.project_id = p.id and rl.kind = 'buyer' and rl.status = 'new'
          and rl.score >= ${ALERT_SCORE_FLOOR}
          and coalesce(rc.created_at, rp.created_at) >= ${recent.toISOString()})
    order by u.id, lead_count desc, p.created_at asc
  `);
  return [...rows]
    .filter((row) => row.recent_count > 0)
    .slice(0, limit)
    .map((row) => ({
      userId: row.user_id,
      email: row.email,
      projectId: row.project_id,
      projectName: row.project_name,
      leadCount: row.lead_count,
      recentCount: row.recent_count,
    }));
}

function leadsPhrase(count: number): string {
  return `${count} new Reddit ${count === 1 ? "lead" : "leads"}`;
}

export function inviteSubject(invitee: Invitee): string {
  return `${leadsPhrase(invitee.recentCount)} for ${invitee.projectName}. Get the new ones daily?`;
}

/** How many of the project's best leads the invite shows. */
export const INVITE_LEAD_SAMPLE = 3;

/** The project's best recent leads, as the digest would list them. */
export async function sampleLeads(projectId: string, now = new Date()): Promise<DigestLead[]> {
  const rows = await newLeadsSince(projectId, new Date(0));
  const recent = selectLeads(rows, new Date(now.getTime() - SAMPLE_RECENT_MS), INVITE_LEAD_SAMPLE);
  const shown = new Set(recent.map((lead) => lead.id));
  const filler = selectLeads(rows, new Date(now.getTime() - SAMPLE_WINDOW_MS), INVITE_LEAD_SAMPLE)
    .filter((lead) => !shown.has(lead.id));
  return [...recent, ...filler].slice(0, INVITE_LEAD_SAMPLE).sort((a, b) => b.score - a.score);
}

export type InviteLinks = { accept: string; chat: string };

export function inviteLinks(invitee: Invitee, appUrl: string): InviteLinks {
  return {
    accept: `${appUrl}/alerts/on?t=${encodeURIComponent(inviteToken(invitee.userId))}`,
    chat: `${appUrl}/app/settings/alerts?project=${encodeURIComponent(invitee.projectId)}`,
  };
}

function text(size: number, color: string, weight = 400): string {
  return `font-family:${EMAIL_FONT};font-size:${size}px;line-height:1.45;font-weight:${weight};color:${color}`;
}

function acceptButton(appUrl: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
<td style="border-radius:${EMAIL_RADIUS.control};background:${C.brand}">
<a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 26px;${text(16, "#ffffff", 500)};text-decoration:none">
<img src="${escapeHtml(appUrl)}/email/mail.png" width="18" height="18" alt="" style="vertical-align:-3px;margin-right:10px;border:0" />Turn on email alerts</a></td></tr></table>`;
}

function chatPill(appUrl: string, href: string, icon: string, label: string): string {
  return `<td style="padding:0 4px"><a href="${escapeHtml(href)}" style="display:inline-block;padding:9px 16px;border:1px solid ${C.border};border-radius:${EMAIL_RADIUS.control};background:${C.surface};${text(14, C.fg, 500)};text-decoration:none">
<img src="${escapeHtml(appUrl)}/email/${icon}.png" width="16" height="16" alt="" style="vertical-align:-3px;margin-right:8px;border:0" />${label}</a></td>`;
}

/**
 * The one email that asks. It leads with the person's own best leads, because
 * those are what they would be signing up for, then the one button.
 */
export function renderInvite(invitee: Invitee, leads: DigestLead[], appUrl: string): EmailMessage {
  const links = inviteLinks(invitee, appUrl);
  const name = escapeHtml(invitee.projectName);
  const generatedAt = new Date();
  const cards = leads.map((lead) => leadRow(lead, { appUrl, generatedAt })).join("");
  const html = `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /><title>${escapeHtml(inviteSubject(invitee))}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}">
<tr><td align="center" style="padding:24px 8px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:${C.bg};border:1px solid ${C.border};border-radius:20px">
<tr><td style="padding:20px 24px;border-bottom:1px solid ${C.border};${text(15, C.fg, 500)}">
<img src="${escapeHtml(appUrl)}/email/lurk.png" width="20" height="20" alt="" style="vertical-align:-4px;margin-right:8px" />${escapeHtml(PRODUCT_NAME)}</td></tr>
<tr><td align="center" style="padding:32px 32px 4px">
<div style="display:inline-block;padding:4px 12px;border-radius:999px;background:${C.surface2};${text(13, C.fgMuted, 500)}">
<img src="${escapeHtml(appUrl)}/email/reddit.png" width="14" height="14" alt="" style="vertical-align:-2px;margin-right:6px" />${leadsPhrase(invitee.recentCount)} for ${name}</div></td></tr>
<tr><td align="center" style="padding:14px 32px 6px;${text(24, C.fg, 500)};line-height:1.25">People on Reddit are asking for what you make.</td></tr>
<tr><td align="center" style="padding:0 40px 24px;${text(15, C.fgMuted)}">The newest ones worth a look.</td></tr>
${cards}
<tr><td align="center" style="padding:20px 32px 6px;${text(17, C.fg, 500)}">Want these as they come in?</td></tr>
<tr><td align="center" style="padding:0 40px 18px;${text(14, C.fgMuted)}">One email a day, only when there's someone new. It's free, and this is the only time we'll ask.</td></tr>
<tr><td align="center" style="padding:0 24px 18px">${acceptButton(appUrl, links.accept)}</td></tr>
<tr><td align="center" style="padding:0 24px 32px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
<td style="padding:0 6px 0 0;${text(13, C.fgMuted)}">or send them to</td>
${chatPill(appUrl, links.chat, "slack", "Slack")}${chatPill(appUrl, links.chat, "discord", "Discord")}
</tr></table></td></tr>
<tr><td align="center" style="padding:16px 32px 24px;border-top:1px solid ${C.border};${text(12, C.fgMuted)}">You signed up for ${escapeHtml(PRODUCT_NAME)} with this address.<br />${escapeHtml(PRODUCT_NAME_WITH_PROVIDER)}</td></tr>
</table></td></tr></table></body></html>`;
  const lines = leads.map((lead) => `- ${lead.title} (r/${lead.subreddit})\n  ${lead.url}`);
  const plain = [
    `${leadsPhrase(invitee.recentCount)} for ${invitee.projectName}. The newest ones worth a look:`,
    ...lines,
    `Want these as they come in? One email a day, only when there's someone new. It's free, and this is the only time we'll ask.\n${links.accept}`,
    `Or send them to Slack or Discord: ${links.chat}`,
    `You signed up for ${PRODUCT_NAME} with this address.`,
  ].join("\n\n");
  return { to: invitee.email, subject: inviteSubject(invitee), html, text: plain };
}

/**
 * Asks the next few people. The ask is recorded before the send, so a failed
 * or duplicated pass never mails anyone twice; a send that throws is lost,
 * which is the cheaper mistake.
 */
export async function sendAlertInvites(
  now = new Date(),
  limit = INVITES_PER_PASS,
): Promise<number> {
  const appUrl = config().APP_URL;
  let sent = 0;
  for (const invitee of await invitees(now, limit)) {
    await db().insert(userActions).values({ userId: invitee.userId, action: INVITE_SENT, at: now });
    try {
      await sendEmail(renderInvite(invitee, await sampleLeads(invitee.projectId, now), appUrl));
      sent += 1;
    } catch (error) {
      console.error(`Alert invite to user ${invitee.userId} failed`, error);
    }
  }
  return sent;
}

export type Accepted = { email: string; projectNames: string[] };

/**
 * Turns on a daily email to the person's own address for every project of
 * theirs that has none. Pressing it twice adds nothing the second time.
 */
export async function acceptInvite(userId: string): Promise<Accepted | null> {
  const [user] = await db().select().from(users).where(eq(users.id, userId));
  if (!user?.email) {
    return null;
  }
  const owned = await db()
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.userId, userId));
  const { limits } = await tierForUser(userId);
  for (const project of owned) {
    const existing = await db()
      .select({ id: alerts.id })
      .from(alerts)
      .where(
        and(
          eq(alerts.projectId, project.id),
          eq(alerts.channel, "email"),
          eq(alerts.target, user.email),
        ),
      );
    // A project with no searches of its own would mail an empty digest most days.
    if (!(await hasActiveSearch(project.id))) {
      await enqueueOnce("widen_searches", new Date(), project.id);
    }
    if (existing.length === 0) {
      await addChannel({
        projectId: project.id,
        channel: "email",
        target: user.email,
        cadence: "daily",
        limits,
      });
    }
  }
  await db().insert(userActions).values({ userId, action: INVITE_ACCEPTED });
  return { email: user.email, projectNames: owned.map((project) => project.name) };
}
