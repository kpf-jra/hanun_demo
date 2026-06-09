/**
 * Cloudflare Worker — CORS 우회 + (선택) 공용 Gemini 키
 *
 * Dashboard → Worker → Quick edit → 아래 전체 붙여넣기 → Deploy
 * (형식: ES modules — export default { async fetch(...) } 그대로 사용)
 *
 * [공용 키] Settings → Variables → Secrets → GEMINI_API_KEY, HF_API_KEY
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

async function handleRequest(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);

  if (url.pathname === "/" && request.method === "GET") {
    return json({
      ok: true,
      service: "visual-content-gemini-proxy",
      endpoints: [
        "GET /api/config",
        "POST /api/gemini/generate",
        "GET /api/hf/config",
        "POST /api/hf/generate",
      ],
    });
  }

  if (url.pathname === "/api/config" && request.method === "GET") {
    const sharedKey = env && env.GEMINI_API_KEY;
    const hasShared = Boolean(sharedKey);
    return json({
      geminiConfigured: hasShared,
      defaultModel: (env && env.GEMINI_MODEL) || "gemini-2.5-flash-lite",
      mode: hasShared ? "shared_key" : "bring_your_own_key",
    });
  }

  if (url.pathname === "/api/hf/config" && request.method === "GET") {
    const sharedHf = env && env.HF_API_KEY;
    return json({
      hfConfigured: Boolean(sharedHf),
      defaultModel: (env && env.HF_MODEL) || "Qwen/Qwen2.5-7B-Instruct",
      mode: sharedHf ? "shared_key" : "bring_your_own_key",
    });
  }

  if (url.pathname === "/api/hf/generate" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: { message: "Invalid JSON" } }, 400);
    }

    const { model, payload, apiKey: clientKey } = body;
    const apiKey = clientKey || (env && env.HF_API_KEY);
    if (!apiKey) {
      return json(
        {
          error: {
            message:
              "HF 토큰이 없습니다. Worker Secrets에 HF_API_KEY를 넣거나, 페이지에 토큰을 입력하세요.",
          },
        },
        400
      );
    }
    if (!model || !payload) {
      return json({ error: { message: "model and payload required" } }, 400);
    }

    const useChat = Boolean(payload && payload.messages);
    const hfUrl = useChat
      ? "https://router.huggingface.co/v1/chat/completions"
      : "https://router.huggingface.co/hf-inference/models/" +
        String(model).replace(/^\/+/, "");
    const hfBody = useChat ? { model, ...payload } : payload;
    let upstream;
    try {
      upstream = await fetch(hfUrl, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(hfBody),
      });
    } catch (err) {
      return json(
        {
          error: {
            message:
              "Hugging Face API 연결 실패: " +
              (err && err.message ? err.message : String(err)),
          },
        },
        502
      );
    }

    const text = await upstream.text();
    if (!upstream.ok) {
      let message = text.slice(0, 500);
      try {
        const j = JSON.parse(text);
        if (j && typeof j.error === "string") message = j.error;
        else if (j && j.error && j.error.message) message = j.error.message;
        else if (j && j.error) message = JSON.stringify(j.error);
      } catch {
        /* plain text */
      }
      return json({ error: { message: String(message) } }, upstream.status);
    }

    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
    });
  }

  if (url.pathname === "/api/gemini/generate" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: { message: "Invalid JSON" } }, 400);
    }

    const { model, payload, apiKey: clientKey } = body;
    const apiKey = clientKey || (env && env.GEMINI_API_KEY);
    if (!apiKey) {
      return json(
        {
          error: {
            message:
              "API 키가 없습니다. Worker Secrets에 GEMINI_API_KEY를 넣거나, 페이지에 키를 입력하세요.",
          },
        },
        400
      );
    }
    if (!model || !payload) {
      return json({ error: { message: "model and payload required" } }, 400);
    }

    let upstream;
    try {
      upstream = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" +
          encodeURIComponent(model) +
          ":generateContent?key=" +
          encodeURIComponent(apiKey),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
    } catch (err) {
      return json(
        {
          error: {
            message:
              "Gemini API 연결 실패: " +
              (err && err.message ? err.message : String(err)),
          },
        },
        502
      );
    }

    const text = await upstream.text();
    if (!upstream.ok) {
      let message = text.slice(0, 500);
      try {
        const j = JSON.parse(text);
        message = (j && j.error && j.error.message) || message;
      } catch {
        /* plain text from gateway */
      }
      return json({ error: { message } }, upstream.status);
    }

    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
    });
  }

  return new Response("Not found", { status: 404, headers: CORS });
}

export default {
  async fetch(request, env, ctx) {
    const bindings = env && typeof env === "object" ? env : {};
    try {
      return await handleRequest(request, bindings);
    } catch (err) {
      return json(
        {
          error: {
            message: err?.message || String(err),
            hint: "Worker 코드를 gemini-proxy.js 최신본으로 다시 Deploy 하세요.",
          },
        },
        500
      );
    }
  },
};
