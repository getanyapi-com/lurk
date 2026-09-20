import { createHash, randomBytes } from "node:crypto";
import { config } from "./config";

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export const OAUTH_SCOPE = "run balance:read";

function base64Url(input: Buffer): string {
  return input.toString("base64url");
}

/** A PKCE verifier and its S256 challenge. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return base64Url(randomBytes(24));
}

export function redirectUri(): string {
  return `${config().APP_URL.replace(/\/$/, "")}/connect/callback`;
}

export function authorizeUrl(state: string, challenge: string): string {
  const { ANYAPI_BASE_URL, ANYAPI_OAUTH_CLIENT_ID } = config();
  if (!ANYAPI_OAUTH_CLIENT_ID) {
    throw new Error("ANYAPI_OAUTH_CLIENT_ID is not set; run npm run anyapi:register");
  }
  const query = new URLSearchParams({
    client_id: ANYAPI_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: OAUTH_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${ANYAPI_BASE_URL.replace(/\/$/, "")}/oauth/authorize?${query.toString()}`;
}

/** The token endpoint said no. A 400 or 401 on a refresh means the grant is gone. */
export class TokenRequestError extends Error {
  constructor(readonly status: number) {
    super(`AnyAPI token request failed with status ${status}`);
    this.name = "TokenRequestError";
  }
}

async function postToken(form: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(`${config().ANYAPI_BASE_URL.replace(/\/$/, "")}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!response.ok) {
    throw new TokenRequestError(response.status);
  }
  return (await response.json()) as TokenResponse;
}

export function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  const { ANYAPI_OAUTH_CLIENT_ID } = config();
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: ANYAPI_OAUTH_CLIENT_ID ?? "",
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  );
}

export function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  const { ANYAPI_OAUTH_CLIENT_ID } = config();
  return postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: ANYAPI_OAUTH_CLIENT_ID ?? "",
    }),
  );
}

/** Best effort: a failed revoke must not block disconnecting locally. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`${config().ANYAPI_BASE_URL.replace(/\/$/, "")}/oauth/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    return;
  }
}
