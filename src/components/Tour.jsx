import { useState, useEffect, Fragment } from "react";

export const TOUR_STEPS = [
  { kicker: "00 / ORIENTATION", title: "Welcome to Solavin", desc: "A university-grade workbench for photovoltaic I-V characterization. The next minute walks you through every panel — uploads, sweeps, parameter extraction, and the lab assistant.", nav: null, vizT: null, chat: false, pos: "center", labels: [] },
  { kicker: "01 / DASHBOARD", title: "Measurement Dashboard", desc: "Your command center. Best-of metrics across all conditions, an I-V overview with MPP overlays, and the raw sweep table — all anchored to the active dataset.", nav: "home", vizT: null, chat: false, pos: "bottom-right", labels: [{ text: "Best-of: P_max · I_sc · V_oc · FF", anchor: "stats", side: "top" }, { text: "I-V overview with MPP markers", anchor: "iv-overview", side: "left" }, { text: "Raw sweep table", anchor: "raw-table", side: "top" }] },
  { kicker: "02 / I-V CURVES", title: "Current vs. Voltage", desc: "Interactive sweep plot with Isc, Voc and MPP annotated right on the curve. Toggle channels above the chart, scrub the brush to zoom the knee region, and hover for a live coordinate readout.", nav: "viz", vizT: "iv", chat: false, pos: "bottom-right", labels: [{ text: "Channel toggles", anchor: "channels", side: "top" }, { text: "Voltage cursor lookup", anchor: "vlookup", side: "right" }, { text: "Brush to zoom the knee", anchor: "iv-chart", side: "left" }] },
  { kicker: "03 / P-V CURVES", title: "Power vs. Voltage", desc: "Power profile with shaded area fills. Solid dots mark each channel's maximum power point — the operating sweet spot for that condition. The I-V + P-V tab stacks both plots with a synced crosshair.", nav: "viz", vizT: "pv", chat: false, pos: "bottom-right", labels: [{ text: "P_max markers + area fill", anchor: "pv-chart", side: "left" }] },
  { kicker: "04 / RADAR PROFILE", title: "Normalized Performance", desc: "Side-by-side comparison across I_sc, V_oc, P_max, and FF. Each axis is normalized 0–100% relative to the best performer in the dataset.", nav: "viz", vizT: "radar", chat: false, pos: "bottom-right", labels: [{ text: "Normalized 0–100% axes", anchor: "radar-chart", side: "right" }] },
  { kicker: "05 / METRICS", title: "Parameter Extraction & Export", desc: "Full table — I_sc, V_oc, P_max, FF, R_s, R_sh — with one-click CSV and XLSX export. Enter cell area and irradiance to add an efficiency (η) column.", nav: "metrics", vizT: null, chat: false, pos: "bottom-right", labels: [{ text: "η inputs: area & irradiance", anchor: "eff-calc", side: "bottom" }, { text: "Export CSV / XLSX", anchor: "export-btns", side: "bottom" }, { text: "Extracted parameters", anchor: "metrics-table", side: "left" }] },
  { kicker: "06 / DATA INGEST", title: "Import Workbooks", desc: "Drag .xlsx or .csv onto the dropzone. Column A is voltage, columns B+ are current sweeps; sheet headers become channel labels. Named profiles persist uploads across sessions.", nav: "upload", vizT: null, chat: false, pos: "center", labels: [{ text: "Drag & drop workbooks here", anchor: "dropzone", side: "in" }] },
  { kicker: "07 / LAB ASSISTANT", title: "Lab Assistant", desc: "The sidebar assistant reads your active dataset and answers from the extracted metrics — summarize, compare channels, explain fill factor, or propose next experiments.", nav: null, vizT: null, chat: true, pos: "left", labels: [] },
  { kicker: "08 / READY", title: "You're calibrated.", desc: "Explore the sample dataset or import your own. Named profiles get persistent local storage and a saved library — demo mode works in-session only. Reopen the orientation panel (and replay this tour) anytime via the ? button in the header.", nav: "home", vizT: null, chat: false, pos: "center", labels: [] },
];

