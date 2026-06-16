/**
 * Static files + Gemini API proxy (avoids browser CORS).
 * Run: node server.mjs
 */
import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3456;

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile();

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.gemini_api_key ||
  process.env.GOOGLE_API_KEY ||
  "";

const HF_API_KEY =
  process.env.HF_API_KEY ||
  process.env.HF_TOKEN ||
  process.env.huggingface_api_key ||
  "";

const KOSIS_API_KEY =
  process.env.KOSIS_API_KEY ||
  process.env.KOSIS_TOKEN ||
  process.env.kosis_api_key ||
  "";

const KOSIS_OPENAPI_BASE =
  process.env.KOSIS_OPENAPI_BASE || "https://kosis.kr/openapi";

const KOSIS_ALLOWED_ENDPOINTS = new Set([
  "statisticsList",
  "statisticsData",
  "statisticsExplData",
  "Param/statisticsParameterData",
]);

const INSECURE_SSL =
  process.env.GEMINI_INSECURE_SSL === "1" ||
  process.env.GEMINI_INSECURE_SSL === "true" ||
  process.env.HF_INSECURE_SSL === "1" ||
  process.env.HF_INSECURE_SSL === "true";

function hfInferenceUrl(model) {
  const modelPath = String(model).replace(/^\/+/, "");
  return (
    "https://router.huggingface.co/hf-inference/models/" + modelPath
  );
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        headers: { Accept: "application/json, text/plain, */*" },
        ...(INSECURE_SSL ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 500,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function httpsPost(url, payload, headersExtra = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headersExtra,
        },
        ...(INSECURE_SSL ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 500,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function geminiFetchErrorMessage(err) {
  const code = err.cause?.code || err.code || "";
  if (code === "SELF_SIGNED_CERT_IN_CHAIN" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return (
      "SSL 인증서 검증 실패(회사망·백신 프록시 가능). " +
      ".env 에 GEMINI_INSECURE_SSL=1 을 추가한 뒤 node server.mjs 를 재시작하세요."
    );
  }
  return "Proxy failed: " + (err.cause?.message || err.message || String(err));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function proxyGemini(req, res) {
  let parsed;
  try {
    parsed = JSON.parse((await readBody(req)).toString("utf8"));
  } catch {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { message: "Invalid JSON body" } }));
    return;
  }

  const { model, payload } = parsed;
  const apiKey = parsed.apiKey || GEMINI_API_KEY;

  if (!model || !payload) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: { message: "model and payload are required" },
      })
    );
    return;
  }

  if (!apiKey) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: {
          message:
            "Gemini API 키가 없습니다. 프로젝트 루트 .env 에 gemini_api_key= 를 설정하세요.",
        },
      })
    );
    return;
  }

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(apiKey);

  try {
    const upstream = await httpsPost(url, payload);
    res.writeHead(upstream.status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    if (upstream.status === 429) {
      let hint = upstream.text;
      try {
        const j = JSON.parse(upstream.text);
        hint = j?.error?.message || hint;
      } catch {
        /* keep raw */
      }
      res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: { message: hint } }));
      return;
    }
    res.end(upstream.text);
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: { message: geminiFetchErrorMessage(err) },
      })
    );
  }
}

function sendConfig(res) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      geminiConfigured: Boolean(GEMINI_API_KEY),
      defaultModel:
        process.env.GEMINI_MODEL ||
        process.env.gemini_model ||
        "gemini-2.5-flash-lite",
    })
  );
}

function sendHfConfig(res) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      hfConfigured: Boolean(HF_API_KEY),
      defaultModel:
        process.env.HF_MODEL || process.env.hf_model || "Qwen/Qwen2.5-7B-Instruct",
    })
  );
}

function sendKosisConfig(res) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      kosisConfigured: Boolean(KOSIS_API_KEY),
    })
  );
}

async function proxyKosis(req, res) {
  const reqUrl = new URL(req.url, "http://x");
  const endpoint = reqUrl.searchParams.get("endpoint") || "";
  if (!KOSIS_ALLOWED_ENDPOINTS.has(endpoint)) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: {
          message:
            "endpoint는 statisticsList, statisticsData, statisticsExplData, Param/statisticsParameterData 중 하나여야 합니다.",
        },
      })
    );
    return;
  }

  if (!KOSIS_API_KEY) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: {
          message:
            "KOSIS API 키가 없습니다. 프로젝트 루트 .env 에 KOSIS_API_KEY= 를 설정하세요.",
        },
      })
    );
    return;
  }

  const upstreamParams = new URLSearchParams();
  for (const [key, value] of reqUrl.searchParams.entries()) {
    if (key === "endpoint") continue;
    upstreamParams.append(key, value);
  }
  if (!upstreamParams.has("apiKey")) {
    upstreamParams.set("apiKey", KOSIS_API_KEY);
  }

  const upstreamUrl =
    KOSIS_OPENAPI_BASE.replace(/\/$/, "") +
    "/" +
    endpoint +
    ".do?" +
    upstreamParams.toString();

  try {
    const upstream = await httpsGet(upstreamUrl);
    res.writeHead(upstream.status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(upstream.text);
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: { message: geminiFetchErrorMessage(err) },
      })
    );
  }
}

