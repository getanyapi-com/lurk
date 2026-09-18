import posthog from "posthog-js";

// Product analytics and session replay, in the same PostHog project as AnyAPI
// (the one `make dashboard` reads), so a visitor who clicks through from lurk.so
// to getanyapi.com shows up as lurk.so referral traffic there.
//
// The token is a public, write-only project key; AnyAPI commits the same value.
const PROJECT_TOKEN = "phc_qFZTTUQhaMnCFekyR53ir236tBoPLGTgRLwjxxG6sPHD";

// Only the production host reports, so local dev and `next start` runs do not
// land in AnyAPI's numbers.
if (window.location.hostname === "lurk.so") {
  posthog.init(PROJECT_TOKEN, {
    // Same-origin, rewritten to PostHog in next.config.ts, so blockers that
    // match on posthog.com hostnames do not drop the events.
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2026-01-30",
    disable_surveys: true,
  });
}
