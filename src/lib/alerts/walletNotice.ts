import { InsufficientBalanceError } from "@getanyapi/sdk";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { projects, users, walletConnections } from "@/db/schema";
import { ANYAPI_URL, PRODUCT_NAME } from "@/lib/brand";
import { config } from "@/lib/config";
import { TokenRequestError } from "@/lib/oauth";
import { sendEmail, type EmailMessage } from "./email";
import { EMAIL_COLORS as C, EMAIL_FONT, escapeHtml } from "./tokens";

/** What stopped a wallet-funded job that only the wallet's owner can put right. */
export type WalletTrouble = "balance" | "reconnect";

/** A failing job comes back every hour. The owner hears about it this often. */
export const NOTICE_GAP_MS = 3 * 24 * 60 * 60 * 1000;

/** Reads the whole cause chain, since a handler may wrap what the SDK threw. */
export function walletTroubleOf(error: unknown): WalletTrouble | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof InsufficientBalanceError) {
      return "balance";
    }
    if (current instanceof TokenRequestError && (current.status === 400 || current.status === 401)) {
      return "reconnect";
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

const COPY: Record<WalletTrouble, { subject: string; lead: string; cta: string }> = {
  balance: {
    subject: "Your AnyAPI wallet is out of credits",
    lead: "has stopped scanning because the AnyAPI wallet that pays for it has run out of credits. Add credits and the next scheduled scan picks up where it left off; nothing else needs doing.",
    cta: "Add credits at AnyAPI",
  },
  reconnect: {
    subject: "Reconnect your AnyAPI wallet",
    lead: "has stopped scanning because its connection to your AnyAPI wallet is no longer valid. Reconnect it in settings and the next scheduled scan runs as usual.",
    cta: "Reconnect in settings",
  },
};

export function renderWalletNotice(
  trouble: WalletTrouble,
  projectName: string,
  to: string,
): EmailMessage {
  const copy = COPY[trouble];
  const settingsUrl = `${config().APP_URL.replace(/\/$/, "")}/app/settings`;
  const url = trouble === "balance" ? `${ANYAPI_URL}&utm_medium=email` : settingsUrl;
  const sentence = `${projectName} ${copy.lead}`;
  return {
    to,
    subject: copy.subject,
    text: [`${sentence}`, `${copy.cta}: ${url}`, `${PRODUCT_NAME} settings: ${settingsUrl}`].join(
      "\n\n",
    ),
    html: `<!doctype html>
<html><head><meta charset="utf-8" /><title>${escapeHtml(copy.subject)}</title></head>
<body style="margin:0;padding:24px 8px;background:${C.bg}">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="width:600px;max-width:100%;border:1px solid ${C.border};border-radius:20px">
<tr><td style="padding:24px 24px 8px;font-family:${EMAIL_FONT};font-size:20px;line-height:1.3;font-weight:500;color:${C.fg}">${escapeHtml(copy.subject)}</td></tr>
<tr><td style="padding:0 24px 16px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.5;color:${C.fgMuted}">${escapeHtml(sentence)}</td></tr>
<tr><td style="padding:0 24px 28px;font-family:${EMAIL_FONT};font-size:15px"><a href="${escapeHtml(url)}" style="color:${C.fg};text-decoration:underline">${escapeHtml(copy.cta)}</a></td></tr>
</table></body></html>`,
  };
}

/**
 * Emails the project's owner when the failure is their wallet's. The stamp is
 * taken by a conditional update before the send, so two jobs failing together
 * send one email, and it is handed back if the send itself fails.
 */
export async function noticeWalletTrouble(
  projectId: string | null,
  error: unknown,
  now = new Date(),
): Promise<boolean> {
  const trouble = walletTroubleOf(error);
  if (!trouble || !projectId) {
    return false;
  }
  const [owner] = await db()
    .select({ userId: users.id, email: users.email, projectName: projects.name })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.userId))
    .where(eq(projects.id, projectId));
  if (!owner?.email) {
    return false;
  }
  const column =
    trouble === "balance" ? walletConnections.balanceNoticeAt : walletConnections.reconnectNoticeAt;
  const field = trouble === "balance" ? "balanceNoticeAt" : "reconnectNoticeAt";
  // No wallet row means the house paid, and that is ours to fix, not theirs.
  const claimed = await db()
    .update(walletConnections)
    .set({ [field]: now })
    .where(
      and(
        eq(walletConnections.userId, owner.userId),
        or(isNull(column), lt(column, new Date(now.getTime() - NOTICE_GAP_MS))),
      ),
    )
    .returning({ id: walletConnections.id });
  if (claimed.length === 0) {
    return false;
  }
  try {
    await sendEmail(renderWalletNotice(trouble, owner.projectName, owner.email));
    return true;
  } catch (sendError) {
    await db()
      .update(walletConnections)
      .set({ [field]: null })
      .where(eq(walletConnections.userId, owner.userId));
    throw sendError;
  }
}
