(function () {
  var ROOT = document.getElementById("unique-content-data-ai");
  if (!ROOT) return;

  var CFG = window.DATA_AI_CONFIG || {};
  var IS_LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var PROXY_BASE = (CFG.proxyUrl || "").replace(/\/$/, "");
  var STORAGE_KEY = "data-ai-gemini-api-key";
  var OFF_TOPIC_MSG =
    "이 표의 내용을 정리해드릴 수는 있지만, 이 표의 내용이 아닌 자료를 포함해서 답변을 들릴 수는 없습니다.";

  var DEFAULT_INSIGHT =
    "## 핵심 요약\n" +
    "2010년부터 2024년까지 신문산업 전체 매출액은 꾸준히 증가하는 추세를 보였으며, 특히 2022년 이후 상승세가 두드러집니다. 이러한 성장은 주로 인터넷신문 부문의 폭발적인 매출 증가에 기인합니다.\n\n" +
    "## 주요 추이\n" +
    "전체 신문산업 매출액은 2010년 3,728,580백만원에서 2024년 5,305,032백만원으로 증가했습니다. 이 기간 동안 종이신문 매출액은 다소 등락을 보이며 전반적으로 정체되거나 소폭 감소하는 경향을 나타냈습니다. 반면, 인터넷신문 매출액은 2010년 402,259백만원에서 2024년 1,509,388백만원으로 괄목할 만한 성장을 이루었습니다.\n\n" +
    "## 인사이트\n" +
    "- **인터넷신문의 급성장:** 인터넷신문 부문은 2010년 이후 지속적으로 매출이 증가했으며, 특히 최근 몇 년간 그 성장세가 가속화되어 전체 신문산업 매출 증가를 견인하고 있습니다.\n" +
    "- **종이신문의 상대적 부진:** 종이신문 매출액은 2010년 이후 큰 변동 없이 유지되거나 소폭 감소하는 추세를 보이며, 인터넷신문과의 격차가 점차 벌어지고 있습니다.\n" +
    "- **전체 산업의 성장 동력 변화:** 과거 종이신문 중심이었던 신문산업의 매출 동력이 점차 인터넷신문으로 이동하고 있음을 시사합니다.";

  var state = {
    tableData: null,
    tableText: "",
    records: [],
    serverHasKey: false,
    model: "gemini-2.5-flash",
    chatHistory: [],
    analyzing: false,
    chatting: false,
  };

  var els = {
    keyWrap: ROOT.querySelector("#dai-key-wrap"),
    apiKey: ROOT.querySelector("#dai-api-key"),
    tableWrap: ROOT.querySelector("#dai-table-wrap"),
    tableMeta: ROOT.querySelector("#dai-table-meta"),
    insightBody: ROOT.querySelector("#dai-insight-body"),
    insightBtn: ROOT.querySelector("#dai-insight-btn"),
    chatLog: ROOT.querySelector("#dai-chat-log"),
    chatInput: ROOT.querySelector("#dai-chat-input"),
    chatSend: ROOT.querySelector("#dai-chat-send"),
  };

  function apiUrl(path) {
    if (IS_LOCAL) return path;
    return PROXY_BASE ? PROXY_BASE + path : path;
  }

  function safeText(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "object" && typeof v.message === "string") return v.message;
    try {
      return JSON.stringify(v);
    } catch (_) {
      return String(v);
    }
  }

  function inlineBold(s) {
    return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  function renderInsightBody(text) {
    var html = "";
    text.split("\n").forEach(function (line) {
      var trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.indexOf("## ") === 0) {
        html += '<h3 class="dai-prose-h">' + escapeHtml(trimmed.slice(3)) + "</h3>";
        return;
      }
      if (trimmed.indexOf("- ") === 0) {
        html +=
          '<p class="dai-prose-li">• ' +
          inlineBold(escapeHtml(trimmed.slice(2))) +
          "</p>";
        return;
      }
      html += "<p>" + inlineBold(escapeHtml(trimmed)) + "</p>";
    });
    els.insightBody.innerHTML = '<div class="dai-prose">' + html + "</div>";
  }

  function showChatThinking() {
    removeChatThinking();
    var div = document.createElement("div");
    div.className = "dai-chat-msg dai-chat-msg--bot dai-chat-msg--thinking";
    div.id = "dai-chat-thinking";
    div.setAttribute("aria-busy", "true");
    div.innerHTML =
      '<span class="dai-chat-role">답변</span>' +
      '<div class="dai-chat-text dai-thinking">' +
      '<span class="dai-thinking-pulse" aria-hidden="true"></span>' +
      "답변 생성 중…" +
      "</div>";
    els.chatLog.appendChild(div);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }

  function removeChatThinking() {
    var el = document.getElementById("dai-chat-thinking");
    if (el) el.remove();
  }

  function setChatBusy(busy) {
    state.chatting = busy;
    els.chatSend.disabled = busy;
    els.chatInput.disabled = busy;
    ROOT.querySelectorAll(".dai-example-btn").forEach(function (btn) {
      btn.disabled = busy;
    });
    if (busy) {
      els.chatSend.textContent = "생성 중…";
    } else {
      els.chatSend.textContent = "질문하기";
    }
  }

  function escapeHtml(s) {
    return safeText(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatCell(v) {
    if (v === "" || v === null || v === undefined) return "";
    if (typeof v === "number" && Number.isFinite(v)) {
      return v.toLocaleString("ko-KR");
    }
    return String(v);
  }

  function isNumericCell(v) {
    return typeof v === "number" && Number.isFinite(v);
  }

  function buildAiContext(data, records) {
    var schema = data.schema || {};
    var lines = [
      "# " + data.title,
      "출처: " + data.source,
      schema.description || "",
      schema.units || "",
      schema.itemHierarchy || "",
      schema.years || "",
      "",
      "## 데이터 형식",
      "각 줄은 JSON 객체입니다. 필드: item(항목 경로), year(연도), metric(지표명), value(수치).",
      "답변 시 반드시 item·year·metric을 근거로 제시하고, value만 표에 있는 그대로 인용하세요.",
      "",
      "## 데이터",
    ];
    records.forEach(function (rec) {
      lines.push(JSON.stringify(rec));
    });
    return lines.filter(function (l) { return l !== ""; }).join("\n");
  }

  function parseNumberToken(token) {
    var n = parseInt(String(token).replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }

  function allTableYears(records) {
    var years = [];
    records.forEach(function (r) {
      var y = String(r.year);
      if (years.indexOf(y) < 0) years.push(y);
    });
    return years.sort();
  }

  function extractYearsFromQuestion(question, records) {
    var tableYears = allTableYears(records);
    var maxYear = Math.max.apply(
      null,
      tableYears.map(function (y) { return parseInt(y, 10); })
    );
    var found = question.match(/20\d{2}/g) || [];
    var unique = [];
    found.forEach(function (y) {
      if (unique.indexOf(y) < 0) unique.push(y);
    });

    var rangeHint =
      /부터|까지|~|사이|동안|기간|최근|변화|추이|증가|감소|경향|어떻게/.test(question);

    if (unique.length >= 2 && rangeHint) {
      var start = Math.min.apply(null, unique.map(function (y) { return parseInt(y, 10); }));
      var end = Math.max.apply(null, unique.map(function (y) { return parseInt(y, 10); }));
      var expanded = [];
      for (var y = start; y <= end; y++) expanded.push(String(y));
      return expanded;
    }

    if (unique.length === 1 && rangeHint) {
      var from = parseInt(unique[0], 10);
      var to = /최근|현재|지금/.test(question) ? maxYear : from;
      if (question.match(/20\d{2}/g).length >= 2) {
        to = Math.max.apply(null, question.match(/20\d{2}/g).map(function (y) { return parseInt(y, 10); }));
      }
      var range = [];
      for (var yr = from; yr <= to; yr++) range.push(String(yr));
      return range;
    }

    return unique.length ? unique : [];
  }

  function isTrendQuestion(question) {
    return /변화|추이|증가|감소|경향|늘었|줄었|올랐|내렸|비교|어떻게\s*됐|어떻게\s*변|추세|흐름/.test(
      question
    );
  }

  function isCompareQuestion(question) {
    return /비교|vs|대비|차이|어느\s*쪽|더\s*큰|더\s*많|더\s*적|높은|낮은/.test(question);
  }

  function toPlainText(text) {
    return String(text || "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^[-*]\s+/gm, "· ")
      .trim();
  }

  function buildAnswerPrompt(question, context, historyText) {
    var trend = isTrendQuestion(question);
    var compare = isCompareQuestion(question);
    var lines = [
      "당신은 통계 표 전용 해설 도우미입니다. 아래 JSON Lines만 근거로 답하세요.",
      "- 각 줄: {item, year, metric, value}",
      "- 표에 없는 수치·연도·추측은 금지.",
      "- 한국어 일반 문장으로만 답하세요.",
      "- 마크다운 문법은 절대 쓰지 마세요. (#, **, *, -, ` 등 금지)",
      "- 여러 항목은 줄바꿈 또는 「1.」「2.」 번호, 「·」로 구분하세요.",
    ];

    if (trend) {
      lines.push(
        "- 이 질문은 기간 변화·추이 질문입니다.",
        "- 제공된 데이터의 모든 연도를 빠짐없이 연도순으로 제시하세요.",
        "- 그다음 증가/감소/유지 여부와, 시작 연도·끝 연도 수치 차이(변화폭)를 설명하세요.",
        "- 중간 연도가 데이터에 있으면 빼먹지 마세요."
      );
    } else if (compare) {
      lines.push(
        "- 이 질문은 항목 비교 질문입니다.",
        "- 데이터에 있는 모든 관련 항목을 각각 빠짐없이 제시한 뒤, 어느 쪽이 더 큰지(또는 차이)를 설명하세요.",
        "- 한 항목만 있고 다른 항목이 없을 때만 \"표에 해당 정보가 없습니다\"라고 하세요."
      );
    } else {
      lines.push(
        "- 답변에 수치를 쓸 때 value를 그대로 인용하고, item·year·metric을 함께 밝히세요.",
        "- 데이터에 없으면 \"표에 해당 정보가 없습니다\"만 답하세요."
      );
    }

    lines.push(
      "",
      context,
      historyText ? "\n[이전 대화]\n" + historyText : "",
      "\n[이용자 질문]\n" + question
    );
    return lines.filter(function (l) { return l !== ""; }).join("\n");
  }

  function filterRecordsForQuestion(question, records) {
    if (!records.length) return records;

    var filtered = records.slice();
    var years = extractYearsFromQuestion(question, records);
    var nums = (question.match(/\d[\d,.\s]*\d|\d+/g) || [])
      .map(parseNumberToken)
      .filter(function (n) { return n != null && n >= 10; });

    if (nums.length && !isTrendQuestion(question)) {
      var byVal = filtered.filter(function (r) {
        return nums.indexOf(Number(r.value)) >= 0;
      });
      if (byVal.length) filtered = byVal;
    }

    if (years.length) {
      var byYear = filtered.filter(function (r) {
        return years.indexOf(String(r.year)) >= 0;
      });
      if (byYear.length) filtered = byYear;
    }

    if (
      /기업공시업체수|공시업체\s*수|업체\s*수/.test(question) ||
      (/기업공시업체/.test(question) && !/매출/.test(question))
    ) {
      var byCount = filtered.filter(function (r) {
        return r.metric.indexOf("기업공시업체수") >= 0;
      });
      if (byCount.length) filtered = byCount;
    } else if (/기업공시업체매출|공시업체\s*매출/.test(question)) {
      var bySales = filtered.filter(function (r) {
        return r.metric.indexOf("기업공시업체매출액") >= 0;
      });
      if (bySales.length) filtered = bySales;
    } else if (/매출/.test(question)) {
      var byRev = filtered.filter(function (r) {
        return r.metric.indexOf("매출액") >= 0 && r.metric.indexOf("기업공시") < 0;
      });
      if (byRev.length) filtered = byRev;
    }

    var itemTerms = [
      ["합계", "합계 / 소계 / 소계"],
      ["전체", "합계 / 소계 / 소계"],
      ["종이신문", "종이신문"],
      ["일간신문", "종이신문 / 일간"],
      ["인터넷신문", "인터넷신문"],
      ["주간신문", "종이신문 / 주간"],
      ["전국종합", "전국종합일간"],
      ["스포츠", "스포츠일간"],
      ["전문", "전문일간"],
      ["무료", "무료일간"],
      ["외국어", "외국어일간"],
      ["기타일간", "기타일간"],
      ["인쇄매체", "인쇄매체"],
      ["온라인", "온라인"],
    ];
    var matchedPatterns = [];
    itemTerms.forEach(function (pair) {
      if (question.indexOf(pair[0]) >= 0) {
        matchedPatterns.push(pair[1]);
      }
    });

    var itemMatched = matchedPatterns.length > 0;
    if (itemMatched) {
      if (matchedPatterns.length > 1) {
        filtered = filtered.filter(function (r) {
          return matchedPatterns.some(function (pat) {
            return r.item.indexOf(pat) >= 0;
          });
        });
      } else {
        filtered = filtered.filter(function (r) {
          return r.item.indexOf(matchedPatterns[0]) >= 0;
        });
      }
      if (/소계/.test(question)) {
        var bySubtotal = filtered.filter(function (r) {
          return / \/ 소계 \/ 소계$/.test(r.item);
        });
        if (bySubtotal.length) filtered = bySubtotal;
      }
    }

    if (!itemMatched && /전체|신문산업|신문사|산업\s*전체/.test(question)) {
      itemMatched = true;
      var byWhole = filtered.filter(function (r) {
        return r.item === "합계 / 소계 / 소계";
      });
      if (byWhole.length) filtered = byWhole;
    }

    if (!itemMatched) {
      var byTotal = filtered.filter(function (r) {
        return r.item === "합계 / 소계 / 소계";
      });
      if (byTotal.length) filtered = byTotal;
    }

    if (!filtered.length) return records;
    if (filtered.length > 150) return records;
    return filtered;
  }

  function renderTable(data) {
    var headerRows = data.rows.slice(0, 2);
    var bodyRows = data.rows.slice(2);
    var html = '<div class="dai-scroll"><table><thead>';

    headerRows.forEach(function (row) {
      html += "<tr>";
      row.forEach(function (cell) {
        if (cell.skip) return;
        var attrs = "";
        if (cell.rowspan > 1) attrs += ' rowspan="' + cell.rowspan + '"';
        if (cell.colspan > 1) attrs += ' colspan="' + cell.colspan + '"';
        html += "<th" + attrs + ">" + escapeHtml(formatCell(cell.v)) + "</th>";
      });
      html += "</tr>";
    });

    html += "</thead><tbody>";
    bodyRows.forEach(function (row, ri) {
      html += '<tr class="' + (ri % 2 === 1 ? "dai-row-alt" : "") + '">';
      row.forEach(function (cell, ci) {
        if (cell.skip) return;
        var attrs = "";
        if (cell.rowspan > 1) attrs += ' rowspan="' + cell.rowspan + '"';
        if (cell.colspan > 1) attrs += ' colspan="' + cell.colspan + '"';
        var cls = ci < 3 ? "dai-label" : isNumericCell(cell.v) ? "dai-num" : "";
        html += '<td class="' + cls + '"' + attrs + ">" + escapeHtml(formatCell(cell.v)) + "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table></div>";
    els.tableWrap.innerHTML = html;
    els.tableMeta.textContent =
      data.source + " · " + (data.rows.length - 2) + "개 항목 · " + state.records.length + "개 수치";
  }

  function needsUserKey() {
    return !state.serverHasKey;
  }

  function resolveApiKey() {
    var override = els.apiKey && els.apiKey.value.trim();
    if (override) return override;
    if (!needsUserKey()) return undefined;
    return "";
  }

  function loadStoredApiKey() {
    try {
      var k = sessionStorage.getItem(STORAGE_KEY);
      if (k && els.apiKey) els.apiKey.value = k;
    } catch (_) { /* ignore */ }
  }

  function persistApiKey() {
    try {
      var k = els.apiKey && els.apiKey.value.trim();
      if (k) sessionStorage.setItem(STORAGE_KEY, k);
    } catch (_) { /* ignore */ }
  }

  async function fetchConfig() {
    try {
      var res = await fetch(apiUrl("/api/config"));
      var cfg = await res.json();
      state.serverHasKey = Boolean(cfg.geminiConfigured);
      if (cfg.defaultModel) state.model = cfg.defaultModel;
      if (!state.serverHasKey) loadStoredApiKey();
    } catch (_) {
      state.serverHasKey = false;
      loadStoredApiKey();
    }
  }

  function getGeminiText(data, label) {
    var cand = data && data.candidates && data.candidates[0];
    if (!cand) {
      var block = data && data.promptFeedback && data.promptFeedback.blockReason;
      throw new Error((label || "Gemini") + (block ? " 응답 차단: " + block : " 응답이 비어 있습니다."));
    }
    var parts = (cand.content && cand.content.parts) || [];
    var raw = parts
      .map(function (p) {
        if (!p) return "";
        if (typeof p === "string") return p;
        if (typeof p.text === "string") return p.text;
        if (p.text != null) return safeText(p.text);
        return "";
      })
      .join("");
    if (raw.trim()) return raw.trim();
    var reason = cand.finishReason || "";
    if (reason === "MAX_TOKENS") {
      throw new Error((label || "Gemini") + " 응답이 토큰 한도로 잘렸습니다.");
    }
    throw new Error((label || "Gemini") + " 응답 본문이 비어 있습니다.");
  }

  function parseJsonBool(text) {
    var s = String(text || "").trim();
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/g, "");
    var start = s.indexOf("{");
    var end = s.lastIndexOf("}");
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
    try {
      var obj = JSON.parse(s);
      return Boolean(obj.related);
    } catch (_) {
      return /"related"\s*:\s*true/i.test(s);
    }
  }

  function formatGeminiError(status, raw) {
    var msg = safeText(raw);
    if (/high demand|overloaded|try again later/i.test(msg)) {
      return (
        "Gemini 서버가 일시적으로 바쁩니다 (키 연결은 정상). " +
        "잠시 후 다시 시도하거나, 아래 「다시 분석」·「질문하기」를 눌러 주세요."
      );
    }
    if (status === 429 || /quota|rate limit/i.test(msg)) {
      return "API 호출 한도에 도달했습니다. 잠시 후 다시 시도하세요.";
    }
    if (/API key|api key|invalid/i.test(msg)) {
      return "API 키가 올바르지 않습니다. .env의 gemini_api_key를 확인하세요.";
    }
    return msg || "Gemini API 오류 (" + status + ")";
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function geminiGenerate(payload) {
    var apiKey = resolveApiKey();
    if (apiKey === "") {
      throw new Error(needsUserKey() ? "Gemini API 키를 입력하세요." : "API 키가 없습니다.");
    }
    var body = { model: state.model, payload: payload };
    if (apiKey) body.apiKey = apiKey;

    var retryable = function (status, raw) {
      return (
        status === 502 ||
        status === 503 ||
        status === 504 ||
        status === 529 ||
        status === 429 ||
        /high demand/i.test(raw) ||
        /overloaded/i.test(raw) ||
        /try again later/i.test(raw)
      );
    };

    for (var attempt = 1; attempt <= 3; attempt++) {
      var res = await fetch(apiUrl("/api/gemini/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      var text = await res.text();
      var data = null;
      try { data = JSON.parse(text); } catch (_) { /* ignore */ }
      if (res.ok) return data;

      var raw = (data && data.error && data.error.message) || text || "";
      if (retryable(res.status, safeText(raw)) && attempt < 3) {
        await sleep(4000 * attempt);
        continue;
      }
      throw new Error(formatGeminiError(res.status, raw));
    }
    throw new Error("Gemini API 요청 실패");
  }

  function isClearlyTableQuestion(question) {
    var q = question;
    if (/신문산업|매출액|매출|기업공시|종이신문|인터넷신문|일간|주간|합계|소계/.test(q)) return true;
    if (/20\d{2}/.test(q) && /얼마|수치|몇|추이|비교|전체|증가|감소|숫자|몇\s*개|얼마야|알려/.test(q)) return true;
    if (/\d[\d,]{2,}/.test(q) && /숫자|나온|의미|근거|왜|어떻게|방금|아까/.test(q)) return true;
    if (/표에|이\s*표|위\s*표|데이터/.test(q)) return true;
    return false;
  }

  function isClearlyOffTopic(question) {
    if (isClearlyTableQuestion(question)) return false;
    return /날씨|주식|비트코인|암호화폐|레시피|축구|야구|영화|드라마|게임|맛집|여행|연예인|대통령 선거|요리법|번역해|시\s*써|노래|주식시장/.test(
      question
    );
  }

  async function classifyQuestion(question) {
    if (isClearlyTableQuestion(question)) return true;
    if (isClearlyOffTopic(question)) return false;

    var prompt =
      "이 질문이 「신문산업 매출액」 통계 표와 관련 있으면 true, 완전히 다른 주제면 false.\n" +
      "연도·매출·신문·합계·수치·추이·비교·표 항목 질문은 모두 true.\n" +
      'JSON만: {"related": true} 또는 {"related": false}\n\n[질문]\n' + question;

    try {
      var data = await geminiGenerate({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 64 },
      });
      return parseJsonBool(getGeminiText(data, "분류"));
    } catch (_) {
      return true;
    }
  }

  async function runInsight() {
    if (state.analyzing) return;
    if (resolveApiKey() === "") {
      els.insightBody.innerHTML = '<p class="dai-muted">API 키를 설정한 뒤 분석을 실행하세요.</p>';
      return;
    }
    persistApiKey();
    state.analyzing = true;
    els.insightBtn.disabled = true;
    els.insightBody.innerHTML = '<p class="dai-loading">표를 분석하는 중…</p>';

    try {
      var prompt =
        "아래 JSON Lines 데이터만 근거로 분석하세요. 표 밖 지식·추측 금지.\n" +
        "마크다운 문법(#, **, - 등)은 쓰지 말고 일반 문장만 사용하세요.\n\n" +
        "형식:\n【핵심 요약】\n(2~3문장)\n\n【주요 추이】\n(3~5문장)\n\n【인사이트】\n· (3개)\n\n" +
        state.tableText;

      var data = await geminiGenerate({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
      });
      var text = toPlainText(getGeminiText(data, "분석"));
      els.insightBody.innerHTML =
        '<div class="dai-prose">' + escapeHtml(text).replace(/\n/g, "<br>") + "</div>";
    } catch (err) {
      els.insightBody.innerHTML = '<p class="dai-err">' + escapeHtml(safeText(err.message || err)) + "</p>";
    } finally {
      state.analyzing = false;
      els.insightBtn.disabled = false;
    }
  }

  function appendChat(role, text) {
    var div = document.createElement("div");
    div.className = "dai-chat-msg dai-chat-msg--" + role;
    div.innerHTML =
      '<span class="dai-chat-role">' + (role === "user" ? "질문" : "답변") + "</span>" +
      '<div class="dai-chat-text">' + escapeHtml(safeText(text)).replace(/\n/g, "<br>") + "</div>";
    els.chatLog.appendChild(div);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }

  async function sendChat() {
    if (state.chatting) return;
    var question = (els.chatInput.value || "").trim();
    if (!question) return;
    if (resolveApiKey() === "") {
      appendChat("bot", "Gemini API 키를 먼저 설정해 주세요.");
      return;
    }
    persistApiKey();

    els.chatInput.value = "";
    appendChat("user", question);
    setChatBusy(true);
    showChatThinking();

    try {
      var related = await classifyQuestion(question);
      if (!related) {
        removeChatThinking();
        appendChat("bot", OFF_TOPIC_MSG);
        return;
      }

      var subset = filterRecordsForQuestion(question, state.records);
      var context = buildAiContext(state.tableData, subset);

      var historyText = state.chatHistory
        .map(function (m) { return (m.role === "user" ? "이용자: " : "답변: ") + m.text; })
        .join("\n");

      var prompt = buildAnswerPrompt(question, context, historyText);
      var maxTokens = isTrendQuestion(question) ? 1024 : 768;

      var data = await geminiGenerate({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.15, maxOutputTokens: maxTokens },
      });
      var answer = toPlainText(getGeminiText(data, "답변"));
      state.chatHistory.push({ role: "user", text: question });
      state.chatHistory.push({ role: "bot", text: answer });
      if (state.chatHistory.length > 10) {
        state.chatHistory = state.chatHistory.slice(-10);
      }
      removeChatThinking();
      appendChat("bot", answer);
    } catch (err) {
      removeChatThinking();
      appendChat("bot", safeText(err.message || err));
    } finally {
      setChatBusy(false);
      els.chatInput.focus();
    }
  }

  async function init() {
    await fetchConfig();
    try {
      var res = await fetch("table-data.json");
      if (!res.ok) throw new Error("table-data.json을 불러오지 못했습니다.");
      state.tableData = await res.json();
      state.records = state.tableData.records || [];
      if (!state.records.length) {
        throw new Error("표 데이터가 비어 있습니다. npm run build:data-ai 를 실행하세요.");
      }
      state.tableText = buildAiContext(state.tableData, state.records);
      renderTable(state.tableData);
      renderInsightBody(DEFAULT_INSIGHT);
    } catch (err) {
      els.tableWrap.innerHTML = '<p class="dai-err">' + escapeHtml(safeText(err.message || err)) + "</p>";
    }
  }

  els.insightBtn.addEventListener("click", runInsight);
  els.chatSend.addEventListener("click", sendChat);
  ROOT.querySelectorAll(".dai-example-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var q = btn.getAttribute("data-question") || "";
      if (!q || state.chatting) return;
      els.chatInput.value = q;
      sendChat();
    });
  });
  els.chatInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  init();
})();
