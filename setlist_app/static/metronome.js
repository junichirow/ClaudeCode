// セットリストのライブ表示：曲名をタップすると、その曲のテンポで赤い点が 16 回光る。
// もう一度タップで停止、別の曲をタップするとその曲に切り替わる。音は鳴らさない。
(function () {
  "use strict";

  var BEATS = 16;       // 光る回数
  var FLASH_MS = 120;   // 1 回の光っている長さ（テンポが速いときは拍の半分まで）

  var current = null;   // { button, dot, interval, flashMs, start, frame }
  var wakeLock = null;

  // 点滅中は画面が暗くならないようにする（対応していないブラウザでは何もしない）
  function keepScreenOn() {
    if (!("wakeLock" in navigator) || wakeLock) return;
    navigator.wakeLock.request("screen").then(function (lock) {
      wakeLock = lock;
      lock.addEventListener("release", function () { wakeLock = null; });
    }).catch(function () {});
  }

  function allowScreenOff() {
    if (wakeLock) wakeLock.release().catch(function () {});
    wakeLock = null;
  }

  function stop() {
    if (!current) return;
    cancelAnimationFrame(current.frame);
    current.dot.classList.remove("beat-on");
    current.button.setAttribute("aria-pressed", "false");
    current = null;
    allowScreenOff();
  }

  // 一定間隔のタイマーではなく、開始からの経過時間で拍を計算するので、続けてもずれない
  function tick(now) {
    var elapsed = now - current.start;
    var beat = Math.floor(elapsed / current.interval);
    if (beat >= BEATS) {
      stop();
      return;
    }
    var on = elapsed - beat * current.interval < current.flashMs;
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
      start: performance.now(),
      frame: 0,
    };
    button.setAttribute("aria-pressed", "true");
    keepScreenOn();
    current.frame = requestAnimationFrame(tick);
  }

  document.addEventListener("click", function (event) {
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
