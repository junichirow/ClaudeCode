// スターシューター：Canvas だけで動く縦スクロールシューティング
"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;
const HIGH_SCORE_KEY = "star-shooter-high-score";

// ---- 入力 ----
const keys = new Set();
window.addEventListener("keydown", (e) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) {
    e.preventDefault();
  }
  keys.add(e.key.toLowerCase());
  if (e.key === "Enter" || e.key === " ") onAction();
  if (e.key.toLowerCase() === "p" && state === "playing") paused = !paused;
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

// タッチ：指の位置に自機を寄せる（ショットは自動）
let touchX = null;
function canvasX(clientX) {
  const rect = canvas.getBoundingClientRect();
  return ((clientX - rect.left) / rect.width) * W;
}
canvas.addEventListener("pointerdown", (e) => {
  touchX = canvasX(e.clientX);
  onAction();
});
canvas.addEventListener("pointermove", (e) => {
  if (touchX !== null) touchX = canvasX(e.clientX);
});
window.addEventListener("pointerup", () => (touchX = null));

// ---- ゲーム状態 ----
let state = "title"; // title | playing | gameover
let paused = false;
let player, bullets, enemies, enemyBullets, stars;
let particles = []; // タイトル画面でも更新されるので最初から空配列にしておく
let score, lives, level, spawnTimer, shotCooldown, invincible, frame;
let boss, bossCount, nextBossScore, warningTimer;
const BOSS_INTERVAL = 3000; // この点数ごとにサメのボスが出る
let highScore = Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;

let gameOverAt = 0;
function onAction() {
  // ゲームオーバー直後は誤操作で即リトライしないよう 1 秒待つ
  if (state === "title" || (state === "gameover" && performance.now() - gameOverAt > 1000)) {
    startGame();
  }
}

function startGame() {
  player = { x: W / 2, y: H - 70, w: 30, h: 30, speed: 5 };
  bullets = [];
  enemies = [];
  enemyBullets = [];
  particles = [];
  score = 0;
  lives = 3;
  level = 1;
  spawnTimer = 0;
  shotCooldown = 0;
  invincible = 0;
  frame = 0;
  boss = null;
  bossCount = 0;
  nextBossScore = BOSS_INTERVAL;
  warningTimer = 0;
  paused = false;
  state = "playing";
}

// ---- ボス（サメ） ----
function spawnBoss() {
  bossCount++;
  const hp = 50 + bossCount * 20;
  boss = { x: W / 2, y: -80, vx: 1.5 + bossCount * 0.3, hp, maxHp: hp, t: 0, flash: 0 };
  warningTimer = 120;
}

function updateBoss() {
  const b = boss;
  b.t++;
  if (b.flash > 0) b.flash--;
  if (b.y < 120) {
    b.y += 1.5; // 登場中は降りてくるだけ
    return;
  }
  // 左右に泳ぎ、上下にゆらゆら
  b.x += b.vx;
  if (b.x < 80 || b.x > W - 80) b.vx *= -1;
  b.y = 120 + Math.sin(b.t / 40) * 20;

  // 扇状の弾
  if (b.t % 90 === 0) {
    for (let i = -3; i <= 3; i++) {
      const a = Math.PI / 2 + i * 0.22;
      enemyBullets.push({ x: b.x, y: b.y + 20, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3 });
    }
  }
  // 口から自機狙いの弾
  if (b.t % 35 === 0) {
    const mx = b.x + Math.sign(b.vx) * 50;
    const a = Math.atan2(player.y - b.y, player.x - mx);
    enemyBullets.push({ x: mx, y: b.y + 8, vx: Math.cos(a) * 4.5, vy: Math.sin(a) * 4.5 });
  }
}

// サメの胴体はおおよそ横長の楕円なので、楕円で当たり判定する
function hitBoss(x, y, r) {
  const dx = (x - boss.x) / (60 + r);
  const dy = (y - boss.y) / (24 + r);
  return dx * dx + dy * dy < 1;
}

function defeatBoss() {
  score += 3000;
  for (let i = 0; i < 5; i++) {
    explode(boss.x + rand(-50, 50), boss.y + rand(-20, 20), i % 2 ? "#9ec5e8" : "#ffffff", 30);
  }
  enemyBullets = [];
  boss = null;
  nextBossScore = score + BOSS_INTERVAL;
}

stars = Array.from({ length: 80 }, () => ({
  x: Math.random() * W,
  y: Math.random() * H,
  speed: 0.5 + Math.random() * 2,
}));

