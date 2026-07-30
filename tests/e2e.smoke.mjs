/**
 * Optional end-to-end smoke test. Builds (or reuses) the standalone bundle,
 * opens it in a real browser, and asserts that:
 *   - the app mounts with no console/page errors,
 *   - the extracted fill factors are all physical (0 < FF < 100 %),
 *   - the efficiency column appears once area & irradiance are entered,
 *   - the deterministic assistant answers from the dataset.
 *
 * Run with:  npm run test:e2e
 * Requires a Chromium that Playwright can launch. A missing browser skips only
 * for local development; CI treats it as a hard failure.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import readExcelFile from "read-excel-file/node";
import writeExcelFile from "write-excel-file/node";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  if (process.env.CI === "true") {
    console.error("✗ Playwright is required in CI:", error.message);
    process.exit(1);
  }
  console.log("⚠ playwright not installed — skipping local e2e smoke test.");
  process.exit(0);
}

const bundle = resolve("dist-standalone/index.html");
if (!existsSync(bundle)) {
  console.error("✗ dist-standalone/index.html not found. Run `npm run build:standalone` first.");
  process.exit(1);
}

// Prefer Playwright's own browser; fall back to a pre-provisioned system
// Chromium (CHROMIUM_PATH env var, or the conventional /opt/pw-browsers link)
// so CI containers that ship a browser but skip the download still run this.
let browser;
const fallbacks = [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter((p) => p && existsSync(p));
for (const executablePath of [undefined, ...fallbacks]) {
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"], executablePath });
    break;
  } catch (e) {
    if (executablePath === fallbacks[fallbacks.length - 1] || fallbacks.length === 0) {
      if (process.env.CI === "true") {
        console.error("✗ no launchable Chromium in CI (" + e.message.split("\n")[0] + ")");
        process.exit(1);
      }
      console.log("⚠ no launchable Chromium (" + e.message.split("\n")[0] + ") — skipping local e2e smoke test.");
      process.exit(0);
    }
  }
}

const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("ERR_")) errors.push("console: " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto("file://" + bundle, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Continue in demo mode" }).click();
  await page.waitForTimeout(700);
  // First load shows the Solavin orientation panel — verify it, then close it.
  const welcomeShown = await page.getByText("ANATOMY OF A LIGHT I-V CURVE").count();
  const closeWelcome = page.getByRole("button", { name: "Start analysing" });
  if (await closeWelcome.count()) await closeWelcome.first().click();
  await page.waitForTimeout(400);
  const dismissTour = page.getByRole("button", { name: "Dismiss guided tour", exact: true });
  await dismissTour.click();
  await dismissTour.waitFor({ state: "detached" });

  // Visit every visualization tab (including the synced dual view).
  await page.getByRole("button", { name: "Visualizations", exact: true }).click();
  await page.waitForTimeout(400);
  for (const tab of ["P-V", "I-V + P-V", "Radar", "Compare", "I-V"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page.waitForTimeout(300);
  }
  const chartIntegrity = await page.evaluate(() => {
    const paths = [...document.querySelectorAll(".recharts-line-curve, .recharts-area-curve")];
    return paths.length > 0 && paths.every((path) => !/NaN|Infinity/.test(path.getAttribute("d") || ""));
  });

  // Metrics + efficiency.
  await page.getByRole("button", { name: "Metrics & Export", exact: true }).click();
  await page.waitForTimeout(600);
  const ffValues = await page.evaluate(() => {
    const t = [...document.querySelectorAll("table")].find((tb) => tb.innerText.includes("FF"));
    if (!t) return null;
    return [...t.querySelectorAll("tbody tr")].map((tr) => parseFloat(tr.querySelectorAll("td")[4].innerText));
  });
  await page.fill('input[placeholder="0.01"]', "0.01");
  await page.fill('input[placeholder="1000"]', "1000");
  await page.waitForTimeout(300);
  const hasEff = await page.evaluate(() => {
    const table = [...document.querySelectorAll("table")].find((candidate) =>
      candidate.innerText.includes("CONDITION") && candidate.innerText.includes("FF")
    );
    if (!table) return false;
    const headers = [...table.querySelectorAll("th")].map((cell) => cell.innerText.trim());
    const efficiencyIndex = headers.findIndex((header) => header.includes("η (%)"));
    if (efficiencyIndex < 0) return false;
    const values = [...table.querySelectorAll("tbody tr")]
      .map((row) => Number(row.querySelectorAll("td")[efficiencyIndex]?.innerText));
    return values.length > 0 && values.every((value) => Number.isFinite(value) && value > 0);
  });

  // Assistant.
  await page.getByRole("button", { name: /Lab Assistant/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Fill factor" }).click();
  await page.waitForTimeout(600);
  const assistantOk = await page.evaluate(() => document.body.innerText.includes("Fill factor measures"));

  const ffOk = Array.isArray(ffValues) && ffValues.length > 0 && ffValues.every((f) => f > 0 && f < 100);

  // Import a deliberately sparse CSV. Each channel omits a different voltage,
  // which catches the historical row-index alignment bug in the real UI.
  await page.getByRole("button", { name: "Import Data", exact: true }).click();
  const sparseCsv = [
    "Voltage(V),Cell A,Cell B",
    "0,1,2",
    "0.5,,1.5",
    "1,0.5,",
    "1.5,0.1,0.2",
    "2,-0.2,-0.1",
  ].join("\n");
  await page.locator('input[type="file"]').setInputFiles({
    name: "sparse_iv.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(sparseCsv),
  });
  await page.getByText("sparse_iv (CSV)", { exact: false }).first().waitFor();
  const rawDataTable = page.getByRole("table", { name: "Raw I-V measurements", exact: true });
  await rawDataTable.waitFor();
  await rawDataTable.getByRole("columnheader", { name: "Cell A", exact: true }).waitFor();
  const sparseAlignment = await rawDataTable.evaluate((table) => {
    const rows = [...table.querySelectorAll("tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.innerText.trim())
    );
    const atHalfVolt = rows.find((row) => row[0] === "0.50");
    const atOneVolt = rows.find((row) => row[0] === "1.00");
    return {
      ok: atHalfVolt?.[1] === "—" && atHalfVolt?.[2] === "1.500e+0" &&
        atOneVolt?.[1] === "5.000e-1" && atOneVolt?.[2] === "—",
      rows,
    };
  });
  const sparseAlignmentOk = sparseAlignment.ok;
  await page.getByRole("button", { name: "Metrics & Export", exact: true }).click();
  await page.getByText(/skipped 1 row\(s\).*no zero values were inserted/i).first().waitFor();

  const csvDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "EXPORT CSV", exact: true }).click();
  const csvDownload = await csvDownloadPromise;
  const csvText = readFileSync(await csvDownload.path(), "utf8");
  const csvExportOk = csvDownload.suggestedFilename() === "solavin_iv_metrics.csv" &&
    csvText.includes("Analysis version") &&
    csvText.includes("piecewise-linear-v4") &&
    csvText.includes("sparse_iv.csv") &&
    csvText.includes("Import flags");

  const xlsxDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "EXPORT XLSX", exact: true }).click();
  const xlsxDownload = await xlsxDownloadPromise;
  const exportedWorkbook = await readExcelFile(await xlsxDownload.path());
  const exportedMetadata = Object.fromEntries(
    exportedWorkbook.find(({ sheet }) => sheet === "Metadata").data.slice(1)
  );
  const xlsxExportOk = xlsxDownload.suggestedFilename() === "solavin_iv_analysis.xlsx" &&
    exportedWorkbook.map(({ sheet }) => sheet).join("|") === "Metrics|Raw Data|Metadata" &&
    exportedMetadata["Solavin analysis version"] === "4.0.0" &&
    exportedMetadata["Analysis method"] === "piecewise-linear-v4" &&
    exportedMetadata["Source file"] === "sparse_iv.csv" &&
    exportedMetadata["Cell area (cm2)"] === 0.01 &&
    exportedMetadata["Irradiance (W/m2)"] === 1000;

  // Exercise the browser-side XLSX reader and multi-sheet picker with a
  // workbook generated independently in Node.
  await page.getByRole("button", { name: "Import Data", exact: true }).click();
  const workbookBuffer = await writeExcelFile([
    {
      sheet: "Run A",
      data: [["Voltage (V)", "Cell X"], [0, 1], [0.5, 0.6], [1, 0], [1.1, -0.1]],
    },
    {
      sheet: "Run B",
      data: [["Voltage (V)", "Cell Y"], [0, 2], [0.5, 1.2], [1, 0], [1.1, -0.2]],
    },
  ]).toBuffer();
  await page.locator('input[type="file"]').setInputFiles({
    name: "browser_fixture.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbookBuffer,
  });
  await page.getByText("Select Sheet", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Run B", exact: true }).click();
  const xlsxImport = page.getByText("browser_fixture (Run B)", { exact: false }).first();
  await xlsxImport.waitFor();
  const xlsxImportOk = await xlsxImport.isVisible();

  const fail = [];
  if (errors.length) fail.push("runtime errors: " + JSON.stringify(errors));
  if (!welcomeShown) fail.push("orientation (welcome) panel did not appear on first load");
  if (!ffOk) fail.push("fill factors not all in (0,100)%: " + JSON.stringify(ffValues));
  if (!hasEff) fail.push("efficiency column missing");
  if (!assistantOk) fail.push("assistant did not answer fill-factor query");
  if (!chartIntegrity) fail.push("chart SVG paths were missing or contained NaN/Infinity");
  if (!sparseAlignmentOk) fail.push("sparse channels were not preserved at their correct voltages; observed rows: " + JSON.stringify(sparseAlignment.rows));
  if (!csvExportOk) fail.push("CSV export did not produce the expected download");
  if (!xlsxExportOk) fail.push("XLSX export did not produce the expected download");
  if (!xlsxImportOk) fail.push("browser XLSX import or multi-sheet selection failed");

  if (fail.length) {
    console.error("✗ e2e smoke test FAILED:\n - " + fail.join("\n - "));
    process.exitCode = 1;
  } else {
    console.log("✓ e2e passed — charts, sparse CSV + multi-sheet XLSX import, assistant, efficiency, CSV/XLSX exports; FF:", ffValues.map((f) => f.toFixed(1)).join(", "), "%");
  }
} finally {
  await browser.close();
}
