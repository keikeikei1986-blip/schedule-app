(function () {
  "use strict";

  var STORAGE_KEY = "task-manager-app-tasks-v1";

  var STATUS_LABELS = {
    "not-started": "未着手",
    "in-progress": "進行中",
    "on-hold": "保留",
    "done": "完了"
  };

  var PRIORITY_LABELS = { high: "高", medium: "中", low: "低" };
  var PRIORITY_ORDER = { high: 0, medium: 1, low: 2, "": 1 };

  var state = { tasks: [] };

  // ---- persistence ----

  function migrateTask(task) {
    task.memo = task.memo || "";
    task.dueDate = task.dueDate || "";
    task.priority = task.priority || "";
    task.category = task.category || "";
    task.status = task.status || "not-started";
    task.doToday = task.doToday === true;
    task.createdAt = task.createdAt || Date.now();
    return task;
  }

  function loadTasks() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(migrateTask) : [];
    } catch (e) {
      return [];
    }
  }

  function saveTasks() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
  }

  // ---- date helpers ----

  function todayStr() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function formatDueDate(dueDate) {
    var parts = dueDate.split("-");
    return parts[1] + "/" + parts[2];
  }

  function isOverdue(task) {
    return !!task.dueDate && task.dueDate < todayStr() && task.status !== "done";
  }

  function isTodayTask(task) {
    return task.dueDate === todayStr() || task.doToday === true;
  }

  // ---- sorting ----

  function compareTasks(a, b) {
    var aHas = !!a.dueDate;
    var bHas = !!b.dueDate;
    if (aHas && bHas && a.dueDate !== b.dueDate) {
      return a.dueDate < b.dueDate ? -1 : 1;
    }
    if (aHas !== bHas) return aHas ? -1 : 1;
    var pa = PRIORITY_ORDER[a.priority] !== undefined ? PRIORITY_ORDER[a.priority] : 1;
    var pb = PRIORITY_ORDER[b.priority] !== undefined ? PRIORITY_ORDER[b.priority] : 1;
    if (pa !== pb) return pa - pb;
    return a.createdAt - b.createdAt;
  }

  // ---- rendering ----

  function badge(text, extraClass) {
    var span = document.createElement("span");
    span.className = "badge" + (extraClass ? " " + extraClass : "");
    span.textContent = text;
    return span;
  }

  function createTaskCardEl(task) {
    var li = document.createElement("li");
    li.className = "task-card";
    if (isOverdue(task)) li.classList.add("is-overdue");
    if (task.status === "done") li.classList.add("is-done");

    var check = document.createElement("input");
    check.type = "checkbox";
    check.className = "task-check";
    check.checked = task.status === "done";
    check.setAttribute("aria-label", "完了にする");
    check.addEventListener("click", function (e) { e.stopPropagation(); });
    check.addEventListener("change", function () {
      handleStatusToggle(task.id);
    });
    li.appendChild(check);

    var body = document.createElement("div");
    body.className = "task-body";

    var top = document.createElement("div");
    top.className = "task-top";

    var title = document.createElement("div");
    title.className = "task-title";
    title.textContent = task.title;
    top.appendChild(title);

    var deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "task-delete-btn";
    deleteBtn.setAttribute("aria-label", "削除");
    deleteBtn.textContent = "×";
    deleteBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      handleDeleteTask(task.id);
    });
    top.appendChild(deleteBtn);

    body.appendChild(top);

    var hasMeta = !!(task.dueDate || task.priority || task.category);
    if (hasMeta) {
      var meta = document.createElement("div");
      meta.className = "task-meta";

      if (task.priority) {
        meta.appendChild(badge(PRIORITY_LABELS[task.priority], "badge-priority-" + task.priority));
      }

      if (task.dueDate) {
        var dueClass = "badge badge-due";
        if (isOverdue(task)) dueClass += " is-overdue";
        else if (isTodayTask(task)) dueClass += " is-today";
        var dueBadge = badge(formatDueDate(task.dueDate));
        dueBadge.className = dueClass;
        meta.appendChild(dueBadge);
      }

      if (task.category) meta.appendChild(badge(task.category));

      body.appendChild(meta);
    }

    li.appendChild(body);

    li.addEventListener("click", function () { openModal(task); });

    return li;
  }

  function render() {
    var incomplete = state.tasks.filter(function (t) { return t.status !== "done"; });
    var completed = state.tasks.filter(function (t) { return t.status === "done"; });

    var todayTasks = incomplete.filter(isTodayTask).sort(compareTasks);
    var restTasks = incomplete.filter(function (t) { return !isTodayTask(t); }).sort(compareTasks);

    renderSummary(incomplete, completed);
    renderList("today-list", "today-empty", todayTasks);
    renderList("task-list", "list-empty", restTasks);
    renderCompleted(completed);
  }

  function renderSummary(incomplete, completed) {
    var todayCount = incomplete.filter(isTodayTask).length;
    var overdueCount = incomplete.filter(isOverdue).length;

    document.getElementById("stat-today").textContent = todayCount;
    document.getElementById("stat-incomplete").textContent = incomplete.length;
    document.getElementById("stat-overdue").textContent = overdueCount;
    document.getElementById("stat-done").textContent = completed.length;
  }

  function renderList(listId, emptyId, tasks) {
    var list = document.getElementById(listId);
    var empty = document.getElementById(emptyId);
    list.innerHTML = "";

    if (tasks.length === 0) {
      empty.hidden = false;
      list.hidden = true;
      return;
    }

    empty.hidden = true;
    list.hidden = false;
    tasks.forEach(function (task) { list.appendChild(createTaskCardEl(task)); });
  }

  function renderCompleted(completed) {
    var list = document.getElementById("completed-list");
    var section = document.getElementById("completed-section");
    var count = document.getElementById("completed-count");
    list.innerHTML = "";

    count.textContent = completed.length;
    section.hidden = completed.length === 0;

    completed.sort(compareTasks).forEach(function (task) {
      list.appendChild(createTaskCardEl(task));
    });
  }

  function refreshCategoryOptions() {
    var datalist = document.getElementById("category-list");
    var categories = Array.from(new Set(
      state.tasks.map(function (t) { return t.category; }).filter(Boolean)
    ));
    datalist.innerHTML = "";
    categories.forEach(function (cat) {
      var opt = document.createElement("option");
      opt.value = cat;
      datalist.appendChild(opt);
    });
  }

  // ---- quick add ----

  var quickAddForm = document.getElementById("quick-add-form");
  var quickAddInput = document.getElementById("quick-add-input");

  function handleQuickAdd(e) {
    e.preventDefault();
    var title = quickAddInput.value.trim();
    if (!title) return;

    state.tasks.push(migrateTask({
      id: String(Date.now()) + Math.random().toString(16).slice(2),
      title: title,
      createdAt: Date.now()
    }));

    saveTasks();
    quickAddInput.value = "";
    render();
    quickAddInput.focus();
  }

  function handleQuickAddKeydown(e) {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      handleQuickAdd(e);
    }
  }

  // ---- modal (detail / edit only) ----

  var modalOverlay = document.getElementById("modal-overlay");
  var taskForm = document.getElementById("task-form");
  var deleteTaskBtn = document.getElementById("delete-task-btn");
  var formError = document.getElementById("form-error");

  function openModal(task) {
    formError.hidden = true;
    document.getElementById("task-id").value = task.id;
    document.getElementById("task-title").value = task.title;
    document.getElementById("task-memo").value = task.memo;
    document.getElementById("task-today").checked = task.doToday;
    document.getElementById("task-due").value = task.dueDate;
    document.getElementById("task-priority").value = task.priority;
    document.getElementById("task-category").value = task.category;
    document.getElementById("task-status").value = task.status;

    refreshCategoryOptions();
    modalOverlay.hidden = false;
  }

  function closeModal() {
    modalOverlay.hidden = true;
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    var title = document.getElementById("task-title").value.trim();
    if (!title) {
      formError.hidden = false;
      document.getElementById("task-title").focus();
      return;
    }
    formError.hidden = true;

    var id = document.getElementById("task-id").value;
    var task = state.tasks.find(function (t) { return t.id === id; });
    if (task) {
      task.title = title;
      task.memo = document.getElementById("task-memo").value.trim();
      task.doToday = document.getElementById("task-today").checked;
      task.dueDate = document.getElementById("task-due").value;
      task.priority = document.getElementById("task-priority").value;
      task.category = document.getElementById("task-category").value.trim();
      task.status = document.getElementById("task-status").value;
    }

    saveTasks();
    closeModal();
    render();
  }

  function handleDeleteTask(id) {
    if (!confirm("このタスクを削除しますか？")) return;
    state.tasks = state.tasks.filter(function (t) { return t.id !== id; });
    saveTasks();
    render();
    if (!modalOverlay.hidden && document.getElementById("task-id").value === id) {
      closeModal();
    }
  }

  function handleStatusToggle(id) {
    var task = state.tasks.find(function (t) { return t.id === id; });
    if (!task) return;
    task.status = task.status === "done" ? "not-started" : "done";
    saveTasks();
    render();
  }

  // ---- init ----

  function init() {
    state.tasks = loadTasks();

    quickAddForm.addEventListener("submit", handleQuickAdd);
    quickAddInput.addEventListener("keydown", handleQuickAddKeydown);

    document.getElementById("cancel-btn").addEventListener("click", closeModal);
    document.getElementById("delete-task-btn").addEventListener("click", function () {
      var id = document.getElementById("task-id").value;
      if (id) handleDeleteTask(id);
    });
    modalOverlay.addEventListener("click", function (e) {
      if (e.target === modalOverlay) closeModal();
    });
    taskForm.addEventListener("submit", handleFormSubmit);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modalOverlay.hidden) closeModal();
    });

    render();
    quickAddInput.focus();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
