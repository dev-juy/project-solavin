import { describe, it, expect } from "vitest";
import {
  calcMetrics,
  computeEfficiency,
  extractIV,
  buildSampleDataset,
  metricsToRows,
  rowsToCsv,
  siPrefix,
  fmtSI,
} from "./ivAnalysis.js";

describe("calcMetrics — physical invariants", () => {
  const ds = buildSampleDataset();

  it("returns null for too few points", () => {
    expect(calcMetrics([{ voltage: 0, rawCurrent: 1 }])).toBeNull();
    expect(calcMetrics(null)).toBeNull();
  });

  it("produces a fill factor strictly below 100% for every channel", () => {
    // This is the regression guard for the absolute-value bug, which used to
    // yield fill factors of 185–252%.
    ds.conditions.forEach((c) => {
      const m = calcMetrics(ds.ivData[c]);
      expect(m).not.toBeNull();
      expect(m.ff).toBeGreaterThan(0);
      expect(m.ff).toBeLessThan(1); // FF < 100% always
    });
  });

  it("places the maximum-power point inside the power quadrant (V>=0, I>=0)", () => {
    ds.conditions.forEach((c) => {
      const m = calcMetrics(ds.ivData[c]);
      expect(m.vmp).toBeGreaterThanOrEqual(0);
      expect(m.imp).toBeGreaterThanOrEqual(0);
      expect(m.vmp).toBeLessThanOrEqual(m.voc);
      // Pmax must equal Vmp*Imp and be positive.
      expect(m.pmax).toBeCloseTo(m.vmp * m.imp, 12);
      expect(m.pmax).toBeGreaterThan(0);
    });
  });

  it("finds Voc at the true zero-crossing, not the last sweep voltage", () => {
    const m = calcMetrics(ds.ivData["Focused Laser"]);
    // True crossing is between 2.05 V (+78 nA) and 2.1 V (−108 nA).
    expect(m.voc).toBeGreaterThan(2.05);
    expect(m.voc).toBeLessThan(2.1);
    expect(m.notes.vocBeyondRange).toBe(false);
  });

  it("matches independently computed reference values for the sample (Focused Laser)", () => {
    const m = calcMetrics(ds.ivData["Focused Laser"]);
    expect(m.isc * 1e6).toBeCloseTo(1.539, 3); // µA
    expect(m.voc).toBeCloseTo(2.071, 2); // V
    expect(m.pmax * 1e9).toBeCloseTo(1587.0, 0); // nW (Vmp=1.5, Imp=1.058µA)
    expect(m.vmp).toBeCloseTo(1.5, 6);
    expect(m.ff * 100).toBeCloseTo(49.8, 0); // %
  });

  it("is invariant to input row ordering", () => {
    const ordered = ds.ivData["+6mm Focus"];
    const shuffled = [...ordered].reverse();
    const a = calcMetrics(ordered);
    const b = calcMetrics(shuffled);
    expect(b.voc).toBeCloseTo(a.voc, 9);
    expect(b.pmax).toBeCloseTo(a.pmax, 15);
    expect(b.isc).toBeCloseTo(a.isc, 15);
  });

  it("interpolates Isc at V=0 when no exact sample exists", () => {
    // Linear ramp I = 2 − V  →  Isc should interpolate to 2 at V=0.
    const pts = [
      { voltage: 0.1, rawCurrent: 1.9 },
      { voltage: 0.5, rawCurrent: 1.5 },
      { voltage: 1.0, rawCurrent: 1.0 },
      { voltage: 2.0, rawCurrent: 0.0 },
    ];
    const m = calcMetrics(pts);
    expect(m.isc).toBeCloseTo(2.0, 6);
    expect(m.notes.iscExtrapolated).toBe(true);
    expect(m.voc).toBeCloseTo(2.0, 6);
  });

  it("flags Voc beyond range when current never reaches zero", () => {
    const pts = [
      { voltage: 0, rawCurrent: 1.0 },
      { voltage: 0.5, rawCurrent: 0.9 },
      { voltage: 1.0, rawCurrent: 0.8 },
    ];
    const m = calcMetrics(pts);
    expect(m.notes.vocBeyondRange).toBe(true);
    expect(m.voc).toBe(1.0);
  });

  it("derives FF analytically for an ideal square-ish curve", () => {
    // Curve sitting at I=1 until V=1, then dropping to 0 at V≈1 → FF≈ high.
    const pts = [
      { voltage: 0, rawCurrent: 1.0 },
      { voltage: 0.5, rawCurrent: 1.0 },
      { voltage: 0.9, rawCurrent: 1.0 },
      { voltage: 1.0, rawCurrent: 0.5 },
      { voltage: 1.1, rawCurrent: -0.5 },
    ];
    const m = calcMetrics(pts);
    expect(m.isc).toBeCloseTo(1.0, 6);
    expect(m.voc).toBeCloseTo(1.05, 6); // crossing between 1.0 and 1.1
    expect(m.pmax).toBeCloseTo(0.9, 6); // best quadrant point: V=0.9,I=1.0
    expect(m.ff).toBeGreaterThan(0.8);
    expect(m.ff).toBeLessThan(1);
  });
});

