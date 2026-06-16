(function () {
  var ROOT = document.getElementById("unique-content-kosis");
  if (!ROOT) return;

  var API_PROXY = "/api/kosis/proxy";
  var DATA_ENDPOINT = "Param/statisticsParameterData";
  var ORG = {
    id: "413",
    name: "한국언론진흥재단",
    vwCd: "MT_OTITLE",
    rootListId: "413",
  };

  var SAMPLE = {
    orgId: ORG.id,
    tblId: "DT_41301N_005",
    tblNm: "신문산업 매출액",
  };

  // KOSIS OpenAPI 실조회로 확인된 표만 포함 (전체 374개 중 16개).
  // 「신문·잡지산업실태조사 > 신문산업」만 API 수치 제공. 잡지·소셜미디어·청소년 조사는 웹 전용.
  var API_AVAILABLE_TABLES = [
    { orgId: "413", tblId: "DT_413001_A001", tblNm: "신문산업 요약" },
    { orgId: "413", tblId: "DT_41301N_001", tblNm: "신문산업 사업체수 현황" },
    { orgId: "413", tblId: "DT_413001_A002", tblNm: "신문산업 설립연도별 사업체 분포" },
    { orgId: "413", tblId: "DT_413001_A003", tblNm: "신문산업 업력별 사업체 분포 및 평균 업력" },
    { orgId: "413", tblId: "DT_413001_A004", tblNm: "신문산업 기업 운영 형태별 사업체 분포" },
    { orgId: "413", tblId: "DT_41301N_004", tblNm: "신문산업 지역별 사업체수" },
    { orgId: "413", tblId: "DT_41301N_005", tblNm: "신문산업 매출액" },
    { orgId: "413", tblId: "DT_41301N_007", tblNm: "신문산업 매출액 구성현황" },
    { orgId: "413", tblId: "DT_41301N_008", tblNm: "신문산업 지역별 매출액" },
    { orgId: "413", tblId: "DT_41301N_010", tblNm: "신문산업 지역별 1인당 평균매출액, 1사업체당 평균매출액" },
    { orgId: "413", tblId: "DT_41301N_011", tblNm: "신문산업 종사자수 현황" },
    { orgId: "413", tblId: "DT_41301N_018", tblNm: "신문산업 지역별 종사자수" },
    { orgId: "413", tblId: "DT_41301N_022", tblNm: "신문산업 기자직수 현황" },
    { orgId: "413", tblId: "DT_41301N_030", tblNm: "신문산업 지출액" },
    { orgId: "413", tblId: "DT_41301N_031", tblNm: "신문산업 지출액 구성현황" },
    { orgId: "413", tblId: "DT_41301N_032", tblNm: "신문산업 지역별 지출액" },
  ];

  var state = {
    configured: false,
    listItems: [],
    selectedTable: null,
    rows: [],
    loading: false,
    startYear: null,
    endYear: null,
    prdRange: null,
    chartType: "bar",
    itmRows: [],
  };

  var els = {
    setup: ROOT.querySelector("#kosis-setup"),
    list: ROOT.querySelector("#kosis-list"),
    listStatus: ROOT.querySelector("#kosis-list-status"),
    panelTitle: ROOT.querySelector("#kosis-panel-title"),
    panelMeta: ROOT.querySelector("#kosis-panel-meta"),
    panelStatus: ROOT.querySelector("#kosis-panel-status"),
    tableWrap: ROOT.querySelector("#kosis-table-wrap"),
    chartWrap: ROOT.querySelector("#kosis-chart-wrap"),
    yearStart: ROOT.querySelector("#kosis-year-start"),
    yearEnd: ROOT.querySelector("#kosis-year-end"),
    chartTypeInputs: ROOT.querySelectorAll('input[name="kosis-chart-type"]'),
    sampleBtn: ROOT.querySelector("#kosis-sample-btn"),
    reloadBtn: ROOT.querySelector("#kosis-reload-btn"),
  };

  function proxyUrl(endpoint, params) {
    var q = new URLSearchParams({ endpoint: endpoint });
    Object.keys(params).forEach(function (key) {
      if (params[key] !== undefined && params[key] !== null && params[key] !== "") {
        q.set(key, String(params[key]));
      }
    });
    return API_PROXY + "?" + q.toString();
  }

  function fetchJson(endpoint, params) {
    return fetch(proxyUrl(endpoint, params))
      .then(function (res) {
        return res.text().then(function (text) {
          var body;
          try {
            body = text ? JSON.parse(text) : null;
          } catch (parseErr) {
            if (res.status === 404 || /not found/i.test(text)) {
              throw new Error(
                "KOSIS API 프록시를 찾을 수 없습니다. 프로젝트 루트에서 node server.mjs 로 서버를 실행·재시작했는지 확인하세요."
              );
            }
            throw new Error(
              "서버 응답을 JSON으로 읽을 수 없습니다 (" + res.status + "): " + text.slice(0, 120)
            );
          }
          if (!res.ok) {
            var msg =
              (body && body.error && body.error.message) ||
              (body && body.errMsg) ||
              "API 요청 실패 (" + res.status + ")";
            throw new Error(msg);
          }
          return body;
        });
      })
      .then(function (body) {
        if (body && body.err) {
          throw new Error(formatKosisError(body));
        }
        return body;
      });
  }

  function formatKosisError(body) {
    if (!body || !body.err) return "KOSIS API 오류";
    if (String(body.err) === "30") {
      return (
        "이 통계표는 KOSIS OpenAPI로 수치 자료를 제공하지 않습니다. " +
        "「신문·잡지산업실태조사」 안에서도 신문산업 표 등 일부만 API로 열려 있으며, " +
        "잡지산업·소셜미디어 조사 표는 웹 화면에서만 조회될 수 있습니다."
      );
    }
    if (String(body.err) === "20") {
      return (
        (body.errMsg || "필수 요청 변수가 누락되었습니다.") +
        " 분류·항목 조건을 확인한 뒤 다시 시도해 주세요."
      );
    }
    return body.errMsg || "KOSIS 오류 코드 " + body.err;
  }

  function normalizeRows(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (payload.StatisticSearch && Array.isArray(payload.StatisticSearch.row)) {
      return payload.StatisticSearch.row;
    }
    var keys = Object.keys(payload);
    if (!keys.length) return [];
    var first = payload[keys[0]];
    if (!Array.isArray(first)) return [payload];
    var len = first.length;
    var rows = [];
    for (var i = 0; i < len; i++) {
      var row = {};
      keys.forEach(function (key) {
        if (Array.isArray(payload[key])) row[key] = payload[key][i];
      });
      rows.push(row);
    }
    return rows;
  }

  function parseNumber(value) {
    if (value == null || value === "") return null;
    var n = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function formatNumber(value) {
    var n = parseNumber(value);
    if (n == null) return value == null ? "—" : String(value);
    return n.toLocaleString("ko-KR");
  }

  function setListStatus(text) {
    if (els.listStatus) els.listStatus.textContent = text;
  }

  function setPanelStatus(text, isError) {
    if (!els.panelStatus) return;
    els.panelStatus.textContent = text || "";
    els.panelStatus.classList.toggle("is-error", Boolean(isError));
  }

  function renderList() {
    if (!els.list) return;
    els.list.innerHTML = "";
    if (!state.listItems.length) {
      var empty = document.createElement("p");
      empty.className = "kosis-empty";
      empty.textContent = "조회 가능한 통계표가 없습니다.";
      els.list.appendChild(empty);
      return;
    }

    state.listItems.forEach(function (item) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "kosis-list-item kosis-list-item--table";
      btn.innerHTML =
        '<span class="kosis-list-copy">' +
        '<span class="kosis-list-label">' +
        escapeHtml(item.tblNm || item.tblId) +
        "</span>" +
        '<span class="kosis-list-id">' +
        escapeHtml(item.tblId) +
        "</span></span>";
      btn.addEventListener("click", function () {
        loadTableSmart({
          orgId: item.orgId || ORG.id,
          tblId: item.tblId,
          tblNm: item.tblNm || item.tblId,
        });
      });
      els.list.appendChild(btn);
    });
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadApiTableList() {
    state.loading = true;
    setListStatus("목록 불러오는 중…");
    state.listItems = API_AVAILABLE_TABLES.map(function (table) {
      return {
        orgId: table.orgId,
        tblId: table.tblId,
        tblNm: table.tblNm,
      };
    });
    state.loading = false;
    setListStatus(
      state.listItems.length +
        "개 통계표 · 신문산업 (KOSIS OpenAPI 제공분)"
    );
    renderList();
  }

  function fetchMeta(orgId, tblId, type, extra) {
    var params = {
      method: "getMeta",
      orgId: orgId,
      tblId: tblId,
      type: type,
      format: "json",
      jsonVD: "Y",
    };
    if (extra) Object.assign(params, extra);
    return fetchJson("statisticsData", params).then(normalizeRows);
  }

  function pickDefaultItem(items) {
    if (!items.length) return null;
    var leaf = items.find(function (row) {
      return row.ITM_ID && (!row.UP_ITM_ID || row.UP_ITM_ID === row.ITM_ID);
    });
    return leaf || items.find(function (row) { return row.ITM_ID; }) || items[0];
  }

  function buildFullQueryDims(itmRows) {
    var itemRows = itmRows.filter(function (row) {
      return row.OBJ_ID === "ITEM";
    });
    var item = pickDefaultItem(itemRows.length ? itemRows : itmRows);
    var objIds = [];
    itmRows.forEach(function (row) {
      if (!row.OBJ_ID || row.OBJ_ID === "ITEM") return;
      if (objIds.indexOf(row.OBJ_ID) === -1) objIds.push(row.OBJ_ID);
    });
    objIds.sort(function (a, b) {
      var rowA = itmRows.find(function (row) { return row.OBJ_ID === a; });
      var rowB = itmRows.find(function (row) { return row.OBJ_ID === b; });
      return Number((rowA && rowA.OBJ_ID_SN) || 0) - Number((rowB && rowB.OBJ_ID_SN) || 0);
    });
    var dims = {};
    objIds.forEach(function (_objId, index) {
      dims["objL" + (index + 1)] = "ALL";
    });
    if (!dims.objL1) dims.objL1 = "ALL";
    return {
      itmId: (item && item.ITM_ID) || "ALL",
      dims: dims,
    };
  }

  function getClassObjIds(itmRows) {
    var objIds = [];
    itmRows.forEach(function (row) {
      if (!row.OBJ_ID || row.OBJ_ID === "ITEM") return;
      if (objIds.indexOf(row.OBJ_ID) === -1) objIds.push(row.OBJ_ID);
    });
    objIds.sort(function (a, b) {
      var rowA = itmRows.find(function (row) { return row.OBJ_ID === a; });
      var rowB = itmRows.find(function (row) { return row.OBJ_ID === b; });
      return Number((rowA && rowA.OBJ_ID_SN) || 0) - Number((rowB && rowB.OBJ_ID_SN) || 0);
    });
    return objIds;
  }

  function buildTreeOrder(itmRows, objId) {
    var nodes = itmRows.filter(function (row) {
      return row.OBJ_ID === objId;
    });
    var byId = {};
    nodes.forEach(function (node) {
      byId[node.ITM_ID] = node;
    });
    var roots = nodes.filter(function (node) {
      return !node.UP_ITM_ID || !byId[node.UP_ITM_ID];
    });
    var result = [];
    function walk(node, depth, parentId) {
      result.push({
        id: node.ITM_ID,
        name: node.ITM_NM,
        depth: depth,
        parentId: parentId || "",
        hasChildren: nodes.some(function (child) {
          return child.UP_ITM_ID === node.ITM_ID;
        }),
      });
      nodes
        .filter(function (child) {
          return child.UP_ITM_ID === node.ITM_ID;
        })
        .forEach(function (child) {
          walk(child, depth + 1, node.ITM_ID);
        });
    }
    roots.forEach(function (root) {
      walk(root, 0, "");
    });
    return result;
  }

  function uniqueSorted(values) {
    var seen = {};
    var list = [];
    values.forEach(function (value) {
      var key = String(value || "");
      if (!key || seen[key]) return;
      seen[key] = true;
      list.push(key);
    });
    return list.sort(function (a, b) {
      return Number(a) - Number(b) || a.localeCompare(b, "ko");
    });
  }

  function buildValueMap(rows) {
    var map = {};
    rows.forEach(function (row) {
      var key = [row.C1_NM || "", row.C2_NM || "", row.PRD_DE || ""].join("\0");
      map[key] = row.DT;
    });
    return map;
  }

  function orderedColumnLabels(itmRows, objId, rows, field) {
    var present = {};
    rows.forEach(function (row) {
      var label = row[field];
      if (label) present[label] = true;
    });
    var labels = [];
    if (objId) {
      buildTreeOrder(itmRows, objId).forEach(function (node) {
        if (present[node.name] && labels.indexOf(node.name) === -1) {
          labels.push(node.name);
        }
      });
    }
    Object.keys(present).forEach(function (name) {
      if (labels.indexOf(name) === -1) labels.push(name);
    });
    return labels;
  }

  function analyzeTableLayout(rows, itmRows) {
    var classObjIds = getClassObjIds(itmRows);
    var years = uniqueSorted(rows.map(function (row) { return row.PRD_DE; }));
    var hasSecondDim = rows.some(function (row) { return row.C2_NM; });
    var rowObjId = classObjIds[0] || null;
    var colObjId = classObjIds.length > 1 ? classObjIds[1] : null;
    var rowObjNm =
      (itmRows.find(function (row) { return row.OBJ_ID === rowObjId; }) || {}).OBJ_NM || "분류";
    var colObjNm =
      (itmRows.find(function (row) { return row.OBJ_ID === colObjId; }) || {}).OBJ_NM || "항목";
    var itemNm = rows[0] && rows[0].ITM_NM ? rows[0].ITM_NM : "값";
    var mode = "simple";

    if (hasSecondDim && colObjId && years.length === 1) {
      mode = "matrix";
    } else if (hasSecondDim && colObjId && years.length > 1) {
      mode = "years-total";
    } else if (years.length > 1) {
      mode = "years";
    }

    return {
      mode: mode,
      years: years,
      rowObjId: rowObjId,
      colObjId: colObjId,
      rowObjNm: rowObjNm,
      colObjNm: colObjNm,
      itemNm: itemNm,
      rowOrder: rowObjId ? buildTreeOrder(itmRows, rowObjId) : [],
      columnLabels:
        mode === "matrix"
          ? orderedColumnLabels(itmRows, colObjId, rows, "C2_NM")
          : years.length > 1
            ? years
            : [itemNm],
    };
  }

  function lookupValue(map, c1, c2, year) {
    return map[[c1 || "", c2 || "", year || ""].join("\0")];
  }

  function rowsPresentInData(layout, rows) {
    var names = {};
    rows.forEach(function (row) {
      if (row.C1_NM) names[row.C1_NM] = true;
    });
    return layout.rowOrder.filter(function (node) {
      return names[node.name];
    });
  }

  function renderMatrixHead(layout) {
    var html =
      '<tr><th scope="col" colspan="2">' +
      escapeHtml(layout.rowObjNm) +
      "</th><th scope=\"col\" colspan=\"" +
      layout.columnLabels.length +
      '">' +
      escapeHtml(layout.years[0] || "연도") +
      "</th></tr>";
    html += "<tr><th scope=\"col\">" + escapeHtml(layout.rowObjNm) + "(1)</th>";
    html += "<th scope=\"col\">" + escapeHtml(layout.rowObjNm) + "(2)</th>";
    layout.columnLabels.forEach(function (label) {
      html += "<th scope=\"col\">" + escapeHtml(label) + "</th>";
    });
    return html + "</tr>";
  }

  function renderMatrixBody(layout, valueMap, rows) {
    var html = "";
    layout.rowOrder.forEach(function (node) {
      if (node.depth > 0) return;
      if (!rows.some(function (row) { return row.C1_NM === node.name; })) return;
      html = appendMatrixRow(html, layout, valueMap, node.name, "소계", node.name);
      if (node.hasChildren) {
        layout.rowOrder
          .filter(function (child) {
            return child.parentId === node.id;
          })
          .forEach(function (child) {
            html = appendMatrixRow(html, layout, valueMap, "", child.name, child.name);
          });
      }
    });
    return html;
  }

  function appendMatrixRow(html, layout, valueMap, primary, secondary, rowKey) {
    html += "<tr>";
    html += '<td class="kosis-row-label">' + escapeHtml(primary) + "</td>";
    html +=
      '<td class="kosis-row-label kosis-row-label--sub">' + escapeHtml(secondary) + "</td>";
    layout.columnLabels.forEach(function (col) {
      html +=
        '<td class="kosis-num">' +
        escapeHtml(formatNumber(lookupValue(valueMap, rowKey, col, layout.years[0]))) +
        "</td>";
    });
    html += "</tr>";
    return html;
  }

  function appendYearRow(html, layout, valueMap, node, c2Value) {
    html += "<tr>";
    html +=
      '<td class="kosis-row-label" style="padding-left:' +
      (0.65 + node.depth * 0.85) +
      'rem">' +
      escapeHtml(node.name) +
      "</td>";
    layout.columnLabels.forEach(function (year) {
      html +=
        '<td class="kosis-num">' +
        escapeHtml(formatNumber(lookupValue(valueMap, node.name, c2Value, year))) +
        "</td>";
    });
    html += "</tr>";
    return html;
  }

  function pickChartRows(rows, layout) {
    if (layout.mode === "matrix" || layout.mode === "years-total") {
      return rows.filter(function (row) {
        return row.C1_NM === "합계" && (row.C2_NM === "합계" || !row.C2_NM);
      });
    }
    return rows.filter(function (row) {
      return row.C1_NM === "합계" || !row.C2_NM;
    });
  }

  function buildPeriodParams(prdRows, startYear, endYear) {
    var prd = prdRows[0] || {};
    var prdSe = prd.PRD_SE || "Y";
    var minYear = Number(prd.STRT_PRD_DE) || Number(startYear);
    var maxYear = Number(prd.END_PRD_DE) || Number(endYear);
    var start = String(startYear || Math.max(minYear, maxYear - 7));
    var end = String(endYear || maxYear);
    if (Number(start) > Number(end)) {
      var tmp = start;
      start = end;
      end = tmp;
    }
    return {
      prdSe: prdSe,
      startPrdDe: start,
      endPrdDe: end,
    };
  }

  function readYearRange() {
    var start = Number(els.yearStart && els.yearStart.value);
    var end = Number(els.yearEnd && els.yearEnd.value);
    if (!Number.isFinite(start)) start = state.startYear;
    if (!Number.isFinite(end)) end = state.endYear;
    if (Number.isFinite(start) && Number.isFinite(end) && start > end) {
      var tmp = start;
      start = end;
      end = tmp;
      if (els.yearStart) els.yearStart.value = String(start);
      if (els.yearEnd) els.yearEnd.value = String(end);
    }
    state.startYear = start;
    state.endYear = end;
    return { startYear: start, endYear: end };
  }

  function updateYearControls(prdRows) {
    if (!els.yearStart || !els.yearEnd) return;
    var prd = prdRows[0] || {};
    var minYear = Number(prd.STRT_PRD_DE) || 1990;
    var maxYear = Number(prd.END_PRD_DE) || new Date().getFullYear();
    state.prdRange = {
      min: minYear,
      max: maxYear,
      prdSe: prd.PRD_SE || "Y",
    };
    els.yearStart.min = String(minYear);
    els.yearStart.max = String(maxYear);
    els.yearEnd.min = String(minYear);
    els.yearEnd.max = String(maxYear);
    if (
      state.startYear == null ||
      state.startYear < minYear ||
      state.startYear > maxYear
    ) {
      state.startYear = Math.max(minYear, maxYear - 7);
    }
    if (
      state.endYear == null ||
      state.endYear < minYear ||
      state.endYear > maxYear
    ) {
      state.endYear = maxYear;
    }
    els.yearStart.value = String(state.startYear);
    els.yearEnd.value = String(state.endYear);
  }

  function buildDataParams(query) {
    var params = {
      method: "getList",
      loadGubun: "2",
      orgId: query.orgId,
      tblId: query.tblId,
      objL1: query.objL1 || "ALL",
      itmId: query.itmId || "ALL",
      prdSe: query.prdSe || "Y",
      format: "json",
      jsonVD: "Y",
    };

    if (query.newEstPrdCnt) params.newEstPrdCnt = String(query.newEstPrdCnt);
    if (query.startPrdDe) params.startPrdDe = String(query.startPrdDe);
    if (query.endPrdDe) params.endPrdDe = String(query.endPrdDe);

    for (var i = 2; i <= 8; i++) {
      var key = "objL" + i;
      if (query[key]) params[key] = query[key];
    }

    return params;
  }

  function buildAllDimFallback(query) {
    var fallback = Object.assign({}, query);
    for (var i = 1; i <= 8; i++) {
      fallback["objL" + i] = "ALL";
    }
    fallback.itmId = query.itmId || "ALL";
    return fallback;
  }

  function selectTable(table) {
    state.selectedTable = table;
    if (els.panelTitle) els.panelTitle.textContent = table.tblNm;
    if (els.panelMeta) {
      els.panelMeta.textContent =
        ORG.name + " · 기관 " + table.orgId + " · 표 " + table.tblId;
    }
  }

  function fetchTableData(query) {
    return fetchJson(DATA_ENDPOINT, buildDataParams(query));
  }

  function loadTableData(query) {
    selectTable({
      orgId: query.orgId,
      tblId: query.tblId,
      tblNm: query.tblNm || query.tblId,
    });
    setPanelStatus("통계자료 조회 중…");
    if (els.tableWrap) els.tableWrap.innerHTML = "";
    if (els.chartWrap) els.chartWrap.innerHTML = "";

    return fetchTableData(query)
      .catch(function (err) {
        if (/20|objL|필수/.test(err.message)) {
          return fetchTableData(buildAllDimFallback(query));
        }
        throw err;
      })
      .then(function (payload) {
        state.rows = normalizeRows(payload);
        if (!state.rows.length) {
          setPanelStatus("조회 결과가 없습니다. 분류·항목 조건을 확인해 주세요.", true);
          return;
        }
        var meta = state.rows[0];
        if (els.panelTitle && meta.TBL_NM) els.panelTitle.textContent = meta.TBL_NM;
        if (els.panelMeta) {
          var bits = [
            "기관 " + (meta.ORG_ID || query.orgId),
            "표 " + (meta.TBL_ID || query.tblId),
          ];
          if (meta.UNIT_NM) bits.push("단위 " + meta.UNIT_NM);
          els.panelMeta.textContent = bits.join(" · ");
        }
        renderData(state.rows);
        var years = readYearRange();
        var status =
          (years.startYear && years.endYear
            ? years.startYear + "–" + years.endYear + " · "
            : "") +
          state.rows.length +
          "건 조회";
        if (state.rows.length > 200) {
          status += " (표는 최대 200행까지 표시)";
        }
        setPanelStatus(status);
      })
      .catch(function (err) {
        setPanelStatus(err.message, true);
      });
  }

  function loadTableSmart(table) {
    var isNewTable = !state.selectedTable || state.selectedTable.tblId !== table.tblId;
    selectTable(table);
    setPanelStatus("메타정보 확인 중…");
    return Promise.all([
      fetchMeta(table.orgId, table.tblId, "PRD"),
      fetchMeta(table.orgId, table.tblId, "ITM"),
    ])
      .then(function (results) {
        var prdRows = results[0];
        var itmRows = results[1];
        if (isNewTable) {
          state.startYear = null;
          state.endYear = null;
        }
        state.itmRows = itmRows;
        updateYearControls(prdRows);
        var years = readYearRange();
        var picked = buildFullQueryDims(itmRows);
        return loadTableData(Object.assign({
          orgId: table.orgId,
          tblId: table.tblId,
          tblNm: table.tblNm,
          itmId: picked.itmId,
        }, picked.dims, buildPeriodParams(prdRows, years.startYear, years.endYear)));
      })
      .catch(function (err) {
        setPanelStatus(err.message, true);
      });
  }

  function trimRowsForDisplay(rows) {
    if (rows.length <= 200) return rows;
    return rows.slice(0, 200);
  }

  function sortRowsByYear(rows) {
    return rows.slice().sort(function (a, b) {
      return Number(a.PRD_DE) - Number(b.PRD_DE);
    });
  }

  function seriesFromRows(rows) {
    var layout = analyzeTableLayout(rows, state.itmRows || []);
    var chartRows = pickChartRows(rows, layout);
    var seen = {};
    var series = [];
    sortRowsByYear(chartRows).forEach(function (row) {
      var year = String(row.PRD_DE || "");
      if (!year || seen[year]) return;
      var value = parseNumber(row.DT);
      if (value == null) return;
      seen[year] = true;
      series.push({ year: year, value: value, label: row.ITM_NM || "" });
    });
    return series;
  }

  function renderData(rows) {
    renderTable(rows);
    renderChart(rows);
  }

  function renderTable(rows) {
    if (!els.tableWrap) return;
    var layout = analyzeTableLayout(rows, state.itmRows || []);
    var valueMap = buildValueMap(rows);
    var unit = rows[0] && rows[0].UNIT_NM ? rows[0].UNIT_NM : "";
    var html = '<div class="kosis-table-scroll">';
    if (unit) {
      html += '<p class="kosis-table-unit">(단위: ' + escapeHtml(unit) + ")</p>";
    }
    html += '<table class="kosis-table"><thead>';

    if (layout.mode === "matrix") {
      html += renderMatrixHead(layout);
      html += "</thead><tbody>";
      html += renderMatrixBody(layout, valueMap, rows);
    } else if (layout.mode === "years-total") {
      html += "<tr><th scope=\"col\">" + escapeHtml(layout.rowObjNm) + "</th>";
      layout.columnLabels.forEach(function (year) {
        html += "<th scope=\"col\">" + escapeHtml(year) + "</th>";
      });
      html += "</tr></thead><tbody>";
      layout.rowOrder.forEach(function (node) {
        if (node.depth > 0) return;
        if (!rows.some(function (row) { return row.C1_NM === node.name; })) return;
        html = appendYearRow(html, layout, valueMap, node, "합계");
        if (node.hasChildren) {
          layout.rowOrder
            .filter(function (child) {
              return child.parentId === node.id;
            })
            .forEach(function (child) {
              html = appendYearRow(html, layout, valueMap, child, "합계");
            });
        }
      });
      html += "</tbody></table>";
      var endYear = layout.years[layout.years.length - 1];
      var endRows = rows.filter(function (row) {
        return String(row.PRD_DE) === endYear;
      });
      if (endRows.length) {
        var detailLayout = analyzeTableLayout(endRows, state.itmRows || []);
        if (detailLayout.mode === "matrix") {
          html += '<table class="kosis-table kosis-table--detail"><thead>';
          html +=
            '<caption class="kosis-table-caption">' +
            escapeHtml(endYear) +
            "년 항목별 상세</caption>";
          html += renderMatrixHead(detailLayout);
          html += "</thead><tbody>";
          html += renderMatrixBody(detailLayout, buildValueMap(endRows), endRows);
          html += "</tbody></table>";
        }
      }
      html += "</div>";
      els.tableWrap.innerHTML = html;
      return;
    } else if (layout.mode === "years") {
      html += "<tr><th scope=\"col\">" + escapeHtml(layout.rowObjNm) + "</th>";
      layout.columnLabels.forEach(function (year) {
        html += "<th scope=\"col\">" + escapeHtml(year) + "</th>";
      });
      html += "</tr></thead><tbody>";
      rowsPresentInData(layout, rows).forEach(function (node) {
        html = appendYearRow(html, layout, valueMap, node, "");
      });
    } else {
      html += "<tr><th scope=\"col\">연도</th><th scope=\"col\">" + escapeHtml(layout.itemNm) + "</th></tr></thead><tbody>";
      sortRowsByYear(rows).forEach(function (row) {
        html +=
          "<tr><td class=\"kosis-row-label\">" +
          escapeHtml(row.PRD_DE || "—") +
          '</td><td class="kosis-num">' +
          escapeHtml(formatNumber(row.DT)) +
          "</td></tr>";
      });
    }

    html += "</tbody></table></div>";
    els.tableWrap.innerHTML = html;
  }

  function renderChart(rows) {
    if (!els.chartWrap) return;
    var series = seriesFromRows(rows);
    if (!series.length) {
      els.chartWrap.innerHTML = '<p class="kosis-empty">차트로 그릴 수치가 없습니다.</p>';
      return;
    }

    var height = 280;
    var values = series.map(function (item) { return item.value; });
    var minVal = Math.min.apply(null, values);
    var maxVal = Math.max.apply(null, values);
    if (minVal === maxVal) {
      minVal = minVal === 0 ? 0 : minVal * 0.9;
      maxVal = maxVal === 0 ? 1 : maxVal * 1.1;
    } else {
      var padding = (maxVal - minVal) * 0.08;
      minVal = Math.max(0, minVal - padding);
      maxVal = maxVal + padding;
    }

    function formatAxis(value) {
      if (Math.abs(value) >= 1000) {
        return value.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
      }
      return String(Math.round(value * 10) / 10);
    }

    function measureLeftPad() {
      var longest = 0;
      for (var g = 0; g <= 4; g++) {
        var gridVal = maxVal - ((maxVal - minVal) * g) / 4;
        longest = Math.max(longest, formatAxis(gridVal).length);
      }
      return Math.max(80, longest * 8.5 + 24);
    }

    var pad = {
      top: 18,
      right: 20,
      bottom: 42,
      left: measureLeftPad(),
    };
    var width = Math.max(640, pad.left + 520 + pad.right);
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;

    function xAt(index) {
      if (series.length === 1) return pad.left + plotW / 2;
      return pad.left + (plotW * index) / (series.length - 1);
    }

    function yAt(value) {
      var ratio = (value - minVal) / (maxVal - minVal || 1);
      return pad.top + plotH - ratio * plotH;
    }

    var svg = '<svg class="kosis-chart-svg" viewBox="0 0 ' + width + " " + height + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="연도별 시계열 차트">';
    svg += '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="#fffdf5"></rect>';

    for (var g = 0; g <= 4; g++) {
      var gridY = pad.top + (plotH * g) / 4;
      var gridVal = maxVal - ((maxVal - minVal) * g) / 4;
      svg +=
        '<line class="kosis-chart-grid-line" x1="' + pad.left + '" y1="' + gridY +
        '" x2="' + (width - pad.right) + '" y2="' + gridY + '"></line>';
      svg +=
        '<text class="kosis-chart-axis-label" x="' + (pad.left - 8) + '" y="' + (gridY + 4) +
        '" text-anchor="end">' + escapeHtml(formatAxis(gridVal)) + "</text>";
    }

    if (state.chartType === "line") {
      var points = series
        .map(function (item, index) {
          return xAt(index) + "," + yAt(item.value);
        })
        .join(" ");
      svg += '<polyline class="kosis-chart-line" points="' + points + '"></polyline>';
      series.forEach(function (item, index) {
        var cx = xAt(index);
        var cy = yAt(item.value);
        svg +=
          '<circle class="kosis-chart-point" cx="' + cx + '" cy="' + cy + '" r="4.5">' +
          "<title>" + escapeHtml(item.year + ": " + formatNumber(item.value)) + "</title>" +
          "</circle>";
      });
    } else {
      var barGap = series.length > 1 ? plotW / series.length : plotW;
      var barWidth = Math.max(8, Math.min(42, barGap * 0.62));
      series.forEach(function (item, index) {
        var cx = series.length === 1 ? pad.left + plotW / 2 : pad.left + barGap * index + barGap / 2;
        var x = cx - barWidth / 2;
        var y = yAt(item.value);
        var barH = pad.top + plotH - y;
        svg +=
          '<rect class="kosis-chart-bar" x="' + x + '" y="' + y +
          '" width="' + barWidth + '" height="' + barH + '">' +
          "<title>" + escapeHtml(item.year + ": " + formatNumber(item.value)) + "</title>" +
          "</rect>";
      });
    }

    series.forEach(function (item, index) {
      var cx = xAt(index);
      var showLabel =
        series.length <= 12 ||
        index === 0 ||
        index === series.length - 1 ||
        index % Math.ceil(series.length / 8) === 0;
      if (!showLabel) return;
      svg +=
        '<text class="kosis-chart-axis-label" x="' + cx + '" y="' + (height - 14) +
        '" text-anchor="middle">' + escapeHtml(item.year) + "</text>";
    });

    svg += "</svg>";
    els.chartWrap.innerHTML = svg;
  }

  function loadSample() {
    readYearRange();
    loadTableSmart({
      orgId: SAMPLE.orgId,
      tblId: SAMPLE.tblId,
      tblNm: SAMPLE.tblNm,
    });
  }

  function reloadSelected() {
    if (!state.selectedTable) {
      setPanelStatus("먼저 통계표를 선택하거나 예제를 불러오세요.", true);
      return;
    }
    readYearRange();
    loadTableSmart(state.selectedTable);
  }

  function initEvents() {
    if (els.sampleBtn) els.sampleBtn.addEventListener("click", loadSample);
    if (els.reloadBtn) els.reloadBtn.addEventListener("click", reloadSelected);
    if (els.yearStart) {
      els.yearStart.addEventListener("change", function () {
        readYearRange();
      });
    }
    if (els.yearEnd) {
      els.yearEnd.addEventListener("change", function () {
        readYearRange();
      });
    }
    if (els.chartTypeInputs && els.chartTypeInputs.length) {
      els.chartTypeInputs.forEach(function (input) {
        input.addEventListener("change", function () {
          if (!input.checked) return;
          state.chartType = input.value === "line" ? "line" : "bar";
          if (state.rows.length) {
            renderChart(state.rows);
          }
        });
      });
    }
  }

  function init() {
    initEvents();
    fetch("/api/kosis/config")
      .then(function (res) {
        return res.text().then(function (text) {
          try {
            return { ok: res.ok, body: text ? JSON.parse(text) : {} };
          } catch (parseErr) {
            throw new Error("KOSIS_CONFIG_NOT_FOUND");
          }
        });
      })
      .then(function (result) {
        if (!result.ok) throw new Error("KOSIS_CONFIG_NOT_FOUND");
        var cfg = result.body;
        state.configured = Boolean(cfg.kosisConfigured);
        if (els.setup) {
          els.setup.hidden = state.configured;
        }
        if (!state.configured) {
          setListStatus("API 키 설정 후 서버를 재시작하세요.");
          setPanelStatus("KOSIS_API_KEY가 .env에 없습니다.", true);
          return;
        }
        loadApiTableList();
      })
      .catch(function (err) {
        var missingProxy = err && err.message === "KOSIS_CONFIG_NOT_FOUND";
        setListStatus(
          missingProxy
            ? "node server.mjs 로 서버를 실행·재시작하세요. (KOSIS API 프록시 없음)"
            : "서버 설정을 확인할 수 없습니다."
        );
        if (missingProxy) {
          setPanelStatus(
            "Live Server 등으로 HTML만 열면 API가 동작하지 않습니다. node server.mjs 후 http://localhost:3456/demos/kosis_api/ 로 접속하세요.",
            true
          );
        }
      });
  }

  init();
})();
