import { useState } from "react";
import { mkT, GRAD } from "../theme.js";
import { Logo } from "../icons.jsx";
import { getProfiles, saveProfile } from "../persistence.js";
import { AreaChart, Area, ResponsiveContainer, LineChart, Line, ReferenceDot } from "recharts";

// A short, real-looking I-V sweep for the hero preview card.
const PREVIEW = [
  { v: 0, i: 1.58 }, { v: 0.3, i: 1.55 }, { v: 0.6, i: 1.5 }, { v: 0.9, i: 1.42 },
  { v: 1.2, i: 1.31 }, { v: 1.5, i: 1.11 }, { v: 1.7, i: 0.93 }, { v: 1.9, i: 0.64 },
  { v: 2.05, i: 0.27 }, { v: 2.12, i: 0 }, { v: 2.2, i: -0.32 },
];

export function ProfileGate(props) {
  const t = mkT(true);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  // Static single I-V sweep for the ambient backdrop — no animation. The
  // previous moving particle-network + drifting grid competed with the hero
  // copy for attention; a calm, still backdrop keeps focus on the text.
  const dd = (() => {
    const d = [];
    for (let i = 0; i < 48; i++) d.push({ x: i * 0.07, y: 1.4 - i * 0.022 });
    return d;
  })();
  const known = Object.entries(getProfiles());

  function enter(e) {
    if (e) e.preventDefault();
    const nm = name.trim();
    if (!nm) { setErr("Enter an operator name"); return; }
    const id = nm.toLowerCase();
    saveProfile(id, nm);
    props.onEnter({ id, name: nm, isGuest: false });
  }

  const iS = { flex: 1, minWidth: 0, padding: "13px 16px", borderRadius: 12, border: "1px solid rgba(120,160,200,.18)", background: "rgba(8,14,24,.7)", color: t.text, fontSize: 14, outline: "none" };
  const stat = (label, value, color) => (
    <div style={{ flex: 1 }}>
      <div className="mono" style={{ fontSize: 17, fontWeight: 700, color }}>{value}</div>
      <div className="mono" style={{ fontSize: 8.5, color: t.textD, letterSpacing: ".14em", marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh", overflow: "hidden", background: "#04070e" }}>
      {/* Calm, static backdrop: faint grid + two soft glow orbs, no motion. */}
      <div className="gridbg" style={{ position: "absolute", inset: 0, zIndex: 1, opacity: 0.14, pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: "-14%", left: "6%", width: 520, height: 520, background: "radial-gradient(circle,rgba(16,185,129,.10),transparent 65%)", zIndex: 1, pointerEvents: "none", filter: "blur(10px)" }} />
      <div style={{ position: "absolute", bottom: "-20%", right: "2%", width: 600, height: 600, background: "radial-gradient(circle,rgba(124,58,237,.10),transparent 65%)", zIndex: 1, pointerEvents: "none", filter: "blur(10px)" }} />
      <div style={{ position: "absolute", inset: 0, zIndex: 1, opacity: 0.045, pointerEvents: "none" }}>
        <ResponsiveContainer width="100%" height="100%"><AreaChart data={dd} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}><defs><linearGradient id="dg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity={0.5} /><stop offset="100%" stopColor="#34d399" stopOpacity={0} /></linearGradient></defs><Area type="linear" dataKey="y" stroke="#34d399" strokeWidth={1} fill="url(#dg)" dot={false} isAnimationActive={false} /></AreaChart></ResponsiveContainer>
      </div>

      {/* Fixed top nav (above the hero layer so its buttons stay clickable) */}
      <nav style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 20, padding: "16px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo s={30} />
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-.01em" }}>Solavin</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <a href="https://github.com/dev-juy/project-solavin" target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 11, color: t.textM, textDecoration: "none", letterSpacing: ".04em" }}>GitHub ↗</a>
          <button onClick={() => props.onEnter({ id: "guest", name: "Guest", isGuest: true })} className="press" style={{ padding: "11px 22px", borderRadius: 10, border: "1px solid rgba(255,255,255,.22)", background: GRAD, color: "#04140d", fontSize: 13, fontWeight: 800, letterSpacing: ".01em", boxShadow: "0 8px 24px rgba(34,211,238,.4)", display: "inline-flex", alignItems: "center", gap: 8, animation: "glowPulse 2.2s ease-in-out infinite" }}><span style={{ width: 7, height: 7, borderRadius: 4, background: "#04140d", animation: "pulsedot 1.5s ease infinite" }} />Try the live demo<span style={{ fontSize: 11 }}>→</span></button>
        </div>
      </nav>

      {/* Hero */}
      <div style={{ position: "relative", zIndex: 10, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.05fr) minmax(0,.95fr)", gap: 48, maxWidth: 1080, width: "100%", alignItems: "center" }}>
          {/* Left: copy + entry */}
          <div className="slideup">
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px 5px 8px", borderRadius: 999, border: "1px solid rgba(52,211,153,.25)", background: "rgba(52,211,153,.06)", fontSize: 11, color: "#6ee7b7", marginBottom: 22 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span className="statusdot" style={{ width: 6, height: 6 }} /></span>
              <span className="mono" style={{ letterSpacing: ".06em" }}>v4 · STATUS-AWARE ANALYSIS</span>
            </div>
            <h1 style={{ fontSize: "clamp(30px,4.4vw,52px)", fontWeight: 700, lineHeight: 1.04, letterSpacing: "-.03em", marginBottom: 16 }}>
              Photovoltaic I-V data,<br />
              <span style={{ background: GRAD, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>grown into clean metrics.</span>
            </h1>
            <p style={{ fontSize: 14.5, color: t.textM, lineHeight: 1.6, maxWidth: 460, marginBottom: 28 }}>
              Solavin turns raw current–voltage sweeps into the figures of merit that matter — I<sub>sc</sub>, V<sub>oc</sub>, P<sub>max</sub>, fill factor, R<sub>s</sub>/R<sub>sh</sub> and efficiency — with interactive charts, one-click export, and physics that's covered by tests.
            </p>
            <form onSubmit={enter} style={{ display: "flex", gap: 8, maxWidth: 460, marginBottom: 14, flexWrap: "wrap" }}>
              <input value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} placeholder="Operator name" style={iS} autoFocus />
              <button type="submit" className="press" style={{ padding: "13px 22px", borderRadius: 12, border: "none", background: GRAD, color: "#04140d", fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", boxShadow: "0 10px 30px rgba(34,211,238,.22)", whiteSpace: "nowrap" }}>Enter lab →</button>
            </form>
            {err && <div className="fadein mono" style={{ color: t.danger, fontSize: 10, marginBottom: 12, letterSpacing: ".06em" }}>▸ {err.toUpperCase()}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: t.textD, flexWrap: "wrap" }}>
              <button onClick={() => props.onEnter({ id: "guest", name: "Guest", isGuest: true })} style={{ padding: 0, background: "none", border: "none", color: t.textM, fontSize: 11, fontWeight: 500 }}>or continue in demo mode →</button>
              {known.length > 0 && <span style={{ color: t.textD }}>·</span>}
              {known.map(([id, prof]) => (
                <button key={id} onClick={() => props.onEnter({ id, name: prof.name, isGuest: false })} className="mono" style={{ padding: "3px 9px", borderRadius: 7, border: "1px solid " + t.border, background: t.inputBg, color: t.textM, fontSize: 10 }}>↩ {prof.name}</button>
              ))}
            </div>
          </div>

          {/* Right: glowing dashboard preview */}
          <div className="slideup" style={{ position: "relative", animationDelay: ".1s" }}>
            <div style={{ position: "absolute", inset: -1, borderRadius: 18, background: GRAD, opacity: 0.5, filter: "blur(26px)", zIndex: 0 }} />
            <div className="corners" style={{ position: "relative", zIndex: 1, background: "linear-gradient(180deg,rgba(12,18,30,.92),rgba(8,12,22,.96))", border: "1px solid rgba(120,160,200,.16)", borderRadius: 16, padding: 18, boxShadow: "0 30px 80px rgba(0,0,0,.5)", overflow: "hidden" }}>
              <div className="scanline" />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Logo s={22} />
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>I-V Sweep</div>
                    <div className="mono" style={{ fontSize: 8, color: t.textD, letterSpacing: ".12em" }}>SAMPLE · ROOM LIGHTS</div>
                  </div>
                </div>
                <span className="mono" style={{ fontSize: 8, color: "#6ee7b7", border: "1px solid rgba(52,211,153,.3)", borderRadius: 5, padding: "3px 7px", letterSpacing: ".1em" }}>● SAMPLE</span>
              </div>
              <ResponsiveContainer width="100%" height={170}>
                <LineChart data={PREVIEW} margin={{ top: 8, right: 10, bottom: 0, left: -18 }}>
                  <defs><linearGradient id="pvLine" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#34d399" /><stop offset=".6" stopColor="#22d3ee" /><stop offset="1" stopColor="#7c3aed" /></linearGradient></defs>
                  <Line type="linear" dataKey="i" stroke="url(#pvLine)" strokeWidth={2.4} dot={false} isAnimationActive={true} animationDuration={1400} />
                  <ReferenceDot x={1.5} y={1.11} r={4} fill={t.sun} stroke="#fff7e6" strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", gap: 12, marginTop: 8, paddingTop: 12, borderTop: "1px solid rgba(120,160,200,.12)" }}>
                {stat("V_OC (V)", "2.07", "#22d3ee")}
                {stat("P_MAX (nW)", "1587", t.sun)}
                {stat("FF (%)", "49.8", "#a78bfa")}
                {stat("I_SC (µA)", "1.58", "#34d399")}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* bottom application-status strip */}
      <div className="mono" style={{ position: "absolute", bottom: 16, left: 28, right: 28, zIndex: 5, display: "flex", justifyContent: "space-between", fontSize: 9, color: t.textD, letterSpacing: ".06em" }}>
        <span>LOCAL ANALYSIS · NO INSTRUMENT LINK</span>
        <span>Solavin · PV CHARACTERIZATION SUITE</span>
      </div>
    </div>
  );
}
