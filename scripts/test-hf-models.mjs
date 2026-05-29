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
          resolve({
            status: res.statusCode,
            text: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

const models = [
  "google/gemma-2-2b-it",
  "Qwen/Qwen2.5-7B-Instruct",
  "meta-llama/Llama-3.2-3B-Instruct",
  "HuggingFaceH4/zephyr-7b-beta",
  "mistralai/Mistral-7B-Instruct-v0.3",
  "microsoft/Phi-3-mini-4k-instruct",
];

for (const model of models) {
  const r = await post(
    "https://router.huggingface.co/v1/chat/completions",
    {
      model,
      messages: [{ role: "user", content: "Reply ok" }],
      max_tokens: 16,
    },
    { Authorization: "Bearer " + key }
  );
  console.log(model, "->", r.status, r.text.slice(0, 150).replace(/\n/g, " "));
}
