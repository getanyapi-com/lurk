import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";

/**
 * The tokens in the links an alert or an invite carries: a payload, a dot, and
 * an HMAC of the payload under the app key, so a link cannot be forged or
 * pointed somewhere else without the key. The purpose is signed with the
 * payload, so a token minted for one kind of link never verifies as another.
 * Links already sit in inboxes, so a purpose and its payload's encoding, once
 * used, never change.
 */

function signatureFor(purpose: string, payload: string): string {
  const key = Buffer.from(config().APP_ENCRYPTION_KEY, "base64");
  return createHmac("sha256", key).update(`${purpose}:${payload}`).digest("base64url");
}

/** A token carrying `payload` for links of one purpose. */
export function signToken(purpose: string, payload: string): string {
  return `${payload}.${signatureFor(purpose, payload)}`;
}

/** The payload a token carries, or null when it was altered, never issued, or issued for another purpose. */
export function verifyToken(purpose: string, token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signatureFor(purpose, payload));
  return given.length === expected.length && timingSafeEqual(given, expected) ? payload : null;
}
