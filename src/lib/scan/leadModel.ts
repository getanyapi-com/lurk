import { LEAD_MODELS } from "./leadModelWeights";

/**
 * How likely a judged person is a lead the founder wants, from the judge's
 * answers. The answers are the features and a logistic model fitted on
 * labelled posts is the weighing, which is what TypeSafe advises for turning
 * several answers into one decision (https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md):
 * no hand-set cutoff at 0.5 and no guessed weights. On 2,362 posts labelled
 * against each product's site, fitted by product-grouped cross-validation,
 * it told good leads from the rest better than the fit-and-intent gates it
 * replaces (.context/exp, 2026-09-22; figures in leadModelWeights.ts).
 */
export type LeadModel = {
  features: string[];
  mean: number[];
  scale: number[];
  coef: number[];
  intercept: number;
  /** The probability at which a person becomes a lead. */
  threshold: number;
};

function probability(model: LeadModel, features: Record<string, number>): number {
  let z = model.intercept;
  model.features.forEach((name, index) => {
    z += (model.coef[index] * ((features[name] ?? 0) - model.mean[index])) / model.scale[index];
  });
  return 1 / (1 + Math.exp(-z));
}

/**
 * The model's verdict as one 0-1 number with the threshold at 0.5, so the
 * gates and the feed score read one scale whichever model judged: under it,
 * the probability as a share of the threshold; over it, how far towards
 * certainty it went.
 */
export function leadQuality(features: Record<string, number>, withBrief: boolean): number {
  const model = withBrief ? LEAD_MODELS.withBrief : LEAD_MODELS.withoutBrief;
  const p = probability(model, features);
  const t = model.threshold;
  return p < t ? (0.5 * p) / t : 0.5 + (0.5 * (p - t)) / (1 - t);
}
