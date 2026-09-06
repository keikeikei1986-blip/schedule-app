(function () {
  "use strict";

  var STORAGE_KEY = "kintore-log-v1";

  var PARTS = ["胸", "背中", "肩", "腕", "脚", "腹筋", "その他"];

  var DEFAULT_REPS = 10;
  var DEFAULT_SETS = 3;

  var PRESET_EXERCISES = {
    "胸": [
      "ベンチプレス",
      "インクラインベンチプレス",
      "ダンベルベンチプレス",
      "インクラインダンベルプレス",
      "チェストプレス",
      "ペックフライ",
      "ディップス",
      "ケーブルクロスオーバー"
    ],
    "背中": [
      "ラットプルダウン",
      "ワイドラットプルダウン",
      "ナローラットプルダウン",
      "懸垂",
      "アシスト懸垂",
      "シーテッドロー",
      "ワンハンドロー",
      "ダンベルロー",
      "デッドリフト"
    ],
    "肩": [
      "ショルダープレス",
      "ダンベルショルダープレス",
      "サイドレイズ",
      "フロントレイズ",
      "リアレイズ",
      "アップライトロー",
      "フェイスプル"
    ],
    "腕": [
      "アームカール",
      "ダンベルカール",
      "ハンマーカール",
      "プリーチャーカール",
      "トライセプスプレスダウン",
      "フレンチプレス",
      "ライイングトライセプスエクステンション"
    ],
    "脚": [
      "スクワット",
      "ハックスクワット",
      "レッグプレス",
      "レッグエクステンション",
      "レッグカール",
      "ブルガリアンスクワット",
      "ランジ",
      "カーフレイズ"
    ],
    "腹筋": ["クランチ", "アブドミナル", "レッグレイズ", "ハンギングレッグレイズ", "プランク"],
    "その他": []
  };

  var state = { workouts: [], weights: [] };

  function loadState() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.workouts)) state.workouts = parsed.workouts;
      if (parsed && Array.isArray(parsed.weights)) state.weights = parsed.weights;
    } catch (e) {
      /* 破損したデータは無視して初期状態のまま */
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function todayStr() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function formatDateLong(dateStr) {
    var parts = dateStr.split("-");
    return parts[0] + "/" + parts[1] + "/" + parts[2];
  }

  function formatDateShort(dateStr) {
    var parts = dateStr.split("-");
    return parseInt(parts[1], 10) + "/" + parseInt(parts[2], 10);
  }

  // ---------- 要素参照 ----------

  var recordCountEl = document.getElementById("record-count");
  var partFilterEl = document.getElementById("part-filter");
  var workoutFeedEl = document.getElementById("workout-feed");
  var weightListEl = document.getElementById("weight-list");
  var exerciseSuggestionsEl = document.getElementById("exercise-suggestions");

  var addWorkoutBtn = document.getElementById("add-workout-btn");
  var workoutModalOverlay = document.getElementById("workout-modal-overlay");
  var workoutModalTitle = document.getElementById("workout-modal-title");
  var workoutForm = document.getElementById("workout-form");
  var workoutDateInput = document.getElementById("workout-date-input");
  var workoutPartInput = document.getElementById("workout-part-input");
  var workoutExerciseInput = document.getElementById("workout-exercise-input");
  var workoutWeightInput = document.getElementById("workout-weight-input");
  var workoutRepsInput = document.getElementById("workout-reps-input");
  var workoutSetsInput = document.getElementById("workout-sets-input");
  var workoutMemoInput = document.getElementById("workout-memo-input");
  var workoutCancelBtn = document.getElementById("workout-cancel-btn");
  var workoutDeleteBtn = document.getElementById("workout-delete-btn");
  var prevRecordHintEl = document.getElementById("prev-record-hint");

  var addWeightBtn = document.getElementById("add-weight-btn");
  var weightModalOverlay = document.getElementById("weight-modal-overlay");
  var weightModalTitle = document.getElementById("weight-modal-title");
  var weightForm = document.getElementById("weight-form");
  var weightDateInput = document.getElementById("weight-date-input");
  var weightValueInput = document.getElementById("weight-value-input");
  var weightCancelBtn = document.getElementById("weight-cancel-btn");
  var weightDeleteBtn = document.getElementById("weight-delete-btn");

  var editingWorkoutId = null;
  var editingWeightId = null;
  var currentExerciseOptions = [];

  // ---------- 記録フィードの描画 ----------

  function renderRecordCount() {
    recordCountEl.textContent = "総記録数: " + state.workouts.length + "件";
  }

  // 部位ごとの種目候補（プリセット + これまでにその部位で入力した種目）を反映する
  function populateExerciseOptionsForPart(part) {
    var names = (PRESET_EXERCISES[part] || []).slice();
    state.workouts
      .filter(function (w) {
        return w.part === part;
      })
      .forEach(function (w) {
        if (names.indexOf(w.exercise) === -1) names.push(w.exercise);
      });
    currentExerciseOptions = names;
    hideExerciseSuggestions();
  }

  // 種目欄のすぐ下に、自前の候補リストを描画する（ネイティブdatalistは
  // モーダル内（固定位置＋中央寄せ＋スクロール）だと表示位置がずれることがあるため使わない）
  function renderExerciseSuggestions(filterText) {
    var query = filterText.trim().toLowerCase();
    var matches = currentExerciseOptions.filter(function (n) {
      return !query || n.toLowerCase().indexOf(query) !== -1;
    });

    if (matches.length === 0) {
      hideExerciseSuggestions();
      return;
    }

    exerciseSuggestionsEl.innerHTML = matches
      .map(function (n) {
        return (
          '<div class="exercise-suggestion-item" data-value="' +
          escapeHtml(n) +
          '">' +
          escapeHtml(n) +
          "</div>"
        );
      })
      .join("");
    exerciseSuggestionsEl.hidden = false;
  }

  function hideExerciseSuggestions() {
    exerciseSuggestionsEl.hidden = true;
    exerciseSuggestionsEl.innerHTML = "";
  }

  // 同じ種目の直近の記録を探し、「前回：60kg × 10回 × 3セット」のヒントを出す
  function updatePrevRecordHint() {
    var exercise = workoutExerciseInput.value.trim();
    if (!exercise) {
      prevRecordHintEl.hidden = true;
      return;
    }

    var candidates = state.workouts
      .filter(function (w) {
        return w.exercise === exercise && w.id !== editingWorkoutId;
      })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return b.createdAt - a.createdAt;
      });

    if (candidates.length === 0) {
      prevRecordHintEl.hidden = true;
      return;
    }

    var prev = candidates[0];
    prevRecordHintEl.textContent =
      "前回：" + prev.weight + "kg × " + prev.reps + "回 × " + prev.sets + "セット";
    prevRecordHintEl.hidden = false;
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function renderWorkoutFeed() {
    var filterPart = partFilterEl.value;

    // 日付降順、同日内は記録した順（古い→新しい）
    var sorted = state.workouts.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.createdAt - b.createdAt;
    });

    // 日付ごとにグループ化
    var dateGroups = [];
    var dateIndex = {};
    sorted.forEach(function (w) {
      if (filterPart && w.part !== filterPart) return;
      if (!(w.date in dateIndex)) {
        dateIndex[w.date] = { date: w.date, items: [] };
        dateGroups.push(dateIndex[w.date]);
      }
      dateIndex[w.date].items.push(w);
    });

    if (dateGroups.length === 0) {
      workoutFeedEl.innerHTML =
        '<p class="empty-state">まだ記録がありません。<br>「＋ 記録する」から最初の1件を積み上げましょう。</p>';
      return;
    }

    workoutFeedEl.innerHTML = dateGroups
      .map(function (group) {
        // 同じ部位が連続する場合はまとめて表示
        var partGroups = [];
        group.items.forEach(function (item) {
          var last = partGroups[partGroups.length - 1];
          if (last && last.part === item.part) {
            last.items.push(item);
          } else {
            partGroups.push({ part: item.part, items: [item] });
          }
        });

        var partGroupsHtml = partGroups
          .map(function (pg) {
            var rowsHtml = pg.items
              .map(function (item) {
                var memoHtml = item.memo
                  ? '<span class="exercise-memo">' + escapeHtml(item.memo) + "</span>"
                  : "";
                return (
                  '<div class="exercise-row" data-id="' +
                  item.id +
                  '">' +
                  '<span class="exercise-name">' +
                  escapeHtml(item.exercise) +
                  "</span>" +
                  '<span class="exercise-detail">' +
                  item.weight +
                  "kg × " +
                  item.reps +
                  "回 × " +
                  item.sets +
                  "セット</span>" +
                  memoHtml +
                  "</div>"
                );
              })
              .join("");
            return (
              '<div class="part-group">' +
              '<span class="part-label">' +
              escapeHtml(pg.part) +
              "</span>" +
              rowsHtml +
              "</div>"
            );
          })
          .join("");

        return (
          '<div class="date-group">' +
          '<div class="date-header">' +
          formatDateLong(group.date) +
          "</div>" +
          partGroupsHtml +
          "</div>"
        );
      })
      .join("");
  }

  function renderWeightList() {
    var sorted = state.weights.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.createdAt - a.createdAt;
    });

    if (sorted.length === 0) {
      weightListEl.innerHTML = '<p class="empty-state">まだ体重の記録がありません。</p>';
      return;
    }

    weightListEl.innerHTML = sorted
      .map(function (w) {
        return (
          '<div class="weight-row" data-id="' +
          w.id +
          '">' +
          '<span class="weight-date">' +
          formatDateShort(w.date) +
          "</span>" +
          '<span class="weight-value">' +
          w.value.toFixed(1) +
          "kg</span>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderAll() {
    renderRecordCount();
    renderWorkoutFeed();
    renderWeightList();
  }

  // ---------- 筋トレ記録モーダル ----------

  function openWorkoutModal(workout) {
    editingWorkoutId = workout ? workout.id : null;
    workoutModalTitle.textContent = workout ? "記録を編集" : "記録する";
    workoutDeleteBtn.hidden = !workout;

    workoutDateInput.value = workout ? workout.date : todayStr();
    workoutPartInput.value = workout ? workout.part : PARTS[0];
    populateExerciseOptionsForPart(workoutPartInput.value);
    workoutExerciseInput.value = workout ? workout.exercise : "";
    workoutWeightInput.value = workout ? workout.weight : "";
    workoutRepsInput.value = workout ? workout.reps : DEFAULT_REPS;
    workoutSetsInput.value = workout ? workout.sets : DEFAULT_SETS;
    workoutMemoInput.value = workout ? workout.memo || "" : "";
    updatePrevRecordHint();

    workoutModalOverlay.hidden = false;
    workoutExerciseInput.focus();
  }

  function closeWorkoutModal() {
    workoutModalOverlay.hidden = true;
    editingWorkoutId = null;
  }

  function handleWorkoutFormSubmit(e) {
    e.preventDefault();

    var weight = parseFloat(workoutWeightInput.value);
    var reps = parseInt(workoutRepsInput.value, 10);
    var sets = parseInt(workoutSetsInput.value, 10);
    var exercise = workoutExerciseInput.value.trim();

    if (!exercise || isNaN(weight) || isNaN(reps) || isNaN(sets)) return;

    if (editingWorkoutId) {
      var target = state.workouts.find(function (w) {
        return w.id === editingWorkoutId;
      });
      if (target) {
        target.date = workoutDateInput.value;
        target.part = workoutPartInput.value;
        target.exercise = exercise;
        target.weight = weight;
        target.reps = reps;
        target.sets = sets;
        target.memo = workoutMemoInput.value.trim();
      }
    } else {
      state.workouts.push({
        id: uid(),
        date: workoutDateInput.value,
        part: workoutPartInput.value,
        exercise: exercise,
        weight: weight,
        reps: reps,
        sets: sets,
        memo: workoutMemoInput.value.trim(),
        createdAt: Date.now()
      });
    }

    saveState();
    renderAll();
    closeWorkoutModal();
  }

  function handleWorkoutDelete() {
    if (!editingWorkoutId) return;
    if (!confirm("この記録を削除しますか？")) return;
    state.workouts = state.workouts.filter(function (w) {
      return w.id !== editingWorkoutId;
    });
    saveState();
    renderAll();
    closeWorkoutModal();
  }

  // ---------- 体重記録モーダル ----------

  function openWeightModal(weightEntry) {
    editingWeightId = weightEntry ? weightEntry.id : null;
    weightModalTitle.textContent = weightEntry ? "体重記録を編集" : "体重を記録";
    weightDeleteBtn.hidden = !weightEntry;

    weightDateInput.value = weightEntry ? weightEntry.date : todayStr();
    weightValueInput.value = weightEntry ? weightEntry.value : "";

    weightModalOverlay.hidden = false;
    weightValueInput.focus();
  }

  function closeWeightModal() {
    weightModalOverlay.hidden = true;
    editingWeightId = null;
  }

  function handleWeightFormSubmit(e) {
    e.preventDefault();

    var value = parseFloat(weightValueInput.value);
    if (isNaN(value)) return;

    if (editingWeightId) {
      var target = state.weights.find(function (w) {
        return w.id === editingWeightId;
      });
      if (target) {
        target.date = weightDateInput.value;
        target.value = value;
      }
    } else {
      state.weights.push({
        id: uid(),
        date: weightDateInput.value,
        value: value,
        createdAt: Date.now()
      });
    }

    saveState();
    renderAll();
    closeWeightModal();
  }

  function handleWeightDelete() {
    if (!editingWeightId) return;
    if (!confirm("この体重記録を削除しますか？")) return;
    state.weights = state.weights.filter(function (w) {
      return w.id !== editingWeightId;
    });
    saveState();
    renderAll();
    closeWeightModal();
  }

  // ---------- イベント登録 ----------

  addWorkoutBtn.addEventListener("click", function () {
    openWorkoutModal(null);
  });
  workoutCancelBtn.addEventListener("click", closeWorkoutModal);
  workoutForm.addEventListener("submit", handleWorkoutFormSubmit);
  workoutDeleteBtn.addEventListener("click", handleWorkoutDelete);
  workoutModalOverlay.addEventListener("click", function (e) {
    if (e.target === workoutModalOverlay) closeWorkoutModal();
  });
  workoutPartInput.addEventListener("change", function () {
    workoutExerciseInput.value = "";
    populateExerciseOptionsForPart(workoutPartInput.value);
    updatePrevRecordHint();
  });
  workoutExerciseInput.addEventListener("input", function () {
    renderExerciseSuggestions(workoutExerciseInput.value);
    updatePrevRecordHint();
  });
  workoutExerciseInput.addEventListener("focus", function () {
    renderExerciseSuggestions(workoutExerciseInput.value);
  });
  workoutExerciseInput.addEventListener("blur", hideExerciseSuggestions);
  // mousedownでpreventDefaultすることで、候補クリック時に先にblurが発火して
  // 候補リストが消えてしまうのを防ぐ
  exerciseSuggestionsEl.addEventListener("mousedown", function (e) {
    var item = e.target.closest(".exercise-suggestion-item");
    if (!item) return;
    e.preventDefault();
    workoutExerciseInput.value = item.getAttribute("data-value");
    hideExerciseSuggestions();
    updatePrevRecordHint();
  });

  addWeightBtn.addEventListener("click", function () {
    openWeightModal(null);
  });
  weightCancelBtn.addEventListener("click", closeWeightModal);
  weightForm.addEventListener("submit", handleWeightFormSubmit);
  weightDeleteBtn.addEventListener("click", handleWeightDelete);
  weightModalOverlay.addEventListener("click", function (e) {
    if (e.target === weightModalOverlay) closeWeightModal();
  });

  workoutFeedEl.addEventListener("click", function (e) {
    var row = e.target.closest(".exercise-row");
    if (!row) return;
    var workout = state.workouts.find(function (w) {
      return w.id === row.getAttribute("data-id");
    });
    if (workout) openWorkoutModal(workout);
  });

  weightListEl.addEventListener("click", function (e) {
    var row = e.target.closest(".weight-row");
    if (!row) return;
    var weightEntry = state.weights.find(function (w) {
      return w.id === row.getAttribute("data-id");
    });
    if (weightEntry) openWeightModal(weightEntry);
  });

  partFilterEl.addEventListener("change", renderWorkoutFeed);

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!workoutModalOverlay.hidden) closeWorkoutModal();
    if (!weightModalOverlay.hidden) closeWeightModal();
  });

  // ---------- 初期化 ----------

  loadState();
  renderAll();
})();