// ---- 敵の生成 ----
function spawnEnemy() {
  const r = Math.random();
  if (r < 0.15 && level >= 3) {
    // 大型：硬くてよく撃ってくる
    enemies.push({ type: "big", x: rand(40, W - 40), y: -40, r: 26, hp: 6, vy: 0.8, vx: 0, t: 0, points: 300 });
  } else if (r < 0.45 && level >= 2) {
    // ジグザグ
    enemies.push({ type: "zig", x: rand(40, W - 40), y: -20, r: 14, hp: 1, vy: 2, vx: 0, t: 0, points: 150 });
  } else {
    // 通常
    enemies.push({ type: "basic", x: rand(20, W - 20), y: -20, r: 15, hp: 1, vy: 1.5 + level * 0.2, vx: 0, t: 0, points: 100 });
  }
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function explode(x, y, color, count = 16) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = rand(1, 4);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(20, 40), color });
  }
}

function hit(ax, ay, ar, bx, by, br) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy < (ar + br) * (ar + br);
}

// ---- 更新 ----
function update() {
  for (const s of stars) {
    s.y += s.speed;
    if (s.y > H) {
      s.y = 0;
      s.x = Math.random() * W;
    }
  }
  updateParticles();
  if (state !== "playing" || paused) return;

  frame++;
  level = 1 + Math.floor(score / 1500);

  // 自機の移動
  if (keys.has("arrowleft") || keys.has("a")) player.x -= player.speed;
  if (keys.has("arrowright") || keys.has("d")) player.x += player.speed;
  if (keys.has("arrowup") || keys.has("w")) player.y -= player.speed;
  if (keys.has("arrowdown") || keys.has("s")) player.y += player.speed;
  if (touchX !== null) player.x += Math.max(-8, Math.min(8, touchX - player.x));
  player.x = Math.max(player.w / 2, Math.min(W - player.w / 2, player.x));
  player.y = Math.max(H / 2, Math.min(H - player.h, player.y));

  // ショット（スペース長押し / タッチ中は自動連射）
  if (shotCooldown > 0) shotCooldown--;
  if ((keys.has(" ") || touchX !== null) && shotCooldown === 0) {
    bullets.push({ x: player.x - 8, y: player.y - 10 });
    bullets.push({ x: player.x + 8, y: player.y - 10 });
    shotCooldown = 9;
  }
  for (const b of bullets) b.y -= 9;
  bullets = bullets.filter((b) => b.y > -10);

  // 敵の出現（レベルが上がるほど間隔が短くなる）
  // ボス戦中は雑魚の出現を止める
  if (!boss && score >= nextBossScore) spawnBoss();
  if (warningTimer > 0) warningTimer--;
  spawnTimer--;
  if (!boss && spawnTimer <= 0) {
    spawnEnemy();
    spawnTimer = Math.max(15, 60 - level * 6);
  }
  if (boss) updateBoss();

  // 敵の移動と攻撃
  for (const e of enemies) {
    e.t++;
    if (e.type === "zig") e.vx = Math.sin(e.t / 15) * 3;
    e.x += e.vx;
    e.y += e.vy;
    const fireRate = e.type === "big" ? 50 : 140 - Math.min(level * 10, 80);
    if (e.y > 0 && e.y < H * 0.7 && Math.random() < 1 / fireRate) {
      const a = Math.atan2(player.y - e.y, player.x - e.x);
      const sp = 3 + level * 0.2;
      enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp });
    }
  }

  // 自弾と敵の当たり判定
  for (const b of bullets) {
    for (const e of enemies) {
      if (e.hp > 0 && hit(b.x, b.y, 3, e.x, e.y, e.r)) {
        e.hp--;
        b.y = -100; // 弾を消す
        if (e.hp <= 0) {
          score += e.points;
          explode(e.x, e.y, e.type === "big" ? "#ff9f1c" : "#ff4d6d", e.type === "big" ? 40 : 16);
        } else {
          explode(b.x, b.y, "#fff", 3);
        }
        break;
      }
    }
  }
  enemies = enemies.filter((e) => e.hp > 0 && e.y < H + 50);

  if (boss && boss.y > 0) {
    for (const b of bullets) {
      if (b.y > 0 && hitBoss(b.x, b.y, 3)) {
        explode(b.x, b.y, "#fff", 2);
        b.y = -100;
        boss.hp--;
        boss.flash = 4;
        if (boss.hp <= 0) {
          defeatBoss();
          break;
        }
      }
    }
  }
  bullets = bullets.filter((b) => b.y > -10);

  for (const b of enemyBullets) {
    b.x += b.vx;
    b.y += b.vy;
  }
  enemyBullets = enemyBullets.filter((b) => b.x > -10 && b.x < W + 10 && b.y > -10 && b.y < H + 10);

  // 自機の被弾
  if (invincible > 0) {
    invincible--;
  } else {
    const hitBullet = enemyBullets.find((b) => hit(b.x, b.y, 4, player.x, player.y, 10));
    const hitEnemy = enemies.find((e) => hit(e.x, e.y, e.r, player.x, player.y, 12));
    const hitShark = boss && hitBoss(player.x, player.y, 10);
    if (hitBullet || hitEnemy || hitShark) {
      if (hitBullet) hitBullet.y = H + 100;
      if (hitEnemy) hitEnemy.hp = 0;
      damage();
    }
  }
}

