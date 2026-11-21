// ホーム画面のアプリとして動かすための Service Worker を登録する（sw.js）。
// ログインしていない画面（ログアウト直後など）では、保存しておいた画面を消す
// （同じ端末で別の人がログインしても、前の人のセットリストが見えないように）。
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
if (document.body.dataset.loggedIn !== "1" && "caches" in window) {
  caches.delete("setlist-pages").catch(() => {});
}
