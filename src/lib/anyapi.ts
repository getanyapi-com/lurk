import { AsyncLocalStorage } from "node:async_hooks";
import { AnyAPI } from "@getanyapi/sdk";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { walletConnections } from "@/db/schema";
import { config } from "./config";
import { decryptSecret, encryptSecret } from "./crypto";
import { refreshTokens } from "./oauth";

/** Who pays for a call: the operator's house key, or one user's AnyAPI wallet. */
export type Funding = "house" | `wallet:${string}`;

/** One SDK call and the request id the gateway put on that call's response. */
export type FundedCall<T> = { result: T; requestId: string | null };

/**
 * The gateway returns its request id on the `x-anyapi-request-id` response
 * header only; the SDK's run envelope carries no such field. Wrapping fetch is
 * the one seam that sees the header, so the ledger can name the request. Every
 * call has to be wrapped in `call`, which is what gives it its own id: a
 * response without the header reports null rather than the previous call's id.
 */
export type FundedClient = {
  client: AnyAPI;
  funding: Funding;
  call: <T>(fn: () => Promise<T>) => Promise<FundedCall<T>>;
};

const REQUEST_ID_HEADER = "x-anyapi-request-id";

/** The box belonging to the `call` this response is being fetched inside. */
type RequestIdBox = { requestId: string | null };

const requestIdScope = new AsyncLocalStorage<RequestIdBox>();

/** Runs one call in its own scope, so it can only report its own request id. */
export async function withRequestId<T>(fn: () => Promise<T>): Promise<FundedCall<T>> {
  const box: RequestIdBox = { requestId: null };
  const result = await requestIdScope.run(box, fn);
  return { result, requestId: box.requestId };
}

/** Files what this response said, including saying nothing, into its call. */
export function captureRequestId(response: Response): void {
  const box = requestIdScope.getStore();
  if (box) {
    box.requestId = response.headers.get(REQUEST_ID_HEADER);
  }
}

/** Raised before the request is sent, so nothing is bought. */
export class SeoEndpointRefusedError extends Error {
  constructor(slug: string) {
    super(`lurk never buys AnyAPI's seo endpoints, and something asked for ${slug}.`);
    this.name = "SeoEndpointRefusedError";
  }
}

/**
 * lurk does not buy AnyAPI's `seo.*` endpoints, under any circumstance. One
 * `seo.search_volume` call was $0.108, more than half of what a whole first
 * sweep costs. Nothing calls them today; this is what keeps it that way, at the
 * one seam every request to the gateway goes through.
 */
export function refuseSeoEndpoint(url: string): void {
  const slug = /\/v1\/run\/([^/?#]+)/.exec(url)?.[1];
  if (slug && decodeURIComponent(slug).toLowerCase().startsWith("seo.")) {
    throw new SeoEndpointRefusedError(decodeURIComponent(slug));
  }
}

function clientCapturingRequestId(apiKey: string, baseUrl: string) {
  const client = new AnyAPI({
    apiKey,
    baseUrl,
    fetch: async (input, init) => {
      refuseSeoEndpoint(input instanceof Request ? input.url : String(input));
      const response = await fetch(input, init);
      captureRequestId(response);
      return response;
    },
  });
  return { client, call: withRequestId };
}

const EXPIRY_SKEW_MS = 60_000;

export async function walletConnection(userId: string) {
  const rows = await db()
    .select()
    .from(walletConnections)
    .where(eq(walletConnections.userId, userId));
  return rows[0] ?? null;
}

type WalletRow = typeof walletConnections.$inferSelect;

function freshAccessToken(row: WalletRow, key: string): string | null {
  const fresh =
    row.accessToken &&
    row.accessTokenExpiresAt &&
    row.accessTokenExpiresAt.getTime() - EXPIRY_SKEW_MS > Date.now();
  return fresh && row.accessToken ? decryptSecret(row.accessToken, key) : null;
}

/**
 * AnyAPI rotates the refresh token on every use and treats a second use of an
 * old one as theft, revoking the connection. Two jobs for one user that both
 * find the access token expired must therefore not both refresh: the row is
 * locked for the exchange, and whoever waited reads what the first one stored.
 */
async function walletAccessToken(userId: string): Promise<string | null> {
  const row = await walletConnection(userId);
  if (!row) {
    return null;
  }
  const key = config().APP_ENCRYPTION_KEY;
  const held = freshAccessToken(row, key);
  if (held) {
    return held;
  }
  return db().transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(walletConnections)
      .where(eq(walletConnections.userId, userId))
      .for("update");
    if (!locked) {
      return null;
    }
    const stored = freshAccessToken(locked, key);
    if (stored) {
      return stored;
    }
    const tokens = await refreshTokens(decryptSecret(locked.refreshToken, key));
    await tx
      .update(walletConnections)
      .set({
        refreshToken: encryptSecret(tokens.refresh_token, key),
        accessToken: encryptSecret(tokens.access_token, key),
        accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scope: tokens.scope,
      })
      .where(eq(walletConnections.userId, userId));
    return tokens.access_token;
  });
}

/** Store a freshly issued token pair for a user, encrypting both secrets. */
export async function saveWalletTokens(
  userId: string,
  tokens: { access_token: string; refresh_token: string; expires_in: number; scope: string },
) {
  const key = config().APP_ENCRYPTION_KEY;
  const values = {
    userId,
    refreshToken: encryptSecret(tokens.refresh_token, key),
    accessToken: encryptSecret(tokens.access_token, key),
    accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scope: tokens.scope,
    connectedAt: new Date(),
  };
  await db()
    .insert(walletConnections)
    .values(values)
    .onConflictDoUpdate({ target: walletConnections.userId, set: values });
}

/**
 * An SDK client for this user: their wallet when connected, the house key
 * otherwise. `funding` is what a scan writes into search_runs.funded_by.
 */
export async function clientForUser(userId: string): Promise<FundedClient> {
  const { ANYAPI_BASE_URL, ANYAPI_HOUSE_API_KEY } = config();
  const walletToken = await walletAccessToken(userId);
  if (walletToken) {
    return {
      ...clientCapturingRequestId(walletToken, ANYAPI_BASE_URL),
      funding: `wallet:${userId}`,
    };
  }
  if (!ANYAPI_HOUSE_API_KEY) {
    throw new Error("No wallet connected and ANYAPI_HOUSE_API_KEY is not set");
  }
  return {
    ...clientCapturingRequestId(ANYAPI_HOUSE_API_KEY, ANYAPI_BASE_URL),
    funding: "house",
  };
}