function damage() {
  lives--;
  explode(player.x, player.y, "#4cc9f0", 30);
  invincible = 120;
  enemyBullets = [];
  if (lives <= 0) {
    state = "gameover";
    gameOverAt = performance.now();
    if (score > highScore) {
      highScore = score;
      localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
    }
  }
}

function updateParticles() {
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.96;
    p.vy *= 0.96;
    p.life--;
  }
  particles = particles.filter((p) => p.life > 0);
}

// ---- 描画 ----
function draw() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  for (const s of stars) {
    ctx.fillStyle = `rgba(255,255,255,${s.speed / 2.5})`;
    ctx.fillRect(s.x, s.y, 2, 2);
  }

  if (state === "title") {
    drawCenterText("スターシューター", 40, H / 2 - 60, "#4cc9f0");
    drawCenterText("クリック / Enter でスタート", 18, H / 2 + 10);
    drawCenterText(`ハイスコア ${highScore}`, 16, H / 2 + 50, "#ffd166");
    return;
  }

  for (const p of particles) {
    ctx.globalAlpha = p.life / 40;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 3, 3);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#fff275";
  for (const b of bullets) ctx.fillRect(b.x - 2, b.y - 8, 4, 12);

  for (const e of enemies) drawEnemy(e);
  if (boss) drawShark(boss);

  ctx.fillStyle = "#ff5c8a";
  for (const b of enemyBullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  if (state === "playing" && (invincible === 0 || Math.floor(invincible / 5) % 2 === 0)) {
    drawPlayer();
  }

  // HUD
  ctx.fillStyle = "#fff";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`スコア ${score}`, 10, 24);
  ctx.fillText(`レベル ${level}`, 10, 46);
  ctx.textAlign = "right";
  ctx.fillText(`ハイスコア ${Math.max(highScore, score)}`, W - 10, 24);
  ctx.fillText("♥".repeat(Math.max(lives, 0)), W - 10, 46);

  if (boss) {
    // ボスの体力ゲージ
    ctx.fillStyle = "#333";
    ctx.fillRect(W / 2 - 100, 60, 200, 8);
    ctx.fillStyle = "#4cc9f0";
    ctx.fillRect(W / 2 - 100, 60, (200 * boss.hp) / boss.maxHp, 8);
  }
  if (warningTimer > 0 && Math.floor(warningTimer / 15) % 2 === 0) {
    drawCenterText("⚠ サメが来る！", 30, H / 2, "#ff4d6d");
  }

  if (paused) drawCenterText("一時停止中（P で再開）", 22, H / 2);

  if (state === "gameover") {
    drawCenterText("ゲームオーバー", 40, H / 2 - 40, "#ff4d6d");
    drawCenterText(`スコア ${score}`, 22, H / 2 + 10);
    drawCenterText("クリック / Enter でリトライ", 16, H / 2 + 50);
  }
}

