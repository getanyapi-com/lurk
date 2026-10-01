import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

function readKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`APP_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes`);
  }
  return key;
}

/** AES-256-GCM. Returns base64 of iv || authTag || ciphertext. */
export function encryptSecret(plaintext: string, base64Key: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, readKey(base64Key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/** Inverse of encryptSecret. Throws when the payload or the key is wrong. */
export function decryptSecret(payload: string, base64Key: string): string {
  const raw = Buffer.from(payload, "base64");
  if (raw.length <= IV_BYTES + 16) {
    throw new Error("Encrypted payload is too short");
  }
  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(IV_BYTES, IV_BYTES + 16);
  const decipher = createDecipheriv(ALGORITHM, readKey(base64Key), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + 16)), decipher.final()]).toString(
    "utf8",
  );
}
