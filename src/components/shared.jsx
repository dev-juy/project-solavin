import { useState, useEffect, useRef } from "react";
import { C8 } from "../theme.js";
import { Ic } from "../icons.jsx";
import { buildAlignedRows } from "../lib/ivAnalysis.js";

/**
 * Renders a number that tweens to a new value instead of snapping — used on
 * the dashboard stat cards so switching datasets has a smooth visual
 * transition. Skips the animation under
 * prefers-reduced-motion, matching the rest of the app's motion tokens
 * (420ms, cubic ease-out — see --dur-slow / --ease-fluid in styles.css).
 */
export function TweenNumber({ value, decimals = 3 }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const rafRef = useRef(null);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    cancelAnimationFrame(rafRef.current);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) {
      setDisplay(to);
      prevRef.current = to;
      return;
    }
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(to);
      prevRef.current = to;
      return;
    }
    const dur = 420;
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // cubic ease-out ≈ var(--ease-fluid)
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else prevRef.current = to;
    }
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return Number.isFinite(display) ? display.toFixed(decimals) : "—";
}

/** Recharts custom tooltip. */
export function ChartTip(p) {
  if (!p.active || !p.payload || !p.payload.length) return null;
  const t = p.t;
  return (
    <div style={{ background: t.card, border: "1px solid " + t.border, borderRadius: 10, padding: "9px 14px", boxShadow: t.shadow, fontSize: 11 }}>
      <div style={{ fontWeight: 600, marginBottom: 5, color: t.textM, fontSize: 10 }}>V = {Number(p.label).toFixed(3)} V</div>
      {p.payload.map((x, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <div style={{ width: 8, height: 3, borderRadius: 1, background: x.color }} />
          <span style={{ flex: 1, color: t.textM, fontSize: 10 }}>{x.dataKey}</span>
          <span className="mono" style={{ fontWeight: 600, fontSize: 10 }}>{Number(x.value).toFixed(3)} {p.unit}</span>
        </div>
      ))}
    </div>
  );
}

