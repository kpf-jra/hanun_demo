(function () {
  window.__NV_APP_STARTED = true;
  // If the page looks "stuck" at "설정 확인 중…", this build stamp helps verify
  // whether the latest HTML was actually deployed / hard-refreshed.
  const BUILD = "2026-05-26.5";
  const apiStatusEarly = document.getElementById("nv-api-status");
  if (apiStatusEarly) {
    apiStatusEarly.textContent = "설정 확인 중… (build " + BUILD + ")";
  }
  window.addEventListener("error", (ev) => {
    const el = document.getElementById("nv-api-status");
    if (!el) return;
    const msg = (ev&&ev.error&&ev.error.message) || (ev&&ev.message) || "알 수 없는 스크립트 오류";
    el.innerHTML =
      '<span style="color:#b91c1c">스크립트 오류로 중단됨.</span> ' +
      "<small>" +
      String(msg).replace(/</g, "&lt;") +
      "</small>";
  });

  const NV = window.NV_CONFIG || {};
  const IS_LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const PROXY_BASE = (NV.proxyUrl || "").replace(/\/$/, "");
  const STORAGE_KEY = "nv-gemini-api-key";
  const HTML2PDF_URL =
    "https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js";

  function needsUserKey() {
    return !serverHasKey;
  }

  /** 로컬(server.mjs)에서는 항상 같은 출처 — config의 proxyUrl 무시 */
  function apiUrl(path) {
    if (IS_LOCAL) return path;
    return PROXY_BASE ? PROXY_BASE + path : path;
  }

  async function fetchWithTimeout(url, options, ms) {
    // Some environments can "hang" without resolving fetch (extensions / network middleboxes).
    // Use Promise.race timeout so UI always progresses.
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutErr = new Error("Timeout (" + ms + "ms) @ " + url);
    timeoutErr.name = "TimeoutError";
    let timer;
    const timeoutP = new Promise((_, reject) => {
      timer = setTimeout(() => {
        try {
          if (ctrl) ctrl.abort();
        } catch {
          /* ignore */
        }
        reject(timeoutErr);
      }, ms);
    });
    try {
      const fetchP = fetch(url, ctrl ? { ...options, signal: ctrl.signal } : options);
      return await Promise.race([fetchP, timeoutP]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function readResponseBody(res) {
    const text = await res.text();
    if (!text.trim()) return { data: null, text: "" };
    try {
      return { data: JSON.parse(text), text };
    } catch {
      return { data: null, text };
    }
  }

  let html2pdfLoadPromise = null;
  function loadHtml2Pdf() {
    if (window.html2pdf) return Promise.resolve();
    if (html2pdfLoadPromise) return html2pdfLoadPromise;
    html2pdfLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = HTML2PDF_URL;
      s.crossOrigin = "anonymous";
      s.onload = () =>
        window.html2pdf ? resolve() : reject(new Error("html2pdf 로드 실패"));
      s.onerror = () => reject(new Error("PDF 라이브러리 CDN 연결 실패"));
      document.head.appendChild(s);
    });
    return html2pdfLoadPromise;
  }

  function getPdfLibs() {
    const html2canvasFn = window.html2canvas;
    const JsPDF =
      (window.jspdf && window.jspdf.jsPDF) ||
      window.jsPDF ||
      (window.jspdf && window.jspdf.default);
    return { html2canvasFn, JsPDF };
  }

  /** A4 본문 폭(210−10−10=190mm)을 CSS 96dpi px로 고정 — mm·DPI·줌마다 달라지는 여백 방지 */
  const PDF_MARGIN_MM = 10;
  const PDF_INNER_W_PX = Math.round((190 * 96) / 25.4);

  function mountPdfPrintHost(sheet) {
    const printHost = document.createElement("div");
    printHost.id = "nv-pdf-print-host";
    printHost.style.width = PDF_INNER_W_PX + "px";
    printHost.style.maxWidth = PDF_INNER_W_PX + "px";
    const wrap = document.createElement("div");
    wrap.className = "nv-pdf-capture-wrap";
    wrap.style.width = PDF_INNER_W_PX + "px";
    wrap.style.maxWidth = PDF_INNER_W_PX + "px";
    sheet.style.width = "100%";
    sheet.style.maxWidth = "100%";
    sheet.style.margin = "0";
    wrap.appendChild(sheet);
    printHost.appendChild(wrap);
    document.body.appendChild(printHost);
    return printHost;
  }

  /** A4 좌우 10mm 여백에 맞춰 캡처·페이지 분할 (html2pdf 자동 배치로 인한 치우침 방지) */
  async function exportPdfFromElement(rootEl, filename) {
    const { html2canvasFn, JsPDF } = getPdfLibs();
    if (!html2canvasFn || !JsPDF) {
      throw new Error("PDF 라이브러리(html2canvas/jsPDF)를 찾을 수 없습니다.");
    }
    const scale = 2;
    const captureW = PDF_INNER_W_PX;
    const captureH = Math.max(Math.ceil(rootEl.scrollHeight), 200);
    const canvas = await html2canvasFn(rootEl, {
      scale,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      scrollX: 0,
      scrollY: 0,
      x: 0,
      y: 0,
      width: captureW,
      height: captureH,
      windowWidth: captureW,
      windowHeight: captureH,
    });
    const pdf = new JsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const innerW = pageW - PDF_MARGIN_MM * 2;
    const innerH = pageH - PDF_MARGIN_MM * 2;
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    const imgH = (canvas.height * innerW) / canvas.width;
    let offsetY = 0;
    let page = 0;
    while (offsetY < imgH - 0.5) {
      if (page > 0) pdf.addPage();
      pdf.addImage(
        imgData,
        "JPEG",
        PDF_MARGIN_MM,
        PDF_MARGIN_MM - offsetY,
        innerW,
        imgH
      );
      offsetY += innerH;
      page += 1;
    }
    pdf.save(filename);
  }

  const CHECKLIST_URL = "../news-verification-shared/news-verification-items.json";
  const SECTIONS = [
    "취재 단계",
    "보도 단계",
    "게이트키핑 단계",
    "탐사보도",
    "사진·영상 검증",
    "온라인 허위 조작 정보의 검증",
  ];
  const STATUS_LABEL = {
    met: "충족",
    partial: "부분 충족",
    not_met: "미충족",
    na: "해당 없음",
    unknown: "기사만으로 확인 불가",
  };

  let checklist = [];
  let lastResults = null;
  let serverHasKey = false;

  const $ = (sel) => document.querySelector(sel);
  const articleEl = $("#nv-article");
  const urlEl = $("#nv-url");
  const apiKeyEl = $("#nv-api-key");
  const apiStatusEl = $("#nv-api-status");
  const keyOverrideEl = $("#nv-key-override");
  const modelEl = $("#nv-model");
  const progressEl = $("#nv-progress");
  const progressFill = $("#nv-progress-fill");
  const progressText = $("#nv-progress-text");
  const errorEl = $("#nv-error");
  const resultsEl = $("#nv-results");

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove("nv-hidden");
  }
  function hideError() {
    errorEl.classList.add("nv-hidden");
  }

  function setProgress(pct, text) {
    progressEl.classList.add("nv-on");
    progressFill.style.width = pct + "%";
    progressText.textContent = text;
  }
  function hideProgress() {
    progressEl.classList.remove("nv-on");
  }

  // Tabs
  document.querySelectorAll(".nv-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".nv-tab").forEach((t) => t.setAttribute("aria-selected", "false"));
      document.querySelectorAll(".nv-panel").forEach((p) => {
        p.classList.remove("nv-on");
        p.hidden = true;
      });
      tab.setAttribute("aria-selected", "true");
      const panel = document.getElementById(tab.getAttribute("aria-controls"));
      panel.classList.add("nv-on");
      panel.hidden = false;
    });
  });

  function loadStoredApiKey() {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) apiKeyEl.value = saved;
  }

  function persistApiKey() {
    const k = apiKeyEl.value.trim();
    if (k) sessionStorage.setItem(STORAGE_KEY, k);
  }

  async function initServerConfig() {
    if (!IS_LOCAL && !PROXY_BASE) {
      apiStatusEl.innerHTML =
        'GitHub Pages: <code>config.public.js</code> 에 Worker <code>proxyUrl</code> 을 넣어 주세요.';
      keyOverrideEl.classList.remove("nv-hidden");
      loadStoredApiKey();
      return;
    }

    const configUrl = apiUrl("/api/config");
    // Make sure the user sees that JS is alive.
    apiStatusEl.textContent = "설정 확인 중… (서버 응답 대기)";
    try {
      const res = await fetchWithTimeout(configUrl, {}, 12000);
      const { data: cfg, text: cfgText } = await readResponseBody(res);
      if (!res.ok) {
        throw new Error(
          (cfg && cfg.error && cfg.error.message) ||
            cfgText ||
            "HTTP " + res.status + " @ " + configUrl
        );
      }
      if (!cfg) {
        throw new Error(cfgText || "설정 응답이 JSON이 아닙니다.");
      }
      serverHasKey = Boolean(cfg.geminiConfigured);
      if (modelEl.querySelector('option[value="gemini-flash-latest"]')) {
        modelEl.value = "gemini-flash-latest";
      }
      if (serverHasKey) {
        apiStatusEl.textContent = IS_LOCAL
          ? "로컬 서버(.env) API 키 연결됨. 검토를 시작할 수 있습니다."
          : "공용 API 키가 설정되어 있습니다. 키 입력 없이 검토를 시작할 수 있습니다.";
        keyOverrideEl.classList.add("nv-hidden");
      } else {
        loadStoredApiKey();
        apiStatusEl.innerHTML = IS_LOCAL
          ? '.env에 <code>gemini_api_key</code>가 없습니다. 아래에 키를 입력하거나 .env 설정 후 <code>node server.mjs</code> 재시작.'
          : '본인 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Gemini API 키</a>를 입력하세요. (기본 모델: gemini-flash-latest)';
        keyOverrideEl.classList.remove("nv-hidden");
      }
    } catch (err) {
      const hint = (err&&err.message) || String(err);
      const timedOut = (err&&err.name) === "AbortError" || (err&&err.name) === "TimeoutError";
      if (IS_LOCAL) {
        apiStatusEl.innerHTML =
          '<span style="color:var(--red)">로컬 API 연결 실패.</span> ' +
          "<code>node server.mjs</code> 실행 후 " +
          '<a href="http://localhost:3456/apps/news-verification/">http://localhost:3456/apps/news-verification/</a> ' +
          "으로 여세요. (파일 더블클릭/file:// 불가)" +
          (timedOut ? "<br><small>12초 안에 응답 없음 — 서버가 꺼져 있을 수 있습니다.</small>" : "") +
          (hint ? "<br><small>오류: " + hint + "</small>" : "");
      } else {
        apiStatusEl.innerHTML =
          '<span style="color:var(--red)">Worker 연결 실패.</span> ' +
          "<code>config.public.js</code> 의 <code>proxyUrl</code> 확인. " +
          (PROXY_BASE
            ? '<a href="' +
              PROXY_BASE +
              '/api/config" target="_blank" rel="noopener">' +
              PROXY_BASE +
              "/api/config</a> "
            : "") +
          (timedOut ? "<br><small>12초 타임아웃 — Worker 주소·배포 상태를 확인하세요.</small>" : "") +
          (hint ? "<br><small>오류: " + hint + "</small>" : "");
      }
      keyOverrideEl.classList.remove("nv-hidden");
      loadStoredApiKey();
    }
  }

  async function loadChecklist() {
    const embedded = document.getElementById("nv-checklist-json");
    if ((embedded&&embedded.textContent&&embedded.textContent.trim())) {
      checklist = JSON.parse(embedded.textContent);
      return;
    }
    const res = await fetch(CHECKLIST_URL);
    if (!res.ok) throw new Error("체크리스트 JSON을 불러오지 못했습니다. 로컬에서는 간단한 웹 서버로 열어 주세요.");
    checklist = await res.json();
  }

  async function fetchFromUrl(url) {
    const normalized = url.trim();
    if (!normalized) throw new Error("URL을 입력하세요.");
    const readerUrl = "https://r.jina.ai/" + encodeURIComponent(normalized);
    const res = await fetch(readerUrl, { headers: { Accept: "text/plain" } });
    if (!res.ok) throw new Error("URL 본문 추출 실패 (" + res.status + "). 붙여넣기를 이용하세요.");
    const text = await res.text();
    if (text.length < 80) throw new Error("추출된 본문이 너무 짧습니다. 붙여넣기를 이용하세요.");
    return text;
  }

  function resolveApiKey() {
    const override = (apiKeyEl&&apiKeyEl.value&&apiKeyEl.value.trim());
    if (override) return override;
    if (!needsUserKey()) return undefined;
    return "";
  }

  function formatGeminiError(status, raw) {
    const msg = raw || "";
    if (
      status === 502 ||
      status === 504 ||
      /error code:\s*502/i.test(msg) ||
      /bad gateway/i.test(msg)
    ) {
      return (
        "프록시/Worker 연결 오류(502). Cloudflare Worker 시간 초과이거나 Gemini 응답이 너무 길 수 있습니다. " +
        "잠시 후 다시 시도하거나, 모델을 gemini-2.5-flash-lite 로 바꿔 보세요."
      );
    }
    if (
      status === 503 ||
      status === 529 ||
      /high demand/i.test(msg) ||
      /overloaded/i.test(msg) ||
      /try again later/i.test(msg)
    ) {
      return (
        "Gemini 서버가 일시적으로 바쁩니다 (수요 폭주). 1~2분 뒤 다시 시도하거나, " +
        "모델을 gemini-2.5-flash-lite 또는 gemini-flash-latest 로 바꿔 보세요."
      );
    }
    if (status === 429 || msg.includes("quota") || msg.includes("limit: 0")) {
      return (
        "Gemini API 할당량 초과(429). 모델을 gemini-flash-latest 또는 gemini-2.5-flash-lite 로 바꿔 보세요."
      );
    }
    if (/not valid JSON/i.test(msg) || /^error code:/i.test(msg.trim())) {
      return formatGeminiError(502, msg);
    }
    return msg || "Gemini API 오류 (" + status + ")";
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function geminiGenerate(model, payload) {
    const apiKey = resolveApiKey();
    if (apiKey === "") {
      throw new Error(
        needsUserKey()
          ? "Gemini API 키를 입력하세요. (Google AI Studio에서 무료 발급)"
          : ".env에 gemini_api_key가 없습니다. .env 설정 후 서버 재시작, 또는 아래에 키를 입력하세요."
      );
    }
    const body = { model, payload };
    if (apiKey) body.apiKey = apiKey;

    const retryable = (status, raw) =>
      status === 502 ||
      status === 503 ||
      status === 504 ||
      status === 529 ||
      status === 429 ||
      /error code:\s*502/i.test(raw) ||
      /high demand/i.test(raw) ||
      /overloaded/i.test(raw) ||
      /try again later/i.test(raw);

    for (let attempt = 1; attempt <= 3; attempt++) {
      let res;
      try {
        res = await fetch(apiUrl("/api/gemini/generate"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (e) {
        throw new Error(
          PROXY_BASE
            ? "API 연결 실패. config.public.js 의 proxyUrl 과 Worker 배포 상태를 확인하세요."
            : "API 연결 실패. node server.mjs 로 로컬 서버를 실행하세요."
        );
      }
      const { data, text } = await readResponseBody(res);
      if (res.ok) {
        if (!data) {
          throw new Error("Gemini 응답이 JSON이 아닙니다: " + (text.slice(0, 120) || "(empty)"));
        }
        return data;
      }

      const raw = (data && data.error && data.error.message) || text || "";
      if (retryable(res.status, raw) && attempt < 3) {
        progressText.textContent = `Gemini 서버 대기 중… ${attempt}/3 (${15 * attempt}초 후 재시도)`;
        await sleep(15000 * attempt);
        continue;
      }
      throw new Error(formatGeminiError(res.status, raw));
    }
    throw new Error("Gemini API 요청 실패");
  }

  $("#nv-fetch-url").addEventListener("click", async () => {
    hideError();
    const btn = $("#nv-fetch-url");
    btn.disabled = true;
    try {
      setProgress(10, "URL에서 본문을 가져오는 중…");
      const text = await fetchFromUrl(urlEl.value);
      articleEl.value = text;
      document.getElementById("tab-paste").click();
      setProgress(100, "본문을 붙여넣기 영역에 넣었습니다.");
      setTimeout(hideProgress, 1200);
    } catch (e) {
      showError(e.message);
      hideProgress();
    } finally {
      btn.disabled = false;
    }
  });

  const SECTION_BATCH_SIZE = 22;

  function getGeminiTextFromResponse(data, sectionName) {
    const cand = (data&&data.candidates&&data.candidates[0]);
    const raw =
      ((cand&&cand.content&&cand.content.parts)||[]).map((p) => p.text || "").join("") || "";
    if (raw.trim()) return raw;
    const reason = (cand&&cand.finishReason) || "";
    if (reason === "MAX_TOKENS") {
      throw new Error(
        sectionName +
          " 응답이 토큰 한도로 잘렸습니다. 모델을 gemini-2.5-flash-lite 로 바꾸거나 기사를 짧게 해 보세요."
      );
    }
    const block = (data&&data.promptFeedback&&data.promptFeedback.blockReason);
    if (block) {
      throw new Error(sectionName + " 응답 차단: " + block);
    }
    throw new Error(sectionName + " 응답 본문이 비어 있습니다.");
  }

  function extractJsonObject(text) {
    let s = String(text || "").trim();
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/g, "");
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
    return s;
  }

  function parseChecklistItemsFromText(raw, expectedIds) {
    const tries = [
      () => JSON.parse(extractJsonObject(raw)),
      () => {
        let s = extractJsonObject(raw);
        if (!s.includes('"items"')) throw new Error("no items key");
        if (!s.trimEnd().endsWith("}")) {
          s = s.replace(/,\s*"reason"\s*:\s*"[^"]*$/, "");
          s = s.replace(/,\s*$/, "");
          if (!s.endsWith("]")) s += "]";
          if (!s.endsWith("}")) s += "}";
        }
        return JSON.parse(s);
      },
      () => {
        const items = [];
        const re =
          /"id"\s*:\s*"(i\d+)"\s*,\s*"status"\s*:\s*"(met|partial|not_met|na|unknown)"(?:\s*,\s*"reason"\s*:\s*"((?:[^"\\]|\\.)*)")?/g;
        let m;
        while ((m = re.exec(raw)) !== null) {
          items.push({
            id: m[1],
            status: m[2],
            reason: (m[3] || "파싱 복구").replace(/\\"/g, '"'),
          });
        }
        if (!items.length) throw new Error("regex empty");
        return { items };
      },
    ];
    for (const fn of tries) {
      try {
        const parsed = fn();
        if ((parsed&&parsed.items&&parsed.items.length)) return parsed.items;
      } catch {
        /* next strategy */
      }
    }
    return null;
  }

  function normalizeChecklistItems(items, sectionItems) {
    const valid = new Set(["met", "partial", "not_met", "na", "unknown"]);
    const byId = {};
    (items || []).forEach((it) => {
      if (!(it&&it.id)) return;
      let status = String(it.status || "unknown").toLowerCase();
      if (!valid.has(status)) status = "unknown";
      byId[it.id] = {
        id: it.id,
        status,
        reason: String(it.reason || "").slice(0, 200) || "—",
      };
    });
    return sectionItems.map(
      (c) =>
        byId[c.id] || {
          id: c.id,
          status: "unknown",
          reason: "AI 응답 누락",
        }
    );
  }

  async function callGeminiOnce(
    model,
    articleText,
    sectionItems,
    sectionName,
    compact
  ) {
    const ids = sectionItems.map((it) => it.id).join(", ");
    const itemList = sectionItems
      .map((it) => `- ${it.id} [${it.category}] ${it.text}`)
      .join("\n");

    const reasonRule = compact
      ? 'reason은 항목마다 "-" 한 글자만.'
      : 'reason은 각 항목당 40자 이내 한국어(따옴표·줄바꿈 금지).';

    const prompt = `한국 언론 사실확인 전문가. 기사 본문만 근거로 체크리스트 판정.

status: met | partial | not_met | na | unknown
- na: 이 기사에 해당 없음
- unknown: 기사만으로 취재·내부 절차 확인 불가
${reasonRule}
반드시 아래 id 전부 포함: ${ids}

기사:
"""
${articleText.slice(0, 22000)}
"""

[${sectionName}]
${itemList}

출력(JSON만): {"items":[{"id":"i99","status":"unknown","reason":"근거"}]}`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.15,
        maxOutputTokens: 16384,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            items: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  id: { type: "STRING" },
                  status: { type: "STRING" },
                  reason: { type: "STRING" },
                },
                required: ["id", "status", "reason"],
              },
            },
          },
          required: ["items"],
        },
      },
    };

    const data = await geminiGenerate(model, body);
    const raw = getGeminiTextFromResponse(data, sectionName);
    const parsed = parseChecklistItemsFromText(raw, sectionItems);
    if (!parsed) {
      const preview = raw.slice(0, 160).replace(/\s+/g, " ");
      throw new Error(
        sectionName +
          " 응답 JSON 파싱 실패" +
          (preview ? " (응답 일부: " + preview + "…)" : "")
      );
    }
    return normalizeChecklistItems(parsed, sectionItems);
  }

  async function callGemini(model, articleText, sectionItems, sectionName) {
    const chunks = [];
    for (let i = 0; i < sectionItems.length; i += SECTION_BATCH_SIZE) {
      chunks.push(sectionItems.slice(i, i + SECTION_BATCH_SIZE));
    }

    const all = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const label =
        chunks.length > 1
          ? sectionName + " (" + (i + 1) + "/" + chunks.length + ")"
          : sectionName;

      let items;
      try {
        items = await callGeminiOnce(model, articleText, chunk, label, false);
      } catch (firstErr) {
        if (!/JSON 파싱|토큰 한도/.test(firstErr.message)) throw firstErr;
        progressText.textContent = "「" + label + "」 재시도(간략 형식)…";
        await sleep(1200);
        items = await callGeminiOnce(model, articleText, chunk, label, true);
      }
      all.push(...items);
      if (i < chunks.length - 1) await sleep(500);
    }
    return all;
  }

  function computeScore(results) {
    let met = 0,
      partial = 0,
      notMet = 0,
      unknown = 0,
      na = 0;
    let points = 0,
      applicable = 0;

    results.forEach((r) => {
      switch (r.status) {
        case "met":
          met++;
          points += 1;
          applicable++;
          break;
        case "partial":
          partial++;
          points += 0.5;
          applicable++;
          break;
        case "not_met":
          notMet++;
          applicable++;
          break;
        case "unknown":
          unknown++;
          applicable++;
          break;
        case "na":
          na++;
          break;
        default:
          unknown++;
          applicable++;
      }
    });

    const score = applicable > 0 ? Math.round((points / applicable) * 100) : 0;
    return { score, met, partial, notMet, unknown, na, applicable, points };
  }

  function renderResults(results, stats, summaryText) {
    resultsEl.classList.add("nv-on");
    $("#nv-score-display").innerHTML =
      stats.score + '<span>/100</span>';

    $("#nv-stats").innerHTML = [
      ["충족", stats.met, "nv-stat-met"],
      ["부분", stats.partial, "nv-stat-partial"],
      ["미충족", stats.notMet, "nv-stat-not"],
      ["확인불가", stats.unknown, "nv-stat-unk"],
      ["해당없음", stats.na, "nv-stat-na"],
    ]
      .map(
        ([label, n, cls]) =>
          `<span class="nv-stat ${cls}">${label} ${n}</span>`
      )
      .join("");

    $("#nv-summary").textContent = summaryText || "";

    const bySection = {};
    results.forEach((r) => {
      const item = checklist.find((c) => c.id === r.id);
      const sec = (item&&item.section) || "기타";
      if (!bySection[sec]) bySection[sec] = [];
      bySection[sec].push({ ...r, item });
    });

    const container = $("#nv-sections");
    container.innerHTML = "";

    SECTIONS.forEach((sec) => {
      const items = bySection[sec];
      if (!(items&&items.length)) return;
      const secMet = items.filter((x) => x.status === "met").length;
      const secApp = items.filter((x) => x.status !== "na").length;

      const wrap = document.createElement("div");
      wrap.className = "nv-section nv-open";
      wrap.innerHTML =
        `<button type="button" class="nv-section-hd" aria-expanded="true">
          <span>${sec}</span>
          <span>${secMet}/${secApp} 충족</span>
        </button>
        <div class="nv-section-bd"></div>`;

      const bd = wrap.querySelector(".nv-section-bd");
      items.forEach((row) => {
        const div = document.createElement("div");
        div.className = "nv-item nv-item-" + row.status;
        const text = (row.item&&row.item.text) || row.id;
        const cat = (row.item&&row.item.category) || "";
        div.innerHTML =
          `<div class="nv-item-hd">
            <span class="nv-pill">${STATUS_LABEL[row.status] || row.status}</span>
            <span class="nv-cat">${cat}</span>
          </div>
          <p style="margin:0 0 0.35rem;font-weight:800">${text}</p>
          <p class="nv-reason">${row.reason || ""}</p>`;
        bd.appendChild(div);
      });

      wrap.querySelector(".nv-section-hd").addEventListener("click", () => {
        wrap.classList.toggle("nv-open");
      });
      container.appendChild(wrap);
    });

    resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function buildSummary(model, articleText, stats) {
    const prompt = `다음은 뉴스 기사에 대한 사실확인 체크리스트 AI 검토 결과입니다.
점수: ${stats.score}/100 (적용 항목 ${stats.applicable}개 중 충족 ${stats.met}, 부분 ${stats.partial}, 미충족 ${stats.notMet}, 기사만으로 확인불가 ${stats.unknown})

기자에게 전달할 3~5문장 한국어 요약(강점, 보완점, 우선 조치)을 작성하세요. 기사 일부:
"""
${articleText.slice(0, 4000)}
"""`;

    const data = await geminiGenerate(model, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
    });
    const parts0 =
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0];
    const summaryText =
      parts0 && parts0.text ? String(parts0.text).trim() : "";
    return summaryText || "요약을 생성하지 못했습니다.";
  }

  $("#nv-analyze").addEventListener("click", async () => {
    hideError();
    resultsEl.classList.remove("nv-on");

    if (resolveApiKey() === "") {
      showError(
        needsUserKey()
          ? "Gemini API 키를 입력하세요."
          : ".env에 gemini_api_key가 없습니다. .env 설정 후 서버 재시작, 또는 API 키를 입력하세요."
      );
      return;
    }
    persistApiKey();

    let articleText = articleEl.value.trim();
    if (!articleText && urlEl.value.trim()) {
      try {
        setProgress(5, "URL에서 본문 가져오는 중…");
        articleText = await fetchFromUrl(urlEl.value);
        articleEl.value = articleText;
      } catch (e) {
        showError(e.message);
        hideProgress();
        return;
      }
    }
    if (articleText.length < 100) {
      showError("기사 본문이 너무 짧습니다 (100자 이상).");
      return;
    }

    if (!checklist.length) {
      try {
        await loadChecklist();
      } catch (e) {
        showError(e.message);
        return;
      }
    }

    const model = modelEl.value;
    const btn = $("#nv-analyze");
    btn.disabled = true;
    const allResults = [];
    const mapById = {};

    try {
      let step = 0;
      const total = SECTIONS.length + 1;

      for (const sec of SECTIONS) {
        step++;
        setProgress(
          Math.round((step / total) * 90),
          `「${sec}」 검토 중… (${step}/${SECTIONS.length})`
        );
        const sectionItems = checklist.filter((c) => c.section === sec);
        const items = await callGemini(model, articleText, sectionItems, sec);
        items.forEach((it) => {
          mapById[it.id] = it;
        });
        await new Promise((r) => setTimeout(r, 400));
      }

      checklist.forEach((c) => {
        const r = mapById[c.id] || {
          id: c.id,
          status: "unknown",
          reason: "AI 응답 누락",
        };
        allResults.push(r);
      });

      const stats = computeScore(allResults);
      setProgress(95, "종합 요약 작성 중…");
      let summaryText = "";
      try {
        summaryText = await buildSummary(model, articleText, stats);
      } catch {
        summaryText =
          "점수 " +
          stats.score +
          "점 — 충족 " +
          stats.met +
          " · 부분 " +
          stats.partial +
          " · 미충족 " +
          stats.notMet +
          " · 확인불가 " +
          stats.unknown;
      }

      lastResults = {
        stats,
        results: allResults,
        articleText,
        summaryText,
        model,
        generatedAt: new Date().toISOString(),
      };
      renderResults(allResults, stats, summaryText);
      setProgress(100, "완료");
      setTimeout(hideProgress, 1500);
    } catch (e) {
      showError(e.message);
      hideProgress();
    } finally {
      btn.disabled = false;
    }
  });

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pdfFilename() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return (
      "news-verification-" +
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      "-" +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      ".pdf"
    );
  }

  function buildPdfReportEl(data) {
    const { stats, results, summaryText, model, generatedAt, articleText } = data;
    const when = generatedAt
      ? new Date(generatedAt).toLocaleString("ko-KR")
      : new Date().toLocaleString("ko-KR");
    const headline = (articleText || "").trim().split(/\n/)[0].slice(0, 120);

    const rows = results.map((r) => {
      const item = checklist.find((c) => c.id === r.id);
      return { ...r, item };
    });

    const priority = rows.filter(
      (r) => r.status === "not_met" || r.status === "partial"
    );

    const bySection = {};
    SECTIONS.forEach((sec) => {
      const items = rows.filter((r) => (r.item && r.item.section) === sec);
      if (items.length) bySection[sec] = items;
    });

    function tableRows(items) {
      return items
        .map((row) => {
          const text = (row.item&&row.item.text) || row.id;
          const cat = (row.item&&row.item.category) || "";
          const st = row.status || "unknown";
          return (
            "<tr>" +
            '<td><span class="nv-pdf-pill nv-pdf-pill-' +
            escapeHtml(st) +
            '">' +
            escapeHtml(STATUS_LABEL[st] || st) +
            "</span></td>" +
            "<td>" +
            escapeHtml(cat) +
            "</td>" +
            "<td>" +
            escapeHtml(text) +
            "</td>" +
            "<td>" +
            escapeHtml(row.reason || "—") +
            "</td></tr>"
          );
        })
        .join("");
    }

    const priorityHtml = priority.length
      ? '<section class="nv-pdf-priority"><h2>우선 보완 항목 (' +
        priority.length +
        ")</h2><table class=\"nv-pdf-table\"><thead><tr><th>상태</th><th>분류</th><th>항목</th><th>근거</th></tr></thead><tbody>" +
        tableRows(priority.slice(0, 40)) +
        (priority.length > 40
          ? '<tr><td colspan="4">… 외 ' +
            (priority.length - 40) +
            "건 (전체 목록은 아래 섹션 참고)</td></tr>"
          : "") +
        "</tbody></table></section>"
      : "";

    const sectionsHtml = SECTIONS.map((sec) => {
      const items = bySection[sec];
      if (!(items&&items.length)) return "";
      const secMet = items.filter((x) => x.status === "met").length;
      const secApp = items.filter((x) => x.status !== "na").length;
      return (
        '<section class="nv-pdf-sec"><h2>' +
        escapeHtml(sec) +
        " (" +
        secMet +
        "/" +
        secApp +
        ' 충족)</h2><table class="nv-pdf-table"><thead><tr><th>상태</th><th>분류</th><th>항목</th><th>근거</th></tr></thead><tbody>' +
        tableRows(items) +
        "</tbody></table></section>"
      );
    }).join("");

    const el = document.createElement("div");
    el.className = "nv-pdf-sheet";
    el.innerHTML =
      '<header class="nv-pdf-hd">' +
      "<h1>뉴스 사실확인 체크리스트 AI 검토 리포트</h1>" +
      '<p class="nv-pdf-meta">한국언론진흥재단 부록 2 (223항) · 생성: ' +
      escapeHtml(when) +
      (model ? " · 모델: " + escapeHtml(model) : "") +
      "</p>" +
      (headline
        ? '<p class="nv-pdf-meta" style="margin-top:6px">기사: ' +
          escapeHtml(headline) +
          (headline.length >= 120 ? "…" : "") +
          "</p>"
        : "") +
      "</header>" +
      '<div class="nv-pdf-score">' +
      '<p class="nv-pdf-score-num">' +
      stats.score +
      '<span> / 100</span></p>' +
      '<div class="nv-pdf-stats">' +
      [
        ["충족", stats.met],
        ["부분", stats.partial],
        ["미충족", stats.notMet],
        ["확인불가", stats.unknown],
        ["해당없음", stats.na],
        ["적용", stats.applicable],
      ]
        .map(
          ([l, n]) =>
            '<span class="nv-pdf-stat">' + escapeHtml(l) + " " + n + "</span>"
        )
        .join("") +
      "</div></div>" +
      '<p class="nv-pdf-summary">' +
      escapeHtml(summaryText || "요약 없음") +
      "</p>" +
      priorityHtml +
      sectionsHtml +
      "<p class=\"nv-pdf-foot\">본 리포트는 AI가 기사 텍스트만을 근거로 생성한 프로토타입 결과입니다. " +
      "취재·편집·법무 판단을 대체하지 않으며, 최종 책임은 기자·데스크에 있습니다. " +
      "출처: 한국언론진흥재단 (2025), 부록 2.</p>";
    return el;
  }

  $("#nv-export-pdf").addEventListener("click", async () => {
    if (!lastResults) {
      showError("먼저 체크리스트 AI 검토를 실행하세요.");
      return;
    }

    hideError();
    const btn = $("#nv-export-pdf");
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = "PDF 준비 중…";

    try {
      await loadHtml2Pdf();
    } catch (e) {
      showError(e.message || "PDF 라이브러리 로드 실패");
      btn.disabled = false;
      btn.textContent = prev;
      return;
    }

    btn.textContent = "PDF 생성 중… (223항이면 30초~1분)";

    let printHost = null;

    try {
      const sheet = buildPdfReportEl(lastResults);
      printHost = mountPdfPrintHost(sheet);

      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      await exportPdfFromElement(printHost, pdfFilename());

      setProgress(100, "PDF 저장 완료");
      setTimeout(hideProgress, 2000);
    } catch (e) {
      showError("PDF 생성 실패: " + (e.message || String(e)));
    } finally {
      if (printHost && printHost.parentNode) {
        printHost.parentNode.removeChild(printHost);
      }
      btn.disabled = false;
      btn.textContent = prev;
    }
  });

  $("#nv-export").addEventListener("click", () => {
    if (!lastResults) return;
    const blob = new Blob([JSON.stringify(lastResults, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "news-verification-result.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  initServerConfig().catch((err) => {
    apiStatusEl.textContent = "설정 확인 오류: " + ((err&&err.message) || String(err));
    keyOverrideEl.classList.remove("nv-hidden");
    loadStoredApiKey();
  });

  loadChecklist().catch(() => {});
})();