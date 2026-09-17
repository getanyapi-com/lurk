import { describe, expect, it } from "vitest";
import { fitFrom, readingFrom, triageFrom } from "@/lib/scan/derive";
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

  it("lets the requirement decide once the product does the job", () => {
    expect(fit({ hardRequirement: "unknown" })).toBe(2);
    expect(fit({ hardRequirement: "none_stated" })).toBe(3);
    expect(fit({ hardRequirement: "met" })).toBe(4);
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
