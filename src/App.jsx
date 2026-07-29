import { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import readExcelFile from "read-excel-file/browser";
import writeExcelFile from "write-excel-file/browser";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, ReferenceLine,
  ReferenceDot, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Brush,
} from "recharts";

import { mkT, C8 } from "./theme.js";
import { Logo, Ic } from "./icons.jsx";
import {
  calcMetrics, buildSampleDataset, extractIV, computeEfficiency,
  metricsToRows, rowsToCsv, siPrefix, fmtSI, parseCsv, buildAlignedRows,
  rawDataToRows, metadataToRows,
} from "./lib/ivAnalysis.js";
import { getUserData, saveUserData } from "./persistence.js";
import { ChartTip, Toggles, VLookup, RawDataViewer, TweenNumber } from "./components/shared.jsx";
import { ProfileGate } from "./components/ProfileGate.jsx";
import { TourOverlay } from "./components/Tour.jsx";
import { Assistant } from "./components/Assistant.jsx";
import { AboutPage } from "./components/AboutPage.jsx";
import { Welcome } from "./components/Welcome.jsx";

const WELCOME_KEY = "siv_welcome_seen";
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [session, setSession] = useState(null); // {id, name, isGuest} | null
  const [dark, setDark] = useState(true);
  const [sideOpen, setSideOpen] = useState(true);
  const [page, setPage] = useState("home");
  const [vizTab, setVizTab] = useState("iv");
  const [chatOpen, setChatOpen] = useState(false);
  const [datasets, setDatasets] = useState([buildSampleDataset()]);
  const [activeDs, setActiveDs] = useState(0);
  const [selConds, setSelConds] = useState({});
  const [dragOver, setDragOver] = useState(false);
  const [sheetPicker, setSheetPicker] = useState(null);
  const [cellArea, setCellArea] = useState("");
  const [irradiance, setIrradiance] = useState("");
  const [lookupV, setLookupV] = useState(null);
  const [tourStep, setTourStep] = useState(-1);
  const [showWelcome, setShowWelcome] = useState(false);
  // True while onboarding a fresh account / demo session: closing the Welcome
  // then auto-launches the guided tour.
  const [autoTourPending, setAutoTourPending] = useState(false);
  const [importError, setImportError] = useState("");
  const [exportError, setExportError] = useState("");
  const [navPill, setNavPill] = useState(null); // {top, height} of the active nav item, in sidebar-local coords
  const fileRef = useRef(null);
  const navWrapRef = useRef(null);
  const navBtnRefs = useRef({});
  const ivReadout = useRef(null);
  const pvReadout = useRef(null);
  const t = mkT(dark);
  const ds = datasets[activeDs] || null;
  const isGuest = !session || session.isGuest;

  // Restore a named operator's saved library on login.
  useEffect(() => {
    if (session && !session.isGuest) {
      const ud = getUserData(session.id);
      if (ud.datasets && ud.datasets.length > 0) {
        const restored = ud.datasets.map((d) => ({
          name: d.name,
          conditions: d.conditions,
          ivData: d.ivData,
          diagnostics: d.diagnostics,
          source: d.source,
        }));
        if (restored.length > 0) setDatasets((prev) => prev.concat(restored));
      }
    }
  }, [session]);

  // Onboarding: pop the Welcome screen for every demo session and for named
  // operators who haven't finished the tour yet. Closing the Welcome then
  // auto-starts the guided tour (see closeWelcome).
  useEffect(() => {
    if (!session) return;
    const isNew = session.isGuest || !getUserData(session.id).tourDone;
    if (isNew) { setShowWelcome(true); setAutoTourPending(true); }
  }, [session]);

  // Persist a named operator's uploaded datasets (everything beyond the sample).
  useEffect(() => {
    if (session && !session.isGuest && datasets.length > 1) {
      const ud = getUserData(session.id);
      ud.datasets = datasets.slice(1).map((d) => ({
        name: d.name,
        conditions: d.conditions,
        ivData: d.ivData,
        diagnostics: d.diagnostics,
        source: d.source,
      }));
      saveUserData(session.id, ud);
    }
  }, [datasets, session]);

  useEffect(() => {
    if (ds) { const s = {}; ds.conditions.forEach((c) => (s[c] = true)); setSelConds(s); }
  }, [activeDs, datasets.length]);

  const allM = useMemo(() => {
    if (!ds) return {};
    const m = {};
    ds.conditions.forEach((c) => { const pts = ds.ivData[c]; if (pts) m[c] = calcMetrics(pts); });
    return m;
  }, [ds]);

  const activeConds = useMemo(() => (ds ? ds.conditions.filter((c) => selConds[c]) : []), [ds, selConds]);
  const radarConds = useMemo(() => activeConds.filter((condition) => {
    const metrics = allM[condition];
    return metrics &&
      metrics.quality !== "invalid" &&
      ["measured", "interpolated"].includes(metrics.status?.pmax) &&
      ["measured", "interpolated"].includes(metrics.status?.voc) &&
      metrics.status?.ff === "computed";
  }), [activeConds, allM]);

  // Auto-ranged SI display scales, picked from the dataset's largest current
  // and power magnitudes so µA-scale lab cells and A-scale production cells
  // both read naturally. One scale per dataset keeps every chart, table and
  // stat card in the same unit.
  const scales = useMemo(() => {
    let mi = 0, mp = 0;
    if (ds) ds.conditions.forEach((c) => (ds.ivData[c] || []).forEach((pt) => {
      const a = Math.abs(pt.rawCurrent); if (a > mi) mi = a;
      const w = Math.abs(pt.voltage * pt.rawCurrent); if (w > mp) mp = w;
    }));
    return { i: siPrefix(mi), p: siPrefix(mp) };
  }, [ds]);
  const iU = scales.i.prefix + "A"; // e.g. "µA"
  const pU = scales.p.prefix + "W"; // e.g. "µW"

  // I-V chart: signed current (dataset scale) → curve correctly crosses zero at Voc.
  const ivChart = useMemo(() => {
    return buildAlignedRows(ds, activeConds, (point) => point.rawCurrent / scales.i.div);
  }, [ds, activeConds, scales]);

  // P-V chart: signed power (dataset scale). Deep reverse-bias power is
  // truncated to null — past Voc the diode sinks power at magnitudes that
  // would otherwise dwarf the power quadrant, which is where the data lives.
  // The zero crossing at Voc plus a 20 % negative margin is kept visible.
  const pvChart = useMemo(() => {
    if (!ds) return [];
    let gmax = 0;
    activeConds.forEach((c) => (ds.ivData[c] || []).forEach((pt) => {
      const p = (pt.voltage * pt.rawCurrent) / scales.p.div;
      if (p > gmax) gmax = p;
    }));
    const cutoff = -0.2 * gmax;
    return buildAlignedRows(
      ds,
      activeConds,
      (point) => (point.voltage * point.rawCurrent) / scales.p.div
    ).map((sourceRow) => {
      const row = { ...sourceRow };
      activeConds.forEach((condition) => {
        if (Number.isFinite(row[condition]) && gmax > 0 && row[condition] < cutoff) row[condition] = null;
      });
      return row;
    });
  }, [ds, activeConds, scales]);

  // Skip line-draw animation on large sweeps — it costs more than it delights.
  const animate = ivChart.length <= 600;

  // Clamp the P-V y-domain: past Voc the diode sinks power and the large
  // negative values would squash the power quadrant — where the data lives —
  // into a sliver. Show a 25 % negative margin so the zero crossing stays
  // visible, and clip the rest.
  const pvDomain = useMemo(() => {
    let mx = 0;
    pvChart.forEach((r) => activeConds.forEach((c) => { if (r[c] > mx) mx = r[c]; }));
    return mx > 0 ? [-0.25 * mx, mx * 1.12] : ["auto", "auto"];
  }, [pvChart, activeConds]);

  // Aggregated per-condition data-quality flags from the analysis core.
  const qualityFlags = useMemo(() => {
    const out = [];
    if (!ds) return out;
    (ds.diagnostics?.warnings || []).forEach((w) => out.push({ c: "IMPORT", w, severity: "warning" }));
    ds.conditions.forEach((c) => {
      const m = allM[c];
      if (m && m.errors) m.errors.forEach((w) => out.push({ c, w, severity: "error" }));
      if (m && m.warnings) m.warnings.forEach((w) => out.push({ c, w, severity: "warning" }));
    });
    return out;
  }, [ds, allM]);

  // Live crosshair readout: written straight to the DOM to avoid re-rendering
  // the whole app on every mousemove over a chart.
  const onChartMove = useCallback((ref) => (st) => {
    if (ref.current) ref.current.textContent = st && st.activeLabel != null ? "V = " + Number(st.activeLabel).toFixed(3) + " V" : "";
  }, []);

  const radarD = useMemo(() => {
    if (!ds || !Object.keys(allM).length) return [];
    const mx = { isc: 0, voc: 0, pmax: 0, ff: 0 };
    radarConds.forEach((c) => {
      const m = allM[c];
      if (m) ["isc", "voc", "pmax", "ff"].forEach((k) => {
        if (Number.isFinite(m[k]) && m[k] > mx[k]) mx[k] = m[k];
      });
    });
    return ["Isc", "Voc", "Pmax", "FF"].map((label) => {
      const row = { metric: label };
      const k = label.toLowerCase();
      radarConds.forEach((c) => {
        const m = allM[c];
        if (m) row[c] = mx[k] > 0 && Number.isFinite(m[k]) ? (m[k] / mx[k]) * 100 : 0;
      });
      return row;
    });
  }, [ds, allM, radarConds]);

  const efficiency = useMemo(() => {
    if (!ds) return null;
    const r = {};
    let any = false;
    ds.conditions.forEach((c) => {
      const m = allM[c];
      if (m && m.quality !== "invalid" && ["measured", "interpolated"].includes(m.status?.pmax)) {
        const e = computeEfficiency(m.pmax, cellArea, irradiance);
        if (e != null) { r[c] = e; any = true; }
      }
    });
    return any ? r : null;
  }, [cellArea, irradiance, ds, allM]);

  const library = useMemo(() => datasets.slice(1).map((d, i) => ({ name: d.name, idx: i + 1, conditions: d.conditions.length })), [datasets]);

  const nav = useMemo(() => {
    const n = [
      { id: "home", I: Ic.Home, label: "Home" },
      { id: "viz", I: Ic.Chart, label: "Visualizations" },
      { id: "metrics", I: Ic.Bar3, label: "Metrics & Export" },
      { id: "upload", I: Ic.Upl, label: "Import Data" },
    ];
    if (!isGuest) n.push({ id: "library", I: Ic.Book, label: "Library" });
    n.push({ id: "about", I: Ic.Info, label: "About" });
    return n;
  }, [isGuest]);

  // Slide the active-nav highlight to the clicked item instead of having it
  // reappear in place — measured (not a fixed row height) so it stays correct
  // whether the sidebar is expanded or collapsed.
  useLayoutEffect(() => {
    const wrap = navWrapRef.current;
    const btn = navBtnRefs.current[page];
    if (!wrap || !btn) { setNavPill(null); return; }
    const wrapRect = wrap.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    setNavPill({ top: btnRect.top - wrapRect.top, height: btnRect.height });
  }, [page, sideOpen, nav]);

  const handleFile = useCallback(async (f) => {
    if (!f) return;
    setImportError("");
    if (f.size > MAX_IMPORT_BYTES) {
      setImportError(`"${f.name}" is larger than the 25 MB safety limit. Split very large workbooks into one sweep group per file.`);
      return;
    }
    const extension = f.name.toLowerCase().split(".").pop();
    if (extension !== "xlsx" && extension !== "csv") {
      setImportError(`Unsupported file type ".${extension || "unknown"}". Use .xlsx or .csv; legacy .xls is intentionally rejected.`);
      return;
    }
    try {
      const sh = {};
      if (extension === "csv") {
        sh.CSV = parseCsv(await f.text());
      } else {
        const sheets = await readExcelFile(f);
        sheets.forEach(({ sheet, data }) => { sh[sheet] = data; });
      }
      const valid = Object.keys(sh).filter((s) => { const d = extractIV(sh[s]); return d && d.conditions.length > 0; });
      if (!valid.length) { setImportError("No valid I-V data found in \"" + f.name + "\". Solavin expects voltage (V) in column A and one current sweep (A) per following column, with a header row."); return; }
      if (valid.length > 1) { setSheetPicker({ fileName: f.name, sheets: sh, valid }); return; }
      doLoad(f.name, sh, valid[0]);
    } catch (e) {
      setImportError("Could not read \"" + f.name + "\": " + e.message);
    }
  }, [datasets.length]);

  function doLoad(fn, sh, sn) {
    const parsed = extractIV(sh[sn]);
    if (!parsed) return;
    setDatasets((prev) => prev.concat([{
      name: fn.replace(/\.(xlsx|csv)$/i, "") + (sn ? " (" + sn + ")" : ""),
      conditions: parsed.conditions,
      ivData: parsed.ivData,
      diagnostics: parsed.diagnostics,
      source: { file: fn, sheet: sn },
    }]));
    setActiveDs(datasets.length);
    setSheetPicker(null);
    setPage("home");
  }

  function doExportCSV() {
    setExportError("");
    try {
      const efficiencyInputs = {
        cellAreaCm2: String(cellArea).trim() === "" ? NaN : Number(cellArea),
        irradianceWm2: String(irradiance).trim() === "" ? NaN : Number(irradiance),
      };
      const csv = rowsToCsv(metricsToRows(ds, allM, efficiency, efficiencyInputs));
      download(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }), "solavin_iv_metrics.csv");
    } catch (error) {
      setExportError("CSV export failed: " + error.message);
    }
  }
  async function doExportXLSX() {
    setExportError("");
    try {
      const efficiencyInputs = {
        cellAreaCm2: String(cellArea).trim() === "" ? NaN : Number(cellArea),
        irradianceWm2: String(irradiance).trim() === "" ? NaN : Number(irradiance),
      };
      const toSheetData = (rows) => rows.map((row, rowIndex) => row.map((value) => ({
        value,
        type: typeof value === "number" ? Number : String,
        fontWeight: rowIndex === 0 ? "bold" : undefined,
        backgroundColor: rowIndex === 0 ? "#E8F5F0" : undefined,
      })));
      await writeExcelFile([
        { sheet: "Metrics", data: toSheetData(metricsToRows(ds, allM, efficiency, efficiencyInputs)) },
        { sheet: "Raw Data", data: toSheetData(rawDataToRows(ds)) },
        { sheet: "Metadata", data: toSheetData(metadataToRows(ds, efficiencyInputs)) },
      ]).toFile("solavin_iv_analysis.xlsx");
    } catch (error) {
      setExportError("XLSX export failed: " + error.message);
    }
  }

  function dismissTour() {
    setTourStep(-1);
    if (session && !session.isGuest) { const ud = getUserData(session.id); ud.tourDone = true; saveUserData(session.id, ud); }
  }

  function closeWelcome() {
    setShowWelcome(false);
    try { localStorage.setItem(WELCOME_KEY, "1"); } catch { /* private-mode storage — nonfatal */ }
    // During onboarding, leaving the Welcome flows straight into the tour.
    if (autoTourPending) { setAutoTourPending(false); setChatOpen(false); setPage("home"); setTourStep(0); }
  }

  // Explicit "Begin guided tour" from the Welcome — start immediately.
  function startTour() {
    setAutoTourPending(false);
    setShowWelcome(false);
    setChatOpen(false);
    setPage("home");
    setTourStep(0);
  }

  if (!session) return <ProfileGate onEnter={setSession} />;

  const vizTabs = [{ id: "iv", label: "I-V" }, { id: "pv", label: "P-V" }, { id: "dual", label: "I-V + P-V" }, { id: "radar", label: "Radar" }, { id: "compare", label: "Compare" }];
  const curNav = nav.find((n) => n.id === page) || nav[0];

  return (
    <div style={{ display: "flex", height: "100vh", background: t.bg, color: t.text, overflow: "hidden" }}>
      {/* Sidebar */}
      <nav style={{ width: sideOpen ? 208 : 50, minWidth: sideOpen ? 208 : 50, background: t.sidebar, borderRight: "1px solid " + t.border, display: "flex", flexDirection: "column", transition: "width .3s cubic-bezier(.4,0,.2,1)", zIndex: 50 }}>
        <div style={{ padding: sideOpen ? "14px 14px 12px" : "14px 8px 12px", borderBottom: "1px solid " + t.border }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Logo s={sideOpen ? 32 : 26} />
            {sideOpen && <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: "-.01em" }}>Solavin</div>
              <div className="mono" style={{ fontSize: 8, color: t.textD, letterSpacing: ".18em", marginTop: 1 }}>v4.0.0</div>
            </div>}
          </div>
          {sideOpen && <div className="mono" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, padding: "5px 8px", borderRadius: 6, background: t.inputBg, border: "1px solid " + t.border, fontSize: 9, color: t.textM, letterSpacing: ".06em" }}>
            <span className="statusdot" /><span style={{ color: t.success, fontWeight: 600 }}>LOCAL</span><span style={{ marginLeft: "auto", color: t.textD }}>NO BACKEND</span>
          </div>}
        </div>
        {sideOpen && <div className="mono" style={{ padding: "10px 14px 4px", fontSize: 8, color: t.textD, letterSpacing: ".18em", fontWeight: 600 }}>NAVIGATION</div>}
        <div ref={navWrapRef} style={{ flex: 1, padding: "5px 6px", overflow: "auto", position: "relative" }}>
          {navPill && <div style={{ position: "absolute", left: 6, right: 6, top: 0, height: navPill.height, transform: "translateY(" + navPill.top + "px)", borderRadius: 7, background: t.accentS, transition: "transform var(--dur-base) var(--ease-fluid)", pointerEvents: "none" }}>
            <span style={{ position: "absolute", left: 0, top: "22%", bottom: "22%", width: 2, borderRadius: 2, background: t.accent, boxShadow: "0 0 8px " + t.accent }} />
          </div>}
          {nav.map((n) => {
            const a = page === n.id;
            return (
              <button key={n.id} ref={(el) => { navBtnRefs.current[n.id] = el; }} onClick={() => setPage(n.id)} title={n.label} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: sideOpen ? "8px 10px" : "8px 0", borderRadius: 7, border: "none", background: "transparent", color: a ? t.accent : t.textM, fontSize: 11.5, fontWeight: a ? 600 : 500, marginBottom: 1, justifyContent: sideOpen ? "flex-start" : "center", position: "relative", zIndex: 1, transition: "color var(--dur-fast) var(--ease-fluid)" }}>
                <n.I s={15} />{sideOpen && <span>{n.label}</span>}
                {sideOpen && n.id === "library" && library.length > 0 && <span className="mono" style={{ marginLeft: "auto", fontSize: 8, color: t.textD, padding: "1px 5px", borderRadius: 4, background: t.inputBg, border: "1px solid " + t.border }}>{library.length}</span>}
              </button>
            );
          })}
        </div>
        <div style={{ padding: "6px 6px 4px", borderTop: "1px solid " + t.border }}>
          {/* Filled gradient treatment so the assistant reads as a primary
              feature in the rail, not a muted afterthought. */}
          <button onClick={() => setChatOpen(!chatOpen)} className="press" style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: sideOpen ? "10px 12px" : "10px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg," + t.accent + "," + t.accent2 + ")", color: "#fff", fontSize: 11.5, fontWeight: 700, justifyContent: sideOpen ? "flex-start" : "center", boxShadow: chatOpen ? "0 0 0 1px " + t.accent + "55 inset" : "0 4px 16px " + t.accentG }}><Ic.Bot s={16} c="#fff" />{sideOpen && <span>Lab Assistant</span>}{sideOpen && <span className="mono" style={{ marginLeft: "auto", fontSize: 7.5, fontWeight: 700, letterSpacing: ".12em", padding: "2px 6px", borderRadius: 4, background: "rgba(255,255,255,.18)", color: "#fff" }}>LOCAL</span>}</button>
        </div>
        <button onClick={() => setSideOpen(!sideOpen)} className="mono" style={{ borderTop: "1px solid " + t.border, background: "none", border: "none", padding: "9px 10px", color: t.textD, display: "flex", alignItems: "center", justifyContent: sideOpen ? "space-between" : "center", gap: 5, fontSize: 9, width: "100%", letterSpacing: ".1em" }}>{sideOpen && <span>COLLAPSE</span>}<Ic.Chv s={12} st={{ transform: sideOpen ? "rotate(180deg)" : "none", transition: "transform .3s" }} /></button>
      </nav>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", marginRight: chatOpen ? 370 : 0, transition: "margin-right .35s cubic-bezier(.4,0,.2,1)" }}>
        <header style={{ padding: "10px 18px", borderBottom: "1px solid " + t.border, background: "linear-gradient(180deg," + t.card + "," + t.cardAlt + ")", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, position: "relative" }}>
          <div style={{ position: "absolute", bottom: -1, left: 0, right: 0, height: 1, background: "linear-gradient(90deg,transparent," + t.accent + "33 30%," + t.accent2 + "22 70%,transparent)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="mono" style={{ fontSize: 9, color: t.textD, letterSpacing: ".18em", fontWeight: 600 }}>{page === "viz" ? "02 / VISUALIZATIONS" : page === "home" ? "01 / DASHBOARD" : page === "metrics" ? "03 / METRICS" : page === "upload" ? "04 / IMPORT" : page === "library" ? "05 / LIBRARY" : "06 / ABOUT"}</div>
            <div style={{ width: 1, height: 14, background: t.border }} />
            <h1 style={{ fontSize: 14, fontWeight: 700, margin: 0, letterSpacing: "-.01em" }}>{page === "viz" ? "Visualizations" : curNav.label}</h1>
            {ds && page !== "upload" && page !== "about" && <>
              <div style={{ width: 1, height: 14, background: t.border }} />
              <div className="mono" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: t.textM }}><span className="statusdot" /><span>{ds.name}</span><span style={{ color: t.textD }}>· {ds.conditions.length}ch</span></div>
            </>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={startTour} title="Replay the guided tour" className="mono" style={{ background: "linear-gradient(135deg," + t.accent + "22," + t.accent2 + "15)", border: "1px solid " + t.accent + "55", borderRadius: 7, padding: "5px 11px", color: t.accent, fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", lineHeight: "12px", display: "flex", alignItems: "center", gap: 5 }}><Ic.Play s={10} />TOUR</button>
            <button onClick={() => setShowWelcome(true)} title="What is Solavin? Orientation & guided tour" className="mono" style={{ background: t.inputBg, border: "1px solid " + t.border, borderRadius: 7, padding: "5px 10px", color: t.accent, fontSize: 11, fontWeight: 700, lineHeight: "12px" }}>?</button>
            <button onClick={() => setDark(!dark)} title={dark ? "Light mode" : "Dark mode"} style={{ background: t.inputBg, border: "1px solid " + t.border, borderRadius: 7, padding: "5px 9px", color: t.text, fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}>{dark ? <Ic.Sun s={12} /> : <Ic.Moon s={12} />}</button>
            <div style={{ padding: "5px 10px", borderRadius: 7, background: t.inputBg, border: "1px solid " + t.border, fontSize: 10, color: t.text, display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 18, height: 18, borderRadius: 5, background: "linear-gradient(135deg," + t.accent + "," + t.accent2 + ")", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff" }}>{(isGuest ? "G" : session.name.charAt(0)).toUpperCase()}</div>
              <span style={{ fontWeight: 500 }}>{isGuest ? "Guest" : session.name}</span>
            </div>
            <button onClick={() => setSession(null)} title="Sign out" style={{ background: "none", border: "1px solid " + t.border, borderRadius: 7, padding: 5, color: t.textM }}><Ic.Out s={12} /></button>
          </div>
        </header>

        {page === "viz" && <div style={{ display: "flex", gap: 4, padding: "8px 18px", borderBottom: "1px solid " + t.border, background: t.cardAlt, flexShrink: 0, alignItems: "center" }}>
          <span className="mono" style={{ fontSize: 8, color: t.textD, letterSpacing: ".18em", fontWeight: 600, marginRight: 6 }}>VIEW ▸</span>
          {vizTabs.map((vt) => { const a = vizTab === vt.id; return <button key={vt.id} onClick={() => setVizTab(vt.id)} style={{ padding: "5px 14px", borderRadius: 6, border: "1px solid " + (a ? t.accent + "55" : "transparent"), background: a ? "linear-gradient(135deg," + t.accent + "22," + t.accent2 + "15)" : "transparent", color: a ? t.accent : t.textM, fontSize: 10.5, fontWeight: a ? 600 : 500, transition: "background var(--dur-base) var(--ease-fluid), border-color var(--dur-base) var(--ease-fluid), color var(--dur-fast) var(--ease-fluid)" }}>{vt.label}</button>; })}
        </div>}

        <main style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {/* HOME — first-time users get the animated orientation panel (Welcome)
              on load instead of an inline banner; it can be reopened via the ? in
              the header. */}
          {page === "home" && ds && <div className="fadein">

            <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div className="mono" style={{ fontSize: 9, color: t.textD, letterSpacing: ".18em", fontWeight: 600, marginBottom: 6 }}>SESSION ▸ {new Date().toISOString().slice(0, 10)}</div>
                <h2 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.03em", marginBottom: 5, lineHeight: 1.1 }}><span style={{ background: t.grad, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>Measurement Dashboard</span></h2>
                <p style={{ fontSize: 12, color: t.textM }}>{ds.name} · {ds.conditions.length} conditions · {Math.min(...ds.conditions.map((c) => (ds.ivData[c] || []).length))}–{Math.max(...ds.conditions.map((c) => (ds.ivData[c] || []).length))} valid points/channel</p>
              </div>
              <div className="mono" style={{ display: "flex", gap: 8, fontSize: 9, color: t.textM, letterSpacing: ".06em" }}>
                <div style={{ padding: "6px 12px", borderRadius: 6, background: t.card, border: "1px solid " + t.border }}><div style={{ color: t.textD, fontSize: 8 }}>CONVENTION</div><div style={{ color: t.text, fontWeight: 600, marginTop: 2 }}>GENERATOR · SIGNED I</div></div>
                <div title={qualityFlags.length ? qualityFlags.map((f) => f.c + ": " + f.w).join("\n") : "All automated checks passed"} style={{ padding: "6px 12px", borderRadius: 6, background: t.card, border: "1px solid " + t.border, cursor: qualityFlags.length ? "help" : "default" }}><div style={{ color: t.textD, fontSize: 8 }}>AUTOMATED CHECKS</div><div style={{ color: qualityFlags.some((f) => f.severity === "error") ? t.danger : qualityFlags.length ? t.warn : t.success, fontWeight: 600, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>{qualityFlags.length ? "⚠ " + qualityFlags.length + " FLAG" + (qualityFlags.length > 1 ? "S" : "") : <><span className="statusdot" />PASSED</>}</div></div>
              </div>
            </div>

            {/* Best-of stat cards */}
            <div data-tour="stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10, marginBottom: 18 }}>
              {(() => {
                const eligible = (m, key) => {
                  if (!m || m.quality === "invalid" || !Number.isFinite(m[key])) return false;
                  if (key === "voc") return m.status?.voc === "measured" || m.status?.voc === "interpolated";
                  if (key === "pmax") return m.status?.pmax === "measured" || m.status?.pmax === "interpolated";
                  if (key === "ff") return m.status?.ff === "computed";
                  return true;
                };
                const bestOf = (key) => {
                  let best = null;
                  ds.conditions.forEach((condition) => {
                    const metrics = allM[condition];
                    if (eligible(metrics, key) && (!best || metrics[key] > best.value)) {
                      best = { condition, value: metrics[key] };
                    }
                  });
                  return best;
                };
                const bp = bestOf("pmax");
                const bi = bestOf("isc");
                const bv = bestOf("voc");
                const bf = bestOf("ff");
                return [
                  { l: "P_max", sub: "Maximum power", v: bp ? bp.value / scales.p.div : NaN, d: 3, unit: pU, c: dark ? "#fbbf24" : "#b45309", IC: Ic.Up, best: bp?.condition },
                  { l: "I_sc", sub: "Short-circuit current", v: bi ? bi.value / scales.i.div : NaN, d: 3, unit: iU, c: dark ? "#22d3ee" : "#0891b2", IC: Ic.Act, best: bi?.condition },
                  { l: "V_oc", sub: "Open-circuit voltage", v: bv ? bv.value : NaN, d: 3, unit: "V", c: dark ? "#38bdf8" : "#0284c7", IC: Ic.Target, best: bv?.condition },
                  { l: "FF", sub: "Fill factor", v: bf ? bf.value * 100 : NaN, d: 1, unit: "%", c: dark ? "#a78bfa" : "#7c3aed", IC: Ic.Rad, best: bf?.condition },
                ].map((s, i) => (
                  <div key={s.l} className="card-glow lift corners" style={{ background: "linear-gradient(180deg," + t.card + "," + t.cardAlt + ")", borderRadius: 10, border: "1px solid " + t.border, padding: "14px 16px", position: "relative", overflow: "hidden", animation: "slideup .4s cubic-bezier(.4,0,.2,1) " + i * 0.06 + "s both" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg,transparent," + s.c + "66 30%," + s.c + " 50%," + s.c + "66 70%,transparent)", opacity: 0.6 }} />
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
                      <div>
                        <div className="mono" style={{ fontSize: 9, color: t.textM, letterSpacing: ".16em", fontWeight: 700 }}>BEST {s.l.toUpperCase()}</div>
                        <div style={{ fontSize: 11, color: t.text, marginTop: 2, fontWeight: 500 }}>{s.sub}</div>
                      </div>
                      <div style={{ width: 28, height: 28, borderRadius: 7, background: s.c + "15", border: "1px solid " + s.c + "33", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><s.IC s={13} c={s.c} /></div>
                    </div>
                    <div className="tnum" style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                      <span className="mono" style={{ fontSize: 22, fontWeight: 700, color: t.text, letterSpacing: "-.02em" }}><TweenNumber value={s.v} decimals={s.d} /></span>
                      <span className="mono" style={{ fontSize: 11, color: s.c, fontWeight: 700 }}>{s.unit}</span>
                    </div>
                    <div className="mono" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid " + t.border, fontSize: 9, color: t.textD, display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 5, height: 5, borderRadius: 3, background: s.c }} /><span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.best || "No valid channel"}</span>
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* I-V overview with MPP */}
            <div data-tour="iv-overview" className="corners" style={{ background: "linear-gradient(180deg," + t.card + "," + t.cardAlt + ")", borderRadius: 10, border: "1px solid " + t.border, padding: "16px 14px 8px 0", marginBottom: 14, position: "relative", overflow: "hidden" }}>
              <div className="scanline" />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 18, marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}><Ic.Chart s={14} c={t.accent} /><span style={{ fontWeight: 700, fontSize: 12 }}>I-V Sweep Overview</span></div>
                  <div className="mono" style={{ padding: "2px 7px", borderRadius: 4, background: t.accentS, border: "1px solid " + t.accent + "33", fontSize: 8, color: t.accent, fontWeight: 600, letterSpacing: ".1em" }}>MPP OVERLAY</div>
                </div>
                <button onClick={() => { setPage("viz"); setVizTab("iv"); }} className="mono" style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid " + t.border, background: "none", color: t.accent, fontSize: 9, fontWeight: 600, letterSpacing: ".06em", display: "flex", alignItems: "center", gap: 4 }}>OPEN FULL VIEW <Ic.Arrow s={10} /></button>
              </div>
              <ResponsiveContainer width="100%" height={220}><LineChart data={ivChart} margin={{ top: 10, right: 20, bottom: 24, left: 36 }}>
                <CartesianGrid strokeDasharray="2 4" stroke={t.border} strokeOpacity={0.5} />
                <XAxis dataKey="voltage" type="number" tick={{ fill: t.textM, fontSize: 9 }} stroke={t.borderS} label={{ value: "VOLTAGE (V)", position: "bottom", offset: 6, fill: t.textD, fontSize: 8, letterSpacing: "0.18em" }} />
                <YAxis tick={{ fill: t.textM, fontSize: 9 }} stroke={t.borderS} label={{ value: "CURRENT (" + iU + ")", angle: -90, position: "insideLeft", offset: 0, fill: t.textD, fontSize: 8, letterSpacing: "0.18em", style: { textAnchor: "middle" } }} />
                <RTooltip content={<ChartTip unit={iU} t={t} />} />
                <ReferenceLine y={0} stroke={t.textD} strokeDasharray="3 3" strokeOpacity={0.5} />
                {ds.conditions.slice(0, 4).map((c, ci) => <Line key={c} type="linear" dataKey={c} connectNulls stroke={C8[ci % C8.length]} strokeWidth={1.6} dot={false} isAnimationActive={animate} animationDuration={900} animationEasing="ease-out" />)}
                {ds.conditions.slice(0, 4).map((c, ci) => { const m = allM[c]; if (!m || !["measured", "interpolated", "provisional"].includes(m.status?.pmax)) return null; return <ReferenceDot key={"m" + c} x={m.vmp} y={m.imp / scales.i.div} r={3.5} fill={C8[ci % C8.length]} stroke="#fff" strokeWidth={1.5} />; })}
              </LineChart></ResponsiveContainer>
            </div>

            <div data-tour="raw-table"><RawDataViewer t={t} ds={ds} /></div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8, marginTop: 14 }}>
              {[{ l: "Visualizations", d: "I-V · P-V · Radar", ic: Ic.Chart, go: () => setPage("viz") }, { l: "Metrics & Export", d: "Parameters · CSV/XLSX", ic: Ic.Bar3, go: () => setPage("metrics") }, { l: "Import Data", d: "Upload .xlsx · .csv", ic: Ic.Upl, go: () => setPage("upload") }, { l: "Lab Assistant", d: "Auto-analyze dataset", ic: Ic.Bot, go: () => setChatOpen(true) }].map((a, i) => (
                <button key={i} onClick={a.go} className="lift" style={{ background: t.card, border: "1px solid " + t.border, borderRadius: 9, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, color: t.text, fontSize: 11, fontWeight: 500, textAlign: "left" }}>
                  <div style={{ width: 30, height: 30, borderRadius: 7, background: t.accentS, border: "1px solid " + t.accent + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><a.ic s={14} c={t.accent} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600 }}>{a.l}</div><div style={{ fontSize: 9, color: t.textM, marginTop: 1 }}>{a.d}</div></div>
                  <Ic.Arrow s={12} c={t.textD} />
                </button>
              ))}
            </div>
          </div>}

          {/* VIZ */}
          {page === "viz" && ds && <div className="fadein">
            <div data-tour="channels" style={{ background: t.card, borderRadius: 9, border: "1px solid " + t.border, padding: "12px 14px", marginBottom: 10 }}>
              <div className="mono" style={{ fontSize: 8, color: t.textD, letterSpacing: ".18em", fontWeight: 600, marginBottom: 8 }}>CHANNEL SELECTION</div>
              <Toggles conds={ds.conditions} sel={selConds} setSel={setSelConds} t={t} />
            </div>
            <div data-tour="vlookup" style={{ background: t.card, borderRadius: 9, border: "1px solid " + t.border, padding: "12px 14px", marginBottom: 10 }}>
              <div className="mono" style={{ fontSize: 8, color: t.textD, letterSpacing: ".18em", fontWeight: 600, marginBottom: 8 }}>CURSOR · VOLTAGE LOOKUP</div>
              <VLookup t={t} ds={ds} iSc={scales.i} onLookup={setLookupV} />
            </div>

            {vizTab === "iv" && <div data-tour="iv-chart" className="corners viewfade" style={{ background: "linear-gradient(180deg," + t.card + "," + t.cardAlt + ")", borderRadius: 10, border: "1px solid " + t.border, padding: "16px 14px 8px 0", position: "relative", overflow: "hidden" }}>
              <div className="scanline" />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 18, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Ic.Chart s={13} c={t.accent} /><span style={{ fontWeight: 700, fontSize: 12 }}>Current vs. Voltage</span><span className="mono" style={{ padding: "2px 7px", borderRadius: 4, background: t.accentS, border: "1px solid " + t.accent + "33", fontSize: 8, color: t.accent, fontWeight: 600, letterSpacing: ".1em" }}>I = f(V)</span></div>
                <div className="mono" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 9, color: t.textD, letterSpacing: ".06em" }}><span ref={ivReadout} style={{ color: t.accent, fontWeight: 600, minWidth: 76, textAlign: "right" }} /><span>{activeConds.length} ACTIVE · {ivChart.length} PTS</span></div>
              </div>
              <ResponsiveContainer width="100%" height={400}><LineChart data={ivChart} margin={{ top: 10, right: 24, bottom: 30, left: 42 }} onMouseMove={onChartMove(ivReadout)} onMouseLeave={onChartMove(ivReadout)}>
                <CartesianGrid strokeDasharray="2 4" stroke={t.border} strokeOpacity={0.5} />
                <XAxis dataKey="voltage" type="number" tick={{ fill: t.textM, fontSize: 9 }} label={{ value: "VOLTAGE (V)", position: "bottom", offset: 6, fill: t.textD, fontSize: 8, letterSpacing: "0.18em" }} stroke={t.borderS} />
                <YAxis tick={{ fill: t.textM, fontSize: 9 }} label={{ value: "CURRENT (" + iU + ")", angle: -90, position: "insideLeft", offset: 0, fill: t.textD, fontSize: 8, letterSpacing: "0.18em", style: { textAnchor: "middle" } }} stroke={t.borderS} />
                <RTooltip content={<ChartTip unit={iU} t={t} />} />
                <ReferenceLine y={0} stroke={t.textD} strokeDasharray="3 3" strokeOpacity={0.5} />
                {activeConds.map((c) => <Line key={c} type="linear" dataKey={c} connectNulls stroke={C8[ds.conditions.indexOf(c) % C8.length]} strokeWidth={1.6} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={animate} animationDuration={900} animationEasing="ease-out" />)}
                {activeConds.map((c) => { const m = allM[c]; if (!m) return null; return <ReferenceLine key={"vmp" + c} x={m.vmp} stroke={C8[ds.conditions.indexOf(c) % C8.length]} strokeDasharray="3 3" strokeOpacity={0.4} />; })}
                {/* Annotated extraction markers: MPP on the curve, Voc at I=0, Isc at V=0 */}
                {activeConds.map((c) => { const m = allM[c]; if (!m || !["measured", "interpolated", "provisional"].includes(m.status?.pmax)) return null; const col = C8[ds.conditions.indexOf(c) % C8.length]; return <ReferenceDot key={"mpp" + c} x={m.vmp} y={m.imp / scales.i.div} r={4} fill={col} stroke="#fff" strokeWidth={1.5} ifOverflow="discard" label={activeConds.length <= 3 ? { value: "MPP", position: "top", fill: col, fontSize: 8, fontWeight: 700 } : undefined} />; })}
                {activeConds.map((c) => { const m = allM[c]; if (!m || m.voc == null || m.notes.vocBeyondRange) return null; const col = C8[ds.conditions.indexOf(c) % C8.length]; return <ReferenceDot key={"voc" + c} x={m.voc} y={0} r={3} fill={t.card} stroke={col} strokeWidth={1.5} ifOverflow="discard" label={activeConds.length <= 3 ? { value: "Voc", position: "bottom", fill: t.textM, fontSize: 8 } : undefined} />; })}
                {activeConds.map((c) => { const m = allM[c]; if (!m || !Number.isFinite(m.isc)) return null; const col = C8[ds.conditions.indexOf(c) % C8.length]; return <ReferenceDot key={"isc" + c} x={0} y={m.isc / scales.i.div} r={3} fill={t.card} stroke={col} strokeWidth={1.5} ifOverflow="discard" label={activeConds.length <= 3 ? { value: "Isc", position: "left", fill: t.textM, fontSize: 8 } : undefined} />; })}
                {lookupV != null && <ReferenceLine x={lookupV} stroke={t.warn} strokeWidth={1.5} strokeDasharray="6 3" label={{ value: "V = " + lookupV.toFixed(3), fill: t.warn, fontSize: 9, position: "top" }} />}
                <Brush dataKey="voltage" height={24} stroke={t.accent} fill={t.cardAlt} travellerWidth={8} />
              </LineChart></ResponsiveContainer>
            </div>}

            {vizTab === "pv" && <div data-tour="pv-chart" className="corners viewfade" style={{ background: "linear-gradient(180deg," + t.card + "," + t.cardAlt + ")", borderRadius: 10, border: "1px solid " + t.border, padding: "16px 14px 8px 0", position: "relative", overflow: "hidden" }}>
              <div className="scanline" />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 18, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Ic.Chart s={13} c={t.accent} /><span style={{ fontWeight: 700, fontSize: 12 }}>Power vs. Voltage</span><span className="mono" style={{ padding: "2px 7px", borderRadius: 4, background: t.accentS, border: "1px solid " + t.accent + "33", fontSize: 8, color: t.accent, fontWeight: 600, letterSpacing: ".1em" }}>P = V·I</span></div>
                <div className="mono" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 9, color: t.textD, letterSpacing: ".06em" }}><span ref={pvReadout} style={{ color: t.accent, fontWeight: 600, minWidth: 76, textAlign: "right" }} /><span>MPP MARKERS</span></div>
              </div>
              <ResponsiveContainer width="100%" height={400}><AreaChart data={pvChart} margin={{ top: 10, right: 24, bottom: 24, left: 42 }} onMouseMove={onChartMove(pvReadout)} onMouseLeave={onChartMove(pvReadout)}>
                <defs>{C8.map((col, i) => <linearGradient key={i} id={"pvg" + i} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity={0.12} /><stop offset="100%" stopColor={col} stopOpacity={0} /></linearGradient>)}</defs>
                <CartesianGrid strokeDasharray="2 4" stroke={t.border} strokeOpacity={0.5} /><XAxis dataKey="voltage" type="number" tick={{ fill: t.textM, fontSize: 9 }} label={{ value: "VOLTAGE (V)", position: "bottom", offset: 6, fill: t.textD, fontSize: 8, letterSpacing: "0.18em" }} stroke={t.borderS} /><YAxis domain={pvDomain} allowDataOverflow tickFormatter={(v) => +Number(v).toFixed(2)} tick={{ fill: t.textM, fontSize: 9 }} label={{ value: "POWER (" + pU + ")", angle: -90, position: "insideLeft", offset: 0, fill: t.textD, fontSize: 8, letterSpacing: "0.18em", style: { textAnchor: "middle" } }} stroke={t.borderS} /><RTooltip content={<ChartTip unit={pU} t={t} />} />
                <ReferenceLine y={0} stroke={t.textD} strokeDasharray="3 3" strokeOpacity={0.5} />
                {activeConds.map((c) => { const ci = ds.conditions.indexOf(c); const col = C8[ci % C8.length]; return <Area key={c} type="linear" dataKey={c} connectNulls stroke={col} fill={"url(#pvg" + ci + ")"} strokeWidth={1.6} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={animate} animationDuration={900} animationEasing="ease-out" />; })}
                {activeConds.map((c) => { const m = allM[c]; if (!m || !["measured", "interpolated", "provisional"].includes(m.status?.pmax)) return null; return <ReferenceDot key={"p" + c} x={m.vmp} y={m.pmax / scales.p.div} r={5} fill={C8[ds.conditions.indexOf(c) % C8.length]} stroke="#fff" strokeWidth={2} ifOverflow="discard" label={activeConds.length <= 3 ? { value: "Pmax", position: "top", fill: C8[ds.conditions.indexOf(c) % C8.length], fontSize: 8, fontWeight: 700 } : undefined} />; })}
                {lookupV != null && <ReferenceLine x={lookupV} stroke={t.warn} strokeWidth={1.5} strokeDasharray="6 3" />}
              </AreaChart></ResponsiveContainer></div>}

            {/* Dual view: I-V and P-V stacked with a synced crosshair — hovering
                either chart drives the tooltip and active dots on both. */}
            {vizTab === "dual" && <div data-tour="dual-chart" className="corners viewfade" style={{ background: "linear-gradient(180deg," + t.card + "," + t.cardAlt + ")", borderRadius: 10, border: "1px solid " + t.border, padding: "16px 14px 8px 0", position: "relative", overflow: "hidden" }}>
              <div className="scanline" />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 18, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Ic.Chart s={13} c={t.accent} /><span style={{ fontWeight: 700, fontSize: 12 }}>I-V + P-V · Synced Crosshair</span><span className="mono" style={{ padding: "2px 7px", borderRadius: 4, background: t.accentS, border: "1px solid " + t.accent + "33", fontSize: 8, color: t.accent, fontWeight: 600, letterSpacing: ".1em" }}>LINKED CURSOR</span></div>
                <div className="mono" style={{ fontSize: 9, color: t.textD, letterSpacing: ".06em" }}>HOVER EITHER PLOT</div>
              </div>
              <ResponsiveContainer width="100%" height={250}><LineChart data={ivChart} syncId="sweep" margin={{ top: 6, right: 24, bottom: 4, left: 42 }}>
                <CartesianGrid strokeDasharray="2 4" stroke={t.border} strokeOpacity={0.5} />
                <XAxis dataKey="voltage" type="number" tick={{ fill: t.textM, fontSize: 9 }} stroke={t.borderS} />
                <YAxis tick={{ fill: t.textM, fontSize: 9 }} label={{ value: "I (" + iU + ")", angle: -90, position: "insideLeft", offset: 8, fill: t.textD, fontSize: 8, letterSpacing: "0.14em", style: { textAnchor: "middle" } }} stroke={t.borderS} />
                <RTooltip content={<ChartTip unit={iU} t={t} />} />
                <ReferenceLine y={0} stroke={t.textD} strokeDasharray="3 3" strokeOpacity={0.5} />
                {activeConds.map((c) => <Line key={c} type="linear" dataKey={c} connectNulls stroke={C8[ds.conditions.indexOf(c) % C8.length]} strokeWidth={1.6} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={animate} animationDuration={700} animationEasing="ease-out" />)}
                {activeConds.map((c) => { const m = allM[c]; if (!m || !["measured", "interpolated", "provisional"].includes(m.status?.pmax)) return null; return <ReferenceDot key={"mpp" + c} x={m.vmp} y={m.imp / scales.i.div} r={3.5} fill={C8[ds.conditions.indexOf(c) % C8.length]} stroke="#fff" strokeWidth={1.5} ifOverflow="discard" />; })}
              </LineChart></ResponsiveContainer>
              <ResponsiveContainer width="100%" height={250}><AreaChart data={pvChart} syncId="sweep" margin={{ top: 6, right: 24, bottom: 24, left: 42 }}>
                <defs>{C8.map((col, i) => <linearGradient key={i} id={"dvg" + i} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity={0.12} /><stop offset="100%" stopColor={col} stopOpacity={0} /></linearGradient>)}</defs>
                <CartesianGrid strokeDasharray="2 4" stroke={t.border} strokeOpacity={0.5} />
                <XAxis dataKey="voltage" type="number" tick={{ fill: t.textM, fontSize: 9 }} label={{ value: "VOLTAGE (V)", position: "bottom", offset: 6, fill: t.textD, fontSize: 8, letterSpacing: "0.18em" }} stroke={t.borderS} />
                <YAxis domain={pvDomain} allowDataOverflow tickFormatter={(v) => +Number(v).toFixed(2)} tick={{ fill: t.textM, fontSize: 9 }} label={{ value: "P (" + pU + ")", angle: -90, position: "insideLeft", offset: 8, fill: t.textD, fontSize: 8, letterSpacing: "0.14em", style: { textAnchor: "middle" } }} stroke={t.borderS} />
                <RTooltip content={<ChartTip unit={pU} t={t} />} />
                <ReferenceLine y={0} stroke={t.textD} strokeDasharray="3 3" strokeOpacity={0.5} />
                {activeConds.map((c) => { const ci = ds.conditions.indexOf(c); const col = C8[ci % C8.length]; return <Area key={c} type="linear" dataKey={c} connectNulls stroke={col} fill={"url(#dvg" + ci + ")"} strokeWidth={1.6} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={animate} animationDuration={700} animationEasing="ease-out" />; })}
                {activeConds.map((c) => { const m = allM[c]; if (!m || !["measured", "interpolated", "provisional"].includes(m.status?.pmax)) return null; return <ReferenceDot key={"p" + c} x={m.vmp} y={m.pmax / scales.p.div} r={4} fill={C8[ds.conditions.indexOf(c) % C8.length]} stroke="#fff" strokeWidth={1.5} ifOverflow="discard" />; })}
              </AreaChart></ResponsiveContainer>
            </div>}

            {vizTab === "radar" && <div data-tour="radar-chart" className="corners viewfade" style={{ background: "linear-gradient(180deg," + t.card + "," + t.cardAlt + ")", borderRadius: 10, border: "1px solid " + t.border, padding: "16px 14px 14px", position: "relative", overflow: "hidden" }}>
              <div className="scanline" />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Ic.Rad s={13} c={t.accent} /><span style={{ fontWeight: 700, fontSize: 12 }}>Performance Profile</span><span className="mono" style={{ padding: "2px 7px", borderRadius: 4, background: t.accentS, border: "1px solid " + t.accent + "33", fontSize: 8, color: t.accent, fontWeight: 600, letterSpacing: ".1em" }}>NORMALIZED</span></div>
                <div className="mono" style={{ fontSize: 9, color: t.textD, letterSpacing: ".06em" }}>{radarConds.length} COMPLETE CHANNEL{radarConds.length === 1 ? "" : "S"} · 0 → 100% RELATIVE</div>
              </div>
              {radarConds.length > 0
                ? <ResponsiveContainer width="100%" height={400}><RadarChart data={radarD}><PolarGrid stroke={t.border} strokeOpacity={0.4} /><PolarAngleAxis dataKey="metric" tick={{ fill: t.textM, fontSize: 11, fontWeight: 600 }} /><PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: t.textD, fontSize: 8 }} /><RTooltip contentStyle={{ background: t.card, border: "1px solid " + t.border, borderRadius: 8, fontSize: 10 }} itemStyle={{ color: t.text, fontWeight: 600 }} labelStyle={{ color: t.textM, fontWeight: 600 }} />{radarConds.map((c) => { const ci = ds.conditions.indexOf(c); return <Radar key={c} name={c} dataKey={c} stroke={C8[ci % C8.length]} fill={C8[ci % C8.length]} fillOpacity={0.08} strokeWidth={1.5} animationDuration={1000} />; })}</RadarChart></ResponsiveContainer>
                : <div style={{ height: 400, display: "flex", alignItems: "center", justifyContent: "center", color: t.textM, fontSize: 11, textAlign: "center", padding: 24 }}>No active channel has complete reportable Isc, Voc, Pmax, and FF values.<br />Review sweep coverage and data-quality flags.</div>}
            </div>}

            {vizTab === "compare" && (() => {
              const bd = activeConds.map((c) => {
                const m = allM[c];
                if (!m || m.quality === "invalid" || !["measured", "interpolated"].includes(m.status?.pmax)) return null;
                return { name: c, Pmax: m.pmax / scales.p.div, color: C8[ds.conditions.indexOf(c) % C8.length] };
              }).filter(Boolean).sort((a, b) => b.Pmax - a.Pmax);
              return <div className="corners viewfade" style={{ background: "linear-gradient(180deg," + t.card + "," + t.cardAlt + ")", borderRadius: 10, border: "1px solid " + t.border, padding: "16px 14px 8px 0", position: "relative", overflow: "hidden" }}>
                <div className="scanline" />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 18, marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Ic.Bar3 s={13} c={t.accent} /><span style={{ fontWeight: 700, fontSize: 12 }}>P_max Comparison</span></div>
                  <div className="mono" style={{ fontSize: 9, color: t.textD, letterSpacing: ".06em" }}>VALID CHANNELS · DESC</div>
                </div>
                <ResponsiveContainer width="100%" height={320}><BarChart data={bd} margin={{ top: 14, right: 24, bottom: 36, left: 30 }}><CartesianGrid strokeDasharray="2 4" stroke={t.border} strokeOpacity={0.5} /><XAxis dataKey="name" tick={{ fill: t.textM, fontSize: 9 }} angle={-14} textAnchor="end" stroke={t.borderS} /><YAxis tick={{ fill: t.textM, fontSize: 9 }} label={{ value: "PMAX (" + pU + ")", angle: -90, position: "insideLeft", offset: 0, fill: t.textD, fontSize: 8, letterSpacing: "0.18em", style: { textAnchor: "middle" } }} stroke={t.borderS} /><RTooltip cursor={{ fill: t.accent, fillOpacity: 0.08 }} contentStyle={{ background: t.card, border: "1px solid " + t.border, borderRadius: 8, fontSize: 10 }} itemStyle={{ color: t.text, fontWeight: 600 }} labelStyle={{ color: t.textM, fontWeight: 600 }} /><Bar dataKey="Pmax" name={"Pmax (" + pU + ")"} radius={[6, 6, 0, 0]} animationDuration={900} animationEasing="ease-out">{bd.map((e, i) => <Cell key={i} fill={e.color} />)}</Bar></BarChart></ResponsiveContainer>
              </div>;
            })()}
          </div>}

          {/* METRICS */}
          {page === "metrics" && ds && <div className="fadein">
            <div data-tour="eff-calc" className="corners" style={{ background: "linear-gradient(180deg," + t.card + "," + t.cardAlt + ")", borderRadius: 10, border: "1px solid " + t.border, padding: "14px 18px", marginBottom: 12, position: "relative" }}>
              <div className="mono" style={{ fontSize: 8, color: t.textD, letterSpacing: ".18em", fontWeight: 600, marginBottom: 10 }}>EFFICIENCY CALCULATOR · η = P_max / (G · A)</div>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div><label style={{ fontSize: 9, color: t.textM, display: "block", marginBottom: 5, textTransform: "uppercase", letterSpacing: ".12em", fontWeight: 600 }}>Cell Area</label><div style={{ position: "relative" }}><input value={cellArea} onChange={(e) => setCellArea(e.target.value)} type="number" step="0.001" placeholder="0.01" className="mono" style={{ width: 130, padding: "8px 38px 8px 12px", borderRadius: 7, border: "1px solid " + t.border, background: t.inputBg, color: t.text, fontSize: 11, outline: "none" }} /><span className="mono" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 9, color: t.textD }}>cm²</span></div></div>
                <div><label style={{ fontSize: 9, color: t.textM, display: "block", marginBottom: 5, textTransform: "uppercase", letterSpacing: ".12em", fontWeight: 600 }}>Irradiance</label><div style={{ position: "relative" }}><input value={irradiance} onChange={(e) => setIrradiance(e.target.value)} type="number" step="1" placeholder="1000" className="mono" style={{ width: 130, padding: "8px 38px 8px 12px", borderRadius: 7, border: "1px solid " + t.border, background: t.inputBg, color: t.text, fontSize: 11, outline: "none" }} /><span className="mono" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 9, color: t.textD }}>W/m²</span></div></div>
                <div style={{ flex: 1 }} />
                <div data-tour="export-btns" style={{ display: "flex", gap: 6 }}>
                  <button onClick={doExportCSV} className="lift press" style={{ padding: "8px 14px", borderRadius: 7, border: "1px solid " + t.border, background: t.card, color: t.text, fontSize: 10.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, letterSpacing: ".06em" }}><Ic.Dl s={12} c={t.accent} />EXPORT CSV</button>
                  <button onClick={doExportXLSX} className="lift press" style={{ padding: "8px 14px", borderRadius: 7, border: "none", background: "linear-gradient(135deg," + t.accent + "," + t.accent2 + ")", color: "#fff", fontSize: 10.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, letterSpacing: ".06em", boxShadow: "0 4px 14px " + t.accentG }}><Ic.Dl s={12} />EXPORT XLSX</button>
                </div>
              </div>
              {efficiency && Object.values(efficiency).some((e) => e > 100) && <div className="fadein" style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, border: "1px solid " + t.danger + "44", background: t.danger + "0d", fontSize: 10.5, color: t.danger }}>η exceeds 100 %, which is unphysical — check that cell area is in cm² and irradiance in W/m².</div>}
              {exportError && <div className="fadein" role="alert" style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, border: "1px solid " + t.danger + "44", background: t.danger + "0d", fontSize: 10.5, color: t.danger }}>{exportError}</div>}
            </div>
            {qualityFlags.length > 0 && <div className="fadein corners" style={{ background: t.card, borderRadius: 10, border: "1px solid " + t.warn + "44", padding: "12px 16px", marginBottom: 12, position: "relative" }}>
              <div className="mono" style={{ fontSize: 8, color: t.warn, letterSpacing: ".18em", fontWeight: 700, marginBottom: 8 }}>⚠ DATA QUALITY · {qualityFlags.length} FLAG{qualityFlags.length > 1 ? "S" : ""}</div>
              {qualityFlags.map((f, i) => <div key={i} style={{ fontSize: 10.5, color: f.severity === "error" ? t.danger : t.textM, lineHeight: 1.6, marginBottom: 3, display: "flex", gap: 8 }}><span className="mono" style={{ color: f.severity === "error" ? t.danger : t.text, fontWeight: 600, flexShrink: 0 }}>{f.severity === "error" ? "ERROR · " : ""}{f.c}</span><span>{f.w}</span></div>)}
            </div>}
            <div data-tour="metrics-table" className="corners" style={{ background: t.card, borderRadius: 10, border: "1px solid " + t.border, overflow: "hidden", position: "relative" }}>
              <div style={{ padding: "10px 16px", borderBottom: "1px solid " + t.border, display: "flex", alignItems: "center", justifyContent: "space-between", background: t.cardAlt }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Ic.Table s={13} c={t.accent} /><span style={{ fontWeight: 700, fontSize: 12 }}>Extracted Parameters</span></div>
                <span className="mono" style={{ fontSize: 9, color: t.textD, letterSpacing: ".06em" }}>{ds.conditions.length} ROWS · {efficiency ? "8" : "7"} COLS</span>
              </div>
              <div style={{ overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
                  {/* No CSS text-transform here: uppercasing "µ" yields the Greek capital Μ, which misreads as "mega". */}
                  <thead><tr style={{ borderBottom: "1px solid " + t.border, background: t.cardAlt }}>{["CONDITION", "I_SC (" + iU + ")", "V_OC (V)", "P_MAX (" + pU + ")", "FF (%)", "R_S", "R_SH"].concat(efficiency ? ["η (%)"] : []).map((h) => <th key={h} className="mono" style={{ padding: "10px 14px", textAlign: h === "CONDITION" ? "left" : "right", fontSize: 8, color: t.textD, fontWeight: 600, letterSpacing: ".14em", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
                  <tbody>{ds.conditions.map((c, ci) => { const m = allM[c]; if (!m) return null; const col = C8[ci % C8.length]; const colTxt = (t.chan || C8)[ci % (t.chan || C8).length]; return (
                    <tr key={c} style={{ borderBottom: "1px solid " + t.border }}>
                      <td style={{ padding: "10px 14px", fontWeight: 600 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: col, boxShadow: "0 0 8px " + col + "66" }} />{c}{[...(m.errors || []), ...(m.warnings || [])].length > 0 && <span title={[...(m.errors || []), ...(m.warnings || [])].join("\n")} style={{ color: m.errors?.length ? t.danger : t.warn, fontSize: 10, cursor: "help" }}>⚠</span>}</span></td>
                      <td className="mono" style={{ padding: "10px 14px", textAlign: "right" }}>{Number.isFinite(m.isc) ? (m.isc / scales.i.div).toFixed(3) : "—"}</td>
                      <td className="mono" title={m.status?.voc} style={{ padding: "10px 14px", textAlign: "right" }}>{m.voc == null ? "—" : (m.notes.vocBeyondRange ? "≥" : "") + m.voc.toFixed(3)}</td>
                      <td className="mono" title={m.status?.pmax} style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: colTxt }}>{["measured", "interpolated", "provisional"].includes(m.status?.pmax) ? (m.pmax / scales.p.div).toFixed(3) + (m.status?.pmax === "provisional" ? "*" : "") : "—"}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>{m.ff == null ? <span className="mono" style={{ color: t.textD }}>—</span> : <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "flex-end" }}><div style={{ width: 50, height: 5, borderRadius: 3, background: t.inputBg, overflow: "hidden", border: "1px solid " + t.border }}><div style={{ width: Math.min(100, Math.max(0, m.ff * 100)) + "%", height: "100%", borderRadius: 2, background: m.ff > 0.5 ? "linear-gradient(90deg,#16a34a,#22c55e)" : m.ff > 0.3 ? "linear-gradient(90deg,#d97706,#f59e0b)" : "linear-gradient(90deg,#dc2626,#f43f5e)", transition: "width .6s ease" }} /></div><span className="mono" style={{ fontSize: 10, minWidth: 36 }}>{(m.ff * 100).toFixed(1)}</span></div>}</td>
                      <td className="mono" title={m.status?.rs} style={{ padding: "10px 14px", textAlign: "right", color: t.textM }}>{m.rs == null ? "—" : fmtSI(m.rs, "Ω", 2)}</td>
                      <td className="mono" title={m.status?.rsh} style={{ padding: "10px 14px", textAlign: "right", color: t.textM }}>{m.rsh == null ? "—" : m.rsh === Infinity ? "∞" : fmtSI(m.rsh, "Ω", 2)}</td>
                      {efficiency && <td className="mono" style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: t.warn }}>{efficiency[c] != null ? efficiency[c].toPrecision(3) : "-"}</td>}
                    </tr>
                  ); })}</tbody>
                </table>
              </div>
              {Object.values(allM).some((m) => m && (m.notes.vocBeyondRange || m.status?.pmax === "provisional")) && <div style={{ padding: "8px 16px", fontSize: 9, color: t.textM, borderTop: "1px solid " + t.border }}>* Sweep does not bracket V_oc: V_oc is a lower bound, P_max is provisional, and FF/R_s are withheld.</div>}
            </div>
          </div>}

          {/* UPLOAD */}
          {page === "upload" && <div className="fadein">
            <div style={{ maxWidth: 560, margin: "0 auto 14px" }}>
              <div className="mono" style={{ fontSize: 9, color: t.textD, letterSpacing: ".18em", fontWeight: 600, marginBottom: 6 }}>04 / DATA INGEST</div>
              <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.025em", marginBottom: 5 }}>Import Measurement Data</h2>
              <p style={{ fontSize: 11, color: t.textM }}>Drop an .xlsx workbook or RFC 4180 CSV with voltage in column A and signed current sweeps in subsequent columns. Sheet headers become channel labels.</p>
            </div>
            <div data-tour="dropzone" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }} onClick={() => { if (fileRef.current) fileRef.current.click(); }} className="corners" style={{ border: "1.5px dashed " + (dragOver ? t.accent : t.border), borderRadius: 14, padding: "50px 28px", textAlign: "center", background: dragOver ? "linear-gradient(135deg," + t.accent + "14," + t.accent2 + "08)" : "linear-gradient(180deg," + t.card + "," + t.cardAlt + ")", maxWidth: 560, margin: "0 auto", transition: "all .25s", position: "relative", overflow: "hidden", cursor: "pointer" }}>
              <div className="scanline" />
              <div style={{ width: 54, height: 54, borderRadius: 14, background: dragOver ? t.accent : t.accentS, border: "1px solid " + (dragOver ? t.accent : t.accent + "33"), display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", boxShadow: dragOver ? "0 0 32px " + t.accentG : "none", transition: "all .25s" }}><Ic.Upl s={26} c={dragOver ? "#fff" : t.accent} /></div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 5 }}>{dragOver ? "Release to upload" : "Drop XLSX or CSV here"}</div>
              <div style={{ fontSize: 10.5, color: t.textM, marginBottom: 14 }}>or click to browse · .xlsx / .csv · 25 MB maximum</div>
              <div className="lift press" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 22px", borderRadius: 9, background: "linear-gradient(135deg," + t.accent + "," + t.accent2 + ")", color: "#fff", fontWeight: 600, fontSize: 11, boxShadow: "0 6px 20px " + t.accentG }}><Ic.File s={12} />Browse Files</div>
              <input ref={fileRef} type="file" accept=".xlsx,.csv" style={{ display: "none" }} onChange={(e) => { if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ""; }} />
              <div className="mono" style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed " + t.border, display: "flex", justifyContent: "center", gap: 18, fontSize: 9, color: t.textD, letterSpacing: ".06em" }}>
                <span>FORMAT · COL A = V, COL B+ = SIGNED I</span><span>·</span><span>UNITS · VOLTS / AMPS</span>
              </div>
            </div>
            {importError && <div className="fadein" style={{ maxWidth: 560, margin: "12px auto 0", padding: "10px 14px", borderRadius: 9, border: "1px solid " + t.danger + "44", background: t.danger + "0d", color: t.danger, fontSize: 11, lineHeight: 1.55, display: "flex", gap: 8, alignItems: "flex-start" }}><span style={{ flexShrink: 0 }}>⚠</span><span>{importError}</span></div>}
            {!isGuest && <p className="mono" style={{ textAlign: "center", fontSize: 9.5, color: t.textM, marginTop: 12, letterSpacing: ".06em" }}>↳ Uploads persist locally to profile: {session.name}</p>}
            {datasets.length > 0 && <div style={{ maxWidth: 560, margin: "22px auto 0" }}>
              <div className="mono" style={{ fontSize: 9, color: t.textD, letterSpacing: ".18em", fontWeight: 600, marginBottom: 8 }}>LOADED IN SESSION · {datasets.length}</div>
              {datasets.map((d, i) => <div key={i} onClick={() => { setActiveDs(i); setPage("home"); }} className="lift" style={{ padding: "11px 14px", borderRadius: 9, marginBottom: 5, background: i === activeDs ? "linear-gradient(135deg," + t.accent + "15," + t.accent2 + "08)" : t.card, border: "1px solid " + (i === activeDs ? t.accent + "55" : t.border), display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, cursor: "pointer" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ width: 28, height: 28, borderRadius: 6, background: i === activeDs ? t.accent : t.accentS, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid " + (i === activeDs ? t.accent : t.accent + "22") }}><Ic.File s={13} c={i === activeDs ? "#fff" : t.accent} /></span><span><span style={{ fontWeight: 600, color: i === activeDs ? t.accent : t.text, display: "block" }}>{d.name}</span><span className="mono" style={{ fontSize: 9, color: t.textD, letterSpacing: ".06em" }}>{d.conditions.length} CHANNELS</span></span></span>
                {i === activeDs && <span className="mono" style={{ fontSize: 8, color: t.accent, fontWeight: 700, letterSpacing: ".14em", padding: "3px 8px", borderRadius: 4, background: t.accentS, border: "1px solid " + t.accent + "33" }}>● ACTIVE</span>}
              </div>)}
            </div>}
          </div>}

          {/* LIBRARY */}
          {page === "library" && !isGuest && <div className="fadein">
            <p style={{ fontSize: 11, color: t.textM, marginBottom: 12 }}>Your uploaded datasets — saved locally to profile <strong>{session.name}</strong>.</p>
            {library.length === 0 ? <div style={{ textAlign: "center", padding: 40, color: t.textD }}><Ic.Book s={28} c={t.textD} st={{ margin: "0 auto 8px", display: "block", opacity: 0.4 }} />No uploaded datasets yet.</div>
              : library.map((entry, i) => <div key={i} onClick={() => { setActiveDs(entry.idx); setPage("home"); }} style={{ background: t.card, borderRadius: 10, border: "1px solid " + t.border, padding: "12px 14px", marginBottom: 5, cursor: "pointer" }}><div style={{ fontWeight: 600, fontSize: 12 }}>{entry.name}</div><div style={{ fontSize: 10, color: t.textM, marginTop: 2 }}>{entry.conditions} conditions</div></div>)}
          </div>}

          {page === "about" && <AboutPage t={t} />}
        </main>

        {/* Application status strip. */}
        <footer className="mono" style={{ flexShrink: 0, borderTop: "1px solid " + t.border, background: t.cardAlt, padding: "5px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 8.5, color: t.textD, letterSpacing: ".12em" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Logo s={13} /> SOLAVIN · RESEARCH PV ANALYSIS</span>
          <span style={{ whiteSpace: "nowrap" }}>ISC · VOC · PMAX · FF · η — v4.0.0</span>
        </footer>
      </div>

      <Assistant open={chatOpen} onClose={() => setChatOpen(false)} datasets={datasets} activeDs={activeDs} allMetrics={allM} efficiency={efficiency} t={t} />

      {showWelcome && <Welcome t={t} onClose={closeWelcome} onStartTour={startTour} />}

      {tourStep >= 0 && <TourOverlay t={t} step={tourStep} onNext={() => setTourStep(tourStep + 1)} onBack={() => { if (tourStep > 0) setTourStep(tourStep - 1); }} onSkip={dismissTour} onNav={setPage} onVizTab={setVizTab} onChat={() => setChatOpen(true)} onCloseChat={() => setChatOpen(false)} />}

      {sheetPicker && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, backdropFilter: "blur(6px)" }}><div className="slideup" style={{ background: t.card, borderRadius: 14, padding: 24, border: "1px solid " + t.border, maxWidth: 360, width: "90%", boxShadow: t.shadow }}><div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Select Sheet</div>{sheetPicker.valid.map((s) => <button key={s} onClick={() => doLoad(sheetPicker.fileName, sheetPicker.sheets, s)} style={{ display: "block", width: "100%", padding: "9px 13px", marginBottom: 4, borderRadius: 8, border: "1px solid " + t.border, background: t.inputBg, color: t.text, fontSize: 11, textAlign: "left" }}>{s}</button>)}<button onClick={() => setSheetPicker(null)} style={{ marginTop: 6, background: "none", border: "none", color: t.textM, fontSize: 10 }}>Cancel</button></div></div>}
    </div>
  );
}
