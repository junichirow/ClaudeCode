// クマクマ大冒険：Canvas だけで動く横スクロールアクション
"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width; // 800
const H = canvas.height; // 480
const T = 40; // 1 マスの大きさ
const ROWS = H / T; // 12
const HIGH_SCORE_KEY = "kuma-action-high-score";

// ---- 調整用の数値 ----
const GRAVITY = 0.6;
const MAX_FALL = 12;
const RUN_SPEED = 4.2;
const RUN_ACCEL = 0.6;
const JUMP_SPEED = -13; // 3 マス上の足場まで届く
const MAX_HP = 5;
const START_LIVES = 3;
const PUNCH_FRAMES = 16;
const PUNCH_COOLDOWN = 22;
const LASER_CHARGE = 14; // レーザーをためる時間（フレーム）
const LASER_BEAM = 32; // ビームが出ている時間
const LASER_COOLDOWN = 600; // 次に撃てるまで 10 秒
const LASER_BOSS_DAMAGE = 4; // ボスへのダメージ（パンチ 4 回分）
const BOSS_HP = 16;
const BOSS_STUN = 180; // 踏まれたボスが動けなくなる時間（3 秒）

const LEVEL_COLS = 200;
const LEVEL_W = LEVEL_COLS * T;
const ARENA_X = LEVEL_W - W; // ボス部屋（ステージの右端の 1 画面）の左端
const GROUND_Y = 10 * T; // ふつうの地面の高さ

const isTouchDevice = matchMedia("(hover: none) and (pointer: coarse)").matches;

// ---- 入力 ----
const KEY_LEFT = ["arrowleft", "a"];
const KEY_RIGHT = ["arrowright", "d"];
const KEY_JUMP = [" ", "arrowup", "w"];
const KEY_PUNCH = ["z", "x", "j"];
const KEY_LASER = ["c", "k"];
const keys = new Set();
const touchHeld = { left: false, right: false, jump: false, punch: false, laser: false };
// ジャンプ・パンチ・レーザーは押した瞬間を数フレームおぼえておき、着地の少し前に押しても出るようにする
let jumpBuffer = 0;
let punchBuffer = 0;
let laserBuffer = 0;

const held = (list) => list.some((k) => keys.has(k));
const holdLeft = () => held(KEY_LEFT) || touchHeld.left;
const holdRight = () => held(KEY_RIGHT) || touchHeld.right;
const holdJump = () => held(KEY_JUMP) || touchHeld.jump;

window.addEventListener("keydown", (e) => {
  Sound.unlock();
  const k = e.key.toLowerCase();
  if ([...KEY_LEFT, ...KEY_RIGHT, ...KEY_JUMP, "arrowdown"].includes(k)) e.preventDefault();
  if (!keys.has(k)) {
    if (KEY_JUMP.includes(k)) jumpBuffer = 8;
    if (KEY_PUNCH.includes(k)) punchBuffer = 8;
    if (KEY_LASER.includes(k)) laserBuffer = 8;
  }
  keys.add(k);
  if (k === "enter" || k === " ") onAction();
  if (k === "p") togglePause();
  if (k === "m") Sound.toggleMute();
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
// 別のウィンドウに切り替えたとき、キーが押しっぱなし扱いにならないようにする
window.addEventListener("blur", () => {
  keys.clear();
  for (const k in touchHeld) touchHeld[k] = false;
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "playing" && !paused) togglePause();
});

// スマホのボタン。指ごとに別々に反応するので、移動しながらジャンプ・パンチできる
document.querySelectorAll("[data-btn]").forEach((btn) => {
  const name = btn.dataset.btn;
  const release = () => {
    touchHeld[name] = false;
    btn.classList.remove("on");
  };
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    Sound.unlock();
    btn.setPointerCapture(e.pointerId);
    touchHeld[name] = true;
    btn.classList.add("on");
    if (name === "jump") jumpBuffer = 8;
    if (name === "punch") punchBuffer = 8;
    if (name === "laser") laserBuffer = 8;
    if (name !== "left" && name !== "right") onAction();
  });
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointercancel", release);
  btn.addEventListener("lostpointercapture", release);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
});

// 画面右上の小さなボタン（一時停止・音）
const PAUSE_BTN = { x: W - 48, y: 46, w: 38, h: 30 };
const MUTE_BTN = { x: W - 94, y: 46, w: 38, h: 30 };
function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * W,
    y: ((e.clientY - rect.top) / rect.height) * H,
  };
}
const inside = (pt, r) => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
canvas.addEventListener("pointerdown", (e) => {
  Sound.unlock();
  const pt = canvasPoint(e);
  if (inside(pt, MUTE_BTN)) Sound.toggleMute();
  else if (state === "playing" && (inside(pt, PAUSE_BTN) || paused)) togglePause();
  else onAction();
});

// ---- ゲーム状態 ----
let state = "title"; // title | playing | miss | gameover | clear
let paused = false;
let frame = 0;
let level, player, enemies, items, flags, snowballs, waves;
let particles = [];
let popups = [];
let camX = 0;
let shake = 0;
let score = 0;
let lives = START_LIVES;
let hp = MAX_HP;
let checkpointX = 0;
let boss = null;
let bossPhase = "none"; // none | fight | done
let warningTimer = 0;
let stateTimer = 0;
let playFrames = 0;
let clearBonus = null;
let stateChangedAt = 0;
let highScore = Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;

function onAction() {
  if (state === "title") startGame();
  // ゲームオーバー・クリア直後は誤操作ですぐ始まらないよう少し待つ
  else if ((state === "gameover" || state === "clear") && performance.now() - stateChangedAt > 1500) startGame();
}

function togglePause() {
  if (state !== "playing") return;
  paused = !paused;
  Sound.setPaused(paused);
}

// ---- ステージ ----
// tiles[行][列]。"#" は地面（すべての方向から乗れない）、"-" は木の足場（下からすり抜けて上に乗れる）
function buildLevel() {
  const tiles = Array.from({ length: ROWS }, () => new Array(LEVEL_COLS).fill("."));
  const enemySpawns = [];
  const itemSpawns = [];
  const flagCols = [];
  const set = (c, r, ch) => (tiles[r][c] = ch);
  const ground = (from, to, top = 10) => {
    for (let c = from; c <= to; c++) for (let r = top; r < ROWS; r++) set(c, r, "#");
  };
  const plank = (c, r, len) => {
    for (let i = 0; i < len; i++) set(c + i, r, "-");
  };
  const enemy = (c, kind = "walk", r = 9) => enemySpawns.push({ c, r, kind });
  const honey = (c, r, n = 1) => {
    for (let i = 0; i < n; i++) itemSpawns.push({ c: c + i, r, kind: "honey" });
  };
  const heart = (c, r) => itemSpawns.push({ c, r, kind: "heart" });

  // 1. はじまりの森（操作に慣れる）
  ground(0, 30);
  honey(8, 8, 3);
  plank(12, 7, 3);
  honey(12, 6, 3);
  enemy(17);
  enemy(25);

  // 2. 穴と段差
  ground(33, 49);
  ground(38, 39, 8);
  honey(38, 7, 2);
  enemy(44);
  plank(49, 7, 6); // 穴の上の足場
  honey(51, 6, 3);
  ground(54, 77);
  enemy(60, "jump");
  plank(62, 7, 5);
  heart(64, 6);
  enemy(68);
  enemy(73);

  // 3. 丘
  ground(78, 87, 8);
  honey(80, 5, 3);
  enemy(84, "walk", 7);
  ground(88, 100);
  flagCols.push(95);

  // 4. 穴が続くところ
  honey(101, 8, 3);
  ground(104, 108);
  enemy(106);
  honey(109, 8, 3);
  ground(112, 150);
  enemy(118, "jump");
  enemy(124);
  enemy(128);

  // 5. 木の上の足場
  plank(133, 7, 3);
  plank(137, 5, 3);
  plank(141, 3, 4);
  honey(141, 2, 4);
  plank(147, 5, 3);
  heart(148, 4);
  enemy(140);
  enemy(146, "jump");

  // 6. ボスの手前とボス部屋
  ground(154, LEVEL_COLS - 1);
  enemy(158, "jump");
  enemy(163);
  enemy(167, "jump");
  honey(170, 8, 3);
  flagCols.push(175);
  for (let r = 0; r < 10; r++) set(LEVEL_COLS - 1, r, "#"); // ボス部屋の右の壁

  return { tiles, enemySpawns, itemSpawns, flagCols };
}

