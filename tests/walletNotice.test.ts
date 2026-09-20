import { randomUUID } from "node:crypto";
import { InsufficientBalanceError } from "@getanyapi/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TokenRequestError } from "@/lib/oauth";

const sendEmail = vi.fn<(mail: { to: string; subject: string }) => Promise<void>>(async () => undefined);
vi.mock("@/lib/alerts/email", () => ({ sendEmail }));

const broke = () => new InsufficientBalanceError("insufficient balance", 402, undefined, "insufficient_balance");

describe("which failures are the wallet owner's to fix", () => {
  it("reads an empty wallet and a revoked grant through a wrapped error", async () => {
    const { walletTroubleOf } = await import("@/lib/alerts/walletNotice");
    expect(walletTroubleOf(new Error("scan failed", { cause: broke() }))).toBe("balance");
    expect(walletTroubleOf(new TokenRequestError(400))).toBe("reconnect");
    expect(walletTroubleOf(new TokenRequestError(503))).toBeNull();
    expect(walletTroubleOf(new Error("The language model did not answer"))).toBeNull();
  });
});

describe.skipIf(!process.env.DATABASE_URL)("emailing the owner of an empty wallet", () => {
  beforeEach(() => sendEmail.mockClear());

  async function fixture(withWallet: boolean) {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    const { db } = await import("@/db");
    const { projects, users } = await import("@/db/schema");
    const { saveWalletTokens } = await import("@/lib/anyapi");
    const [user] = await db()
      .insert(users)
      .values({ clerkUserId: `test_${randomUUID()}`, email: "owner@example.com" })
      .returning();
    const [project] = await db()
      .insert(projects)
      .values({ userId: user.id, name: "Formcraft" })
      .returning();
    if (withWallet) {
      await saveWalletTokens(user.id, {
        access_token: "a",
        refresh_token: "r",
        expires_in: 3600,
        scope: "run",
      });
    }
    return { db, users, user, project, saveWalletTokens };
  }

  it("tells them once, again after the gap, and again after a reconnect", async () => {
    const { noticeWalletTrouble, NOTICE_GAP_MS } = await import("@/lib/alerts/walletNotice");
    const { eq } = await import("drizzle-orm");
    const { db, users, user, project, saveWalletTokens } = await fixture(true);
    try {
      const now = new Date();
      const both = await Promise.all([
        noticeWalletTrouble(project.id, broke(), now),
        noticeWalletTrouble(project.id, broke(), now),
      ]);
      expect(both.filter(Boolean)).toHaveLength(1);
      expect(await noticeWalletTrouble(project.id, broke(), new Date(now.getTime() + 3_600_000))).toBe(false);
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail.mock.calls[0][0]).toMatchObject({
        to: "owner@example.com",
        subject: "Your AnyAPI wallet is out of credits",
      });

      expect(
        await noticeWalletTrouble(project.id, broke(), new Date(now.getTime() + NOTICE_GAP_MS + 1000)),
      ).toBe(true);

      await saveWalletTokens(user.id, { access_token: "a", refresh_token: "r", expires_in: 3600, scope: "run" });
      expect(await noticeWalletTrouble(project.id, broke(), now)).toBe(true);
      expect(sendEmail).toHaveBeenCalledTimes(3);
    } finally {
      await db().delete(users).where(eq(users.id, user.id));
    }
  });

  it("says nothing when the house paid, and hands the stamp back when the send fails", async () => {
    const { noticeWalletTrouble } = await import("@/lib/alerts/walletNotice");
    const { eq } = await import("drizzle-orm");
    const free = await fixture(false);
    const paid = await fixture(true);
    try {
      expect(await noticeWalletTrouble(free.project.id, broke())).toBe(false);
      expect(sendEmail).not.toHaveBeenCalled();

      sendEmail.mockRejectedValueOnce(new Error("smtp down"));
      await expect(noticeWalletTrouble(paid.project.id, broke())).rejects.toThrow("smtp down");
      expect(await noticeWalletTrouble(paid.project.id, broke())).toBe(true);
    } finally {
      await free.db().delete(free.users).where(eq(free.users.id, free.user.id));
      await paid.db().delete(paid.users).where(eq(paid.users.id, paid.user.id));
    }
  });
});
