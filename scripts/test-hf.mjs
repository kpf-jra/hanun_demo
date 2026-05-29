import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq < 0) continue;
  let v = t.slice(eq + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  env[t.slice(0, eq).trim()] = v;
}

const key = env.HF_API_KEY || "";
const model = process.argv[2] || "google/gemma-2-2b-it";
const insecure =
  env.GEMINI_INSECURE_SSL === "1" || env.HF_INSECURE_SSL === "1";

function post(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headers,
        },
        ...(insecure ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

const payload = {
  inputs: 'JSON only: {"items":[{"id":"i1","status":"unknown","reason":"test"}]}',
  parameters: { max_new_tokens: 128, temperature: 0.1, return_full_text: false },
  options: { wait_for_model: true },
};

const url =
  "https://router.huggingface.co/hf-inference/models/" + model;

console.log("insecure SSL:", insecure);
console.log("URL:", url);

try {
  const r = await post(url, payload, { Authorization: "Bearer " + key });
  console.log("Status:", r.status);
  console.log("Body:", r.text.slice(0, 500));
} catch (e) {
  console.error("Error:", e.cause?.code || e.message);
  process.exit(1);
}
