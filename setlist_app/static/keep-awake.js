// セットリストのライブ表示を開いている間は、画面が暗くならない（スリープしない）ようにする。
// Screen Wake Lock API を使う。対応していないブラウザでは何もしない。
(function () {
  "use strict";

  if (!("wakeLock" in navigator)) return;

  var lock = null;

  function request() {
    if (lock || document.hidden) return;
    navigator.wakeLock.request("screen").then(function (newLock) {
      lock = newLock;
      lock.addEventListener("release", function () { lock = null; });
    }).catch(function () {});
  }

  // 別のアプリに切り替えるとブラウザが自動で解除するので、戻ってきたらかけ直す
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) request();
  });

  // ブラウザによってはタップした後でないとかけられないので、タップのたびに確かめる
  document.addEventListener("click", request);
  document.addEventListener("touchend", request);

  request();
})();
