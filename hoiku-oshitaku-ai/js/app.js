/* 保育園おしたくAI — メインロジック */
(function () {
  'use strict';

  var Data = window.HoikuData;
  var Voice = window.HoikuVoice;

  var SETTINGS_KEY = 'hoiku-oshitaku-ai-settings-v1';
  var AUTO_LISTEN_DELAY_MS = 400; // AIが話し終えてからマイクを開くまでの、自然な間
  var MAX_MIC_RETRY = 1; // 聞き取れなかった時に自動でリトライする回数
  var MAX_OFFTOPIC_PER_MISSION = 2; // 同じミッション中に脱線につきあう回数の上限

  var DEFAULT_SETTINGS = {
    childName: 'たろう',
    // 表示順 = この配列の順番。id ごとに使う/使わないを enabled で持つ。
    missions: Data.MISSION_CATALOG.map(function (m) {
      return { id: m.id, enabled: true };
    })
  };

  var settings = loadSettings();

  // session: { missionIds, index, completedCount, offtopicCount }
  // 会話は基本的に「AIが話す→自動でマイクが開く→子どもが話す→AIが答える→…」の
  // ループで進む。ボタンは、音声が使えない/聞き取れない時のフォールバック。
  var session = null;
  var activeRecognizer = null;
  var suppressRecognitionCallback = false;
  var micUnsupportedNoticeShown = false;

  // ---- 永続化 ----

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return cloneDefaults();
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.missions)) return cloneDefaults();
      var knownIds = Data.MISSION_CATALOG.map(function (m) { return m.id; });
      var missions = parsed.missions.filter(function (m) {
        return knownIds.indexOf(m.id) !== -1;
      });
      var presentIds = missions.map(function (m) { return m.id; });
      knownIds.forEach(function (id) {
        if (presentIds.indexOf(id) === -1) missions.push({ id: id, enabled: true });
      });
      return {
        childName: typeof parsed.childName === 'string' && parsed.childName.trim() ? parsed.childName : DEFAULT_SETTINGS.childName,
        missions: missions
      };
    } catch (err) {
      return cloneDefaults();
    }
  }

  function cloneDefaults() {
    return {
      childName: DEFAULT_SETTINGS.childName,
      missions: DEFAULT_SETTINGS.missions.map(function (m) { return { id: m.id, enabled: m.enabled }; })
    };
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      /* ストレージが使えなくても進行は止めない */
    }
  }

  // ---- ユーティリティ ----

  function randomFrom(list) {
    if (!list || !list.length) return '';
    return list[Math.floor(Math.random() * list.length)];
  }

  function activeMissionDefs() {
    return settings.missions
      .filter(function (m) { return m.enabled; })
      .map(function (m) { return Data.getMissionById(m.id); })
      .filter(Boolean);
  }

  function $(id) {
    return document.getElementById(id);
  }

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(function (el) {
      el.classList.toggle('active', el.dataset.screen === name);
    });
  }

  function setBubble(elId, text) {
    $(elId).textContent = text;
  }

  function setTalking(charEl, talking) {
    charEl.classList.toggle('talking', !!talking);
  }

  function setListeningVisual(on) {
    $('mic-btn').classList.toggle('listening', !!on);
    $('character-chat').classList.toggle('listening', !!on);
  }

  function missionPromptText(mission) {
    var namePrefix = settings.childName ? settings.childName + '、' : '';
    return mission.prompt(namePrefix);
  }

  // AIのセリフを吹き出し表示しつつ読み上げ、話し終わったら afterSpeak を呼ぶ。
  // 会話が途切れないよう、複数の内容（褒め言葉＋次の質問、など）は
  // 呼び出し側で1つの文章に連結してから渡すこと。
  function sayAndShow(bubbleId, charEl, text, afterSpeak) {
    setBubble(bubbleId, text);
    setTalking(charEl, true);
    Voice.speak(text, {
      onEnd: function () {
        setTalking(charEl, false);
        if (afterSpeak) afterSpeak();
      }
    });
  }

  // ---- パズル（ミニ：ちょっとずつ完成 / フル：完成画面） ----

  function rainbowSvgMarkup() {
    return (
      '<svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="0" y="0" width="200" height="120" fill="#BEE7FF"/>' +
      '<circle cx="30" cy="95" r="10" fill="#FFF6D8"/>' +
      '<circle cx="170" cy="30" r="14" fill="#FFF6D8"/>' +
      '<path d="M0,120 A100,100 0 0,1 200,120" fill="none" stroke="#FF6B6B" stroke-width="12"/>' +
      '<path d="M0,120 A82,82 0 0,1 200,120" fill="none" stroke="#FFA94D" stroke-width="12" transform="translate(0,18)"/>' +
      '<path d="M0,120 A64,64 0 0,1 200,120" fill="none" stroke="#FFD93D" stroke-width="12" transform="translate(0,36)"/>' +
      '<path d="M0,120 A46,46 0 0,1 200,120" fill="none" stroke="#6BCB77" stroke-width="12" transform="translate(0,54)"/>' +
      '<path d="M0,120 A28,28 0 0,1 200,120" fill="none" stroke="#4D96FF" stroke-width="12" transform="translate(0,72)"/>' +
      '<rect x="0" y="108" width="200" height="12" fill="#8BD98B"/>' +
      '</svg>'
    );
  }

  function computeGrid(total) {
    var cols = Math.max(1, Math.ceil(Math.sqrt(total)));
    var rows = Math.max(1, Math.ceil(total / cols));
    return { cols: cols, rows: rows };
  }

  function buildPuzzleShell(container, total) {
    var grid = computeGrid(total);
    container.innerHTML =
      '<div class="puzzle-art">' + rainbowSvgMarkup() + '</div>' +
      '<div class="puzzle-covers" style="grid-template-columns:repeat(' + grid.cols + ',1fr);grid-template-rows:repeat(' + grid.rows + ',1fr);"></div>';
    var coversEl = container.querySelector('.puzzle-covers');
    for (var i = 0; i < total; i++) {
      var cover = document.createElement('div');
      cover.className = 'puzzle-cover';
      cover.dataset.index = String(i);
      coversEl.appendChild(cover);
    }
  }

  function updatePuzzleReveal(container, revealedCount) {
    var covers = container.querySelectorAll('.puzzle-cover');
    covers.forEach(function (cover) {
      var idx = Number(cover.dataset.index);
      cover.classList.toggle('revealed', idx < revealedCount);
    });
  }

  // ---- 進捗表示 ----

  function updateProgress() {
    var total = session.missionIds.length;
    var done = session.completedCount;
    $('progress-label').textContent = 'あさのミッション ' + done + ' / ' + total;
    $('progress-fill').style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
    updatePuzzleReveal($('mini-puzzle'), done);
  }

  // ---- セッション進行 ----

  function currentMissionDef() {
    var id = session.missionIds[session.index];
    return Data.getMissionById(id);
  }

  function startSession() {
    var active = activeMissionDefs();
    if (!active.length) {
      window.alert('つかうミッションが1つもえらばれていないよ。せっていがめんで、すこしオンにしてね。');
      openSettings('start');
      return;
    }
    session = {
      missionIds: active.map(function (m) { return m.id; }),
      index: 0,
      completedCount: 0,
      offtopicCount: 0
    };
    micUnsupportedNoticeShown = false;
    buildPuzzleShell($('mini-puzzle'), session.missionIds.length);
    updateProgress();
    setMicStatus('');
    showScreen('chat');
    presentCurrentMission();
  }

  function presentCurrentMission() {
    session.offtopicCount = 0;
    var mission = currentMissionDef();
    var text = missionPromptText(mission);
    sayAndShow('chat-bubble', $('character-chat'), text, function () {
      scheduleAutoListen();
    });
  }

  function handleAnswer(kind) {
    if (!session) return;
    stopActiveRecognition();
    var mission = currentMissionDef();
    setMicStatus('');
    if (kind === 'done') {
      var reply = randomFrom(mission.successReplies) || 'できたね！すごい！';
      session.completedCount++;
      session.index++;
      updateProgress();
      if (session.index >= session.missionIds.length) {
        finishSessionWithPraise(reply);
      } else {
        session.offtopicCount = 0;
        var nextMission = currentMissionDef();
        var combined = reply + '　' + missionPromptText(nextMission);
        sayAndShow('chat-bubble', $('character-chat'), combined, function () {
          scheduleAutoListen();
        });
      }
    } else if (kind === 'wait') {
      var waitReply = randomFrom(mission.waitReplies) || 'あわてなくていいよ、ゆっくりね。';
      sayAndShow('chat-bubble', $('character-chat'), waitReply, function () {
        scheduleAutoListen();
      });
    } else if (kind === 'unsure') {
      var hint = mission.hint || '一緒にゆっくりやってみようね。';
      sayAndShow('chat-bubble', $('character-chat'), hint, function () {
        scheduleAutoListen();
      });
    }
  }

  // 「できた/まだ/わからない」のどれとも判定できなかった発話への応答。
  // 内容にひとこと相槌を返してから、さりげなく今のミッションへ話を戻す。
  function handleOfftopic(transcript) {
    if (!session) return;
    session.offtopicCount++;
    var mission = currentMissionDef();
    if (session.offtopicCount > MAX_OFFTOPIC_PER_MISSION) {
      setMicStatus('🎤 ボタンでもこたえられるよ');
      return;
    }
    var ack = Voice.craftOfftopicAck(transcript);
    var combined = ack + '　ところで、' + missionPromptText(mission);
    sayAndShow('chat-bubble', $('character-chat'), combined, function () {
      scheduleAutoListen();
    });
  }

  function finishSessionWithPraise(praise) {
    showScreen('complete');
    buildPuzzleShell($('puzzle-full'), 1);
    updatePuzzleReveal($('puzzle-full'), 1);
    var lines = ['今日のミッションコンプリート！', 'パズルが完成したよ！', 'じゃあ保育園に行こう！'];
    var combined = praise + '　' + lines.join('　');
    setBubble('complete-bubble', combined);
    var charEl = $('character-complete');
    setTalking(charEl, true);
    Voice.speak(combined, { onEnd: function () { setTalking(charEl, false); } });
  }

  // ---- マイク（自動リスニングのループ） ----

  function setMicStatus(text) {
    $('mic-status').textContent = text;
  }

  function stopActiveRecognition() {
    if (activeRecognizer) {
      suppressRecognitionCallback = true;
      try {
        if (activeRecognizer.abort) activeRecognizer.abort();
        else activeRecognizer.stop();
      } catch (err) {
        /* すでに終了していても問題ない */
      }
      activeRecognizer = null;
    }
    setListeningVisual(false);
  }

  // AIが話し終えた少し後に、子どもが操作しなくても自動でマイクを開く。
  // ブラウザが対応していない/エラーが続く場合は静かにボタン待ちへフォールバックする。
  function scheduleAutoListen() {
    if (!session) return;
    if (!Voice.isRecognitionSupported) return;
    window.setTimeout(function () {
      if (!session) return;
      startListening(0);
    }, AUTO_LISTEN_DELAY_MS);
  }

  function startListening(retryCount) {
    if (!session) return;
    if (activeRecognizer) return;
    if (!Voice.isRecognitionSupported) {
      if (!micUnsupportedNoticeShown) {
        setMicStatus('この端末は音声にんしきに対応していないよ。ボタンでこたえてね。');
        micUnsupportedNoticeShown = true;
      }
      return;
    }

    setListeningVisual(true);
    setMicStatus('🎤 きいているよ…はなしてね');

    function handleMiss() {
      activeRecognizer = null;
      setListeningVisual(false);
      if (retryCount < MAX_MIC_RETRY) {
        sayAndShow('chat-bubble', $('character-chat'), 'ん？もう一回いってごらん？', function () {
          if (session) startListening(retryCount + 1);
        });
      } else {
        setMicStatus('🎤 ボタンでもこたえられるよ');
      }
    }

    activeRecognizer = Voice.listenOnce(
      function onResult(transcript) {
        if (suppressRecognitionCallback) {
          suppressRecognitionCallback = false;
          activeRecognizer = null;
          return;
        }
        var clean = transcript && transcript.trim();
        if (!clean) {
          handleMiss();
          return;
        }
        activeRecognizer = null;
        setListeningVisual(false);
        var kind = Voice.interpretAnswer(clean);
        if (kind) {
          setMicStatus('「' + clean + '」ときこえたよ');
          handleAnswer(kind);
        } else {
          setMicStatus('「' + clean + '」ときこえたよ');
          handleOfftopic(clean);
        }
      },
      function onError(reason) {
        if (suppressRecognitionCallback) {
          suppressRecognitionCallback = false;
          activeRecognizer = null;
          return;
        }
        activeRecognizer = null;
        setListeningVisual(false);
        if (reason === 'unsupported') {
          if (!micUnsupportedNoticeShown) {
            setMicStatus('この端末は音声にんしきに対応していないよ。ボタンでこたえてね。');
            micUnsupportedNoticeShown = true;
          }
          return;
        }
        handleMiss();
      }
    );
  }

  function handleMicTap() {
    if (activeRecognizer) {
      stopActiveRecognition();
      setMicStatus('');
      return;
    }
    startListening(0);
  }

  // ---- 設定画面 ----

  function openSettings(fromScreen) {
    $('settings-back-btn').dataset.returnTo = fromScreen || 'start';
    $('child-name-input').value = settings.childName;
    renderMissionSettingsList();
    showScreen('settings');
  }

  function closeSettings() {
    var returnTo = $('settings-back-btn').dataset.returnTo || 'start';
    refreshStartBubble();
    showScreen(returnTo);
  }

  function renderMissionSettingsList() {
    var listEl = $('mission-settings-list');
    listEl.innerHTML = '';
    settings.missions.forEach(function (entry, idx) {
      var def = Data.getMissionById(entry.id);
      if (!def) return;
      var li = document.createElement('li');
      li.className = 'mission-setting-item';

      var label = document.createElement('label');
      label.className = 'mission-toggle';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!entry.enabled;
      checkbox.addEventListener('change', function () {
        entry.enabled = checkbox.checked;
        saveSettings();
      });
      var span = document.createElement('span');
      span.textContent = def.icon + ' ' + def.label;
      label.appendChild(checkbox);
      label.appendChild(span);

      var moveWrap = document.createElement('div');
      moveWrap.className = 'move-buttons';
      var upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'move-btn';
      upBtn.setAttribute('aria-label', def.label + 'を上に移動');
      upBtn.textContent = '▲';
      upBtn.disabled = idx === 0;
      upBtn.addEventListener('click', function () {
        moveMission(idx, -1);
      });
      var downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'move-btn';
      downBtn.setAttribute('aria-label', def.label + 'を下に移動');
      downBtn.textContent = '▼';
      downBtn.disabled = idx === settings.missions.length - 1;
      downBtn.addEventListener('click', function () {
        moveMission(idx, 1);
      });
      moveWrap.appendChild(upBtn);
      moveWrap.appendChild(downBtn);

      li.appendChild(label);
      li.appendChild(moveWrap);
      listEl.appendChild(li);
    });
  }

  function moveMission(idx, delta) {
    var newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= settings.missions.length) return;
    var tmp = settings.missions[idx];
    settings.missions[idx] = settings.missions[newIdx];
    settings.missions[newIdx] = tmp;
    saveSettings();
    renderMissionSettingsList();
  }

  function refreshStartBubble() {
    var name = settings.childName || 'きみ';
    setBubble('start-bubble', 'おはよう、' + name + '！\n今日も保育園に行こう！');
  }

  function goToStart() {
    stopActiveRecognition();
    session = null;
    setBubble('chat-bubble', '');
    setMicStatus('');
    refreshStartBubble();
    showScreen('start');
  }

  // ---- 初期化 ----

  function init() {
    refreshStartBubble();

    if (!Voice.isRecognitionSupported) {
      $('mic-btn').disabled = true;
      $('mic-btn').classList.add('unsupported');
      $('voice-hint').textContent = 'この端末は音声が使えないよ。ボタンでこたえてね。';
    }

    $('start-btn').addEventListener('click', startSession);
    $('settings-btn-start').addEventListener('click', function () {
      openSettings('start');
    });
    $('settings-back-btn').addEventListener('click', closeSettings);
    $('child-name-input').addEventListener('input', function (e) {
      settings.childName = e.target.value;
      saveSettings();
    });

    $('mic-btn').addEventListener('click', handleMicTap);
    document.querySelectorAll('.answer-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        stopActiveRecognition();
        handleAnswer(btn.dataset.answer);
      });
    });

    $('go-btn').addEventListener('click', goToStart);
    $('restart-btn').addEventListener('click', goToStart);

    showScreen('start');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
