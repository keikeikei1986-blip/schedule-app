(function () {
  "use strict";

  var STORAGE_KEY = "yakusho-log-app-v1";
  var PDF_DB_NAME = "yakusho-log-pdf-db";
  var PDF_DB_VERSION = 1;
  var PDF_STORE = "pdfs";
  var MAX_PDF_SIZE = 25 * 1024 * 1024; // 25MB

  var ZONING_OPTIONS = [
    "第一種低層住居専用地域", "第二種低層住居専用地域", "第一種中高層住居専用地域", "第二種中高層住居専用地域",
    "第一種住居地域", "第二種住居地域", "準住居地域", "田園住居地域",
    "近隣商業地域", "商業地域", "準工業地域", "工業地域", "工業専用地域"
  ];

  var CHECKLIST_CATEGORIES = [
    {
      name: "都市計画・用途",
      items: ["用途地域", "建蔽率・容積率", "防火地域・準防火地域", "高度地区", "地区計画", "都市計画道路", "特別用途地区", "景観計画・景観条例", "その他の地域地区"]
    },
    {
      name: "道路・接道",
      items: ["道路関係"]
    },
    {
      name: "建築制限",
      items: ["道路斜線", "隣地斜線", "北側斜線", "日影規制", "絶対高さ制限", "高度地区による高さ制限", "壁面後退", "外壁後退"]
    },
    {
      name: "敷地・土地",
      items: ["敷地面積", "登記上の地積", "公図", "境界確定", "敷地と道路の高低差", "敷地内高低差", "擁壁", "がけ・崖条例", "盛土・造成関係"]
    },
    {
      name: "その他",
      items: ["駐車場附置義務", "駐輪場", "緑化条例", "福祉のまちづくり条例", "バリアフリー条例", "中高層建築物条例", "近隣説明の要否", "開発許可の要否", "消防関係", "下水・雨水排水", "給水", "ガス等のインフラ"]
    }
  ];

  var CHECKLIST_TOTAL_COUNT = CHECKLIST_CATEGORIES.reduce(function (sum, c) { return sum + c.items.length; }, 0);

  // Items whose 確認内容 is entered through a structured widget instead of free text.
  var SPECIAL_ITEM_TYPES = {
    "用途地域": "zoning",
    "建蔽率・容積率": "coverage-far",
    "道路関係": "road-info"
  };

  var state = {
    projects: [],
    logs: []
  };

  var currentProjectId = null;
  var editingProjectId = null; // project being edited in the project modal, null = creating new
  var editingLogId = null; // log being edited in the log modal, null = creating new
  var pendingPdfFile = null; // File selected in the log modal, not yet persisted

  var filters = {
    department: "",
    item: "",
    keyword: ""
  };

  // ---------- Persistence (projects / logs) ----------
  function loadState() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.projects) && Array.isArray(parsed.logs)) {
        state = parsed;
        state.projects = state.projects.map(migrateProject);
        state.logs = state.logs.map(migrateLog);
      }
    } catch (e) {
      console.error("Failed to parse stored state", e);
    }
  }

  function migrateProject(p) {
    if (typeof p.startDate !== "string") p.startDate = "";
    return p;
  }

  function migrateLog(l) {
    if (!("attachment" in l) || !l.attachment) l.attachment = null;
    if (!("special" in l)) l.special = null;
    return l;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- PDF storage (IndexedDB) ----------
  var pdfDbPromise = null;

  function openPdfDb() {
    if (pdfDbPromise) return pdfDbPromise;
    pdfDbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB is not available"));
        return;
      }
      var req = indexedDB.open(PDF_DB_NAME, PDF_DB_VERSION);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(PDF_STORE, { keyPath: "logId" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return pdfDbPromise;
  }

  function savePdfBlob(logId, file) {
    return openPdfDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PDF_STORE, "readwrite");
        tx.objectStore(PDF_STORE).put({ logId: logId, fileName: file.name, type: file.type, size: file.size, blob: file });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function getPdfBlob(logId) {
    return openPdfDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PDF_STORE, "readonly");
        var req = tx.objectStore(PDF_STORE).get(logId);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function deletePdfBlob(logId) {
    return openPdfDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PDF_STORE, "readwrite");
        tx.objectStore(PDF_STORE).delete(logId);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function openPdfForLog(logId) {
    // Open the tab synchronously (inside the click handler) so the browser still
    // attributes it to the user gesture; IndexedDB reads are async and would
    // otherwise arrive too late and get popup-blocked.
    var win = window.open("", "_blank");
    getPdfBlob(logId).then(function (rec) {
      if (!rec) {
        if (win) win.close();
        alert("PDFファイルが見つかりませんでした。");
        return;
      }
      var url = URL.createObjectURL(rec.blob);
      if (win) {
        win.location = url;
      } else {
        window.open(url, "_blank");
      }
    }).catch(function (err) {
      console.error("Failed to open PDF", err);
      if (win) win.close();
      alert("PDFを開けませんでした。");
    });
  }

  // ---------- Elements ----------
  var el = {};

  function cacheElements() {
    el.viewProjects = document.getElementById("view-projects");
    el.viewLogs = document.getElementById("view-logs");
    el.projectList = document.getElementById("project-list");
    el.newProjectBtn = document.getElementById("new-project-btn");
    el.backToProjectsBtn = document.getElementById("back-to-projects-btn");

    el.projectNameDisplay = document.getElementById("project-name-display");
    el.projectLocationDisplay = document.getElementById("project-location-display");
    el.projectStartDateDisplay = document.getElementById("project-startdate-display");
    el.projectMemoDisplay = document.getElementById("project-memo-display");
    el.editProjectBtn = document.getElementById("edit-project-btn");
    el.deleteProjectBtn = document.getElementById("delete-project-btn");

    el.checklistProgress = document.getElementById("checklist-progress");
    el.checklistCategories = document.getElementById("checklist-categories");

    el.newLogBtn = document.getElementById("new-log-btn");
    el.logList = document.getElementById("log-list");

    el.filterDepartment = document.getElementById("filter-department");
    el.filterItem = document.getElementById("filter-item");
    el.filterKeyword = document.getElementById("filter-keyword");
    el.filterClearBtn = document.getElementById("filter-clear-btn");

    el.projectModalOverlay = document.getElementById("project-modal-overlay");
    el.projectModalTitle = document.getElementById("project-modal-title");
    el.projectForm = document.getElementById("project-form");
    el.projectNameInput = document.getElementById("project-name-input");
    el.projectLocationInput = document.getElementById("project-location-input");
    el.projectStartDateInput = document.getElementById("project-start-date-input");
    el.projectMemoInput = document.getElementById("project-memo-input");
    el.projectCancelBtn = document.getElementById("project-cancel-btn");

    el.logModalOverlay = document.getElementById("log-modal-overlay");
    el.logModalTitle = document.getElementById("log-modal-title");
    el.logForm = document.getElementById("log-form");
    el.logDateInput = document.getElementById("log-date-input");
    el.logDepartmentInput = document.getElementById("log-department-input");
    el.logPersonInput = document.getElementById("log-person-input");
    el.logItemInput = document.getElementById("log-item-input");
    el.logContentRow = document.getElementById("log-content-row");
    el.logContentInput = document.getElementById("log-content-input");
    el.logMemoInput = document.getElementById("log-memo-input");
    el.logDeleteBtn = document.getElementById("log-delete-btn");
    el.logCancelBtn = document.getElementById("log-cancel-btn");

    el.logZoningGroup = document.getElementById("log-zoning-group");
    el.logZoningCheckboxes = document.getElementById("log-zoning-checkboxes");
    el.logCoverageFarGroup = document.getElementById("log-coverage-far-group");
    el.logCoverageInput = document.getElementById("log-coverage-input");
    el.logFarInput = document.getElementById("log-far-input");

    el.logRoadInfoGroup = document.getElementById("log-road-info-group");
    el.logRoadTypeInput = document.getElementById("log-road-type-input");
    el.logRoadWidthInput = document.getElementById("log-road-width-input");
    el.logRoadFrontageStatusInput = document.getElementById("log-road-frontage-status-input");
    el.logRoadNameInput = document.getElementById("log-road-name-input");
    el.logRoadOtherInput = document.getElementById("log-road-other-input");

    el.logPdfInput = document.getElementById("log-pdf-input");
    el.logPdfCurrent = document.getElementById("log-pdf-current");
    el.logPdfCurrentName = document.getElementById("log-pdf-current-name");
    el.logPdfOpenBtn = document.getElementById("log-pdf-open-btn");
    el.logPdfRemoveBtn = document.getElementById("log-pdf-remove-btn");

    el.departmentOptions = document.getElementById("department-options");
  }

  function populateLogItemSelect() {
    el.logItemInput.innerHTML = "";
    CHECKLIST_CATEGORIES.forEach(function (category) {
      var group = document.createElement("optgroup");
      group.label = category.name;
      category.items.forEach(function (itemName) {
        var opt = document.createElement("option");
        opt.value = itemName;
        opt.textContent = itemName;
        group.appendChild(opt);
      });
      el.logItemInput.appendChild(group);
    });
  }

  // Old catalog items that have since been removed/merged/renamed still need to
  // display correctly when editing a log that was recorded against them, so we
  // never silently rewrite a user's stored data.
  function ensureLegacyItemOption(itemValue) {
    var legacyGroup = el.logItemInput.querySelector('optgroup[data-legacy="true"]');
    if (legacyGroup) legacyGroup.remove();
    if (!itemValue) return;
    var exists = Array.prototype.some.call(el.logItemInput.options, function (o) { return o.value === itemValue; });
    if (exists) return;
    legacyGroup = document.createElement("optgroup");
    legacyGroup.label = "旧項目（削除済み）";
    legacyGroup.dataset.legacy = "true";
    var opt = document.createElement("option");
    opt.value = itemValue;
    opt.textContent = itemValue;
    legacyGroup.appendChild(opt);
    el.logItemInput.appendChild(legacyGroup);
  }

  function buildCheckboxGrid(container, options) {
    container.innerHTML = "";
    options.forEach(function (opt) {
      var label = document.createElement("label");
      label.className = "checkbox-grid-item";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.value = opt;
      label.appendChild(input);
      var span = document.createElement("span");
      span.textContent = opt;
      label.appendChild(span);
      container.appendChild(label);
    });
  }

  function getCheckedValues(container) {
    return Array.prototype.map.call(container.querySelectorAll('input[type="checkbox"]:checked'), function (cb) { return cb.value; });
  }

  function setCheckedValues(container, values) {
    var set = {};
    (values || []).forEach(function (v) { set[v] = true; });
    Array.prototype.forEach.call(container.querySelectorAll('input[type="checkbox"]'), function (cb) {
      cb.checked = !!set[cb.value];
    });
  }

  // ---------- View switching ----------
  function showProjectsView() {
    currentProjectId = null;
    el.viewProjects.hidden = false;
    el.viewLogs.hidden = true;
    renderProjectList();
  }

  function showLogsView(projectId) {
    currentProjectId = projectId;
    el.viewProjects.hidden = true;
    el.viewLogs.hidden = false;
    filters = { department: "", item: "", keyword: "" };
    el.filterKeyword.value = "";
    renderProjectHeader();
    renderChecklist();
    populateFilterOptions();
    populateDatalists();
    renderLogList();
  }

  function getCurrentProject() {
    return state.projects.find(function (p) { return p.id === currentProjectId; }) || null;
  }

  // ---------- Project list rendering ----------
  function renderProjectList() {
    el.projectList.innerHTML = "";

    if (state.projects.length === 0) {
      var hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "案件がまだありません。「＋ 新しい案件」から登録してください。";
      el.projectList.appendChild(hint);
      return;
    }

    var sorted = state.projects.slice().sort(function (a, b) {
      return b.createdAt - a.createdAt;
    });

    sorted.forEach(function (project) {
      el.projectList.appendChild(createProjectCard(project));
    });
  }

  function createProjectCard(project) {
    var card = document.createElement("div");
    card.className = "project-card";

    var main = document.createElement("div");
    main.className = "project-card-main";

    var name = document.createElement("div");
    name.className = "project-card-name";
    name.textContent = project.name;
    main.appendChild(name);

    if (project.location) {
      var loc = document.createElement("div");
      loc.className = "project-card-location";
      loc.textContent = "所在地（地名地番）：" + project.location;
      main.appendChild(loc);
    }

    var startDate = document.createElement("div");
    startDate.className = "project-card-startdate";
    startDate.textContent = "着工予定日：" + (project.startDate ? formatDateDisplay(project.startDate) : "未定");
    main.appendChild(startDate);

    if (project.memo) {
      var memo = document.createElement("div");
      memo.className = "project-card-memo";
      memo.textContent = project.memo;
      main.appendChild(memo);
    }

    var count = document.createElement("div");
    count.className = "project-card-count";
    var logCount = state.logs.filter(function (l) { return l.projectId === project.id; }).length;
    count.textContent = "調査ログ " + logCount + "件";
    main.appendChild(count);

    card.appendChild(main);

    var actions = document.createElement("div");
    actions.className = "project-card-actions";
    var openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "btn-secondary";
    openBtn.textContent = "開く";
    actions.appendChild(openBtn);
    card.appendChild(actions);

    card.addEventListener("click", function () {
      showLogsView(project.id);
    });

    return card;
  }

  // ---------- Project header (detail view) ----------
  function renderProjectHeader() {
    var project = getCurrentProject();
    if (!project) return;
    el.projectNameDisplay.textContent = project.name;
    el.projectLocationDisplay.textContent = project.location ? "所在地（地名地番）：" + project.location : "";
    el.projectLocationDisplay.style.display = project.location ? "" : "none";
    el.projectStartDateDisplay.textContent = "着工予定日：" + (project.startDate ? formatDateDisplay(project.startDate) : "未定");
    el.projectMemoDisplay.textContent = project.memo || "";
  }

  // ---------- Checklist ----------
  function getConfirmedItemSet(projectId) {
    var set = {};
    state.logs.forEach(function (l) {
      if (l.projectId === projectId) set[l.item] = true;
    });
    return set;
  }

  function renderChecklist() {
    el.checklistCategories.innerHTML = "";
    var confirmedSet = getConfirmedItemSet(currentProjectId);
    var confirmedCount = 0;

    CHECKLIST_CATEGORIES.forEach(function (category) {
      var block = document.createElement("div");
      block.className = "checklist-category";

      var heading = document.createElement("h4");
      heading.className = "checklist-category-title";
      heading.textContent = category.name;
      block.appendChild(heading);

      var list = document.createElement("div");
      list.className = "checklist-items";

      category.items.forEach(function (itemName) {
        var isConfirmed = !!confirmedSet[itemName];
        if (isConfirmed) confirmedCount++;

        var row = document.createElement("button");
        row.type = "button";
        row.className = "checklist-item" + (isConfirmed ? " is-confirmed" : "");
        row.title = itemName + (isConfirmed ? "（確認済み）クリックして確認事項を追記" : "（未確認）クリックして記録");

        var mark = document.createElement("span");
        mark.className = "checklist-mark";
        mark.textContent = isConfirmed ? "✓" : "□";
        row.appendChild(mark);

        var label = document.createElement("span");
        label.className = "checklist-label";
        label.textContent = itemName;
        row.appendChild(label);

        row.addEventListener("click", function () {
          openLogModal(null, itemName);
        });

        list.appendChild(row);
      });

      block.appendChild(list);
      el.checklistCategories.appendChild(block);
    });

    el.checklistProgress.textContent = "確認済み " + confirmedCount + "件 / 全" + CHECKLIST_TOTAL_COUNT + "件";
  }

  // ---------- Filter options ----------
  function populateFilterOptions() {
    var logs = state.logs.filter(function (l) { return l.projectId === currentProjectId; });

    var departments = uniqueSorted(logs.map(function (l) { return l.department; }));
    var items = uniqueSorted(logs.map(function (l) { return l.item; }));

    fillSelect(el.filterDepartment, departments, filters.department);
    fillSelect(el.filterItem, items, filters.item);
  }

  function fillSelect(selectEl, values, currentValue) {
    var keepValue = values.indexOf(currentValue) !== -1 ? currentValue : "";
    selectEl.innerHTML = "";
    var allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "すべて";
    selectEl.appendChild(allOpt);
    values.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      selectEl.appendChild(opt);
    });
    selectEl.value = keepValue;
  }

  function populateDatalists() {
    var allDepartments = uniqueSorted(state.logs.map(function (l) { return l.department; }));

    el.departmentOptions.innerHTML = "";
    allDepartments.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v;
      el.departmentOptions.appendChild(opt);
    });
  }

  function uniqueSorted(values) {
    var set = {};
    values.forEach(function (v) {
      if (v) set[v] = true;
    });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, "ja"); });
  }

  // ---------- Log list rendering ----------
  function matchesFilter(log) {
    if (filters.department && log.department !== filters.department) return false;
    if (filters.item && log.item !== filters.item) return false;
    if (filters.keyword) {
      var kw = filters.keyword.toLowerCase();
      var haystack = [log.department, log.personName, log.item, log.content, log.memo]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (haystack.indexOf(kw) === -1) return false;
    }
    return true;
  }

  function getSortedFilteredLogs() {
    return state.logs
      .filter(function (l) { return l.projectId === currentProjectId; })
      .filter(matchesFilter)
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return b.createdAt - a.createdAt;
      });
  }

  function renderLogList() {
    el.logList.innerHTML = "";
    var logs = getSortedFilteredLogs();

    if (logs.length === 0) {
      var hint = document.createElement("div");
      hint.className = "empty-hint";
      var total = state.logs.filter(function (l) { return l.projectId === currentProjectId; }).length;
      hint.textContent = total === 0
        ? "調査ログがまだありません。「＋ 確認事項を記録」から登録してください。"
        : "条件に一致する調査ログがありません。";
      el.logList.appendChild(hint);
      return;
    }

    logs.forEach(function (log) {
      el.logList.appendChild(createLogRow(log));
    });
  }

  function formatDateDisplay(dateStr) {
    return dateStr ? dateStr.replace(/-/g, "/") : "";
  }

  function createLogRow(log) {
    var row = document.createElement("div");
    row.className = "log-row";

    var dateEl = document.createElement("div");
    dateEl.className = "log-cell log-cell-date";
    dateEl.dataset.label = "日付";
    dateEl.textContent = formatDateDisplay(log.date);
    row.appendChild(dateEl);

    var deptEl = document.createElement("div");
    deptEl.className = "log-cell log-cell-department";
    deptEl.dataset.label = "課・部署";
    deptEl.textContent = log.department;
    row.appendChild(deptEl);

    var personEl = document.createElement("div");
    personEl.className = "log-cell log-cell-person";
    personEl.dataset.label = "担当者";
    personEl.textContent = log.personName || "-";
    row.appendChild(personEl);

    var itemEl = document.createElement("div");
    itemEl.className = "log-cell log-cell-item";
    itemEl.dataset.label = "確認項目";
    itemEl.textContent = log.item;
    row.appendChild(itemEl);

    var contentEl = document.createElement("div");
    contentEl.className = "log-cell log-cell-content";
    contentEl.dataset.label = "確認内容・回答";
    contentEl.textContent = log.content;
    contentEl.title = log.content;
    row.appendChild(contentEl);

    var pdfEl = document.createElement("div");
    pdfEl.className = "log-cell log-cell-pdf";
    pdfEl.dataset.label = "PDF";
    if (log.attachment) {
      var pdfBtn = document.createElement("button");
      pdfBtn.type = "button";
      pdfBtn.className = "icon-btn";
      pdfBtn.textContent = "開く";
      pdfBtn.title = log.attachment.fileName;
      pdfBtn.addEventListener("click", function () { openPdfForLog(log.id); });
      pdfEl.appendChild(pdfBtn);
    } else {
      pdfEl.textContent = "-";
    }
    row.appendChild(pdfEl);

    var actionsEl = document.createElement("div");
    actionsEl.className = "log-cell log-cell-actions";

    var editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "icon-btn";
    editBtn.textContent = "編集";
    editBtn.addEventListener("click", function () { openLogModal(log.id); });
    actionsEl.appendChild(editBtn);

    var delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn icon-btn-danger";
    delBtn.textContent = "削除";
    delBtn.addEventListener("click", function () { deleteLog(log.id); });
    actionsEl.appendChild(delBtn);

    row.appendChild(actionsEl);

    return row;
  }

  // ---------- Project modal ----------
  function openProjectModal(projectId) {
    editingProjectId = projectId || null;
    var project = projectId ? state.projects.find(function (p) { return p.id === projectId; }) : null;

    el.projectModalTitle.textContent = project ? "案件を編集" : "新しい案件";
    el.projectNameInput.value = project ? project.name : "";
    el.projectLocationInput.value = project ? project.location : "";
    el.projectStartDateInput.value = project ? project.startDate : "";
    el.projectMemoInput.value = project ? project.memo : "";

    el.projectModalOverlay.classList.add("open");
    el.projectNameInput.focus();
  }

  function closeProjectModal() {
    el.projectModalOverlay.classList.remove("open");
    editingProjectId = null;
  }

  function handleProjectFormSubmit(e) {
    e.preventDefault();
    var name = el.projectNameInput.value.trim();
    if (!name) return;
    var location = el.projectLocationInput.value.trim();
    var startDate = el.projectStartDateInput.value;
    var memo = el.projectMemoInput.value.trim();

    if (editingProjectId) {
      var project = state.projects.find(function (p) { return p.id === editingProjectId; });
      if (project) {
        project.name = name;
        project.location = location;
        project.startDate = startDate;
        project.memo = memo;
      }
    } else {
      state.projects.push({
        id: uid(),
        name: name,
        location: location,
        startDate: startDate,
        memo: memo,
        createdAt: Date.now()
      });
    }

    saveState();
    closeProjectModal();

    if (currentProjectId) {
      renderProjectHeader();
    } else {
      renderProjectList();
    }
  }

  function deleteProject(projectId) {
    var project = state.projects.find(function (p) { return p.id === projectId; });
    if (!project) return;
    var ok = window.confirm("案件「" + project.name + "」を削除します。この案件の調査ログもすべて削除されます。よろしいですか？");
    if (!ok) return;

    var logIdsToRemove = state.logs
      .filter(function (l) { return l.projectId === projectId; })
      .map(function (l) { return l.id; });

    state.projects = state.projects.filter(function (p) { return p.id !== projectId; });
    state.logs = state.logs.filter(function (l) { return l.projectId !== projectId; });
    saveState();

    logIdsToRemove.forEach(function (id) {
      deletePdfBlob(id).catch(function (err) { console.error("Failed to delete PDF", err); });
    });

    showProjectsView();
  }

  // ---------- Log modal ----------
  function applySpecialFieldsForItem(itemName, log) {
    var type = SPECIAL_ITEM_TYPES[itemName] || null;

    el.logContentRow.hidden = !!type;
    el.logContentInput.required = !type;
    el.logZoningGroup.hidden = type !== "zoning";
    el.logCoverageFarGroup.hidden = type !== "coverage-far";
    el.logRoadInfoGroup.hidden = type !== "road-info";

    var special = (log && log.special && log.special.type === type) ? log.special : null;

    if (type === "zoning") {
      setCheckedValues(el.logZoningCheckboxes, special ? special.zoningTypes : []);
    } else if (type === "coverage-far") {
      el.logCoverageInput.value = special ? special.coverage : "";
      el.logFarInput.value = special ? special.floorAreaRatio : "";
    } else if (type === "road-info") {
      el.logRoadTypeInput.value = special ? special.roadType : "";
      el.logRoadWidthInput.value = special ? special.roadWidth : "";
      el.logRoadFrontageStatusInput.value = special ? special.frontageStatus : "";
      el.logRoadNameInput.value = special ? special.roadName : "";
      el.logRoadOtherInput.value = special ? special.otherNotes : "";
    } else {
      el.logContentInput.value = log ? log.content : "";
    }
  }

  function openLogModal(logId, presetItem) {
    editingLogId = logId || null;
    var log = logId ? state.logs.find(function (l) { return l.id === logId; }) : null;

    el.logModalTitle.textContent = log ? "確認事項を編集" : "確認事項を記録";
    el.logDateInput.value = log ? log.date : todayString();
    el.logDepartmentInput.value = log ? log.department : "";
    el.logPersonInput.value = log ? log.personName : "";

    var itemValue = log ? log.item : (presetItem || CHECKLIST_CATEGORIES[0].items[0]);
    ensureLegacyItemOption(log ? log.item : null);
    el.logItemInput.value = itemValue;
    applySpecialFieldsForItem(itemValue, log);

    el.logMemoInput.value = log ? log.memo : "";

    el.logDeleteBtn.style.display = log ? "" : "none";

    pendingPdfFile = null;
    el.logPdfInput.value = "";
    renderCurrentAttachment(log);

    el.logModalOverlay.classList.add("open");
    el.logDateInput.focus();
  }

  function closeLogModal() {
    el.logModalOverlay.classList.remove("open");
    editingLogId = null;
  }

  function renderCurrentAttachment(log) {
    if (log && log.attachment) {
      el.logPdfCurrent.hidden = false;
      el.logPdfCurrentName.textContent = log.attachment.fileName;
      el.logPdfOpenBtn.onclick = function () { openPdfForLog(log.id); };
      el.logPdfRemoveBtn.onclick = function () { removeAttachment(log); };
    } else {
      el.logPdfCurrent.hidden = true;
      el.logPdfOpenBtn.onclick = null;
      el.logPdfRemoveBtn.onclick = null;
    }
  }

  function removeAttachment(log) {
    var ok = window.confirm("添付PDF「" + log.attachment.fileName + "」を削除します。よろしいですか？");
    if (!ok) return;
    deletePdfBlob(log.id).then(function () {
      log.attachment = null;
      saveState();
      renderCurrentAttachment(log);
      renderLogList();
    }).catch(function (err) {
      console.error("Failed to delete PDF", err);
      alert("PDFの削除に失敗しました。");
    });
  }

  function handleLogPdfInputChange() {
    var file = el.logPdfInput.files[0];
    if (!file) {
      pendingPdfFile = null;
      return;
    }
    var isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      alert("PDFファイルのみ添付できます。");
      el.logPdfInput.value = "";
      pendingPdfFile = null;
      return;
    }
    if (file.size > MAX_PDF_SIZE) {
      alert("PDFのサイズが大きすぎます（25MBまで）。");
      el.logPdfInput.value = "";
      pendingPdfFile = null;
      return;
    }
    pendingPdfFile = file;
  }

  function persistPendingPdf(log) {
    if (!pendingPdfFile) return Promise.resolve();
    var file = pendingPdfFile;
    pendingPdfFile = null;
    return savePdfBlob(log.id, file).then(function () {
      log.attachment = { fileName: file.name, size: file.size };
      saveState();
    }).catch(function (err) {
      console.error("Failed to save PDF", err);
      alert("PDFの保存に失敗しました。ブラウザの設定やファイルサイズをご確認ください。");
    });
  }

  function todayString() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function buildSpecialContent(itemName) {
    var type = SPECIAL_ITEM_TYPES[itemName] || null;

    if (type === "zoning") {
      var zoningTypes = getCheckedValues(el.logZoningCheckboxes);
      if (zoningTypes.length === 0) {
        alert("用途地域を1つ以上選択してください。");
        return null;
      }
      return { special: { type: "zoning", zoningTypes: zoningTypes }, content: zoningTypes.join("、") };
    }

    if (type === "coverage-far") {
      var coverage = el.logCoverageInput.value.trim();
      var far = el.logFarInput.value.trim();
      if (!coverage && !far) {
        alert("建蔽率・容積率のいずれかを入力してください。");
        return null;
      }
      var cfParts = [];
      if (coverage) cfParts.push("建蔽率：" + coverage + "％");
      if (far) cfParts.push("容積率：" + far + "％");
      return { special: { type: "coverage-far", coverage: coverage, floorAreaRatio: far }, content: cfParts.join("／") };
    }

    if (type === "road-info") {
      var roadType = el.logRoadTypeInput.value.trim();
      var roadWidth = el.logRoadWidthInput.value.trim();
      var frontageStatus = el.logRoadFrontageStatusInput.value.trim();
      var roadName = el.logRoadNameInput.value.trim();
      var otherNotes = el.logRoadOtherInput.value.trim();
      if (!roadType && !roadWidth && !frontageStatus && !roadName && !otherNotes) {
        alert("道路関係の項目を1つ以上入力してください。");
        return null;
      }
      var riParts = [];
      if (roadType) riParts.push("道路種別：" + roadType);
      if (roadWidth) riParts.push("道路幅員：" + roadWidth);
      if (frontageStatus) riParts.push("接道状況：" + frontageStatus);
      if (roadName) riParts.push("道路名称：" + roadName);
      if (otherNotes) riParts.push("その他：" + otherNotes);
      return {
        special: {
          type: "road-info",
          roadType: roadType,
          roadWidth: roadWidth,
          frontageStatus: frontageStatus,
          roadName: roadName,
          otherNotes: otherNotes
        },
        content: riParts.join(" ／ ")
      };
    }

    var content = el.logContentInput.value.trim();
    if (!content) return null;
    return { special: null, content: content };
  }

  function handleLogFormSubmit(e) {
    e.preventDefault();
    var date = el.logDateInput.value;
    var department = el.logDepartmentInput.value.trim();
    var item = el.logItemInput.value;
    if (!date || !department || !item) return;

    var result = buildSpecialContent(item);
    if (!result) return;

    var personName = el.logPersonInput.value.trim();
    var memo = el.logMemoInput.value.trim();

    var log;
    if (editingLogId) {
      log = state.logs.find(function (l) { return l.id === editingLogId; });
      if (log) {
        log.date = date;
        log.department = department;
        log.personName = personName;
        log.item = item;
        log.content = result.content;
        log.special = result.special;
        log.memo = memo;
        log.updatedAt = Date.now();
      }
    } else {
      log = {
        id: uid(),
        projectId: currentProjectId,
        date: date,
        department: department,
        personName: personName,
        item: item,
        content: result.content,
        special: result.special,
        memo: memo,
        attachment: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      state.logs.push(log);
    }

    saveState();
    closeLogModal();
    populateFilterOptions();
    populateDatalists();
    renderLogList();
    renderChecklist();

    persistPendingPdf(log).then(function () {
      renderLogList();
    });
  }

  function deleteLog(logId) {
    var ok = window.confirm("この調査ログを削除します。よろしいですか？");
    if (!ok) return;
    state.logs = state.logs.filter(function (l) { return l.id !== logId; });
    saveState();
    deletePdfBlob(logId).catch(function (err) { console.error("Failed to delete PDF", err); });
    populateFilterOptions();
    renderLogList();
    renderChecklist();
  }

  // ---------- Events ----------
  function bindEvents() {
    el.newProjectBtn.addEventListener("click", function () { openProjectModal(null); });
    el.editProjectBtn.addEventListener("click", function () { openProjectModal(currentProjectId); });
    el.deleteProjectBtn.addEventListener("click", function () { deleteProject(currentProjectId); });
    el.backToProjectsBtn.addEventListener("click", showProjectsView);

    el.projectForm.addEventListener("submit", handleProjectFormSubmit);
    el.projectCancelBtn.addEventListener("click", closeProjectModal);
    el.projectModalOverlay.addEventListener("click", function (e) {
      if (e.target === el.projectModalOverlay) closeProjectModal();
    });

    el.newLogBtn.addEventListener("click", function () { openLogModal(null); });
    el.logForm.addEventListener("submit", handleLogFormSubmit);
    el.logCancelBtn.addEventListener("click", closeLogModal);
    el.logDeleteBtn.addEventListener("click", function () {
      if (editingLogId) deleteLog(editingLogId);
      closeLogModal();
    });
    el.logModalOverlay.addEventListener("click", function (e) {
      if (e.target === el.logModalOverlay) closeLogModal();
    });
    el.logPdfInput.addEventListener("change", handleLogPdfInputChange);
    el.logItemInput.addEventListener("change", function () {
      applySpecialFieldsForItem(el.logItemInput.value, null);
    });

    el.filterDepartment.addEventListener("change", function () {
      filters.department = el.filterDepartment.value;
      renderLogList();
    });
    el.filterItem.addEventListener("change", function () {
      filters.item = el.filterItem.value;
      renderLogList();
    });
    el.filterKeyword.addEventListener("input", function () {
      filters.keyword = el.filterKeyword.value.trim();
      renderLogList();
    });
    el.filterClearBtn.addEventListener("click", function () {
      filters = { department: "", item: "", keyword: "" };
      el.filterDepartment.value = "";
      el.filterItem.value = "";
      el.filterKeyword.value = "";
      renderLogList();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (el.projectModalOverlay.classList.contains("open")) closeProjectModal();
      if (el.logModalOverlay.classList.contains("open")) closeLogModal();
    });
  }

  // ---------- Init ----------
  function init() {
    cacheElements();
    populateLogItemSelect();
    buildCheckboxGrid(el.logZoningCheckboxes, ZONING_OPTIONS);
    loadState();
    bindEvents();
    showProjectsView();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
