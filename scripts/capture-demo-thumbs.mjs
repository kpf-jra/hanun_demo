/**
 * Capture demo page thumbnails for the landing gallery.
 * Usage: node server.mjs (separate terminal) then node scripts/capture-demo-thumbs.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "assets", "thumbs");
const BASE = process.env.THUMB_BASE_URL || "http://localhost:3456";

const DEMOS = [
  { slug: "kosis-api", path: "/demos/kosis_api/" },
  { slug: "xlsx-charts", path: "/demos/xlsx-charts/" },
  { slug: "kolang-quiz", path: "/demos/kolang-quiz/" },
  { slug: "media-crossword", path: "/demos/media-crossword/" },
  { slug: "publication", path: "/demos/publication/" },
  { slug: "news-verification", path: "/apps/news-verification/" },
  { slug: "news-verification-open", path: "/apps/news-verification-open/" },
  { slug: "data-ai", path: "/demos/data_ai/" },
];

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
  throw new Error("Chrome/Edge not found. Set PUPPETEER_EXECUTABLE_PATH.");
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  headless: "new",
  executablePath,
  args: ["--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

  for (const demo of DEMOS) {
    const url = BASE + demo.path;
    console.log("Capturing", url);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    if (demo.slug === "kosis-api") {
      await page.waitForSelector(".kosis-list-item", { timeout: 20000 }).catch(function () {});
      await new Promise((r) => setTimeout(r, 1200));
    } else if (demo.slug === "data-ai") {
      await page.waitForSelector("#dai-table-wrap table", { timeout: 20000 }).catch(function () {});
      await new Promise((r) => setTimeout(r, 1200));
    } else {
      await new Promise((r) => setTimeout(r, 800));
    }
    const out = path.join(OUT_DIR, `${demo.slug}.webp`);
    await page.screenshot({ path: out, type: "webp", quality: 82 });
    console.log("  →", path.relative(ROOT, out));
  }
} finally {
  await browser.close();
}

console.log("Done.");