/** Channel on/off toggles. */
export function Toggles(p) {
  const t = p.t;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", marginBottom: 10 }}>
      <button onClick={() => { const s = {}; p.conds.forEach((c) => (s[c] = true)); p.setSel(s); }} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid " + t.border, background: "none", color: t.accent, fontSize: 9 }}>All</button>
      <button onClick={() => p.setSel({})} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid " + t.border, background: "none", color: t.textM, fontSize: 9 }}>None</button>
      {p.conds.map((c, ci) => {
        const col = C8[ci % C8.length];
        const colTxt = (t.chan || C8)[ci % (t.chan || C8).length]; // darker in light mode for legible chip text
        const on = !!p.sel[c];
        return (
          <button key={c} onClick={() => p.setSel((v) => { const n = { ...v }; n[c] = !n[c]; return n; })} style={{ padding: "3px 9px", borderRadius: 7, border: "1px solid " + (on ? colTxt + "66" : t.border), background: on ? col + "0c" : "transparent", color: on ? colTxt : t.textM, fontSize: 9, fontWeight: on ? 600 : 400, display: "flex", alignItems: "center", gap: 4, opacity: on ? 1 : 0.45, transition: "all .2s" }}>
            <div style={{ width: 6, height: 6, borderRadius: 2, background: on ? col : t.border }} />{c}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Voltage cursor lookup → current per channel at the requested voltage.
 * Linearly interpolates between the two samples that bracket the target
 * (the same convention used for Isc/Voc extraction). Values outside a
 * channel's measured range are unavailable, never extrapolated. Duplicate
 * setpoints use the same explicit average as charts and metrics.
 * `iSc` is the dataset-wide SI scale ({div, prefix}) so units match the charts.
 */
export function VLookup(p) {
  const t = p.t;
  const iSc = p.iSc || { div: 1e-6, prefix: "µ" };
  const [val, setVal] = useState("");
  const [result, setResult] = useState(null);
  function lookup() {
    const v = parseFloat(val);
    if (isNaN(v)) { setResult(null); return; }
    const r = [];
    p.ds.conditions.forEach((c) => {
      const pts = buildAlignedRows(p.ds, [c]).map((row) => ({
        voltage: row.voltage,
        rawCurrent: row[c],
      }));
      if (!pts.length) return;
      let current, source;
      if (v < pts[0].voltage || v > pts[pts.length - 1].voltage) {
        current = null;
        source = "out of range";
      } else if (v === pts[0].voltage) {
        current = pts[0].rawCurrent;
        source = "measured";
      } else if (v === pts[pts.length - 1].voltage) {
        current = pts[pts.length - 1].rawCurrent;
        source = "measured";
      } else {
        let j = 0;
        while (j < pts.length - 1 && pts[j + 1].voltage < v) j++;
        const a = pts[j], b = pts[j + 1];
        if (a.voltage === v) { current = a.rawCurrent; source = "measured"; }
        else if (b.voltage === v) { current = b.rawCurrent; source = "measured"; }
        else {
          current = a.rawCurrent + ((v - a.voltage) * (b.rawCurrent - a.rawCurrent)) / (b.voltage - a.voltage);
          source = "interpolated";
        }
      }
      r.push({ cond: c, current, source });
    });
    setResult(r);
    if (p.onLookup) p.onLookup(v);
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: result ? 8 : 0 }}>
        <Ic.Search s={14} c={t.textD} />
        <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") lookup(); }} placeholder="Voltage (V)..." type="number" step="0.01" style={{ width: 140, padding: "7px 11px", borderRadius: 8, border: "1px solid " + t.border, background: t.inputBg, color: t.text, fontSize: 11, outline: "none" }} />
        <button onClick={lookup} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: t.accent, color: "#fff", fontSize: 10, fontWeight: 600 }}>Lookup</button>
        {result && <button onClick={() => { setResult(null); if (p.onLookup) p.onLookup(null); }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid " + t.border, background: "none", color: t.textM, fontSize: 10 }}>Clear</button>}
      </div>
      {result && (
        <div className="fadein" style={{ background: t.card, borderRadius: 10, border: "1px solid " + t.border, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <thead><tr style={{ borderBottom: "1px solid " + t.border }}><th style={{ padding: "7px 10px", textAlign: "left", color: t.textM, fontSize: 8, textTransform: "uppercase" }}>Condition</th><th style={{ padding: "7px 10px", textAlign: "right", color: t.textM, fontSize: 8 }}>I ({iSc.prefix}A)</th><th style={{ padding: "7px 10px", textAlign: "right", color: t.textM, fontSize: 8 }}>Source</th></tr></thead>
            <tbody>{result.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid " + t.border }}>
                <td style={{ padding: "6px 10px" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: 2, background: C8[i % C8.length] }} />{r.cond}</span></td>
                <td className="mono" style={{ padding: "6px 10px", textAlign: "right" }}>{Number.isFinite(r.current) ? (r.current / iSc.div).toFixed(4) : "—"}</td>
                <td className="mono" style={{ padding: "6px 10px", textAlign: "right", color: r.source === "out of range" ? t.warn : t.textM, fontSize: 8.5, letterSpacing: ".04em" }}>{r.source.toUpperCase()}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Searchable raw-data table (signed current shown in scientific notation).
 * Rows are windowed ("virtualized"): only the slice near the scroll position
 * is rendered, so multi-thousand-point sweeps stay responsive.
 */
const ROW_H = 24; // fixed row height (px) — required for the virtual window math
export function RawDataViewer(p) {
  const t = p.t;
  const ds = p.ds;
  const [searchCol, setSearchCol] = useState("voltage");
  const [searchVal, setSearchVal] = useState("");
  const [warning, setWarning] = useState("");
  const [matchIdx, setMatchIdx] = useState(-1);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (matchIdx >= 0 && scrollRef.current)
      scrollRef.current.scrollTo({ top: Math.max(0, matchIdx * ROW_H - 90), behavior: "smooth" });
  }, [matchIdx]);
  if (!ds) return null;

  const allCols = ["voltage"].concat(ds.conditions);
  const rows = buildAlignedRows(ds, ds.conditions);

  function doSearch() {
    setWarning(""); setMatchIdx(-1);
    const v = searchVal.trim();
    if (!v) return;
    const num = parseFloat(v);
    if (searchCol === "voltage") {
      if (isNaN(num)) { setWarning("Enter a numeric voltage value."); return; }
      const voltages = rows.map((r) => r.voltage);
      const minV = Math.min(...voltages), maxV = Math.max(...voltages);
      if (num < minV || num > maxV) { setWarning("Value " + num.toFixed(2) + "V is outside the measured range (" + minV.toFixed(2) + "V – " + maxV.toFixed(2) + "V)."); return; }
      let bestI = 0, bestD = Math.abs(voltages[0] - num);
      for (let i = 1; i < voltages.length; i++) { const d = Math.abs(voltages[i] - num); if (d < bestD) { bestD = d; bestI = i; } }
      if (bestD > 0.001) setWarning("Exact value not found. Showing nearest match at V = " + voltages[bestI].toFixed(3) + "V (Δ = " + bestD.toFixed(4) + "V).");
      setMatchIdx(bestI);
    } else {
      if (isNaN(num)) { setWarning("Enter a numeric current value (in Amps, e.g. 1.5e-6)."); return; }
      const candidates = rows
        .map((row, index) => ({ index, voltage: row.voltage, current: row[searchCol] }))
        .filter((entry) => Number.isFinite(entry.current));
      if (!candidates.length) { setWarning('No data for condition "' + searchCol + '".'); return; }
      let best = candidates[0], bestD = Math.abs(candidates[0].current - num);
      for (let i = 1; i < candidates.length; i++) {
        const d = Math.abs(candidates[i].current - num);
        if (d < bestD) { bestD = d; best = candidates[i]; }
      }
      const relErr = best.current !== 0 ? bestD / Math.abs(best.current) : bestD;
      if (relErr > 0.1) setWarning("No close match found. Nearest is " + best.current.toExponential(3) + " A at V = " + best.voltage.toFixed(3) + "V.");
      else if (bestD > 0) setWarning("Nearest match: " + best.current.toExponential(3) + " A at V = " + best.voltage.toFixed(3) + "V.");
      setMatchIdx(best.index);
    }
  }
  const isErr = (w) => w.indexOf("outside") !== -1 || w.indexOf("No close") !== -1 || w.indexOf("not found") !== -1;

  return (
    <div style={{ background: t.card, borderRadius: 12, border: "1px solid " + t.border, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid " + t.border, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}><Ic.Table s={14} c={t.accent} /><span style={{ fontWeight: 600, fontSize: 12 }}>Raw Data</span></div>
        <span style={{ fontSize: 9, color: t.textM }}>{rows.length} rows × {allCols.length} cols</span>
      </div>
      <div style={{ padding: "8px 14px", borderBottom: "1px solid " + t.border, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <select value={searchCol} onChange={(e) => { setSearchCol(e.target.value); setWarning(""); setMatchIdx(-1); }} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid " + t.border, background: t.inputBg, color: t.text, fontSize: 10, outline: "none" }}>
          <option value="voltage">Voltage (V)</option>
          {ds.conditions.map((c) => <option key={c} value={c}>{c} (A)</option>)}
        </select>
        <input value={searchVal} onChange={(e) => { setSearchVal(e.target.value); setWarning(""); }} onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }} placeholder={searchCol === "voltage" ? "e.g. 1.5" : "e.g. 1.5e-6"} style={{ width: 130, padding: "5px 9px", borderRadius: 6, border: "1px solid " + t.border, background: t.inputBg, color: t.text, fontSize: 10, outline: "none" }} />
        <button onClick={doSearch} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: t.accent, color: "#fff", fontSize: 10, fontWeight: 600 }}>Find</button>
        {matchIdx >= 0 && <button onClick={() => { setMatchIdx(-1); setWarning(""); setSearchVal(""); }} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid " + t.border, background: "none", color: t.textM, fontSize: 10 }}>Clear</button>}
      </div>
      {warning && (
        <div style={{ padding: "7px 14px", background: isErr(warning) ? "rgba(239,68,68,.06)" : "rgba(245,158,11,.06)", borderBottom: "1px solid " + t.border, display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isErr(warning) ? t.danger : t.warn} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          <span style={{ fontSize: 10, color: isErr(warning) ? t.danger : t.warn }}>{warning}</span>
        </div>
      )}
      <div ref={scrollRef} onScroll={(e) => { const st = e.currentTarget.scrollTop; setScrollTop((prev) => (Math.abs(prev - st) >= ROW_H ? st : prev)); }} style={{ maxHeight: 220, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead style={{ position: "sticky", top: 0, background: t.card, zIndex: 2 }}><tr>{allCols.map((h, i) => { const isSearched = h === (searchCol === "voltage" ? "voltage" : searchCol); return <th key={i} style={{ padding: "6px 8px", textAlign: i === 0 ? "left" : "right", color: isSearched ? t.accent : t.textM, fontSize: 8, textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "2px solid " + (isSearched ? t.accent : t.border), fontWeight: 600, whiteSpace: "nowrap" }}>{i === 0 ? "V (V)" : h}</th>; })}</tr></thead>
          <tbody>{(() => {
            // Virtual window: render only ~15 visible rows plus overscan;
            // spacer rows keep the scrollbar geometry of the full table.
            const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 5);
            const end = Math.min(rows.length, start + Math.ceil(220 / ROW_H) + 12);
            const out = [];
            if (start > 0) out.push(<tr key="pad-top"><td colSpan={allCols.length} style={{ height: start * ROW_H, padding: 0, border: "none" }} /></tr>);
            for (let ri = start; ri < end; ri++) {
              const row = rows[ri];
              const isMatch = ri === matchIdx;
              out.push(
                <tr key={ri} style={{ height: ROW_H, background: isMatch ? "rgba(59,130,246,.12)" : ri % 2 ? t.cardAlt : "transparent", transition: "background .2s" }}>
                  <td className="mono" style={{ padding: "0 8px", fontSize: 9, whiteSpace: "nowrap", fontWeight: isMatch ? 700 : 600, color: isMatch ? t.accent : t.text }}>{row.voltage.toFixed(2)}</td>
                  {ds.conditions.map((c, ci) => { const value = row[c]; return <td key={ci} className="mono" style={{ padding: "0 8px", fontSize: 9, whiteSpace: "nowrap", textAlign: "right", color: isMatch && c === searchCol ? t.accent : (t.chan || C8)[ci % (t.chan || C8).length], fontWeight: isMatch && c === searchCol ? 700 : 400 }}>{Number.isFinite(value) ? value.toExponential(3) : "—"}</td>; })}
                </tr>
              );
            }
            if (end < rows.length) out.push(<tr key="pad-bot"><td colSpan={allCols.length} style={{ height: (rows.length - end) * ROW_H, padding: 0, border: "none" }} /></tr>);
            return out;
          })()}</tbody>
        </table>
      </div>
    </div>
  );
}
