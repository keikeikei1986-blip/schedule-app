(function () {
  "use strict";

  var STORAGE_KEY = "app-pipeline-v1";

  var STAGES = [
    { name: "アイデア", progress: 10, badge: "stage-idea" },
    { name: "基本設計", progress: 20, badge: "stage-early" },
    { name: "プロンプト作成", progress: 30, badge: "stage-early" },
    { name: "初期開発", progress: 50, badge: "stage-early" },
    { name: "MVP確認", progress: 70, badge: "stage-mid" },
    { name: "MVP修正", progress: 80, badge: "stage-mid" },
    { name: "公開準備", progress: 90, badge: "stage-prep" },
    { name: "公開済", progress: 100, badge: "stage-done" },
    { name: "改善中", progress: 100, badge: "stage-improve" }
  ];

  var DEV_AI_OPTIONS = ["未設定", "Claude Code", "Codex", "その他"];

  var OUTREACH_KEYS = ["githubPages", "x", "wordpress", "note", "youtube", "instagram"];
  var OUTREACH_LABELS = {
    githubPages: "GitHub Pages公開",
    x: "X投稿",
    wordpress: "WordPress掲載",
    note: "Note投稿",
    youtube: "YouTube投稿",
    instagram: "Instagram投稿"
  };
  var REQUIRED_OUTREACH = ["githubPages", "x", "wordpress"];

  var FIX_STATUSES = ["未着手", "修正中", "完了"];

  var state = { apps: [], nextNo: 1 };

  var ui = {
    filter: "all",
    search: "",
    sort: "no",
    activeDetailId: null
  };

  // ---------- Persistence ----------

  function loadState() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { apps: [], nextNo: 1 };
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.apps)) return { apps: [], nextNo: 1 };
      parsed.apps.forEach(function (app) {
        app.outreach = app.outreach || {};
        OUTREACH_KEYS.forEach(function (k) {
          app.outreach[k] = !!app.outreach[k];
        });
        app.fixHistory = Array.isArray(app.fixHistory) ? app.fixHistory : [];
      });
      if (typeof parsed.nextNo !== "number") parsed.nextNo = 1;
      return parsed;
    } catch (e) {
      return { apps: [], nextNo: 1 };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ---------- Helpers ----------

  function uid() {
    return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function pad3(n) {
    return String(n).padStart(3, "0");
  }

  function todayStr() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function stageInfo(name) {
    for (var i = 0; i < STAGES.length; i++) {
      if (STAGES[i].name === name) return STAGES[i];
    }
    return STAGES[0];
  }

  function isPublishedStage(stage) {
    return stage === "公開済" || stage === "改善中";
  }

  function isPublishedApp(app) {
    return isPublishedStage(app.stage) || !!app.publishedDate;
  }

  function isOverdue(app) {
    return !isPublishedApp(app) && !!app.plannedPublishDate && app.plannedPublishDate < todayStr();
  }

  function hasLeak(app) {
    if (!isPublishedApp(app)) return false;
    return REQUIRED_OUTREACH.some(function (k) {
      return !app.outreach[k];
    });
  }

  function missingRequiredLabels(app) {
    return REQUIRED_OUTREACH.filter(function (k) {
      return !app.outreach[k];
    }).map(function (k) {
      return OUTREACH_LABELS[k].replace("投稿", "").replace("掲載", "").replace("公開", "");
    });
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var today = new Date(todayStr() + "T00:00:00");
    var target = new Date(dateStr + "T00:00:00");
    return Math.round((target - today) / 86400000);
  }

  function isThisWeek(app) {
    if (isPublishedApp(app) || !app.plannedPublishDate) return false;
    var d = daysUntil(app.plannedPublishDate);
    return d !== null && d >= 0 && d <= 6;
  }

  function isInProgressStage(stage) {
    return stage !== "アイデア" && !isPublishedStage(stage);
  }

  function fmtDate(d) {
    return d ? d : "-";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- App CRUD ----------

  function createApp(data) {
    var stage = data.stage || "アイデア";
    var app = {
      id: uid(),
      no: state.nextNo,
      name: data.name.trim(),
      idea: data.idea || "",
      devAI: data.devAI || "未設定",
      stage: stage,
      progress: data.progress != null && data.progress !== "" ? clampPct(data.progress) : stageInfo(stage).progress,
      startDate: data.startDate || "",
      plannedPublishDate: data.plannedPublishDate || "",
      publishedDate: "",
      appUrl: "",
      githubUrl: "",
      nextAction: data.nextAction || "",
      memo: data.memo || "",
      outreach: { githubPages: false, x: false, wordpress: false, note: false, youtube: false, instagram: false },
      fixHistory: [],
      createdAt: Date.now()
    };
    state.nextNo += 1;
    state.apps.push(app);
    saveState();
    return app;
  }

  function clampPct(v) {
    var n = parseFloat(v);
    if (isNaN(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }

  function findApp(id) {
    return state.apps.find(function (a) { return a.id === id; });
  }

  function updateApp(id, patch) {
    var app = findApp(id);
    if (!app) return;
    Object.assign(app, patch);
    saveState();
  }

  function deleteApp(id) {
    state.apps = state.apps.filter(function (a) { return a.id !== id; });
    saveState();
  }

  // ---------- Stats ----------

  function computeStats() {
    var apps = state.apps;
    var total = apps.length;
    var published = apps.filter(isPublishedApp).length;
    var idea = apps.filter(function (a) { return a.stage === "アイデア"; }).length;
    var inProgress = apps.filter(function (a) { return isInProgressStage(a.stage); }).length;
    var week = apps.filter(isThisWeek).length;
    var leak = apps.filter(hasLeak).length;
    var avgProgress = total ? Math.round(apps.reduce(function (s, a) { return s + a.progress; }, 0) / total) : 0;
    var claude = apps.filter(function (a) { return a.devAI === "Claude Code"; }).length;
    var codex = apps.filter(function (a) { return a.devAI === "Codex"; }).length;
    return { total: total, published: published, idea: idea, inProgress: inProgress, week: week, leak: leak, avgProgress: avgProgress, claude: claude, codex: codex };
  }

  function renderDashboard() {
    var s = computeStats();
    document.getElementById("dash-count").textContent = s.total;
    var pct = Math.min(100, s.total);
    document.getElementById("dash-progress-fill").style.width = pct + "%";
    document.getElementById("dash-progress-pct").textContent = pct + "%";

    document.getElementById("stat-total").textContent = s.total;
    document.getElementById("stat-published").textContent = s.published;
    document.getElementById("stat-inprogress").textContent = s.inProgress;
    document.getElementById("stat-idea").textContent = s.idea;
    document.getElementById("stat-week").textContent = s.week;
    document.getElementById("stat-leak").textContent = s.leak;
    document.getElementById("stat-avg-progress").textContent = s.avgProgress + "%";
    document.getElementById("stat-claude").textContent = s.claude;
    document.getElementById("stat-codex").textContent = s.codex;
  }

  // ---------- Today panel ----------

  function buildTodayItems() {
    var items = [];
    state.apps.forEach(function (app) {
      var overdue = isOverdue(app);
      var leak = hasLeak(app);
      var d = daysUntil(app.plannedPublishDate);
      var near = !isPublishedApp(app) && d !== null && d >= 0 && d <= 3;
      var inProgressWithNext = isInProgressStage(app.stage) && app.nextAction;

      if (overdue) {
        items.push({ app: app, severity: 0, cls: "is-overdue", reason: "公開予定日を超過しています" });
      } else if (leak) {
        items.push({ app: app, severity: 1, cls: "is-leak", reason: "⚠ 発信漏れ：" + missingRequiredLabels(app).join("・") + "未対応" });
      } else if (near) {
        items.push({ app: app, severity: 2, cls: "", reason: d === 0 ? "公開予定日は今日です" : "公開予定まであと" + d + "日" });
      } else if (inProgressWithNext) {
        items.push({ app: app, severity: 3, cls: "", reason: "制作中：" + app.stage });
      }
    });
    items.sort(function (a, b) { return a.severity - b.severity; });
    return items.slice(0, 12);
  }

  function renderToday() {
    var list = document.getElementById("today-list");
    var empty = document.getElementById("today-empty");
    var items = buildTodayItems();
    list.innerHTML = "";
    empty.hidden = items.length > 0;
    items.forEach(function (item) {
      var li = document.createElement("li");
      li.className = "today-item " + item.cls;
      li.dataset.id = item.app.id;
      li.innerHTML =
        '<div class="today-item-title">No.' + pad3(item.app.no) + " " + escapeHtml(item.app.name) + "</div>" +
        '<div class="today-item-reason">' + escapeHtml(item.reason) + "</div>" +
        (item.app.nextAction ? '<div class="today-item-next">' + escapeHtml(item.app.nextAction) + "</div>" : "");
      list.appendChild(li);
    });
  }

  // ---------- Filtering / sorting ----------

  function getFilteredSortedApps() {
    var apps = state.apps.slice();

    if (ui.filter === "アイデア") apps = apps.filter(function (a) { return a.stage === "アイデア"; });
    else if (ui.filter === "制作中") apps = apps.filter(function (a) { return isInProgressStage(a.stage); });
    else if (ui.filter === "公開済") apps = apps.filter(function (a) { return a.stage === "公開済"; });
    else if (ui.filter === "改善中") apps = apps.filter(function (a) { return a.stage === "改善中"; });
    else if (ui.filter === "発信漏れ") apps = apps.filter(hasLeak);
    else if (ui.filter === "今週公開予定") apps = apps.filter(isThisWeek);
    else if (ui.filter === "Claude Code") apps = apps.filter(function (a) { return a.devAI === "Claude Code"; });
    else if (ui.filter === "Codex") apps = apps.filter(function (a) { return a.devAI === "Codex"; });

    if (ui.search.trim()) {
      var q = ui.search.trim().toLowerCase();
      apps = apps.filter(function (a) {
        return (a.name || "").toLowerCase().indexOf(q) !== -1 || (a.memo || "").toLowerCase().indexOf(q) !== -1;
      });
    }

    switch (ui.sort) {
      case "new": apps.sort(function (a, b) { return b.createdAt - a.createdAt; }); break;
      case "old": apps.sort(function (a, b) { return a.createdAt - b.createdAt; }); break;
      case "progress-desc": apps.sort(function (a, b) { return b.progress - a.progress; }); break;
      case "progress-asc": apps.sort(function (a, b) { return a.progress - b.progress; }); break;
      case "deadline":
        apps.sort(function (a, b) {
          if (!a.plannedPublishDate && !b.plannedPublishDate) return a.no - b.no;
          if (!a.plannedPublishDate) return 1;
          if (!b.plannedPublishDate) return -1;
          return a.plannedPublishDate < b.plannedPublishDate ? -1 : 1;
        });
        break;
      default: apps.sort(function (a, b) { return a.no - b.no; });
    }
    return apps;
  }

  // ---------- Table rendering ----------

  function stageOptionsHtml(selected) {
    return STAGES.map(function (s) {
      return '<option value="' + s.name + '"' + (s.name === selected ? " selected" : "") + ">" + s.name + "</option>";
    }).join("");
  }

  function devAiOptionsHtml(selected) {
    return DEV_AI_OPTIONS.map(function (v) {
      return '<option value="' + v + '"' + (v === selected ? " selected" : "") + ">" + v + "</option>";
    }).join("");
  }

  function renderTable() {
    var tbody = document.getElementById("app-table-body");
    var apps = getFilteredSortedApps();
    var emptyEl = document.getElementById("table-empty");
    tbody.innerHTML = "";
    emptyEl.hidden = apps.length > 0;

    apps.forEach(function (app) {
      var tr = document.createElement("tr");
      tr.dataset.id = app.id;
      if (isOverdue(app)) tr.classList.add("is-overdue-row");

      var info = stageInfo(app.stage);
      var overdueBadge = isOverdue(app) ? '<span class="overdue-badge">公開予定超過</span>' : "";
      var leakBadge = hasLeak(app) ? '<span class="leak-badge">⚠ 発信漏れ</span>' : "";

      tr.innerHTML =
        '<td class="col-name"><button type="button" class="cell-name" data-action="open-detail">' +
          '<span class="cell-no">No.' + pad3(app.no) + '</span>' +
          '<span class="cell-app-name">' + escapeHtml(app.name) + '</span>' +
          overdueBadge + leakBadge +
        '</button></td>' +
        '<td><select class="devai-select" data-action="devai">' + devAiOptionsHtml(app.devAI) + '</select></td>' +
        '<td><span class="stage-badge ' + info.badge + '">' + app.stage + '</span><br>' +
          '<select class="stage-select" data-action="stage">' + stageOptionsHtml(app.stage) + '</select></td>' +
        '<td class="col-progress"><div class="progress-cell">' +
          '<div class="progress-track"><div class="progress-fill" style="width:' + app.progress + '%"></div></div>' +
          '<input type="number" class="progress-input" data-action="progress" min="0" max="100" value="' + app.progress + '">' +
        '</div></td>' +
        '<td><input type="date" class="date-input" data-action="planned" value="' + (app.plannedPublishDate || "") + '"></td>' +
        '<td class="col-check"><input type="checkbox" data-action="out-githubPages" ' + (app.outreach.githubPages ? "checked" : "") + '></td>' +
        '<td class="col-check"><input type="checkbox" data-action="out-x" ' + (app.outreach.x ? "checked" : "") + '></td>' +
        '<td class="col-check"><input type="checkbox" data-action="out-wordpress" ' + (app.outreach.wordpress ? "checked" : "") + '></td>' +
        '<td class="col-check"><input type="checkbox" data-action="out-note" ' + (app.outreach.note ? "checked" : "") + '></td>' +
        '<td class="col-check"><input type="checkbox" data-action="out-youtube" ' + (app.outreach.youtube ? "checked" : "") + '></td>' +
        '<td class="col-check"><input type="checkbox" data-action="out-instagram" ' + (app.outreach.instagram ? "checked" : "") + '></td>' +
        '<td class="col-next"><input type="text" class="next-input" data-action="next" value="' + escapeHtml(app.nextAction) + '" placeholder="次にやること"></td>';

      tbody.appendChild(tr);
    });
  }

  function renderAll() {
    renderDashboard();
    renderToday();
    renderTable();
  }

  // ---------- Table interactions ----------

  function onTableChange(e) {
    var target = e.target;
    var action = target.dataset.action;
    if (!action) return;
    var tr = target.closest("tr");
    var id = tr && tr.dataset.id;
    if (!id) return;
    var app = findApp(id);
    if (!app) return;

    if (action === "devai") {
      app.devAI = target.value;
      saveState();
    } else if (action === "stage") {
      app.stage = target.value;
      app.progress = stageInfo(app.stage).progress;
      if (isPublishedStage(app.stage) && !app.publishedDate) {
        app.publishedDate = todayStr();
      }
      saveState();
      renderAll();
      return;
    } else if (action === "progress") {
      app.progress = clampPct(target.value);
      saveState();
    } else if (action === "planned") {
      app.plannedPublishDate = target.value;
      saveState();
    } else if (action === "next") {
      app.nextAction = target.value;
      saveState();
    } else if (action && action.indexOf("out-") === 0) {
      var key = action.slice(4);
      app.outreach[key] = target.checked;
      saveState();
    }
    renderDashboard();
    renderToday();
    // Keep row-level visuals (badges, overdue row, progress bar) in sync without full re-render on every keystroke.
    if (action === "progress" || action.indexOf("out-") === 0 || action === "planned") {
      renderTable();
    }
  }

  function onTableClick(e) {
    var btn = e.target.closest('[data-action="open-detail"]');
    if (!btn) return;
    var tr = btn.closest("tr");
    if (tr) openDetail(tr.dataset.id);
  }

  // ---------- Today click ----------

  function onTodayClick(e) {
    var item = e.target.closest(".today-item");
    if (item) openDetail(item.dataset.id);
  }

  // ---------- Filters / search / sort ----------

  function onFilterClick(e) {
    var chip = e.target.closest(".chip");
    if (!chip) return;
    ui.filter = chip.dataset.filter;
    document.querySelectorAll(".chip").forEach(function (c) { c.classList.toggle("is-active", c === chip); });
    renderTable();
  }

  function onLeakCardClick() {
    ui.filter = "発信漏れ";
    document.querySelectorAll(".chip").forEach(function (c) {
      c.classList.toggle("is-active", c.dataset.filter === "発信漏れ");
    });
    renderTable();
    document.querySelector(".table-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- Add app modal ----------

  function openAddApp() {
    var form = document.getElementById("add-app-form");
    form.reset();
    document.getElementById("new-app-stage").innerHTML = stageOptionsHtml("アイデア");
    document.getElementById("new-app-progress").value = stageInfo("アイデア").progress;
    document.getElementById("new-app-start").value = todayStr();
    document.getElementById("add-app-overlay").classList.add("is-open");
  }

  function closeAddApp() {
    document.getElementById("add-app-overlay").classList.remove("is-open");
  }

  function onAddAppStageChange() {
    var stage = document.getElementById("new-app-stage").value;
    document.getElementById("new-app-progress").value = stageInfo(stage).progress;
  }

  function onAddAppSubmit(e) {
    e.preventDefault();
    var name = document.getElementById("new-app-name").value.trim();
    if (!name) return;
    createApp({
      name: name,
      idea: document.getElementById("new-app-idea").value.trim(),
      devAI: document.getElementById("new-app-devai").value,
      stage: document.getElementById("new-app-stage").value,
      progress: document.getElementById("new-app-progress").value,
      startDate: document.getElementById("new-app-start").value,
      plannedPublishDate: document.getElementById("new-app-planned").value,
      nextAction: document.getElementById("new-app-next").value.trim(),
      memo: document.getElementById("new-app-memo").value.trim()
    });
    closeAddApp();
    renderAll();
  }

  // ---------- Detail modal ----------

  function openDetail(id) {
    var app = findApp(id);
    if (!app) return;
    ui.activeDetailId = id;

    document.getElementById("detail-no").textContent = "No." + pad3(app.no);
    document.getElementById("detail-title").textContent = app.name;
    document.getElementById("detail-name").value = app.name;
    document.getElementById("detail-idea").value = app.idea || "";
    document.getElementById("detail-devai").value = app.devAI;
    document.getElementById("detail-stage").innerHTML = stageOptionsHtml(app.stage);
    document.getElementById("detail-progress").value = app.progress;
    document.getElementById("detail-start").value = app.startDate || "";
    document.getElementById("detail-planned").value = app.plannedPublishDate || "";
    document.getElementById("detail-published").value = app.publishedDate || "";
    document.getElementById("detail-app-url").value = app.appUrl || "";
    document.getElementById("detail-github-url").value = app.githubUrl || "";
    document.getElementById("detail-next").value = app.nextAction || "";
    document.getElementById("detail-memo").value = app.memo || "";

    OUTREACH_KEYS.forEach(function (k) {
      document.getElementById("detail-out-" + k).checked = !!app.outreach[k];
    });
    document.getElementById("detail-leak-note").hidden = !hasLeak(app);

    renderFixHistory(app);
    document.getElementById("detail-overlay").classList.add("is-open");
  }

  function closeDetail() {
    document.getElementById("detail-overlay").classList.remove("is-open");
    ui.activeDetailId = null;
    renderAll();
  }

  function currentDetailApp() {
    return ui.activeDetailId ? findApp(ui.activeDetailId) : null;
  }

  function bindDetailFieldEvents() {
    function on(id, prop, transform) {
      document.getElementById(id).addEventListener("change", function () {
        var app = currentDetailApp();
        if (!app) return;
        var v = this.value;
        app[prop] = transform ? transform(v) : v;
        saveState();
        if (prop === "stage") {
          document.getElementById("detail-progress").value = stageInfo(app.stage).progress;
          app.progress = stageInfo(app.stage).progress;
          if (isPublishedStage(app.stage) && !app.publishedDate) {
            app.publishedDate = todayStr();
            document.getElementById("detail-published").value = app.publishedDate;
          }
          document.getElementById("detail-leak-note").hidden = !hasLeak(app);
          saveState();
        }
      });
    }
    on("detail-name", "name", function (v) { document.getElementById("detail-title").textContent = v; return v.trim() || "無題のアプリ"; });
    on("detail-idea", "idea");
    on("detail-devai", "devAI");
    on("detail-stage", "stage");
    on("detail-progress", "progress", clampPct);
    on("detail-start", "startDate");
    on("detail-planned", "plannedPublishDate");
    on("detail-published", "publishedDate");
    on("detail-app-url", "appUrl");
    on("detail-github-url", "githubUrl");
    on("detail-next", "nextAction");
    on("detail-memo", "memo");

    OUTREACH_KEYS.forEach(function (k) {
      document.getElementById("detail-out-" + k).addEventListener("change", function () {
        var app = currentDetailApp();
        if (!app) return;
        app.outreach[k] = this.checked;
        saveState();
        document.getElementById("detail-leak-note").hidden = !hasLeak(app);
      });
    });

    document.getElementById("detail-delete-btn").addEventListener("click", function () {
      var app = currentDetailApp();
      if (!app) return;
      if (confirm("No." + pad3(app.no) + " " + app.name + " を削除しますか？この操作は取り消せません。")) {
        deleteApp(app.id);
        document.getElementById("detail-overlay").classList.remove("is-open");
        ui.activeDetailId = null;
        renderAll();
      }
    });

    document.getElementById("detail-close-btn").addEventListener("click", closeDetail);
  }

  // ---------- Fix history ----------

  function renderFixHistory(app) {
    var list = document.getElementById("fix-history-list");
    list.innerHTML = "";
    if (!app.fixHistory.length) {
      var empty = document.createElement("li");
      empty.className = "fix-history-item";
      empty.textContent = "修正・改善履歴はまだありません。";
      list.appendChild(empty);
      return;
    }
    app.fixHistory.slice().reverse().forEach(function (fh) {
      var li = document.createElement("li");
      li.className = "fix-history-item";
      li.dataset.fixId = fh.id;
      li.innerHTML =
        '<span class="fh-content">' + escapeHtml(fh.content) + '</span>' +
        '<input type="date" class="fh-planned" value="' + (fh.plannedDate || "") + '" title="修正予定日">' +
        '<select class="fh-status">' + FIX_STATUSES.map(function (s) {
          return '<option value="' + s + '"' + (s === fh.status ? " selected" : "") + '>' + s + '</option>';
        }).join("") + '</select>' +
        '<input type="date" class="fh-published" value="' + (fh.publishedDate || "") + '" title="修正公開日">' +
        '<button type="button" class="fh-remove">削除</button>';
      list.appendChild(li);
    });
  }

  function bindFixHistoryEvents() {
    document.getElementById("fix-history-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var app = currentDetailApp();
      if (!app) return;
      var content = document.getElementById("fix-content").value.trim();
      if (!content) return;
      app.fixHistory.push({
        id: uid(),
        content: content,
        plannedDate: document.getElementById("fix-planned-date").value,
        status: document.getElementById("fix-status").value,
        publishedDate: document.getElementById("fix-published-date").value
      });
      saveState();
      this.reset();
      document.getElementById("fix-status").value = "未着手";
      renderFixHistory(app);
    });

    document.getElementById("fix-history-list").addEventListener("click", function (e) {
      var btn = e.target.closest(".fh-remove");
      if (!btn) return;
      var app = currentDetailApp();
      if (!app) return;
      var li = btn.closest(".fix-history-item");
      var fixId = li.dataset.fixId;
      app.fixHistory = app.fixHistory.filter(function (f) { return f.id !== fixId; });
      saveState();
      renderFixHistory(app);
    });

    document.getElementById("fix-history-list").addEventListener("change", function (e) {
      var app = currentDetailApp();
      if (!app) return;
      var li = e.target.closest(".fix-history-item");
      if (!li) return;
      var fh = app.fixHistory.find(function (f) { return f.id === li.dataset.fixId; });
      if (!fh) return;
      if (e.target.classList.contains("fh-planned")) fh.plannedDate = e.target.value;
      else if (e.target.classList.contains("fh-published")) fh.publishedDate = e.target.value;
      else if (e.target.classList.contains("fh-status")) fh.status = e.target.value;
      saveState();
    });
  }

  // ---------- Init ----------

  function init() {
    state = loadState();

    document.getElementById("open-add-app-btn").addEventListener("click", openAddApp);
    document.getElementById("add-app-cancel-btn").addEventListener("click", closeAddApp);
    document.getElementById("add-app-overlay").addEventListener("click", function (e) {
      if (e.target === this) closeAddApp();
    });
    document.getElementById("add-app-form").addEventListener("submit", onAddAppSubmit);
    document.getElementById("new-app-stage").addEventListener("change", onAddAppStageChange);

    document.getElementById("detail-overlay").addEventListener("click", function (e) {
      if (e.target === this) closeDetail();
    });
    bindDetailFieldEvents();
    bindFixHistoryEvents();

    document.getElementById("app-table-body").addEventListener("change", onTableChange);
    document.getElementById("app-table-body").addEventListener("click", onTableClick);
    document.getElementById("today-list").addEventListener("click", onTodayClick);

    document.getElementById("filter-chips").addEventListener("click", onFilterClick);
    document.getElementById("stat-leak-card").addEventListener("click", onLeakCardClick);

    document.getElementById("search-input").addEventListener("input", function () {
      ui.search = this.value;
      renderTable();
    });
    document.getElementById("sort-select").addEventListener("change", function () {
      ui.sort = this.value;
      renderTable();
    });

    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