export function TourOverlay(p) {
  const t = p.t;
  const step = TOUR_STEPS[p.step];
  const [fade, setFade] = useState(false);
  const [anchors, setAnchors] = useState([]);

  // Drive navigation + the crossfade for EVERY step, including the first mount.
  // A single effect (with cleanup that cancels its pending timers) replaces the
  // previous two-effect + prevStep-ref approach, which under React StrictMode
  // could double-fire, orphan its fade timers and leave the panel stuck hidden
  // or skip the page/tab navigation for a step.
  useEffect(() => {
    const s = TOUR_STEPS[p.step];
    if (!s) return;
    setFade(false);
    let inner;
    const navTimer = setTimeout(() => {
      if (s.nav) p.onNav(s.nav);
      if (s.vizT) p.onVizTab(s.vizT);
      if (s.chat) p.onChat(); else p.onCloseChat();
      inner = setTimeout(() => setFade(true), 80);
    }, 200);
    return () => { clearTimeout(navTimer); clearTimeout(inner); };
  }, [p.step]);

  useEffect(() => {
    if (!fade) { setAnchors([]); return; }
    function measure() {
      const out = [];
      (step.labels || []).forEach((lb) => {
        if (!lb.anchor) return;
        const el = document.querySelector('[data-tour="' + lb.anchor + '"]');
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        out.push({ lb, r: { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, r2: r.right, b: r.bottom } });
      });
      setAnchors(out);
    }
    const id = setTimeout(measure, 140);
    window.addEventListener("resize", measure);
    return () => { clearTimeout(id); window.removeEventListener("resize", measure); };
  }, [fade, p.step]);

  if (!step) return null;
  const posStyle = step.pos === "bottom-right" ? { bottom: 24, right: 24 } : step.pos === "left" ? { top: "50%", left: 24, transform: "translateY(-50%)" } : { top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
  const total = TOUR_STEPS.length;
  const pct = ((p.step + 1) / total) * 100;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, pointerEvents: "none" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center,rgba(0,0,0,.25) 0%,rgba(0,0,0,.55) 80%)", pointerEvents: "auto", backdropFilter: "blur(1px)" }} onClick={(e) => e.stopPropagation()} />
      {anchors.map((a, i) => {
        const r = a.r, lb = a.lb, g = 11, vw = window.innerWidth, vh = window.innerHeight;
        let left, top, tf;
        if (lb.side === "top") { left = r.cx; top = r.y - g; tf = "translate(-50%,-100%)"; }
        else if (lb.side === "bottom") { left = r.cx; top = r.b + g; tf = "translate(-50%,0)"; }
        else if (lb.side === "left") { left = r.x - g; top = r.cy; tf = "translate(-100%,-50%)"; }
        else if (lb.side === "right") { left = r.r2 + g; top = r.cy; tf = "translate(0,-50%)"; }
        else { left = r.cx; top = r.cy; tf = "translate(-50%,-50%)"; }
        left = Math.max(10, Math.min(vw - 10, left)); top = Math.max(10, Math.min(vh - 10, top));
        return (
          <Fragment key={i}>
            <div style={{ position: "fixed", left: r.x - 6, top: r.y - 6, width: r.w + 12, height: r.h + 12, borderRadius: 12, border: "1.5px solid " + t.accent, boxShadow: "0 0 26px " + t.accentG + ",inset 0 0 18px " + t.accent + "22", background: t.accent + "0a", zIndex: 505, pointerEvents: "none", animation: "fadein .4s cubic-bezier(.4,0,.2,1) " + i * 0.08 + "s both" }} />
            <div style={{ position: "fixed", left, top, transform: tf, zIndex: 512, pointerEvents: "none", animation: "slideup .45s cubic-bezier(.4,0,.2,1) " + (0.12 + i * 0.09) + "s both" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "linear-gradient(135deg," + t.accent + "," + t.accent2 + ")", color: "#fff", padding: "5px 11px 5px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, boxShadow: "0 6px 20px " + t.accentG + ",0 0 0 1px rgba(255,255,255,.12) inset", whiteSpace: "nowrap" }}>
                <div style={{ width: 7, height: 7, borderRadius: 4, background: "#fff", flexShrink: 0, animation: "pulsedot 1.6s ease infinite", boxShadow: "0 0 8px rgba(255,255,255,.8)" }} />
                <span className="mono" style={{ fontSize: 8, opacity: 0.65, letterSpacing: ".1em", fontWeight: 700 }}>{String(i + 1).padStart(2, "0")}</span>
                <span>{lb.text}</span>
              </div>
            </div>
          </Fragment>
        );
      })}
      <div style={{ position: "absolute", zIndex: 520, pointerEvents: "auto", maxWidth: 400, width: "92%", opacity: fade ? 1 : 0, transform: "translateY(" + (fade ? 0 : 8) + "px)" + (posStyle.transform ? " " + posStyle.transform : ""), transition: "opacity .35s ease,transform .35s cubic-bezier(.4,0,.2,1)", ...posStyle }}>
        <div className="corners" style={{ background: "linear-gradient(180deg," + t.card + "," + t.cardAlt + ")", borderRadius: 12, border: "1px solid " + t.border, padding: "22px 22px 18px", boxShadow: "0 24px 60px rgba(0,0,0,.5),0 0 0 1px " + t.accent + "22", position: "relative", overflow: "hidden" }}>
          <div className="scanline" />
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: t.border }}>
            <div style={{ height: "100%", width: pct + "%", background: "linear-gradient(90deg," + t.accent + "," + t.accent2 + ")", transition: "width .55s cubic-bezier(.4,0,.2,1)", boxShadow: "0 0 12px " + t.accentG }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ width: 30, height: 30, borderRadius: 7, background: "linear-gradient(135deg," + t.accent + "," + t.accent2 + ")", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 18px " + t.accentG, flexShrink: 0 }}><span className="mono" style={{ fontSize: 10, fontWeight: 800, color: "#fff" }}>{String(p.step + 1).padStart(2, "0")}</span></div>
              <div>
                <div className="mono" style={{ fontSize: 8, color: t.accent, fontWeight: 700, letterSpacing: ".18em" }}>{step.kicker}</div>
                <div className="mono" style={{ fontSize: 8, color: t.textD, letterSpacing: ".12em", marginTop: 1 }}>GUIDED WALKTHROUGH</div>
              </div>
            </div>
            <button aria-label="Dismiss guided tour" onClick={p.onSkip} className="mono" style={{ fontSize: 9, color: t.textD, background: "none", border: "1px solid " + t.border, borderRadius: 5, padding: "3px 8px", letterSpacing: ".06em" }}>SKIP ✕</button>
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, letterSpacing: "-.025em", lineHeight: 1.2 }}>{step.title}</h3>
          <p style={{ fontSize: 11.5, color: t.textM, lineHeight: 1.65, marginBottom: 18 }}>{step.desc}</p>
          <div style={{ display: "flex", gap: 6, justifyContent: "space-between", alignItems: "center", paddingTop: 14, borderTop: "1px dashed " + t.border }}>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {TOUR_STEPS.map((_, i) => { const done = i < p.step; const cur = i === p.step; return <div key={i} style={{ width: cur ? 16 : 6, height: 6, borderRadius: 3, background: cur ? "linear-gradient(90deg," + t.accent + "," + t.accent2 + ")" : done ? t.accent + "66" : t.border, transition: "all .4s cubic-bezier(.4,0,.2,1)", boxShadow: cur ? "0 0 8px " + t.accentG : "none" }} />; })}
              <span className="mono" style={{ fontSize: 9, color: t.textD, letterSpacing: ".08em", marginLeft: 8 }}>{p.step + 1}/{total}</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {p.step > 0 && <button onClick={p.onBack} className="lift press" style={{ padding: "7px 13px", borderRadius: 7, border: "1px solid " + t.border, background: t.card, color: t.textM, fontSize: 10.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>← Back</button>}
              <button onClick={() => { if (p.step < total - 1) p.onNext(); else p.onSkip(); }} className="lift press" style={{ padding: "7px 16px", borderRadius: 7, border: "none", background: "linear-gradient(135deg," + t.accent + "," + t.accent2 + ")", color: "#fff", fontSize: 10.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, boxShadow: "0 4px 14px " + t.accentG }}>{p.step < total - 1 ? "Next →" : "✓ Finish"}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