function circle(x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function oval(x, y, rx, ry, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

// 自機：クマのぬいぐるみ
function drawPlayer() {
  const { x, y } = player;
  const fur = "#b07a4f";
  const light = "#f1d9b5";

  // 足元のキラキラ（推進力のイメージ）
  circle(x - 5, y + 24 + (frame % 4), 2, frame % 6 < 3 ? "#ffd166" : "#fff");
  circle(x + 5, y + 24 + ((frame + 2) % 4), 2, frame % 6 < 3 ? "#fff" : "#ffd166");

  // 体・手足
  oval(x, y + 14, 10, 9, fur);
  circle(x - 11, y + 11, 4, fur); // 左手
  circle(x + 11, y + 11, 4, fur); // 右手
  circle(x - 6, y + 21, 4, fur); // 左足
  circle(x + 6, y + 21, 4, fur); // 右足
  oval(x, y + 15, 5, 5, light); // おなか

  // 耳
  circle(x - 10, y - 12, 6, fur);
  circle(x + 10, y - 12, 6, fur);
  circle(x - 10, y - 12, 3, "#f4a6a6");
  circle(x + 10, y - 12, 3, "#f4a6a6");

  // 頭
  circle(x, y - 2, 13, fur);
  oval(x, y + 3, 6, 4.5, light); // 口まわり
  circle(x - 5, y - 4, 1.8, "#000"); // 目
  circle(x + 5, y - 4, 1.8, "#000");
  circle(x - 4.4, y - 4.6, 0.6, "#fff");
  circle(x + 5.6, y - 4.6, 0.6, "#fff");
  oval(x, y + 1.5, 2.2, 1.6, "#4a2c1a"); // 鼻
  circle(x - 9, y + 1, 2, "rgba(244,166,166,0.7)"); // ほっぺ
  circle(x + 9, y + 1, 2, "rgba(244,166,166,0.7)");

  // ぬいぐるみの縫い目
  ctx.strokeStyle = "#6b4429";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(x, y - 15);
  ctx.lineTo(x, y - 8);
  ctx.moveTo(x, y + 8);
  ctx.lineTo(x, y + 22);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ボス：サメ（横向きに泳ぐ。進行方向に顔を向ける）
function drawShark(b) {
  const body = b.flash > 0 ? "#ffffff" : "#6f8fb0";
  const dark = b.flash > 0 ? "#ffffff" : "#4f6d8a";
  const tail = Math.sin(b.t / 6) * 6; // 尾びれのゆれ

  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.scale(b.vx >= 0 ? 1 : -1, 1);

  // 尾びれ
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(-50, 0);
  ctx.lineTo(-82, -28 + tail);
  ctx.lineTo(-70, 0);
  ctx.lineTo(-82, 24 + tail);
  ctx.closePath();
  ctx.fill();

  // 背びれ
  ctx.beginPath();
  ctx.moveTo(-12, -20);
  ctx.lineTo(2, -50);
  ctx.lineTo(20, -20);
  ctx.closePath();
  ctx.fill();

  // 胴体とおなか
  oval(0, 0, 60, 24, body);
  oval(8, 10, 48, 12, b.flash > 0 ? "#ffffff" : "#e8eef5");

  // 胸びれ
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(4, 10);
  ctx.lineTo(-14, 34);
  ctx.lineTo(20, 14);
  ctx.closePath();
  ctx.fill();

  // エラ
  ctx.strokeStyle = dark;
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(22 + i * 6, -8);
    ctx.lineTo(19 + i * 6, 6);
    ctx.stroke();
  }

  // 目
  circle(40, -7, 4, "#000");
  circle(41, -8, 1.3, "#fff");

  // 口とギザギザの歯（ときどき大きく開く）
  const open = b.t % 35 < 8 ? 7 : 3;
  ctx.fillStyle = "#7a1f2b";
  ctx.beginPath();
  ctx.moveTo(58, 4);
  ctx.lineTo(32, 8);
  ctx.lineTo(56, 8 + open);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 4; i++) {
    const tx = 36 + i * 5;
    ctx.beginPath();
    ctx.moveTo(tx, 7);
    ctx.lineTo(tx + 2.5, 10);
    ctx.lineTo(tx + 5, 7);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawEnemy(e) {
  const colors = { basic: "#ff4d6d", zig: "#b5179e", big: "#ff9f1c" };
  ctx.fillStyle = colors[e.type];
  ctx.beginPath();
  if (e.type === "big") {
    // 六角形
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + e.t / 60;
      ctx.lineTo(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r);
    }
  } else {
    // 下向きの三角形
    ctx.moveTo(e.x, e.y + e.r);
    ctx.lineTo(e.x + e.r, e.y - e.r * 0.7);
    ctx.lineTo(e.x - e.r, e.y - e.r * 0.7);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#000";
  ctx.fillRect(e.x - 3, e.y - 3, 6, 6);
}

function drawCenterText(text, size, y, color = "#fff") {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(text, W / 2, y);
}

// ---- メインループ（60fps 前提で固定ステップ更新） ----
let last = performance.now();
let acc = 0;
const STEP = 1000 / 60;
function loop(now) {
  acc += Math.min(now - last, 250);
  last = now;
  while (acc >= STEP) {
    update();
    acc -= STEP;
  }
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
