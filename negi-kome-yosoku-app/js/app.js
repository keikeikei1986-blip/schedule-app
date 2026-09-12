(function () {
  "use strict";

  var STORAGE_KEY = "negi-kome-yosoku-v1";

  var CROP_LABELS = { negi: "ネギ", kome: "米" };

  var GROWTH_LEVELS = [
    { key: "very_bad", label: "非常に悪い", factor: 0.70 },
    { key: "bad", label: "やや悪い", factor: 0.85 },
    { key: "normal", label: "平年並み", factor: 1.00 },
    { key: "good", label: "やや良い", factor: 1.10 },
    { key: "very_good", label: "非常に良い", factor: 1.20 }
  ];
  var GROWTH_MAP = {};
  GROWTH_LEVELS.forEach(function (g) { GROWTH_MAP[g.key] = g; });

  var state = { fields: [] };

  var currentFieldId = null;
  var currentDetailTab = "basic";
  var currentRecordId = null;
  var fieldSort = "sales-desc";

  // ---------- helpers ----------

  function $(id) { return document.getElementById(id); }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  // Distinguishes "not entered" (null) from an explicitly entered 0.
  function numOrNull(v) {
    if (v === "" || v === null || v === undefined) return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }

  function formatKgOrDash(n) {
    return n == null ? "未算出" : formatKg(n);
  }

  function formatManOrDash(n) {
    return n == null ? "未算出" : formatMan(n);
  }

  function formatPercent(n) {
    return Math.round(n * 100) + "%";
  }

  function formatInt(n) {
    return Math.round(n).toLocaleString("ja-JP");
  }

  function formatKg(n) {
    return formatInt(n) + "kg";
  }

  function formatYen(n) {
    return formatInt(n) + "円";
  }

  function formatMan(n) {
    if (!n) return "0円";
    var abs = Math.abs(n);
    if (abs < 10000) return (n < 0 ? "-" : "") + formatInt(abs) + "円";
    var man = n / 10000;
    var rounded = Math.round(man * 10) / 10;
    return rounded.toLocaleString("ja-JP", { maximumFractionDigits: 1 }) + "万円";
  }

  function formatDate(s) {
    if (!s) return "未設定";
    var parts = s.split("-");
    if (parts.length !== 3) return s;
    return parts[0] + "年" + parseInt(parts[1], 10) + "月" + parseInt(parts[2], 10) + "日";
  }

  function monthKey(dateStr) {
    if (!dateStr) return null;
    var parts = dateStr.split("-");
    if (parts.length !== 3) return null;
    return parts[0] + "-" + parts[1];
  }

  // ---------- persistence ----------

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.fields)) {
        state.fields = parsed.fields.map(migrateField);
      }
    } catch (e) {
      console.error("failed to load state", e);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function migrateField(f) {
    f.pastRecords = Array.isArray(f.pastRecords) ? f.pastRecords.map(migrateRecord) : [];
    f.current = f.current || {};
    f.current.growthStatus = f.current.growthStatus || "normal";
    f.current.pest = f.current.pest || "";
    f.current.weather = f.current.weather || "";
    f.current.note = f.current.note || "";
    f.current.thisYearArea = (typeof f.current.thisYearArea === "number") ? f.current.thisYearArea : (typeof f.area === "number" ? f.area : 0);
    // Existing saved values (including a pre-existing 0) are left untouched — we cannot
    // tell whether an old 0 meant "explicitly zero" or "never filled in", so we don't
    // reinterpret it. Only a genuinely missing property becomes null ("not yet computable").
    f.current.standardYieldPer10a = (typeof f.current.standardYieldPer10a === "number") ? f.current.standardYieldPer10a : null;
    f.current.plannedPrice = (typeof f.current.plannedPrice === "number") ? f.current.plannedPrice : null;
    return f;
  }

  function migrateRecord(r) {
    r.area = (typeof r.area === "number") ? r.area : null;
    r.harvestAmount = (typeof r.harvestAmount === "number") ? r.harvestAmount : null;
    r.salesAmount = (typeof r.salesAmount === "number") ? r.salesAmount : null;
    r.avgPrice = (typeof r.avgPrice === "number") ? r.avgPrice : null;
    r.fertilizerCost = (typeof r.fertilizerCost === "number") ? r.fertilizerCost : 0;
    r.pesticideCost = (typeof r.pesticideCost === "number") ? r.pesticideCost : 0;
    r.laborCost = (typeof r.laborCost === "number") ? r.laborCost : 0;
    r.otherCost = (typeof r.otherCost === "number") ? r.otherCost : 0;
    return r;
  }

  function validYieldRecords(field) {
    return (field.pastRecords || []).filter(function (r) {
      return r.area != null && r.area > 0 && r.harvestAmount != null;
    });
  }

  function validSellThroughRecords(field) {
    return (field.pastRecords || []).filter(function (r) {
      return r.harvestAmount != null && r.harvestAmount > 0 && r.salesAmount != null;
    });
  }

  // ---------- prediction ----------

  function computeFieldPrediction(field) {
    // ---- yield: average per-10a yield from valid history, or the manual fallback ----
    var yieldRecords = validYieldRecords(field);
    var hasHistory = yieldRecords.length > 0;
    var avgYieldPer10a = null;
    if (hasHistory) {
      var sum = 0;
      yieldRecords.forEach(function (r) {
        sum += (r.harvestAmount / r.area) * 10;
      });
      avgYieldPer10a = sum / yieldRecords.length;
    } else if (field.current.standardYieldPer10a != null) {
      avgYieldPer10a = field.current.standardYieldPer10a;
    }
    // avgYieldPer10a stays null when there is no history AND no manual standard yield —
    // harvest is then genuinely "not yet computable", not zero.

    var thisArea = (field.current.thisYearArea != null) ? field.current.thisYearArea : (field.area || 0);
    var growth = GROWTH_MAP[field.current.growthStatus] || GROWTH_MAP.normal;
    var factor = growth.factor;

    var harvestComputable = (avgYieldPer10a != null);
    var stdHarvest = harvestComputable ? avgYieldPer10a * (thisArea / 10) * factor : null;
    var minHarvest = harvestComputable ? stdHarvest * 0.9 : null;
    var maxHarvest = harvestComputable ? stdHarvest * 1.1 : null;

    // ---- sell-through rate: sales volume / harvest volume from valid history ----
    var sellRecords = validSellThroughRecords(field);
    var hasSellThroughData = sellRecords.length > 0;
    var harvestSum = 0, salesSum = 0;
    sellRecords.forEach(function (r) {
      harvestSum += r.harvestAmount;
      salesSum += r.salesAmount;
    });
    // Assume 100% (full sell-through) only when there is no data to derive a rate from.
    // When there IS data, the rate is used as calculated — even above 100% — and flagged
    // for the user to check rather than silently clamped.
    var sellThroughRate = hasSellThroughData ? (salesSum / harvestSum) : 1;
    var sellThroughExceeds100 = hasSellThroughData && sellThroughRate > 1;

    var price = field.current.plannedPrice; // null (not entered) or a number, incl. 0

    var stdSalesVolume = harvestComputable ? stdHarvest * sellThroughRate : null;
    var minSalesVolume = harvestComputable ? minHarvest * sellThroughRate : null;
    var maxSalesVolume = harvestComputable ? maxHarvest * sellThroughRate : null;

    var salesComputable = harvestComputable && (price != null);
    var stdSales = salesComputable ? stdSalesVolume * price : null;
    var minSales = salesComputable ? minSalesVolume * price : null;
    var maxSales = salesComputable ? maxSalesVolume * price : null;

    return {
      hasHistory: hasHistory,
      avgYieldPer10a: avgYieldPer10a,
      harvestComputable: harvestComputable,
      stdHarvest: stdHarvest, minHarvest: minHarvest, maxHarvest: maxHarvest,
      hasSellThroughData: hasSellThroughData,
      sellThroughRate: sellThroughRate,
      sellThroughExceeds100: sellThroughExceeds100,
      price: price,
      salesComputable: salesComputable,
      stdSalesVolume: stdSalesVolume, minSalesVolume: minSalesVolume, maxSalesVolume: maxSalesVolume,
      stdSales: stdSales, minSales: minSales, maxSales: maxSales,
      growthLabel: growth.label, growthFactor: factor
    };
  }

  function allPredictions() {
    var map = {};
    state.fields.forEach(function (f) { map[f.id] = computeFieldPrediction(f); });
    return map;
  }

  // ---------- navigation ----------

  function showView(name) {
    ["dashboard", "fields", "field-detail", "field-form", "data"].forEach(function (v) {
      $("view-" + v).hidden = v !== name;
    });
    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.view === name);
    });
    if (name === "dashboard") renderDashboard();
    if (name === "fields") renderFieldList();
    window.scrollTo(0, 0);
  }

  // ---------- dashboard ----------

  function renderDashboard() {
    var preds = allPredictions();
    var hasFields = state.fields.length > 0;
    $("dashboard-empty").hidden = hasFields;
    $("dashboard-content").hidden = !hasFields;
    if (!hasFields) return;

    var totalHarvest = 0, totalSales = 0;
    var harvestComputedCount = 0, salesComputedCount = 0;
    var cropTotals = {
      negi: { harvest: 0, sales: 0, harvestComputed: 0, salesComputed: 0 },
      kome: { harvest: 0, sales: 0, harvestComputed: 0, salesComputed: 0 }
    };
    var monthTotals = {};
    var monthMissing = {};
    var now = new Date();
    var thisMonthKey = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    var nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    var nextMonthKey = nextMonthDate.getFullYear() + "-" + String(nextMonthDate.getMonth() + 1).padStart(2, "0");
    var thisMonthSales = 0, nextMonthSales = 0;
    var thisMonthMissing = 0, nextMonthMissing = 0;
    var noDateCount = 0, noDateSalesTotal = 0, noDateSalesComputedCount = 0;

    state.fields.forEach(function (f) {
      var p = preds[f.id];
      if (p.harvestComputable) {
        totalHarvest += p.stdHarvest;
        harvestComputedCount++;
        if (cropTotals[f.crop]) {
          cropTotals[f.crop].harvest += p.stdHarvest;
          cropTotals[f.crop].harvestComputed++;
        }
      }
      if (p.salesComputable) {
        totalSales += p.stdSales;
        salesComputedCount++;
        if (cropTotals[f.crop]) {
          cropTotals[f.crop].sales += p.stdSales;
          cropTotals[f.crop].salesComputed++;
        }
      }

      var mk = monthKey(f.harvestDate);
      if (!mk) {
        noDateCount++;
        if (p.salesComputable) {
          noDateSalesTotal += p.stdSales;
          noDateSalesComputedCount++;
        }
        return;
      }
      if (p.salesComputable) {
        monthTotals[mk] = (monthTotals[mk] || 0) + p.stdSales;
        if (mk === thisMonthKey) thisMonthSales += p.stdSales;
        if (mk === nextMonthKey) nextMonthSales += p.stdSales;
      } else {
        monthMissing[mk] = (monthMissing[mk] || 0) + 1;
        if (mk === thisMonthKey) thisMonthMissing++;
        if (mk === nextMonthKey) nextMonthMissing++;
      }
    });

    var totalFields = state.fields.length;

    $("stat-total-harvest").textContent = formatKg(totalHarvest);
    $("stat-total-sales").textContent = formatMan(totalSales);
    $("stat-this-month").textContent = formatMan(thisMonthSales);
    $("stat-next-month").textContent = formatMan(nextMonthSales);

    setStatLabel("stat-total-harvest", "今年の予想総収穫量", harvestComputedCount, totalFields);
    setStatLabel("stat-total-sales", "今年の予想総売上", salesComputedCount, totalFields);
    setStatLabel("stat-this-month", "今月の予想売上", null, null, thisMonthMissing > 0);
    setStatLabel("stat-next-month", "来月の予想売上", null, null, nextMonthMissing > 0);

    // crop breakdown
    var cropEl = $("crop-breakdown");
    cropEl.innerHTML = "";
    ["negi", "kome"].forEach(function (crop) {
      if (!state.fields.some(function (f) { return f.crop === crop; })) return;
      var t = cropTotals[crop];
      var row = document.createElement("div");
      row.className = "breakdown-row";
      var cropValueHtml = t.salesComputed > 0
        ? '<span class="breakdown-value">' + formatMan(t.sales) + '</span><span class="breakdown-sub"> / ' + (t.harvestComputed > 0 ? formatKg(t.harvest) : "未算出") + '</span>'
        : '<span class="breakdown-value breakdown-value-muted">未算出</span>';
      row.innerHTML =
        '<span class="breakdown-crop-badge badge-' + crop + '">' + (crop === "negi" ? "🧅" : "🌾") + " " + CROP_LABELS[crop] + '</span>' +
        '<span>' + cropValueHtml + '</span>';
      cropEl.appendChild(row);
    });
    if (salesComputedCount < totalFields || harvestComputedCount < totalFields) {
      var cropNote = document.createElement("p");
      cropNote.className = "no-date-note";
      cropNote.textContent = "※ 算出済みの圃場のみの合計です。";
      cropEl.appendChild(cropNote);
    }

    // monthly breakdown
    var monthEl = $("monthly-breakdown");
    monthEl.innerHTML = "";
    var monthKeys = Object.keys(monthTotals).sort();
    if (monthKeys.length === 0) {
      monthEl.innerHTML = '<p class="card-desc">収穫予定日が設定され、売上が算出済みの圃場がないため、月別の集計はまだ表示できません。</p>';
    } else {
      var maxVal = Math.max.apply(null, monthKeys.map(function (k) { return monthTotals[k]; }));
      monthKeys.forEach(function (k) {
        var parts = k.split("-");
        var label = parseInt(parts[1], 10) + "月";
        var val = monthTotals[k];
        var pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
        var row = document.createElement("div");
        row.className = "month-row";
        var missingNote = monthMissing[k] ? '<span class="month-missing"> (未算出' + monthMissing[k] + '件)</span>' : "";
        row.innerHTML =
          '<span class="month-label">' + label + '</span>' +
          '<span class="month-bar-track"><span class="month-bar-fill" style="width:' + pct + '%"></span></span>' +
          '<span class="month-value">' + formatMan(val) + missingNote + '</span>';
        monthEl.appendChild(row);
      });
    }
    var noDateNoteEl = $("monthly-no-date-note");
    if (noDateCount > 0) {
      var noDateParts = ["収穫予定日が未設定の圃場: " + noDateCount + "件（月別集計の対象外）"];
      if (noDateSalesComputedCount > 0) {
        noDateParts.push("うち売上算出済み: " + formatMan(noDateSalesTotal) + "（" + noDateSalesComputedCount + "件）");
      }
      var noDateUncomputed = noDateCount - noDateSalesComputedCount;
      if (noDateUncomputed > 0) {
        noDateParts.push("売上未算出: " + noDateUncomputed + "件");
      }
      noDateNoteEl.textContent = noDateParts.join(" / ");
      noDateNoteEl.hidden = false;
    } else {
      noDateNoteEl.hidden = true;
      noDateNoteEl.textContent = "";
    }

    // field breakdown (top by sales; uncomputed fields sort last)
    var fieldEl = $("field-breakdown");
    fieldEl.innerHTML = "";
    var sortedFields = state.fields.slice().sort(function (a, b) {
      return compareBySales(preds, a, b);
    });
    sortedFields.forEach(function (f) {
      var p = preds[f.id];
      var row = document.createElement("div");
      row.className = "breakdown-row";
      var valueHtml;
      if (p.salesComputable) {
        var share = totalSales > 0 ? Math.round((p.stdSales / totalSales) * 100) : 0;
        valueHtml = '<span class="breakdown-value">' + formatMan(p.stdSales) + '</span><span class="breakdown-sub"> (' + share + '%)</span>';
      } else {
        valueHtml = '<span class="breakdown-value breakdown-value-muted">未算出</span>';
      }
      row.innerHTML =
        '<span class="breakdown-name">' + escapeHtml(f.name) + '<span class="breakdown-sub"> (' + CROP_LABELS[f.crop] + ')</span></span>' +
        '<span>' + valueHtml + '</span>';
      fieldEl.appendChild(row);
    });

    renderAdvice(preds, totalSales, monthTotals);
  }

  function setStatLabel(valueId, baseLabel, computedCount, totalCount, forceIncomplete) {
    var labelEl = $(valueId).parentElement.querySelector(".stat-label");
    var sublabelEl = $(valueId).parentElement.querySelector(".stat-sublabel");
    if (!sublabelEl) {
      sublabelEl = document.createElement("div");
      sublabelEl.className = "stat-sublabel";
      $(valueId).parentElement.appendChild(sublabelEl);
    }
    labelEl.textContent = baseLabel;
    var incomplete = forceIncomplete || (computedCount != null && totalCount != null && computedCount < totalCount);
    if (incomplete) {
      sublabelEl.textContent = (computedCount != null)
        ? "算出済み分（" + computedCount + "/" + totalCount + "圃場）"
        : "算出済み分";
      sublabelEl.hidden = false;
    } else {
      sublabelEl.hidden = true;
    }
  }

  function compareBySales(preds, a, b) {
    var pa = preds[a.id].salesComputable ? preds[a.id].stdSales : null;
    var pb = preds[b.id].salesComputable ? preds[b.id].stdSales : null;
    if (pa == null && pb == null) return 0;
    if (pa == null) return 1;
    if (pb == null) return -1;
    return pb - pa;
  }

  function renderAdvice(preds, totalSales, monthTotals) {
    var advice = [];

    // 1. Year-over-year quantity comparison — a neutral statement of the number only.
    // It does NOT claim a cause (growth status is reported separately, below), and it
    // is skipped entirely when the most recent past-year record has no entered harvest
    // amount (null) — we don't force a percentage out of missing data.
    var lastYearTotal = 0, thisYearForThose = 0, fieldsWithHistory = 0;
    state.fields.forEach(function (f) {
      var recordsWithYear = (f.pastRecords || []).filter(function (r) { return r.year != null; });
      if (recordsWithYear.length === 0) return;
      var latest = recordsWithYear.slice().sort(function (a, b) { return b.year - a.year; })[0];
      if (latest.harvestAmount == null) return;
      var pred = preds[f.id];
      if (!pred.harvestComputable) return;
      lastYearTotal += latest.harvestAmount;
      thisYearForThose += pred.stdHarvest;
      fieldsWithHistory++;
    });
    if (fieldsWithHistory > 0 && lastYearTotal > 0) {
      var pct = Math.round(((thisYearForThose - lastYearTotal) / lastYearTotal) * 100);
      if (pct > 2) {
        advice.push("予想収穫量は、直近の実績と比べて約" + pct + "%増の見込みです（比較対象: " + fieldsWithHistory + "圃場）。");
      } else if (pct < -2) {
        advice.push("予想収穫量は、直近の実績と比べて約" + Math.abs(pct) + "%減の見込みです（比較対象: " + fieldsWithHistory + "圃場）。面積の変更なども含め要因は複数考えられます。");
      } else {
        advice.push("予想収穫量は、直近の実績とほぼ同水準の見込みです（比較対象: " + fieldsWithHistory + "圃場）。");
      }
    }

    // 2. Growth-status advisory — based purely on the input itself, independent of
    // the year-over-year number above, so a normal-growth field is never described
    // as "生育不良" just because its forecast happens to be lower than last year.
    var goodFields = state.fields.filter(function (f) {
      return f.current.growthStatus === "good" || f.current.growthStatus === "very_good";
    });
    var badFields = state.fields.filter(function (f) {
      return f.current.growthStatus === "very_bad" || f.current.growthStatus === "bad";
    });
    if (goodFields.length > 0) {
      var goodDescs = goodFields.map(function (f) {
        return "「" + escapeHtml(f.name) + "」（" + GROWTH_MAP[f.current.growthStatus].label + "）";
      }).join("・");
      advice.push("圃場" + goodDescs + "は入力された生育状況により、収穫量を上方に補正しています。");
    }
    if (badFields.length > 0) {
      var badDescs = badFields.map(function (f) {
        return "「" + escapeHtml(f.name) + "」（" + GROWTH_MAP[f.current.growthStatus].label + "）";
      }).join("・");
      advice.push("圃場" + badDescs + "は入力された生育状況により、収穫量を下方に補正しています。生育状況タブの内容をご確認ください。");
    }

    // 3. Month concentration — only over fields whose sales are actually computed.
    var monthKeys = Object.keys(monthTotals);
    if (monthKeys.length > 0 && totalSales > 0) {
      var topMonth = monthKeys.sort(function (a, b) { return monthTotals[b] - monthTotals[a]; })[0];
      var monthLabel = parseInt(topMonth.split("-")[1], 10) + "月";
      var share = Math.round((monthTotals[topMonth] / totalSales) * 100);
      advice.push(monthLabel + "に売上が集中しています（算出済み分の予想売上 " + formatMan(monthTotals[topMonth]) + "、算出済み合計の約" + share + "%）。");
    }

    // 4. Top field share — only over fields whose sales are actually computed.
    var computableFields = state.fields.filter(function (f) { return preds[f.id].salesComputable; });
    if (computableFields.length > 1 && totalSales > 0) {
      var top = computableFields.slice().sort(function (a, b) { return preds[b.id].stdSales - preds[a.id].stdSales; })[0];
      var topShare = Math.round((preds[top.id].stdSales / totalSales) * 100);
      if (topShare >= 20) {
        advice.push("圃場「" + escapeHtml(top.name) + "」は算出済み売上合計の約" + topShare + "%を占めています。");
      }
    }

    if (advice.length === 0) {
      advice.push("生育状況や過去実績、販売予定単価を入力すると、ここに今年の予測ポイントが表示されます。");
    }

    var listEl = $("advice-list");
    listEl.innerHTML = "";
    advice.forEach(function (text) {
      var li = document.createElement("li");
      li.textContent = text;
      listEl.appendChild(li);
    });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- field list ----------

  function renderFieldList() {
    var listEl = $("fields-list");
    var hasFields = state.fields.length > 0;
    $("fields-empty").hidden = hasFields;
    listEl.hidden = !hasFields;
    listEl.innerHTML = "";
    if (!hasFields) return;

    var preds = allPredictions();
    var fields = state.fields.slice();
    if (fieldSort === "sales-desc") {
      fields.sort(function (a, b) { return compareBySales(preds, a, b); });
    } else {
      fields.sort(function (a, b) {
        var da = a.harvestDate || "9999-99-99";
        var db = b.harvestDate || "9999-99-99";
        return da < db ? -1 : da > db ? 1 : 0;
      });
    }

    fields.forEach(function (f) {
      var p = preds[f.id];
      var growth = GROWTH_MAP[f.current.growthStatus] || GROWTH_MAP.normal;
      var card = document.createElement("div");
      card.className = "field-card";
      card.innerHTML =
        '<div class="field-card-top">' +
          '<span class="field-card-name">' + escapeHtml(f.name) + '</span>' +
          '<span class="breakdown-crop-badge badge-' + f.crop + '">' + CROP_LABELS[f.crop] + '</span>' +
        '</div>' +
        '<div class="field-card-meta">面積 ' + formatInt(f.area) + 'a　収穫予定 ' + (f.harvestDate ? formatDate(f.harvestDate) : "未設定") + '</div>' +
        '<div class="field-card-bottom">' +
          '<span class="growth-badge growth-' + growth.key + '">' + growth.label + '</span>' +
          '<span class="field-card-sales' + (p.salesComputable ? '' : ' field-card-sales-muted') + '">' + formatManOrDash(p.stdSales) + '</span>' +
        '</div>';
      card.addEventListener("click", function () { openFieldDetail(f.id); });
      listEl.appendChild(card);
    });
  }

  // ---------- field detail ----------

  function openFieldDetail(id) {
    currentFieldId = id;
    currentDetailTab = "basic";
    showView("field-detail");
    renderFieldDetail();
  }

  function getCurrentField() {
    return state.fields.find(function (f) { return f.id === currentFieldId; });
  }

  function renderFieldDetail() {
    var f = getCurrentField();
    if (!f) { showView("fields"); return; }

    $("field-detail-title").textContent = f.name;

    var p = computeFieldPrediction(f);
    $("predict-harvest-min").textContent = formatKgOrDash(p.minHarvest);
    $("predict-harvest-std").textContent = formatKgOrDash(p.stdHarvest);
    $("predict-harvest-max").textContent = formatKgOrDash(p.maxHarvest);
    $("predict-sales-min").textContent = formatManOrDash(p.minSales);
    $("predict-sales-std").textContent = formatManOrDash(p.stdSales);
    $("predict-sales-max").textContent = formatManOrDash(p.maxSales);
    renderPredictBasis(p);
    renderPredictMissing(p);

    // basic info
    var info = $("field-info-list");
    var rows = [
      ["作物", CROP_LABELS[f.crop]],
      ["品種", f.variety || "未設定"],
      ["面積", formatInt(f.area) + "a"],
      ["播種日", formatDate(f.seedingDate)],
      f.crop === "negi" ? ["定植日", formatDate(f.plantingDate)] : ["田植え日", formatDate(f.taueDate)],
      ["収穫予定日", formatDate(f.harvestDate)],
      ["担当者", f.manager || "未設定"],
      ["メモ", f.memo || "なし"]
    ];
    info.innerHTML = rows.map(function (r) {
      return "<div><dt>" + r[0] + "</dt><dd>" + escapeHtml(r[1]) + "</dd></div>";
    }).join("");

    renderRecordList();
    renderGrowthForm();
    setDetailTab(currentDetailTab);
  }

  function renderPredictBasis(p) {
    var items = [];

    if (p.harvestComputable) {
      items.push(p.hasHistory
        ? "平均10aあたり収量: " + formatInt(p.avgYieldPer10a) + "kg（過去実績から算出）"
        : "標準収量: " + formatInt(p.avgYieldPer10a) + "kg/10a（生育状況タブの手入力値）");
    } else {
      items.push("平均10aあたり収量: 未算出（過去実績も標準収量の入力もありません）");
    }

    var factorPct = Math.round((p.growthFactor - 1) * 100);
    var factorText = factorPct === 0 ? "±0%" : (factorPct > 0 ? "+" + factorPct + "%" : factorPct + "%");
    items.push("生育補正: 「" + p.growthLabel + "」（" + factorText + "）");

    if (p.hasSellThroughData) {
      items.push("販売歩留まり: " + formatPercent(p.sellThroughRate) + "（過去実績の販売量合計 ÷ 収穫量合計から算出）" +
        (p.sellThroughExceeds100 ? "　⚠ 販売量合計が収穫量合計を超えています。実績の入力内容をご確認ください。" : ""));
    } else {
      items.push("販売歩留まり: 100%（実績データがないため、全量販売を仮定）");
    }

    items.push("販売予定単価: " + (p.price != null ? formatYen(p.price) + "/kg" : "未算出（生育状況タブで未入力）"));

    var basisEl = $("predict-basis");
    basisEl.innerHTML = '<ul>' + items.map(function (t) { return "<li>" + t + "</li>"; }).join("") + '</ul>';
  }

  function renderPredictMissing(p) {
    var el = $("predict-missing");
    if (p.salesComputable) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    var message, actions;
    if (!p.harvestComputable) {
      message = "収穫量を計算するには、過去実績を追加するか、生育状況タブで「標準収量」を入力してください。";
      actions = [["過去実績を追加", "history"], ["生育状況を入力", "growth"]];
    } else {
      message = "売上を計算するには、生育状況タブで「販売予定単価」を入力してください。";
      actions = [["生育状況を入力", "growth"]];
    }
    el.innerHTML = "<p>" + message + "</p>" +
      '<div class="predict-missing-actions">' +
      actions.map(function (a) { return '<button type="button" data-tab="' + a[1] + '">' + a[0] + '</button>'; }).join("") +
      '</div>';
    el.hidden = false;
  }

  function setDetailTab(tab) {
    currentDetailTab = tab;
    document.querySelectorAll("#field-detail-tabs .seg-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    ["basic", "history", "growth"].forEach(function (t) {
      $("tab-" + t).hidden = t !== tab;
    });
  }

  function renderRecordList() {
    var f = getCurrentField();
    var listEl = $("record-list");
    listEl.innerHTML = "";
    var records = (f.pastRecords || []).slice().sort(function (a, b) { return num(b.year) - num(a.year); });
    if (records.length === 0) {
      listEl.innerHTML = '<p class="card-desc">まだ過去実績がありません。追加すると予測の精度が上がります。</p>';
      return;
    }
    records.forEach(function (r) {
      var salesText = (r.salesAmount != null && r.avgPrice != null) ? formatYen(r.salesAmount * r.avgPrice) : "未算出";
      var areaText = r.area != null ? formatInt(r.area) + "a" : "未入力";
      var harvestText = r.harvestAmount != null ? formatKg(r.harvestAmount) : "未入力";
      var soldText = r.salesAmount != null ? formatKg(r.salesAmount) : "未入力";
      var priceText = r.avgPrice != null ? formatYen(r.avgPrice) + "/kg" : "未入力";
      var card = document.createElement("div");
      card.className = "record-card";
      card.innerHTML =
        '<div class="record-card-top"><span>' + num(r.year) + '年</span><span>' + salesText + '</span></div>' +
        '<div class="record-card-detail">面積 ' + areaText + '　収穫 ' + harvestText + '　販売 ' + soldText + '（' + priceText + '）</div>';
      card.addEventListener("click", function () { openRecordModal(r.id); });
      listEl.appendChild(card);
    });
  }

  function renderGrowthForm() {
    var f = getCurrentField();
    $("growth-status").value = f.current.growthStatus;
    $("growth-pest").value = f.current.pest;
    $("growth-weather").value = f.current.weather;
    $("growth-note").value = f.current.note;
    $("growth-area").value = (f.current.thisYearArea != null) ? f.current.thisYearArea : "";
    $("growth-standard-yield").value = (f.current.standardYieldPer10a != null) ? f.current.standardYieldPer10a : "";
    $("growth-price").value = (f.current.plannedPrice != null) ? f.current.plannedPrice : "";

    var hasHistory = validYieldRecords(f).length > 0;
    $("growth-standard-yield-hint").hidden = hasHistory;
    $("growth-standard-yield-hint").textContent = hasHistory
      ? ""
      : "過去実績がないため、この値を使って予測します（空欄のままだと収穫量は「未算出」になります）";
  }

  function saveGrowthForm(e) {
    e.preventDefault();
    var f = getCurrentField();
    f.current.growthStatus = $("growth-status").value;
    f.current.pest = $("growth-pest").value.trim();
    f.current.weather = $("growth-weather").value.trim();
    f.current.note = $("growth-note").value.trim();
    var areaInput = numOrNull($("growth-area").value);
    f.current.thisYearArea = (areaInput != null) ? areaInput : (f.area || 0);
    f.current.standardYieldPer10a = numOrNull($("growth-standard-yield").value);
    f.current.plannedPrice = numOrNull($("growth-price").value);
    saveState();
    renderFieldDetail();
    setDetailTab("growth");
  }

  // ---------- record modal ----------

  function openRecordModal(recordId) {
    currentRecordId = recordId || null;
    var f = getCurrentField();
    var record = recordId ? f.pastRecords.find(function (r) { return r.id === recordId; }) : null;

    $("record-modal-title").textContent = record ? "過去実績を編集" : "過去実績を追加";
    $("rf-year").value = record ? record.year : (new Date().getFullYear() - 1);
    $("rf-area").value = record ? (record.area != null ? record.area : "") : (f.area != null ? f.area : "");
    $("rf-harvest").value = record && record.harvestAmount != null ? record.harvestAmount : "";
    $("rf-sold").value = record && record.salesAmount != null ? record.salesAmount : "";
    $("rf-price").value = record && record.avgPrice != null ? record.avgPrice : "";
    $("rf-fertilizer").value = record ? record.fertilizerCost : "";
    $("rf-pesticide").value = record ? record.pesticideCost : "";
    $("rf-labor").value = record ? record.laborCost : "";
    $("rf-other").value = record ? record.otherCost : "";
    $("record-delete-btn").hidden = !record;
    updateComputedSales();
    $("record-modal-overlay").hidden = false;
  }

  function closeRecordModal() {
    $("record-modal-overlay").hidden = true;
    currentRecordId = null;
  }

  function updateComputedSales() {
    var harvest = numOrNull($("rf-harvest").value);
    var sold = numOrNull($("rf-sold").value);
    var price = numOrNull($("rf-price").value);
    var sales = (sold != null && price != null) ? sold * price : null;
    $("rf-sales-computed").textContent = sales != null ? formatYen(sales) : "未算出（販売量・単価を入力してください）";
    $("rf-oversell-warning").hidden = !(harvest != null && sold != null && sold > harvest);
  }

  function saveRecordForm(e) {
    e.preventDefault();
    var f = getCurrentField();
    var data = {
      id: currentRecordId || uid(),
      year: num($("rf-year").value),
      area: numOrNull($("rf-area").value),
      harvestAmount: numOrNull($("rf-harvest").value),
      salesAmount: numOrNull($("rf-sold").value),
      avgPrice: numOrNull($("rf-price").value),
      fertilizerCost: num($("rf-fertilizer").value),
      pesticideCost: num($("rf-pesticide").value),
      laborCost: num($("rf-labor").value),
      otherCost: num($("rf-other").value)
    };
    if (currentRecordId) {
      var idx = f.pastRecords.findIndex(function (r) { return r.id === currentRecordId; });
      f.pastRecords[idx] = data;
    } else {
      f.pastRecords.push(data);
    }
    saveState();
    closeRecordModal();
    renderFieldDetail();
    setDetailTab("history");
  }

  function deleteRecord() {
    if (!currentRecordId) return;
    if (!confirm("この過去実績を削除しますか？")) return;
    var f = getCurrentField();
    f.pastRecords = f.pastRecords.filter(function (r) { return r.id !== currentRecordId; });
    saveState();
    closeRecordModal();
    renderFieldDetail();
    setDetailTab("history");
  }

  // ---------- field form (create/edit basic info) ----------

  function openFieldForm(fieldId) {
    var f = fieldId ? state.fields.find(function (x) { return x.id === fieldId; }) : null;
    currentFieldId = fieldId || null;

    $("field-form-title").textContent = f ? "圃場を編集" : "圃場を登録";
    $("ff-name").value = f ? f.name : "";
    $("ff-crop").value = f ? f.crop : "negi";
    $("ff-variety").value = f ? f.variety : "";
    $("ff-area").value = f ? f.area : "";
    $("ff-seeding-date").value = f ? (f.seedingDate || "") : "";
    $("ff-planting-date").value = f ? (f.plantingDate || "") : "";
    $("ff-taue-date").value = f ? (f.taueDate || "") : "";
    $("ff-harvest-date").value = f ? (f.harvestDate || "") : "";
    $("ff-manager").value = f ? f.manager : "";
    $("ff-memo").value = f ? f.memo : "";
    toggleCropDateFields();
    showView("field-form");
  }

  function toggleCropDateFields() {
    var crop = $("ff-crop").value;
    $("ff-planting-wrap").hidden = crop !== "negi";
    $("ff-taue-wrap").hidden = crop !== "kome";
  }

  function saveFieldForm(e) {
    e.preventDefault();
    var isEdit = !!currentFieldId;
    var f = isEdit ? state.fields.find(function (x) { return x.id === currentFieldId; }) : null;

    var data = {
      id: isEdit ? f.id : uid(),
      name: $("ff-name").value.trim(),
      crop: $("ff-crop").value,
      variety: $("ff-variety").value.trim(),
      area: num($("ff-area").value),
      seedingDate: $("ff-seeding-date").value,
      plantingDate: $("ff-planting-date").value,
      taueDate: $("ff-taue-date").value,
      harvestDate: $("ff-harvest-date").value,
      manager: $("ff-manager").value.trim(),
      memo: $("ff-memo").value.trim(),
      pastRecords: isEdit ? f.pastRecords : [],
      current: isEdit ? f.current : {
        growthStatus: "normal", pest: "", weather: "", note: "",
        thisYearArea: num($("ff-area").value), standardYieldPer10a: null, plannedPrice: null
      }
    };

    if (isEdit) {
      var idx = state.fields.findIndex(function (x) { return x.id === f.id; });
      state.fields[idx] = data;
    } else {
      state.fields.push(data);
    }
    saveState();
    currentFieldId = data.id;
    openFieldDetail(data.id);
  }

  function deleteCurrentField() {
    if (!confirm("この圃場を削除しますか？関連する過去実績もすべて削除されます。")) return;
    state.fields = state.fields.filter(function (f) { return f.id !== currentFieldId; });
    saveState();
    showView("fields");
  }

  // ---------- data management ----------

  function exportData() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = "negi-kome-yosoku-" + today + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importData() {
    var fileInput = $("import-file");
    var file = fileInput.files[0];
    if (!file) { alert("読み込むJSONファイルを選択してください。"); return; }
    if (!confirm("現在のデータを上書きします。よろしいですか？")) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var parsed = JSON.parse(e.target.result);
        if (!parsed || !Array.isArray(parsed.fields)) throw new Error("invalid format");
        state.fields = parsed.fields.map(migrateField);
        saveState();
        fileInput.value = "";
        alert("データを読み込みました。");
        showView("dashboard");
      } catch (err) {
        alert("ファイルの読み込みに失敗しました。正しいJSONファイルか確認してください。");
      }
    };
    reader.readAsText(file);
  }

  function clearAllData() {
    if (!confirm("すべての圃場データを削除します。この操作は元に戻せません。よろしいですか？")) return;
    state.fields = [];
    saveState();
    showView("dashboard");
  }

  // ---------- init ----------

  function init() {
    loadState();

    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { showView(btn.dataset.view); });
    });

    $("header-add-btn").addEventListener("click", function () { openFieldForm(null); });
    $("dashboard-empty-add-btn").addEventListener("click", function () { openFieldForm(null); });
    $("fields-empty-add-btn").addEventListener("click", function () { openFieldForm(null); });

    document.querySelectorAll(".sort-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        fieldSort = btn.dataset.sort;
        document.querySelectorAll(".sort-btn").forEach(function (b) { b.classList.toggle("active", b === btn); });
        renderFieldList();
      });
    });

    $("field-detail-back").addEventListener("click", function () { showView("fields"); });
    $("field-detail-edit").addEventListener("click", function () { openFieldForm(currentFieldId); });
    $("field-delete-btn").addEventListener("click", deleteCurrentField);

    document.querySelectorAll("#field-detail-tabs .seg-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { setDetailTab(btn.dataset.tab); });
    });

    $("add-record-btn").addEventListener("click", function () { openRecordModal(null); });
    $("record-modal-close").addEventListener("click", closeRecordModal);
    $("record-form").addEventListener("submit", saveRecordForm);
    $("record-delete-btn").addEventListener("click", deleteRecord);
    ["rf-harvest", "rf-sold", "rf-price"].forEach(function (id) {
      $(id).addEventListener("input", updateComputedSales);
    });

    $("growth-form").addEventListener("submit", saveGrowthForm);

    $("predict-missing").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-tab]");
      if (btn) setDetailTab(btn.dataset.tab);
    });

    $("field-form-cancel").addEventListener("click", function () {
      if (currentFieldId && state.fields.some(function (f) { return f.id === currentFieldId; })) {
        openFieldDetail(currentFieldId);
      } else {
        showView("fields");
      }
    });
    $("ff-crop").addEventListener("change", toggleCropDateFields);
    $("field-form").addEventListener("submit", saveFieldForm);

    $("export-btn").addEventListener("click", exportData);
    $("import-btn").addEventListener("click", importData);
    $("clear-all-btn").addEventListener("click", clearAllData);

    showView("dashboard");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