async function proxyHf(req, res) {
  let parsed;
  try {
    parsed = JSON.parse((await readBody(req)).toString("utf8"));
  } catch {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { message: "Invalid JSON body" } }));
    return;
  }

  const { model, payload } = parsed;
  const apiKey = parsed.apiKey || HF_API_KEY;

  if (!model || !payload) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: { message: "model and payload are required" },
      })
    );
    return;
  }

  if (!apiKey) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: {
          message:
            "Hugging Face 토큰이 없습니다. .env 에 HF_API_KEY= 를 설정하세요.",
        },
      })
    );
    return;
  }

  const useChat = Boolean(payload && payload.messages);
  const url = useChat
    ? "https://router.huggingface.co/v1/chat/completions"
    : hfInferenceUrl(model);
  const postBody = useChat ? { model, ...payload } : payload;

  try {
    const upstream = await httpsPost(url, postBody, {
      Authorization: "Bearer " + apiKey,
    });
    if (!upstream.status || upstream.status >= 400) {
      let message = upstream.text;
      try {
        const j = JSON.parse(upstream.text);
        if (j && typeof j.error === "string") message = j.error;
        else if (j && j.error && j.error.message) message = j.error.message;
        else if (j && j.message) message = j.message;
      } catch {
        /* keep raw */
      }
      res.writeHead(upstream.status || 502, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify({ error: { message: String(message).slice(0, 500) } }));
      return;
    }
    res.writeHead(upstream.status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(upstream.text);
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: { message: geminiFetchErrorMessage(err) },
      })
    );
  }
}

function serveStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (pathname === "/") pathname = "/index.html";
  // Support folder-style routes like /apps/foo/ → /apps/foo/index.html
  if (pathname.endsWith("/")) pathname = pathname + "index.html";

  const base = path.basename(pathname);
  if (base === ".env" || base.startsWith(".env.")) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  let filePath = path.resolve(ROOT, "." + pathname);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // If a directory is requested without trailing slash, try its index.html.
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch {
    /* ignore */
  }

  if (req.method === "HEAD") {
    fs.stat(filePath, (err) => {
      if (err) {
        res.writeHead(404);
        res.end();
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
      });
      res.end();
    });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  cors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/api/config" && req.method === "GET") {
    sendConfig(res);
    return;
  }

  if (req.url === "/api/gemini/generate" && req.method === "POST") {
    await proxyGemini(req, res);
    return;
  }

  if (req.url === "/api/hf/config" && req.method === "GET") {
    sendHfConfig(res);
    return;
  }

  if (req.url === "/api/hf/generate" && req.method === "POST") {
    await proxyHf(req, res);
    return;
  }

  if (req.url === "/api/kosis/config" && req.method === "GET") {
    sendKosisConfig(res);
    return;
  }

  if (req.url.startsWith("/api/kosis/proxy") && req.method === "GET") {
    await proxyKosis(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`Visual Content Lab → http://localhost:${PORT}`);
  console.log(`News verification → http://localhost:${PORT}/apps/news-verification/`);
  console.log(`News verification (Open/HF) → http://localhost:${PORT}/apps/news-verification-open/`);
  if (GEMINI_API_KEY) {
    console.log("Gemini API: .env 키 사용 중");
  } else {
    console.warn("Gemini API: .env 에 gemini_api_key 가 없습니다.");
  }
  if (HF_API_KEY) {
    console.log("Hugging Face API: .env 키 사용 중");
  } else {
    console.warn("Hugging Face API: .env 에 HF_API_KEY 가 없습니다.");
  }
  if (KOSIS_API_KEY) {
    console.log("KOSIS API: .env 키 사용 중");
  } else {
    console.warn("KOSIS API: .env 에 KOSIS_API_KEY 가 없습니다.");
  }
  if (INSECURE_SSL) {
    console.warn(
      "HTTPS SSL: GEMINI_INSECURE_SSL/HF_INSECURE_SSL=1 (로컬·회사망 프록시용, 인증서 검증 생략)"
    );
  }
});
