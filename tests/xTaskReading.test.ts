import { describe, expect, it } from "vitest";
import type { ProductFacts } from "@/lib/product";
import { readXTask, xOpenTaskFactor, xOpenTaskQuestions, xTaskMass, xTaskQuestions, xTaskSource } from "@/lib/x/taskReading";

const product: ProductFacts = { name: "Example", url: null, pain: "", solution: "Record video", targetUsers: "Everyone",
  serviceGeography: "", budgetFit: "Free personal plan", capabilities: ["Record audio", ""], exclusions: ["Windows only"], notBuyers: [], competitors: [] };
const choice = (choice: string) => ({ type: "choice", choice });
const source = xTaskSource(product, "Need a recorder. It must run on Linux.");
const answers = (over: Record<string, unknown> = {}) => ({
  task_quote: choice("s0"), task_fact: choice("solution"), relation_quote: choice("s0"),
  task_relation: { ...choice("own_open"), probabilities: { own_open: 0.6, own_evaluating: 0.1, unknown: 0.3 } },
  constraint_quote: choice("s1"), hard_requirement: choice("unmet"), requirement_fact: choice("exclude0"), ...over,
});

describe("experimental product-linked task contract", () => {
  it("limits citations to own words and supplied capability/fact fields", () => {
    expect(source.sentences).toEqual({ s0: "Need a recorder.", s1: "It must run on Linux." });
    expect(source.facts.cap1).toBeUndefined();
    expect(source.facts).not.toHaveProperty("targetUsers");
    const questions = xTaskQuestions(source);
    expect(Object.keys(questions)).toHaveLength(7);
    const taskFact = questions.task_fact;
    expect(taskFact.type === "choice" && Object.keys(taskFact.criteria)).toEqual(["solution", "cap0", "none"]);
  });
  it("combines open/evaluating mass with unknown legacy fallback, retaining raw answers", () => {
    const raw = answers();
    const reading = readXTask(raw, source);
    expect(reading.requirement).toBe("unmet");
    expect(xTaskMass(reading, 0.2)).toBeCloseTo(0.76);
    expect(raw.hard_requirement).toEqual(choice("unmet"));
  });
  it("normalizes rounded distributions, rejecting invalid or missing ones without one-hot fabrication", () => {
    expect(xTaskMass(readXTask(answers({ task_relation: { ...choice("own_open"), probabilities: { own_open: 0.49, unknown: 0.5 } } }), source), 0.2)).toBeCloseTo(0.59 / 0.99);
    for (const probabilities of [undefined, {}, { own_open: 0.4 }, { own_open: 0.8, invented: 0.2 }, { own_open: NaN }, { own_open: 1.1 }, { own_open: -0.1, unknown: 1.1 }]) {
      const reading = readXTask(answers({ task_relation: { ...choice("own_open"), probabilities } }), source);
      expect(reading.probabilities).toBeNull();
      expect(xTaskMass(reading, 0.2)).toBe(0.2);
    }
  });
  it("cannot apply a positive adoption reading without an author quote and a supplied job fact", () => {
    for (const over of [{ task_quote: choice("parent0") }, { relation_quote: choice("none") }, { task_fact: choice("none") }, { task_fact: choice("exclude0") }]) {
      expect(xTaskMass(readXTask(answers(over), source), 0.2)).toBe(0.2);
    }
  });
  it("permits an evidenced promotion or completed task without pretending it is an adopter", () => {
    const promotion = readXTask(answers({ task_quote: choice("none"), task_fact: choice("none"),
      task_relation: { ...choice("promoting_or_publishing"), probabilities: { promoting_or_publishing: 0.9, unknown: 0.1 } } }), source);
    expect(xTaskMass(promotion, 0.8)).toBeCloseTo(0.08);
    const completed = readXTask(answers({ task_relation: { ...choice("own_completed"), probabilities: { own_completed: 1 } } }), source);
    expect(xTaskMass(completed, 0.8)).toBe(0);
  });
  it("grounds every consumed mass independent of which valid label was selected", () => {
    const probabilities = { promoting_or_publishing: 0.6, own_open: 0.2, own_completed: 0.1, unknown: 0.1 };
    for (const selected of ["unknown", "own_open", "own_completed", "promoting_or_publishing"]) {
      const raw = answers({ task_quote: choice("none"), task_fact: choice("none"), task_relation: { ...choice(selected), probabilities } });
      expect(xTaskMass(readXTask(raw, source), 0.8)).toBeCloseTo(0.32);
      expect(xTaskMass(readXTask({ ...raw, relation_quote: choice("none") }, source), 0.8)).toBe(0.8);
    }
  });
  it("downgrades unsupported requirement verdicts without claiming platform compatibility or mutating raw answers", () => {
    for (const over of [{ constraint_quote: choice("none") }, { requirement_fact: choice("none") }, { requirement_fact: choice("invented") }, { constraint_quote: choice("invented") }]) {
      const raw = answers(over);
      expect(readXTask(raw, source).requirement).toBe("unknown");
      expect(raw.hard_requirement.choice).toBe("unmet");
    }
    expect(readXTask(answers({ hard_requirement: choice("none_stated") }), source).requirement).toBe("unknown");
    expect(readXTask(answers({ hard_requirement: choice("none_stated"), constraint_quote: choice("invented") }), source).requirement).toBe("unknown");
    expect(readXTask(answers({ hard_requirement: choice("none_stated"), constraint_quote: choice("none"), requirement_fact: choice("none") }), source).requirement).toBe("none_stated");
  });
  it("never trusts prototype names as supplied citations or accepts invalid legacy factors", () => {
    expect(readXTask(answers({ task_fact: choice("toString") }), source).probabilities).toBeNull();
    for (const value of [NaN, -0.1, 1.1]) expect(() => xTaskMass(readXTask(answers(), source), value)).toThrow();
  });
  it("can use a grounded joint NOUL without optional choice probabilities, but never a chosen-label certainty", () => {
    const raw = answers({ task_relation: choice("own_open"), open_adoption_task: { type: "noul", noul: 0.73 } });
    expect(xOpenTaskFactor(raw, source, 0.2)).toMatchObject({ factor: 0.73, usedJoint: true });
    expect(Object.keys(xOpenTaskQuestions(source))).toHaveLength(8);
    expect(xOpenTaskFactor({ ...raw, open_adoption_task: undefined }, source, 0.2)).toMatchObject({ factor: 0.2, usedJoint: false });
    for (const over of [{ task_relation: choice("unknown") }, { task_quote: choice("none") }, { task_fact: choice("exclude0") }, { relation_quote: choice("parent0") }, { open_adoption_task: { type: "noul", noul: NaN } }]) {
      expect(xOpenTaskFactor({ ...raw, ...over }, source, 0.2)).toMatchObject({ factor: 0.2, usedJoint: false });
    }
  });
});
