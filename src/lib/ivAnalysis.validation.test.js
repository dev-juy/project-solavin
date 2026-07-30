import { describe, expect, it } from "vitest";
import readExcelFile from "read-excel-file/node";
import writeExcelFile from "write-excel-file/node";
import {
  buildAlignedRows,
  calcMetrics,
  computeEfficiency,
  extractIV,
  metadataToRows,
  metricsToRows,
  parseCsv,
  rawDataToRows,
  rowsToCsv,
} from "./ivAnalysis.js";

function mulberry32(seed) {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function maximize(functionToEvaluate, lower, upper) {
  const ratio = (Math.sqrt(5) - 1) / 2;
  let left = lower;
  let right = upper;
  let x1 = right - ratio * (right - left);
  let x2 = left + ratio * (right - left);
  let y1 = functionToEvaluate(x1);
  let y2 = functionToEvaluate(x2);
  for (let iteration = 0; iteration < 120; iteration++) {
    if (y1 > y2) {
      right = x2;
      x2 = x1;
      y2 = y1;
      x1 = right - ratio * (right - left);
      y1 = functionToEvaluate(x1);
    } else {
      left = x1;
      x1 = x2;
      y1 = y2;
      x2 = left + ratio * (right - left);
      y2 = functionToEvaluate(x2);
    }
  }
  const x = (left + right) / 2;
  return { x, y: functionToEvaluate(x) };
}

describe("accuracy validation — independent analytic oracles", () => {
  it("recovers 300 deterministic random linear I-V curves to floating-point precision", () => {
    const random = mulberry32(0x50a71);
    for (let trial = 0; trial < 300; trial++) {
      const isc = 10 ** (-8 + 8 * random());
      const voc = 0.15 + 4.85 * random();
      const voltages = [0];
      for (let index = 0; index < 6 + Math.floor(random() * 20); index++) {
        voltages.push(voc * 1.15 * random());
      }
      voltages.push(voc * 1.05);
      const points = voltages.map((voltage) => ({
        voltage,
        rawCurrent: isc * (1 - voltage / voc),
      }));
      const metrics = calcMetrics(shuffle(points, random));
      const expectedPower = isc * voc / 4;

      expect(metrics.isc).toBeCloseTo(isc, 12);
      expect(metrics.voc).toBeCloseTo(voc, 12);
      expect(metrics.vmp).toBeCloseTo(voc / 2, 12);
      expect(metrics.imp).toBeCloseTo(isc / 2, 12);
      expect(metrics.pmax).toBeCloseTo(expectedPower, 12);
      expect(metrics.ff).toBeCloseTo(0.25, 12);
      expect(metrics.errors).toEqual([]);
    }
  });

  it("matches a continuous single-diode oracle across scale, Voc, and ideality", () => {
    const thermalVoltage = 0.025852;
    const cases = [
      { isc: 140e-3, voc: 0.60, n: 1.0 },
      { isc: 35e-3, voc: 0.58, n: 2.0 },
      { isc: 1.5e-6, voc: 2.08, n: 1.4 },
      { isc: 4.2, voc: 0.72, n: 1.15 },
      { isc: 8e-9, voc: 0.42, n: 1.8 },
      { isc: 0.8, voc: 1.25, n: 1.3 },
    ];

    for (const testCase of cases) {
      const saturationCurrent = testCase.isc / Math.expm1(testCase.voc / (testCase.n * thermalVoltage));
      const currentAt = (voltage) =>
        testCase.isc - saturationCurrent * Math.expm1(voltage / (testCase.n * thermalVoltage));
      const oracle = maximize((voltage) => voltage * currentAt(voltage), 0, testCase.voc);
      const step = testCase.voc / 500;
      const points = [];
      for (let voltage = 0; voltage <= testCase.voc * 1.04; voltage += step) {
        points.push({ voltage, rawCurrent: currentAt(voltage) });
      }
      const metrics = calcMetrics(points);
      const oracleFillFactor = oracle.y / (testCase.isc * testCase.voc);

      expect(Math.abs(metrics.isc / testCase.isc - 1)).toBeLessThan(1e-10);
      expect(Math.abs(metrics.voc / testCase.voc - 1)).toBeLessThan(2e-5);
      expect(Math.abs(metrics.vmp - oracle.x)).toBeLessThan(2 * step);
      expect(Math.abs(metrics.pmax / oracle.y - 1)).toBeLessThan(2e-4);
      expect(Math.abs(metrics.ff / oracleFillFactor - 1)).toBeLessThan(2e-4);
      expect(metrics.quality).toBe("pass");
    }
  });

  it("preserves dimensionless metrics under current scaling", () => {
    const base = [
      { voltage: 0, rawCurrent: 2 },
      { voltage: 0.2, rawCurrent: 1.6 },
      { voltage: 0.5, rawCurrent: 1 },
      { voltage: 0.8, rawCurrent: 0.4 },
      { voltage: 1, rawCurrent: 0 },
      { voltage: 1.1, rawCurrent: -0.2 },
    ];
    const scaled = base.map((point) => ({ ...point, rawCurrent: point.rawCurrent * 1e-6 }));
    const originalMetrics = calcMetrics(base);
    const scaledMetrics = calcMetrics(scaled);

    expect(scaledMetrics.voc).toBeCloseTo(originalMetrics.voc, 12);
    expect(scaledMetrics.vmp).toBeCloseTo(originalMetrics.vmp, 12);
    expect(scaledMetrics.ff).toBeCloseTo(originalMetrics.ff, 12);
    expect(scaledMetrics.isc / originalMetrics.isc).toBeCloseTo(1e-6, 12);
    expect(scaledMetrics.pmax / originalMetrics.pmax).toBeCloseTo(1e-6, 12);
    expect(scaledMetrics.rs / originalMetrics.rs).toBeCloseTo(1e6, 8);
    expect(scaledMetrics.rsh / originalMetrics.rsh).toBeCloseTo(1e6, 8);
  });
});

describe("accuracy validation — censoring and adversarial sweeps", () => {
  it("withholds derived metrics when Voc is outside the measured range", () => {
    const metrics = calcMetrics([
      { voltage: 0, rawCurrent: 1 },
      { voltage: 0.3, rawCurrent: 0.95 },
      { voltage: 0.6, rawCurrent: 0.8 },
      { voltage: 0.9, rawCurrent: 0.5 },
    ]);
    expect(metrics.voc).toBe(0.9);
    expect(metrics.status.voc).toBe("lower-bound");
    expect(metrics.status.pmax).toBe("provisional");
    expect(metrics.ff).toBeNull();
    expect(metrics.rs).toBeNull();
    expect(metrics.warnings.some((warning) => /lower bound/.test(warning))).toBe(true);
  });

  it("detects rather than clamps an unphysical fill factor", () => {
    const metrics = calcMetrics([
      { voltage: 0, rawCurrent: 1 },
      { voltage: 0.25, rawCurrent: 8 },
      { voltage: 0.5, rawCurrent: 10 },
      { voltage: 1, rawCurrent: 0 },
      { voltage: 1.1, rawCurrent: -1 },
    ]);
    expect(metrics.ff).toBeGreaterThan(1);
    expect(metrics.status.ff).toBe("unphysical");
    expect(metrics.quality).toBe("invalid");
    expect(metrics.errors.some((error) => /physical 0–100/.test(error))).toBe(true);
  });

  it("withholds Voc-dependent metrics when multiple zero crossings are ambiguous", () => {
    const metrics = calcMetrics([
      { voltage: 0, rawCurrent: 1 },
      { voltage: 0.4, rawCurrent: 0.5 },
      { voltage: 0.6, rawCurrent: -0.1 },
      { voltage: 0.8, rawCurrent: 0.2 },
      { voltage: 1, rawCurrent: -0.2 },
    ]);
    expect(metrics.voc).toBeNull();
    expect(metrics.status.voc).toBe("ambiguous");
    expect(metrics.ff).toBeNull();
    expect(metrics.rs).toBeNull();
    expect(metrics.quality).toBe("invalid");
    expect(metrics.errors.some((error) => /crosses.*2 times.*ambiguous/.test(error))).toBe(true);
  });

  it("fails closed when extreme finite inputs overflow derived power", () => {
    const metrics = calcMetrics([
      { voltage: 0, rawCurrent: 1e308 },
      { voltage: 2, rawCurrent: 1e308 },
      { voltage: 4, rawCurrent: -1e308 },
    ]);
    expect(metrics.quality).toBe("invalid");
    expect(metrics.status.pmax).toBe("overflow");
    expect(metrics.errors.some((error) => /V·I product overflowed/.test(error))).toBe(true);
    const rows = metricsToRows(
      { conditions: ["Extreme"], ivData: { Extreme: [] } },
      { Extreme: metrics }
    );
    expect(rows[1][rows[0].indexOf("Pmax (W)")]).toBe("");
    expect(computeEfficiency(1e308, 1e-308, 1e-308)).toBeNull();
  });

  it("averages duplicate voltage samples explicitly and reports the operation", () => {
    const metrics = calcMetrics([
      { voltage: 0, rawCurrent: 1 },
      { voltage: 0.5, rawCurrent: 0.4 },
      { voltage: 0.5, rawCurrent: 0.6 },
      { voltage: 1, rawCurrent: 0 },
      { voltage: 1.1, rawCurrent: -0.1 },
    ]);
    expect(metrics.sampleCount).toBe(5);
    expect(metrics.uniqueVoltageCount).toBe(4);
    expect(metrics.notes.duplicateVoltages).toBe(1);
    expect(metrics.pmax).toBeCloseTo(0.25, 12);
    expect(metrics.warnings.some((warning) => /repeated voltage/.test(warning))).toBe(true);
  });

  it("uses the samples nearest zero when extrapolating Isc from negative voltage", () => {
    const metrics = calcMetrics([
      { voltage: -3, rawCurrent: 10 },
      { voltage: -2, rawCurrent: 8 },
      { voltage: -1, rawCurrent: 3 },
    ]);
    expect(metrics.isc).toBeCloseTo(-2, 12);
    expect(metrics.status.isc).toBe("extrapolated");
    expect(metrics.quality).toBe("invalid");
  });
});

describe("workbook and chart integrity", () => {
  it("preserves physical column positions, uniquifies headers, and never inserts zeros", () => {
    const parsed = extractIV([
      ["V", "Cell", "", "Reference", "Cell"],
      [0, 1, "", 3, 4],
      [0.5, "", 0.4, 2, 3],
      [1, -0.1, 0.1, 0.5, 2],
      [1.5, -0.2, -0.1, -1, -1],
    ]);

    expect(parsed.conditions).toEqual(["Cell", "Channel 2", "Reference", "Cell (2)"]);
    expect(parsed.ivData.Cell.map((point) => point.rawCurrent)).toEqual([1, -0.1, -0.2]);
    expect(parsed.ivData["Channel 2"].map((point) => point.rawCurrent)).toEqual([0.4, 0.1, -0.1]);
    expect(parsed.ivData.Reference[0].rawCurrent).toBe(3);
    expect(parsed.ivData["Cell (2)"][0].rawCurrent).toBe(4);
    expect(parsed.diagnostics.warnings.some((warning) => /no zero values were inserted/.test(warning))).toBe(true);
    expect(parsed.diagnostics.warnings.some((warning) => /renamed "Cell \(2\)"/.test(warning))).toBe(true);
  });

  it("rejects channels without three unique voltage setpoints", () => {
    const parsed = extractIV([
      ["V", "Repeated", "Valid"],
      [0, 1, 1],
      [0, 2, 2],
      [0, 3, 3],
      [0.5, "", 2],
      [1, "", 0],
    ]);
    expect(parsed.conditions).toEqual(["Valid"]);
    expect(parsed.diagnostics.warnings).toContain(
      "Column 2 (Repeated) was ignored because it contains 3 valid pair(s) across 1 unique voltage(s); at least 3 unique voltages are required."
    );
  });

  it("enforces worksheet row and column safety limits", () => {
    const tooManyRows = Array.from({ length: 250002 }, (_, index) =>
      index === 0 ? ["V", "I"] : [index, 1]
    );
    expect(() => extractIV(tooManyRows)).toThrow(/250,000-data-row safety limit/);
    const tooWide = [["V"], [0]];
    tooWide[0].length = 2049;
    tooWide[1].length = 2049;
    expect(() => extractIV(tooWide)).toThrow(/2,048-column safety limit/);
  });

  it("aligns sparse channels by voltage instead of row index", () => {
    const dataset = {
      conditions: ["A", "B"],
      ivData: {
        A: [
          { voltage: 0, rawCurrent: 1 },
          { voltage: 1, rawCurrent: 0.5 },
          { voltage: 2, rawCurrent: -0.1 },
        ],
        B: [
          { voltage: 0, rawCurrent: 2 },
          { voltage: 0.5, rawCurrent: 1.5 },
          { voltage: 0.5, rawCurrent: 1.7 },
          { voltage: 2, rawCurrent: -0.2 },
        ],
      },
    };
    const rows = buildAlignedRows(dataset);
    expect(rows.map((row) => row.voltage)).toEqual([0, 0.5, 1, 2]);
    expect(rows[1].A).toBeUndefined();
    expect(rows[1].B).toBeCloseTo(1.6, 12);
    expect(rows[2].A).toBe(0.5);
    expect(rows[2].B).toBeUndefined();
  });

  it("parses BOM, quoted commas, escaped quotes, and embedded newlines", () => {
    const rows = parseCsv("\ufeffV,\"Cell, A\",\"Note\"\r\n0,1,\"line 1\nline 2\"\r\n1,-0.1,\"a \"\"quote\"\"\"");
    expect(rows).toEqual([
      ["V", "Cell, A", "Note"],
      ["0", "1", "line 1\nline 2"],
      ["1", "-0.1", 'a "quote"'],
    ]);
  });

  it("rejects malformed or excessive CSV input", () => {
    expect(() => parseCsv('V,"open\n1,2')).toThrow(/unterminated/);
    expect(() => parseCsv("a,b,c", { maxColumns: 2 })).toThrow(/column safety limit/);
    expect(() => parseCsv("a\nb", { maxRows: 1 })).toThrow(/row safety limit/);
  });
});

describe("export integrity", () => {
  it("exports status, quality, sample counts, and flags with every metric row", () => {
    const dataset = {
      conditions: ["Censored"],
      ivData: {
        Censored: [
          { voltage: 0, rawCurrent: 1 },
          { voltage: 0.5, rawCurrent: 0.9 },
          { voltage: 1, rawCurrent: 0.8 },
        ],
      },
    };
    const metrics = { Censored: calcMetrics(dataset.ivData.Censored) };
    const rows = metricsToRows(dataset, metrics);
    const header = rows[0];
    const data = rows[1];
    expect(data[header.indexOf("FF (%)")]).toBe("");
    expect(data[header.indexOf("Voc status")]).toBe("lower-bound");
    expect(data[header.indexOf("Pmax status")]).toBe("provisional");
    expect(data[header.indexOf("Quality")]).toBe("review");
    expect(data[header.indexOf("Valid samples")]).toBe(3);
    expect(data[header.indexOf("Metric flags")]).toMatch(/FF and Rs are withheld/);
    expect(data[header.indexOf("Analysis version")]).toBe("4.0.0");
    expect(data[header.indexOf("Analysis method")]).toBe("piecewise-linear-v4");
  });

  it("exports signed raw measurements, gaps, and provenance without shifting rows", () => {
    const dataset = {
      name: "Sparse measurement",
      source: { file: "run-17.csv", sheet: "CSV" },
      diagnostics: { warnings: ["B: skipped one blank cell."] },
      conditions: ["A", "B"],
      ivData: {
        A: [
          { voltage: 0, rawCurrent: 1 },
          { voltage: 1, rawCurrent: -0.1 },
        ],
        B: [
          { voltage: 0.5, rawCurrent: 2 },
          { voltage: 1, rawCurrent: -0.2 },
        ],
      },
    };
    const raw = rawDataToRows(dataset);
    expect(raw).toEqual([
      ["Voltage (V)", "A (A)", "B (A)"],
      [0, 1, ""],
      [0.5, "", 2],
      [1, -0.1, -0.2],
    ]);
    const metadata = Object.fromEntries(metadataToRows(dataset).slice(1));
    expect(metadata["Source file"]).toBe("run-17.csv");
    expect(metadata["Source sheet"]).toBe("CSV");
    expect(metadata["Import flags"]).toMatch(/blank cell/);
  });

  it("round-trips the three-sheet research workbook through the production libraries", async () => {
    const toCells = (rows) => rows.map((row) => row.map((value) => ({
      value,
      type: typeof value === "number" ? Number : String,
    })));
    const buffer = await writeExcelFile([
      { sheet: "Metrics", data: toCells([["Condition", "Pmax (W)"], ["A", 0.25]]) },
      { sheet: "Raw Data", data: toCells([["Voltage (V)", "A (A)"], [0, 1], [1, 0]]) },
      { sheet: "Metadata", data: toCells([["Field", "Value"], ["Analysis version", "4.0.0"]]) },
    ]).toBuffer();
    const sheets = await readExcelFile(buffer);

    expect(sheets.map(({ sheet }) => sheet)).toEqual(["Metrics", "Raw Data", "Metadata"]);
    expect(sheets[0].data[1]).toEqual(["A", 0.25]);
    expect(sheets[1].data[2]).toEqual([1, 0]);
    expect(sheets[2].data[1]).toEqual(["Analysis version", "4.0.0"]);
  });

  it("neutralizes spreadsheet formulas in string cells without changing numbers", () => {
    const csv = rowsToCsv([
      ["Condition", "Value"],
      ["=HYPERLINK(\"https://example.invalid\")", -2],
      ["-2mm", 3],
    ]);
    expect(csv).toContain(`"'=HYPERLINK(""https://example.invalid"")"`);
    expect(csv).toContain("'-2mm,3");
    expect(csv).toContain(',-2');
  });

  it("rejects invalid power in efficiency calculations", () => {
    expect(computeEfficiency(-1, 1, 1000)).toBeNull();
    expect(computeEfficiency(Infinity, 1, 1000)).toBeNull();
  });

  it("exports efficiency inputs and marks unphysical efficiency explicitly", () => {
    const dataset = {
      conditions: ["Cell"],
      ivData: {
        Cell: [
          { voltage: 0, rawCurrent: 2 },
          { voltage: 0.5, rawCurrent: 1 },
          { voltage: 1, rawCurrent: 0 },
        ],
      },
    };
    const metrics = { Cell: calcMetrics(dataset.ivData.Cell) };
    const rows = metricsToRows(dataset, metrics, { Cell: 125 }, {
      cellAreaCm2: 0.01,
      irradianceWm2: 1000,
    });
    const header = rows[0];
    const data = rows[1];
    expect(data[header.indexOf("Efficiency status")]).toBe("unphysical");
    expect(data[header.indexOf("Cell area (cm2)")]).toBe(0.01);
    expect(data[header.indexOf("Irradiance (W/m2)")]).toBe(1000);
    expect(data[header.indexOf("Metric flags")]).toMatch(/above the physical 100 % limit/);
  });
});
