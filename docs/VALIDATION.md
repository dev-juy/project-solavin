# Solavin 4.0 validation and audit record

**Validation date:** 2026-07-29  
**Reference runtime:** Node.js 22  
**Scientific method identifier:** `piecewise-linear-v4`
**Audited baseline:** `375fa05129a5b1fdb8364f50dda3029db9001738`

## Scope and claim

This record covers the software path from an uploaded array of voltage-current
cells through parsing, parameter extraction, visualization data, and exported
results. It supports confidence that Solavin applies its documented
piecewise-linear method consistently.

It does not establish metrological traceability, quantify measurement
uncertainty, validate an upstream instrument, or certify a procedure against
IEC 60904-1. Those require calibrated equipment, a documented measurement
protocol, environmental controls, and uncertainty analysis outside this
browser application.

No serious scientific tool can truthfully promise to be “flawless.” The
defensible claim is narrower: the algorithms below are explicit, their failure
states are visible, and a repeatable automated suite guards the tested scope.

## Audit findings and remediation

The baseline dependency scan reported nine known vulnerabilities: one critical,
three high, and five moderate. After replacing the workbook dependency and
upgrading the build/test/chart stack, `npm audit` reported zero known
vulnerabilities on the validation date.

| Severity | Original finding | Scientific or operational risk | Remediation |
|---|---|---|---|
| Critical | Missing current cells were coerced to zero. | Fabricated points changed curve shape and derived metrics. | Missing/nonnumeric cells are skipped and surfaced as import warnings. |
| Critical | Channels were combined by array index. | A gap in one channel shifted later currents onto incorrect voltages. | Visualization and raw export now use a union keyed by numeric voltage. |
| High | Charts used smoothed `monotone` curves while calculations used linear segments. | The visual could imply unmeasured extrema or curvature. | All I-V/P-V lines use straight measured segments. |
| High | Unbracketed V<sub>oc</sub> was presented as an exact endpoint. | FF and R<sub>s</sub> appeared valid despite a censored sweep. | V<sub>oc</sub> becomes a lower bound; P<sub>max</sub> is provisional; FF and R<sub>s</sub> are withheld. |
| High | Blank headers changed channel-column mapping. | Measurements could be assigned to the wrong condition. | Physical column positions are retained; blank and duplicate labels are uniquely named. |
| High | The Excel dependency and old build/test packages had known vulnerabilities. | Untrusted-workbook and build-chain exposure. | Replaced `xlsx`, upgraded Vite/Vitest/Recharts, and reached `npm audit` zero known vulnerabilities at validation time. |
| Medium | The workflow filename was `.ciyml` inside `.github/workflows`. | GitHub Actions did not recognize the intended CI workflow. | Installed a valid `.github/workflows/ci.yml` with audit, coverage, build, Chromium, and artifact gates. |
| Medium | Comparison charts hard-coded nanowatts. | Ampere-scale and other datasets were mislabeled. | Shared automatic SI scaling is used throughout. |
| Medium | CSV string cells could begin spreadsheet formulas. | Opening an export could execute an injected formula in spreadsheet software. | Formula-leading strings are prefixed before CSV serialization. |
| Medium | The interface implied a connected SMU and four-wire mode. | Researchers could mistake a visualization-only tool for instrument control. | UI now states `LOCAL / NO BACKEND` and makes no wiring/instrument claim. |
| Medium | Endpoint two-point resistance estimates were fragile. | R<sub>s</sub>/R<sub>sh</sub> varied strongly with one noisy sample. | Local multi-point regressions now return fit diagnostics and withhold degenerate estimates. |

## Accuracy oracles

### Closed-form linear curves

For

`I(V) = Isc × (1 − V/Voc)`

the suite checks 300 seeded randomized curves spanning 10⁻⁸ A to 1 A and
0.15 V to 5 V. It independently expects:

- V<sub>mp</sub> = V<sub>oc</sub>/2
- I<sub>mp</sub> = I<sub>sc</sub>/2
- P<sub>max</sub> = I<sub>sc</sub>V<sub>oc</sub>/4
- FF = 0.25

