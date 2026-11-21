// ホーム画面のアプリとして入れられるようにするための Service Worker。
// - CSS・JS・アイコン（/static/）はキャッシュから速く出し、裏で新しいものに入れ替える
// - 画面（HTML）はネットから取り、取れたものを保存しておく。ライブ会場で電波が弱い・つながらないときは
//   保存しておいた画面を出す（一度開いたセットリストはオフラインでも見られる）
// - ログアウトすると pwa.js が画面の保存分を消す
const STATIC_CACHE = "setlist-static-v1";
const PAGE_CACHE = "setlist-pages";
const ASSETS = [
  "/static/style.css",
  "/static/submit-once.js",
  "/static/metronome.js",
  "/static/keep-awake.js",
  "/static/pwa.js",
  "/static/icons/icon-192.png",
];
// これ以上待ってもネットから返ってこなければ、保存しておいた画面を出す
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== PAGE_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

const OFFLINE_HTML = `<!doctype html><html lang="ja"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>オフライン</title>
<body style="font-family:sans-serif;padding:2rem;text-align:center;background:#111418;color:#f0f3f6">
<p>インターネットに接続されていません。</p>
<p>この画面はまだ一度も開いていないため、保存されていません。</p>
<p><button onclick="location.reload()" style="font-size:1rem;padding:0.5rem 1rem">再読み込み</button></p></body></html>`;

function fetchWithTimeout(req) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS);
    fetch(req).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

async function handleNavigation(req) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const res = await fetchWithTimeout(req);
    // ログイン画面へ飛ばされた結果などは保存しない（その URL の本来の画面ではないため）
    if (res.ok && !res.redirected) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    return cached || new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

async function handleStatic(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || fresh;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(handleNavigation(req));
  } else if (url.pathname.startsWith("/static/")) {
    event.respondWith(handleStatic(req));
  }
});
