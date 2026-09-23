import { describe, expect, it } from "vitest";
import { assessmentFrom, featuresFrom, fitFrom, readingFrom, triageFrom } from "@/lib/scan/derive";
import { judgeAnswers, triageAnswers } from "./jevAnswers";

/**
 * The verdict is assembled in code out of narrow answers, never asked as one
 * number. These are the two derivations that decide a lead: the 0-4 fit, and
 * what a title's triage does with it.
 */

describe("the fit a judgement is derived from", () => {
  const fit = (spec: Parameters<typeof judgeAnswers>[0][number]) =>
    fitFrom(judgeAnswers([spec]), "p0");

  it("counts a requirement the product cannot meet as the wrong job, whatever else is true", () => {
    expect(fit({ hardRequirement: "unmet", solvesProblem: 0.99, audience: 0.99 })).toBe(0);
  });

  it("counts a job the product does not do as audience overlap at best", () => {
    expect(fit({ solvesProblem: 0.1, audience: 0.9 })).toBe(1);
    expect(fit({ solvesProblem: 0.1, audience: 0.1 })).toBe(0);
  });

  it("counts a different kind of product as the wrong job, even for its audience", () => {
    expect(fit({ sameKind: 0.2, audience: 0.9 })).toBe(0);
  });

  it("counts someone the product does not serve, or who could not use it, as overlap", () => {
    expect(fit({ audience: 0.1, hardRequirement: "none_stated" })).toBe(1);
    expect(fit({ canUse: 0.3, hardRequirement: "met" })).toBe(1);
  });

  it("lets the requirement decide once the product does the job", () => {
    expect(fit({ hardRequirement: "unknown" })).toBe(2);
    expect(fit({ hardRequirement: "none_stated" })).toBe(3);
    expect(fit({ hardRequirement: "met" })).toBe(4);
  });
});

describe("the features the lead model reads", () => {
  it("reads one number per answer, and the brief's only when there is a brief", () => {
    const features = featuresFrom(judgeAnswers([{ founderWouldReply: 0.7 }]), "p0", false);
    expect(features.founder_would_reply).toBe(0.7);
    expect(features.req_met).toBe(1);
    expect(features).not.toHaveProperty("lead_like");
  });

  it("sums the chance of every buyer group and takes the likeliest neighbour", () => {
    const answers = judgeAnswers([{}]);
    answers.p0__wanted_kind = { type: "choice", choice: "n1", probabilities: { this_product: 0.3, n0: 0.1, n1: 0.5, nothing: 0.1 }, confidence: 0.5 };
    answers.p0__author_group = { type: "choice", choice: "b0", probabilities: { b0: 0.4, b1: 0.2, x0: 0.3, unclear: 0.1 }, confidence: 0.4 };
    answers.p0__is_lead_like = { type: "noul", noul: 0.6 };
    const features = featuresFrom(answers, "p0", true);
    expect(features.kind_this).toBe(0.3);
    expect(features.kind_neighbour_max).toBe(0.5);
    expect(features.group_buyer).toBeCloseTo(0.6);
    expect(features.group_non_buyer).toBeCloseTo(0.3);
    expect(features.lead_like).toBe(0.6);
  });
});

describe("the intent a judgement is derived from", () => {
  const reading = { relationship: "buyer", needState: "open", quote: null } as const;
  const intent = (spec: Parameters<typeof judgeAnswers>[0][number]) =>
    assessmentFrom("a", reading, judgeAnswers([spec]), "p0").intent;

  it("takes the model's level for someone a product could answer", () => {
    expect(intent({ intent: 3.2 })).toBe(3);
  });

  it("holds an explicit question no product could answer below the gate", () => {
    expect(intent({ intent: 3.2, wantsOffering: 0.1 })).toBe(1);
    expect(intent({ intent: 0, wantsOffering: 0.1 })).toBe(0);
  });
});

describe("the reading a judgement is derived from", () => {
  it("copies the sentence the model picked, and leaves none as no quote", () => {
    const sentences = { s0: "Anyone know a form tool?", s1: "It has to take payments." };
    expect(readingFrom(judgeAnswers([{ quote: "s1" }]), "p0", sentences)).toEqual({
      relationship: "buyer",
      needState: "open",
      quote: "It has to take payments.",
    });
    expect(readingFrom(judgeAnswers([{ quote: "none" }]), "p0", sentences).quote).toBeNull();
  });
});

describe("what a title's triage decides", () => {
  const triage = (spec: Parameters<typeof triageAnswers>[0][number]) =>
    triageFrom("t1", triageAnswers([spec]), "c0");

  it("reads a title whose author looks like they are asking", () => {
    expect(triage({ asking: 0.5 })).toEqual({ id: "t1", disposition: "read", asking: 0.5 });
    expect(triage({ asking: 0.9, notBuyer: "seller" }).disposition).toBe("read");
  });

  it("rejects only a title that is not asking and is settled as a seller or a helper", () => {
    expect(triage({ asking: 0.2, notBuyer: "seller" }).disposition).toBe("reject");
    expect(triage({ asking: 0.2, notBuyer: "helper" }).disposition).toBe("reject");
  });

  it("keeps everything else in the queue rather than throwing it away", () => {
    expect(triage({ asking: 0.2, notBuyer: "discussion" }).disposition).toBe("uncertain");
    expect(triage({ asking: 0.49, notBuyer: "none" }).disposition).toBe("uncertain");
  });
});
