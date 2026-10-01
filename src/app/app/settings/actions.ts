"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { walletConnections } from "@/db/schema";
import { walletConnection } from "@/lib/anyapi";
import { requireLocalUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { decryptSecret } from "@/lib/crypto";
import { revokeToken } from "@/lib/oauth";

/** Deletes the stored connection, telling AnyAPI to revoke it best effort. */
export async function disconnectWalletAction() {
  const user = await requireLocalUser();
  const row = await walletConnection(user.id);
  if (row) {
    await revokeToken(decryptSecret(row.refreshToken, config().APP_ENCRYPTION_KEY));
    await db().delete(walletConnections).where(eq(walletConnections.userId, user.id));
  }
  revalidatePath("/app/settings");
}