describe("calcMetrics — MPP interpolation between grid points", () => {
  it("locates the exact MPP of the piecewise-linear curve, not just the nearest sample", () => {
    // I = 1 − V sampled coarsely: the true MPP of the interpolated curve is at
    // V = 0.5 (P = 0.25) even though no sample sits there. A nearest-sample
    // scan would report P = 0.24 at V = 0.4.
    const pts = [
      { voltage: 0, rawCurrent: 1.0 },
      { voltage: 0.4, rawCurrent: 0.6 },
      { voltage: 0.8, rawCurrent: 0.2 },
      { voltage: 1.2, rawCurrent: -0.2 },
    ];
    const m = calcMetrics(pts);
    expect(m.vmp).toBeCloseTo(0.5, 9);
    expect(m.imp).toBeCloseTo(0.5, 9);
    expect(m.pmax).toBeCloseTo(0.25, 9);
    expect(m.voc).toBeCloseTo(1.0, 9);
    expect(m.pmax).toBeCloseTo(m.vmp * m.imp, 12); // invariant preserved
  });
});

describe("calcMetrics — reference silicon cells (single-diode model)", () => {
  const VT = 0.025852; // thermal voltage kT/q at 300 K, volts

  /**
   * Ideal single-diode light I-V sweep (Rs = 0, Rsh = ∞):
   * I(V) = Isc − I0·(e^{V/(n·VT)} − 1), with I0 fixed so that I(Voc) = 0.
   */
  function diodeSweep(isc, voc, nIdeality, step = 0.005) {
    const i0 = isc / Math.expm1(voc / (nIdeality * VT));
    const pts = [];
    for (let v = 0; v <= voc * 1.08 + 1e-12; v += step) {
      pts.push({ voltage: +v.toFixed(6), rawCurrent: isc - i0 * Math.expm1(v / (nIdeality * VT)) });
    }
    return pts;
  }

  it("recovers STC-like c-Si parameters (n = 1): FF ≈ 0.83, η ≈ 17 %", () => {
    // 4 cm² cell at ~35 mA/cm²: Isc = 140 mA, Voc = 0.60 V. The analytic
    // fill-factor estimate FF₀ = (v − ln(v+0.72))/(v+1) with v = Voc/VT
    // gives 0.828 for this cell.
    const m = calcMetrics(diodeSweep(0.14, 0.6, 1));
    expect(m.isc).toBeCloseTo(0.14, 4);
    expect(m.voc).toBeCloseTo(0.6, 3);
    expect(m.ff).toBeGreaterThan(0.8); // good silicon: FF in 0.7–0.85
    expect(m.ff).toBeLessThan(0.86);
    const eta = computeEfficiency(m.pmax, 4, 1000); // 4 cm², AM1.5G
    expect(eta).toBeGreaterThan(15);
    expect(eta).toBeLessThan(20);
    expect(m.warnings).toEqual([]); // clean reference data → no quality flags
  });

  it("recovers a recombination-limited cell (n = 2) with the expected lower FF", () => {
    const m = calcMetrics(diodeSweep(0.035, 0.58, 2));
    expect(m.voc).toBeCloseTo(0.58, 3);
    expect(m.ff).toBeGreaterThan(0.65);
    expect(m.ff).toBeLessThan(0.78);
    expect(m.warnings).toEqual([]);
  });

  it("works identically for mA-scale and µA-scale currents (unit neutrality)", () => {
    const big = calcMetrics(diodeSweep(0.14, 0.6, 1));
    const small = calcMetrics(diodeSweep(0.14e-6, 0.6, 1));
    expect(small.ff).toBeCloseTo(big.ff, 6);
    expect(small.vmp).toBeCloseTo(big.vmp, 6);
    expect(small.pmax * 1e6).toBeCloseTo(big.pmax, 9);
  });
});

describe("calcMetrics — data-quality warnings", () => {
  it("returns no warnings for the clean bundled sample channels", () => {
    const ds = buildSampleDataset();
    ds.conditions.forEach((c) => {
      expect(calcMetrics(ds.ivData[c]).warnings).toEqual([]);
    });
  });

  it("flags a non-positive Isc", () => {
    const m = calcMetrics([
      { voltage: 0, rawCurrent: -1.0 },
      { voltage: 0.5, rawCurrent: -1.2 },
      { voltage: 1.0, rawCurrent: -1.4 },
    ]);
    expect(m.errors.some((w) => /Isc ≤ 0/.test(w))).toBe(true);
    expect(m.quality).toBe("invalid");
  });

  it("flags non-monotonic current between 0 V and Voc", () => {
    const m = calcMetrics([
      { voltage: 0, rawCurrent: 1.0 },
      { voltage: 0.2, rawCurrent: 0.8 },
      { voltage: 0.4, rawCurrent: 1.05 }, // 25 % rise — far above noise tolerance
      { voltage: 0.6, rawCurrent: 0.5 },
      { voltage: 0.8, rawCurrent: -0.1 },
    ]);
    expect(m.warnings.some((w) => /increases with voltage/.test(w))).toBe(true);
  });

  it("flags a sparse power quadrant", () => {
    const m = calcMetrics([
      { voltage: 0, rawCurrent: 1.0 },
      { voltage: 0.6, rawCurrent: 0.5 },
      { voltage: 1.2, rawCurrent: -0.2 },
    ]);
    expect(m.warnings.some((w) => /power quadrant/.test(w))).toBe(true);
  });
});

