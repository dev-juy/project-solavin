/**
 * assistant.js — a deterministic, offline "lab assistant".
 *
 * There is no LLM call here. Every answer is derived directly from the metrics
 * that ivAnalysis extracted from the active dataset, so the numbers it quotes
 * always match the dashboard and exports exactly. This avoids both the prior
 * dependency on a sandbox-only `window.claude` API and the previous canned
 * replies that stated incorrect fill-factor figures.
 */

import { fmtSI } from "./ivAnalysis.js";

// Auto-ranged SI formatting so quoted figures match the dashboard for any
// cell scale (µA lab devices through A-scale production cells).
const fmt = {
  isc: (m) => fmtSI(m.isc, "A"),
  voc: (m) => m.voc == null ? "unavailable" : `${m.status?.voc === "lower-bound" ? "≥ " : ""}${m.voc.toFixed(3)} V`,
  pmax: (m) => `${fmtSI(m.pmax, "W")}${m.status?.pmax === "provisional" ? " (provisional)" : ""}`,
  ff: (m) => Number.isFinite(m.ff) ? (m.ff * 100).toFixed(1) + " %" : "withheld",
  rs: (m) => m.rs == null ? "withheld" : fmtSI(m.rs, "Ω", 2),
  rsh: (m) => m.rsh == null ? "withheld" : (m.rsh === Infinity ? "∞" : fmtSI(m.rsh, "Ω", 2)),
};

function reportable(m, key) {
  if (!m || m.quality === "invalid" || !Number.isFinite(m[key])) return false;
  if (key === "voc") return m.status?.voc === "measured" || m.status?.voc === "interpolated";
  if (key === "pmax") return m.status?.pmax === "measured" || m.status?.pmax === "interpolated";
  if (key === "ff") return m.status?.ff === "computed";
  if (key === "isc") return m.status?.isc !== "unavailable";
  return true;
}

function rankBy(dataset, allMetrics, key) {
  return dataset.conditions
    .map((c) => ({ c, m: allMetrics[c] }))
    .filter((x) => reportable(x.m, key))
    .sort((a, b) => b.m[key] - a.m[key]);
}

function summarize(dataset, allMetrics) {
  const lines = dataset.conditions.map((c) => {
    const m = allMetrics[c];
    if (!m) return `• ${c}: insufficient valid samples`;
    if (m.quality === "invalid")
      return `• ${c} [INVALID]: metrics are not reportable; inspect the channel's data-quality errors`;
    const flag = m.quality === "pass" ? "" : ` [${m.quality.toUpperCase()}]`;
    return `• ${c}${flag}: Pmax ${fmt.pmax(m)}, Isc ${fmt.isc(m)}, Voc ${fmt.voc(m)}, FF ${fmt.ff(m)}`;
  });
  const ranked = rankBy(dataset, allMetrics, "pmax");
  const ranking = ranked.length
    ? `\n\nHighest reportable Pmax: ${ranked[0].c} (${fmt.pmax(ranked[0].m)}).`
    : "\n\nNo channel has a reportable Pmax; review the data-quality flags.";
  return `Summary — ${dataset.name}\n\n${lines.join("\n")}${ranking}`;
}

function compare(dataset, allMetrics) {
  const ranked = rankBy(dataset, allMetrics, "pmax");
  if (!ranked.length) return "No metrics to compare.";
  const order = ranked.map(({ c }) => c).join(" > ");
  const spread =
    ranked.length > 1
      ? `\n\nSpread: ${((1 - ranked[ranked.length - 1].m.pmax / ranked[0].m.pmax) * 100).toFixed(1)}% drop from best to worst.`
      : "";
  return `Ranking by Pmax (highest → lowest):\n${order}${spread}`;
}

function fillFactor(dataset, allMetrics) {
  const ranked = rankBy(dataset, allMetrics, "ff");
  if (!ranked.length) return "No reportable fill-factor values are available. Solavin withholds FF when Voc is not bracketed or a channel fails physical checks.";
  const vals = ranked.map((x) => x.m.ff * 100);
  const lo = Math.min(...vals).toFixed(1);
  const hi = Math.max(...vals).toFixed(1);
  const best = ranked[0];
  return (
    `Fill factor measures how "square" the I-V curve is:\n` +
    `FF = Pmax / (Isc · Voc).\n\n` +
    `This dataset ranges ${lo}–${hi} %. Best: ${best.c} at ${fmt.ff(best.m)}.\n\n` +
    `Interpret FF in the context of device technology, illumination, temperature, ` +
    `sweep protocol, and uncertainty. High series resistance, low shunt resistance, ` +
    `recombination, or measurement artefacts can all reduce FF; one light sweep ` +
    `cannot identify the cause by itself.`
  );
}

