// ホーム画面のアプリとして入れられるようにするための Service Worker。
// CSS・JS・アイコンはキャッシュから速く出し、裏で新しいものに入れ替える。
// 画面（HTML）はいつもネットから取る（家族の変更をすぐ見るため）。つながらないときだけお知らせを出す。
const CACHE = "family-tasks-v2";
const ASSETS = ["/style.css", "/app.js", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

const OFFLINE_HTML = `<!doctype html><html lang="ja"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>オフライン</title>
<body style="font-family:sans-serif;padding:2rem;text-align:center">
<p>インターネットに接続されていません。</p>
<p><button onclick="location.reload()">再読み込み</button></p></body></html>`;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(
        () => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })
      )
    );
    return;
  }

  if (ASSETS.includes(url.pathname) || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || fresh;
      })
    );
  }
});