function tileAt(c, r) {
  if (c < 0 || c >= LEVEL_COLS) return "#"; // ステージの外は壁
  if (r < 0 || r >= ROWS) return ".";
  return level.tiles[r][c];
}

// 地面との当たり判定をしながら動かす。横の壁に当たったら true を返す
function moveEntity(e) {
  let hitWall = false;
  e.x += e.vx;
  const top = Math.floor(e.y / T);
  const bottom = Math.floor((e.y + e.h - 1) / T);
  if (e.vx > 0) {
    const c = Math.floor((e.x + e.w - 1) / T);
    for (let r = top; r <= bottom; r++) {
      if (tileAt(c, r) === "#") {
        e.x = c * T - e.w;
        hitWall = true;
        break;
      }
    }
  } else if (e.vx < 0) {
    const c = Math.floor(e.x / T);
    for (let r = top; r <= bottom; r++) {
      if (tileAt(c, r) === "#") {
        e.x = (c + 1) * T;
        hitWall = true;
        break;
      }
    }
  }

  const prevBottom = e.y + e.h;
  e.vy = Math.min(e.vy + GRAVITY, MAX_FALL);
  e.y += e.vy;
  e.onGround = false;
  const left = Math.floor(e.x / T);
  const right = Math.floor((e.x + e.w - 1) / T);
  if (e.vy > 0) {
    const r = Math.floor((e.y + e.h) / T);
    for (let c = left; c <= right; c++) {
      const t = tileAt(c, r);
      // 木の足場は、上から落ちてきたときだけ乗れる
      if (t === "#" || (t === "-" && prevBottom <= r * T + 0.5)) {
        e.y = r * T - e.h;
        e.vy = 0;
        e.onGround = true;
        break;
      }
    }
  } else if (e.vy < 0) {
    const r = Math.floor(e.y / T);
    for (let c = left; c <= right; c++) {
      if (tileAt(c, r) === "#") {
        e.y = (r + 1) * T;
        e.vy = 0;
        break;
      }
    }
  }
  return hitWall;
}

// ---- ゲームの開始・やり直し ----
function setupWorld() {
  level = buildLevel();
  items = level.itemSpawns.map((s) => ({ x: s.c * T + T / 2, y: s.r * T + T / 2, kind: s.kind, taken: false }));
  flags = level.flagCols.map((c) => ({ x: c * T + T / 2, reached: false }));
  checkpointX = 2 * T;
  particles = [];
  popups = [];
  respawn();
}

function startGame() {
  setupWorld();
  score = 0;
  lives = START_LIVES;
  playFrames = 0;
  clearBonus = null;
  paused = false;
  state = "playing";
  Sound.setPaused(false);
  Sound.playMusic("forest");
}

// ミスしたあとは最後に通ったチェックポイントから。敵とボスは元に戻る（取ったはちみつはそのまま）
function respawn() {
  hp = MAX_HP;
  player = {
    x: checkpointX, y: GROUND_Y - 36, w: 26, h: 36, vx: 0, vy: 0,
    facing: 1, onGround: false, coyote: 0, punch: 0, punchCool: 0,
    laser: 0, laserCool: 0, laserHitBoss: false,
    invincible: 60, hurtTimer: 0, jumpCut: true, walk: 0, prevBottom: GROUND_Y,
  };
  enemies = level.enemySpawns.map(makeEnemy);
  snowballs = [];
  waves = [];
  boss = null;
  bossPhase = "none";
  warningTimer = 0;
  camX = clampCam(player.x - W / 3);
  jumpBuffer = 0;
  punchBuffer = 0;
  laserBuffer = 0;
  Sound.playMusic("forest");
}

function makeEnemy(s) {
  const w = 30;
  const h = 28;
  return {
    x: s.c * T + (T - w) / 2, y: (s.r + 1) * T - h, w, h, vx: 0, vy: 0,
    kind: s.kind, facing: -1, onGround: false, active: false, dead: false, gone: false,
    t: 0, spin: 0, jumpTimer: 40 + Math.random() * 60,
  };
}

// ---- 便利関数 ----
const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const clampCam = (x) => clamp(x, 0, LEVEL_W - W);
// 列番号などから毎回同じ「ランダムっぽい」値を作る（背景の木の配置用）
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function burst(x, y, color, count = 12, speed = 4) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = rand(speed * 0.3, speed);
    const life = rand(20, 40);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life, max: life, color, size: rand(2, 5) });
  }
}

const dust = (x, y) => burst(x, y, "#e3d3b0", 6, 2);

function addScore(points, x, y) {
  score += points;
  popups.push({ x, y, text: `+${points}`, life: 45 });
}

function saveHighScore() {
  if (score > highScore) {
    highScore = score;
    localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
  }
}

// ---- 更新 ----
function update() {
  frame++;
  if (state === "title") {
    // タイトル画面ではステージをゆっくり眺める
    camX = (Math.sin(frame / 700 - Math.PI / 2) * 0.5 + 0.5) * 3000;
    return;
  }
  if (state === "gameover") return;
  if (paused) return;
  updateParticles();
  if (state === "miss") {
    updateMiss();
    return;
  }
  if (state === "clear") {
    if (frame % 15 === 0) {
      const colors = ["#ffd166", "#ef476f", "#06d6a0", "#4cc9f0"];
      burst(camX + rand(100, W - 100), rand(60, 220), colors[Math.floor(rand(0, 4))], 14, 5);
    }
    return;
  }

  playFrames++;
  updatePlayer();
  updateEnemies();
  updateItems();
  updateBoss();
  updateProjectiles();
  updateCamera();
  if (shake > 0) shake--;
  if (warningTimer > 0) warningTimer--;
  if (jumpBuffer > 0) jumpBuffer--;
  if (punchBuffer > 0) punchBuffer--;
  if (laserBuffer > 0) laserBuffer--;
}

