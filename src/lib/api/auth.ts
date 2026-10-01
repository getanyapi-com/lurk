import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { config } from "@/lib/config";
import { limitsForUser } from "@/lib/tier";
import type { TierLimits, TierName } from "@/lib/tiers";
import { findApiKey, touchApiKey } from "./keys";
import { consumeDailyRequest } from "./limit";
import { ApiError } from "./responses";

export type ApiCaller = {
  user: typeof users.$inferSelect;
  keyId: string;
  keyPrefix: string;
  scopes: string[];
  tier: TierName;
  limits: TierLimits | null;
  selfHosted: boolean;
};

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new ApiError("unauthorized", "Send Authorization: Bearer rl_sk_... with every request.", {
      "WWW-Authenticate": 'Bearer realm="reddit-leads"',
    });
  }
  return token;
}

/** Who is calling. Throws the 401 the caller should see when nobody is. */
export async function authenticate(request: Request): Promise<ApiCaller> {
  const key = await findApiKey(bearerToken(request));
  if (!key) {
    throw new ApiError("unauthorized", "That API key is not valid.", {
      "WWW-Authenticate": 'Bearer realm="reddit-leads"',
    });
  }
  const rows = await db().select().from(users).where(eq(users.id, key.userId));
  const user = rows[0];
  if (!user) {
    throw new ApiError("unauthorized", "That API key is not valid.");
  }
  const { name, limits } = await limitsForUser(user.id);
  return {
    user,
    keyId: key.id,
    keyPrefix: key.prefix,
    scopes: key.scopes ?? [],
    tier: name,
    limits,
    selfHosted: config().SELF_HOSTED,
  };
}

/**
 * Authenticate, then count the request against the key's day. A self-hosted
 * instance has no tier limits, so nothing is counted and nothing is refused.
 */
export async function requireCaller(request: Request): Promise<ApiCaller> {
  const caller = await authenticate(request);
  if (caller.limits) {
    const outcome = await consumeDailyRequest(caller.keyId, caller.limits.apiRequestsPerDay);
    if (!outcome.allowed) {
      throw new ApiError(
        "rate_limited",
        `This key has used its ${outcome.limit} requests for today. Connect an AnyAPI wallet for a larger daily allowance.`,
        { "Retry-After": String(outcome.retryAfterSeconds) },
      );
    }
  }
  await touchApiKey(caller.keyId);
  return caller;
}
