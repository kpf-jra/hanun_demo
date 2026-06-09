(function () {
  window.__NVO_APP_STARTED = true;
  const BUILD = "2026-05-26-open-2";
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

  const NVO = window.NVO_CONFIG || window.NV_CONFIG || {};
  const IS_LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const PROXY_BASE = (NVO.proxyUrl || "").replace(/\/$/, "");
  const STORAGE_KEY = "nvo-hf-token";
  const DEFAULT_MODEL = "Qwen/Qwen2.5-7B-Instruct";
  const PDF_LIB_URLS = [
    "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
    "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
  ];

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

  let pdfLibsLoadPromise = null;
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.crossOrigin = "anonymous";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("PDF 라이브러리 CDN 연결 실패: " + url));
      document.head.appendChild(s);
    });
  }

  function loadHtml2Pdf() {
    if (getPdfLibs().html2canvasFn && getPdfLibs().JsPDF) {
      return Promise.resolve();
    }
    if (pdfLibsLoadPromise) return pdfLibsLoadPromise;
    pdfLibsLoadPromise = (async () => {
      for (const url of PDF_LIB_URLS) {
        await loadScript(url);
      }
      if (!getPdfLibs().html2canvasFn || !getPdfLibs().JsPDF) {
        throw new Error("PDF 라이브러리(html2canvas/jsPDF)를 찾을 수 없습니다.");
      }
    })();
    return pdfLibsLoadPromise;
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
  const PDF_MAX_CANVAS_PX = 16384;

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

  function pdfInnerPageSizeMm(JsPDF) {
    const probe = new JsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = probe.internal.pageSize.getWidth();
    const pageH = probe.internal.pageSize.getHeight();
    return {
      innerW: pageW - PDF_MARGIN_MM * 2,
      innerH: pageH - PDF_MARGIN_MM * 2,
    };
  }

  function pdfPageCssHeight(innerW, innerH) {
    return Math.floor((innerH / innerW) * PDF_INNER_W_PX);
  }

  function choosePdfScale(cssHeight) {
    return cssHeight * 2 <= PDF_MAX_CANVAS_PX ? 2 : 1;
  }

  async function beginPdfSaveDialog(filename) {
    if (!window.showSaveFilePicker) return null;
    try {
      return await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }],
      });
    } catch (err) {
      if (err && err.name === "AbortError") {
        const cancel = new Error("PDF 저장이 취소되었습니다.");
        cancel.name = "AbortError";
        throw cancel;
      }
      return null;
    }
  }

  async function commitPdfSave(pdf, filename, fileHandle) {
    const blob = pdf.output("blob");
    if (fileHandle) {
      const w = await fileHandle.createWritable();
      await w.write(blob);
      await w.close();
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  async function capturePdfSlice(rootEl, y, chunkH, scale) {
    const { html2canvasFn } = getPdfLibs();
    const totalH = Math.max(Math.ceil(rootEl.scrollHeight), chunkH);
    return html2canvasFn(rootEl, {
      scale,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      scrollX: 0,
      scrollY: 0,
      width: PDF_INNER_W_PX,
      height: chunkH,
      windowWidth: PDF_INNER_W_PX,
      windowHeight: totalH,
      onclone: (doc) => {
        const host = doc.getElementById("nv-pdf-print-host");
        if (!host) return;
        host.style.overflow = "hidden";
        host.style.height = chunkH + "px";
        const wrap = host.querySelector(".nv-pdf-capture-wrap");
        if (wrap) {
          wrap.style.transform = "translateY(-" + y + "px)";
        }
      },
    });
  }

  async function exportPdfFromElement(rootEl, filename, fileHandle) {
    const { html2canvasFn, JsPDF } = getPdfLibs();
    if (!html2canvasFn || !JsPDF) {
      throw new Error("PDF 라이브러리(html2canvas/jsPDF)를 찾을 수 없습니다.");
    }

    const totalH = Math.max(Math.ceil(rootEl.scrollHeight), 200);
    const { innerW, innerH } = pdfInnerPageSizeMm(JsPDF);
    const pageCssH = pdfPageCssHeight(innerW, innerH);
    const scale = choosePdfScale(pageCssH);
    const pdf = new JsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

    let pageIdx = 0;
    for (let y = 0; y < totalH; y += pageCssH) {
      const chunkH = Math.min(pageCssH, totalH - y);
      const canvas = await capturePdfSlice(rootEl, y, chunkH, scale);
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      const drawH = (canvas.height * innerW) / canvas.width;
      if (pageIdx > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", PDF_MARGIN_MM, PDF_MARGIN_MM, innerW, drawH);
      pageIdx += 1;
    }

    if (pageIdx === 0) {
      throw new Error("PDF에 담을 내용이 없습니다.");
    }
    await commitPdfSave(pdf, filename, fileHandle);
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
        'GitHub Pages: <code>config.public.open.js</code> 에 Worker <code>proxyUrl</code> 을 넣어 주세요.';
      keyOverrideEl.classList.remove("nv-hidden");
      loadStoredApiKey();
      return;
    }

    const configUrl = apiUrl("/api/hf/config");
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
      serverHasKey = Boolean(cfg.hfConfigured);
      const def = cfg.defaultModel || DEFAULT_MODEL;
      if (modelEl.querySelector('option[value="' + def + '"]')) {
        modelEl.value = def;
      }
      if (serverHasKey) {
        apiStatusEl.textContent = IS_LOCAL
          ? "로컬 서버(.env) Hugging Face 토큰 연결됨. 검토를 시작할 수 있습니다."
          : "공용 HF 토큰이 설정되어 있습니다. 토큰 입력 없이 검토를 시작할 수 있습니다.";
        keyOverrideEl.classList.add("nv-hidden");
      } else {
        loadStoredApiKey();
        apiStatusEl.innerHTML = IS_LOCAL
          ? '.env에 <code>HF_API_KEY</code>가 없습니다. 아래에 토큰을 입력하거나 .env 설정 후 <code>node server.mjs</code> 재시작.'
          : '본인 <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener">Hugging Face 토큰</a>(Read)을 입력하세요. (기본 모델: ' +
            DEFAULT_MODEL +
            ")";
        keyOverrideEl.classList.remove("nv-hidden");
      }
    } catch (err) {
      const hint = (err&&err.message) || String(err);
      const timedOut = (err&&err.name) === "AbortError" || (err&&err.name) === "TimeoutError";
      if (IS_LOCAL) {
        apiStatusEl.innerHTML =
          '<span style="color:var(--red)">로컬 API 연결 실패.</span> ' +
          "<code>node server.mjs</code> 실행 후 " +
          '<a href="http://localhost:3456/apps/news-verification-open/">http://localhost:3456/apps/news-verification-open/</a> ' +
          "으로 여세요. (파일 더블클릭/file:// 불가)" +
          (timedOut ? "<br><small>12초 안에 응답 없음 — 서버가 꺼져 있을 수 있습니다.</small>" : "") +
          (hint ? "<br><small>오류: " + hint + "</small>" : "");
      } else {
        apiStatusEl.innerHTML =
          '<span style="color:var(--red)">Worker 연결 실패.</span> ' +
          "<code>config.public.open.js</code> 의 <code>proxyUrl</code> 확인. " +
          (PROXY_BASE
            ? '<a href="' +
              PROXY_BASE +
              '/api/hf/config" target="_blank" rel="noopener">' +
              PROXY_BASE +
              "/api/hf/config</a> "
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

  function formatHfError(status, raw) {
    const msg = raw || "";
    if (/SELF_SIGNED_CERT|certificate/i.test(msg)) {
      return (
        "HTTPS 인증서 검증 실패(회사망·백신 가능). .env 에 GEMINI_INSECURE_SSL=1 을 넣고 node server.mjs 를 재시작하세요."
      );
    }
    if (/ENOTFOUND|api-inference\.huggingface/i.test(msg)) {
      return (
        "Hugging Face API 주소 오류입니다. server.mjs 를 최신으로 맞춘 뒤 서버를 재시작하세요. (구 api-inference 엔드포인트 폐지)"
      );
    }
    if (
      status === 502 ||
      status === 504 ||
      /error code:\s*502/i.test(msg) ||
      /bad gateway/i.test(msg)
    ) {
      if (msg && !/^error code:/i.test(msg.trim()) && msg.length > 12) {
        return "로컬 프록시/연결 오류(502): " + msg.slice(0, 280);
      }
      return (
        "프록시 연결 오류(502). 서버(node server.mjs) 재시작, .env HF_API_KEY, " +
        "또는 모델을 google/gemma-2-2b-it 로 바꿔 보세요."
      );
    }
    if (
      status === 503 ||
      /loading/i.test(msg) ||
      /currently loading/i.test(msg)
    ) {
      return (
        "Hugging Face 모델이 로딩 중입니다(503). 잠시 후 자동 재시도되거나, " +
        "더 작은 모델(google/gemma-2-2b-it)을 선택해 보세요."
      );
    }
    if (status === 429 || /rate limit/i.test(msg)) {
      return (
        "Hugging Face API 한도 초과(429). 토큰을 확인하거나 잠시 후 다시 시도하세요."
      );
    }
    if (status === 400 && /not supported/i.test(msg)) {
      return (
        "이 모델은 현재 HF 무료 Inference에서 지원되지 않습니다. 모델을 Qwen/Qwen2.5-7B-Instruct 로 바꿔 보세요. (" +
        msg.slice(0, 120) +
        ")"
      );
    }
    if (/not valid JSON/i.test(msg) || /^error code:/i.test(msg.trim())) {
      return formatHfError(502, msg);
    }
    return msg || "Hugging Face API 오류 (" + status + ")";
  }

  function parseHfEstimatedSeconds(raw, data) {
    if (data && typeof data.estimated_time === "number") {
      return Math.min(120, Math.max(5, data.estimated_time));
    }
    const m = String(raw || "").match(/estimated_time["\s:]+(\d+)/i);
    return m ? Math.min(120, Math.max(5, Number(m[1]))) : 25;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function hfGenerate(model, payload) {
    const apiKey = resolveApiKey();
    if (apiKey === "") {
      throw new Error(
        needsUserKey()
          ? "Hugging Face 토큰을 입력하세요. (huggingface.co/settings/tokens 에서 Read 권한 발급)"
          : ".env에 HF_API_KEY가 없습니다. .env 설정 후 서버 재시작, 또는 아래에 토큰을 입력하세요."
      );
    }
    const body = { model, payload };
    if (apiKey) body.apiKey = apiKey;

    const retryable = (status, raw) =>
      status === 502 ||
      status === 503 ||
      status === 504 ||
      status === 429 ||
      /error code:\s*502/i.test(raw) ||
      /loading/i.test(raw) ||
      /currently loading/i.test(raw);

    for (let attempt = 1; attempt <= 4; attempt++) {
      let res;
      try {
        res = await fetch(apiUrl("/api/hf/generate"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (e) {
        throw new Error(
          PROXY_BASE
            ? "API 연결 실패. config.public.open.js 의 proxyUrl 과 Worker(HF 경로) 배포를 확인하세요."
            : "API 연결 실패. node server.mjs 로 로컬 서버를 실행하세요."
        );
      }
      const { data, text } = await readResponseBody(res);
      if (res.ok) {
        if (!data) {
          throw new Error("HF 응답이 JSON이 아닙니다: " + (text.slice(0, 120) || "(empty)"));
        }
        return data;
      }

      let raw = (data && data.error && data.error.message) || text || "";
      if (data && data.error && typeof data.error === "object" && data.error.message) {
        raw = data.error.message;
      }
      if (retryable(res.status, raw) && attempt < 4) {
        const waitSec =
          res.status === 503
            ? parseHfEstimatedSeconds(raw, data)
            : 12 * attempt;
        progressText.textContent =
          "Hugging Face 대기 중… " +
          attempt +
          "/4 (" +
          waitSec +
          "초 후 재시도)";
        await sleep(waitSec * 1000);
        continue;
      }
      throw new Error(formatHfError(res.status, raw));
    }
    throw new Error("Hugging Face API 요청 실패");
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

  function getHfTextFromResponse(data, sectionName) {
    if (typeof data === "string" && data.trim()) return data;
    if (Array.isArray(data)) {
      const first = data[0];
      if (first && first.generated_text) return String(first.generated_text);
      if (typeof first === "string") return first;
    }
    if (data && data.generated_text) return String(data.generated_text);
    if (data && data.choices && data.choices[0]) {
      const c = data.choices[0];
      const t =
        (c.message && c.message.content) || c.text || "";
      if (String(t).trim()) return String(t);
    }
    throw new Error(
      sectionName +
        " 응답 본문이 비어 있습니다. 더 작은 모델을 선택하거나 기사를 짧게 해 보세요."
    );
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

  async function callLlmOnce(
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

    const payload = {
      messages: [{ role: "user", content: prompt }],
      max_tokens: compact ? 2048 : 4096,
      temperature: 0.15,
    };

    const data = await hfGenerate(model, payload);
    const raw = getHfTextFromResponse(data, sectionName);
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

  async function callLlm(model, articleText, sectionItems, sectionName) {
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
        items = await callLlmOnce(model, articleText, chunk, label, false);
      } catch (firstErr) {
        if (!/JSON 파싱|응답 본문/.test(firstErr.message)) throw firstErr;
        progressText.textContent = "「" + label + "」 재시도(간략 형식)…";
        await sleep(1200);
        items = await callLlmOnce(model, articleText, chunk, label, true);
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

    const data = await hfGenerate(model, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 512,
      temperature: 0.4,
    });
    const summaryText = getHfTextFromResponse(data, "요약").trim();
    return summaryText || "요약을 생성하지 못했습니다.";
  }

  $("#nv-analyze").addEventListener("click", async () => {
    hideError();
    resultsEl.classList.remove("nv-on");

    if (resolveApiKey() === "") {
      showError(
        needsUserKey()
          ? "Hugging Face 토큰을 입력하세요."
          : ".env에 HF_API_KEY가 없습니다. .env 설정 후 서버 재시작, 또는 토큰을 입력하세요."
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
        const items = await callLlm(model, articleText, sectionItems, sec);
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
      "news-verification-open-" +
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

    const fname = pdfFilename();
    let fileHandle = null;
    try {
      fileHandle = await beginPdfSaveDialog(fname);
    } catch (e) {
      if (e && e.name === "AbortError") {
        btn.disabled = false;
        btn.textContent = prev;
        return;
      }
    }

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

      await exportPdfFromElement(printHost, fname, fileHandle);

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
    a.download = "news-verification-open-result.json";
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