function updatePlayer() {
  const p = player;
  p.prevBottom = p.y + p.h;
  const wasOnGround = p.onGround;

  // 左右の移動
  const left = holdLeft();
  const right = holdRight();
  if (p.hurtTimer > 0) {
    p.hurtTimer--; // ダメージで吹き飛ばされている間は操作できない
  } else if (p.laser > 0) {
    p.vx = 0; // レーザー中は動けない
  } else if (left !== right) {
    const dir = right ? 1 : -1;
    p.vx = clamp(p.vx + dir * RUN_ACCEL, -RUN_SPEED, RUN_SPEED);
    if (p.punch === 0) p.facing = dir; // パンチ中は向きを変えない
  } else {
    p.vx *= p.onGround ? 0.7 : 0.92;
    if (Math.abs(p.vx) < 0.1) p.vx = 0;
  }

  // ジャンプ（足場から落ちた直後も少しだけ跳べる。ボタンを早く離すと低いジャンプ）
  p.coyote = p.onGround ? 6 : Math.max(0, p.coyote - 1);
  if (jumpBuffer > 0 && p.coyote > 0 && p.hurtTimer === 0 && p.laser === 0) {
    p.vy = JUMP_SPEED;
    p.coyote = 0;
    p.jumpCut = false;
    jumpBuffer = 0;
    Sound.jump();
    dust(p.x + p.w / 2, p.y + p.h);
  }
  if (!p.jumpCut && p.vy < 0 && !holdJump()) {
    p.vy = Math.max(p.vy, -5);
    p.jumpCut = true;
  }
  if (p.vy >= 0) p.jumpCut = true;

  // パンチ
  if (p.punchCool > 0) p.punchCool--;
  if (p.punch > 0) p.punch--;
  if (punchBuffer > 0 && p.punchCool === 0 && p.laser === 0) {
    p.punch = PUNCH_FRAMES;
    p.punchCool = PUNCH_COOLDOWN;
    punchBuffer = 0;
    Sound.punch();
  }

  // レーザー：ためてから発射。撃っている間は無敵で、空中でもその場に止まる
  if (p.laserCool > 0 && --p.laserCool === 0) {
    popups.push({ x: p.x + p.w / 2, y: p.y - 16, text: "レーザー OK!", life: 50 });
    Sound.laserReady();
  }
  if (laserBuffer > 0 && p.laserCool === 0 && p.laser === 0 && p.hurtTimer === 0) {
    p.laser = LASER_CHARGE + LASER_BEAM;
    p.laserCool = LASER_COOLDOWN;
    p.laserHitBoss = false;
    p.punch = 0;
    laserBuffer = 0;
    Sound.laserCharge();
  }
  if (p.laser > 0) {
    p.laser--;
    if (p.laser === LASER_BEAM) {
      shake = 8;
      Sound.laserFire();
    }
    p.vx = 0;
    p.vy = 0;
  } else {
    moveEntity(p);
  }
  if (bossPhase !== "none") p.x = clamp(p.x, ARENA_X, ARENA_X + W - T - p.w); // ボス戦中は部屋から出られない
  if (p.onGround && !wasOnGround) dust(p.x + p.w / 2, p.y + p.h);
  if (p.invincible > 0) p.invincible--;
  p.walk = p.onGround && Math.abs(p.vx) > 0.5 ? p.walk + Math.abs(p.vx) * 0.12 : 0;
  if (p.y > H + 40) miss(true);
}

// パンチが当たる範囲。出始めと戻りぎわには当たらない
function punchHitbox() {
  const p = player;
  const t = PUNCH_FRAMES - p.punch; // パンチを出してからの経過フレーム
  if (p.punch === 0 || t < 2 || t > 11) return null;
  const w = 34;
  return { x: p.facing > 0 ? p.x + p.w - 6 : p.x - w + 6, y: p.y + 6, w, h: 24 };
}

// レーザーが当たる範囲（クマの前から画面の端まで）。ためている間は null
function laserHitbox() {
  const p = player;
  if (p.laser === 0 || p.laser > LASER_BEAM) return null;
  const from = p.facing > 0 ? p.x + p.w : camX - 40;
  const to = p.facing > 0 ? camX + W + 40 : p.x;
  return { x: from, y: p.y + 4, w: Math.max(0, to - from), h: 28 };
}

// 上から落ちてきて踏んだかどうか
const isStomp = (p, target) => p.vy > 0 && p.prevBottom <= target.y + 14;

function updateEnemies() {
  const p = player;
  const fist = punchHitbox();
  const beam = laserHitbox();
  for (const e of enemies) {
    if (!e.active) {
      if (e.x > camX + W + 60) continue; // 画面に近づくまで動かない
      e.active = true;
    }
    e.t++;
    if (e.dead) {
      // 倒された敵はくるくる回りながら飛んでいく
      e.x += e.vx;
      e.vy += GRAVITY;
      e.y += e.vy;
      e.spin += 0.3 * Math.sign(e.vx);
      if (e.y > H + 100) e.gone = true;
      continue;
    }

    if (e.kind === "jump" && e.onGround && --e.jumpTimer <= 0) {
      e.vy = -10;
      e.jumpTimer = 90 + Math.random() * 60;
    }
    e.vx = e.facing * (e.kind === "jump" ? 1.2 : 1);
    if (moveEntity(e)) e.facing = -e.facing;
    else if (e.onGround && !groundAhead(e)) e.facing = -e.facing; // 崖の手前で引き返す
    if (e.y > H + 40) {
      e.gone = true;
      continue;
    }

    if (state !== "playing") continue;
    if ((fist && overlap(fist, e)) || (beam && overlap(beam, e))) {
      defeatEnemy(e, p.facing);
    } else if (overlap(p, e)) {
      if (isStomp(p, e)) {
        defeatEnemy(e, Math.sign(e.x - p.x) || 1);
        p.vy = holdJump() ? -12 : -8;
        p.jumpCut = true;
        Sound.stomp();
      } else {
        hurt(e.x + e.w / 2);
      }
    }
  }
  enemies = enemies.filter((e) => !e.gone);
}

function groundAhead(e) {
  const c = Math.floor((e.facing > 0 ? e.x + e.w + 2 : e.x - 2) / T);
  const r = Math.floor((e.y + e.h + 2) / T);
  const t = tileAt(c, r);
  return t === "#" || t === "-";
}

function defeatEnemy(e, dir) {
  e.dead = true;
  e.vx = dir * 6;
  e.vy = -7;
  addScore(100, e.x + e.w / 2, e.y);
  burst(e.x + e.w / 2, e.y + e.h / 2, "#ffffff", 12);
  burst(e.x + e.w / 2, e.y + e.h / 2, "#ffd166", 6);
  Sound.hit();
}

function updateItems() {
  const p = player;
  for (const it of items) {
    if (it.taken) continue;
    if (Math.abs(p.x + p.w / 2 - it.x) < 26 && Math.abs(p.y + p.h / 2 - it.y) < 30) {
      it.taken = true;
      if (it.kind === "honey") {
        addScore(50, it.x, it.y - 10);
        burst(it.x, it.y, "#ffcf4d", 8, 3);
        Sound.honey();
      } else {
        if (hp < MAX_HP) {
          hp++;
          popups.push({ x: it.x, y: it.y - 10, text: "HP +1", life: 45 });
        } else {
          addScore(500, it.x, it.y - 10);
        }
        burst(it.x, it.y, "#ff6b81", 12, 3);
        Sound.heart();
      }
    }
  }
  for (const f of flags) {
    if (!f.reached && p.x + p.w / 2 > f.x) {
      f.reached = true;
      checkpointX = f.x - p.w / 2;
      popups.push({ x: f.x, y: GROUND_Y - 120, text: "チェックポイント！", life: 70 });
      Sound.checkpoint();
    }
  }
}

function hurt(fromX) {
  const p = player;
  if (p.invincible > 0 || p.laser > 0 || state !== "playing") return;
  hp--;
  shake = 12;
  if (hp <= 0) {
    miss(false);
    return;
  }
  Sound.damage();
  p.invincible = 100;
  p.hurtTimer = 16;
  p.punch = 0;
  p.vx = (p.x + p.w / 2 < fromX ? -1 : 1) * 5;
  p.vy = -6;
}