describe("SI unit auto-scaling", () => {
  it("picks the right prefix for lab-scale magnitudes", () => {
    expect(siPrefix(1.5e-6)).toEqual({ div: 1e-6, prefix: "µ" });
    expect(siPrefix(0.14)).toEqual({ div: 1e-3, prefix: "m" });
    expect(siPrefix(3.2)).toEqual({ div: 1, prefix: "" });
    expect(siPrefix(2.1e6)).toEqual({ div: 1e6, prefix: "M" });
    expect(siPrefix(0)).toEqual({ div: 1, prefix: "" });
  });

  it("formats values with unit and prefix", () => {
    expect(fmtSI(1.539e-6, "A")).toBe("1.539 µA");
    expect(fmtSI(0.0696, "W", 1)).toBe("69.6 mW");
    expect(fmtSI(46300, "Ω", 1)).toBe("46.3 kΩ");
    expect(fmtSI(Infinity, "Ω")).toBe("—");
  });
});

describe("computeEfficiency", () => {
  it("computes η = Pmax/(G·A) in percent with cm²→m² conversion", () => {
    // Pmax = 1.587e-6 W, A = 0.01 cm² = 1e-6 m², G = 1000 W/m².
    const eta = computeEfficiency(1.587e-6, 0.01, 1000);
    expect(eta).toBeCloseTo((1.587e-6 / (1000 * 1e-6)) * 100, 9);
    expect(eta).toBeCloseTo(0.1587, 6);
  });

  it("rejects non-positive or non-finite inputs", () => {
    expect(computeEfficiency(1e-6, 0, 1000)).toBeNull();
    expect(computeEfficiency(1e-6, 0.01, 0)).toBeNull();
    expect(computeEfficiency(1e-6, NaN, 1000)).toBeNull();
  });
});

describe("extractIV — workbook parsing", () => {
  it("parses voltage column + current columns with header labels", () => {
    const rows = [
      ["Voltage", "Cell A", "Cell B"],
      [0, 1.5e-6, 1.2e-6],
      [0.5, 1.0e-6, 0.8e-6],
      [1.0, -0.2e-6, -0.1e-6],
    ];
    const out = extractIV(rows);
    expect(out.conditions).toEqual(["Cell A", "Cell B"]);
    expect(out.ivData["Cell A"]).toHaveLength(3);
    expect(out.ivData["Cell A"][0].rawCurrent).toBe(1.5e-6);
    expect(out.ivData["Cell A"][2].current).toBe(0.2e-6); // abs kept for display
  });

  it("returns null for empty or malformed input", () => {
    expect(extractIV([])).toBeNull();
    expect(extractIV([["V"], ["x"]])).toBeNull();
  });

  it("round-trips through calcMetrics", () => {
    const rows = [
      ["V", "C1"],
      [0, 1e-6],
      [1, 0.5e-6],
      [2, 0e-6],
      [2.1, -0.3e-6],
    ];
    const { conditions, ivData } = extractIV(rows);
    const m = calcMetrics(ivData[conditions[0]]);
    expect(m.voc).toBeCloseTo(2.0, 6);
    expect(m.ff).toBeLessThan(1);
  });
});

describe("export helpers", () => {
  const ds = buildSampleDataset();
  const allM = {};
  ds.conditions.forEach((c) => (allM[c] = calcMetrics(ds.ivData[c])));

  it("builds a header + one row per condition", () => {
    const rows = metricsToRows(ds, allM);
    expect(rows[0][0]).toBe("Condition");
    expect(rows).toHaveLength(ds.conditions.length + 1);
  });

  it("auto-ranges export units to the dataset magnitude (ASCII-safe)", () => {
    const rows = metricsToRows(ds, allM);
    expect(rows[0][1]).toBe("Isc (uA)"); // µA-scale sample data
    expect(rows[0][3]).toBe("Pmax (uW)");
    // Values are expressed in those units: Focused Laser Isc = 1.539 µA.
    const fl = rows.find((r) => r[0] === "Focused Laser");
    expect(fl[1]).toBeCloseTo(1.539, 3);
  });

  it("adds an efficiency column when efficiency is supplied", () => {
    const eff = {};
    ds.conditions.forEach((c) => (eff[c] = computeEfficiency(allM[c].pmax, 0.01, 1000)));
    const rows = metricsToRows(ds, allM, eff);
    expect(rows[0]).toContain("Efficiency (%)");
    expect(rows[1]).toHaveLength(rows[0].length);
  });

  it("serialises to CSV with quoting", () => {
    const csv = rowsToCsv([["a", "b,c"], [1, 2]]);
    expect(csv).toBe('a,"b,c"\n1,2');
  });
});
