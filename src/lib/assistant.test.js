import { describe, expect, it } from "vitest";
import { analyze } from "./assistant.js";
import { calcMetrics } from "./ivAnalysis.js";

const dataset = {
  name: "Assistant fixture",
  conditions: ["Validated", "Censored", "Invalid"],
  ivData: {
    Validated: [
      { voltage: 0, rawCurrent: 1 },
      { voltage: 0.5, rawCurrent: 0.5 },
      { voltage: 1, rawCurrent: 0 },
      { voltage: 1.1, rawCurrent: -0.1 },
    ],
    Censored: [
      { voltage: 0, rawCurrent: 1 },
      { voltage: 0.5, rawCurrent: 0.8 },
      { voltage: 1, rawCurrent: 0.6 },
    ],
    Invalid: [
      { voltage: 0, rawCurrent: -1 },
      { voltage: 0.5, rawCurrent: -0.5 },
      { voltage: 1, rawCurrent: 0 },
    ],
  },
};

const allMetrics = Object.fromEntries(
  dataset.conditions.map((condition) => [condition, calcMetrics(dataset.ivData[condition])])
);

describe("deterministic assistant validity handling", () => {
  it("summarizes bounds and withheld values without presenting them as exact", () => {
    const answer = analyze("summarize", { dataset, allMetrics, efficiency: null });
    expect(answer).toMatch(/Censored \[REVIEW\].*Voc ≥ 1\.000 V, FF withheld/s);
    expect(answer).toMatch(/Invalid \[INVALID\]: metrics are not reportable/);
    expect(answer).toMatch(/Highest reportable Pmax: Validated/);
    expect(answer).not.toMatch(/Highest reportable Pmax: Censored/);
  });

  it("ranks only reportable Pmax values", () => {
    const answer = analyze("compare", { dataset, allMetrics, efficiency: null });
    expect(answer).toContain("Validated");
    expect(answer).not.toContain("Censored");
    expect(answer).not.toContain("Invalid");
  });

  it("withholds invalid or censored fill factor values", () => {
    const answer = analyze("fill factor", { dataset, allMetrics, efficiency: null });
    expect(answer).toContain("Best: Validated");
    expect(answer).toContain("one light sweep cannot identify the cause");
  });

  it("does not report an unbracketed Voc as the highest reportable value", () => {
    const answer = analyze("Voc", { dataset, allMetrics, efficiency: null });
    expect(answer).toContain("Highest here: Validated");
    expect(answer).not.toContain("Censored");
  });
});
