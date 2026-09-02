/* 保育園おしたくAI — ミッションのカタログ
 * 1ミッション = 1パズルピース。並び順と ON/OFF は設定画面から変更でき、
 * 実際に使う一覧は settings.missions (id と enabled のみ) が持つ。
 */
(function (global) {
  'use strict';

  var MISSION_CATALOG = [
    {
      id: 'ohayou',
      icon: '🌞',
      label: 'おはよう',
      prompt: function (name) {
        return name + 'おはよう！今日も保育園の日だよ。げんきにお返事できるかな？';
      },
      successReplies: ['おはよう！げんきいっぱいだね！', 'いいお返事！今日もいい一日になりそう！'],
      waitReplies: ['ねむいかな？ゆっくりでいいよ。', 'だいじょうぶ、あわてなくていいよ。'],
      hint: '「おはよう！」ってげんきにお返事してみようね。'
    },
    {
      id: 'toilet',
      icon: '🚽',
      label: 'トイレ',
      prompt: function () {
        return 'つぎは トイレ に行っておこう！行けそうかな？';
      },
      successReplies: ['すっきりしたね！', 'よくできました！'],
      waitReplies: ['じゃあ先に行ってきてね、待ってるよ。'],
      hint: '保育園に行くまえに、トイレに行っておこうね。'
    },
    {
      id: 'clothes',
      icon: '👕',
      label: '着替え',
      prompt: function () {
        return '次は お着替え だよ！お洋服に着替えられるかな？';
      },
      successReplies: ['わぁ、すてき！かっこいいね！', 'お着替えできたね、すごい！'],
      waitReplies: ['ゆっくりでいいよ、お着替えしてみよう。'],
      hint: 'パジャマをぬいで、お洋服に着替えてみようね。'
    },
    {
      id: 'socks',
      icon: '🧦',
      label: '靴下',
      prompt: function () {
        return '靴下は履けそうかな？';
      },
      successReplies: ['靴下ばっちり！', 'じょうずに履けたね！'],
      waitReplies: ['片足ずつ、ゆっくりでいいよ。'],
      hint: '靴下を両足はいてみようね。'
    },
    {
      id: 'breakfast',
      icon: '🍚',
      label: '朝ごはん',
      prompt: function () {
        return '朝ごはんは食べられそう？';
      },
      successReplies: ['もりもり食べたね！', 'えらい！パワーが出るね！'],
      waitReplies: ['すこしずつでいいよ、食べてみようね。'],
      hint: '朝ごはんを食べて、パワーをつけようね。'
    },
    {
      id: 'water',
      icon: '💧',
      label: '水を飲む',
      prompt: function () {
        return 'お水はのめたかな？';
      },
      successReplies: ['ごくごく！えらいね！', '水分ばっちり！'],
      waitReplies: ['コップ一杯だけでも飲んでみようね。'],
      hint: 'コップにお水を入れて、飲んでみようね。'
    },
    {
      id: 'teeth',
      icon: '🦷',
      label: '歯みがき',
      prompt: function () {
        return '歯みがきはできそう？';
      },
      successReplies: ['ぴかぴかの歯だね！', '歯みがきじょうず！'],
      waitReplies: ['しゅっしゅって磨いてみようね。'],
      hint: '歯ブラシで歯をみがいてみようね。'
    },
    {
      id: 'bottle',
      icon: '🍼',
      label: '水筒',
      prompt: function () {
        return '水筒はリュックに入れられるかな？';
      },
      successReplies: ['水筒ばっちり！', '忘れずに準備できたね！'],
      waitReplies: ['水筒を持ってきてみようね。'],
      hint: '水筒を用意して、リュックに入れてみようね。'
    },
    {
      id: 'notebook',
      icon: '📔',
      label: '連絡帳',
      prompt: function () {
        return '連絡帳はカバンに入れたかな？';
      },
      successReplies: ['ばっちり準備できたね！', '忘れ物なしだね！'],
      waitReplies: ['連絡帳をさがしてみようね。'],
      hint: '連絡帳をカバンに入れてみようね。'
    },
    {
      id: 'hat',
      icon: '👒',
      label: '帽子',
      prompt: function () {
        return '帽子はかぶれるかな？';
      },
      successReplies: ['にあってるよ！', '帽子ばっちり！'],
      waitReplies: ['帽子をかぶってみようね。'],
      hint: '帽子をかぶってお出かけの準備をしようね。'
    },
    {
      id: 'backpack',
      icon: '🎒',
      label: 'リュック',
      prompt: function () {
        return 'リュックはしょえるかな？';
      },
      successReplies: ['準備万端だね！', 'リュックしょえたね、かっこいい！'],
      waitReplies: ['リュックを背負ってみようね。'],
      hint: 'リュックを背中にしょってみようね。'
    },
    {
      id: 'shoes',
      icon: '👟',
      label: '靴を履く',
      prompt: function () {
        return '最後に靴を履こう！履けるかな？';
      },
      successReplies: ['靴もばっちり！', 'あと少しだよ！'],
      waitReplies: ['靴を履いてみようね。'],
      hint: '玄関で靴を履いてみようね。'
    },
    {
      id: 'departure',
      icon: '🚪',
      label: '出発',
      prompt: function () {
        return 'さあ、出発できそうかな？';
      },
      successReplies: ['やったー！出発だね！'],
      waitReplies: ['忘れ物ないか、もう一回見てみようね。'],
      hint: '忘れ物がないか確認して、出発しようね。'
    }
  ];

  function getMissionById(id) {
    for (var i = 0; i < MISSION_CATALOG.length; i++) {
      if (MISSION_CATALOG[i].id === id) return MISSION_CATALOG[i];
    }
    return null;
  }

  global.HoikuData = {
    MISSION_CATALOG: MISSION_CATALOG,
    getMissionById: getMissionById
  };
})(window);
