/**
 * Full PDF export + alignment test (223 mock rows).
 *
 * Usage:
 *   node apps/news-verification/tools/check-pdf-export.mjs
 *
 * Requires local server (node server.mjs) and puppeteer.
 */
import fs from "fs";
import puppeteer from "puppeteer";

const URL =
  process.env.PDF_EXPORT_TEST_URL ||
  "http://localhost:3456/apps/news-verification/tools/pdf-export-test.html";

function resolveChromePath() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const executablePath = resolveChromePath();
if (!executablePath) {
  throw new Error(
    "Chrome/Edge executable not found. Set PUPPETEER_EXECUTABLE_PATH."
  );
}

const browser = await puppeteer.launch({
  headless: "new",
  executablePath,
  args: ["--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 120000 });

  const result = await page.evaluate(async () => {
    document.getElementById("run").click();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 240; i++) {
      const status = document.getElementById("status")?.textContent || "";
      const metricsText = document.getElementById("metrics")?.textContent || "";
      if (status.trim() === "done" && metricsText.trim().startsWith("{")) {
        return JSON.parse(metricsText);
      }
      if (status.trim() === "error" && metricsText.trim().startsWith("{")) {
        return JSON.parse(metricsText);
      }
      await wait(500);
    }
    throw new Error("Timed out waiting for PDF export test");
  });

  if (!result.ok) {
    throw new Error(
      "PDF export test failed: " + JSON.stringify(result)
    );
  }

  console.log(
    "OK: PDF export " +
      result.blobBytes +
      " bytes, " +
      result.pageCount +
      " pages, marginDiffPct=" +
      result.marginDiffPct +
      "%"
  );
} finally {
  await browser.close();
}
