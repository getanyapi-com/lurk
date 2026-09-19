import posthog from "posthog-js";

// Product analytics and session replay, in lurk's own PostHog project (id
// 617229, in the AnyAPI organization). A visitor who clicks through to
// getanyapi.com still shows up there as lurk.so referral traffic.
//
// The token is a public, write-only project key.
const PROJECT_TOKEN = "phc_xo2ndq68UowY94Ay5HLjA85E5Hdgn4K8qMZYd2DfMXwU";

// Only the production host reports, so local dev and `next start` runs do not
// land in lurk's numbers.
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
