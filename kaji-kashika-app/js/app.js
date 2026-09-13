(function () {
  "use strict";

  var STORAGE_KEY = "kaji-kashika-v2";
  var LEGACY_STORAGE_KEY = "kaji-kashika-v1";

  var TIME_ORDER = ["朝", "日中", "夜"];
  var TIME_ICON = { 朝: "🌅", 日中: "☀️", 夜: "🌙" };
  var WEEKDAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"];

  // 初期テンプレート（ユーザーが「設定」から自由に編集できる）
  var DEFAULT_TEMPLATE = {
    "朝": ["子供に水を飲ませる", "着替えさせる", "食事を作る", "食べさせる", "小学校に行かせる", "保育園に送る"],
    "日中": ["洗濯物を回す", "洗濯物を干す", "弁当を作る", "食器を洗う"],
    "夜": [
      "夜ご飯を作る", "買い出しをする", "トイレ掃除", "風呂掃除", "布団を敷く",
      "子供の歯磨きをする", "寝かしつけ", "本を読む", "洗濯物を干す", "食器を洗う", "ゴミ捨てをする"
    ]
  };

  var ASSIGNEES = [
    { key: "husband", label: "夫" },
    { key: "wife", label: "妻" },
    { key: "other", label: "その他" }
  ];

  var RANGE_TITLE = { today: "今日", "7": "過去7日", "30": "過去30日" };

  var state = { template: {}, today: { date: "", tasks: [] }, history: {} };
  var openTaskId = null;
  var currentRange = "today";
  var addFormTime = null;
  var deleteArmedId = null;

  // ---------- ユーティリティ ----------

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function dateKey(d) {
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function todayStr() {
    return dateKey(new Date());
  }

  function formatDateHeader() {
    var d = new Date();
    return d.getMonth() + 1 + "月" + d.getDate() + "日(" + WEEKDAY_LABEL[d.getDay()] + ")";
  }

  function formatShortDate(dateStr) {
    var parts = dateStr.split("-");
    var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    return parseInt(parts[1], 10) + "月" + parseInt(parts[2], 10) + "日(" + WEEKDAY_LABEL[d.getDay()] + ")";
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, "&quot;");
  }

  // ---------- テンプレート / 今日のタスク ----------

  var DEFAULT_POINTS = 3;
  var MIN_POINTS = 1;

  function buildDefaultTemplate() {
    var template = {};
    TIME_ORDER.forEach(function (time) {
      template[time] = (DEFAULT_TEMPLATE[time] || []).map(function (name) {
        return { id: uid(), name: name, points: DEFAULT_POINTS };
      });
    });
    return template;
  }

  function buildTasksFromTemplate(template) {
    var tasks = [];
    TIME_ORDER.forEach(function (time) {
      (template[time] || []).forEach(function (tt) {
        tasks.push({
          id: uid(), templateId: tt.id, name: tt.name, timeOfDay: time,
          points: tt.points || DEFAULT_POINTS, assignee: null, done: false
        });
      });
    });
    return tasks;
  }

  // テンプレートの追加・削除・改名・ポイント変更・並び替え後に「今日」のタスクへ反映する。
  // 完了済みの担当者記録は、テンプレート上に残っているタスクについては保持する。
  function syncTodayWithTemplate() {
    var existingByTemplateId = {};
    state.today.tasks.forEach(function (t) {
      if (t.templateId) existingByTemplateId[t.templateId] = t;
    });

    var newTasks = [];
    TIME_ORDER.forEach(function (time) {
      (state.template[time] || []).forEach(function (tt) {
        var existing = existingByTemplateId[tt.id];
        if (existing) {
          existing.name = tt.name;
          existing.timeOfDay = time;
          existing.points = tt.points || DEFAULT_POINTS;
          newTasks.push(existing);
        } else {
          newTasks.push({
            id: uid(), templateId: tt.id, name: tt.name, timeOfDay: time,
            points: tt.points || DEFAULT_POINTS, assignee: null, done: false
          });
        }
      });
    });
    state.today.tasks = newTasks;
  }

  // タスク数・ポイントの両方について、完了分と総量、担当者別の内訳を集計する。
  // この戻り値の形はそのまま history[date] にも保存される（同じ形で読み書きするため）。
  function tally(tasks) {
    var t = {
      totalTasks: tasks.length, doneTasks: 0,
      totalPoints: 0, donePoints: 0,
      husbandPoints: 0, wifePoints: 0, otherPoints: 0,
      husbandTasks: 0, wifeTasks: 0, otherTasks: 0
    };
    tasks.forEach(function (task) {
      var pts = task.points || 0;
      t.totalPoints += pts;
      if (task.done) {
        t.doneTasks += 1;
        t.donePoints += pts;
        if (task.assignee && (task.assignee === "husband" || task.assignee === "wife" || task.assignee === "other")) {
          t[task.assignee + "Points"] += pts;
          t[task.assignee + "Tasks"] += 1;
        }
      }
    });
    return t;
  }

  function groupTasksByTime(tasks) {
    var groups = {};
    tasks.forEach(function (t) {
      var key = t.timeOfDay || "その他";
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return groups;
  }

  // ---------- 読み込み・保存 ----------

  function migrateLegacyState() {
    var raw = null;
    try {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    } catch (e) {
      raw = null;
    }
    if (!raw) return null;

    try {
      var old = JSON.parse(raw);
      if (!old || !Array.isArray(old.tasks)) return null;

      var template = {};
      TIME_ORDER.forEach(function (time) { template[time] = []; });
      var seenNames = {};

      old.tasks.forEach(function (t) {
        var time = t.timeOfDay === "昼" ? "日中" : t.timeOfDay;
        if (TIME_ORDER.indexOf(time) === -1) time = "夜";
        var dedupeKey = time + "::" + t.name;
        if (!seenNames[dedupeKey]) {
          seenNames[dedupeKey] = { id: uid(), name: t.name, points: DEFAULT_POINTS };
          template[time].push(seenNames[dedupeKey]);
        }
      });

      var todayTasks = old.tasks.map(function (t) {
        var time = t.timeOfDay === "昼" ? "日中" : t.timeOfDay;
        if (TIME_ORDER.indexOf(time) === -1) time = "夜";
        var tt = seenNames[time + "::" + t.name];
        return {
          id: uid(),
          templateId: tt ? tt.id : null,
          name: t.name,
          timeOfDay: time,
          points: DEFAULT_POINTS,
          assignee: t.assignee || null,
          done: !!t.done
        };
      });

      return { template: template, today: { date: old.date || todayStr(), tasks: todayTasks }, history: {} };
    } catch (e) {
      return null;
    }
  }

  function loadState() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      raw = null;
    }

    var loaded = null;
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.template && parsed.today) loaded = parsed;
      } catch (e) {
        loaded = null;
      }
    }

    if (!loaded) loaded = migrateLegacyState();

    if (loaded) {
      state.template = loaded.template || {};
      state.today = loaded.today || { date: "", tasks: [] };
      state.history = loaded.history || {};
    } else {
      state.template = buildDefaultTemplate();
      state.today = { date: "", tasks: [] };
      state.history = {};
    }

    TIME_ORDER.forEach(function (time) {
      if (!Array.isArray(state.template[time])) state.template[time] = [];
    });

    // 既存データにポイント項目がない場合は、自動的に3ptを補完する（移行）。
    TIME_ORDER.forEach(function (time) {
      state.template[time].forEach(function (tt) {
        if (typeof tt.points !== "number" || tt.points < MIN_POINTS) tt.points = DEFAULT_POINTS;
      });
    });
    if (state.today.tasks) {
      state.today.tasks.forEach(function (t) {
        if (typeof t.points !== "number" || t.points < MIN_POINTS) t.points = DEFAULT_POINTS;
      });
    }

    var today = todayStr();
    if (!state.today.date) {
      state.today = { date: today, tasks: buildTasksFromTemplate(state.template) };
    } else if (state.today.date !== today) {
      // その日時点で確定していたポイント（テンプレートの現在値ではなく、当日の完了時点の値）を履歴として固定保存する。
      state.history[state.today.date] = tally(state.today.tasks);
      state.today = { date: today, tasks: buildTasksFromTemplate(state.template) };
    }

    saveState();
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ template: state.template, today: state.today, history: state.history })
      );
    } catch (e) {
      /* ストレージが使えない環境では保存をあきらめる */
    }
  }

  // ---------- 要素参照 ----------

  var dateEl = document.getElementById("app-date");
  var doneCountEl = document.getElementById("done-count");
  var totalCountEl = document.getElementById("total-count");
  var percentLabelEl = document.getElementById("percent-label");
  var taskCountSubEl = document.getElementById("task-count-sub");
  var progressMessageEl = document.getElementById("progress-message");
  var pieChartEl = document.getElementById("pie-chart");
  var pieTotalEl = document.getElementById("pie-total");
  var assigneeSummaryEl = document.getElementById("assignee-summary");
  var timeSummaryEl = document.getElementById("time-summary");
  var taskGroupsEl = document.getElementById("task-groups");

  var rangeTabsEl = document.getElementById("range-tabs");
  var historySummaryTitleEl = document.getElementById("history-summary-title");
  var historySummaryTotalEl = document.getElementById("history-summary-total");
  var historySummaryTasksSubEl = document.getElementById("history-summary-tasks-sub");
  var historyPieChartEl = document.getElementById("history-pie-chart");
  var historyPieTotalEl = document.getElementById("history-pie-total");
  var historyLegendEl = document.getElementById("history-legend");
  var dayListEl = document.getElementById("day-list");

  var editGroupsEl = document.getElementById("edit-groups");

  var views = {
    today: document.getElementById("view-today"),
    history: document.getElementById("view-history"),
    settings: document.getElementById("view-settings")
  };
  var navButtons = document.querySelectorAll(".nav-btn");

  // ---------- 円グラフ ----------

  function buildConicGradient(counts, total) {
    if (!total) return "";
    var acc = 0;
    var parts = [];
    ASSIGNEES.forEach(function (a) {
      var val = counts[a.key] || 0;
      if (val <= 0) return;
      var start = (acc / total) * 100;
      acc += val;
      var end = (acc / total) * 100;
      parts.push("var(--" + a.key + ") " + start + "% " + end + "%");
    });
    return parts.length ? "conic-gradient(" + parts.join(", ") + ")" : "";
  }

  // 円グラフ・凡例はポイント割合をメインに、タスク件数は補助情報として添える。
  function renderShare(pieEl, pieTotalEl2, legendEl, t) {
    var total = t.donePoints || 0;
    var pieCounts = { husband: t.husbandPoints, wife: t.wifePoints, other: t.otherPoints };
    pieEl.style.background = total > 0 ? buildConicGradient(pieCounts, total) : "var(--track)";
    pieTotalEl2.textContent = total;

    legendEl.innerHTML = ASSIGNEES.map(function (a) {
      var pts = t[a.key + "Points"] || 0;
      var taskCount = t[a.key + "Tasks"] || 0;
      var pct = total > 0 ? Math.round((pts / total) * 100) : 0;
      return (
        '<span class="assignee-pill ' + a.key + '">' +
        '<span class="assignee-pill-points">' + pts + '<span class="pt-unit">pt</span></span>' +
        '<span class="assignee-pill-meta">' + escapeHtml(a.label) + " ・ " + taskCount + "タスク ・ " + pct + "%</span>" +
        "</span>"
      );
    }).join("");
  }

  // ---------- 今日の描画 ----------

  function progressMessage(percent, total) {
    if (total === 0) return "今日もここから。";
    if (percent >= 100) return "今日の家庭タスク、完了。";
    if (percent >= 76) return "今日もかなり進みました。";
    if (percent >= 51) return "半分以上完了。";
    if (percent >= 26) return "少しずつ進んでいます。";
    return "今日もここから。";
  }

  function renderHero() {
    dateEl.textContent = formatDateHeader();

    var t = tally(state.today.tasks);
    var percent = t.totalPoints === 0 ? 0 : Math.round((t.donePoints / t.totalPoints) * 100);

    doneCountEl.textContent = t.donePoints;
    totalCountEl.textContent = t.totalPoints;
    percentLabelEl.textContent = percent + "% 完了";
    taskCountSubEl.textContent = t.doneTasks + " / " + t.totalTasks + " タスク完了";
    progressMessageEl.textContent = progressMessage(percent, t.totalPoints);
  }

  function renderTimeSummary() {
    var groups = groupTasksByTime(state.today.tasks);
    timeSummaryEl.innerHTML = TIME_ORDER.filter(function (time) {
      return groups[time] && groups[time].length > 0;
    }).map(function (time) {
      var items = groups[time];
      var doneTasks = items.filter(function (t) { return t.done; }).length;
      var totalPoints = items.reduce(function (sum, t) { return sum + (t.points || 0); }, 0);
      var donePoints = items.filter(function (t) { return t.done; }).reduce(function (sum, t) { return sum + (t.points || 0); }, 0);
      var complete = doneTasks === items.length;
      return (
        '<div class="time-summary-item' + (complete ? " complete" : "") + '">' +
        '<div class="time-summary-icon">' + TIME_ICON[time] + "</div>" +
        '<div class="time-summary-fraction">' + donePoints + '<span class="slash">/</span>' + totalPoints + '<span class="pt-unit">pt</span></div>' +
        '<div class="time-summary-tasks">' + doneTasks + "/" + items.length + "タスク</div>" +
        "</div>"
      );
    }).join("");
  }

  function assigneeLabel(key) {
    var found = ASSIGNEES.filter(function (a) { return a.key === key; })[0];
    return found ? found.label : "";
  }

  function renderTaskRow(task) {
    var isOpen = openTaskId === task.id;
    var assigneeTagHtml = task.done
      ? '<span class="task-assignee-tag ' + task.assignee + '">' + escapeHtml(assigneeLabel(task.assignee)) + "</span>"
      : "";

    var pickerHtml = "";
    if (isOpen && !task.done) {
      pickerHtml =
        '<div class="task-picker"><p class="task-picker-hint">誰がやった？</p>' +
        ASSIGNEES.map(function (a) {
          return '<button type="button" class="task-picker-btn" data-assignee="' + a.key + '">' + escapeHtml(a.label) + "</button>";
        }).join("") +
        "</div>";
    }

    return (
      '<div class="task-row' + (task.done ? " done" : "") + '" data-id="' + task.id + '">' +
      '<div class="task-row-main">' +
      '<span class="task-checkbox">✓</span>' +
      '<span class="task-name">' + escapeHtml(task.name) + "</span>" +
      '<span class="task-points">' + (task.points || 0) + "pt</span>" +
      assigneeTagHtml +
      "</div>" + pickerHtml + "</div>"
    );
  }

  function renderTaskGroups() {
    if (state.today.tasks.length === 0) {
      taskGroupsEl.innerHTML = '<p class="empty-state">今日のタスクはありません。「設定」からタスクを追加できます。</p>';
      return;
    }

    var groups = groupTasksByTime(state.today.tasks);
    taskGroupsEl.innerHTML = TIME_ORDER.filter(function (time) {
      return groups[time] && groups[time].length > 0;
    }).map(function (time) {
      var rows = groups[time].map(renderTaskRow).join("");
      return (
        '<div class="task-group"><h2 class="task-group-title">' + TIME_ICON[time] + " " + escapeHtml(time) + "</h2>" +
        '<div class="task-list">' + rows + "</div></div>"
      );
    }).join("");
  }

  function renderToday() {
    renderHero();
    renderShare(pieChartEl, pieTotalEl, assigneeSummaryEl, tally(state.today.tasks));
    renderTimeSummary();
    renderTaskGroups();
  }

  // ---------- 今日の操作 ----------

  function findTodayTask(id) {
    return state.today.tasks.filter(function (t) { return t.id === id; })[0];
  }

  function handleTaskRowClick(e) {
    var pickerBtn = e.target.closest(".task-picker-btn");
    if (pickerBtn) {
      var row = e.target.closest(".task-row");
      var task = findTodayTask(row.getAttribute("data-id"));
      if (task) {
        task.done = true;
        task.assignee = pickerBtn.getAttribute("data-assignee");
        openTaskId = null;
        saveState();
        renderToday();
      }
      return;
    }

    var row2 = e.target.closest(".task-row");
    if (!row2) return;
    var task2 = findTodayTask(row2.getAttribute("data-id"));
    if (!task2) return;

    if (task2.done) {
      task2.done = false;
      task2.assignee = null;
      openTaskId = null;
    } else {
      openTaskId = openTaskId === task2.id ? null : task2.id;
    }

    saveState();
    renderToday();
  }

  taskGroupsEl.addEventListener("click", handleTaskRowClick);

  // ---------- 記録（履歴） ----------

  // v2ストレージのうち、ポイント対応前に保存された履歴エントリ（total/husband/wife/other が
  // タスク件数だった旧形式）を、壊さずに新しい集計形式へ読み替える。ポイント情報自体は当時
  // 記録されていないため、遡って作り出さず 0pt として扱う（過去のポイントを捏造しない）。
  function normalizeHistoryEntry(date, raw) {
    return {
      date: date,
      doneTasks: typeof raw.doneTasks === "number" ? raw.doneTasks : (raw.total || 0),
      totalTasks: typeof raw.totalTasks === "number" ? raw.totalTasks : (raw.total || 0),
      totalPoints: raw.totalPoints || 0,
      donePoints: raw.donePoints || 0,
      husbandPoints: raw.husbandPoints || 0,
      wifePoints: raw.wifePoints || 0,
      otherPoints: raw.otherPoints || 0,
      husbandTasks: typeof raw.husbandTasks === "number" ? raw.husbandTasks : (raw.husband || 0),
      wifeTasks: typeof raw.wifeTasks === "number" ? raw.wifeTasks : (raw.wife || 0),
      otherTasks: typeof raw.otherTasks === "number" ? raw.otherTasks : (raw.other || 0)
    };
  }

  function getDaysForRange(range) {
    var today = todayStr();
    var liveToday = tally(state.today.tasks);
    liveToday.date = today;

    if (range === "today") return [liveToday];

    var n = range === "7" ? 6 : 29;
    var list = [liveToday];
    for (var i = 1; i <= n; i++) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var ds = dateKey(d);
      if (state.history[ds]) list.push(normalizeHistoryEntry(ds, state.history[ds]));
    }
    list.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return list;
  }

  function renderDayCard(day) {
    var pieCounts = { husband: day.husbandPoints, wife: day.wifePoints, other: day.otherPoints };
    var pieStyle = day.donePoints > 0 ? buildConicGradient(pieCounts, day.donePoints) : "var(--track)";
    var percent = day.totalPoints === 0 ? 0 : Math.round((day.donePoints / day.totalPoints) * 100);
    return (
      '<div class="day-card">' +
      '<div class="day-card-date">' + formatShortDate(day.date) + "</div>" +
      '<div class="pie-chart mini" style="background:' + pieStyle + '"><div class="pie-chart-hole"></div></div>' +
      '<div class="day-card-stats">' +
      '<div class="day-card-total">' + day.donePoints + '/' + day.totalPoints + "pt ・ " + percent + "%</div>" +
      '<div class="day-card-breakdown">' +
      '<span class="dot husband"></span>' + day.husbandPoints + "pt " +
      '<span class="dot wife"></span>' + day.wifePoints + "pt " +
      '<span class="dot other"></span>' + day.otherPoints + "pt" +
      "</div>" +
      '<div class="day-card-tasks-sub">' + day.doneTasks + "/" + day.totalTasks + "タスク完了</div>" +
      "</div></div>"
    );
  }

  function renderHistory() {
    var days = getDaysForRange(currentRange);
    var aggregate = days.reduce(function (acc, d) {
      acc.totalTasks += d.totalTasks; acc.doneTasks += d.doneTasks;
      acc.totalPoints += d.totalPoints; acc.donePoints += d.donePoints;
      acc.husbandPoints += d.husbandPoints; acc.wifePoints += d.wifePoints; acc.otherPoints += d.otherPoints;
      acc.husbandTasks += d.husbandTasks; acc.wifeTasks += d.wifeTasks; acc.otherTasks += d.otherTasks;
      return acc;
    }, { totalTasks: 0, doneTasks: 0, totalPoints: 0, donePoints: 0, husbandPoints: 0, wifePoints: 0, otherPoints: 0, husbandTasks: 0, wifeTasks: 0, otherTasks: 0 });

    historySummaryTitleEl.textContent = RANGE_TITLE[currentRange];
    historySummaryTotalEl.textContent = aggregate.donePoints + "pt 完了";
    historySummaryTasksSubEl.textContent = aggregate.doneTasks + " / " + aggregate.totalTasks + " タスク完了";
    renderShare(historyPieChartEl, historyPieTotalEl, historyLegendEl, aggregate);

    if (currentRange === "today") {
      dayListEl.innerHTML = "";
    } else {
      dayListEl.innerHTML = days.length
        ? days.map(renderDayCard).join("")
        : '<p class="empty-state">まだ記録がありません。</p>';
    }
  }

  rangeTabsEl.addEventListener("click", function (e) {
    var btn = e.target.closest(".range-tab");
    if (!btn) return;
    currentRange = btn.getAttribute("data-range");
    rangeTabsEl.querySelectorAll(".range-tab").forEach(function (b) {
      b.classList.toggle("active", b === btn);
    });
    renderHistory();
  });

  // ---------- 設定（タスク編集） ----------

  function renderEditGroups() {
    editGroupsEl.innerHTML = TIME_ORDER.map(function (time) {
      var list = state.template[time] || [];
      var rows = list.map(function (tt, idx) {
        var armed = deleteArmedId === tt.id;
        var points = tt.points || DEFAULT_POINTS;
        return (
          '<div class="edit-task-row" data-id="' + tt.id + '" data-time="' + time + '">' +
          '<div class="edit-task-top">' +
          '<button type="button" class="reorder-btn" data-action="up"' + (idx === 0 ? " disabled" : "") + '>▲</button>' +
          '<button type="button" class="reorder-btn" data-action="down"' + (idx === list.length - 1 ? " disabled" : "") + '>▼</button>' +
          '<input type="text" class="edit-task-name-input" value="' + escapeAttr(tt.name) + '">' +
          '<button type="button" class="delete-task-btn' + (armed ? " armed" : "") + '" data-action="delete">' +
          (armed ? "本当に削除？" : "削除") +
          "</button>" +
          "</div>" +
          '<div class="edit-task-points">' +
          '<span class="edit-task-points-label">ポイント</span>' +
          '<div class="points-stepper">' +
          '<button type="button" class="points-btn" data-action="dec"' + (points <= MIN_POINTS ? " disabled" : "") + '>−</button>' +
          '<span class="points-value">' + points + "</span>" +
          '<button type="button" class="points-btn" data-action="inc">＋</button>' +
          "</div></div>" +
          "</div>"
        );
      }).join("");

      var addAreaHtml = addFormTime === time
        ? '<form class="add-task-form" data-time="' + time + '">' +
          '<input type="text" class="add-task-input" placeholder="タスク名を入力">' +
          '<button type="submit" class="add-task-submit">追加</button>' +
          '<button type="button" class="add-task-cancel">キャンセル</button>' +
          "</form>"
        : '<button type="button" class="add-task-btn" data-time="' + time + '">＋ タスクを追加</button>';

      return (
        '<div class="edit-group">' +
        '<h3 class="edit-group-title">' + TIME_ICON[time] + " " + escapeHtml(time) + "</h3>" +
        '<div class="edit-task-list">' + rows + "</div>" +
        addAreaHtml +
        "</div>"
      );
    }).join("");

    if (addFormTime) {
      var input = editGroupsEl.querySelector('.add-task-form[data-time="' + addFormTime + '"] .add-task-input');
      if (input) input.focus();
    }
  }

  function findTemplateTask(time, id) {
    var list = state.template[time] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return i;
    }
    return -1;
  }

  editGroupsEl.addEventListener("click", function (e) {
    var addBtn = e.target.closest(".add-task-btn");
    if (addBtn) {
      addFormTime = addBtn.getAttribute("data-time");
      deleteArmedId = null;
      renderEditGroups();
      return;
    }

    var cancelBtn = e.target.closest(".add-task-cancel");
    if (cancelBtn) {
      addFormTime = null;
      renderEditGroups();
      return;
    }

    var actionBtn = e.target.closest(".reorder-btn, .delete-task-btn, .points-btn");
    if (!actionBtn || actionBtn.disabled) return;

    var row = e.target.closest(".edit-task-row");
    var rowTime = row.getAttribute("data-time");
    var rowId = row.getAttribute("data-id");
    var list = state.template[rowTime];
    var idx = findTemplateTask(rowTime, rowId);
    if (idx === -1) return;

    var action = actionBtn.getAttribute("data-action");
    if (action === "delete") {
      // 誤操作防止のため、1回目のタップでは確認表示に切り替えるだけにし、
      // 同じボタンをもう一度タップしたときだけ実際に削除する（ネイティブconfirm()は使わない）。
      if (deleteArmedId !== rowId) {
        deleteArmedId = rowId;
        renderEditGroups();
        return;
      }
      deleteArmedId = null;
      list.splice(idx, 1);
    } else if (action === "up" && idx > 0) {
      var prev = list[idx - 1];
      list[idx - 1] = list[idx];
      list[idx] = prev;
    } else if (action === "down" && idx < list.length - 1) {
      var next = list[idx + 1];
      list[idx + 1] = list[idx];
      list[idx] = next;
    } else if (action === "inc") {
      list[idx].points = (list[idx].points || DEFAULT_POINTS) + 1;
    } else if (action === "dec") {
      list[idx].points = Math.max(MIN_POINTS, (list[idx].points || DEFAULT_POINTS) - 1);
    }

    syncTodayWithTemplate();
    saveState();
    renderEditGroups();
    renderToday();
  });

  editGroupsEl.addEventListener("submit", function (e) {
    var form = e.target.closest(".add-task-form");
    if (!form) return;
    e.preventDefault();

    var time = form.getAttribute("data-time");
    var input = form.querySelector(".add-task-input");
    var name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }

    state.template[time].push({ id: uid(), name: name });
    addFormTime = null;
    syncTodayWithTemplate();
    saveState();
    renderEditGroups();
    renderToday();
  });

  editGroupsEl.addEventListener("change", function (e) {
    if (!e.target.classList.contains("edit-task-name-input")) return;
    var row = e.target.closest(".edit-task-row");
    var time = row.getAttribute("data-time");
    var id = row.getAttribute("data-id");
    var idx = findTemplateTask(time, id);
    if (idx === -1) return;

    var newName = e.target.value.trim();
    if (!newName) {
      e.target.value = state.template[time][idx].name;
      return;
    }

    state.template[time][idx].name = newName;
    syncTodayWithTemplate();
    saveState();
    renderToday();
  });

  // ---------- 画面切り替え ----------

  function switchView(name) {
    Object.keys(views).forEach(function (key) {
      views[key].hidden = key !== name;
    });
    navButtons.forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === name);
    });
    if (name !== "settings") {
      addFormTime = null;
      deleteArmedId = null;
    }
    if (name === "history") renderHistory();
    if (name === "settings") renderEditGroups();
  }

  navButtons.forEach(function (b) {
    b.addEventListener("click", function () {
      switchView(b.getAttribute("data-view"));
    });
  });

  // ---------- 初期化 ----------

  loadState();
  renderToday();
})();
