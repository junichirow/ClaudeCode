// セットリストのライブ表示：曲名をタップすると、その曲のテンポで赤い点が 16 回光る。
// 光るのと同時に「ピッ」とクリック音も鳴らす（Web Audio API）。
// もう一度タップで停止、別の曲をタップするとその曲に切り替わる。
// 「音あり／音なし」ボタン（.sound-toggle）で音だけを切り替えられる。選んだ状態はブラウザに覚えておく。
(function () {
  "use strict";

  var BEATS = 16;       // 光る回数
  var FLASH_MS = 120;   // 1 回の光っている長さ（テンポが速いときは拍の半分まで）
  var BEEP_HZ = 1000;   // クリック音の高さ（耳に刺さらず聞き取りやすい高さ）
  var BEEP_SEC = 0.06;  // クリック音の長さ
  var BEEP_VOLUME = 0.5;
  var LEAD_SEC = 0.05;  // 音を予約するための余裕。光り始めも同じだけ遅らせてそろえる

  var current = null;   // { button, dot, interval, flashMs, start, frame, beeps }
  var audio = null;     // AudioContext（最初のタップのときに作る）
  var SOUND_KEY = "metronome-sound";
  var soundOn = loadSoundSetting();

  // 前回選んだ音のオン／オフを読む（初めては「音あり」。保存できないブラウザでも動くようにする）
  function loadSoundSetting() {
    try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch (e) { return true; }
  }

  function saveSoundSetting() {
    try { localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off"); } catch (e) {}
  }

  function showSoundSetting() {
    document.querySelectorAll(".sound-toggle").forEach(function (button) {
      button.setAttribute("aria-pressed", soundOn ? "true" : "false");
      button.textContent = soundOn ? "🔊 音あり" : "🔇 音なし";
    });
  }

  // iPhone のマナーモード中でも音が出るようにする（Safari 17 以降。ほかでは何もしない）
  if (navigator.audioSession) {
    try { navigator.audioSession.type = "playback"; } catch (e) {}
  }

  // 音はタップの処理の中で準備しないと、スマホのブラウザでは鳴らない
  function getAudio() {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audio) audio = new AudioCtx();
    if (audio.state === "suspended") audio.resume();
    return audio;
  }

  // 「ピッ」を 1 回、指定した時刻に鳴らす予約をする。
  // 立ち上がりと消え際をなめらかにして、プツッというノイズを出さない
  function scheduleBeep(ctx, when) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = BEEP_HZ;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(BEEP_VOLUME, when + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, when + BEEP_SEC);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + BEEP_SEC + 0.01);
    return osc;
  }

  // まだ来ていない拍の音をまとめて予約する（音声側の時計で鳴るので、画面が重くてもずれない）。
  // 点滅の途中で「音あり」にしたときは、残りの拍だけが光と合わせて鳴る
  function scheduleBeeps(state) {
    if (!soundOn) return [];
    var ctx = getAudio();
    if (!ctx) return [];
    // 点滅の開始時刻（画面側の時計）を音声側の時計に置き換える
    var t0 = ctx.currentTime + (state.start - performance.now()) / 1000;
    var beeps = [];
    for (var i = 0; i < BEATS; i++) {
      var when = t0 + (i * state.interval) / 1000;
      if (when >= ctx.currentTime) beeps.push(scheduleBeep(ctx, when));
    }
    return beeps;
  }

  function cancelBeeps(beeps) {
    beeps.forEach(function (osc) {
      try { osc.stop(); } catch (e) {}
    });
  }

  function stop() {
    if (!current) return;
    cancelAnimationFrame(current.frame);
    cancelBeeps(current.beeps);
    current.dot.classList.remove("beat-on");
    current.button.setAttribute("aria-pressed", "false");
    current = null;
  }

  // 一定間隔のタイマーではなく、開始からの経過時間で拍を計算するので、続けてもずれない
  function tick(now) {
    var elapsed = now - current.start;
    var beat = Math.floor(elapsed / current.interval);
    if (beat >= BEATS) {
      stop();
      return;
    }
    var on = elapsed >= 0 && elapsed - beat * current.interval < current.flashMs;
    current.dot.classList.toggle("beat-on", on);
    current.frame = requestAnimationFrame(tick);
  }

  function start(button) {
    var bpm = Number(button.dataset.bpm);
    if (!(bpm > 0)) return;
    var interval = 60000 / bpm;
    current = {
      button: button,
      dot: button.querySelector(".beat-dot"),
      interval: interval,
      flashMs: Math.min(FLASH_MS, interval / 2),
      start: performance.now() + LEAD_SEC * 1000,
      frame: 0,
      beeps: [],
    };
    current.beeps = scheduleBeeps(current);
    button.setAttribute("aria-pressed", "true");
    current.frame = requestAnimationFrame(tick);
  }

  function toggleSound() {
    soundOn = !soundOn;
    saveSoundSetting();
    showSoundSetting();
    if (!current) return;
    cancelBeeps(current.beeps);
    current.beeps = scheduleBeeps(current);
  }

  showSoundSetting();

  document.addEventListener("click", function (event) {
    if (event.target.closest(".sound-toggle")) {
      toggleSound();
      return;
    }
    var button = event.target.closest(".beat-toggle");
    if (!button) return;
    var same = current && current.button === button;
    stop();
    if (!same) start(button);
  });

  // 別のアプリに切り替えたら止める（戻ったときに途中から光り出さないように）
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
  });
})();
