/**
 * Automated alignment sanity check for html2canvas capture.
 *
 * Usage:
 *   node apps/news-verification-open/tools/check-pdf-align.mjs
 *
 * Requires:
 *   - local server running (node server.mjs)
 *   - puppeteer installed (npm i -D puppeteer)
 */
import fs from "fs";
import puppeteer from "puppeteer";

const URL =
  process.env.PDF_ALIGN_TEST_URL ||
  "http://localhost:3456/apps/news-verification-open/tools/pdf-align-test.html";

function pct(n) {
  return Math.round(n * 100) / 100;
}

function resolveChromePath() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const candidates = [
    "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    "C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    "C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe",
    "C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const executablePath = resolveChromePath();
if (!executablePath) {
  throw new Error(
    "Chrome/Edge executable not found. Set PUPPETEER_EXECUTABLE_PATH to your browser exe."
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
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

  const result = await page.evaluate(async () => {
    const btn = document.getElementById("run");
    btn.click();

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 80; i++) {
      const status = document.getElementById("status")?.textContent || "";
      const metricsText = document.getElementById("metrics")?.textContent || "";
      if (status.trim() === "done" && metricsText.trim().startsWith("{")) {
        return JSON.parse(metricsText);
      }
      await wait(250);
    }
    throw new Error("Timed out waiting for capture metrics");
  });

  const diffPct = result.marginDiffPct;
  // If capture is centered, left/right margins should be close.
  // Allow a small tolerance due to antialiasing and layout differences.
  const ok = diffPct <= 2.0;
  if (!ok) {
    throw new Error(
      `Alignment check failed: marginDiffPct=${diffPct}% (expected <= 2.0%)`
    );
  }

  console.log(
    `OK: marginDiffPct=${pct(diffPct)}% (canvas ${result.canvas.w}x${result.canvas.h})`
  );
} finally {
  await browser.close();
}

