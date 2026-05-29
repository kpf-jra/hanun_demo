import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnv();

const key = process.env.gemini_api_key || "";
const insecure = process.env.GEMINI_INSECURE_SSL === "1";

function get(path) {
  return new Promise((resolve, reject) => {
    const url = new URL("https://generativelanguage.googleapis.com" + path + "?key=" + key);
    https
      .get(
        {
          hostname: url.hostname,
          path: url.pathname + url.search,
          ...(insecure ? { rejectUnauthorized: false } : {}),
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
        }
      )
      .on("error", reject);
  });
}

const list = await get("/v1beta/models");
console.log("list status", list.status);
const models = JSON.parse(list.body).models || [];
const flash = models
  .map((m) => m.name.replace("models/", ""))
  .filter((n) => /flash|lite/i.test(n));
console.log("models with flash/lite:\n" + flash.join("\n"));
