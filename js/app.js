(() => {
  "use strict";

  const STORAGE_KEY = "schedule-app-v1";
  const SETTINGS_KEY = "schedule-app-settings-v1";
  const SLOT_MINUTES = 30;
  const DEFAULT_SETTINGS = { dayStart: "09:00", dayEnd: "18:00" };

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function minutesToTime(totalMinutes) {
    return `${pad2(Math.floor(totalMinutes / 60))}:${pad2(totalMinutes % 60)}`;
  }

  function timeToMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  // Full-day list of 30-minute marks (00:00 .. 23:30), used to populate the day-range selects.
  const ALL_DAY_TIMES = Array.from({ length: 48 }, (_, i) => minutesToTime(i * SLOT_MINUTES));

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  // ---------- settings (working hours) ----------

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      if (
        typeof parsed.dayStart === "string" &&
        typeof parsed.dayEnd === "string" &&
        timeToMinutes(parsed.dayEnd) > timeToMinutes(parsed.dayStart)
      ) {
        return { dayStart: parsed.dayStart, dayEnd: parsed.dayEnd };
      }
      return { ...DEFAULT_SETTINGS };
    } catch (e) {
      console.error("Failed to load settings", e);
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  let settings = loadSettings();
  let TIMES = [];
  let SLOT_COUNT = 0;

  function rebuildTimes() {
    const startMin = timeToMinutes(settings.dayStart);
    const endMin = timeToMinutes(settings.dayEnd);
    TIMES = [];
    for (let t = startMin; t <= endMin; t += SLOT_MINUTES) TIMES.push(minutesToTime(t));
    SLOT_COUNT = TIMES.length - 1;
  }
  rebuildTimes();

  // ---------- data migration (old slot-index block format -> absolute time strings) ----------

  function oldSlotToTime(slotIndex) {
    return minutesToTime(9 * 60 + slotIndex * SLOT_MINUTES);
  }

  function migrateBlock(b) {
    if (typeof b.startTime === "string") return b; // already current format
    const startTime = oldSlotToTime(b.startSlot);
    const endTime = oldSlotToTime(b.endSlot);
    const original = b.original
      ? {
          startTime: oldSlotToTime(b.original.startSlot),
          endTime: oldSlotToTime(b.original.endSlot),
          planText: b.original.planText,
        }
      : { startTime, endTime, planText: b.planText };
    return {
      id: b.id,
      startTime,
      endTime,
      planText: b.planText,
      original,
      actualStart: b.actualStart || null,
      actualEnd: b.actualEnd || null,
      actualText: b.actualText || null,
      taskId: b.taskId || null,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { blocks: [], tasks: [] };
      const parsed = JSON.parse(raw);
      return {
        blocks: Array.isArray(parsed.blocks) ? parsed.blocks.map(migrateBlock) : [],
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      };
    } catch (e) {
      console.error("Failed to load saved data", e);
      return { blocks: [], tasks: [] };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  let state = loadState();
  let editingBlockId = null; // null = creating new block

  // ---------- time / block helpers ----------

  function slotIndexOf(timeStr) {
    return TIMES.indexOf(timeStr);
  }

  function nowSlotIndex() {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startMin = timeToMinutes(settings.dayStart);
    const endMin = timeToMinutes(settings.dayEnd);
    if (nowMinutes < startMin || nowMinutes >= endMin) return -1;
    return Math.floor((nowMinutes - startMin) / SLOT_MINUTES);
  }

  function formatToday() {
    const now = new Date();
    return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(
      now.getDate()
    ).padStart(2, "0")}`;
  }

  function isRescheduled(block) {
    return Boolean(
      block.original &&
        (block.original.startTime !== block.startTime ||
          block.original.endTime !== block.endTime ||
          block.original.planText !== block.planText)
    );
  }

  function hasOverlap(startTime, endTime, excludeBlockId) {
    const startMin = timeToMinutes(startTime);
    const endMin = timeToMinutes(endTime);
    return state.blocks.find((b) => {
      if (b.id === excludeBlockId) return false;
      return startMin < timeToMinutes(b.endTime) && endMin > timeToMinutes(b.startTime);
    });
  }

  // ---------- rendering: stats ----------

  function renderStats() {
    const total = state.tasks.length;
    const done = state.tasks.filter((t) => t.completed).length;
    const rate = total === 0 ? 0 : Math.round((done / total) * 100);

    document.getElementById("stat-date").textContent = formatToday();
    document.getElementById("stat-total").textContent = String(total);
    document.getElementById("stat-done").textContent = String(done);
    document.getElementById("stat-rate").textContent = `${rate}%`;
  }

  // ---------- rendering: schedule grid ----------

  function findBlockAt(slotIndex) {
    return state.blocks.find((b) => {
      const start = slotIndexOf(b.startTime);
      const end = slotIndexOf(b.endTime);
      return start !== -1 && end !== -1 && slotIndex >= start && slotIndex < end;
    });
  }

  function renderScheduleGrid() {
    const timeCol = document.getElementById("time-col");
    const planCol = document.getElementById("plan-col");
    const actualCol = document.getElementById("actual-col");
    const rowsStyle = `repeat(${SLOT_COUNT}, var(--slot-height))`;
    timeCol.style.gridTemplateRows = rowsStyle;
    planCol.style.gridTemplateRows = rowsStyle;
    actualCol.style.gridTemplateRows = rowsStyle;
    timeCol.innerHTML = "";
    planCol.innerHTML = "";
    actualCol.innerHTML = "";

    const currentSlot = nowSlotIndex();

    for (let i = 0; i < SLOT_COUNT; i++) {
      const label = document.createElement("div");
      label.className = "time-label";
      label.textContent = TIMES[i];
      timeCol.appendChild(label);
    }

    // 予定列: 現在の予定＋空き枠。リスケされた予定は、元の時間帯にゴースト表示を重ねる。
    let i = 0;
    while (i < SLOT_COUNT) {
      const block = findBlockAt(i);
      if (block) {
        planCol.appendChild(renderPlanBlockEl(block, currentSlot));
        i = slotIndexOf(block.endTime);
      } else {
        planCol.appendChild(renderEmptySlotEl(i, currentSlot, { interactive: true }));
        i += 1;
      }
    }
    state.blocks.filter(isRescheduled).forEach((block) => {
      const ghostEl = renderGhostBlockEl(block);
      if (ghostEl) planCol.appendChild(ghostEl);
    });

    // 実績列: 実績時刻が記録されている予定だけを、その実績時刻の位置に表示する。
    const actualRanges = state.blocks
      .map((block) => ({
        block,
        startSlot: block.actualStart ? slotIndexOf(block.actualStart) : -1,
        endSlot: block.actualEnd ? slotIndexOf(block.actualEnd) : -1,
      }))
      .filter((r) => r.startSlot !== -1 && r.endSlot !== -1 && r.endSlot > r.startSlot);

    const coveredActualSlots = new Set();
    actualRanges.forEach((range) => {
      actualCol.appendChild(renderActualBlockEl(range, currentSlot));
      for (let s = range.startSlot; s < range.endSlot; s++) coveredActualSlots.add(s);
    });
    for (let s = 0; s < SLOT_COUNT; s++) {
      if (!coveredActualSlots.has(s)) {
        actualCol.appendChild(renderEmptySlotEl(s, currentSlot, { interactive: false }));
      }
    }
  }

  function renderEmptySlotEl(slotIndex, currentSlot, { interactive }) {
    const el = document.createElement("div");
    el.className = "slot-empty" + (interactive ? "" : " non-interactive");
    if (slotIndex === currentSlot) el.classList.add("is-now");
    el.style.gridRow = `${slotIndex + 1} / ${slotIndex + 2}`;
    if (interactive) {
      el.title = "クリックして予定を追加";
      el.addEventListener("click", () => openBlockModal(null, TIMES[slotIndex]));
    }
    return el;
  }

  function renderPlanBlockEl(block, currentSlot) {
    const startSlot = slotIndexOf(block.startTime);
    const endSlot = slotIndexOf(block.endTime);
    const el = document.createElement("div");
    el.className = "block";
    const hasActual = Boolean(block.actualText || block.actualStart);
    const rescheduled = isRescheduled(block);
    if (currentSlot >= startSlot && currentSlot < endSlot) el.classList.add("is-now");
    el.style.gridRow = `${startSlot + 1} / ${endSlot + 1}`;

    const planEl = document.createElement("div");
    planEl.className = "block-plan-text";
    planEl.textContent = block.planText;
    el.appendChild(planEl);

    const timeEl = document.createElement("div");
    timeEl.className = "block-time-text";
    let timeText = `${block.startTime} - ${block.endTime}`;
    if (rescheduled) timeText += " ↺";
    if (hasActual) timeText += " ✓";
    timeEl.textContent = timeText;
    el.appendChild(timeEl);

    const tooltipLines = [`予定: ${block.planText}（${block.startTime} - ${block.endTime}）`];
    if (rescheduled) {
      tooltipLines.push(`元の予定: ${block.original.planText}（${block.original.startTime} - ${block.original.endTime}）`);
    }
    if (hasActual) {
      const range = block.actualStart && block.actualEnd ? `${block.actualStart}〜${block.actualEnd} ` : "";
      tooltipLines.push(`実績: ${range}${block.actualText || ""}`);
    }
    el.title = tooltipLines.join("\n");

    el.addEventListener("click", () => openBlockModal(block.id, null));
    return el;
  }

  function renderGhostBlockEl(block) {
    const startSlot = slotIndexOf(block.original.startTime);
    const endSlot = slotIndexOf(block.original.endTime);
    if (startSlot === -1 || endSlot === -1) return null; // 表示時間の範囲外なら描画しない

    const el = document.createElement("div");
    el.className = "block block-ghost";
    el.style.gridRow = `${startSlot + 1} / ${endSlot + 1}`;

    const planEl = document.createElement("div");
    planEl.className = "block-plan-text";
    planEl.textContent = block.original.planText;
    el.appendChild(planEl);

    const timeEl = document.createElement("div");
    timeEl.className = "block-time-text";
    timeEl.textContent = `${block.original.startTime} - ${block.original.endTime}（元）`;
    el.appendChild(timeEl);

    el.title = `リスケ前の予定: ${block.original.planText}（${block.original.startTime} - ${block.original.endTime}）`;
    return el;
  }

  function renderActualBlockEl({ block, startSlot, endSlot }, currentSlot) {
    const el = document.createElement("div");
    el.className = "block block-actual";
    if (currentSlot >= startSlot && currentSlot < endSlot) el.classList.add("is-now");
    el.style.gridRow = `${startSlot + 1} / ${endSlot + 1}`;

    const textEl = document.createElement("div");
    textEl.className = "block-plan-text";
    textEl.textContent = block.actualText || block.planText;
    el.appendChild(textEl);

    const timeEl = document.createElement("div");
    timeEl.className = "block-time-text";
    timeEl.textContent = `${TIMES[startSlot]} - ${TIMES[endSlot]}`;
    el.appendChild(timeEl);

    el.title = `実績: ${TIMES[startSlot]}〜${TIMES[endSlot]} ${block.actualText || block.planText}`;
    el.addEventListener("click", () => openBlockModal(block.id, null));
    return el;
  }

  // ---------- rendering: day-range settings ----------

  function populateDaySettingSelects() {
    const startSel = document.getElementById("day-start-input");
    const endSel = document.getElementById("day-end-input");
    [startSel, endSel].forEach((sel) => {
      sel.innerHTML = "";
      ALL_DAY_TIMES.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        sel.appendChild(opt);
      });
    });
    startSel.value = settings.dayStart;
    endSel.value = settings.dayEnd;
  }

  function handleDaySettingChange() {
    const startSel = document.getElementById("day-start-input");
    const endSel = document.getElementById("day-end-input");
    const dayStart = startSel.value;
    const dayEnd = endSel.value;

    if (timeToMinutes(dayEnd) <= timeToMinutes(dayStart)) {
      alert("終了時刻は開始時刻より後にしてください。");
      startSel.value = settings.dayStart;
      endSel.value = settings.dayEnd;
      return;
    }

    settings = { dayStart, dayEnd };
    saveSettings();
    rebuildTimes();
    populateTaskStartSelect();
    render();
  }

  // ---------- rendering: task list ----------

  function renderTaskList() {
    const list = document.getElementById("task-list");
    list.innerHTML = "";

    if (state.tasks.length === 0) {
      const hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "タスクがまだありません。上のフォームから追加してください。";
      list.appendChild(hint);
      return;
    }

    state.tasks.forEach((task) => {
      const li = document.createElement("li");
      li.className = "task-item" + (task.completed ? " completed" : "");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "task-checkbox";
      checkbox.checked = task.completed;
      checkbox.addEventListener("change", () => {
        task.completed = checkbox.checked;
        saveState();
        render();
      });
      li.appendChild(checkbox);

      const name = document.createElement("span");
      name.className = "task-name";
      name.textContent = task.name;
      li.appendChild(name);

      const duration = document.createElement("span");
      duration.className = "task-duration";
      duration.textContent = `想定${task.estimatedMinutes}分`;
      li.appendChild(duration);

      const status = document.createElement("span");
      status.className = "task-status " + (task.completed ? "done" : "pending");
      status.textContent = task.completed ? "完了" : "未完了";
      li.appendChild(status);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "task-delete-btn";
      deleteBtn.type = "button";
      deleteBtn.textContent = "×";
      deleteBtn.title = "削除";
      deleteBtn.addEventListener("click", () => {
        state.tasks = state.tasks.filter((t) => t.id !== task.id);
        state.blocks = state.blocks.filter((b) => b.taskId !== task.id);
        saveState();
        render();
      });
      li.appendChild(deleteBtn);

      list.appendChild(li);
    });
  }

  function populateTaskStartSelect() {
    const selectEl = document.getElementById("task-start-input");
    selectEl.innerHTML = "";
    const blankOpt = document.createElement("option");
    blankOpt.value = "";
    blankOpt.textContent = "開始時刻（任意）";
    selectEl.appendChild(blankOpt);
    for (let i = 0; i < SLOT_COUNT; i++) {
      const opt = document.createElement("option");
      opt.value = TIMES[i];
      opt.textContent = TIMES[i];
      selectEl.appendChild(opt);
    }
  }

  function handleAddTask(e) {
    e.preventDefault();
    const nameInput = document.getElementById("task-name-input");
    const durationInput = document.getElementById("task-duration-input");
    const startInput = document.getElementById("task-start-input");
    const name = nameInput.value.trim();
    if (!name) return;

    const estimatedMinutes = Number(durationInput.value);
    const taskId = uid();
    let blockId = null;

    if (startInput.value !== "") {
      const startTime = startInput.value;
      const endTime = minutesToTime(timeToMinutes(startTime) + estimatedMinutes);
      if (timeToMinutes(endTime) > timeToMinutes(settings.dayEnd)) {
        alert(`${settings.dayEnd}を超えるため、スケジュールには反映されませんでした。`);
      } else {
        const overlapping = hasOverlap(startTime, endTime, null);
        if (overlapping) {
          alert(
            `その時間帯は「${overlapping.planText}」と重複しているため、スケジュールには反映されませんでした。`
          );
        } else {
          blockId = uid();
          state.blocks.push({
            id: blockId,
            startTime,
            endTime,
            planText: name,
            original: { startTime, endTime, planText: name },
            actualStart: null,
            actualEnd: null,
            actualText: null,
            taskId,
          });
        }
      }
    }

    state.tasks.push({
      id: taskId,
      name,
      estimatedMinutes,
      completed: false,
      blockId,
    });
    saveState();
    nameInput.value = "";
    startInput.value = "";
    nameInput.focus();
    render();
  }

  // ---------- block modal ----------

  function populateTimeSelect(selectEl, { includeLast }) {
    selectEl.innerHTML = "";
    const count = includeLast ? TIMES.length : TIMES.length - 1;
    for (let i = 0; i < count; i++) {
      const opt = document.createElement("option");
      opt.value = TIMES[i];
      opt.textContent = TIMES[i];
      selectEl.appendChild(opt);
    }
  }

  function populateActualTimeSelect(selectEl) {
    selectEl.innerHTML = "";
    const blankOpt = document.createElement("option");
    blankOpt.value = "";
    blankOpt.textContent = "―";
    selectEl.appendChild(blankOpt);
    TIMES.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      selectEl.appendChild(opt);
    });
  }

  function openBlockModal(blockId, defaultStartTime) {
    editingBlockId = blockId;
    const overlay = document.getElementById("modal-overlay");
    const title = document.getElementById("modal-title");
    const startSel = document.getElementById("block-start");
    const endSel = document.getElementById("block-end");
    const planInput = document.getElementById("block-plan-text");
    const originalInfo = document.getElementById("original-info");
    const actualStartSel = document.getElementById("block-actual-start");
    const actualEndSel = document.getElementById("block-actual-end");
    const actualTextInput = document.getElementById("block-actual-text");
    const deleteBtn = document.getElementById("block-delete-btn");

    populateTimeSelect(startSel, { includeLast: false });
    populateTimeSelect(endSel, { includeLast: true });
    populateActualTimeSelect(actualStartSel);
    populateActualTimeSelect(actualEndSel);

    if (blockId) {
      const block = state.blocks.find((b) => b.id === blockId);
      title.textContent = "予定を編集";
      startSel.value = block.startTime;
      endSel.value = block.endTime;
      planInput.value = block.planText;
      actualStartSel.value = block.actualStart || "";
      actualEndSel.value = block.actualEnd || "";
      actualTextInput.value = block.actualText || "";
      deleteBtn.disabled = false;

      if (isRescheduled(block)) {
        originalInfo.textContent = `元の予定：「${block.original.planText}」 ${block.original.startTime} - ${block.original.endTime}`;
        originalInfo.classList.add("visible");
      } else {
        originalInfo.classList.remove("visible");
      }
    } else {
      title.textContent = "予定を追加";
      const start = defaultStartTime != null ? defaultStartTime : TIMES[0];
      const startIdx = Math.max(slotIndexOf(start), 0);
      startSel.value = start;
      endSel.value = TIMES[Math.min(startIdx + 1, SLOT_COUNT)];
      planInput.value = "";
      actualStartSel.value = "";
      actualEndSel.value = "";
      actualTextInput.value = "";
      deleteBtn.disabled = true;
      originalInfo.classList.remove("visible");
    }

    overlay.classList.add("open");
    planInput.focus();
  }

  function closeBlockModal() {
    document.getElementById("modal-overlay").classList.remove("open");
    editingBlockId = null;
  }

  function handleBlockFormSubmit(e) {
    e.preventDefault();
    const startTime = document.getElementById("block-start").value;
    const endTime = document.getElementById("block-end").value;
    const planText = document.getElementById("block-plan-text").value.trim();
    const actualStart = document.getElementById("block-actual-start").value || null;
    const actualEnd = document.getElementById("block-actual-end").value || null;
    const actualText = document.getElementById("block-actual-text").value.trim() || null;

    if (!planText) return;
    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      alert("終了時刻は開始時刻より後にしてください。");
      return;
    }

    const overlapping = hasOverlap(startTime, endTime, editingBlockId);
    if (overlapping) {
      alert(`その時間帯は「${overlapping.planText}」と重複しています。`);
      return;
    }

    if (editingBlockId) {
      const block = state.blocks.find((b) => b.id === editingBlockId);
      block.startTime = startTime;
      block.endTime = endTime;
      block.planText = planText;
      block.actualStart = actualStart;
      block.actualEnd = actualEnd;
      block.actualText = actualText;
    } else {
      state.blocks.push({
        id: uid(),
        startTime,
        endTime,
        planText,
        original: { startTime, endTime, planText },
        actualStart,
        actualEnd,
        actualText,
        taskId: null,
      });
    }

    saveState();
    closeBlockModal();
    render();
  }

  function handleBlockDelete() {
    if (!editingBlockId) return;
    state.blocks = state.blocks.filter((b) => b.id !== editingBlockId);
    state.tasks.forEach((t) => {
      if (t.blockId === editingBlockId) t.blockId = null;
    });
    saveState();
    closeBlockModal();
    render();
  }

  // ---------- render orchestration ----------

  function render() {
    renderStats();
    renderScheduleGrid();
    renderTaskList();
  }

  function init() {
    populateDaySettingSelects();
    populateTaskStartSelect();
    document.getElementById("day-start-input").addEventListener("change", handleDaySettingChange);
    document.getElementById("day-end-input").addEventListener("change", handleDaySettingChange);
    document.getElementById("task-add-form").addEventListener("submit", handleAddTask);
    document.getElementById("block-form").addEventListener("submit", handleBlockFormSubmit);
    document.getElementById("block-delete-btn").addEventListener("click", handleBlockDelete);
    document.getElementById("block-cancel-btn").addEventListener("click", closeBlockModal);
    document.getElementById("modal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "modal-overlay") closeBlockModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeBlockModal();
    });

    render();
    // Refresh "now" highlight every minute.
    setInterval(renderScheduleGrid, 60 * 1000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
