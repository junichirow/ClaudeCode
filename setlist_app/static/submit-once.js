// フォームの二重送信を防ぐ。
// 通信が遅いときに保存ボタンを2回押すと、同じ曲などが2つできてしまうため、
// 1回送信したらそのページでは同じフォームを送れないようにし、ボタンも押せなくする。
document.addEventListener("submit", (event) => {
  // confirm() でキャンセルされた送信は対象外
  if (event.defaultPrevented) return;
  const form = event.target;
  if (form.dataset.submitted) {
    event.preventDefault();
    return;
  }
  form.dataset.submitted = "1";
  // 送信内容が決まってからボタンを無効にする
  setTimeout(() => {
    form.querySelectorAll("button[type=submit], button:not([type])").forEach((button) => {
      button.disabled = true;
    });
  }, 0);
});

// ブラウザの「戻る」でページがキャッシュから表示されたときは、また送信できるようにする
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  document.querySelectorAll("form[data-submitted]").forEach((form) => {
    delete form.dataset.submitted;
    form.querySelectorAll("button:disabled").forEach((button) => {
      button.disabled = false;
    });
  });
});
