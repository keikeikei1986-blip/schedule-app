(function () {
  'use strict';

  var FOCUS_SECONDS = 25 * 60;
  var BREAK_SECONDS = 5 * 60;
  var STORAGE_KEY = 'focus25-sessions-v1';
  var HG_CHAMBER = 46; // matches the SVG geometry: neck at y=55, chamber top/bottom at y=9/101

  var screens = {
    idle: document.getElementById('screen-idle'),
    focus: document.getElementById('screen-focus'),
    focusDone: document.getElementById('screen-focus-done'),
    breakScreen: document.getElementById('screen-break'),
    breakDone: document.getElementById('screen-break-done')
  };

  var appHeaderEl = document.querySelector('.app-header');
  var recordsCardEl = document.querySelector('.records-card');
  var RUNNING_SCREENS = { focus: true, breakScreen: true };

  var themeInput = document.getElementById('theme-input');
  var startBtn = document.getElementById('start-btn');
  var focusThemeDisplay = document.getElementById('focus-theme-display');
  var focusTimerDisplay = document.getElementById('focus-timer-display');
  var pauseBtn = document.getElementById('pause-btn');
  var endBtn = document.getElementById('end-btn');
  var doneThemeBlock = document.getElementById('done-theme-block');
  var doneThemeText = document.getElementById('done-theme-text');
  var startBreakBtn = document.getElementById('start-break-btn');
  var skipBreakBtn = document.getElementById('skip-break-btn');
  var breakTimerDisplay = document.getElementById('break-timer-display');
  var nextFocusBtn = document.getElementById('next-focus-btn');

  var focusHgTop = document.getElementById('focus-hg-top');
  var focusHgBottom = document.getElementById('focus-hg-bottom');
  var breakHgTop = document.getElementById('break-hg-top');
  var breakHgBottom = document.getElementById('break-hg-bottom');

  var endConfirmOverlay = document.getElementById('end-confirm-overlay');
  var endConfirmBody = document.getElementById('end-confirm-body');
  var endConfirmCancelBtn = document.getElementById('end-confirm-cancel');
  var endConfirmOkBtn = document.getElementById('end-confirm-ok');

  var todayTotalEl = document.getElementById('today-total');
  var todaySetsEl = document.getElementById('today-sets');
  var totalsTodayEl = document.getElementById('totals-today');
  var totalsWeekEl = document.getElementById('totals-week');
  var weekChartEl = document.getElementById('week-chart');
  var logListEl = document.getElementById('log-list');
  var logEmptyEl = document.getElementById('log-empty');

  var timer = {
    endAt: null,
    remainingMs: null,
    intervalId: null,
    theme: ''
  };

  function showScreen(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].classList.toggle('is-hidden', key !== name);
    });
    var isMinimal = !!RUNNING_SCREENS[name];
    appHeaderEl.classList.toggle('is-hidden', isMinimal);
    recordsCardEl.classList.toggle('is-hidden', isMinimal);
  }

  function formatTime(totalSeconds) {
    var s = Math.max(0, Math.ceil(totalSeconds));
    var m = Math.floor(s / 60);
    var sec = s % 60;
    return (m < 10 ? '0' + m : m) + ':' + (sec < 10 ? '0' + sec : sec);
  }

  function formatDurationLabel(totalSeconds) {
    var s = Math.max(0, Math.round(totalSeconds));
    var m = Math.floor(s / 60);
    var sec = s % 60;
    return sec === 0 ? (m + '分') : (m + '分' + sec + '秒');
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function todayKey(date) {
    var d = date || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // ---- hourglass gauge ----

  function setHourglass(topEl, bottomEl, remainingFraction) {
    var f = Math.max(0, Math.min(1, remainingFraction));
    var topHeight = f * HG_CHAMBER;
    topEl.setAttribute('y', 55 - topHeight);
    topEl.setAttribute('height', topHeight);
    bottomEl.setAttribute('height', (1 - f) * HG_CHAMBER);
  }

  // ---- storage ----

  function migrateSession(s) {
    if (typeof s.seconds === 'number' && typeof s.completed === 'boolean') return s;
    var minutes = typeof s.minutes === 'number' ? s.minutes : 25;
    return {
      date: s.date,
      theme: s.theme || '',
      seconds: Math.round(minutes * 60),
      completed: true,
      ts: s.ts || Date.now()
    };
  }

  function loadSessions() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(migrateSession);
    } catch (e) {
      return [];
    }
  }

  function saveSessions(sessions) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }

  function recordSession(theme, seconds, completed) {
    var sessions = loadSessions();
    sessions.push({
      date: todayKey(),
      theme: theme || '',
      seconds: Math.max(0, Math.round(seconds)),
      completed: !!completed,
      ts: Date.now()
    });
    saveSessions(sessions);
    renderRecords();
  }

  // ---- timer control ----

  function clearTick() {
    if (timer.intervalId) {
      clearInterval(timer.intervalId);
      timer.intervalId = null;
    }
  }

  function getFocusRemainingMs() {
    if (timer.remainingMs !== null) return timer.remainingMs;
    return Math.max(0, timer.endAt - Date.now());
  }

  function startFocus() {
    timer.theme = themeInput.value.trim();
    timer.endAt = Date.now() + FOCUS_SECONDS * 1000;
    timer.remainingMs = null;
    focusThemeDisplay.textContent = timer.theme;
    focusThemeDisplay.classList.toggle('is-hidden', !timer.theme);
    pauseBtn.textContent = '一時停止';
    showScreen('focus');
    clearTick();
    tickFocus();
    timer.intervalId = setInterval(tickFocus, 250);
  }

  function tickFocus() {
    var remainingMs = timer.endAt - Date.now();
    if (remainingMs <= 0) {
      clearTick();
      focusTimerDisplay.textContent = '00:00';
      setHourglass(focusHgTop, focusHgBottom, 0);
      finishFocus();
      return;
    }
    focusTimerDisplay.textContent = formatTime(remainingMs / 1000);
    setHourglass(focusHgTop, focusHgBottom, remainingMs / (FOCUS_SECONDS * 1000));
  }

  function togglePauseFocus() {
    if (timer.remainingMs !== null) {
      timer.endAt = Date.now() + timer.remainingMs;
      timer.remainingMs = null;
      pauseBtn.textContent = '一時停止';
      clearTick();
      timer.intervalId = setInterval(tickFocus, 250);
    } else {
      timer.remainingMs = Math.max(0, timer.endAt - Date.now());
      clearTick();
      pauseBtn.textContent = '再開';
      focusTimerDisplay.textContent = formatTime(timer.remainingMs / 1000);
      setHourglass(focusHgTop, focusHgBottom, timer.remainingMs / (FOCUS_SECONDS * 1000));
    }
  }

  function endFocusEarly() {
    var elapsedSeconds = FOCUS_SECONDS - getFocusRemainingMs() / 1000;
    clearTick();
    timer.remainingMs = null;
    recordSession(timer.theme, elapsedSeconds, false);
    resetToIdle();
  }

  function finishFocus() {
    recordSession(timer.theme, FOCUS_SECONDS, true);
    if (timer.theme) {
      doneThemeText.textContent = timer.theme;
      doneThemeBlock.classList.remove('is-hidden');
    } else {
      doneThemeBlock.classList.add('is-hidden');
    }
    showScreen('focusDone');
  }

  function startBreak() {
    timer.endAt = Date.now() + BREAK_SECONDS * 1000;
    timer.remainingMs = null;
    showScreen('breakScreen');
    clearTick();
    tickBreak();
    timer.intervalId = setInterval(tickBreak, 250);
  }

  function tickBreak() {
    var remainingMs = timer.endAt - Date.now();
    if (remainingMs <= 0) {
      clearTick();
      breakTimerDisplay.textContent = '00:00';
      setHourglass(breakHgTop, breakHgBottom, 0);
      showScreen('breakDone');
      return;
    }
    breakTimerDisplay.textContent = formatTime(remainingMs / 1000);
    setHourglass(breakHgTop, breakHgBottom, remainingMs / (BREAK_SECONDS * 1000));
  }

  function resetToIdle() {
    themeInput.value = '';
    breakTimerDisplay.textContent = '05:00';
    focusTimerDisplay.textContent = '25:00';
    setHourglass(focusHgTop, focusHgBottom, 1);
    setHourglass(breakHgTop, breakHgBottom, 1);
    showScreen('idle');
    themeInput.focus();
  }

  // ---- end confirmation modal ----

  function openEndConfirm() {
    // Stop ticking while the dialog is open so a session can't silently
    // finish (and double-record) behind the confirmation modal.
    clearTick();
    var elapsedSeconds = FOCUS_SECONDS - getFocusRemainingMs() / 1000;
    endConfirmBody.textContent = 'ここまでの集中時間（' + formatDurationLabel(elapsedSeconds) + '）を記録して終了します。';
    endConfirmOverlay.classList.remove('is-hidden');
  }

  function hideEndConfirm() {
    endConfirmOverlay.classList.add('is-hidden');
  }

  function cancelEndConfirm() {
    hideEndConfirm();
    if (timer.remainingMs === null) {
      // Was actively running (not paused) before the dialog opened; resume.
      tickFocus();
      timer.intervalId = setInterval(tickFocus, 250);
    }
  }

  // ---- records rendering ----

  function minutesLabel(totalMinutes) {
    if (totalMinutes <= 0) return '0分';
    var h = Math.floor(totalMinutes / 60);
    var m = totalMinutes % 60;
    if (h === 0) return m + '分';
    if (m === 0) return h + '時間';
    return h + '時間' + m + '分';
  }

  function startOfWeek(date) {
    var d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }

  function renderRecords() {
    var sessions = loadSessions();
    var todayStr = todayKey();
    var weekStart = startOfWeek(new Date());

    var todaySessions = sessions.filter(function (s) { return s.date === todayStr; });
    var todaySeconds = todaySessions.reduce(function (sum, s) { return sum + s.seconds; }, 0);
    var todayMinutes = Math.round(todaySeconds / 60);

    todayTotalEl.textContent = minutesLabel(todayMinutes);
    todaySetsEl.textContent = todaySessions.length + 'セット';
    totalsTodayEl.textContent = '今日　' + minutesLabel(todayMinutes);

    var daySeconds = [0, 0, 0, 0, 0, 0, 0];
    var weekSeconds = 0;
    sessions.forEach(function (s) {
      var d = new Date(s.date + 'T00:00:00');
      var diffDays = Math.round((d - weekStart) / 86400000);
      if (diffDays >= 0 && diffDays < 7) {
        daySeconds[diffDays] += s.seconds;
        weekSeconds += s.seconds;
      }
    });
    totalsWeekEl.textContent = '今週　' + minutesLabel(Math.round(weekSeconds / 60));

    var dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
    var dayMinutes = daySeconds.map(function (sec) { return Math.round(sec / 60); });
    var maxMinutes = Math.max.apply(null, dayMinutes.concat([1]));
    weekChartEl.innerHTML = '';
    dayMinutes.forEach(function (mins, i) {
      var d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      var isToday = todayKey(d) === todayStr;

      var col = document.createElement('div');
      col.className = 'week-bar-col';

      var track = document.createElement('div');
      track.className = 'week-bar-track';

      var bar = document.createElement('div');
      bar.className = 'week-bar' + (mins > 0 ? ' has-time' : '') + (isToday ? ' is-today' : '');
      var heightPct = mins > 0 ? Math.max(6, Math.round((mins / maxMinutes) * 100)) : 3;
      bar.style.height = heightPct + '%';
      bar.title = dayLabels[i] + '　' + minutesLabel(mins);

      var label = document.createElement('div');
      label.className = 'week-bar-label';
      label.textContent = dayLabels[i];

      track.appendChild(bar);
      col.appendChild(track);
      col.appendChild(label);
      weekChartEl.appendChild(col);
    });

    var logSessions = sessions
      .filter(function (s) { return s.date === todayStr; })
      .slice()
      .reverse();

    logListEl.innerHTML = '';
    if (logSessions.length === 0) {
      logListEl.appendChild(logEmptyEl);
    } else {
      logSessions.forEach(function (s) {
        var li = document.createElement('li');
        li.className = 'log-item';

        var minutesSpan = document.createElement('span');
        minutesSpan.className = 'log-item-minutes' + (s.completed ? '' : ' is-partial');
        minutesSpan.textContent = formatDurationLabel(s.seconds);

        var themeSpan = document.createElement('span');
        themeSpan.className = 'log-item-theme' + (s.theme ? '' : ' is-untitled');
        themeSpan.textContent = s.theme || '（無題）';

        if (!s.completed) {
          var tag = document.createElement('span');
          tag.className = 'log-partial-tag';
          tag.textContent = '途中終了';
          themeSpan.appendChild(tag);
        }

        li.appendChild(minutesSpan);
        li.appendChild(themeSpan);
        logListEl.appendChild(li);
      });
    }
  }

  // ---- events ----

  startBtn.addEventListener('click', startFocus);
  pauseBtn.addEventListener('click', togglePauseFocus);
  endBtn.addEventListener('click', openEndConfirm);
  endConfirmCancelBtn.addEventListener('click', cancelEndConfirm);
  endConfirmOkBtn.addEventListener('click', function () {
    hideEndConfirm();
    endFocusEarly();
  });
  endConfirmOverlay.addEventListener('click', function (e) {
    if (e.target === endConfirmOverlay) cancelEndConfirm();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !endConfirmOverlay.classList.contains('is-hidden')) {
      cancelEndConfirm();
    }
  });

  startBreakBtn.addEventListener('click', startBreak);
  skipBreakBtn.addEventListener('click', resetToIdle);
  nextFocusBtn.addEventListener('click', resetToIdle);

  themeInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      startFocus();
    }
  });

  // ---- init ----

  showScreen('idle');
  renderRecords();
})();
