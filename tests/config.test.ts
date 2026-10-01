import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderDigestHtml, renderDigestText } from "@/lib/alerts/digest";
import { sampleDigest } from "@/lib/alerts/fixtures";
import { config } from "@/lib/config";

/**
 * Every link the app sends is built as `${APP_URL}/path`, so an APP_URL
 * written with a trailing slash makes "https://lurk.so//alerts/on" wherever a
 * link is built without trimming it. The config trims it once, and nothing
 * after it has to.
 */
describe("the base URLs the config hands out", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://reddit_leads@localhost:5433/reddit_leads");
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("drops a trailing slash from APP_URL and ANYAPI_BASE_URL", () => {
    vi.stubEnv("APP_URL", "https://lurk.so/");
    vi.stubEnv("ANYAPI_BASE_URL", "https://api.getanyapi.com//");
    expect(config().APP_URL).toBe("https://lurk.so");
    expect(config().ANYAPI_BASE_URL).toBe("https://api.getanyapi.com");
  });

  it("keeps the defaults, with no slash to drop, when they are unset", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("ANYAPI_BASE_URL", "");
    expect(config().APP_URL).toBe("http://localhost:3000");
    expect(config().ANYAPI_BASE_URL).toBe("https://api.getanyapi.com");
  });

  it("builds an email's links with one slash after the host", () => {
    vi.stubEnv("APP_URL", "https://lurk.so/");
    const digest = sampleDigest("Acme");
    const html = renderDigestHtml(digest);
    expect(html).toContain('src="https://lurk.so/email/lurk.png"');
    expect(html).not.toContain("lurk.so//");
    expect(renderDigestText(digest)).not.toContain("lurk.so//");
  });

  it("reads ALERTS_ALLOW_PRIVATE_WEBHOOKS as a switch that is off unless set true", () => {
    vi.stubEnv("ALERTS_ALLOW_PRIVATE_WEBHOOKS", "");
    expect(config().ALERTS_ALLOW_PRIVATE_WEBHOOKS).toBe(false);
    vi.stubEnv("ALERTS_ALLOW_PRIVATE_WEBHOOKS", "true");
    expect(config().ALERTS_ALLOW_PRIVATE_WEBHOOKS).toBe(true);
  });
});