// ミス：その場で飛び上がって画面の下へ落ちていく（穴に落ちたときはそのまま）
function miss(fell) {
  if (state !== "playing") return;
  state = "miss";
  stateTimer = 0;
  hp = 0;
  lives--;
  player.vx = 0;
  player.vy = fell ? 0 : -10;
  player.punch = 0;
  Sound.stopMusic();
  Sound.miss();
}

function updateMiss() {
  stateTimer++;
  const p = player;
  if (stateTimer > 25) {
    p.vy += GRAVITY * 0.8;
    p.y += p.vy;
  }
  if (stateTimer >= 150) {
    if (lives <= 0) {
      state = "gameover";
      stateChangedAt = performance.now();
      saveHighScore();
      Sound.gameOver();
    } else {
      state = "playing";
      respawn();
    }
  }
}

function updateCamera() {
  const p = player;
  const target = bossPhase !== "none" ? ARENA_X : clampCam(p.x + p.w / 2 - W / 2 + p.facing * 80);
  camX += (target - camX) * 0.08;
}

// ---- ボス：大きなシロクマ ----
// ボス部屋に入ると登場。歩く・大ジャンプ（着地で衝撃波）・雪玉投げをくり返す。体力が半分を切ると怒って速くなる
function startBoss() {
  bossPhase = "fight";
  warningTimer = 150;
  Sound.playMusic("boss");
  Sound.warning();
  boss = {
    x: ARENA_X + W - 200, y: -220, w: 92, h: 108, vx: 0, vy: 0,
    hp: BOSS_HP, state: "enter", t: 0, facing: -1, invincible: 0,
    onGround: false, last: "", angryShown: false, stun: 0,
  };
}

const bossAngry = () => boss.hp <= BOSS_HP / 2;

function setBossState(name) {
  boss.state = name;
  boss.t = 0;
}

function nextBossAction() {
  const choices = ["walk", "crouch", "throw"].filter((c) => c !== boss.last); // 同じ技を続けない
  const next = choices[Math.floor(Math.random() * choices.length)];
  boss.last = next;
  setBossState(next);
}

function updateBoss() {
  if (bossPhase === "none") {
    if (player.x > ARENA_X + 140) startBoss();
    return;
  }
  const b = boss;
  const p = player;
  b.t++;
  if (b.invincible > 0) b.invincible--;

  if (b.state === "down") {
    b.vx = 0;
    moveEntity(b);
    if (b.t % 10 === 0 && b.t < 100) {
      burst(b.x + rand(0, b.w), b.y + rand(0, b.h), b.t % 20 ? "#ffffff" : "#e63946", 14, 5);
    }
    if (b.t === 200) stageClear();
    return;
  }

  const angry = bossAngry();
  if (angry && !b.angryShown) {
    b.angryShown = true;
    popups.push({ x: b.x + b.w / 2, y: b.y - 20, text: "おこった！", life: 70 });
  }
  const toPlayer = p.x + p.w / 2 < b.x + b.w / 2 ? -1 : 1;
  const wasOnGround = b.onGround;

  // 踏まれて目を回している間は動けない（空中なら落ちるだけ）
  if (b.stun > 0) {
    b.stun--;
    b.vx = 0;
    b.t = 0;
  } else switch (b.state) {
    case "enter":
      b.vx = 0;
      break;
    case "idle":
      b.vx = 0;
      b.facing = toPlayer;
      if (b.t > (angry ? 25 : 45)) nextBossAction();
      break;
    case "walk":
      if (b.t === 1) b.facing = toPlayer;
      b.vx = b.facing * (angry ? 3.2 : 2);
      if (b.t > 80) setBossState("idle");
      break;
    case "crouch": // ジャンプの溜め
      b.vx = 0;
      b.facing = toPlayer;
      if (b.t > (angry ? 14 : 24)) {
        b.vy = -14;
        b.vx = clamp((p.x + p.w / 2 - b.w / 2 - b.x) / 46, -6, 6); // プレイヤーのいる場所をめがけて跳ぶ
        setBossState("air");
      }
      break;
    case "air":
      break;
    case "throw": {
      b.vx = 0;
      b.facing = toPlayer;
      const throwAt = angry ? [20, 34, 48] : [30];
      if (throwAt.includes(b.t)) throwSnowball(angry ? [36, 46, 58][throwAt.indexOf(b.t)] : 46);
      if (b.t > (angry ? 70 : 60)) setBossState("idle");
      break;
    }
  }

  let hitWall = moveEntity(b);
  if (b.x < ARENA_X) {
    b.x = ARENA_X;
    hitWall = true;
  }
  if (hitWall && b.state === "walk") b.facing = -b.facing;

  // 着地したら地面が揺れる。大ジャンプのあとは左右に衝撃波が走る
  if (b.onGround && !wasOnGround && (b.state === "enter" || b.state === "air")) {
    shake = 18;
    Sound.stomp(true);
    for (let i = 0; i < 3; i++) dust(b.x + rand(0, b.w), b.y + b.h);
    if (b.state === "air" && b.stun === 0) {
      const speed = angry ? 6.5 : 5;
      waves.push({ x: b.x - 4, y: b.y + b.h, dir: -1, speed });
      waves.push({ x: b.x + b.w + 4, y: b.y + b.h, dir: 1, speed });
    }
    setBossState("idle");
  }

  if (state !== "playing") return;
  const fist = punchHitbox();
  const beam = laserHitbox();
  const body = { x: b.x + 8, y: b.y + 10, w: b.w - 16, h: b.h - 10 };
  // レーザーは 1 回の発射につき 1 度だけ、ボスの無敵時間に関係なく当たる
  if (beam && !p.laserHitBoss && overlap(beam, body)) {
    p.laserHitBoss = true;
    damageBoss(LASER_BOSS_DAMAGE);
    return;
  }
  if (fist && b.invincible === 0 && overlap(fist, body)) damageBoss();
  else if (overlap(p, body)) {
    if (isStomp(p, body)) {
      if (b.invincible === 0) damageBoss();
      if (b.stun === 0 && bossPhase === "fight") stunBoss(); // 目を回している間に踏んでも延長しない
      p.vy = -11;
      p.vx = (p.x + p.w / 2 < b.x + b.w / 2 ? -1 : 1) * 4;
      p.hurtTimer = 10;
      p.jumpCut = true;
    } else {
      hurt(b.x + b.w / 2);
    }
  }
}

function stunBoss() {
  const b = boss;
  b.stun = BOSS_STUN;
  if (b.onGround) setBossState("idle");
  popups.push({ x: b.x + b.w / 2, y: b.y - 20, text: "ピヨピヨ…", life: 60 });
}

// 雪玉を山なりに投げる。flight フレームでプレイヤーのいる場所に届く
function throwSnowball(flight) {
  const b = boss;
  const p = player;
  const sx = b.x + b.w / 2 + b.facing * 40;
  const sy = b.y + 2;
  const g = 0.35;
  const dx = p.x + p.w / 2 - sx;
  const dy = p.y + p.h / 2 - sy;
  snowballs.push({
    x: sx, y: sy, r: 11, g,
    vx: clamp(dx / flight, -9, 9),
    vy: (dy - 0.5 * g * flight * flight) / flight,
  });
  Sound.throwBall();
}

