(function () {
  "use strict";

  var STORAGE_KEY = "souji-keikaku-app-v1";

  var INTERVAL_LABELS = {
    weekly: "毎週",
    biweekly: "2週間ごと",
    monthly: "毎月",
    bimonthly: "2か月ごと",
    quarterly: "3か月ごと",
    halfyear: "半年ごと",
    yearly: "1年ごと",
    custom: "任意"
  };

  var STATUS_LABELS = {
    overdue: "期限超過",
    today: "今日",
    soon: "もうすぐ",
    scheduled: "予定",
    done: "完了"
  };

  var STATUS_ORDER = { overdue: 0, today: 1, soon: 2, scheduled: 3, done: 4 };

  var SOON_WITHIN_DAYS = 7;

  var WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

  var state = { tasks: [], logs: [], members: null };

  var editingTaskId = null;
  var completingTaskId = null;
  var calendarCursor = new Date();
  calendarCursor.setDate(1);

  var lastFocusedTrigger = null;

  // ---------- utils ----------

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---------- date helpers ----------

  function dateToStr(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function todayStr() {
    return dateToStr(new Date());
  }

  function parseDateStr(s) {
    var parts = s.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function monthKeyOf(dateStr) {
    return dateStr.slice(0, 7);
  }

  function addDays(dateStr, n) {
    var d = parseDateStr(dateStr);
    d.setDate(d.getDate() + n);
    return dateToStr(d);
  }

  function addMonthsClamped(dateStr, n) {
    var d = parseDateStr(dateStr);
    var targetIndex = d.getMonth() + n;
    var targetYear = d.getFullYear() + Math.floor(targetIndex / 12);
    var targetMonth = ((targetIndex % 12) + 12) % 12;
    var lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
    var day = Math.min(d.getDate(), lastDay);
    return dateToStr(new Date(targetYear, targetMonth, day));
  }

  function addInterval(dateStr, intervalType) {
    switch (intervalType) {
      case "weekly": return addDays(dateStr, 7);
      case "biweekly": return addDays(dateStr, 14);
      case "monthly": return addMonthsClamped(dateStr, 1);
      case "bimonthly": return addMonthsClamped(dateStr, 2);
      case "quarterly": return addMonthsClamped(dateStr, 3);
      case "halfyear": return addMonthsClamped(dateStr, 6);
      case "yearly": return addMonthsClamped(dateStr, 12);
      default: return "";
    }
  }

  function formatMD(dateStr) {
    var p = dateStr.split("-");
    return Number(p[1]) + "/" + Number(p[2]);
  }

  function formatMDWithWeekday(dateStr) {
    var d = parseDateStr(dateStr);
    return formatMD(dateStr) + "(" + WEEKDAY_JP[d.getDay()] + ")";
  }

  function daysBetween(fromStr, toStr) {
    var a = parseDateStr(fromStr);
    var b = parseDateStr(toStr);
    return Math.round((b - a) / 86400000);
  }

  function formatAssignee(value) {
    return value ? value : "未割り当て";
  }

  // ---------- persistence ----------

  function loadState() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      return {
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        logs: Array.isArray(parsed.logs) ? parsed.logs : [],
        members: Array.isArray(parsed.members) ? parsed.members : null
      };
    } catch (e) {
      return null;
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function deriveMembersFromExistingData() {
    var seen = {};
    var members = [];
    function addName(name) {
      var trimmed = (name || "").trim();
      if (!trimmed || seen[trimmed]) return;
      seen[trimmed] = true;
      members.push({ id: uid(), name: trimmed, createdAt: Date.now() });
    }
    state.tasks.forEach(function (t) { addName(t.assignee); });
    state.logs.forEach(function (l) { addName(l.completedBy); });
    return members;
  }

  // ---------- members ----------

  function addMemberIfNew(rawName) {
    var trimmed = (rawName || "").trim();
    if (!trimmed) return { ok: false, reason: "empty" };
    var existing = state.members.find(function (m) { return m.name === trimmed; });
    if (existing) return { ok: false, reason: "duplicate", member: existing };
    var member = { id: uid(), name: trimmed, createdAt: Date.now() };
    state.members.push(member);
    saveState();
    return { ok: true, member: member };
  }

  // ---------- derived data ----------

  function getLogsForTask(taskId) {
    return state.logs.filter(function (l) { return l.taskId === taskId; });
  }

  function getPreviousCompletedDate(taskId, excludeLogId) {
    var logs = getLogsForTask(taskId).filter(function (l) { return l.id !== excludeLogId; });
    if (!logs.length) return null;
    return logs.reduce(function (max, l) {
      return l.completedDate > max ? l.completedDate : max;
    }, logs[0].completedDate);
  }

  function computeDueStatus(dueDateStr) {
    var t = todayStr();
    if (dueDateStr < t) return "overdue";
    if (dueDateStr === t) return "today";
    if (daysBetween(t, dueDateStr) <= SOON_WITHIN_DAYS) return "soon";
    return "scheduled";
  }

  function getMonthlyEntries() {
    var monthKey = monthKeyOf(todayStr());
    var entries = [];
    state.tasks.forEach(function (task) {
      var logsThisMonth = state.logs.filter(function (l) {
        return l.taskId === task.id && monthKeyOf(l.completedDate) === monthKey;
      });
      if (logsThisMonth.length) {
        var latest = logsThisMonth.reduce(function (a, b) {
          return b.completedDate > a.completedDate ? b : a;
        });
        entries.push({ task: task, status: "done", log: latest });
      } else if (task.nextDueDate && monthKeyOf(task.nextDueDate) === monthKey) {
        entries.push({ task: task, status: computeDueStatus(task.nextDueDate), log: null });
      }
    });
    return entries;
  }

  function sortEntries(entries) {
    return entries.slice().sort(function (a, b) {
      var oa = STATUS_ORDER[a.status];
      var ob = STATUS_ORDER[b.status];
      if (oa !== ob) return oa - ob;
      if (a.status === "done") {
        return b.log.completedDate.localeCompare(a.log.completedDate);
      }
      return (a.task.nextDueDate || "").localeCompare(b.task.nextDueDate || "");
    });
  }

  function getGroupedUpcoming() {
    var overdue = [];
    var today = [];
    var soon = [];
    state.tasks.forEach(function (task) {
      if (!task.nextDueDate) return;
      var status = computeDueStatus(task.nextDueDate);
      if (status === "overdue") overdue.push(task);
      else if (status === "today") today.push(task);
      else if (status === "soon") soon.push(task);
    });
    function byDate(a, b) { return a.nextDueDate.localeCompare(b.nextDueDate); }
    overdue.sort(byDate);
    today.sort(byDate);
    soon.sort(byDate);
    return { overdue: overdue, today: today, soon: soon };
  }

  // ---------- badge helpers ----------

  function statusBadge(status) {
    return el("span", "badge badge-status-" + status, STATUS_LABELS[status]);
  }

  // ---------- keyboard-accessible card helper ----------

  function makeActivatable(cardEl, ariaLabel, onActivate) {
    cardEl.tabIndex = 0;
    cardEl.setAttribute("role", "button");
    cardEl.setAttribute("aria-label", ariaLabel);
    cardEl.addEventListener("click", onActivate);
    cardEl.addEventListener("keydown", function (e) {
      if (e.target !== cardEl) return; // ignore events bubbled up from inner controls
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        onActivate();
      }
    });
  }

  // ---------- rendering: dashboard ----------

  function renderDashboard() {
    var entries = getMonthlyEntries();
    var total = entries.length;
    var done = entries.filter(function (e) { return e.status === "done"; }).length;
    var overdue = entries.filter(function (e) { return e.status === "overdue"; }).length;
    var remaining = total - done;
    var rate = total ? Math.round((done / total) * 100) : 0;

    document.getElementById("dash-total").textContent = String(total);
    document.getElementById("dash-done").textContent = String(done);
    document.getElementById("dash-remaining").textContent = String(remaining);
    document.getElementById("dash-overdue").textContent = String(overdue);
    document.getElementById("dash-rate").textContent = rate + "%";
    document.getElementById("dash-progress-fill").style.width = rate + "%";
  }

  // ---------- rendering: today panel (grouped) ----------

  function createTodayItemEl(task, statusClass) {
    var item = el("div", "today-item status-" + statusClass);

    var body = el("div", "today-item-body");
    body.appendChild(el("div", "today-item-title", task.name));
    var metaText = "予定日 " + formatMDWithWeekday(task.nextDueDate) + "・担当 " + formatAssignee(task.assignee);
    body.appendChild(el("div", "today-item-meta", metaText));
    item.appendChild(body);

    var btn = el("button", "today-item-complete-btn", "✓ 完了");
    btn.type = "button";
    btn.setAttribute("aria-label", task.name + "を完了にする");
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      openCompleteModal(task);
    });
    item.appendChild(btn);

    makeActivatable(item, task.name + "の詳細を開く", function () { openTaskModal(task); });

    return item;
  }

  function buildTodayGroupSection(label, tasks, statusClass, emptyText) {
    var section = el("div", "today-group");
    var countSuffix = tasks.length ? "（" + tasks.length + "）" : "";
    section.appendChild(el("h3", "today-group-title", label + countSuffix));

    if (!tasks.length) {
      section.appendChild(el("p", "empty-message today-group-empty", emptyText || ""));
      return section;
    }

    var list = el("div", "today-list");
    tasks.forEach(function (task) { list.appendChild(createTodayItemEl(task, statusClass)); });
    section.appendChild(list);
    return section;
  }

  function renderTodayPanel() {
    var groups = getGroupedUpcoming();
    var container = document.getElementById("today-groups");
    container.innerHTML = "";

    if (groups.overdue.length) {
      container.appendChild(buildTodayGroupSection("期限超過", groups.overdue, "overdue"));
    }

    container.appendChild(buildTodayGroupSection("今日", groups.today, "today", "今日の掃除予定はありません"));

    if (groups.soon.length) {
      container.appendChild(buildTodayGroupSection("近日中（7日以内）", groups.soon, "soon"));
    }
  }

  // ---------- rendering: task list ----------

  function createTaskCardEl(entry) {
    var task = entry.task;
    var card = el("div", "task-card status-" + entry.status);

    var top = el("div", "task-card-top");
    top.appendChild(el("div", "task-card-name", task.name));
    top.appendChild(statusBadge(entry.status));
    card.appendChild(top);

    var tags = el("div", "task-card-tags");
    tags.appendChild(el("span", "badge", task.category));
    if (task.location) tags.appendChild(el("span", "badge", task.location));
    tags.appendChild(el("span", "badge", INTERVAL_LABELS[task.intervalType] || task.intervalType));
    card.appendChild(tags);

    var prevDate = getPreviousCompletedDate(task.id, entry.log ? entry.log.id : null);
    var meta = el("div", "task-card-meta");
    var dateLine;
    if (entry.status === "done") {
      dateLine = "実施日：" + formatMDWithWeekday(entry.log.completedDate) + "（担当：" + entry.log.completedBy + "）";
    } else if (task.nextDueDate) {
      dateLine = "予定日：" + formatMDWithWeekday(task.nextDueDate) + "（担当予定：" + formatAssignee(task.assignee) + "）";
    } else {
      dateLine = "次回予定日：未設定";
    }
    meta.appendChild(el("div", "", dateLine));
    meta.appendChild(el("div", "", "前回掃除日：" + (prevDate ? formatMDWithWeekday(prevDate) : "初回")));
    meta.appendChild(el("div", "", "所要時間目安：" + task.estimatedMinutes + "分"));
    card.appendChild(meta);

    if (task.memo) {
      card.appendChild(el("div", "task-card-memo", task.memo));
    }

    var actions = el("div", "task-card-actions");
    if (entry.status === "done") {
      actions.appendChild(el("span", "task-card-done-note", "✓ 今月は完了済み"));
    } else {
      var btn = el("button", "task-card-complete-btn", "完了にする");
      btn.type = "button";
      btn.setAttribute("aria-label", task.name + "を完了にする");
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        openCompleteModal(task);
      });
      actions.appendChild(btn);
    }
    card.appendChild(actions);

    makeActivatable(card, task.name + "の詳細を編集", function () { openTaskModal(task); });

    return card;
  }

  function renderTaskList() {
    var entries = sortEntries(getMonthlyEntries());
    document.getElementById("tasklist-count-badge").textContent = entries.length + "件";

    var hideDone = document.getElementById("hide-done-checkbox").checked;
    if (hideDone) entries = entries.filter(function (e) { return e.status !== "done"; });

    var container = document.getElementById("task-cards");
    var empty = document.getElementById("tasklist-empty");
    container.innerHTML = "";

    if (!entries.length) {
      container.hidden = true;
      empty.hidden = false;
      return;
    }

    container.hidden = false;
    empty.hidden = true;
    entries.forEach(function (entry) { container.appendChild(createTaskCardEl(entry)); });
  }

  // ---------- rendering: calendar ----------

  function renderCalendar() {
    var year = calendarCursor.getFullYear();
    var month = calendarCursor.getMonth();
    document.getElementById("cal-month-label").textContent = year + "年" + (month + 1) + "月";

    var firstDay = new Date(year, month, 1);
    var startWeekday = firstDay.getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();

    var grid = document.getElementById("cal-grid");
    grid.innerHTML = "";

    for (var i = 0; i < startWeekday; i++) {
      grid.appendChild(el("div", "cal-cell cal-cell-empty"));
    }

    var t = todayStr();
    for (var day = 1; day <= daysInMonth; day++) {
      var dateStr = year + "-" + pad2(month + 1) + "-" + pad2(day);
      var dueTasks = state.tasks.filter(function (task) { return task.nextDueDate === dateStr; });

      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cal-cell" + (dateStr === t ? " is-today" : "") + (dueTasks.length ? " has-events" : "");
      cell.setAttribute("aria-label", (month + 1) + "月" + day + "日の掃除予定を見る（" + dueTasks.length + "件）");
      cell.appendChild(el("span", "cal-day-num", String(day)));

      var eventsWrap = el("div", "cal-events");
      dueTasks.slice(0, 2).forEach(function (task) {
        var chip = el("span", "cal-event-chip status-" + computeDueStatus(task.nextDueDate), task.name);
        eventsWrap.appendChild(chip);
      });
      if (dueTasks.length > 2) {
        eventsWrap.appendChild(el("span", "cal-event-more", "+" + (dueTasks.length - 2)));
      }
      cell.appendChild(eventsWrap);

      cell.addEventListener("click", (function (ds) {
        return function () { openDayModal(ds); };
      })(dateStr));

      grid.appendChild(cell);
    }
  }

  // ---------- rendering: history ----------

  function populateHistoryFilterOptions() {
    var select = document.getElementById("history-filter-select");
    var current = select.value;
    select.innerHTML = "";
    select.appendChild(new Option("すべての項目", ""));
    state.tasks.slice().sort(function (a, b) { return a.name.localeCompare(b.name, "ja"); })
      .forEach(function (task) { select.appendChild(new Option(task.name, task.id)); });
    var stillValid = Array.prototype.some.call(select.options, function (o) { return o.value === current; });
    select.value = stillValid ? current : "";
  }

  function createHistoryItemEl(log) {
    var item = el("div", "history-item");
    item.appendChild(el("div", "history-item-date", formatMDWithWeekday(log.completedDate)));

    var body = el("div", "history-item-body");
    body.appendChild(el("div", "history-item-name", log.taskName));
    body.appendChild(el("div", "history-item-meta", "担当：" + log.completedBy));
    if (log.memo) body.appendChild(el("div", "history-item-memo", log.memo));
    item.appendChild(body);

    var delBtn = el("button", "history-item-delete-btn", "×");
    delBtn.type = "button";
    delBtn.setAttribute("aria-label", log.taskName + "（" + formatMDWithWeekday(log.completedDate) + "）の履歴を削除");
    delBtn.addEventListener("click", function () {
      if (!confirm("この履歴を削除しますか？")) return;
      state.logs = state.logs.filter(function (l) { return l.id !== log.id; });
      saveState();
      renderAll();
    });
    item.appendChild(delBtn);

    return item;
  }

  function renderHistory() {
    var filterTaskId = document.getElementById("history-filter-select").value;
    var logs = state.logs.filter(function (l) { return !filterTaskId || l.taskId === filterTaskId; });
    logs = logs.slice().sort(function (a, b) {
      return b.completedDate.localeCompare(a.completedDate) || b.createdAt - a.createdAt;
    });

    var container = document.getElementById("history-list");
    var empty = document.getElementById("history-empty");
    container.innerHTML = "";

    if (!logs.length) {
      container.hidden = true;
      empty.hidden = false;
      return;
    }

    container.hidden = false;
    empty.hidden = true;
    logs.forEach(function (log) { container.appendChild(createHistoryItemEl(log)); });
  }

  // ---------- assignee field (free-form members) ----------

  function populateAssigneeSelect(selectId, selectedValue) {
    var select = document.getElementById(selectId);
    var current = selectedValue !== undefined ? selectedValue : select.value;
    select.innerHTML = "";
    select.appendChild(new Option("未割り当て", ""));
    state.members.forEach(function (m) { select.appendChild(new Option(m.name, m.name)); });
    if (current && !state.members.some(function (m) { return m.name === current; })) {
      select.appendChild(new Option(current, current));
    }
    select.value = current || "";
  }

  function setupAssigneeField(selectId, newInputId, addBtnId) {
    var newInput = document.getElementById(newInputId);

    function doAdd() {
      var result = addMemberIfNew(newInput.value);
      if (!result.ok && result.reason === "empty") {
        newInput.focus();
        return;
      }
      populateAssigneeSelect(selectId, result.member.name);
      newInput.value = "";
      document.getElementById(selectId).focus();
    }

    document.getElementById(addBtnId).addEventListener("click", doAdd);
    newInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        doAdd();
      }
    });
  }

  // ---------- modal focus helpers ----------

  function openModalFocus(overlayEl, focusTarget) {
    lastFocusedTrigger = document.activeElement;
    overlayEl.hidden = false;
    requestAnimationFrame(function () {
      if (focusTarget) focusTarget.focus();
    });
  }

  function closeModalFocus(overlayEl) {
    overlayEl.hidden = true;
    if (lastFocusedTrigger && typeof lastFocusedTrigger.focus === "function") {
      lastFocusedTrigger.focus();
    }
    lastFocusedTrigger = null;
  }

  // ---------- task modal ----------

  function openTaskModal(task) {
    editingTaskId = task ? task.id : null;
    document.getElementById("task-modal-title").textContent = task ? "掃除タスクを編集" : "掃除タスクを追加";
    document.getElementById("task-delete-btn").hidden = !task;

    document.getElementById("task-name-input").value = task ? task.name : "";
    document.getElementById("task-category-input").value = task ? task.category : "水回り";
    document.getElementById("task-location-input").value = task ? task.location : "";
    document.getElementById("task-interval-input").value = task ? task.intervalType : "monthly";
    document.getElementById("task-duration-input").value = task ? task.estimatedMinutes : 30;
    document.getElementById("task-due-input").value = task ? (task.nextDueDate || "") : todayStr();
    document.getElementById("task-memo-input").value = task ? task.memo : "";
    document.getElementById("task-assignee-new-input").value = "";
    populateAssigneeSelect("task-assignee-select", task ? task.assignee : "");

    openModalFocus(document.getElementById("task-modal-overlay"), document.getElementById("task-name-input"));
  }

  function closeTaskModal() {
    closeModalFocus(document.getElementById("task-modal-overlay"));
    editingTaskId = null;
  }

  function handleTaskFormSubmit(e) {
    e.preventDefault();
    var name = document.getElementById("task-name-input").value.trim();
    if (!name) {
      alert("掃除名を入力してください");
      return;
    }
    var category = document.getElementById("task-category-input").value;
    var location = document.getElementById("task-location-input").value.trim();
    var intervalType = document.getElementById("task-interval-input").value;
    var dueDate = document.getElementById("task-due-input").value;
    var assignee = document.getElementById("task-assignee-select").value;
    var minutes = Math.max(1, Number(document.getElementById("task-duration-input").value) || 30);
    var memo = document.getElementById("task-memo-input").value.trim();

    if (editingTaskId) {
      var task = state.tasks.find(function (t) { return t.id === editingTaskId; });
      if (task) {
        task.name = name;
        task.category = category;
        task.location = location;
        task.intervalType = intervalType;
        task.nextDueDate = dueDate;
        task.assignee = assignee;
        task.estimatedMinutes = minutes;
        task.memo = memo;
        task.updatedAt = Date.now();
      }
    } else {
      state.tasks.push({
        id: uid(),
        householdId: "default",
        name: name,
        category: category,
        location: location,
        intervalType: intervalType,
        nextDueDate: dueDate,
        assignee: assignee,
        estimatedMinutes: minutes,
        memo: memo,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }

    saveState();
    closeTaskModal();
    renderAll();
  }

  function handleDeleteTask() {
    if (!editingTaskId) return;
    if (!confirm("この掃除タスクを削除しますか？\n※過去の掃除履歴は残ります")) return;
    state.tasks = state.tasks.filter(function (t) { return t.id !== editingTaskId; });
    saveState();
    closeTaskModal();
    renderAll();
  }

  // ---------- complete modal ----------

  function openCompleteModal(task) {
    completingTaskId = task.id;
    document.getElementById("complete-modal-task-name").textContent = task.name;
    document.getElementById("complete-date-input").value = todayStr();
    document.getElementById("complete-memo-input").value = "";
    document.getElementById("complete-assignee-new-input").value = "";
    populateAssigneeSelect("complete-assignee-select", task.assignee);

    openModalFocus(document.getElementById("complete-modal-overlay"), document.getElementById("complete-date-input"));
  }

  function closeCompleteModal() {
    closeModalFocus(document.getElementById("complete-modal-overlay"));
    completingTaskId = null;
  }

  function handleCompleteSubmit(e) {
    e.preventDefault();
    var task = state.tasks.find(function (t) { return t.id === completingTaskId; });
    if (!task) return;

    var completedDate = document.getElementById("complete-date-input").value || todayStr();
    var completedBy = document.getElementById("complete-assignee-select").value.trim();
    if (!completedBy) {
      alert("誰が掃除したか選択してください");
      return;
    }
    var memo = document.getElementById("complete-memo-input").value.trim();

    state.logs.push({
      id: uid(),
      householdId: "default",
      taskId: task.id,
      taskName: task.name,
      completedDate: completedDate,
      completedBy: completedBy,
      memo: memo,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    var lastDate = getPreviousCompletedDate(task.id, null);
    if (completedDate >= (lastDate || "")) {
      task.nextDueDate = addInterval(completedDate, task.intervalType);
      task.updatedAt = Date.now();
    }

    saveState();
    closeCompleteModal();
    renderAll();
  }

  // ---------- day modal ----------

  function createDayModalItemEl(task) {
    var item = el("div", "day-modal-item");
    var body = el("div", "day-modal-item-body");
    body.appendChild(el("div", "day-modal-item-name", task.name));
    body.appendChild(el("div", "day-modal-item-meta", task.category + "・担当予定：" + formatAssignee(task.assignee)));
    item.appendChild(body);

    var btn = el("button", "day-modal-item-complete-btn", "完了にする");
    btn.type = "button";
    btn.setAttribute("aria-label", task.name + "を完了にする");
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeDayModal();
      openCompleteModal(task);
    });
    item.appendChild(btn);

    makeActivatable(item, task.name + "の詳細を編集", function () {
      closeDayModal();
      openTaskModal(task);
    });

    return item;
  }

  function openDayModal(dateStr) {
    var d = parseDateStr(dateStr);
    document.getElementById("day-modal-title").textContent =
      (d.getMonth() + 1) + "月" + d.getDate() + "日(" + WEEKDAY_JP[d.getDay()] + ")の掃除予定";

    var tasks = state.tasks.filter(function (t) { return t.nextDueDate === dateStr; });
    var container = document.getElementById("day-modal-list");
    container.innerHTML = "";

    if (!tasks.length) {
      container.appendChild(el("p", "empty-message", "この日の掃除予定はありません。"));
    } else {
      tasks.forEach(function (task) { container.appendChild(createDayModalItemEl(task)); });
    }

    var overlay = document.getElementById("day-modal-overlay");
    openModalFocus(overlay, overlay.querySelector(".modal"));
  }

  function closeDayModal() {
    closeModalFocus(document.getElementById("day-modal-overlay"));
  }

  // ---------- view switching ----------

  function switchView(view) {
    ["home", "calendar", "history"].forEach(function (v) {
      document.getElementById("view-" + v).hidden = v !== view;
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tab-btn"), function (btn) {
      btn.classList.toggle("is-active", btn.dataset.view === view);
    });
  }

  // ---------- render all ----------

  function renderAll() {
    renderDashboard();
    renderTodayPanel();
    renderTaskList();
    renderCalendar();
    populateHistoryFilterOptions();
    renderHistory();
  }

  // ---------- init ----------

  function init() {
    var loaded = loadState();
    if (loaded) {
      state.tasks = loaded.tasks;
      state.logs = loaded.logs;
      state.members = loaded.members;
    }
    if (!Array.isArray(state.members)) {
      state.members = deriveMembersFromExistingData();
    }
    saveState();

    setupAssigneeField("task-assignee-select", "task-assignee-new-input", "task-assignee-add-btn");
    setupAssigneeField("complete-assignee-select", "complete-assignee-new-input", "complete-assignee-add-btn");

    Array.prototype.forEach.call(document.querySelectorAll(".tab-btn"), function (btn) {
      btn.addEventListener("click", function () { switchView(btn.dataset.view); });
    });

    document.getElementById("header-add-btn").addEventListener("click", function () { openTaskModal(null); });

    document.getElementById("task-form").addEventListener("submit", handleTaskFormSubmit);
    document.getElementById("task-cancel-btn").addEventListener("click", closeTaskModal);
    document.getElementById("task-delete-btn").addEventListener("click", handleDeleteTask);
    document.getElementById("task-modal-overlay").addEventListener("click", function (e) {
      if (e.target === this) closeTaskModal();
    });

    document.getElementById("complete-form").addEventListener("submit", handleCompleteSubmit);
    document.getElementById("complete-cancel-btn").addEventListener("click", closeCompleteModal);
    document.getElementById("complete-modal-overlay").addEventListener("click", function (e) {
      if (e.target === this) closeCompleteModal();
    });

    document.getElementById("day-modal-close-btn").addEventListener("click", closeDayModal);
    document.getElementById("day-modal-overlay").addEventListener("click", function (e) {
      if (e.target === this) closeDayModal();
    });

    document.getElementById("cal-prev-btn").addEventListener("click", function () {
      calendarCursor.setMonth(calendarCursor.getMonth() - 1);
      renderCalendar();
    });
    document.getElementById("cal-next-btn").addEventListener("click", function () {
      calendarCursor.setMonth(calendarCursor.getMonth() + 1);
      renderCalendar();
    });

    document.getElementById("hide-done-checkbox").addEventListener("change", renderTaskList);
    document.getElementById("history-filter-select").addEventListener("change", renderHistory);

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!document.getElementById("task-modal-overlay").hidden) closeTaskModal();
      else if (!document.getElementById("complete-modal-overlay").hidden) closeCompleteModal();
      else if (!document.getElementById("day-modal-overlay").hidden) closeDayModal();
    });

    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
