import { Logo, Ic } from "../icons.jsx";

/**
 * IVDiagram — an annotated, self-drawing schematic of a light I-V curve.
 * Pure SVG (no chart library) so the entrance animation is a simple
 * stroke-dashoffset draw-in. Geometry is hand-placed in a 460×250 viewBox:
 * x-axis = voltage (baseline y=200), y-axis = current (x=46). The MPP sits at
 * (300, 90); the shaded Vmp×Imp rectangle vs. the dashed Voc×Isc box makes
 * the fill-factor ratio legible at a glance.
 */
function IVDiagram({ t }) {
  const mono = { fontFamily: "'JetBrains Mono',monospace" };
  const lbl = (x, y, text, fill, anchor = "start", delay = "1s", size = 9) => (
    <text x={x} y={y} fill={fill} fontSize={size} style={{ ...mono, animation: `fadein .5s ease ${delay} both` }} textAnchor={anchor}>{text}</text>
  );
  return (
    <svg viewBox="0 0 460 250" style={{ width: "100%", height: "auto", display: "block" }}>
      {/* NB: use stroke/fill-opacity (not the `opacity` attribute) on animated
          elements — the fadein keyframe ends at opacity:1 and would override it. */}
      {/* Voc·Isc bounding box (denominator of FF) */}
      <rect x="46" y="60" width="334" height="140" fill="none" stroke={t.textD} strokeWidth="0.7" strokeDasharray="3 4" strokeOpacity="0.55" style={{ animation: "fadein .6s ease 1.5s both" }} />
      {/* Pmax = Vmp × Imp rectangle (numerator of FF) */}
      <rect x="46" y="90" width="254" height="110" fill={t.accent} fillOpacity="0.08" style={{ animation: "fadein .6s ease 1.2s both" }} />
      {/* axes */}
      <path d="M46 18 L46 200 L430 200" fill="none" stroke={t.textM} strokeWidth="1" />
      {lbl(38, 16, "I", t.textM, "end", "0s", 10)}
      {lbl(436, 204, "V", t.textM, "start", "0s", 10)}
      {/* P-V curve (secondary, dashed amber) — peak aligned with Vmp */}
      <path d="M46 200 C150 192 245 155 300 118 C330 138 358 172 380 200" fill="none" stroke={t.sun} strokeWidth="1.4" strokeDasharray="4 4" strokeOpacity="0.75" pathLength="1" className="drawin" style={{ animationDelay: ".55s", animationDuration: "1.1s" }} />
      {lbl(148, 176, "P = V·I", t.sun, "start", "1.3s", 8.5)}
      {/* I-V curve */}
      <path d="M46 60 C130 62 225 68 285 84 C325 95 355 135 380 200" fill="none" stroke={t.accent} strokeWidth="2.2" strokeLinecap="round" pathLength="1" className="drawin" />
      {/* MPP guides */}
      <path d="M300 90 L300 200" stroke={t.accent} strokeWidth="0.8" strokeDasharray="3 3" strokeOpacity="0.6" style={{ animation: "fadein .5s ease 1.1s both" }} />
      <path d="M46 90 L300 90" stroke={t.accent} strokeWidth="0.8" strokeDasharray="3 3" strokeOpacity="0.6" style={{ animation: "fadein .5s ease 1.1s both" }} />
      {/* Isc marker */}
      <circle cx="46" cy="60" r="3.5" fill={t.accent} stroke={t.card} strokeWidth="1.5" style={{ animation: "fadein .4s ease .9s both" }} />
      {lbl(54, 56, "Isc — current at V = 0", t.text, "start", ".95s")}
      {/* Voc marker */}
      <circle cx="380" cy="200" r="3.5" fill={t.accent} stroke={t.card} strokeWidth="1.5" style={{ animation: "fadein .4s ease 1s both" }} />
      {lbl(380, 216, "Voc — voltage at I = 0", t.text, "middle", "1.05s")}
      {/* MPP marker (amber sun, echoing the Solavin mark) */}
      <circle cx="300" cy="90" r="5" fill={t.sun} stroke={t.card} strokeWidth="1.8" style={{ animation: "fadein .4s ease 1.15s both" }} />
      {lbl(312, 86, "MPP (Vmp · Imp)", t.text, "start", "1.2s")}
      {lbl(296, 216, "Vmp", t.textM, "middle", "1.25s", 8.5)}
      {lbl(40, 93, "Imp", t.textM, "end", "1.25s", 8.5)}
      {/* knee annotation */}
      <path d="M344 68 Q330 72 318 88" fill="none" stroke={t.textM} strokeWidth="0.8" strokeOpacity="0.7" style={{ animation: "fadein .5s ease 1.4s both" }} />
      {lbl(348, 66, 'the "knee"', t.textM, "start", "1.4s", 8.5)}
      {/* Pmax label inside shaded area */}
      {lbl(120, 150, "Pmax = Vmp × Imp", t.accent, "start", "1.35s", 8.5)}
    </svg>
  );
}

const INPUT_ROWS = [
  ["A", "Voltage", "volts (V)"],
  ["B…", "Current, one sweep per column", "amperes (A)"],
];

const OUTPUTS = [
  ["Isc", "short-circuit current"],
  ["Voc", "open-circuit voltage"],
  ["Pmax", "maximum power"],
  ["Vmp · Imp", "MPP coordinates"],
  ["FF", "fill factor"],
  ["Rs · Rsh", "series & shunt R"],
  ["η", "efficiency"],
  ["CSV / XLSX", "one-click export"],
];

