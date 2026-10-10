/**
 * Display priority only. Never qualifies a lead, sends an alert or buys context.
 * These are explicit heuristics, not calibrated adoption/conversion probabilities.
 * Keep the version and floor frozen while collecting unseen owner feedback.
 */
export const X_PRIORITY_VERSION = "x-attention-2026-10-09.1";
export const X_PRIORITY_FLOOR = 0.4;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function bounded(value: unknown, maximum = 1): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum ? value : null;
}

function noul(signals: Record<string, unknown>, key: string): number | null {
  const answer = record(signals[key]);
  return answer.type === "noul" ? bounded(answer.noul) : null;
}

/** Gateways may omit probabilities. Use the unrounded score in that case. */
export function expectedXIntent(value: unknown): number | null {
  const answer = record(value);
  if (answer.type !== "score") return null;
  const probabilities = record(answer.probabilities);
  const entries = Object.entries(probabilities);
  if (entries.length > 0 && entries.every(([level, mass]) => /^[0-4]$/u.test(level) && bounded(mass) !== null)) {
    const total = entries.reduce((sum, [, mass]) => sum + (mass as number), 0);
    // Do not interpret incomplete/malformed distributions as confidence.
    if (total >= 0.95 && total <= 1.05) {
      return entries.reduce((sum, [level, mass]) => sum + Number(level) * (mass as number), 0) / total;
    }
  }
  return bounded(answer.score, 4);
}

export type XPriorityInput = {
  key: string;
  author: string;
  postedAt: Date;
  engagement: number | null;
  signals: unknown;
  level: string | null;
};

export type XPriority = { priority: number | null; checks: string[] };

export function xPriority(input: Pick<XPriorityInput, "signals" | "level">): XPriority {
  const signals = record(input.signals);
  const checks: string[] = [];
  const own = noul(signals, "own_need");
  const same = noul(signals, "same_kind");
  const supported = noul(signals, "supported_job");
  const intent = expectedXIntent(signals.intent);
  const seller = noul(signals, "rival_vendor");
  const promoting = noul(signals, "promoting");
  const resolved = noul(signals, "resolved");
  const reply = record(signals.reply);
  const verifiedReply = reply.worth_reply === true;
  if (input.level !== "complete" && !verifiedReply) checks.push("Check author and context");
  const requirement = record(signals.hard_requirement);
  if (requirement.type !== "choice" || requirement.choice === "unknown") checks.push("Check requirements");
  const unmet = requirement.type === "choice" && requirement.choice === "unmet";
  if (unmet) checks.push("Requirement may not fit");
  const failedReply = reply.worth_reply === false || reply.code === "not_reply_worthy";
  if (failedReply) checks.push("Reply review negative");
  if (own === null || (same === null && supported === null) || intent === null || seller === null || promoting === null || resolved === null) {
    return { priority: null, checks: [...checks, "Not enough scoring evidence"] };
  }
  // No commercial/personal/free-use penalty. A supported basic job can be a
  // useful entry point even when the specialised product brief calls it a neighbour.
  const fit = Math.max(same ?? 0, supported ?? 0);
  let priority = own * fit * ((intent + 1) / 5) * (1 - seller) * (1 - promoting) * (1 - resolved);
  // Keep checked public conversations: a workflow/venue need not be an adopter
  // asking for themselves. This bounded term requires the actual completed
  // reply check, not a high unverified founder_would_reply answer alone.
  if (verifiedReply) {
    priority = Math.max(priority, 0.5 * (noul(signals, "founder_would_reply") ?? 0) * fit * (1 - seller));
  }
  if (unmet) priority *= 0.2;
  if (failedReply) priority *= 0.3;
  return { priority, checks };
}

/** No stage/band/date cap before ranking; unknown scores come last, not zero. */
export function rankXOpportunities<T extends XPriorityInput>(inputs: T[], deduplicate = true): (T & XPriority)[] {
  const ranked = inputs.map((input) => ({ ...input, ...xPriority(input) })).sort((a, b) =>
    (b.priority ?? -1) - (a.priority ?? -1) || b.postedAt.getTime() - a.postedAt.getTime() ||
    (b.engagement ?? -1) - (a.engagement ?? -1) || a.key.localeCompare(b.key),
  );
  if (!deduplicate) return ranked;
  const authors = new Set<string>();
  return ranked.filter((item) => {
    const author = item.author.trim().toLowerCase() || item.key;
    if (authors.has(author)) return false;
    authors.add(author);
    return true;
  });
}
