/**
 * ivAnalysis.js — Photovoltaic I-V curve parameter extraction.
 *
 * This module is the scientific core of Solavin. Every figure of merit
 * shown in the UI, written to exports, or quoted by the assistant is computed
 * here. It is intentionally free of any UI/DOM/React dependency so it can be
 * unit-tested in isolation (see ivAnalysis.test.js).
 *
 * SIGN CONVENTION
 * ---------------
 * We use the generator convention: in the power-producing (first) quadrant the
 * cell sources current, so photocurrent is POSITIVE while voltage is positive.
 * Past the open-circuit voltage the current goes NEGATIVE (the cell sinks
 * current). All extraction below operates on the *signed* current — this is the
 * fix for the historical bug where absolute-value current was fed into a
 * zero-crossing detector, which pushed the maximum-power search into the
 * reverse-bias region and produced fill factors above 100 %.
 *
 * A measured datapoint is { voltage, current, rawCurrent } where:
 *   - voltage    : terminal voltage in volts (V)
 *   - rawCurrent : measured signed current in amperes (A)   <-- used for physics
 *   - current    : |rawCurrent|, kept only for legacy display helpers
 */

export const ANALYSIS_VERSION = "4.0.0";
export const ANALYSIS_METHOD = "piecewise-linear-v4";
const MAX_WORKSHEET_ROWS = 250000;
const MAX_WORKSHEET_COLUMNS = 2048;

/** Linear interpolation of y at target x between (x0,y0) and (x1,y1). */
function lerp(x, x0, y0, x1, y1) {
  if (x1 === x0) return y0;
  return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
}

/** Least-squares line fit of y(x); null when degenerate. */
function linearFit(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let k = 0; k < n; k++) {
    sx += xs[k]; sy += ys[k]; sxx += xs[k] * xs[k]; sxy += xs[k] * ys[k];
  }
  const den = n * sxx - sx * sx;
  if (!Number.isFinite(den) || den === 0) return null;
  const slope = (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null;
  const mean = sy / n;
  let ssRes = 0, ssTot = 0;
  for (let k = 0; k < n; k++) {
    ssRes += (ys[k] - (intercept + slope * xs[k])) ** 2;
    ssTot += (ys[k] - mean) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, r2, points: n, rmse: Math.sqrt(ssRes / n) };
}

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

/**
 * Return the signed current for a datapoint, tolerating either the
 * { rawCurrent } shape (preferred) or a bare { current } that is already signed.
 */
function signedCurrent(pt) {
  if (pt == null) return NaN;
  if (pt.rawCurrent != null) return finiteNumber(pt.rawCurrent);
  return finiteNumber(pt.current);
}

/**
 * Clean a sweep and average repeated samples at the exact same voltage.
 * Repeated setpoints are common in exported instrument data; averaging makes
 * extraction deterministic while the returned duplicate count ensures the
 * operation is never silent.
 */
function normalizeSweep(pts) {
  const raw = pts
    .map((p) => ({ v: finiteNumber(p && p.voltage), i: signedCurrent(p) }))
    .filter((p) => Number.isFinite(p.v) && Number.isFinite(p.i))
    .sort((a, b) => a.v - b.v);
  const clean = [];
  for (const point of raw) {
    const last = clean[clean.length - 1];
    if (last && last.v === point.v) {
      last.sum += point.i;
      last.count++;
      last.i = last.sum / last.count;
    } else {
      clean.push({ v: point.v, i: point.i, sum: point.i, count: 1 });
    }
  }
  return {
    clean: clean.map(({ v, i }) => ({ v, i })),
    rawCount: raw.length,
    duplicateCount: raw.length - clean.length,
  };
}

function medianPositiveStep(values) {
  const steps = [];
  for (let k = 1; k < values.length; k++) {
    const step = values[k] - values[k - 1];
    if (step > 0) steps.push(step);
  }
  if (!steps.length) return 0;
  steps.sort((a, b) => a - b);
  const mid = Math.floor(steps.length / 2);
  return steps.length % 2 ? steps[mid] : (steps[mid - 1] + steps[mid]) / 2;
}

/**
 * Fit I(V) locally around a target voltage. At most seven nearest samples are
 * used so distant reverse-bias or knee data cannot dominate an endpoint slope.
 */
