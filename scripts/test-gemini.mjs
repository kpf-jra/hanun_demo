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
    const k = t.slice(0, eq).trim();
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

const models = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite",
  "gemini-flash-latest",
  "gemini-2.0-flash",
];

function testModel(model) {
  return new Promise((resolve) => {
    const url = new URL(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        model +
        ":generateContent?key=" +
        encodeURIComponent(key)
    );
    const body = JSON.stringify({ contents: [{ parts: [{ text: "Say OK" }] }] });
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        ...(insecure ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const ok = res.statusCode === 200;
          resolve({ model, status: res.statusCode, ok, snippet: text.slice(0, 100) });
        });
      }
    );
    req.on("error", (err) => resolve({ model, status: "ERR", ok: false, snippet: err.message }));
    req.write(body);
    req.end();
  });
}

for (const model of models) {
  const r = await testModel(model);
  console.log(r.ok ? "OK " : "FAIL", r.model, r.status, r.snippet.replace(/\n/g, " "));
}
