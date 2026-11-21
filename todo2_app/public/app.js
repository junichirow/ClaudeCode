// 全ページ共通の小さなスクリプト

// ホーム画面のアプリとして入れられるよう Service Worker を登録する
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";

// 削除などは確認してから送る
document.addEventListener("submit", (event) => {
  const form = event.target;
  const message = form.dataset.confirm;
  if (message && !confirm(message)) {
    event.preventDefault();
  }
});

// タスクのタップで完了／未完了を切り替える。画面を読み直さずにその場で二重線を付け外しする。
// JS が動かないときは普通のフォーム送信になる
function updateProgress(doneCount, total) {
  const el = document.querySelector("[data-progress]");
  if (el) el.textContent = `${doneCount} / ${total}`;
}

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!form.classList.contains("toggle-form") || event.defaultPrevented) return;
  event.preventDefault();

  const item = form.closest(".task");
  const button = form.querySelector(".task-toggle");
  const done = item.classList.toggle("done");
  button.setAttribute("aria-pressed", String(done));

  try {
    const res = await fetch(form.action, {
      method: "POST",
      headers: { Accept: "application/json", "X-CSRFToken": csrfToken },
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    // 家族が同時に押したときなどに備えて、サーバーの状態に合わせる
    item.classList.toggle("done", data.done);
    button.setAttribute("aria-pressed", String(data.done));
    updateProgress(data.done_count, data.total);
  } catch (e) {
    item.classList.toggle("done", !done);
    button.setAttribute("aria-pressed", String(!done));
    alert("保存できませんでした。通信を確認してもう一度押してください。");
  }
});

// 二度押しで同じタスクが 2 つできないよう、追加などの送信ボタンは 1 回押したら無効にする
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (event.defaultPrevented || form.classList.contains("toggle-form")) return;
  if (form.dataset.sent) {
    event.preventDefault();
    return;
  }
  form.dataset.sent = "1";
  form.querySelectorAll("button[type=submit]").forEach((b) => (b.disabled = true));
});

// ホーム画面のアプリはしばらく裏にいたあと戻ってきても読み直さないので、
// 1 分以上たっていたら読み直して家族の変更を反映する（入力途中のときはしない）
let hiddenAt = null;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }
  const typing = [...document.querySelectorAll("textarea, input[type=text]")].some(
    (el) => el.value && el.value !== el.defaultValue
  );
  if (hiddenAt && Date.now() - hiddenAt > 60 * 1000 && !typing) {
    location.reload();
  }
});

// 戻るボタンでキャッシュから表示されたとき（bfcache）は、送信済みの印を消して押せるようにする
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    document.querySelectorAll("form[data-sent]").forEach((form) => {
      delete form.dataset.sent;
      form.querySelectorAll("button[type=submit]").forEach((b) => (b.disabled = false));
    });
  }
});
