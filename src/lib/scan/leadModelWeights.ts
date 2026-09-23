import type { LeadModel } from "./leadModel";

/**
 * The fitted lead models. Fitted 2026-09-23 by .context/exp/fit-low.py on
 * 2,362 posts labelled good, weak or bad against each of 172 products' own
 * sites, judged with exactly the request the scan sends (score.ts
 * judgeRequest), one post a request. The briefs are the ones the onboarding
 * reading writes on low effort (profile.ts profileFromPage), which covered
 * 2,257 of the posts. Logistic regression on standardised answers, trained on
 * the posts the shared reading lets through; the threshold keeps as many
 * good leads as the gates it replaced. Out of fold, by product:
 *
 *   with a brief      gates before: 590 shown, 62% good,  8% bad, 363 of 650 good kept
 *                     this model:   540 shown, 67% good,  7% bad, 363 of 650 good kept
 *   without a brief   gates before: 625 shown, 60% good,  9% bad, 374 of 672 good kept
 *                     this model:   587 shown, 64% good,  8% bad, 374 of 672 good kept
 *
 * Refit whenever a question in judgeRequest changes, since the weights are for
 * those answers and no others.
 */
export const LEAD_MODELS: { withBrief: LeadModel; withoutBrief: LeadModel } = {
  withBrief: {
    features: [
      "audience",
      "can_use",
      "founder_would_reply",
      "group_buyer",
      "group_non_buyer",
      "has_product_pain",
      "intent",
      "kind_neighbour_max",
      "kind_nothing",
      "kind_this",
      "lead_like",
      "names_current_tool",
      "offers_services",
      "promotes_own_thing",
      "req_met",
      "req_unmet",
      "same_kind",
      "solves_problem",
      "wants_offering",
    ],
    mean: [
      0.482497, 0.721333, 0.54412, 0.551809, 0.172027, 0.513197, 2.295563,
      0.112776, 0.542443, 0.207486, 0.496093, 0.26976, 0.057492, 0.051153,
      0.347645, 0.082962, 0.560519, 0.586191, 0.587951,
    ],
    scale: [
      0.24371, 0.175866, 0.20674, 0.372036, 0.289856, 0.271069, 0.485979,
      0.216362, 0.374051, 0.268424, 0.277056, 0.318868, 0.115925, 0.098889,
      0.268542, 0.144908, 0.268474, 0.24545, 0.225644,
    ],
    coef: [
      0.431765, 0.22344, 0.769264, 0.078581, 0.069813, -0.370658, 0.235341,
      0.097648, 0.349546, 0.257982, 0.360841, 0.152017, 0.182111, -0.131802,
      0.140734, 0.385901, 0.4138, 0.054731, -0.007839,
    ],
    intercept: -1.104691,
    threshold: 0.5014,
  },
  withoutBrief: {
    features: [
      "audience",
      "can_use",
      "founder_would_reply",
      "has_product_pain",
      "intent",
      "names_current_tool",
      "offers_services",
      "promotes_own_thing",
      "req_met",
      "req_unmet",
      "same_kind",
      "solves_problem",
      "wants_offering",
    ],
    mean: [
      0.482873, 0.725887, 0.553637, 0.507661, 2.296714, 0.276771, 0.057656,
      0.049937, 0.354788, 0.078786, 0.581083, 0.590351, 0.590811,
    ],
    scale: [
      0.242414, 0.16932, 0.204656, 0.271718, 0.484511, 0.323921, 0.118399,
      0.096102, 0.268468, 0.139138, 0.265176, 0.246313, 0.226747,
    ],
    coef: [
      0.580979, 0.158015, 0.865999, -0.373334, 0.170297, 0.127613, 0.14668,
      -0.079371, 0.124789, 0.231846, 0.554261, 0.142936, -0.038986,
    ],
    intercept: -1.14239,
    threshold: 0.4807,
  },
};
