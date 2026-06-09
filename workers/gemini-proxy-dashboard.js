/**
 * Cloudflare Dashboard "Quick edit"용 (Service Worker 형식)
 * export default 가 1101 오류 나면 이 파일 전체를 붙여넣고 Deploy 하세요.
 *
 * Secrets: GEMINI_API_KEY
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
      endpoints: ["GET /api/config", "POST /api/gemini/generate"],
    });
  }

  if (url.pathname === "/api/config" && request.method === "GET") {
    const hasShared = Boolean(env && env.GEMINI_API_KEY);
    return json({
      geminiConfigured: hasShared,
      defaultModel: (env && env.GEMINI_MODEL) || "gemini-2.5-flash-lite",
      mode: hasShared ? "shared_key" : "bring_your_own_key",
    });
  }

  if (url.pathname === "/api/gemini/generate" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: { message: "Invalid JSON" } }, 400);
    }

    const model = body.model;
    const payload = body.payload;
    const clientKey = body.apiKey;
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

    var upstream;
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

    var text = await upstream.text();
    if (!upstream.ok) {
      var message = text.slice(0, 500);
      try {
        var j = JSON.parse(text);
        message = (j && j.error && j.error.message) || message;
      } catch (e) {
        /* keep raw */
      }
      return json({ error: { message: message } }, upstream.status);
    }

    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
    });
  }

  return new Response("Not found", { status: 404, headers: CORS });
}

addEventListener("fetch", function (event) {
  var env = event.env || {};
  event.respondWith(
    handleRequest(event.request, env).catch(function (err) {
      return json(
        {
          error: {
            message: err && err.message ? err.message : String(err),
          },
        },
        500
      );
    })
  );
});
