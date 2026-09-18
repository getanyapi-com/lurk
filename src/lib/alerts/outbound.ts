import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/** Long enough for a slow receiver, short enough that one cannot hold up the rest. */
const TIMEOUT_MS = 10_000;

/** Every range that is not the public internet: loopback, private, link-local, reserved. */
const blocked = new BlockList();
for (const [prefix, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  blocked.addSubnet(prefix, bits, "ipv4");
}
for (const [prefix, bits] of [
  ["::", 127],
  ["64:ff9b::", 96],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(prefix, bits, "ipv6");
}

/** Whether an address is one a stranger's webhook may point at. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) {
    return false;
  }
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) {
      return !blocked.check(mapped[1], "ipv4");
    }
    return !blocked.check(address, "ipv6");
  }
  return !blocked.check(address, "ipv4");
}

/** A self-hosted instance can point webhooks at its own network by saying so. */
function privateAllowed(): boolean {
  return process.env.ALERTS_ALLOW_PRIVATE_WEBHOOKS === "true";
}

const REFUSED = "Webhook address is not on the public internet";

/**
 * Resolves like the default lookup, then refuses any private answer. It runs at
 * connection time, so the address checked is the address connected to and a
 * name cannot change its answer between the two.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 0);
      return;
    }
    const bad = addresses.find((one) => !isPublicAddress(one.address));
    if (bad || addresses.length === 0) {
      callback(new Error(REFUSED), "", 0);
      return;
    }
    if (options.all) {
      callback(null, addresses);
      return;
    }
    callback(null, addresses[0].address, addresses[0].family);
  });
};

/**
 * POSTs JSON to an address a user typed. Only http(s), only public addresses,
 * never a redirect, and never for longer than the timeout.
 */
export function postJson(target: string, body: unknown): Promise<number> {
  const url = new URL(target);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return Promise.reject(new Error("Webhook URL must be http or https"));
  }
  const guarded = !privateAllowed();
  // A literal address never reaches the lookup, so it is checked here.
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (guarded && isIP(literal) !== 0 && !isPublicAddress(literal)) {
    return Promise.reject(new Error(REFUSED));
  }
  const payload = JSON.stringify(body);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = send(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
        lookup: guarded ? guardedLookup : undefined,
        // One connection per send, so no pooled socket skips the lookup.
        agent: false,
        timeout: TIMEOUT_MS,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
        response.on("error", reject);
      },
    );
    const deadline = setTimeout(
      () => request.destroy(new Error("Webhook took longer than 10 seconds")),
      TIMEOUT_MS,
    );
    request.on("timeout", () => request.destroy(new Error("Webhook took longer than 10 seconds")));
    request.on("error", reject);
    request.on("close", () => clearTimeout(deadline));
    request.end(payload);
  });
}
