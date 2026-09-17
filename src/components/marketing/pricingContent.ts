/** Entry paid plan per tool, monthly billing, read from each pricing page on 2026-09-06. */
export const PRICING_OBSERVED = "2026-09-06";

export const MONTHLY_PLANS = [
  { name: "lurk", domain: "lurk.so", mark: "/icon.svg", usd: 0, note: "Dashboard, AI scoring, competitors, Reddit SEO" },
  {
    name: "F5Bot",
    domain: "f5bot.com",
    usd: 0,
    note: "Email keyword alerts",
    callout: "Also free, but it only emails you every keyword match. No dashboard, no AI scoring, no competitor tracking, no SEO.",
  },
  { name: "ReplyGuy", domain: "replyguy.com", usd: 10, note: "Small plan" },
  { name: "LeadsRover", domain: "leadsrover.io", usd: 13.99, note: "Starter plan" },
  { name: "GummySearch", domain: "gummysearch.com", usd: 29, note: "Starter plan" },
] as const;