function localCurrentFit(v, i, target, characteristicSpan) {
  const step = medianPositiveStep(v);
  const radius = Math.max(characteristicSpan, 3 * step);
  let indices = v
    .map((value, index) => ({ index, distance: Math.abs(value - target) }))
    .filter((entry) => entry.distance <= radius + Number.EPSILON)
    .sort((a, b) => a.distance - b.distance);
  if (indices.length < 3) {
    indices = v
      .map((value, index) => ({ index, distance: Math.abs(value - target) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);
  } else {
    indices = indices.slice(0, 7);
  }
  indices.sort((a, b) => v[a.index] - v[b.index]);
  const xs = indices.map((entry) => v[entry.index]);
  const ys = indices.map((entry) => i[entry.index]);
  const result = linearFit(xs, ys);
  return result ? { ...result, voltageSpan: xs[xs.length - 1] - xs[0] } : null;
}

/**
 * Extract photovoltaic figures of merit from a single I-V sweep.
 *
 * @param {Array<{voltage:number, current?:number, rawCurrent?:number}>} pts
 *   Measured points. Order does not matter — points are sorted by voltage.
 * @returns {null | {
 *   isc:number, voc:number|null, pmax:number, vmp:number, imp:number,
 *   ff:number|null, rs:number|null, rsh:number|null, crossIndex:number,
 *   notes:{ iscExtrapolated:boolean, vocBeyondRange:boolean, vocAmbiguous:boolean, duplicateVoltages:number },
 *   status:Record<string,string>, warnings:string[], errors:string[],
 *   quality:"pass"|"review"|"invalid"
 * }}  Electrical quantities use SI base units (V, A, W, Ω). `ff` is a
 *   dimensionless fraction when identifiable. Status fields distinguish
 *   measured, interpolated, extrapolated, provisional, and withheld results.
 *   Returns null when fewer than 3 finite, unique-voltage samples remain.
 */
export function calcMetrics(pts) {
  if (!Array.isArray(pts) || pts.length < 3) return null;

  // Build clean, voltage-sorted arrays of finite, unique-voltage samples.
  const normalized = normalizeSweep(pts);
  const clean = normalized.clean;
  const n = clean.length;
  if (n < 3) return null;

  const v = clean.map((p) => p.v);
  const i = clean.map((p) => p.i);

  const notes = {
    iscExtrapolated: false,
    vocBeyondRange: false,
    vocAmbiguous: false,
    duplicateVoltages: normalized.duplicateCount,
  };
  const status = {
    isc: "unavailable",
    voc: "unavailable",
    pmax: "unavailable",
    ff: "unavailable",
    rs: "unavailable",
    rsh: "unavailable",
  };

  // ── Short-circuit current Isc = I(V = 0) ─────────────────────────────────
  // Prefer an exact V=0 sample, else interpolate across the bracketing pair,
  // else linearly extrapolate from the two samples nearest V=0.
  let isc;
  const zeroExact = v.indexOf(0);
  if (zeroExact !== -1) {
    isc = i[zeroExact];
    status.isc = "measured";
  } else {
    let bracket = -1;
    for (let j = 0; j < n - 1; j++) {
      if ((v[j] <= 0 && v[j + 1] >= 0) || (v[j] >= 0 && v[j + 1] <= 0)) {
        bracket = j;
        break;
      }
    }
    if (bracket !== -1) {
      isc = lerp(0, v[bracket], i[bracket], v[bracket + 1], i[bracket + 1]);
      status.isc = "interpolated";
    } else {
      const nearest = clean
        .map((point) => ({ ...point, distance: Math.abs(point.v) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 2)
        .sort((a, b) => a.v - b.v);
      isc = lerp(0, nearest[0].v, nearest[0].i, nearest[1].v, nearest[1].i);
      notes.iscExtrapolated = true;
      status.isc = "extrapolated";
    }
  }

  // ── Open-circuit voltage Voc = V where I first crosses 0 going negative ───
  let voc = null;
  let crossIndex = -1;
  const vocCandidates = [];
  for (let j = 1; j < n; j++) {
    if (i[j - 1] > 0 && i[j] <= 0) {
      const candidate = lerp(0, i[j - 1], v[j - 1], i[j], v[j]);
      if (candidate >= 0) {
        vocCandidates.push({
          voltage: candidate,
          index: j,
          status: i[j] === 0 ? "measured" : "interpolated",
        });
      }
    }
  }
  if (vocCandidates.length === 1) {
    voc = vocCandidates[0].voltage;
    crossIndex = vocCandidates[0].index;
    status.voc = vocCandidates[0].status;
  } else if (vocCandidates.length > 1) {
    notes.vocAmbiguous = true;
    status.voc = "ambiguous";
  } else {
    const nonnegative = clean.filter((point) => point.v >= 0);
    if (nonnegative.some((point) => point.i > 0)) {
      // Keep the boundary value for charting/backward compatibility, but mark
      // it explicitly as a lower bound and do not derive FF or Rs from it.
      voc = nonnegative[nonnegative.length - 1].v;
      notes.vocBeyondRange = true;
      status.voc = "lower-bound";
    }
  }

  // ── Maximum power point — restricted to the power quadrant (V≥0, I≥0) ─────
  // The sweep is treated as piecewise-linear between samples. On a segment
  // with I(V) = a + bV the power P(V) = aV + bV² is quadratic, so its maximum
  // over the segment lies either at an endpoint or at the interior stationary
  // point V* = −a/(2b) (a true maximum only when b < 0). Scanning every sample
  // point plus every interior stationary point therefore finds the exact
  // maximum of the interpolated P-V curve — finer than the measured voltage
  // grid, without assuming any diode model.
  let pmax = 0;
  let vmp = 0;
  let imp = 0;
  let mppSource = "unavailable";
  let mppOverflow = false;
  const considerMpp = (vv, ii, source) => {
    if (vv < 0 || ii < 0 || (voc != null && status.voc !== "lower-bound" && vv > voc + 1e-12)) return;
    const p = vv * ii;
    if (!Number.isFinite(p)) { mppOverflow = true; return; }
    if (p > pmax) { pmax = p; vmp = vv; imp = ii; mppSource = source; }
  };
  for (let j = 0; j < n; j++) considerMpp(v[j], i[j], "measured");
  for (let j = 0; j < n - 1; j++) {
    const dv = v[j + 1] - v[j];
    if (dv <= 0) continue;
    const b = (i[j + 1] - i[j]) / dv;
    if (b >= 0) continue; // parabola opens upward or is flat: endpoints suffice
    const a = i[j] - b * v[j];
    const vStar = -a / (2 * b);
    if (vStar > v[j] && vStar < v[j + 1]) considerMpp(vStar, a + b * vStar, "interpolated");
  }
  if (pmax > 0) status.pmax = status.voc === "lower-bound" ? "provisional" : mppSource;

  // ── Fill factor FF = Pmax / (Isc · Voc) ──────────────────────────────────
  // Uses the Pmax actually found on the P-V curve above — never the
  // Voc·Isc·(assumed FF) shortcut.
  let ff = null;
  if (isc > 0 && voc > 0 && (status.voc === "measured" || status.voc === "interpolated")) {
    ff = pmax / (isc * voc);
    status.ff = status.isc === "extrapolated" ? "provisional" : "computed";
  }

  // ── Endpoint resistance estimates ─────────────────────────────────────────
  // Fit the nearest local samples rather than using one noise-sensitive pair.
  // These remain slope estimates from a light sweep, not single-diode fits.
  let rs = null;
  let rsFit = null;
  if (voc != null && (status.voc === "measured" || status.voc === "interpolated")) {
    rsFit = localCurrentFit(v, i, voc, 0.08 * Math.max(voc, medianPositiveStep(v)));
    if (rsFit && rsFit.slope !== 0) {
      const estimate = Math.abs(1 / rsFit.slope);
      if (Number.isFinite(estimate)) {
        rs = estimate;
        status.rs = "estimated";
      }
    }
  }

  let rsh = null;
  const rshFit = localCurrentFit(
    v,
    i,
    0,
    0.08 * Math.max(voc || (v[n - 1] - v[0]), medianPositiveStep(v))
  );
  if (rshFit) {
    rsh = rshFit.slope === 0 ? Infinity : Math.abs(1 / rshFit.slope);
    status.rsh = status.isc === "extrapolated" ? "provisional" : "estimated";
  }

  // ── Data-quality warnings ─────────────────────────────────────────────────
  // Sanity checks a reviewer would run by eye; surfaced verbatim in the UI.
  const warnings = [];
  const errors = [];
  if (normalized.duplicateCount > 0)
    warnings.push(`${normalized.duplicateCount} repeated voltage sample(s) were averaged before extraction — split forward/reverse sweeps into separate channels if these repeats represent hysteresis.`);
  if (notes.iscExtrapolated)
    warnings.push("No samples bracket V = 0 — Isc is a linear extrapolation from the two nearest voltage points.");
  if (notes.vocBeyondRange)
    warnings.push("Current never crosses zero within the sweep — Voc is reported only as a lower bound; FF and Rs are withheld and Pmax is provisional.");
  if (notes.vocAmbiguous)
    errors.push(`Current crosses from positive to non-positive ${vocCandidates.length} times at non-negative voltage — Voc is ambiguous, so Voc, FF, and Rs are withheld.`);
  if (!Number.isFinite(isc))
    errors.push("Isc calculation overflowed or became non-finite — inspect extreme values, units, and corrupt cells.");
  if (mppOverflow) {
    status.pmax = "overflow";
    errors.push("At least one V·I product overflowed the numeric range — power metrics are not reportable; inspect extreme values and units.");
  }
  if (ff != null && !Number.isFinite(ff)) {
    status.ff = "unavailable";
    errors.push("Fill-factor calculation became non-finite — power metrics are not reportable; inspect extreme values and units.");
    ff = null;
  }
  if (isc <= 0)
    errors.push("Isc ≤ 0. Solavin requires generator convention (positive current in the power quadrant); invert the current sign or correct the column mapping.");
  if (!v.some((value) => value >= 0))
    errors.push("The sweep contains no non-negative voltage samples, so photovoltaic power-quadrant metrics are not identifiable.");
  if (voc === null && !notes.vocAmbiguous)
    errors.push("No non-negative open-circuit crossing or lower bound can be identified from this sweep.");
  if (ff != null && (ff < 0 || ff > 1 + 1e-9)) {
    status.ff = "unphysical";
    errors.push(`Computed fill factor is ${(ff * 100).toFixed(2)} %, outside the physical 0–100 % interval — inspect sign convention, sweep coverage, and outliers.`);
  }
  // Monotonicity: between V = 0 and Voc an illuminated cell's current should
  // fall as voltage rises. Tolerate noise up to 2 % of the Isc scale.
  {
    const scale = Math.abs(isc) > 0 ? Math.abs(isc) : Math.max(...i.map((x) => Math.abs(x)));
    const tol = 0.02 * scale;
    let rises = 0;
    for (let j = 1; j < n; j++) {
      const limit = voc == null ? v[n - 1] : voc;
      if (v[j - 1] < 0 || v[j] > limit + 1e-12) continue;
      if (i[j] - i[j - 1] > tol) rises++;
    }
    if (rises > 0)
      warnings.push(`Current increases with voltage at ${rises} point(s) between 0 V and Voc — an illuminated I-V curve should fall monotonically; check for noise or sweep artefacts.`);
  }
  // Sampling density: too few power-quadrant points make Vmp/Imp unreliable.
  {
    let quad = 0;
    for (let j = 0; j < n; j++) if (v[j] >= 0 && i[j] >= 0) quad++;
    if (quad < 5)
      warnings.push(`Only ${quad} sweep point(s) fall in the power quadrant (V ≥ 0, I ≥ 0) — Vmp/Imp resolution is limited; use a finer voltage step.`);
  }

  const quality = errors.length ? "invalid" : warnings.length ? "review" : "pass";
  return {
    isc, voc, pmax, vmp, imp, ff, rs, rsh, crossIndex,
    sampleCount: normalized.rawCount,
    uniqueVoltageCount: n,
    notes,
    status,
    fit: { rs: rsFit, rsh: rshFit },
    warnings,
    errors,
    quality,
  };
}

/**
 * Pick an SI display scale for a quantity: siPrefix(1.5e-6) → { div: 1e-6,
 * prefix: "µ" } so `value / div` reads in µ-units. Chooses the largest prefix
 * that keeps the scaled magnitude ≥ 1 (i.e. in [1, 1000) for in-range values),
 * so µA-scale lab cells and A-scale production cells both display naturally.
 * Returns the identity scale for zero/non-finite input.
 */
export function siPrefix(maxAbs) {
  const TABLE = [
    [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""],
    [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"],
  ];
  if (!Number.isFinite(maxAbs) || maxAbs <= 0) return { div: 1, prefix: "" };
  for (const [div, prefix] of TABLE) if (maxAbs >= div) return { div, prefix };
  return { div: 1e-12, prefix: "p" };
}

/** Format one value with its own auto-picked SI prefix: fmtSI(1.54e-6, "A") → "1.540 µA". */
export function fmtSI(value, unit, digits = 3) {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return (0).toFixed(digits) + " " + unit;
  const { div, prefix } = siPrefix(Math.abs(value));
  return (value / div).toFixed(digits) + " " + prefix + unit;
}

/**
 * Power-conversion efficiency η = Pmax / (G · A).
 *
 * @param {number} pmaxW       Maximum power in watts.
 * @param {number} areaCm2     Illuminated cell area in cm².
 * @param {number} irradiance  Incident irradiance G in W/m² (STC = 1000).
 * @returns {number|null} Efficiency in percent, or null for invalid inputs.
 */
export function computeEfficiency(pmaxW, areaCm2, irradiance) {
  const p = Number(pmaxW);
  const a = Number(areaCm2);
  const g = Number(irradiance);
  if (!Number.isFinite(p) || !Number.isFinite(a) || !Number.isFinite(g) || p < 0 || a <= 0 || g <= 0) return null;
  const areaM2 = a * 1e-4; // cm² → m²
  const incidentPower = g * areaM2;
  if (!Number.isFinite(incidentPower) || incidentPower <= 0) return null;
  const efficiency = (p / incidentPower) * 100;
  return Number.isFinite(efficiency) ? efficiency : null;
}

/**
 * Parse an array-of-arrays worksheet (column A = voltage, columns B+ = current
 * sweeps, row 0 = headers) into a structured dataset fragment.
 *
 * @param {Array<Array<*>>} rows
 * Missing/blank cells are skipped, never coerced to zero. Header names are
 * made unique so one channel cannot silently overwrite another.
 *
 * @returns {null | {
 *   conditions:string[],
 *   ivData:Record<string, Array>,
 *   diagnostics:{warnings:string[], rows:number, channels:Record<string, object>}
 * }}
 */
export function extractIV(rows) {
  if (!Array.isArray(rows) || rows.length < 2 || !Array.isArray(rows[0])) return null;
  if (rows.length - 1 > MAX_WORKSHEET_ROWS)
    throw new Error(`Worksheet exceeds the ${MAX_WORKSHEET_ROWS.toLocaleString()}-data-row safety limit.`);
  const dataRows = rows.slice(1).filter(Array.isArray);
  const maxColumns = rows.reduce((max, row) => (Array.isArray(row) ? Math.max(max, row.length) : max), 0);
  if (maxColumns < 2) return null;
  if (maxColumns > MAX_WORKSHEET_COLUMNS)
    throw new Error(`Worksheet exceeds the ${MAX_WORKSHEET_COLUMNS.toLocaleString()}-column safety limit.`);

  const warnings = [];
  const channels = Object.create(null);
  const ivData = Object.create(null);
  const conditions = [];
  const nameCounts = new Map();
  let invalidVoltageRows = 0;
  for (const row of dataRows) {
    if (!Number.isFinite(finiteNumber(row[0]))) invalidVoltageRows++;
  }

  const uniqueName = (raw, columnIndex) => {
    let base = raw == null || String(raw).trim() === ""
      ? `Channel ${columnIndex}`
      : String(raw).trim().slice(0, 120);
    if (["__proto__", "prototype", "constructor"].includes(base)) base = `Channel: ${base}`;
    const count = (nameCounts.get(base) || 0) + 1;
    nameCounts.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  };

  for (let columnIndex = 1; columnIndex < maxColumns; columnIndex++) {
    const hasHeader = rows[0][columnIndex] != null && String(rows[0][columnIndex]).trim() !== "";
    const hasAnyCell = dataRows.some((row) => row[columnIndex] != null && String(row[columnIndex]).trim() !== "");
    if (!hasHeader && !hasAnyCell) continue;

    const name = uniqueName(rows[0][columnIndex], columnIndex);
    const points = [];
    let skippedCurrent = 0;
    for (const row of dataRows) {
      const voltage = finiteNumber(row[0]);
      const current = finiteNumber(row[columnIndex]);
      if (!Number.isFinite(voltage)) continue;
      if (!Number.isFinite(current)) {
        skippedCurrent++;
        continue;
      }
      points.push({ voltage, current: Math.abs(current), rawCurrent: current });
    }

    const uniqueVoltages = new Set(points.map((point) => point.voltage)).size;
    if (points.length < 3 || uniqueVoltages < 3) {
      warnings.push(`Column ${columnIndex + 1} (${name}) was ignored because it contains ${points.length} valid pair(s) across ${uniqueVoltages} unique voltage(s); at least 3 unique voltages are required.`);
      continue;
    }
    if (!hasHeader) warnings.push(`Column ${columnIndex + 1} had no header and was named "${name}".`);
    if (nameCounts.get(String(rows[0][columnIndex] ?? "").trim()) > 1)
      warnings.push(`Duplicate channel header "${String(rows[0][columnIndex]).trim()}" was renamed "${name}".`);
    if (skippedCurrent > 0)
      warnings.push(`${name}: skipped ${skippedCurrent} row(s) with a blank or non-numeric current; no zero values were inserted.`);

    conditions.push(name);
    ivData[name] = points;
    channels[name] = {
      column: columnIndex + 1,
      validPoints: points.length,
      uniqueVoltages,
      skippedCurrent,
    };
  }
  if (conditions.length === 0) return null;
  if (invalidVoltageRows > 0)
    warnings.push(`Skipped ${invalidVoltageRows} row(s) with a blank or non-numeric voltage.`);

  return {
    conditions,
    ivData,
    diagnostics: {
      warnings,
      rows: dataRows.length,
      invalidVoltageRows,
      channels,
    },
  };
}

/**
 * Parse RFC 4180-style CSV text without executing formulas or coercing values.
 * Numeric conversion happens later in extractIV().
 */
export function parseCsv(text, limits = {}) {
  if (typeof text !== "string") throw new TypeError("CSV input must be text.");
  const maxRows = limits.maxRows || 250000;
  const maxColumns = limits.maxColumns || 2048;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  const pushField = () => {
    row.push(field);
    field = "";
    if (row.length > maxColumns) throw new Error(`CSV exceeds the ${maxColumns}-column safety limit.`);
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    if (rows.length > maxRows) throw new Error(`CSV exceeds the ${maxRows.toLocaleString()}-row safety limit.`);
  };

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      pushRow();
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  if (field !== "" || row.length > 0) pushRow();
  while (rows.length && rows[rows.length - 1].every((cell) => cell === "")) rows.pop();
  return rows;
}

/**
 * Align channels by numeric voltage rather than array index. Sparse channels
 * retain null gaps, preventing a missing cell from shifting every later point
 * onto the wrong x-coordinate.
 */
export function buildAlignedRows(dataset, selectedConditions, valueForPoint = (point) => point.rawCurrent) {
  if (!dataset || !Array.isArray(dataset.conditions) || !dataset.ivData) return [];
  const conditions = Array.isArray(selectedConditions) ? selectedConditions : dataset.conditions;
  const rowsByVoltage = new Map();
  for (const condition of conditions) {
    const samplesByVoltage = new Map();
    for (const point of dataset.ivData[condition] || []) {
      const voltage = finiteNumber(point && point.voltage);
      const value = valueForPoint(point, condition);
      if (!Number.isFinite(voltage) || !Number.isFinite(value)) continue;
      const group = samplesByVoltage.get(voltage) || { sum: 0, count: 0 };
      group.sum += value;
      group.count++;
      samplesByVoltage.set(voltage, group);
    }
    for (const [voltage, group] of samplesByVoltage) {
      const row = rowsByVoltage.get(voltage) || { voltage };
      row[condition] = group.sum / group.count;
      rowsByVoltage.set(voltage, row);
    }
  }
  return [...rowsByVoltage.values()].sort((a, b) => a.voltage - b.voltage);
}

/**
 * Build the bundled demo dataset: a real solar-cell I-V sweep measured under
 * room lighting across seven laser-focus conditions. Voltage in V, current in A.
 */
export function buildSampleDataset() {
  const conditions = [
    "Focused Laser",
    "-2mm",
    "-4mm Focus",
    "-6mm Focus",
    "+2mm",
    "+4mm",
    "+6mm Focus",
  ];
  // [V, I_cond1 … I_cond7] in amperes (signed).
  const R = [
    [0, 1.539e-6, 1.46e-6, 1.35e-6, 1.113e-6, 1.562e-6, 1.541e-6, 1.583e-6],
    [0.05, 1.528e-6, 1.456e-6, 1.348e-6, 1.128e-6, 1.525e-6, 1.541e-6, 1.565e-6],
    [0.1, 1.489e-6, 1.458e-6, 1.319e-6, 1.099e-6, 1.541e-6, 1.527e-6, 1.576e-6],
    [0.2, 1.471e-6, 1.42e-6, 1.291e-6, 1.091e-6, 1.507e-6, 1.498e-6, 1.545e-6],
    [0.3, 1.446e-6, 1.393e-6, 1.302e-6, 1.063e-6, 1.482e-6, 1.496e-6, 1.517e-6],
    [0.5, 1.4e-6, 1.352e-6, 1.234e-6, 1.033e-6, 1.44e-6, 1.435e-6, 1.478e-6],
    [0.7, 1.369e-6, 1.287e-6, 1.184e-6, 9.85e-7, 1.374e-6, 1.382e-6, 1.412e-6],
    [0.9, 1.318e-6, 1.256e-6, 1.15e-6, 9.39e-7, 1.311e-6, 1.309e-6, 1.36e-6],
    [1.1, 1.245e-6, 1.176e-6, 1.063e-6, 8.66e-7, 1.253e-6, 1.247e-6, 1.297e-6],
    [1.3, 1.158e-6, 1.1e-6, 9.96e-7, 7.82e-7, 1.173e-6, 1.171e-6, 1.226e-6],
    [1.5, 1.058e-6, 9.96e-7, 8.88e-7, 6.96e-7, 1.07e-6, 1.06e-6, 1.109e-6],
    [1.7, 8.89e-7, 8.33e-7, 7.37e-7, 5.59e-7, 9e-7, 8.9e-7, 9.34e-7],
    [1.9, 5.27e-7, 5.4e-7, 4.74e-7, 3.44e-7, 5.98e-7, 5.9e-7, 6.42e-7],
    [2, 2.47e-7, 3.22e-7, 2.72e-7, 1.87e-7, 3.71e-7, 3.58e-7, 4.15e-7],
    [2.05, 7.8e-8, 1.73e-7, 1.42e-7, 8.3e-8, 2.22e-7, 2.14e-7, 2.72e-7],
    [2.1, -1.08e-7, 2.3e-8, -1.3e-8, -3.2e-8, 5.8e-8, 4.6e-8, 1e-7],
    [2.2, -6.48e-7, -3.94e-7, -4.08e-7, -3.67e-7, -3.59e-7, -3.77e-7, -3.19e-7],
    [2.4, -2.397e-6, -1.837e-6, -1.797e-6, -1.6e-6, -1.777e-6, -1.816e-6, -1.73e-6],
    [2.5, -3.875e-6, -3.052e-6, -2.978e-6, -2.663e-6, -2.968e-6, -3.025e-6, -2.923e-6],
  ];
  const ivData = {};
  conditions.forEach((c, ci) => {
    ivData[c] = R.map((r) => ({
      voltage: r[0],
      current: Math.abs(r[ci + 1]),
      rawCurrent: r[ci + 1],
    }));
  });
  return {
    name: "Sample: Solar Cell (Room Lights)",
    conditions,
    ivData,
    source: { file: "examples/sample_iv_data.csv", sheet: "CSV" },
  };
}

/**
 * Build the rows (array-of-arrays) for a metrics export table. Pure — the
 * caller decides whether to serialise to CSV or hand off to a workbook writer.
 * Column units are auto-ranged to the dataset's magnitudes (one shared scale
 * per column so values stay comparable down a column), with ASCII-safe unit
 * spellings ("uA", "kOhm") for CSV portability.
 *
 * @param {{conditions:string[]}} dataset
 * @param {Record<string, ReturnType<typeof calcMetrics>>} allMetrics
 * @param {Record<string, number>|null} [efficiency]  optional η (%) per condition
 * @param {{cellAreaCm2?:number, irradianceWm2?:number}} [efficiencyInputs]
 */
export function metricsToRows(dataset, allMetrics, efficiency, efficiencyInputs = {}) {
  const ms = dataset.conditions.map((c) => allMetrics[c]).filter(Boolean);
  const iScale = siPrefix(Math.max(0, ...ms.map((m) => Math.abs(m.isc)), ...ms.map((m) => Math.abs(m.imp))));
  const pScale = siPrefix(Math.max(0, ...ms.map((m) => Math.abs(m.pmax))));
  const rsScale = siPrefix(Math.max(0, ...ms.filter((m) => Number.isFinite(m.rs)).map((m) => Math.abs(m.rs))));
  const rshScale = siPrefix(Math.max(0, ...ms.filter((m) => Number.isFinite(m.rsh)).map((m) => Math.abs(m.rsh))));
  const ascii = (p) => (p === "µ" ? "u" : p);
  const header = [
    "Condition",
    `Isc (${ascii(iScale.prefix)}A)`,
    "Voc (V)",
    `Pmax (${ascii(pScale.prefix)}W)`,
    "Vmp (V)",
    `Imp (${ascii(iScale.prefix)}A)`,
    "FF (%)",
    `Rs (${ascii(rsScale.prefix)}Ohm)`,
    `Rsh (${ascii(rshScale.prefix)}Ohm)`,
  ];
  if (efficiency) header.push(
    "Efficiency (%)",
    "Efficiency status",
    "Cell area (cm2)",
    "Irradiance (W/m2)"
  );
  header.push(
    "Isc status",
    "Voc status",
    "Pmax status",
    "FF status",
    "Quality",
    "Valid samples",
    "Unique voltages",
    "Metric flags",
    "Import flags",
    "Source file",
    "Source sheet",
    "Analysis version",
    "Analysis method"
  );
  const importFlags = (dataset.diagnostics?.warnings || []).join(" | ");
  const rows = [header];
  dataset.conditions.forEach((c) => {
    const m = allMetrics[c];
    if (!m) return;
    const efficiencyValue = efficiency?.[c];
    const hasEfficiency = Number.isFinite(efficiencyValue);
    const metricFlags = [...(m.errors || []), ...(m.warnings || [])];
    const hasPmax = ["measured", "interpolated", "provisional"].includes(m.status?.pmax);
    if (Number.isFinite(efficiencyValue) && efficiencyValue > 100)
      metricFlags.push(`Computed efficiency is ${efficiencyValue.toPrecision(4)} %, above the physical 100 % limit — verify area, irradiance, units, and measurement conditions.`);
    const row = [
      c,
      Number.isFinite(m.isc) ? +(m.isc / iScale.div).toFixed(4) : "",
      Number.isFinite(m.voc) ? +m.voc.toFixed(4) : "",
      hasPmax ? +(m.pmax / pScale.div).toFixed(4) : "",
      hasPmax ? +m.vmp.toFixed(4) : "",
      hasPmax ? +(m.imp / iScale.div).toFixed(4) : "",
      m.ff == null ? "" : +(m.ff * 100).toFixed(2),
      m.rs == null ? "" : +(m.rs / rsScale.div).toFixed(3),
      m.rsh == null ? "" : m.rsh === Infinity ? "Inf" : +(m.rsh / rshScale.div).toFixed(3),
    ];
    if (efficiency) row.push(
      hasEfficiency ? +efficiencyValue.toPrecision(4) : "",
      !hasEfficiency ? "" : efficiencyValue > 100 ? "unphysical" : "computed",
      Number.isFinite(efficiencyInputs.cellAreaCm2) ? efficiencyInputs.cellAreaCm2 : "",
      Number.isFinite(efficiencyInputs.irradianceWm2) ? efficiencyInputs.irradianceWm2 : ""
    );
    row.push(
      m.status?.isc || "",
      m.status?.voc || "",
      m.status?.pmax || "",
      m.status?.ff || "",
      m.quality || "",
      m.sampleCount ?? "",
      m.uniqueVoltageCount ?? "",
      metricFlags.join(" | "),
      importFlags,
      dataset.source?.file || "",
      dataset.source?.sheet || "",
      ANALYSIS_VERSION,
      ANALYSIS_METHOD
    );
    rows.push(row);
  });
  return rows;
}

/**
 * Export the signed measurements exactly as aligned for visualization.
 * Missing samples remain blank; duplicate exact-voltage samples are averaged
 * consistently with buildAlignedRows().
 */
export function rawDataToRows(dataset) {
  if (!dataset || !Array.isArray(dataset.conditions)) return [["Voltage (V)"]];
  const header = ["Voltage (V)", ...dataset.conditions.map((condition) => `${condition} (A)`)];
  const body = buildAlignedRows(dataset).map((aligned) => [
    aligned.voltage,
    ...dataset.conditions.map((condition) =>
      Number.isFinite(aligned[condition]) ? aligned[condition] : ""
    ),
  ]);
  return [header, ...body];
}

/** Export analysis provenance and interpretation rules as a two-column sheet. */
export function metadataToRows(dataset, efficiencyInputs = {}) {
  return [
    ["Field", "Value"],
    ["Solavin analysis version", ANALYSIS_VERSION],
    ["Analysis method", ANALYSIS_METHOD],
    ["Dataset", dataset?.name || ""],
    ["Source file", dataset?.source?.file || ""],
    ["Source sheet", dataset?.source?.sheet || ""],
    ["Cell area (cm2)", Number.isFinite(efficiencyInputs.cellAreaCm2) ? efficiencyInputs.cellAreaCm2 : ""],
    ["Irradiance (W/m2)", Number.isFinite(efficiencyInputs.irradianceWm2) ? efficiencyInputs.irradianceWm2 : ""],
    ["Current convention", "Generator convention: positive current produces positive V*I power"],
    ["Visualization", "Measured samples joined with straight segments; no smoothing"],
    ["Duplicate voltage handling", "Exact duplicate setpoints are averaged and reported"],
    ["Missing cell handling", "Missing or non-numeric measurements stay missing; zeros are never inserted"],
    ["Censored sweep handling", "When Voc is not bracketed, Voc is a lower bound, Pmax is provisional, and FF/Rs are withheld"],
    ["Import flags", (dataset?.diagnostics?.warnings || []).join(" | ")],
  ];
}

/** Serialise export rows to a CSV string. */
export function rowsToCsv(rows) {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          // Prevent spreadsheet formula injection through untrusted channel
          // labels while leaving numeric negative values numeric.
          const safe = typeof cell === "string" && /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
          const s = String(safe);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\n");
}