function damageBoss(amount = 1) {
  const b = boss;
  b.hp = Math.max(0, b.hp - amount);
  b.invincible = 36;
  shake = 6 + amount * 2;
  burst(b.x + b.w / 2, b.y + b.h / 2, "#ffffff", 14 * amount, 5);
  addScore(100 * amount, b.x + b.w / 2, b.y);
  Sound.bossHit();
  if (b.hp <= 0) {
    bossPhase = "done";
    setBossState("down");
    b.vx = 0;
    snowballs = [];
    waves = [];
    shake = 30;
    addScore(5000, b.x + b.w / 2, b.y - 20);
    Sound.stopMusic();
    Sound.bossDown();
  }
}

function stageClear() {
  state = "clear";
  stateChangedAt = performance.now();
  const seconds = Math.floor(playFrames / 60);
  clearBonus = { time: Math.max(0, 300 - seconds) * 10, lives: lives * 1000, seconds };
  score += clearBonus.time + clearBonus.lives;
  saveHighScore();
  Sound.clear();
}

function updateProjectiles() {
  const p = player;
  const fist = punchHitbox();
  const beam = laserHitbox();
  for (const s of snowballs) {
    s.vy += s.g;
    s.x += s.vx;
    s.y += s.vy;
    const box = { x: s.x - s.r, y: s.y - s.r, w: s.r * 2, h: s.r * 2 };
    if ((fist && overlap(fist, box)) || (beam && overlap(beam, box))) {
      // 雪玉はパンチやレーザーで壊せる
      s.gone = true;
      burst(s.x, s.y, "#ffffff", 10, 3);
      addScore(50, s.x, s.y);
      Sound.hit();
    } else if (overlap(p, box)) {
      s.gone = true;
      burst(s.x, s.y, "#ffffff", 10, 3);
      hurt(s.x);
    } else if (tileAt(Math.floor(s.x / T), Math.floor((s.y + s.r) / T)) === "#" || s.y > H || s.x < ARENA_X - 30) {
      s.gone = true;
      burst(s.x, s.y, "#ffffff", 8, 2);
    }
  }
  snowballs = snowballs.filter((s) => !s.gone);

  for (const w of waves) {
    w.x += w.dir * w.speed;
    if (frame % 3 === 0) dust(w.x, w.y);
    const box = { x: w.x - 10, y: w.y - 26, w: 20, h: 26 };
    if (beam && overlap(beam, box)) {
      w.gone = true; // 衝撃波もレーザーで消せる
      burst(w.x, w.y - 10, "#ffffff", 8, 3);
      continue;
    }
    if (overlap(p, box)) hurt(w.x - w.dir * 20);
    if (w.x < ARENA_X || w.x > ARENA_X + W - T) w.gone = true;
  }
  waves = waves.filter((w) => !w.gone);
}

function updateParticles() {
  for (const q of particles) {
    q.x += q.vx;
    q.y += q.vy;
    q.vy += 0.15;
    q.life--;
  }
  particles = particles.filter((q) => q.life > 0);
  for (const q of popups) {
    q.y -= 0.7;
    q.life--;
  }
  popups = popups.filter((q) => q.life > 0);
}

// ---- 描画 ----
function circle(x, y, r, color, stroke) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function oval(x, y, rx, ry, color, stroke) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function line(x1, y1, x2, y2, color, width = 2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.stroke();
}

// 目を「×」にする（倒れたとき）
function xEye(x, y, s = 2.5) {
  line(x - s, y - s, x + s, y + s, "#222", 1.8);
  line(x - s, y + s, x + s, y - s, "#222", 1.8);
}

function heartPath(x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s);
  ctx.bezierCurveTo(x - s * 1.3, y + s * 0.1, x - s * 0.7, y - s * 1.0, x, y - s * 0.35);
  ctx.bezierCurveTo(x + s * 0.7, y - s * 1.0, x + s * 1.3, y + s * 0.1, x, y + s);
  ctx.closePath();
}