Samples are shuffled and irregularly spaced so success does not depend on input
ordering or a fixed grid.

### Continuous single-diode curves

Six ideal single-diode cases span 8 nA to 4.2 A, V<sub>oc</sub> values from
0.42 V to 2.08 V, and ideality factors from 1.0 to 2.0. A golden-section search
evaluates the continuous source equation independently of Solavin. The sampled
piecewise-linear extraction must meet:

| Output | Acceptance tolerance |
|---|---:|
| I<sub>sc</sub> relative error | < 1×10⁻¹⁰ |
| V<sub>oc</sub> relative error | < 2×10⁻⁵ |
| V<sub>mp</sub> absolute error | < 2 sample steps |
| P<sub>max</sub> relative error | < 2×10⁻⁴ |
| FF relative error | < 2×10⁻⁴ |

These tolerances validate the sampled piecewise-linear method. They are not a
claim about an instrument's measurement accuracy.

## Data-integrity controls

- Only finite numeric voltage-current pairs enter extraction.
- Signed current is preserved; absolute current is never used for physics.
- Exact duplicate voltage values are averaged deterministically and counted.
- Sparse channels retain blank gaps and are aligned by voltage.
- P<sub>max</sub> is restricted to measured V ≥ 0, I ≥ 0 segments.
- V<sub>oc</sub> requires a measured nonnegative positive-to-negative crossing.
- Multiple nonnegative positive-to-negative crossings are ambiguous and
  withhold V<sub>oc</sub>, FF, and R<sub>s</sub>.
- FF outside the physical 0–100% range is an error, not a clamped result.
- Efficiency rejects nonfinite, negative-power, zero-area, and
  zero-irradiance inputs.
- Every metrics row carries method version, sample counts, statuses, quality,
  source, import flags, metric flags, and any efficiency inputs.
- XLSX exports preserve signed raw data and metadata in separate sheets.

## Reproduction

From a clean checkout:

```bash
npm ci
npm audit --audit-level=high
npm run test:coverage
npm run build:all
npx playwright install --with-deps chromium
CI=1 node tests/e2e.smoke.mjs
```

Expected automated gates:

- all Vitest tests pass;
- scientific-core coverage ≥90% statements, ≥80% branches, ≥90% functions,
  and ≥90% lines;
- dependency audit has no high/critical finding;
- both standard and standalone Vite builds succeed;
- Chromium imports a sparse CSV, renders finite chart paths, exercises the
  assistant and efficiency calculator, and downloads CSV and XLSX outputs.

## Residual limitations

| Limitation | Consequence | Required research control |
|---|---|---|
| No uncertainty propagation | Values do not include confidence intervals. | Retain instrument uncertainty and propagate it externally. |
| No spectral or temperature correction | Results from differing conditions may not be directly comparable. | Record and normalize irradiance, spectrum, and device temperature under the chosen protocol. |
| No hysteresis/sweep-rate model | Direction- or timing-dependent devices may appear deceptively stable. | Preserve forward/reverse sweeps and acquisition timing as separate channels and metadata. |
| R<sub>s</sub>/R<sub>sh</sub> are local slopes | They are not equivalent to a full diode-model parameter fit. | Use dark/light model fitting with uncertainty when those parameters drive conclusions. |
| Exact-voltage duplicate averaging | Repeated setpoints are collapsed without time-order analysis. | Analyze time series separately when drift or hysteresis matters. |
| Browser-local persistence | It is not a controlled laboratory information system. | Archive raw files and exported results in a versioned research repository. |
| No instrument connection | Solavin cannot enforce acquisition settings or calibration. | Record instrument model, calibration, wiring, ranges, dwell time, and compliance separately. |

## Standards context

- [IEC 60904-1:2020](https://webstore.iec.ch/en/publication/32004)
  specifies photovoltaic I-V measurement requirements.
- [NREL, Trust But Verify](https://www.nrel.gov/docs/fy05osti/36527.pdf)
  discusses calibration, uncertainty, and common photovoltaic measurement
  errors.
