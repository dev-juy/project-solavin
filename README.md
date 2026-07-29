# Solavin

Solavin is a research-oriented web application for inspecting photovoltaic
current-voltage (I-V) sweeps. It extracts I<sub>sc</sub>, V<sub>oc</sub>,
P<sub>max</sub>, V<sub>mp</sub>, I<sub>mp</sub>, fill factor, local slope
estimates of R<sub>s</sub>/R<sub>sh</sub>, and—when area and irradiance are
provided—power-conversion efficiency.

The application is designed to make questionable data visible rather than turn
it into precise-looking numbers. Missing cells remain missing, unbracketed
V<sub>oc</sub> values are reported as lower bounds, dependent metrics are
withheld when they cannot be supported, and every export carries analysis
status and provenance.

> Solavin validates calculations performed on supplied data. It does not
> calibrate an instrument or certify a photovoltaic measurement to IEC 60904-1.
> Measurement uncertainty, spectral mismatch, temperature control, irradiance
> uniformity, sweep protocol, contact quality, and instrument calibration remain
> the operator's responsibility.

Developed by **John Myron Uy**, under the guidance of
**Prof. Raymund Sarmiento** — Research Laboratory, Solar Cell
Characterization.

## What researchers get

- Piecewise-linear I-V and P-V plots that do not invent smoothed extrema.
- Exact maximum-power optimization on each measured linear segment.
- Voltage-keyed alignment across sparse channels, so one missing cell cannot
  shift later measurements onto the wrong voltage.
- Explicit `pass`, `review`, and `invalid` channel states.
- CSV and three-sheet XLSX exports:
  - `Metrics` — values, units, per-metric status, quality flags, source, and
    analysis version.
  - `Raw Data` — signed measurements aligned by voltage with gaps preserved.
  - `Metadata` — conventions, handling rules, source, and import warnings.
- Safe `.xlsx` and RFC 4180 CSV ingestion with a 25 MB browser limit.
- A deterministic offline assistant that only summarizes validated extracted
  results.
- A normal hosted build and a self-contained offline HTML build.

## Analysis definitions

All scientific calculations live in
[`src/lib/ivAnalysis.js`](src/lib/ivAnalysis.js). Current uses the generator
convention: current is positive while the device produces positive V·I power
and negative beyond V<sub>oc</sub>.

| Quantity | Definition and validity rule |
|---|---|
| I<sub>sc</sub> | Signed current at V = 0. Uses an exact sample, interpolation across zero, or a flagged nearest-pair extrapolation. |
| V<sub>oc</sub> | First non-negative-voltage positive-to-negative current crossing, linearly interpolated. If no crossing is measured, the highest measured voltage is only a lower bound. |
| P<sub>max</sub> | Maximum of V·I in the measured power quadrant. The maximum is solved analytically on every piecewise-linear segment. |
| V<sub>mp</sub>, I<sub>mp</sub> | Coordinates of the same piecewise-linear P<sub>max</sub> solution. |
| FF | P<sub>max</sub> / (I<sub>sc</sub>·V<sub>oc</sub>). Withheld if V<sub>oc</sub> is unbracketed; out-of-range results are reported as errors, never clamped. |
| R<sub>s</sub> | \|dV/dI\| from a local multi-point linear fit near V<sub>oc</sub>. Withheld when V<sub>oc</sub> is unbracketed or the fit is degenerate. |
| R<sub>sh</sub> | \|dV/dI\| from a local multi-point linear fit near V = 0. |
| η | P<sub>max</sub> / (G·A), with P in W, G in W/m², and illuminated area entered in cm². |

R<sub>s</sub> and R<sub>sh</sub> are local light-sweep slope estimates, not a
substitute for uncertainty-aware parameter fitting or dark-I-V analysis.

## Validation

The automated suite currently contains 53 tests, including:

- 300 deterministic randomized linear curves checked against closed-form
  I<sub>sc</sub>, V<sub>oc</sub>, P<sub>max</sub>, V<sub>mp</sub>,
  I<sub>mp</sub>, and FF solutions.
- Six continuous single-diode curves spanning nanoampere to ampere scales,
  checked against an independent golden-section maximum-power oracle.
- Current-scale invariance checks.
- Censored sweeps, nonphysical curves, duplicate voltages, all-negative and
  sparse sweeps.
- Blank cells, duplicate/blank headers, malicious labels, quoted and malformed
  CSV, input safety limits, and spreadsheet-formula neutralization.
- Raw-data alignment, status/provenance export, and invalid efficiency inputs.

Coverage gates apply to the scientific core: at least 90% statements, 80%
branches, 90% functions, and 90% lines. CI additionally performs a high-severity
dependency audit, both production builds, and a real-Chromium import,
visualization, assistant, and CSV/XLSX download smoke test.

See [`docs/VALIDATION.md`](docs/VALIDATION.md) for the audit register,
tolerances, reproducibility commands, and residual limitations.

## Input format

Use `.xlsx` or `.csv`. Column A is voltage in volts. Each subsequent column is
one signed current sweep in amperes, and row 1 contains channel labels.

```csv
Voltage (V),Focused Laser,-2 mm,+6 mm Focus
0,1.539e-6,1.460e-6,1.583e-6
0.05,1.528e-6,1.456e-6,1.565e-6
2.50,-3.875e-6,-3.052e-6,-2.923e-6
```

Rules:

- Every accepted channel must contain at least three unique voltage setpoints
  with valid voltage-current pairs.
- Blank or nonnumeric current cells are skipped and reported; they are never
  converted to zero.
- Exact duplicate voltage setpoints are averaged and flagged.
- Blank and duplicate channel headers are assigned unique visible names.
- Legacy `.xls` files are intentionally rejected; convert them to `.xlsx` or
  CSV first.

The bundled example is
[`examples/sample_iv_data.csv`](examples/sample_iv_data.csv).

## Run and verify

Node.js 22 is the CI reference runtime.

```bash
npm ci
npm run validate       # dependency audit, coverage-gated tests, both builds
npm run test:e2e       # standalone build + real-browser smoke test
npm run dev            # local development server
```

Build targets:

```bash
npm run build              # dist/
npm run build:standalone   # dist-standalone/index.html
npm run build:all          # both
```

The standalone file contains the application code and can run from `file://`
without a backend. Browser profile and dataset storage is local and is not an
authentication or access-control system.

## Project map

```text
src/
  lib/
    ivAnalysis.js
    ivAnalysis.test.js
    ivAnalysis.validation.test.js
    assistant.js
  components/
  App.jsx
docs/
  VALIDATION.md
examples/
  sample_iv_data.csv
tests/
  e2e.smoke.mjs
.github/workflows/
  ci.yml
```

## Standards context

IEC 60904-1 defines measurement requirements for photovoltaic I-V
characteristics; Solavin is an analysis and visualization layer, not an IEC
conformity claim. NREL's photovoltaic measurement guidance likewise emphasizes
calibration and uncertainty in the upstream measurement chain.

- [IEC 60904-1:2020 — Photovoltaic devices, Part 1](https://webstore.iec.ch/en/publication/32004)
- [NREL — Trust But Verify: Creating and Using Highly Accurate Measurements in Solar Research](https://www.nrel.gov/docs/fy05osti/36527.pdf)

## License and citation

[MIT](LICENSE) © 2026 John Myron Uy. Citation metadata is provided in
[`CITATION.cff`](CITATION.cff).
