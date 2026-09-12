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
    f.pastRecords = Array.isArray(f.pastRecords) ? f.pastRecords : [];
    f.current = f.current || {};
    f.current.growthStatus = f.current.growthStatus || "normal";
    f.current.pest = f.current.pest || "";
    f.current.weather = f.current.weather || "";
    f.current.note = f.current.note || "";
    f.current.thisYearArea = (typeof f.current.thisYearArea === "number") ? f.current.thisYearArea : (f.area || 0);
    f.current.standardYieldPer10a = (typeof f.current.standardYieldPer10a === "number") ? f.current.standardYieldPer10a : 0;
    f.current.plannedPrice = (typeof f.current.plannedPrice === "number") ? f.current.plannedPrice : 0;
    return f;
  }

  // ---------- prediction ----------

  function computeFieldPrediction(field) {
    var past = field.pastRecords || [];
    var validPast = past.filter(function (r) { return num(r.area) > 0; });
    var avgYieldPer10a;
    var hasHistory = validPast.length > 0;
    if (hasHistory) {
      var sum = 0;
      validPast.forEach(function (r) {
        sum += (num(r.harvestAmount) / num(r.area)) * 10;
      });
      avgYieldPer10a = sum / validPast.length;
    } else {
      avgYieldPer10a = num(field.current.standardYieldPer10a);
    }

    var thisArea = num(field.current.thisYearArea) || num(field.area) || 0;
    var factor = (GROWTH_MAP[field.current.growthStatus] || GROWTH_MAP.normal).factor;
    var stdHarvest = avgYieldPer10a * (thisArea / 10) * factor;
    var minHarvest = stdHarvest * 0.9;
    var maxHarvest = stdHarvest * 1.1;

    var price = num(field.current.plannedPrice);
    var stdSales = stdHarvest * price;
    var minSales = minHarvest * price;
    var maxSales = maxHarvest * price;

    return {
      hasHistory: hasHistory,
      avgYieldPer10a: avgYieldPer10a,
      stdHarvest: stdHarvest, minHarvest: minHarvest, maxHarvest: maxHarvest,
      stdSales: stdSales, minSales: minSales, maxSales: maxSales
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
    var cropTotals = { negi: { harvest: 0, sales: 0 }, kome: { harvest: 0, sales: 0 } };
    var monthTotals = {};
    var now = new Date();
    var thisMonthKey = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    var nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    var nextMonthKey = nextMonthDate.getFullYear() + "-" + String(nextMonthDate.getMonth() + 1).padStart(2, "0");
    var thisMonthSales = 0, nextMonthSales = 0;

    state.fields.forEach(function (f) {
      var p = preds[f.id];
      totalHarvest += p.stdHarvest;
      totalSales += p.stdSales;
      if (cropTotals[f.crop]) {
        cropTotals[f.crop].harvest += p.stdHarvest;
        cropTotals[f.crop].sales += p.stdSales;
      }
      var mk = monthKey(f.harvestDate);
      if (mk) {
        monthTotals[mk] = (monthTotals[mk] || 0) + p.stdSales;
        if (mk === thisMonthKey) thisMonthSales += p.stdSales;
        if (mk === nextMonthKey) nextMonthSales += p.stdSales;
      }
    });

    $("stat-total-harvest").textContent = formatKg(totalHarvest);
    $("stat-total-sales").textContent = formatMan(totalSales);
    $("stat-this-month").textContent = formatMan(thisMonthSales);
    $("stat-next-month").textContent = formatMan(nextMonthSales);

    // crop breakdown
    var cropEl = $("crop-breakdown");
    cropEl.innerHTML = "";
    ["negi", "kome"].forEach(function (crop) {
      if (!state.fields.some(function (f) { return f.crop === crop; })) return;
      var t = cropTotals[crop];
      var row = document.createElement("div");
      row.className = "breakdown-row";
      row.innerHTML =
        '<span class="breakdown-crop-badge badge-' + crop + '">' + (crop === "negi" ? "🧅" : "🌾") + " " + CROP_LABELS[crop] + '</span>' +
        '<span>' +
        '<span class="breakdown-value">' + formatMan(t.sales) + '</span>' +
        '<span class="breakdown-sub"> / ' + formatKg(t.harvest) + '</span>' +
        '</span>';
      cropEl.appendChild(row);
    });

    // monthly breakdown
    var monthEl = $("monthly-breakdown");
    monthEl.innerHTML = "";
    var monthKeys = Object.keys(monthTotals).sort();
    if (monthKeys.length === 0) {
      monthEl.innerHTML = '<p class="card-desc">収穫予定日が未設定のため、月別の集計はまだ表示できません。</p>';
    } else {
      var maxVal = Math.max.apply(null, monthKeys.map(function (k) { return monthTotals[k]; }));
      monthKeys.forEach(function (k) {
        var parts = k.split("-");
        var label = parseInt(parts[1], 10) + "月";
        var val = monthTotals[k];
        var pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
        var row = document.createElement("div");
        row.className = "month-row";
        row.innerHTML =
          '<span class="month-label">' + label + '</span>' +
          '<span class="month-bar-track"><span class="month-bar-fill" style="width:' + pct + '%"></span></span>' +
          '<span class="month-value">' + formatMan(val) + '</span>';
        monthEl.appendChild(row);
      });
    }

    // field breakdown (top by sales)
    var fieldEl = $("field-breakdown");
    fieldEl.innerHTML = "";
    var sortedFields = state.fields.slice().sort(function (a, b) {
      return preds[b.id].stdSales - preds[a.id].stdSales;
    });
    sortedFields.forEach(function (f) {
      var p = preds[f.id];
      var share = totalSales > 0 ? Math.round((p.stdSales / totalSales) * 100) : 0;
      var row = document.createElement("div");
      row.className = "breakdown-row";
      row.innerHTML =
        '<span class="breakdown-name">' + escapeHtml(f.name) + '<span class="breakdown-sub"> (' + CROP_LABELS[f.crop] + ')</span></span>' +
        '<span><span class="breakdown-value">' + formatMan(p.stdSales) + '</span><span class="breakdown-sub"> (' + share + '%)</span></span>';
      fieldEl.appendChild(row);
    });

    renderAdvice(preds, totalHarvest, totalSales, monthTotals);
  }

  function renderAdvice(preds, totalHarvest, totalSales, monthTotals) {
    var advice = [];

    // 1. year-over-year comparison, using each field's most recent past year
    var lastYearTotal = 0, thisYearForThose = 0, fieldsWithHistory = 0;
    state.fields.forEach(function (f) {
      if (!f.pastRecords || f.pastRecords.length === 0) return;
      var latest = f.pastRecords.slice().sort(function (a, b) { return num(b.year) - num(a.year); })[0];
      lastYearTotal += num(latest.harvestAmount);
      thisYearForThose += preds[f.id].stdHarvest;
      fieldsWithHistory++;
    });
    if (fieldsWithHistory > 0 && lastYearTotal > 0) {
      var pct = Math.round(((thisYearForThose - lastYearTotal) / lastYearTotal) * 100);
      if (pct > 2) {
        advice.push("今年は平年より生育が良いため、昨年比約" + pct + "%増の収穫が見込まれます。");
      } else if (pct < -2) {
        advice.push("今年は生育がやや振るわず、昨年比約" + Math.abs(pct) + "%減の収穫が見込まれます。");
      } else {
        advice.push("今年の収穫量は、昨年とほぼ同水準の見込みです。");
      }
    }

    // 2. month concentration
    var monthKeys = Object.keys(monthTotals);
    if (monthKeys.length > 0) {
      var topMonth = monthKeys.sort(function (a, b) { return monthTotals[b] - monthTotals[a]; })[0];
      var monthLabel = parseInt(topMonth.split("-")[1], 10) + "月";
      var share = totalSales > 0 ? Math.round((monthTotals[topMonth] / totalSales) * 100) : 0;
      advice.push(monthLabel + "に収穫と売上が集中しています（予想売上 " + formatMan(monthTotals[topMonth]) + "、全体の約" + share + "%）。");
    }

    // 3. top field share
    if (state.fields.length > 1 && totalSales > 0) {
      var top = state.fields.slice().sort(function (a, b) { return preds[b.id].stdSales - preds[a.id].stdSales; })[0];
      var topShare = Math.round((preds[top.id].stdSales / totalSales) * 100);
      if (topShare >= 20) {
        advice.push("圃場「" + escapeHtml(top.name) + "」は売上全体の約" + topShare + "%を占めています。");
      }
    }

    // 4. bad growth warning
    var badFields = state.fields.filter(function (f) {
      return f.current.growthStatus === "very_bad" || f.current.growthStatus === "bad";
    });
    if (badFields.length > 0) {
      var names = badFields.map(function (f) { return f.name; }).join("・");
      advice.push("圃場「" + escapeHtml(names) + "」は生育がやや振るわないため、注意が必要です。");
    }

    if (advice.length === 0) {
      advice.push("生育状況や過去実績を入力すると、ここに今年の予測ポイントが表示されます。");
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
      fields.sort(function (a, b) { return preds[b.id].stdSales - preds[a.id].stdSales; });
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
          '<span class="field-card-sales">' + formatMan(p.stdSales) + '</span>' +
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
    $("predict-harvest-min").textContent = formatKg(p.minHarvest);
    $("predict-harvest-std").textContent = formatKg(p.stdHarvest);
    $("predict-harvest-max").textContent = formatKg(p.maxHarvest);
    $("predict-sales-min").textContent = formatMan(p.minSales);
    $("predict-sales-std").textContent = formatMan(p.stdSales);
    $("predict-sales-max").textContent = formatMan(p.maxSales);
    $("predict-note").textContent = p.hasHistory
      ? "過去実績の平均10aあたり収量（" + formatInt(p.avgYieldPer10a) + "kg）をもとに計算しています。"
      : "過去実績がないため、生育状況タブの「標準収量」の入力値をもとに計算しています。";

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
      var sales = num(r.salesAmount) * num(r.avgPrice);
      var card = document.createElement("div");
      card.className = "record-card";
      card.innerHTML =
        '<div class="record-card-top"><span>' + num(r.year) + '年</span><span>' + formatYen(sales) + '</span></div>' +
        '<div class="record-card-detail">面積 ' + formatInt(r.area) + 'a　収穫 ' + formatKg(r.harvestAmount) + '　販売 ' + formatKg(r.salesAmount) + '（' + formatYen(r.avgPrice) + '/kg）</div>';
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
    $("growth-area").value = f.current.thisYearArea || "";
    $("growth-standard-yield").value = f.current.standardYieldPer10a || "";
    $("growth-price").value = f.current.plannedPrice || "";

    var hasHistory = (f.pastRecords || []).some(function (r) { return num(r.area) > 0; });
    $("growth-standard-yield-hint").hidden = hasHistory;
    $("growth-standard-yield-hint").textContent = hasHistory
      ? ""
      : "過去実績がないため、この値を使って予測します";
    $("growth-standard-yield-hint").style.display = hasHistory ? "none" : "block";
  }

  function saveGrowthForm(e) {
    e.preventDefault();
    var f = getCurrentField();
    f.current.growthStatus = $("growth-status").value;
    f.current.pest = $("growth-pest").value.trim();
    f.current.weather = $("growth-weather").value.trim();
    f.current.note = $("growth-note").value.trim();
    f.current.thisYearArea = num($("growth-area").value);
    f.current.standardYieldPer10a = num($("growth-standard-yield").value);
    f.current.plannedPrice = num($("growth-price").value);
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
    $("rf-area").value = record ? record.area : (f.area || "");
    $("rf-harvest").value = record ? record.harvestAmount : "";
    $("rf-sold").value = record ? record.salesAmount : "";
    $("rf-price").value = record ? record.avgPrice : "";
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
    var sales = num($("rf-sold").value) * num($("rf-price").value);
    $("rf-sales-computed").textContent = formatYen(sales);
  }

  function saveRecordForm(e) {
    e.preventDefault();
    var f = getCurrentField();
    var data = {
      id: currentRecordId || uid(),
      year: num($("rf-year").value),
      area: num($("rf-area").value),
      harvestAmount: num($("rf-harvest").value),
      salesAmount: num($("rf-sold").value),
      avgPrice: num($("rf-price").value),
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
        thisYearArea: num($("ff-area").value), standardYieldPer10a: 0, plannedPrice: 0
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
    ["rf-sold", "rf-price"].forEach(function (id) {
      $(id).addEventListener("input", updateComputedSales);
    });

    $("growth-form").addEventListener("submit", saveGrowthForm);

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
