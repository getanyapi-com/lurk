import { NextResponse, type NextRequest } from "next/server";
import { requireLocalUser } from "@/lib/auth";
import { saveWalletTokens } from "@/lib/anyapi";
import { config } from "@/lib/config";
import { exchangeCode } from "@/lib/oauth";
import { CONNECT_COOKIE } from "../route";

function settingsUrl(status: string): string {
  return `${config().APP_URL}/app/settings?wallet=${status}`;
}

/** Finishes the flow: verify state, exchange the code, store the encrypted tokens. */
export async function GET(request: NextRequest) {
  const stashed = request.cookies.get(CONNECT_COOKIE)?.value;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!stashed || !code || !state) {
    return NextResponse.redirect(settingsUrl("failed"));
  }
  const { verifier, state: expected } = JSON.parse(stashed) as { verifier: string; state: string };
  if (state !== expected) {
    return NextResponse.redirect(settingsUrl("failed"));
  }
  const user = await requireLocalUser();
  const tokens = await exchangeCode(code, verifier);
  await saveWalletTokens(user.id, tokens);
  const response = NextResponse.redirect(settingsUrl("connected"));
  response.cookies.set(CONNECT_COOKIE, "", { path: "/connect", maxAge: 0 });
  return response;
}