function text(str, x, y, size, color = "#fff", align = "center") {
  ctx.font = `bold ${size}px system-ui, -apple-system, "Hiragino Sans", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, size / 6);
  ctx.strokeStyle = "rgba(20, 30, 20, 0.75)";
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function draw() {
  ctx.save();
  const sx = shake > 0 ? rand(-1, 1) * shake * 0.4 : 0;
  const sy = shake > 0 ? rand(-1, 1) * shake * 0.4 : 0;
  ctx.translate(sx, sy);
  drawBackground(camX);
  ctx.translate(-Math.round(camX), 0);
  drawTiles();
  drawFlags();
  drawItems();
  for (const e of enemies) drawEnemy(e);
  if (boss) drawBoss(boss);
  drawWaves();
  for (const s of snowballs) {
    circle(s.x, s.y, s.r, "#ffffff", "#9fb6cc");
    circle(s.x - 3, s.y - 3, 3, "#e8f2ff");
  }
  if (state !== "title") {
    drawPlayer();
    drawLaser();
  }
  for (const q of particles) {
    ctx.globalAlpha = Math.max(0, q.life / q.max);
    ctx.fillStyle = q.color;
    ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;
  for (const q of popups) {
    ctx.globalAlpha = Math.min(1, q.life / 20);
    text(q.text, q.x, q.y, 16, "#fff6c2");
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  drawHud();
  drawOverlay();
}

// 背景：空・雲・遠くの山・森の木（奥ほどゆっくり動いて奥行きを出す）
function drawBackground(cx) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#74c3ef");
  sky.addColorStop(0.7, "#c9eedb");
  sky.addColorStop(1, "#e6f5d0");
  ctx.fillStyle = sky;
  ctx.fillRect(-20, -20, W + 40, H + 40);

  // 太陽
  circle(660, 80, 52, "rgba(255, 244, 176, 0.35)");
  circle(660, 80, 36, "#fff4b0");

  // 雲
  const cloudGap = 380;
  const cloudOffset = cx * 0.12;
  for (let k = Math.floor(cloudOffset / cloudGap) - 1; k < Math.floor(cloudOffset / cloudGap) + 4; k++) {
    const x = k * cloudGap - cloudOffset + hash(k) * 120;
    const y = 50 + hash(k + 50) * 90;
    circle(x, y, 22, "rgba(255,255,255,0.9)");
    circle(x + 26, y - 10, 28, "rgba(255,255,255,0.9)");
    circle(x + 56, y, 22, "rgba(255,255,255,0.9)");
    oval(x + 28, y + 10, 46, 12, "rgba(255,255,255,0.9)");
  }

  // 遠くの山
  const hills = (offset, base, amp, color) => {
    ctx.beginPath();
    ctx.moveTo(-20, H);
    for (let x = -20; x <= W + 20; x += 20) {
      const wx = x + offset;
      ctx.lineTo(x, base + Math.sin(wx * 0.005) * amp + Math.sin(wx * 0.013) * amp * 0.4);
    }
    ctx.lineTo(W + 20, H);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  hills(cx * 0.2, 280, 40, "#a8d8b0");
  hills(cx * 0.32 + 900, 320, 30, "#86c493");

  // 森の木
  const treeGap = 110;
  const treeOffset = cx * 0.5;
  for (let k = Math.floor(treeOffset / treeGap) - 1; k < Math.floor(treeOffset / treeGap) + 9; k++) {
    const x = k * treeGap - treeOffset + hash(k + 7) * 50;
    const h = 120 + hash(k + 3) * 90;
    const r = 34 + hash(k + 11) * 18;
    const dark = hash(k + 19) > 0.5;
    ctx.fillStyle = "#7a5a3a";
    ctx.fillRect(x - 6, GROUND_Y - h, 12, h);
    const leaf = dark ? "#4e9a5c" : "#5fae68";
    circle(x, GROUND_Y - h, r, leaf);
    circle(x - r * 0.6, GROUND_Y - h + r * 0.4, r * 0.7, leaf);
    circle(x + r * 0.6, GROUND_Y - h + r * 0.4, r * 0.7, leaf);
    circle(x - r * 0.3, GROUND_Y - h - r * 0.3, r * 0.35, "rgba(255,255,255,0.12)");
  }
}

function drawTiles() {
  const c0 = Math.max(0, Math.floor(camX / T) - 1);
  const c1 = Math.min(LEVEL_COLS - 1, c0 + W / T + 2);
  for (let c = c0; c <= c1; c++) {
    for (let r = 0; r < ROWS; r++) {
      const t = level.tiles[r][c];
      const x = c * T;
      const y = r * T;
      if (t === "#") {
        ctx.fillStyle = "#8b5a2b";
        ctx.fillRect(x, y, T, T);
        // 土のつぶつぶ
        ctx.fillStyle = "#6e4520";
        ctx.fillRect(x + 6 + hash(c * 13 + r) * 22, y + 14 + hash(c + r * 7) * 18, 5, 4);
        ctx.fillRect(x + 4 + hash(c * 5 + r * 3) * 26, y + 8 + hash(c * 3 + r) * 24, 4, 3);
        if (tileAt(c, r - 1) !== "#") {
          // 地面の表面は草
          ctx.fillStyle = "#5cb85c";
          ctx.fillRect(x, y, T, 11);
          for (let i = 0; i < 4; i++) circle(x + 5 + i * 10, y + 11, 5, "#5cb85c");
          ctx.fillStyle = "#86d986";
          ctx.fillRect(x, y, T, 3);
        }
      } else if (t === "-") {
        // 木の足場
        ctx.fillStyle = "#b07a3e";
        ctx.fillRect(x, y, T, 14);
        ctx.fillStyle = "#d39a55";
        ctx.fillRect(x, y, T, 3);
        ctx.strokeStyle = "#7a5023";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.75, y + 0.75, T - 1.5, 12.5);
        circle(x + 6, y + 7, 1.5, "#5a3a18");
        circle(x + T - 6, y + 7, 1.5, "#5a3a18");
      }
    }
  }
}

function drawFlags() {
  for (const f of flags) {
    if (f.x < camX - 40 || f.x > camX + W + 40) continue;
    ctx.fillStyle = "#e9e3d5";
    ctx.fillRect(f.x - 2, GROUND_Y - 110, 4, 110);
    circle(f.x, GROUND_Y - 112, 5, "#ffd166");
    const fy = f.reached ? GROUND_Y - 106 : GROUND_Y - 40;
    const wave = Math.sin(frame / 8) * 3;
    ctx.beginPath();
    ctx.moveTo(f.x + 2, fy);
    ctx.lineTo(f.x + 40, fy + 12 + wave);
    ctx.lineTo(f.x + 2, fy + 26);
    ctx.closePath();
    ctx.fillStyle = f.reached ? "#ffd166" : "#9aa5b1";
    ctx.fill();
    // 旗の肉球マーク
    const px = f.x + 15;
    const py = fy + 13;
    const paw = f.reached ? "#b0702c" : "#6c7680";
    circle(px, py + 2, 4, paw);
    circle(px - 4, py - 4, 1.8, paw);
    circle(px, py - 5.5, 1.8, paw);
    circle(px + 4, py - 4, 1.8, paw);
  }
}

function drawItems() {
  for (const it of items) {
    if (it.taken || it.x < camX - 30 || it.x > camX + W + 30) continue;
    const y = it.y + Math.sin(frame / 12 + it.x) * 3;
    if (it.kind === "honey") {
      // はちみつのつぼ
      oval(it.x, y + 3, 11, 10, "#e8a23a", "#b5741c");
      ctx.fillStyle = "#c97b1a";
      ctx.fillRect(it.x - 8, y - 9, 16, 5);
      oval(it.x, y - 9, 8, 2.5, "#ffcf4d");
      oval(it.x + 4, y - 6, 2, 3.5, "#ffcf4d"); // たれたはちみつ
      circle(it.x - 4, y + 1, 2.5, "rgba(255,255,255,0.5)");
    } else {
      heartPath(it.x, y, 11);
      ctx.fillStyle = "#ff4d6d";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
      circle(it.x - 4, y - 3, 2.5, "rgba(255,255,255,0.7)");
    }
  }
}

function drawWaves() {
  for (const w of waves) {
    const h = 22 + Math.sin(frame / 2) * 3;
    ctx.beginPath();
    ctx.moveTo(w.x - 14, w.y);
    ctx.quadraticCurveTo(w.x - w.dir * 4, w.y - h * 1.4, w.x + w.dir * 12, w.y);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fill();
    ctx.strokeStyle = "#9fb6cc";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// 主人公：茶色のクマ（赤いボクシンググローブでパンチ）。原点は足元の中心、右向きで描く
function drawKuma({ walk = 0, air = false, punch = 0, laser = false, dizzy = false } = {}) {
  const fur = "#9a6234";
  const dark = "#7a4a26";
  const light = "#f1d9b5";
  const pink = "#f4a6a6";
  const step = Math.sin(walk) * 4;

  // 足
  oval(-6 + (air ? -2 : step), -4, 6, 4.5, dark);
  oval(6 + (air ? 3 : -step), -4, 6, 4.5, dark);
  // 奥の腕（グローブ）
  circle(-10, -18, 5, "#b02a35");
  // 体
  oval(0, -15, 12, 11, fur);
  oval(3, -14, 6.5, 7, light);
  // 頭
  const headY = -31 - Math.abs(Math.sin(walk)) * 1.5;
  circle(-7, headY - 10, 5.5, fur);
  circle(-7, headY - 10, 2.8, pink);
  circle(7, headY - 11, 5.5, fur);
  circle(7, headY - 11, 2.8, pink);
  circle(0, headY, 13, fur);
  oval(7, headY + 4, 6, 4.5, light); // 口まわり
  oval(11, headY + 1.5, 2.6, 1.9, "#3a2212"); // 鼻
  if (dizzy) {
    xEye(2, headY - 3, 2);
    xEye(9, headY - 3, 2);
  } else {
    circle(2.5, headY - 3, 1.9, "#1a1a1a");
    circle(9, headY - 3, 1.9, "#1a1a1a");
    circle(3.1, headY - 3.7, 0.7, "#fff");
    circle(9.6, headY - 3.7, 0.7, "#fff");
  }
  circle(-2, headY + 4, 2.4, "rgba(240, 120, 120, 0.55)"); // ほっぺ

  // 手前の腕。パンチ中は前に突き出す。レーザー中は両手を前にそろえる
  if (laser) {
    circle(17, -13, 5.5, "#b02a35");
    line(5, -18, 16, -19, fur, 8);
    circle(20, -19, 6.5, "#e63946");
  } else if (punch > 0) {
    const t = PUNCH_FRAMES - punch;
    const reach = t < 3 ? t * 6 : t < 10 ? 18 : Math.max(0, 18 - (t - 10) * 3);
    line(5, -18, 10 + reach, -19, fur, 8);
    circle(13 + reach, -19, 7.5, "#e63946");
    circle(15 + reach, -21, 2.5, "rgba(255,255,255,0.5)");
    if (t >= 2 && t <= 9) {
      // パンチの勢いの線
      for (let i = -1; i <= 1; i++) line(23 + reach, -19 + i * 6, 29 + reach, -19 + i * 10, "#fff6c2", 2);
    }
  } else {
    circle(9, -16, 5, "#e63946");
  }
}

function drawPlayer() {
  const p = player;
  // 無敵中は点滅
  if (state === "playing" && p.invincible > 0 && Math.floor(p.invincible / 4) % 2 === 0) return;
  ctx.save();
  ctx.translate(p.x + p.w / 2, p.y + p.h);
  ctx.scale(p.facing, 1);
  drawKuma({
    walk: p.walk, air: !p.onGround, punch: p.punch, laser: p.laser > 0,
    dizzy: state === "miss" || state === "gameover",
  });
  ctx.restore();
}

// レーザー：ためている間は手元に光が集まり、そのあと画面の端までビームが伸びる
function drawLaser() {
  const p = player;
  if (p.laser === 0) return;
  const hx = p.x + p.w / 2 + p.facing * 24; // グローブの位置
  const hy = p.y + 17;
  if (p.laser > LASER_BEAM) {
    const k = 1 - (p.laser - LASER_BEAM) / LASER_CHARGE; // 0 → 1
    circle(hx, hy, 4 + k * 10, "rgba(255, 240, 120, 0.5)");
    circle(hx, hy, 2 + k * 5, "#fffbe0");
    for (let i = 0; i < 6; i++) {
      const a = frame * 0.3 + (i * Math.PI) / 3;
      const r = 30 * (1 - k) + 6;
      circle(hx + Math.cos(a) * r, hy + Math.sin(a) * r, 2.5, "#fff6c2");
    }
    return;
  }
  const box = laserHitbox();
  const end = p.facing > 0 ? box.x + box.w : box.x;
  const x0 = Math.min(hx, end);
  const len = Math.abs(end - hx);
  // 出始めは太く、終わりぎわは細くなる
  const k = p.laser / LASER_BEAM;
  const h = 30 * Math.min(1, k * 3) * (0.85 + Math.random() * 0.15);
  ctx.fillStyle = "rgba(255, 120, 200, 0.35)";
  ctx.fillRect(x0, hy - h / 2 - 7, len, h + 14);
  ctx.fillStyle = "rgba(255, 225, 80, 0.9)";
  ctx.fillRect(x0, hy - h / 2, len, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x0, hy - h / 6, len, h / 3);
  circle(hx, hy, h * 0.45, "#fff6c2");
  for (let i = 0; i < 6; i++) circle(x0 + Math.random() * len, hy + rand(-h, h) / 2, rand(1.5, 3.5), "#ffffff");
}

// スマホのレーザーボタン：撃てるまでの残り秒数を表示する
const laserBtn = document.querySelector('[data-btn="laser"]');
let laserBtnLabel = "";
function updateLaserButton() {
  if (!laserBtn) return;
  const cool = state === "title" ? 0 : player.laserCool;
  const label = cool > 0 ? `あと ${Math.ceil(cool / 60)} 秒` : "レーザー";
  if (label === laserBtnLabel) return;
  laserBtnLabel = label;
  laserBtn.textContent = label;
  laserBtn.classList.toggle("cooling", cool > 0);
}

// 雑魚：小さなシロクマ（青いマフラー）。原点は足元の中心、右向きで描く
function drawShirokuma({ t = 0, walking = true, dead = false } = {}) {
  const white = "#f7fbff";
  const edge = "#a9bccf";
  const step = walking ? Math.sin(t * 0.25) * 3 : 0;
  oval(-7 + step, -4, 5.5, 4, white, edge);
  oval(7 - step, -4, 5.5, 4, white, edge);
  oval(-1, -12, 13, 9, white, edge);
  // マフラー（しっぽがゆれる）
  ctx.fillStyle = "#3d8bd9";
  ctx.fillRect(-2, -16, 16, 5);
  ctx.beginPath();
  ctx.moveTo(-1, -15);
  ctx.lineTo(-11, -13 + Math.sin(t * 0.3) * 3);
  ctx.lineTo(-10, -8 + Math.sin(t * 0.3) * 3);
  ctx.lineTo(0, -11);
  ctx.closePath();
  ctx.fill();
  // 頭
  circle(1, -30, 4.5, white, edge);
  circle(1, -30, 2, "#f4b6c2");
  circle(12, -29, 4.5, white, edge);
  circle(12, -29, 2, "#f4b6c2");
  circle(6, -21, 10, white, edge);
  oval(12, -18, 4.5, 3.5, "#ffffff", edge);
  oval(15, -19.5, 2, 1.5, "#222");
  if (dead) {
    xEye(9, -23, 2);
  } else {
    circle(9, -23, 1.7, "#222");
    line(6, -27.5, 11.5, -25.5, "#222", 1.6); // 怒りまゆげ
  }
}

function drawEnemy(e) {
  if (e.x + e.w < camX - 40 || e.x > camX + W + 40) return;
  ctx.save();
  ctx.translate(e.x + e.w / 2, e.y + e.h);
  if (e.dead) {
    ctx.translate(0, -e.h / 2);
    ctx.rotate(e.spin);
    ctx.translate(0, e.h / 2);
  }
  ctx.scale(e.facing, 1);
  drawShirokuma({ t: e.t, walking: e.active && e.onGround, dead: e.dead });
  ctx.restore();
}

// ボス：大きなシロクマ（赤白ボーダーの T シャツ）。原点は足元の中心、右向きで描く
function drawBigShirokuma({ state: s = "idle", t = 0, angry = false, down = false } = {}) {
  const white = "#f7fbff";
  const edge = "#a9bccf";
  const red = "#e63946";

  oval(-22, -12, 17, 13, white, edge);
  oval(22, -12, 17, 13, white, edge);
  circle(-36, -50, 13, white, edge); // 奥の腕

  // 体とボーダーの T シャツ
  oval(0, -46, 40, 36, white, edge);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, -46, 40, 36, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = red;
  for (let y = -80; y < -8; y += 14) ctx.fillRect(-45, y, 90, 7);
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(0, -46, 40, 36, 0, 0, Math.PI * 2);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 頭
  circle(-6, -112, 11, white, edge);
  circle(-6, -112, 5.5, "#f4b6c2");
  circle(26, -112, 11, white, edge);
  circle(26, -112, 5.5, "#f4b6c2");
  circle(10, -86, 30, white, edge);
  oval(28, -77, 14, 10, "#ffffff", edge);
  oval(37, -82, 6, 4.5, "#222");
  if (down) {
    xEye(16, -92, 4);
    xEye(31, -92, 4);
  } else {
    circle(16, -92, 3.5, "#222");
    circle(31, -92, 3.5, "#222");
    line(9, -101, 20, -97, "#222", 2.5);
    line(27, -97, 38, -101, "#222", 2.5);
  }
  // への字の口
  ctx.beginPath();
  ctx.moveTo(26, -69);
  ctx.quadraticCurveTo(32, -74, 38, -69);
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 2;
  ctx.stroke();

  if (angry && !down) {
    circle(2, -78, 5, "rgba(255, 90, 90, 0.55)");
    // 頭から湯気
    for (let i = 0; i < 3; i++) {
      const k = (t + i * 20) % 60;
      circle(-14 + i * 12, -118 - k * 0.6, 4 + k * 0.08, `rgba(255,255,255,${0.8 - k / 75})`);
    }
  }

  // 手前の腕。雪玉を投げるときは振りかぶる
  if (s === "throw") {
    circle(36, -96, 13, white, edge);
    circle(40, -110, 10, "#ffffff", "#9fb6cc");
  } else {
    circle(38, -48, 13, white, edge);
  }
}

function drawBoss(b) {
  if (b.state !== "down" && b.invincible > 0 && Math.floor(b.invincible / 3) % 2 === 0) return;
  ctx.save();
  ctx.translate(b.x + b.w / 2, b.y + b.h);
  if (b.state === "down") ctx.rotate(-b.facing * Math.min(b.t / 30, 1) * (Math.PI / 2)); // あおむけに倒れる
  if (b.state === "crouch") ctx.scale(1.08, 0.88);
  if (b.state === "air") ctx.scale(0.95, 1.06);
  ctx.scale(b.facing, 1);
  drawBigShirokuma({ state: b.state, t: b.t, angry: bossAngry(), down: b.state === "down" });
  ctx.restore();
  if (b.stun > 0 && b.state !== "down") drawDizzyStars(b.x + b.w / 2, b.y - 8, b.stun);
}

// 目を回しているときに頭の上をまわる星
function drawDizzyStars(cx, cy, t) {
  for (let i = 0; i < 3; i++) {
    const a = t * 0.12 + (i * Math.PI * 2) / 3;
    const x = cx + Math.cos(a) * 34;
    const y = cy + Math.sin(a) * 9;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 0.2);
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 4 : 9;
      const ang = (k * Math.PI) / 5 - Math.PI / 2;
      ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
    }
    ctx.closePath();
    ctx.fillStyle = "#ffd60a";
    ctx.fill();
    ctx.strokeStyle = "#b08900";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

function drawMiniBear(x, y) {
  circle(x - 8, y - 8, 5, "#9a6234");
  circle(x + 8, y - 8, 5, "#9a6234");
  circle(x, y, 11, "#9a6234");
  oval(x, y + 4, 5, 3.5, "#f1d9b5");
  circle(x - 4, y - 2, 1.5, "#1a1a1a");
  circle(x + 4, y - 2, 1.5, "#1a1a1a");
}

function drawHud() {
  if (state !== "title") {
    for (let i = 0; i < MAX_HP; i++) {
      heartPath(26 + i * 32, 26, 12);
      ctx.fillStyle = i < hp ? "#ff4d6d" : "rgba(0,0,0,0.25)";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    drawMiniBear(28, 62);
    text(`× ${Math.max(0, lives)}`, 46, 63, 18, "#fff", "left");

    // レーザーのたまり具合
    const ready = player.laserCool === 0;
    const gx = 84;
    const gy = 86;
    const gw = 96;
    text("レーザー", 14, gy + 6, 14, "#fff", "left");
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(gx, gy, gw, 11);
    ctx.fillStyle = ready ? (Math.floor(frame / 15) % 2 ? "#fff6c2" : "#ffd166") : "#7fd3ff";
    ctx.fillRect(gx, gy, gw * (1 - player.laserCool / LASER_COOLDOWN), 11);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(gx, gy, gw, 11);
    if (ready) text("OK!", gx + gw + 8, gy + 6, 14, "#ffd166", "left");
    text(`スコア ${score}`, W - 12, 22, 20, "#fff", "right");

    if (boss && bossPhase === "fight") {
      const gw = 260;
      const gx = W / 2 - gw / 2;
      text("大ボス シロクマ", W / 2, 18, 15, "#fff");
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(gx, 30, gw, 12);
      ctx.fillStyle = bossAngry() ? "#ff6b35" : "#e63946";
      ctx.fillRect(gx, 30, (gw * boss.hp) / BOSS_HP, 12);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.strokeRect(gx, 30, gw, 12);
    }
  }

  // 右上のボタン
  const button = (r, label) => {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    text(label, r.x + r.w / 2, r.y + r.h / 2 + 1, 15, "#fff");
  };
  button(MUTE_BTN, Sound.isMuted() ? "♪×" : "♪");
  if (state === "playing") button(PAUSE_BTN, paused ? "▶" : "Ⅱ");
}

function dim(alpha = 0.45) {
  ctx.fillStyle = `rgba(10, 25, 15, ${alpha})`;
  ctx.fillRect(0, 0, W, H);
}

function drawOverlay() {
  const startKey = isTouchDevice ? "タップ" : "スペース / Enter / クリック";
  const blink = Math.floor(frame / 30) % 2 === 0;

  if (state === "title") {
    dim(0.35);
    // タイトルのキャラクターたち
    ctx.save();
    ctx.translate(170, 380);
    ctx.scale(2.6, 2.6);
    const c = Math.floor(frame / 2) % 50; // ときどきパンチしてみせる
    drawKuma({ walk: frame * 0.1, punch: c < PUNCH_FRAMES ? PUNCH_FRAMES - c : 0 });
    ctx.restore();
    ctx.save();
    ctx.translate(640, 380);
    ctx.scale(-1.1, 1.1);
    drawBigShirokuma({ t: frame });
    ctx.restore();
    ctx.save();
    ctx.translate(520, 380);
    ctx.scale(-1.6, 1.6);
    drawShirokuma({ t: frame });
    ctx.restore();

    text("クマクマ大冒険", W / 2, 140, 64, "#ffd166");
    if (blink) text(`${startKey} でスタート`, W / 2, 236, 22, "#ffffff");
    text(
      isTouchDevice ? "◀ ▶：移動　ジャンプ　パンチ　レーザー" : "← →：移動　スペース：ジャンプ　Z：パンチ　C：レーザー",
      W / 2, 274, 16, "#e8ffe0",
    );
    text(`ハイスコア ${highScore}`, W / 2, 304, 16, "#e8ffe0");
    return;
  }

  if (state === "playing" && warningTimer > 0 && Math.floor(warningTimer / 10) % 2 === 0) {
    text("WARNING!", W / 2, 150, 48, "#ff4d4d");
    text("大ボス シロクマ があらわれた！", W / 2, 200, 22, "#ffffff");
  }

  if (state === "playing" && paused) {
    dim();
    text("一時停止中", W / 2, H / 2 - 10, 40);
    text(isTouchDevice ? "タップで再開" : "P で再開", W / 2, H / 2 + 36, 18);
  }

  if (state === "miss" && stateTimer > 40 && lives > 0) {
    text(`のこり × ${lives}`, W / 2, H / 2, 32);
  }

  if (state === "gameover") {
    dim(0.6);
    text("ゲームオーバー", W / 2, 160, 48, "#ff6b6b");
    text(`スコア ${score}`, W / 2, 230, 24);
    text(`ハイスコア ${highScore}`, W / 2, 266, 18, "#e8ffe0");
    if (blink && performance.now() - stateChangedAt > 1500) text(`${startKey} でもう一度`, W / 2, 330, 20);
  }

  if (state === "clear") {
    dim(0.45);
    text("ステージクリア！", W / 2, 120, 52, "#ffd166");
    text(`タイムボーナス（${clearBonus.seconds} 秒）  +${clearBonus.time}`, W / 2, 190, 20);
    text(`のこりクマボーナス  +${clearBonus.lives}`, W / 2, 222, 20);
    text(`スコア ${score}`, W / 2, 270, 30);
    text(`ハイスコア ${highScore}`, W / 2, 308, 18, "#e8ffe0");
    if (blink && performance.now() - stateChangedAt > 1500) text(`${startKey} でもう一度あそぶ`, W / 2, 360, 20);
  }
}

// ---- メインループ（60fps 固定で更新し、画面のリフレッシュレートに左右されないようにする） ----
setupWorld();
let last = performance.now();
let acc = 0;
const STEP = 1000 / 60;
function loop(now) {
  acc += Math.min(now - last, 100);
  last = now;
  while (acc >= STEP) {
    update();
    acc -= STEP;
  }
  draw();
  updateLaserButton();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
