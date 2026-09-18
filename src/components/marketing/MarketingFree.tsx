"use client";
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { PRESETS } from "@/lib/settings/presets";
import { limitsFor, type TierName } from "@/lib/tiers";
import { AnyapiLink } from "@/components/AnyapiLink";
import { BrandImage } from "./BrandImage";
import { MONTHLY_PLANS, PRICING_OBSERVED } from "./pricingContent";

const OPTIONS = [
  { id: "free", label: "Hosted free" },
  { id: "connected", label: "Connected wallet" },
  { id: "self-host", label: "Self-host" },
] as const;
type Choice = (typeof OPTIONS)[number]["id"];
const count = (value: number | null | undefined) =>
  value == null ? "No app limit" : value.toLocaleString("en-US");

/** What the scan cadence preset of each option says, in the visitor's words. */
function cadenceLabel(choice: Choice): string {
  if (choice === "self-host") {
    return "Your schedule";
  }
  const cadence = PRESETS[choice].cadence;
  return cadence.kind === "daily"
    ? "Daily, at the hour you pick"
    : `Every ${cadence.hours === 1 ? "hour" : `${cadence.hours} hours`}`;
}

const MAX_USD = Math.max(...MONTHLY_PLANS.map((plan) => plan.usd));

export function MarketingFree() {
  const reduced = useReducedMotion();
  const [choice, setChoice] = useState<Choice>("free");
  const limits = limitsFor(
    choice === "self-host" ? "free" : (choice as TierName),
    choice === "self-host",
  );
  const fields = [
    ["Projects", count(limits?.projects)],
    ["Keywords / project", count(limits?.keywordsPerProject)],
    ["Communities / project", count(limits?.subredditsPerProject)],
    ["Scan cadence", cadenceLabel(choice)],
    [
      "SEO refresh",
      limits
        ? `Every ${limits.seoRefreshDays} ${limits.seoRefreshDays === 1 ? "day" : "days"}`
        : "Your schedule",
    ],
    ["API reads / day", count(limits?.apiRequestsPerDay)],
  ];
  return (
    <section className="free-section" id="costs" data-proof="costs">
      <header className="narrow-heading">
        <h2>
          <span>Free.</span> No card, no subscription.
        </h2>
        <p>
          The hosted app runs on our own <AnyapiLink /> wallet within the limits below. Connect your
          own wallet for more, or self-host the MIT source with no app limits at all.
        </p>
      </header>
      <div className="plan-chart" role="table" aria-label="Entry plan per month">
        {MONTHLY_PLANS.map((plan) => (
          <div role="row" className="plan-row" key={plan.name}>
            <span role="cell" className="plan-name">
              <BrandImage
                name={plan.name}
                src={"mark" in plan ? plan.mark : undefined}
                domain={plan.domain}
                size={22}
              />
              {plan.name}
              <small>{plan.note}</small>
            </span>
            <span role="cell" className="plan-track">
              <motion.span
                className={plan.name === "lurk" ? "plan-bar accent" : "plan-bar"}
                initial={reduced ? false : { scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ duration: reduced ? 0 : 0.6, ease: "easeOut" }}
                style={{ width: `${Math.max((plan.usd / MAX_USD) * 100, 2)}%` }}
              />
              {"callout" in plan ? (
                <span className="plan-callout">
                  <svg viewBox="0 0 48 32" aria-hidden="true">
                    <path d="M46 4 C 30 2, 14 10, 4 26" />
                    <path d="M3 17 L 4 26 L 13 24" />
                  </svg>
                  {plan.callout}
                </span>
              ) : null}
            </span>
            <span role="cell" className="plan-value">
              {plan.usd === 0 ? "Free" : `$${plan.usd}/mo`}
            </span>
          </div>
        ))}
        <small className="plan-note">
          Entry plan, monthly billing, as published on {PRICING_OBSERVED}.
        </small>
      </div>
      <div
        className="tier-selector"
        role="tablist"
        aria-label="Hosting options"
      >
        {OPTIONS.map((option, index) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            id={`tier-${option.id}`}
            aria-selected={choice === option.id}
            aria-controls="tier-limits"
            tabIndex={choice === option.id ? 0 : -1}
            onClick={() => setChoice(option.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                const next =
                  OPTIONS[(index + (event.key === "ArrowRight" ? 1 : 2)) % 3];
                setChoice(next.id);
                document.getElementById(`tier-${next.id}`)?.focus();
              }
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div
        className="tier-limits"
        id="tier-limits"
        role="tabpanel"
        aria-labelledby={`tier-${choice}`}
      >
        <p>
          {choice === "free"
            ? "Start on the house wallet, within the hosted free limits."
            : choice === "connected"
              ? "Connect through AnyAPI, set the spend cap there, and pay per call. Disconnecting revokes it."
              : "Run the MIT source yourself. App tier limits are removed."}
        </p>
        <dl>
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <small>
          {limits
            ? `${limits.alertCadence === "daily" ? "Daily" : "Hourly"} alerts / Slack and Discord, plus ${count(limits.customWebhooks)} custom webhook${limits.customWebhooks === 1 ? "" : "s"}`
            : "Configure Docker, Postgres, Clerk, AnyAPI and OpenRouter. Model usage is billed separately."}
        </small>
      </div>
    </section>
  );
}
