import type { LeadModel } from "./leadModel";

/**
 * The fitted lead models. Fitted 2026-09-22 by .context/exp/fit.py on 2,362
 * posts labelled good, weak or bad against each of 172 products' own sites,
 * judged with exactly the request the scan sends (score.ts judgeRequest), one
 * post a request, with briefs Muse wrote through lib/brief.ts. Logistic
 * regression on standardised answers, trained on the posts the shared reading
 * lets through; the threshold keeps as many good leads as the gates it
 * replaced. Out of fold, by product:
 *
 *   with a brief      gates before: 606 shown, 62% good,  7% bad, 375 of 672 good kept
 *                     this model:   540 shown, 69% good,  5% bad, 375 of 672 good kept
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
      0.47233, 0.709537, 0.538443, 0.49485, 0.158943, 0.506228, 2.29849,
      0.115918, 0.535229, 0.204613, 0.424524, 0.273225, 0.058059, 0.050058,
      0.349342, 0.092646, 0.55172, 0.57475, 0.580642,
    ],
    scale: [
      0.246172, 0.183858, 0.213769, 0.36854, 0.276371, 0.271634, 0.483479,
      0.209818, 0.371134, 0.26408, 0.264321, 0.320816, 0.116351, 0.09693,
      0.269212, 0.157512, 0.27046, 0.252145, 0.231797,
    ],
    coef: [
      0.47857, 0.017385, 0.805309, 0.161214, -0.034739, -0.420866, 0.263893,
      0.072428, 0.351235, 0.123108, 0.45645, 0.149011, 0.171104, -0.138012,
      0.208203, 0.417117, 0.465383, 0.042301, -0.000129,
    ],
    intercept: -1.150196,
    threshold: 0.4995,
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