function resistances(dataset, allMetrics) {
  const lines = dataset.conditions
    .map((c) => {
      const m = allMetrics[c];
      return m && m.quality !== "invalid" && `• ${c}: Rs ≈ ${fmt.rs(m)}, Rsh ≈ ${fmt.rsh(m)}`;
    })
    .filter(Boolean);
  return (
    `Series (Rs) and shunt (Rsh) resistance estimates, from the I-V slope near ` +
    `Voc and Isc respectively:\n\n` +
    lines.join("\n") +
    `\n\nHigh Rs and/or low Rsh both reduce fill factor. These are first-order ` +
    `slope estimates from a single light sweep — a dark I-V or full single-diode ` +
    `fit gives more rigorous values.`
  );
}

function nextSteps() {
  return (
    "Suggested next experiments:\n" +
    "1. If reporting STC performance, use a calibrated AM1.5G-equivalent setup at 1000 W/m² and control device temperature.\n" +
    "2. Run a temperature sweep to extract dV_oc/dT and dI_sc/dT coefficients.\n" +
    "3. Acquire a dark I-V curve to separate Rs, Rsh and the diode ideality factor.\n" +
    "4. Repeat sweeps to quantify measurement repeatability (error bars).\n" +
    "5. If available, add EQE/spectral-response data to explain current differences."
  );
}

/**
 * Produce an answer string for a user message, grounded in the active dataset.
 * @param {string} message
 * @param {{dataset:object|null, allMetrics:object, efficiency:object|null}} ctx
 */
export function analyze(message, ctx) {
  const { dataset, allMetrics } = ctx;
  if (!dataset || !dataset.conditions || dataset.conditions.length === 0) {
    return "Load a dataset and I'll analyse it. Try: Summarize · Compare · Fill factor · Resistances · Next steps.";
  }
  const l = (message || "").toLowerCase();

  if (/summar|overview|describe/.test(l)) return summarize(dataset, allMetrics);
  if (/compar|rank|which.*best|best.*condition/.test(l)) return compare(dataset, allMetrics);
  if (/fill ?factor|\bff\b/.test(l)) return fillFactor(dataset, allMetrics);
  if (/resist|\brs\b|\brsh\b|series|shunt/.test(l)) return resistances(dataset, allMetrics);
  if (/next|recommend|suggest|what.*do/.test(l)) return nextSteps();

  if (/efficien|\beta\b|η/.test(l)) {
    if (ctx.efficiency) {
      const lines = dataset.conditions
        .map((c) => ctx.efficiency[c] != null && `• ${c}: η ≈ ${ctx.efficiency[c].toPrecision(3)} %`)
        .filter(Boolean);
      return `Power-conversion efficiency η = Pmax / (G·A):\n\n${lines.join("\n")}`;
    }
    return "Enter cell area (cm²) and irradiance (W/m²) on the Metrics page and I can report η = Pmax/(G·A) per condition.";
  }

  if (/voc|open.?circuit/.test(l)) {
    const r = rankBy(dataset, allMetrics, "voc")[0];
    if (!r) return "No reportable Voc is available. The sweep must include a positive-to-negative current crossing at non-negative voltage.";
    return `Voc is the voltage at zero current (the I-V curve's x-intercept). Highest here: ${r.c} at ${fmt.voc(r.m)}.`;
  }
  if (/isc|short.?circuit/.test(l)) {
    const r = rankBy(dataset, allMetrics, "isc")[0];
    if (!r) return "No reportable Isc is available. Check the current sign convention and whether the sweep reaches or brackets V = 0.";
    return `Isc is the current at zero volts. Highest here: ${r.c} at ${fmt.isc(r.m)}.`;
  }

  return (
    "I analyse the active dataset directly. Ask me to:\n" +
    "• Summarize — per-condition figures of merit\n" +
    "• Compare — rank conditions by Pmax\n" +
    "• Fill factor — FF values and interpretation\n" +
    "• Resistances — Rs / Rsh estimates\n" +
    "• Efficiency — η once area & irradiance are set\n" +
    "• Next steps — suggested follow-up experiments"
  );
}

export const QUICK_PROMPTS = ["Summarize", "Compare", "Fill factor", "Resistances", "Next steps"];
