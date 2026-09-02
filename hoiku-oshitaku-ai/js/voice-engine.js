/* 保育園おしたくAI — 音声まわり
 *
 * 現状はブラウザ標準の Web Speech API（音声認識・音声合成）と、
 * キーワード一致による簡易な返答判定・雑談応答（モックAI）で動いている。
 *
 * 将来 本物のAI音声対話（LLM + 高品質TTS）に差し替えるときは、
 * AI_CONFIG.endpoint に自前のバックエンド（APIキーはサーバー側で保持）を設定し、
 * interpretAnswer / craftOfftopicAck / speak をそのエンドポイント呼び出しに
 * 置き換えれば、呼び出し側（app.js）は変更不要な設計にしてある。
 * ※ APIキーなどの秘密情報はこのファイル/クライアント側には絶対に書かないこと。
 */
(function (global) {
  'use strict';

  var AI_CONFIG = {
    provider: 'mock', // 'mock' | 'remote'（本物のAIに接続する場合はここを差し替える）
    endpoint: null // 例: 'https://your-backend.example.com/api/oshitaku' （APIキーはサーバー側で保持）
  };

  var DONE_WORDS = ['できた', '出来た', 'できたよ', 'できたー', 'おわった', '終わった', 'はい', 'うん', 'やった', 'よし', 'ok', 'オッケー'];
  var WAIT_WORDS = ['まだ', 'あとで', 'ちょっとまって', 'ちょっと待って', 'むり', '無理', 'いや', 'できてない'];
  var UNSURE_WORDS = ['わからない', 'わかんない', 'どこ', 'なに', '何', 'どうやって'];

  // 想定外の発話（雑談・脱線）に、否定せずひとこと相槌を返すためのパターン。
  // 内容そのものに正確に答えるわけではないが、無視せず受け止めてから
  // ミッションへ話を戻す「会話のキャッチボール感」を出すためのモック。
  var OFFTOPIC_PATTERNS = [
    { test: ['なんさい', '何歳', 'いくつ'], replies: ['ふふ、それはひみつ♪ でも元気いっぱいのお姉さんだよ！'] },
    { test: ['アイス', 'おかし', 'お菓子', 'ケーキ', 'たべた', '食べた'], replies: ['いいなあ、おいしそう！'] },
    { test: ['ちゃんが', 'くんが', 'せんせいが', 'せんせい', '先生'], replies: ['そうなんだ！'] },
    { test: ['きょう', '今日', 'なにする', '何する', '保育園で'], replies: ['なにするのか、たのしみだね！'] },
    { test: ['ねむい', '眠い'], replies: ['ねむいね、わかるよ。'] },
    { test: ['きらい', '嫌い', 'やだ'], replies: ['そっか、そうだよね。'] }
  ];
  var OFFTOPIC_DEFAULT_REPLIES = ['そうなんだね！', 'うんうん、そうなんだ！', 'なるほどね！', 'そっかそっか！'];

  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[\s、。！!？?,.]/g, '');
  }

  function includesAny(text, words) {
    for (var i = 0; i < words.length; i++) {
      if (text.indexOf(words[i]) !== -1) return true;
    }
    return false;
  }

  function randomPick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  // モックAI: 発話内容から できた/まだ/わからない を推定する。
  // 本物のAIに差し替える場合は、ここを AI_CONFIG.endpoint への fetch に変更する。
  function interpretAnswer(transcript) {
    var text = normalize(transcript);
    if (!text) return null;
    if (includesAny(text, DONE_WORDS)) return 'done';
    if (includesAny(text, UNSURE_WORDS)) return 'unsure';
    if (includesAny(text, WAIT_WORDS)) return 'wait';
    return null;
  }

  // interpretAnswer が null を返した（＝ミッションへの返事と認識できなかった）ときに、
  // 「ちゃんと聞いているよ」という短い相槌を作る。本物のAIに差し替える場合は、
  // ここを会話文脈つきのLLM呼び出しに置き換える。
  function craftOfftopicAck(transcript) {
    var text = normalize(transcript);
    for (var i = 0; i < OFFTOPIC_PATTERNS.length; i++) {
      if (includesAny(text, OFFTOPIC_PATTERNS[i].test)) {
        return randomPick(OFFTOPIC_PATTERNS[i].replies);
      }
    }
    return randomPick(OFFTOPIC_DEFAULT_REPLIES);
  }

  var SpeechRecognitionAPI = global.SpeechRecognition || global.webkitSpeechRecognition || null;

  // マイク入力を1回ぶんだけ認識する。非対応/失敗時も例外を投げず onError で通知する。
  function listenOnce(onResult, onError) {
    if (!SpeechRecognitionAPI) {
      onError('unsupported');
      return null;
    }
    var recognizer;
    try {
      recognizer = new SpeechRecognitionAPI();
    } catch (err) {
      onError('unsupported');
      return null;
    }
    recognizer.lang = 'ja-JP';
    recognizer.continuous = false;
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 1;

    var settled = false;

    recognizer.onresult = function (event) {
      settled = true;
      try {
        var transcript = event.results[0][0].transcript;
        onResult(transcript);
      } catch (err) {
        onError('parse-error');
      }
    };
    recognizer.onerror = function () {
      if (settled) return;
      settled = true;
      onError('recognition-error');
    };
    recognizer.onend = function () {
      if (settled) return;
      settled = true;
      onError('no-speech');
    };

    try {
      recognizer.start();
    } catch (err) {
      onError('start-failed');
      return null;
    }
    return recognizer;
  }

  // 「優しいお姉さん」らしい女性の声を選ぶための簡易スコアリング。
  // Web Speech API には性別の標準プロパティが無いため、主要ブラウザ/OSの
  // 日本語音声名に含まれがちなキーワードで推測する（見つからなければ先頭のja音声）。
  var FEMALE_VOICE_HINTS = ['female', '女性', 'kyoko', 'o-ren', 'ayumi', 'nanami', 'haruka', 'sayaka', 'mei', 'yui', 'sakura'];
  var MALE_VOICE_HINTS = ['male', '男性', 'ichiro', 'otoya', 'hattori', 'takumi'];

  function scoreVoice(voice) {
    var name = (voice.name || '').toLowerCase();
    var score = 0;
    FEMALE_VOICE_HINTS.forEach(function (hint) {
      if (name.indexOf(hint) !== -1) score += 3;
    });
    MALE_VOICE_HINTS.forEach(function (hint) {
      if (name.indexOf(hint) !== -1) score -= 3;
    });
    if (name.indexOf('google') !== -1) score += 1;
    if (voice.localService) score += 1;
    return score;
  }

  var cachedVoice = null;
  function pickJapaneseVoice() {
    if (!global.speechSynthesis) return null;
    if (cachedVoice) return cachedVoice;
    var voices = (global.speechSynthesis.getVoices() || []).filter(function (v) {
      return v.lang && v.lang.indexOf('ja') === 0;
    });
    if (!voices.length) return null;
    voices.sort(function (a, b) {
      return scoreVoice(b) - scoreVoice(a);
    });
    cachedVoice = voices[0];
    return cachedVoice;
  }

  // AIのお姉さんのセリフを読み上げる。非対応ブラウザでも吹き出し表示だけで進行できる。
  function speak(text, opts) {
    opts = opts || {};
    if (!global.speechSynthesis || !global.SpeechSynthesisUtterance) {
      if (opts.onStart) opts.onStart();
      if (opts.onEnd) opts.onEnd();
      return;
    }
    try {
      global.speechSynthesis.cancel();
      var utter = new global.SpeechSynthesisUtterance(text);
      utter.lang = 'ja-JP';
      utter.pitch = 1.1; // すこし高めで明るい「お姉さん」らしいトーン
      utter.rate = 0.93; // 幼児にも聞き取りやすいよう、少しゆっくりめ
      var voice = pickJapaneseVoice();
      if (voice) utter.voice = voice;
      if (opts.onStart) utter.onstart = opts.onStart;
      if (opts.onEnd) {
        utter.onend = opts.onEnd;
        utter.onerror = opts.onEnd;
      }
      global.speechSynthesis.speak(utter);
    } catch (err) {
      if (opts.onStart) opts.onStart();
      if (opts.onEnd) opts.onEnd();
    }
  }

  if (global.speechSynthesis && global.speechSynthesis.onvoiceschanged !== undefined) {
    global.speechSynthesis.onvoiceschanged = function () {
      cachedVoice = null;
    };
  }

  global.HoikuVoice = {
    AI_CONFIG: AI_CONFIG,
    isRecognitionSupported: !!SpeechRecognitionAPI,
    interpretAnswer: interpretAnswer,
    craftOfftopicAck: craftOfftopicAck,
    listenOnce: listenOnce,
    speak: speak
  };
})(window);