/**
 * Welcome — Solavin's orientation panel. Shown once on first load and
 * reopenable anytime from the "?" button in the header. Reads like the front
 * page of the instrument's documentation: what Solavin is, what it expects,
 * what it produces — with a self-drawing annotated I-V curve.
 */
export function Welcome({ t, onClose, onStartTour }) {
  const kicker = { fontSize: 8, color: t.textD, letterSpacing: ".18em", fontWeight: 600 };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(2,5,10,.6)", backdropFilter: "blur(7px)", padding: 20, animation: "fadein .3s ease both" }} onClick={onClose}>
      <div className="welcomein corners" onClick={(e) => e.stopPropagation()} style={{ width: "min(760px, 96vw)", maxHeight: "92vh", overflowY: "auto", background: "linear-gradient(180deg," + t.card + "," + t.cardAlt + ")", border: "1px solid " + t.border, borderRadius: 16, boxShadow: "0 32px 90px rgba(0,0,0,.55), 0 0 0 1px " + t.accent + "1a", position: "relative" }}>
        <div className="scanline" />
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 26px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Logo s={40} />
            <div>
              <div className="mono" style={kicker}>ORIENTATION · 60 SECONDS</div>
              <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-.02em", marginTop: 2 }}>
                <span style={{ background: t.grad, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>Solavin</span>
                <span style={{ color: t.textM, fontWeight: 500, fontSize: 13 }}> — I-V curve characterization for solar cells</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} title="Close" style={{ background: "none", border: "1px solid " + t.border, borderRadius: 7, padding: 6, color: t.textM, flexShrink: 0 }}><Ic.Xx s={13} /></button>
        </div>

        <div style={{ padding: "14px 26px 22px" }}>
          <p style={{ fontSize: 12, color: t.textM, lineHeight: 1.7, maxWidth: 640 }}>
            Measuring a photovoltaic device gives you a table of voltage-current pairs; what a lab report needs is the
            figures of merit hiding inside it. Solavin extracts them reproducibly — linear interpolation at the axis
            crossings, an exact maximum-power scan of the P-V curve, and automated data-quality checks — so every number
            is defensible.
          </p>

          {/* diagram */}
          <div style={{ margin: "16px 0 6px", padding: "14px 16px 8px", borderRadius: 12, border: "1px solid " + t.border, background: t.bg }}>
            <div className="mono" style={{ ...kicker, marginBottom: 6 }}>ANATOMY OF A LIGHT I-V CURVE</div>
            <IVDiagram t={t} />
            <div className="mono" style={{ fontSize: 8.5, color: t.textD, letterSpacing: ".06em", padding: "6px 0 6px", textAlign: "center" }}>
              FILL FACTOR = SHADED Pmax RECTANGLE ÷ DASHED Voc·Isc BOX — SQUARER KNEE, HIGHER FF
            </div>
          </div>

          {/* inputs / outputs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, marginTop: 12 }}>
            <div style={{ borderRadius: 12, border: "1px solid " + t.border, padding: "14px 16px", background: t.cardAlt }}>
              <div className="mono" style={{ ...kicker, marginBottom: 10 }}>WHAT YOU PROVIDE</div>
              <div style={{ fontSize: 11, color: t.textM, lineHeight: 1.6, marginBottom: 10 }}>
                An <strong style={{ color: t.text }}>.xlsx or .csv</strong> workbook — one voltage column, any number of signed-current sweeps. Header row becomes channel labels; legacy .xls is intentionally rejected.
              </div>
              <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 9.5 }}>
                <thead><tr>{["COL", "CONTENT", "UNIT"].map((h) => <th key={h} style={{ textAlign: "left", color: t.textD, fontSize: 8, letterSpacing: ".1em", padding: "4px 6px", borderBottom: "1px solid " + t.border }}>{h}</th>)}</tr></thead>
                <tbody>{INPUT_ROWS.map((r) => (
                  <tr key={r[0]}>
                    <td style={{ padding: "5px 6px", color: t.accent, fontWeight: 700 }}>{r[0]}</td>
                    <td style={{ padding: "5px 6px", color: t.text }}>{r[1]}</td>
                    <td style={{ padding: "5px 6px", color: t.textM }}>{r[2]}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div style={{ borderRadius: 12, border: "1px solid " + t.border, padding: "14px 16px", background: t.cardAlt }}>
              <div className="mono" style={{ ...kicker, marginBottom: 10 }}>WHAT YOU GET</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "7px 12px" }}>
                {OUTPUTS.map(([sym, desc]) => (
                  <div key={sym} style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
                    <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: t.accent, whiteSpace: "nowrap" }}>{sym}</span>
                    <span style={{ fontSize: 9.5, color: t.textM, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{desc}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed " + t.border, fontSize: 9.5, color: t.textM, lineHeight: 1.55 }}>
                Plus interactive I-V / P-V plots with synced crosshairs, MPP · Voc · Isc markers, and per-channel data-quality flags.
              </div>
            </div>
          </div>

          {/* actions */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
            <span className="mono" style={{ fontSize: 8.5, color: t.textD, letterSpacing: ".08em" }}>REOPEN ANYTIME · &ldquo;?&rdquo; IN THE HEADER</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid " + t.border, background: "none", color: t.textM, fontSize: 11, fontWeight: 600 }}>Start analysing</button>
              <button onClick={onStartTour} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: "linear-gradient(135deg," + t.accent + "," + t.accent2 + ")", color: "#fff", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, boxShadow: "0 6px 18px " + t.accentG }}><Ic.Play s={11} />Begin guided tour</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
