import { expect, it, vi } from "vitest";
import { describeDb, makeUser } from "./fixtures/db";

/**
 * AnyAPI rotates the refresh token on every use and revokes the connection
 * when an old one comes back. Two jobs for one user that both find the access
 * token expired must spend the stored refresh token once between them. Proven
 * against a real database, because the row lock that orders them lives there.
 */

const refreshTokens = vi.fn(async (refreshToken: string) => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  return {
    access_token: `access-after-${refreshToken}`,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: `next-${refreshToken}`,
    scope: "run balance:read",
  };
});

vi.mock("@/lib/oauth", () => ({ refreshTokens }));

describeDb("refreshing a wallet's access token", () => {
  it("spends the refresh token once when two jobs find it expired together", async () => {
    const { db } = await import("@/db");
    const { users, walletConnections } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { clientForUser, saveWalletTokens } = await import("@/lib/anyapi");
    const user = await makeUser();
    try {
      await saveWalletTokens(user.id, {
        access_token: "expired",
        refresh_token: "first",
        expires_in: -60,
        scope: "run balance:read",
      });

      const clients = await Promise.all([clientForUser(user.id), clientForUser(user.id)]);

      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(refreshTokens).toHaveBeenCalledWith("first");
      expect(clients.map((one) => one.funding)).toEqual([
        `wallet:${user.id}`,
        `wallet:${user.id}`,
      ]);
      const [row] = await db()
        .select()
        .from(walletConnections)
        .where(eq(walletConnections.userId, user.id));
      expect(row.accessTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    } finally {
      await db().delete(users).where(eq(users.id, user.id));
    }
  });
});
