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
const BOSS_STUN = 180; // 踏まれたボスが動けなくなる時間（3 秒）

const LEVEL_COLS = 200;
const LEVEL_W = LEVEL_COLS * T;
const ARENA_X = LEVEL_W - W; // ボス部屋（ステージの右端の 1 画面）の左端
const GROUND_Y = 10 * T; // ふつうの地面の高さ

// ステージごとの設定。1 面は森とシロクマ、2 面は竹林とパンダ、3 面は海の底とサメ
const STAGES = {
  1: { title: "森のシロクマ", music: "forest", bossName: "大ボス シロクマ", bossHp: 16 },
  2: { title: "竹林のパンダ", music: "bamboo", bossName: "大ボス パンダ", bossHp: 20 },
  3: { title: "海の底のサメ", music: "sea", bossName: "大ボス サメ", bossHp: 22 },
};
const LAST_STAGE = 3;
// URL に ?stage=2 や ?stage=3 をつけるとその面から始められる（動作確認用）
const START_STAGE = (() => {
  const n = Number(new URLSearchParams(location.search).get("stage"));
  return STAGES[n] ? n : 1;
})();

// 3 面は水の中：重力が弱く、落ちるのもゆっくり。ジャンプの初速も下げるので、
// 高さは陸とほぼ同じ（少し高い）まま、ふわっと長く浮いて遠くまで跳べる
const WATER_GRAVITY = 0.3;
const WATER_MAX_FALL = 5;
const WATER_JUMP_SCALE = 0.75; // 跳ぶ・はね返るときの速さにかける倍率
const inWater = () => stage === 3;
const gravity = () => (inWater() ? WATER_GRAVITY : GRAVITY);
const maxFall = () => (inWater() ? WATER_MAX_FALL : MAX_FALL);
const jumpScale = () => (inWater() ? WATER_JUMP_SCALE : 1);

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
let stage = START_STAGE;
let stageIntro = 0; // ステージ開始時に名前を出す時間
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
  else if ((state === "gameover" || state === "clear") && performance.now() - stateChangedAt > 1500) {
    if (state === "clear" && stage < LAST_STAGE) nextStage();
    else if (state === "gameover") startGame(stage); // コンティニュー：やられたステージの最初から
    else startGame();
  }
}

function togglePause() {
  if (state !== "playing") return;
  paused = !paused;
  Sound.setPaused(paused);
}

// ---- ステージ ----
// tiles[行][列]。"#" は地面（すべての方向から乗れない）、"-" は木の足場（下からすり抜けて上に乗れる）
function buildLevel(n) {
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
  const flag = (c) => flagCols.push(c);
  const layout = { 1: layoutStage1, 2: layoutStage2, 3: layoutStage3 }[n];
  layout({ ground, plank, enemy, honey, heart, flag });
  for (let r = 0; r < 10; r++) set(LEVEL_COLS - 1, r, "#"); // ボス部屋の右の壁

  return { tiles, enemySpawns, itemSpawns, flagCols };
}

// 1 面：森
function layoutStage1({ ground, plank, enemy, honey, heart, flag }) {
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
  flag(95);

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
  flag(175);
}

// 2 面：竹林。穴や段差が増え、敵も多い
function layoutStage2({ ground, plank, enemy, honey, heart, flag }) {
  // 1. 竹林の入り口
  ground(0, 28);
  honey(7, 8, 3);
  plank(11, 7, 3);
  honey(11, 6, 3);
  enemy(16);
  enemy(23, "jump");

  // 2. 段差と穴
  ground(31, 45);
  ground(36, 37, 8);
  honey(36, 7, 2);
  enemy(41);
  enemy(44, "jump");
  plank(46, 7, 3); // 穴の上の足場
  honey(46, 6, 3);

  // 3. 階段
  ground(49, 70);
  ground(55, 56, 9);
  ground(57, 58, 8);
  ground(59, 60, 7);
  heart(60, 5);
  enemy(52);
  enemy(64, "jump");
  enemy(68);

  // 4. 宙に浮いた足場
  ground(71, 90);
  flag(74);
  plank(80, 7, 3);
  plank(84, 5, 3);
  honey(84, 4, 3);
  enemy(79);
  enemy(86, "jump");
  enemy(89);

  // 5. 小さな島が続くところ
  ground(93, 95);
  honey(94, 8);
  ground(98, 100, 9);
  enemy(99, "walk", 8);
  ground(103, 105, 8);
  honey(104, 6);
  ground(108, 110);
  enemy(109);

  // 6. 竹の上の足場
  ground(113, 150);
  plank(118, 7, 3);
  plank(122, 5, 3);
  plank(126, 3, 3);
  honey(126, 2, 3);
  plank(131, 5, 3);
  heart(132, 4);
  enemy(120);
  enemy(125, "jump");
  enemy(130);
  flag(138);
  enemy(142, "jump");
  enemy(146);
  plank(151, 7, 3); // 穴の上の足場

  // 7. ボスの手前とボス部屋
  ground(154, LEVEL_COLS - 1);
  enemy(158, "jump");
  enemy(162);
  enemy(166, "jump");
  enemy(169);
  honey(170, 8, 3);
  flag(175);
}

// 3 面：海の底。水の中なのでジャンプがゆっくりで遠くまで跳べるぶん、穴（海溝）は広め。
// 敵はカニ（歩く）・クラゲ（ふわふわ跳ねる）・ミニザメ（宙を泳ぐ）
function layoutStage3({ ground, plank, enemy, honey, heart, flag }) {
  // 1. 浅瀬（水の中の動きに慣れる）
  ground(0, 26);
  honey(8, 7, 3);
  plank(12, 6, 3);
  honey(12, 5, 3);
  enemy(17);
  enemy(23, "jump");

  // 2. 海溝をとびこえる
  ground(32, 46);
  enemy(36, "fish", 6);
  ground(40, 41, 8);
  honey(40, 7, 2);
  enemy(44);
  plank(49, 7, 3); // 穴の上の岩場
  honey(49, 6, 3);

  // 3. 岩の段々
  ground(55, 90);
  enemy(58, "jump");
  enemy(62, "fish", 5);
  plank(64, 6, 4);
  heart(65, 5);
  enemy(69);
  flag(72);
  ground(78, 79, 9);
  ground(80, 81, 8);
  ground(82, 83, 7);
  ground(84, 85, 6);
  honey(84, 5, 2);
  enemy(88);

  // 4. 魚が泳ぐ深い海溝
  plank(93, 7, 3);
  honey(93, 6, 3);
  enemy(95, "fish", 8);
  ground(99, 120);
  enemy(102);
  enemy(107, "jump");
  enemy(111, "fish", 6);
  enemy(115);
  flag(118);

  // 5. 高い岩場
  ground(121, 150);
  plank(126, 7, 3);
  plank(131, 4, 3);
  plank(136, 2, 4);
  honey(136, 1, 4);
  plank(142, 5, 3);
  heart(143, 4);
  enemy(128, "fish", 8);
  enemy(134);
  enemy(140, "jump");
  enemy(147, "fish", 6);
  plank(152, 7, 3); // 穴の上の岩場

  // 6. ボスの手前とボス部屋
  ground(156, LEVEL_COLS - 1);
  enemy(160, "jump");
  enemy(164, "fish", 6);
  enemy(167);
  enemy(170, "fish", 4);
  honey(172, 8, 3);
  flag(175);
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
  e.vy = Math.min(e.vy + gravity(), maxFall());
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
  level = buildLevel(stage);
  items = level.itemSpawns.map((s) => ({ x: s.c * T + T / 2, y: s.r * T + T / 2, kind: s.kind, taken: false }));
  flags = level.flagCols.map((c) => ({ x: c * T + T / 2, reached: false }));
  checkpointX = 2 * T;
  particles = [];
  popups = [];
  respawn();
}

// from：始めるステージ。ゲームオーバー後のコンティニューでは、やられたステージを渡す
function startGame(from = START_STAGE) {
  stage = from;
  score = 0;
  lives = START_LIVES;
  beginStage();
}

// 次のステージへ。スコアと残りのクマはそのまま引きつぐ
function nextStage() {
  stage++;
  beginStage();
}

function beginStage() {
  setupWorld();
  playFrames = 0;
  clearBonus = null;
  paused = false;
  stageIntro = 150;
  state = "playing";
  Sound.setPaused(false);
  Sound.playMusic(STAGES[stage].music);
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
  Sound.playMusic(STAGES[stage].music);
}

function makeEnemy(s) {
  const fish = s.kind === "fish";
  const w = fish ? 34 : 30;
  const h = fish ? 20 : 28;
  const x = s.c * T + (T - w) / 2;
  const y = (s.r + 1) * T - h;
  return {
    x, y, w, h, vx: 0, vy: 0, homeX: x, baseY: y,
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

// 水の中の泡。ほかの粒とちがって、ゆらゆらしながら上にのぼっていく
function bubbleFx(x, y, count = 1) {
  for (let i = 0; i < count; i++) {
    const life = rand(50, 80);
    particles.push({ x: x + rand(-4, 4), y, vx: rand(-0.3, 0.3), vy: rand(-1.2, -0.4), life, max: life, color: "#dff6ff", size: rand(2.5, 5), bubble: true });
  }
}

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
  if (stageIntro > 0) stageIntro--;
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
    p.vy = JUMP_SPEED * jumpScale();
    p.coyote = 0;
    p.jumpCut = false;
    jumpBuffer = 0;
    Sound.jump();
    dust(p.x + p.w / 2, p.y + p.h);
    if (inWater()) bubbleFx(p.x + p.w / 2, p.y + 10, 4);
  }
  if (!p.jumpCut && p.vy < 0 && !holdJump()) {
    p.vy = Math.max(p.vy, -5 * jumpScale());
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
  if (inWater() && frame % 40 === 0) bubbleFx(p.x + p.w / 2 + p.facing * 10, p.y + 6); // 水の中ではときどき口から泡が出る
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
      e.vy += gravity();
      e.y += e.vy;
      e.spin += 0.3 * Math.sign(e.vx);
      if (e.y > H + 100) e.gone = true;
      continue;
    }

    if (e.kind === "fish") {
      // ミニザメ：地面に関係なく、生まれた場所の左右を波打ちながら泳いで行き来する
      const range = 2.5 * T;
      e.x += e.facing * 1.4;
      if (Math.abs(e.x - e.homeX) > range) {
        e.x = e.homeX + Math.sign(e.x - e.homeX) * range;
        e.facing = -e.facing;
      }
      e.y = e.baseY + Math.sin(e.t * 0.05) * 14;
    } else {
      if (e.kind === "jump" && e.onGround && --e.jumpTimer <= 0) {
        e.vy = -10 * jumpScale();
        e.jumpTimer = 90 + Math.random() * 60;
      }
      e.vx = e.facing * (e.kind === "jump" ? 1.2 : 1);
      if (moveEntity(e)) e.facing = -e.facing;
      else if (e.onGround && !groundAhead(e)) e.facing = -e.facing; // 崖の手前で引き返す
    }
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
        p.vy = (holdJump() ? -12 : -8) * jumpScale();
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
  e.vy = -7 * jumpScale();
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
  p.vy = -6 * jumpScale();
}

// ミス：その場で飛び上がって画面の下へ落ちていく（穴に落ちたときはそのまま）
function miss(fell) {
  if (state !== "playing") return;
  state = "miss";
  stateTimer = 0;
  hp = 0;
  lives--;
  player.vx = 0;
  player.vy = fell ? 0 : -10 * jumpScale();
  player.punch = 0;
  Sound.stopMusic();
  Sound.miss();
}

function updateMiss() {
  stateTimer++;
  const p = player;
  if (stateTimer > 25) {
    p.vy += gravity() * 0.8;
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

// ---- ボス：1 面は大きなシロクマ、2 面は大きなパンダ、3 面は大きなサメ ----
// ボス部屋に入ると登場。シロクマとパンダは歩く・大ジャンプ（着地で衝撃波）・投げる（雪玉／タケノコ）をくり返す。
// パンダはさらに、丸まって部屋の端から端まで転がってくる。
// サメは水の中を泳ぎ回り、突進・急降下（海底に着くと衝撃波）・泡はきをくり返す。体力が半分を切ると怒って速くなる
const SHARK_W = 140;
const SHARK_H = 64;
const SHARK_FLOOR_Y = GROUND_Y - SHARK_H; // サメが海底に着いたときの y
const SHARK_HOVER_Y = SHARK_FLOOR_Y - 110; // ふだん泳いでいる高さ
const SHARK_TOP_Y = 70; // 急降下の前にのぼる高さ
const sharkMinX = () => ARENA_X + 10;
const sharkMaxX = () => ARENA_X + W - T - SHARK_W - 10;

function startBoss() {
  bossPhase = "fight";
  warningTimer = 150;
  Sound.playMusic("boss");
  Sound.warning();
  const shark = stage === 3;
  boss = {
    // サメは右の画面の外から泳いでくる。シロクマとパンダは上から落ちてくる
    x: shark ? ARENA_X + W + 20 : ARENA_X + W - 200,
    y: shark ? SHARK_HOVER_Y : -220,
    w: shark ? SHARK_W : 92, h: shark ? SHARK_H : 108, vx: 0, vy: 0,
    hp: STAGES[stage].bossHp, maxHp: STAGES[stage].bossHp, state: "enter", t: 0, facing: -1, invincible: 0,
    onGround: false, last: "", angryShown: false, stun: 0, bounces: 0, landed: 0,
  };
}

const bossAngry = () => boss.hp <= boss.maxHp / 2;

// ボスの当たり判定（絵より少し小さめ）
function bossBody(b) {
  if (stage === 3) return { x: b.x + 14, y: b.y + 8, w: b.w - 28, h: b.h - 12 };
  return { x: b.x + 8, y: b.y + 10, w: b.w - 16, h: b.h - 10 };
}

function setBossState(name) {
  boss.state = name;
  boss.t = 0;
}

function nextBossAction() {
  const moves = {
    1: ["walk", "crouch", "throw"],
    2: ["walk", "crouch", "throw", "roll"],
    3: ["dash", "dive", "bubble"],
  }[stage];
  const choices = moves.filter((c) => c !== boss.last); // 同じ技を続けない
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
    if (stage === 3) b.y += (90 - b.y) * 0.02; // サメはおなかを上にして、ぷかぷか浮かんでいく
    else moveEntity(b);
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
  if (stage === 3) updateShark(b, angry, toPlayer);
  else updateLandBoss(b, angry, toPlayer);

  if (state !== "playing") return;
  const fist = punchHitbox();
  const beam = laserHitbox();
  const body = bossBody(b);
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
      p.vy = -11 * jumpScale();
      p.vx = (p.x + p.w / 2 < b.x + b.w / 2 ? -1 : 1) * 4;
      p.hurtTimer = 10;
      p.jumpCut = true;
    } else {
      hurt(b.x + b.w / 2);
    }
  }
}

// 1 面・2 面のボス（地面の上で戦う）
function updateLandBoss(b, angry, toPlayer) {
  const p = player;
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
    case "roll": // パンダだけの技：丸まってためてから転がる。壁で 2 回はね返ったら止まる
      if (b.t === 1) {
        b.facing = toPlayer;
        b.bounces = 0;
      }
      b.vx = b.t < 30 ? 0 : b.facing * (angry ? 9 : 7);
      if (b.t > 200) setBossState("idle");
      break;
  }

  let hitWall = moveEntity(b);
  if (b.x < ARENA_X) {
    b.x = ARENA_X;
    hitWall = true;
  }
  if (hitWall && b.state === "walk") b.facing = -b.facing;
  if (hitWall && b.state === "roll" && b.vx !== 0) {
    b.facing = -b.facing;
    shake = 10;
    Sound.stomp(true);
    if (++b.bounces >= 2) setBossState("idle");
  }

  // 着地したら地面が揺れる。大ジャンプのあとは左右に衝撃波が走る
  if (b.onGround && !wasOnGround && (b.state === "enter" || b.state === "air")) {
    shake = 18;
    Sound.stomp(true);
    for (let i = 0; i < 3; i++) dust(b.x + rand(0, b.w), b.y + b.h);
    if (b.state === "air" && b.stun === 0) shockwaves(b, angry);
    setBossState("idle");
  }
}

// ボスの左右に衝撃波を走らせる
function shockwaves(b, angry) {
  const speed = angry ? 6.5 : 5;
  waves.push({ x: b.x - 4, y: b.y + b.h, dir: -1, speed });
  waves.push({ x: b.x + b.w + 4, y: b.y + b.h, dir: 1, speed });
}

// 3 面のボス：サメ。重力に関係なく泳ぎ回る。踏まれると目を回して海底に沈む
function updateShark(b, angry, toPlayer) {
  const p = player;
  const minX = sharkMinX();
  const maxX = sharkMaxX();
  const bob = Math.sin(frame * 0.08) * 0.6; // ふだんは少し上下にゆれながら泳ぐ
  if (frame % 14 === 0) bubbleFx(b.x + b.w / 2 - b.facing * 60, b.y + 20);

  if (b.stun > 0) {
    b.stun--;
    b.t = 0;
    b.vy = Math.min(b.vy + WATER_GRAVITY, WATER_MAX_FALL);
    b.y = Math.min(b.y + b.vy, SHARK_FLOOR_Y);
    return;
  }

  switch (b.state) {
    case "enter": // 右の画面の外から泳いでくる
      b.facing = -1;
      b.x -= 3;
      if (b.x <= maxX) setBossState("idle");
      return; // 入ってくるまでは部屋の範囲に収めない
    case "idle":
      b.facing = toPlayer;
      b.y += (SHARK_HOVER_Y - b.y) * 0.05 + bob;
      if (b.t > (angry ? 25 : 45)) nextBossAction();
      break;
    case "dash": {
      // 体をふるわせながらプレイヤーの高さに合わせてため、そのあとまっすぐ突進。壁に着いたら止まる
      const charge = angry ? 30 : 42;
      if (b.t <= charge) {
        b.facing = toPlayer;
        const targetY = clamp(p.y + p.h / 2 - b.h / 2, SHARK_TOP_Y, SHARK_FLOOR_Y);
        b.y += (targetY - b.y) * 0.08;
      } else {
        b.x += b.facing * (angry ? 10 : 8);
        if (b.x <= minX || b.x >= maxX) {
          shake = 10;
          Sound.stomp(true);
          setBossState("idle");
        }
      }
      break;
    }
    case "dive": {
      // 上にのぼってプレイヤーの真上へ → 少し止まる → 真下へ急降下。海底に着くと左右に衝撃波
      const rise = 50;
      const hold = angry ? 10 : 18;
      if (b.t === 1) {
        b.vy = 0;
        b.landed = 0;
      }
      if (b.t <= rise) {
        b.facing = toPlayer;
        b.x += (clamp(p.x + p.w / 2 - b.w / 2, minX, maxX) - b.x) * 0.06;
        b.y += (SHARK_TOP_Y - b.y) * 0.08;
      } else if (b.t > rise + hold && !b.landed) {
        b.vy = Math.min(b.vy + 0.8, angry ? 12 : 10);
        b.y += b.vy;
        if (b.y >= SHARK_FLOOR_Y) {
          b.y = SHARK_FLOOR_Y;
          b.vy = 0;
          b.landed = b.t;
          shake = 18;
          Sound.stomp(true);
          for (let i = 0; i < 3; i++) dust(b.x + rand(0, b.w), GROUND_Y);
          shockwaves(b, angry);
        }
      } else if (b.landed && b.t > b.landed + (angry ? 30 : 45)) {
        setBossState("idle"); // 海底で少し止まるので、そのすきに踏んだりパンチしたりできる
      }
      break;
    }
    case "bubble": {
      // 口から泡をはく。泡はまっすぐ飛んでくるので、パンチやレーザーで割れる
      b.facing = toPlayer;
      b.y += (SHARK_HOVER_Y - b.y) * 0.05 + bob;
      const shootAt = angry ? [20, 34, 48] : [24, 46];
      if (shootAt.includes(b.t)) shootBubble(angry ? 3.8 : 3);
      if (b.t > (angry ? 70 : 66)) setBossState("idle");
      break;
    }
  }
  b.x = clamp(b.x, minX, maxX);
  b.y = clamp(b.y, SHARK_TOP_Y - 10, SHARK_FLOOR_Y);
}

function shootBubble(speed) {
  const b = boss;
  const p = player;
  const sx = b.x + b.w / 2 + b.facing * 66;
  const sy = b.y + b.h - 22;
  const dx = p.x + p.w / 2 - sx;
  const dy = p.y + p.h / 2 - sy;
  const len = Math.hypot(dx, dy) || 1;
  snowballs.push({ x: sx, y: sy, r: 13, g: 0, kind: "bubble", vx: (dx / len) * speed, vy: (dy / len) * speed });
  Sound.bubble();
}

function stunBoss() {
  const b = boss;
  b.stun = BOSS_STUN;
  if (stage === 3) {
    setBossState("idle"); // サメは泳ぐのをやめて海底へ沈む
    b.vy = 0;
  } else if (b.onGround) {
    setBossState("idle");
  }
  popups.push({ x: b.x + b.w / 2, y: b.y - 20, text: "ピヨピヨ…", life: 60 });
}

// 雪玉を山なりに投げる。flight フレームでプレイヤーのいる場所に届く
function throwSnowball(flight) {
  const kind = stage === 2 ? "takenoko" : "snow";
  const b = boss;
  const p = player;
  const sx = b.x + b.w / 2 + b.facing * 40;
  const sy = b.y + 2;
  const g = 0.35;
  const dx = p.x + p.w / 2 - sx;
  const dy = p.y + p.h / 2 - sy;
  snowballs.push({
    x: sx, y: sy, r: 11, g, kind,
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
  Sound.stopMusic();
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
      // 雪玉・タケノコ・泡はパンチやレーザーで壊せる
      s.gone = true;
      burst(s.x, s.y, projColor(s), 10, 3);
      addScore(50, s.x, s.y);
      Sound.hit();
    } else if (overlap(p, box)) {
      s.gone = true;
      burst(s.x, s.y, projColor(s), 10, 3);
      hurt(s.x);
    } else if (
      tileAt(Math.floor(s.x / T), Math.floor((s.y + s.r) / T)) === "#" ||
      s.y > H || s.y < -30 || s.x < ARENA_X - 30 || s.x > ARENA_X + W + 30
    ) {
      s.gone = true;
      burst(s.x, s.y, projColor(s), 8, 2);
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

const projColor = (s) => ({ takenoko: "#d39a55", bubble: "#bfe9ff" })[s.kind] || "#ffffff";

function updateParticles() {
  for (const q of particles) {
    q.x += q.vx;
    q.y += q.vy;
    if (q.bubble) {
      q.vy = Math.max(q.vy - 0.02, -1.6);
      q.x += Math.sin((q.life + q.size * 10) * 0.15) * 0.3;
    } else {
      q.vy += 0.15;
    }
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
    if (s.kind === "takenoko") {
      drawTakenoko(s.x, s.y, s.r, frame * 0.25);
    } else if (s.kind === "bubble") {
      drawBigBubble(s.x, s.y, s.r);
    } else {
      circle(s.x, s.y, s.r, "#ffffff", "#9fb6cc");
      circle(s.x - 3, s.y - 3, 3, "#e8f2ff");
    }
  }
  if (state !== "title") {
    drawPlayer();
    drawLaser();
  }
  for (const q of particles) {
    ctx.globalAlpha = Math.max(0, q.life / q.max);
    if (q.bubble) {
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size, 0, Math.PI * 2);
      ctx.strokeStyle = q.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      circle(q.x - q.size * 0.35, q.y - q.size * 0.35, q.size * 0.3, "rgba(255,255,255,0.8)");
    } else {
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
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

// 背景：空・雲・遠くの山・森の木（2 面は竹、3 面は海の中）。奥ほどゆっくり動いて奥行きを出す
function drawBackground(cx) {
  if (inWater()) {
    drawSea(cx);
    return;
  }
  const bamboo = stage === 2;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, bamboo ? "#9fd8c8" : "#74c3ef");
  sky.addColorStop(0.7, bamboo ? "#d8f0d0" : "#c9eedb");
  sky.addColorStop(1, bamboo ? "#eef7d8" : "#e6f5d0");
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
  drawHills(cx * 0.2, 280, 40, bamboo ? "#9cc9a0" : "#a8d8b0");
  drawHills(cx * 0.32 + 900, 320, 30, bamboo ? "#79b385" : "#86c493");

  if (bamboo) {
    drawBambooGrove(cx * 0.35, 70, 8, "#8cc78a", "#76b174");
    drawBambooGrove(cx * 0.5 + 40, 95, 13, "#5fae5f", "#478f49");
    return;
  }

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

// なだらかな山（3 面では海の底の岩山）
function drawHills(offset, base, amp, color) {
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
}

// 3 面の背景：海の中。水面のゆらめき・差しこむ光・遠くの岩山・ゆれる海藻とサンゴ・のぼっていく泡
function drawSea(cx) {
  const sea = ctx.createLinearGradient(0, 0, 0, H);
  sea.addColorStop(0, "#4fb3e0");
  sea.addColorStop(0.55, "#2278b3");
  sea.addColorStop(1, "#155386");
  ctx.fillStyle = sea;
  ctx.fillRect(-20, -20, W + 40, H + 40);

  // 水面のゆらめき
  ctx.beginPath();
  ctx.moveTo(-20, -20);
  for (let x = -20; x <= W + 20; x += 16) {
    ctx.lineTo(x, 10 + Math.sin((x + cx * 0.3) * 0.03 + frame * 0.05) * 4);
  }
  ctx.lineTo(W + 20, -20);
  ctx.closePath();
  ctx.fillStyle = "rgba(220, 245, 255, 0.55)";
  ctx.fill();

  // 水面から差しこむ光の帯
  const rayGap = 260;
  const rayOffset = cx * 0.1;
  for (let k = Math.floor(rayOffset / rayGap) - 1; k < Math.floor(rayOffset / rayGap) + 5; k++) {
    const x = k * rayGap - rayOffset + hash(k + 31) * 80;
    const w = 40 + hash(k + 37) * 50;
    const a = 0.07 + Math.sin(frame * 0.02 + k) * 0.03;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + w, 0);
    ctx.lineTo(x + w + 120, H);
    ctx.lineTo(x + 60, H);
    ctx.closePath();
    ctx.fillStyle = `rgba(255, 255, 230, ${a})`;
    ctx.fill();
  }

  // 遠くの岩山
  drawHills(cx * 0.2, 300, 45, "#1d6496");
  drawHills(cx * 0.32 + 900, 345, 30, "#185782");

  // 海藻とサンゴ
  const weedGap = 95;
  const weedOffset = cx * 0.5;
  for (let k = Math.floor(weedOffset / weedGap) - 1; k < Math.floor(weedOffset / weedGap) + W / weedGap + 2; k++) {
    const x = k * weedGap - weedOffset + hash(k + 41) * 40;
    if (hash(k + 43) > 0.7) {
      drawCoral(x, GROUND_Y, hash(k + 47) > 0.5 ? "#ff8fa3" : "#ffb86b");
      continue;
    }
    const h = 90 + hash(k + 53) * 110;
    const color = hash(k + 59) > 0.5 ? "#2f9e6e" : "#3cb47c";
    for (let j = 0; j < 2; j++) {
      const bx = x + j * 10;
      ctx.beginPath();
      ctx.moveTo(bx, GROUND_Y);
      for (let y = 0; y <= h; y += 10) {
        const sway = Math.sin(frame * 0.03 + y * 0.04 + k + j) * (y / h) * 12;
        ctx.lineTo(bx + sway + Math.sin(y * 0.15 + j) * 3, GROUND_Y - y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 7 - j * 2;
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }

  // のぼっていく泡
  for (let i = 0; i < 16; i++) {
    const x = (((hash(i + 61) * 1400 - cx * 0.4) % W) + W) % W;
    const y = H + 20 - ((frame * (0.4 + hash(i + 67) * 0.5) + hash(i + 71) * H) % (H + 40));
    const r = 2 + hash(i + 73) * 4;
    ctx.beginPath();
    ctx.arc(x + Math.sin(frame * 0.05 + i) * 3, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(220, 245, 255, 0.5)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

// 枝分かれしたサンゴ
function drawCoral(x, y, color) {
  const branch = (bx, by, len, ang, depth) => {
    const ex = bx + Math.cos(ang) * len;
    const ey = by + Math.sin(ang) * len;
    line(bx, by, ex, ey, color, 3 + depth * 2);
    if (depth > 0) {
      branch(ex, ey, len * 0.7, ang - 0.5, depth - 1);
      branch(ex, ey, len * 0.7, ang + 0.5, depth - 1);
    } else {
      circle(ex, ey, 3, color);
    }
  };
  branch(x, y, 26, -Math.PI / 2, 2);
}

// ボスのサメがはく大きな泡
function drawBigBubble(x, y, r) {
  const wob = Math.sin(frame * 0.3 + x * 0.05) * 1.5;
  ctx.beginPath();
  ctx.ellipse(x, y, r + wob, r - wob, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(190, 235, 255, 0.35)";
  ctx.fill();
  ctx.strokeStyle = "#e6f8ff";
  ctx.lineWidth = 2;
  ctx.stroke();
  circle(x - r * 0.35, y - r * 0.35, r * 0.25, "rgba(255,255,255,0.85)");
}

// 竹の林。offset：スクロール量、gap：竹の間隔、w：太さ
function drawBambooGrove(offset, gap, w, color, joint) {
  for (let k = Math.floor(offset / gap) - 1; k < Math.floor(offset / gap) + W / gap + 2; k++) {
    const x = k * gap - offset + hash(k + 5) * gap * 0.5;
    const lean = (hash(k + 9) - 0.5) * 0.06;
    ctx.save();
    ctx.translate(x, GROUND_Y);
    ctx.rotate(lean);
    ctx.fillStyle = color;
    ctx.fillRect(-w / 2, -GROUND_Y - 30, w, GROUND_Y + 30);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(-w / 2 + 2, -GROUND_Y - 30, w * 0.25, GROUND_Y + 30);
    // 竹の節
    const seg = 54 + hash(k + 13) * 20;
    for (let y = -seg; y > -GROUND_Y - 30; y -= seg) {
      ctx.fillStyle = joint;
      ctx.fillRect(-w / 2 - 1, y, w + 2, 3);
    }
    // 笹の葉
    for (let i = 0; i < 3; i++) {
      const ly = -GROUND_Y + 40 + hash(k * 3 + i) * 140;
      const side = i % 2 ? 1 : -1;
      ctx.save();
      ctx.translate(side * w * 0.5, ly);
      ctx.rotate(side * 0.5);
      oval(side * 12, 0, 13, 3.5, joint);
      oval(side * 10, 7, 11, 3, joint);
      ctx.restore();
    }
    ctx.restore();
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
      if (t === "#" && inWater()) {
        // 海の底の砂
        ctx.fillStyle = "#d8b878";
        ctx.fillRect(x, y, T, T);
        ctx.fillStyle = "#bf9b5c";
        ctx.fillRect(x + 6 + hash(c * 13 + r) * 22, y + 14 + hash(c + r * 7) * 18, 5, 3);
        ctx.fillRect(x + 4 + hash(c * 5 + r * 3) * 26, y + 8 + hash(c * 3 + r) * 24, 3, 3);
        if (tileAt(c, r - 1) !== "#") {
          ctx.fillStyle = "#f0d9a0";
          ctx.fillRect(x, y, T, 8);
          for (let i = 0; i < 4; i++) circle(x + 5 + i * 10, y + 8, 4, "#f0d9a0");
          if (hash(c * 7 + r) > 0.8) {
            // ときどき貝がら
            oval(x + 20, y + 5, 6, 4, "#ffd0dc", "#d68aa0");
            line(x + 20, y + 1.5, x + 20, y + 8.5, "#d68aa0", 1);
          }
        }
      } else if (t === "#") {
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
      } else if (t === "-" && inWater()) {
        // 岩の足場（上にサンゴ）
        ctx.fillStyle = "#6f7f99";
        ctx.beginPath();
        ctx.roundRect(x, y, T, 15, 5);
        ctx.fill();
        ctx.fillStyle = "#93a3bd";
        ctx.fillRect(x + 3, y + 2, T - 6, 3);
        circle(x + 10 + hash(c) * 20, y + 1, 3.5, hash(c + 3) > 0.5 ? "#ff8fa3" : "#ffb86b");
      } else if (t === "-" && stage === 2) {
        // 竹の足場
        ctx.fillStyle = "#6dbb5a";
        ctx.fillRect(x, y + 1, T, 12);
        ctx.fillStyle = "#a6e08f";
        ctx.fillRect(x, y + 3, T, 3);
        ctx.fillStyle = "#3f7f34";
        ctx.fillRect(x + T - 3, y, 3, 14); // 節
        ctx.strokeStyle = "#3f7f34";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.75, y + 1.75, T - 1.5, 11);
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
    ctx.fillStyle = inWater() ? "rgba(240, 217, 160, 0.9)" : "rgba(255,255,255,0.9)"; // 水の中では砂けむり
    ctx.fill();
    ctx.strokeStyle = inWater() ? "#bf9b5c" : "#9fb6cc";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// 主人公：茶色のクマ（赤いボクシンググローブでパンチ）。原点は足元の中心、右向きで描く
// tank：背中に酸素ボンベを背負う（3 面だけ。見た目だけで、ゲームの動きには関係しない）
function drawKuma({ walk = 0, air = false, punch = 0, laser = false, dizzy = false, tank = false } = {}) {
  const fur = "#9a6234";
  const dark = "#7a4a26";
  const light = "#f1d9b5";
  const pink = "#f4a6a6";
  const step = Math.sin(walk) * 4;

  // 足
  oval(-6 + (air ? -2 : step), -4, 6, 4.5, dark);
  oval(6 + (air ? 3 : -step), -4, 6, 4.5, dark);
  // 酸素ボンベ（体の後ろ）
  if (tank) {
    ctx.fillStyle = "#555";
    ctx.fillRect(-16.5, -40, 5, 5); // バルブ
    ctx.fillRect(-18.5, -41, 9, 2.5);
    ctx.beginPath();
    ctx.roundRect(-21, -36, 14, 28, 6);
    ctx.fillStyle = "#ffb703";
    ctx.fill();
    ctx.strokeStyle = "#c27c00";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillRect(-18.5, -32, 2.5, 18); // つや
    ctx.fillStyle = "#c27c00";
    ctx.fillRect(-21, -24, 14, 2.5); // 帯
  }
  // 奥の腕（グローブ）
  circle(-10, -18, 5, "#b02a35");
  // 体
  oval(0, -15, 12, 11, fur);
  oval(3, -14, 6.5, 7, light);
  if (tank) {
    // ボンベを留める肩ベルト
    line(-9, -24, 6, -8, "#2b3a4a", 2.5);
    line(-11, -12, -5, -10, "#2b3a4a", 2.5);
  }
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

  // 宇宙服のような丸いガラスのヘルメット（3 面だけ。ボンベからホースがつながっている）
  if (tank) {
    ctx.beginPath();
    ctx.moveTo(-14, -40);
    ctx.quadraticCurveTo(-22, headY - 6, -14, headY + 12);
    ctx.strokeStyle = "#2b3a4a";
    ctx.lineWidth = 3;
    ctx.stroke();
    circle(1, headY - 3, 19, "rgba(200, 235, 255, 0.22)");
    ctx.strokeStyle = "rgba(235, 250, 255, 0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
    // ガラスのつや
    ctx.beginPath();
    ctx.arc(1, headY - 3, 14, Math.PI * 1.1, Math.PI * 1.45);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 3;
    ctx.stroke();
    // 首のところの金属のリング
    ctx.beginPath();
    ctx.roundRect(-13, headY + 13, 28, 6, 3);
    ctx.fillStyle = "#b8c4d0";
    ctx.fill();
    ctx.strokeStyle = "#6d7b8a";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

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
    tank: inWater(),
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

// 2 面の雑魚：ミニパンダ（赤いはちまき）。原点は足元の中心、右向きで描く
function drawMiniPanda({ t = 0, walking = true, dead = false } = {}) {
  const white = "#f7fbff";
  const edge = "#a9bccf";
  const black = "#262626";
  const step = walking ? Math.sin(t * 0.25) * 3 : 0;
  oval(-7 + step, -4, 5.5, 4, black);
  oval(7 - step, -4, 5.5, 4, black);
  circle(-10, -13, 4.5, black); // 奥の腕
  oval(-1, -12, 13, 9, white, edge);
  circle(9, -12, 4.5, black); // 手前の腕
  // 頭
  circle(1, -30, 4.5, black);
  circle(12, -29, 4.5, black);
  circle(6, -21, 10, white, edge);
  // はちまき（しっぽがゆれる）
  ctx.fillStyle = "#e63946";
  ctx.fillRect(-3, -29, 18, 3);
  ctx.beginPath();
  ctx.moveTo(-3, -28);
  ctx.lineTo(-11, -27 + Math.sin(t * 0.3) * 3);
  ctx.lineTo(-10, -23 + Math.sin(t * 0.3) * 3);
  ctx.lineTo(-3, -26);
  ctx.closePath();
  ctx.fill();
  // 目のまわりの黒いもよう
  ctx.save();
  ctx.translate(9.5, -21.5);
  ctx.rotate(0.4);
  oval(0, 0, 3.3, 4.3, black);
  ctx.restore();
  oval(12.5, -17.5, 4.5, 3.5, "#ffffff", edge);
  oval(15, -19, 2, 1.5, black);
  if (dead) {
    line(8, -23, 11, -20, "#fff", 1.5);
    line(8, -20, 11, -23, "#fff", 1.5);
  } else {
    circle(10, -22, 1.3, "#fff");
  }
}

// 3 面の雑魚：カニ（歩く）。原点は足元の中心
function drawCrab({ t = 0, walking = true, dead = false } = {}) {
  const red = "#e8553f";
  const dark = "#a8331f";
  const step = walking ? Math.sin(t * 0.4) * 2 : 0;
  // 足（左右に 3 本ずつ）
  for (let i = 0; i < 3; i++) {
    const lx = 5 + i * 4;
    const s = i % 2 ? step : -step;
    line(-lx, -9, -lx - 6, -1 + s, dark, 2);
    line(lx, -9, lx + 6, -1 - s, dark, 2);
  }
  // はさみ（ときどき開いたり閉じたりする）
  const snap = Math.sin(t * 0.2) > 0 ? 4 : 1.5;
  for (const side of [-1, 1]) {
    line(side * 10, -13, side * 15, -19, red, 3);
    circle(side * 16, -22, 5.5, red, dark);
    ctx.beginPath();
    ctx.moveTo(side * 16, -22);
    ctx.lineTo(side * 21, -25 - snap);
    ctx.lineTo(side * 21, -25 + snap);
    ctx.closePath();
    ctx.fillStyle = "#1c6aa0"; // すき間から見える海の色
    ctx.fill();
  }
  // 体と目
  oval(0, -12, 14, 8, red, dark);
  oval(-3, -14, 5, 2.5, "rgba(255,255,255,0.35)");
  line(-4, -18, -5, -24, dark, 2);
  line(4, -18, 5, -24, dark, 2);
  for (const ex of [-5, 5]) {
    circle(ex, -26, 3.2, "#fff", dark);
    if (dead) xEye(ex, -26, 1.8);
    else circle(ex + 1, -26, 1.6, "#111");
  }
}

// 3 面の雑魚：クラゲ（ふわふわ跳ねる）。原点は足元の中心
function drawJellyfish({ t = 0, dead = false } = {}) {
  const pulse = Math.sin(t * 0.15);
  // 足
  for (let i = 0; i < 4; i++) {
    const x = -8 + i * 5.3;
    ctx.beginPath();
    ctx.moveTo(x, -16);
    for (let y = -16; y <= -1; y += 3) ctx.lineTo(x + Math.sin(t * 0.2 + y * 0.4 + i) * 2.5, y);
    ctx.strokeStyle = "rgba(255, 170, 215, 0.9)";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  // かさ
  ctx.beginPath();
  ctx.ellipse(0, -16, 14 + pulse, 13 - pulse, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fillStyle = "rgba(255, 160, 210, 0.85)";
  ctx.fill();
  ctx.strokeStyle = "#d0679a";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  oval(-5, -24, 4, 2.5, "rgba(255,255,255,0.6)");
  if (dead) {
    xEye(-4, -20, 1.8);
    xEye(4, -20, 1.8);
  } else {
    circle(-4, -20, 1.6, "#222");
    circle(4, -20, 1.6, "#222");
    oval(0, -17, 2, 1.2, "#d0679a");
  }
}

// 3 面の雑魚：ミニザメ（宙を泳ぐ）。原点は下の中心、右向きで描く
function drawMiniShark({ t = 0, dead = false } = {}) {
  const top = "#7d98b3";
  const edge = "#4f6a85";
  const sway = Math.sin(t * 0.3) * 3;
  ctx.beginPath(); // 尾びれ
  ctx.moveTo(-13, -10);
  ctx.lineTo(-22, -19 + sway);
  ctx.lineTo(-19, -10);
  ctx.lineTo(-22, -1 + sway);
  ctx.closePath();
  ctx.fillStyle = top;
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.beginPath(); // 背びれ
  ctx.moveTo(-4, -16);
  ctx.lineTo(1, -25);
  ctx.lineTo(6, -16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  oval(0, -10, 16, 8, top, edge);
  oval(3, -6, 11, 3.5, "#f2f6fa");
  line(-2, -6, -8, -1, edge, 2); // 胸びれ
  if (dead) {
    xEye(9, -12, 1.8);
  } else {
    circle(9, -12, 2.4, "#fff");
    circle(9.8, -12, 1.3, "#111");
    line(6, -16.5, 12, -14.5, "#1e2f40", 1); // 怒りまゆげ
  }
  line(9, -5.5, 15, -7, "#1e2f40", 1.3);
}

// 3 面のボス：大きなサメ。原点は下の中心、右向きで描く。open で口を大きく開ける
function drawShark({ t = 0, angry = false, down = false, open = false } = {}) {
  const top = "#5f84a8";
  const edge = "#3d5a78";
  const belly = "#eef4f8";
  const sway = Math.sin(t * (angry ? 0.4 : 0.25)) * 6;
  const fill = (color) => {
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  // 尾びれ
  ctx.beginPath();
  ctx.moveTo(-54, -36);
  ctx.lineTo(-88, -70 + sway);
  ctx.quadraticCurveTo(-74, -38, -84, -6 + sway);
  ctx.closePath();
  fill(top);
  // 背びれ
  ctx.beginPath();
  ctx.moveTo(-18, -54);
  ctx.quadraticCurveTo(-8, -80, 10, -88);
  ctx.quadraticCurveTo(4, -70, 16, -56);
  ctx.closePath();
  fill(top);

  // 体（おなかは白い）
  oval(0, -32, 64, 26, top);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, -32, 64, 26, 0, 0, Math.PI * 2);
  ctx.clip();
  oval(10, -10, 62, 18, belly);
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(0, -32, 64, 26, 0, 0, Math.PI * 2);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  oval(-6, -48, 30, 5, "rgba(255,255,255,0.18)"); // 背中のつや

  // えらと胸びれ
  for (let i = 0; i < 3; i++) line(18 + i * 6, -42, 15 + i * 6, -28, edge, 2);
  ctx.beginPath();
  ctx.moveTo(-4, -18);
  ctx.lineTo(-26, 4);
  ctx.lineTo(12, -14);
  ctx.closePath();
  fill(top);

  // 目
  if (down) {
    xEye(40, -40, 4);
  } else {
    circle(40, -40, 5.5, "#fff", edge);
    circle(41.5, -40, 3, "#111");
    circle(42.5, -41.5, 1, "#fff");
    line(31, -51, 49, -46, "#1e2f40", 2); // 怒りまゆげ
  }

  // 口とギザギザの歯
  const tooth = (x, y, dir) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 2.5, y + dir * 5);
    ctx.lineTo(x + 5, y);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  };
  if (open) {
    ctx.beginPath();
    ctx.moveTo(32, -25);
    ctx.quadraticCurveTo(46, -4, 58, -27);
    ctx.closePath();
    ctx.fillStyle = "#7a1f2b";
    ctx.fill();
    for (const x of [35, 41, 47, 52]) tooth(x, -26, 1);
    for (const x of [39, 45]) tooth(x, -15, -1);
  } else {
    ctx.beginPath();
    ctx.moveTo(32, -23);
    ctx.quadraticCurveTo(46, -16, 58, -26);
    ctx.strokeStyle = "#1e2f40";
    ctx.lineWidth = 2;
    ctx.stroke();
    for (const x of [38, 44, 50]) tooth(x, -21.5 + (x - 38) * -0.15, 1);
  }

  if (angry && !down) {
    circle(28, -30, 6, "rgba(255, 90, 90, 0.5)");
    // おでこの怒りマーク
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      line(22 + Math.cos(a) * 3, -54 + Math.sin(a) * 3, 22 + Math.cos(a) * 7, -54 + Math.sin(a) * 7, "#ff4d4d", 2.5);
    }
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
  const look = { t: e.t, walking: e.active && e.onGround, dead: e.dead };
  if (stage === 3) {
    if (e.kind === "fish") drawMiniShark(look);
    else if (e.kind === "jump") drawJellyfish(look);
    else drawCrab(look);
  } else if (stage === 2) {
    drawMiniPanda(look);
  } else {
    drawShirokuma(look);
  }
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

// 2 面のボス：大きなパンダ（笹をくわえている）。原点は足元の中心、右向きで描く
function drawBigPanda({ state: s = "idle", t = 0, angry = false, down = false } = {}) {
  const white = "#f7fbff";
  const edge = "#a9bccf";
  const black = "#262626";

  oval(-22, -12, 17, 13, black);
  oval(22, -12, 17, 13, black);
  circle(-36, -50, 13, black); // 奥の腕

  // 体（肩から腕にかけて黒い）
  oval(0, -46, 40, 36, white, edge);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, -46, 40, 36, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = black;
  ctx.fillRect(-45, -84, 90, 22);
  ctx.restore();

  // 頭
  circle(-6, -112, 12, black);
  circle(26, -112, 12, black);
  circle(10, -86, 30, white, edge);
  // 目のまわりの黒いもよう（たれ目）
  for (const [ex, rot] of [[16, 0.5], [31, -0.5]]) {
    ctx.save();
    ctx.translate(ex, -90);
    ctx.rotate(rot);
    oval(0, 0, 7, 10, black);
    ctx.restore();
  }
  oval(28, -75, 13, 9, "#ffffff", edge);
  oval(36, -79, 5.5, 4, black);
  if (down) {
    for (const ex of [16, 31]) {
      line(ex - 3, -94, ex + 3, -88, "#fff", 2);
      line(ex - 3, -88, ex + 3, -94, "#fff", 2);
    }
  } else {
    circle(17, -91, 3.4, "#fff");
    circle(18, -91, 1.7, "#111");
    circle(30, -91, 3.4, "#fff");
    circle(31, -91, 1.7, "#111");
    line(8, -105, 20, -101, black, 3); // 怒りまゆげ
    line(27, -101, 39, -105, black, 3);
  }
  // 口にくわえた笹
  line(30, -68, 52, -76, "#3f7f34", 2.5);
  oval(54, -80, 9, 3, "#5fae5f");
  oval(52, -71, 8, 2.5, "#5fae5f");

  if (angry && !down) {
    circle(2, -76, 5, "rgba(255, 90, 90, 0.55)");
    for (let i = 0; i < 3; i++) {
      const k = (t + i * 20) % 60;
      circle(-14 + i * 12, -120 - k * 0.6, 4 + k * 0.08, `rgba(255,255,255,${0.8 - k / 75})`);
    }
  }

  // 手前の腕。タケノコを投げるときは振りかぶる
  if (s === "throw") {
    circle(36, -96, 13, black);
    drawTakenoko(40, -112, 10, 0);
  } else {
    circle(38, -48, 13, black);
  }
}

// 丸まって転がるパンダ。angle で回転させる
function drawPandaBall(angle) {
  ctx.save();
  ctx.translate(0, -50);
  ctx.rotate(angle);
  circle(0, 0, 50, "#f7fbff", "#a9bccf");
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + 0.5;
    oval(Math.cos(a) * 33, Math.sin(a) * 33, 15, 11, "#262626");
  }
  circle(-10, -14, 6, "#262626");
  circle(10, -14, 6, "#262626");
  ctx.restore();
}

// タケノコ（パンダが投げる）
function drawTakenoko(x, y, s, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, -s * 1.4);
  ctx.quadraticCurveTo(s * 1.1, 0, s * 0.9, s * 0.9);
  ctx.lineTo(-s * 0.9, s * 0.9);
  ctx.quadraticCurveTo(-s * 1.1, 0, 0, -s * 1.4);
  ctx.closePath();
  ctx.fillStyle = "#c98b4a";
  ctx.fill();
  ctx.strokeStyle = "#7a5023";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  line(-s * 0.6, s * 0.2, s * 0.3, -s * 0.5, "#7a5023", 1.5);
  line(-s * 0.3, s * 0.8, s * 0.7, 0, "#7a5023", 1.5);
  oval(0, s * 0.9, s * 0.9, s * 0.3, "#f1e3b5");
  ctx.restore();
}

function drawBoss(b) {
  if (b.state !== "down" && b.invincible > 0 && Math.floor(b.invincible / 3) % 2 === 0) return;
  ctx.save();
  ctx.translate(b.x + b.w / 2, b.y + b.h);
  if (stage === 3) {
    drawSharkBoss(b);
    ctx.restore();
    if (b.stun > 0 && b.state !== "down") drawDizzyStars(b.x + b.w / 2, b.y - 8, b.stun);
    return;
  }
  const rolling = b.state === "roll" && b.t >= 30;
  if (b.state === "down") ctx.rotate(-b.facing * Math.min(b.t / 30, 1) * (Math.PI / 2)); // あおむけに倒れる
  if (b.state === "crouch" || (b.state === "roll" && !rolling)) ctx.scale(1.08, 0.88);
  if (b.state === "air") ctx.scale(0.95, 1.06);
  if (rolling) {
    drawPandaBall(b.x * 0.025);
  } else {
    ctx.scale(b.facing, 1);
    const look = { state: b.state, t: b.t, angry: bossAngry(), down: b.state === "down" };
    if (stage === 2) drawBigPanda(look);
    else drawBigShirokuma(look);
  }
  ctx.restore();
  if (b.stun > 0 && b.state !== "down") drawDizzyStars(b.x + b.w / 2, b.y - 8, b.stun);
}

// サメの向きや傾きをつけて描く（ctx の原点はボスの下の中心）
function drawSharkBoss(b) {
  const angry = bossAngry();
  const charging = b.state === "dash" && b.t <= (angry ? 30 : 42);
  const falling = b.state === "dive" && b.vy > 0;
  ctx.translate(0, -b.h / 2);
  if (b.state === "down") ctx.scale(1, 1 - 2 * Math.min(b.t / 20, 1)); // くるっとおなかを上に向ける
  if (b.state === "dive" && b.t <= 50) ctx.rotate(-b.facing * 0.3); // 頭を上げてのぼる
  if (falling) ctx.rotate(b.facing * 0.7); // 頭から急降下
  if (charging) ctx.translate(rand(-2, 2), 0); // 突進の前にぶるぶるふるえる
  ctx.translate(0, b.h / 2);
  ctx.scale(b.facing, 1);
  const open = (b.state === "dash" && !charging) || b.state === "bubble" || falling;
  drawShark({ t: frame, angry, down: b.state === "down", open: open && b.stun === 0 });
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
    text(`ステージ ${stage}`, 14, 112, 14, "#fff", "left");

    if (boss && bossPhase === "fight") {
      const gw = 260;
      const gx = W / 2 - gw / 2;
      text(STAGES[stage].bossName, W / 2, 18, 15, "#fff");
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(gx, 30, gw, 12);
      ctx.fillStyle = bossAngry() ? "#ff6b35" : "#e63946";
      ctx.fillRect(gx, 30, (gw * boss.hp) / boss.maxHp, 12);
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
    text(`${STAGES[stage].bossName} があらわれた！`, W / 2, 200, 22, "#ffffff");
  }

  if (state === "playing" && stageIntro > 0) {
    ctx.globalAlpha = Math.min(1, stageIntro / 30);
    text(`ステージ ${stage}`, W / 2, 150, 44, "#ffd166");
    text(STAGES[stage].title, W / 2, 200, 26, "#ffffff");
    ctx.globalAlpha = 1;
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
    if (blink && performance.now() - stateChangedAt > 1500) text(`${startKey} でステージ ${stage} からつづける`, W / 2, 330, 20);
  }

  if (state === "clear") {
    dim(0.45);
    const last = stage >= LAST_STAGE;
    text(last ? "ぜんぶクリア！" : `ステージ ${stage} クリア！`, W / 2, 120, 52, "#ffd166");
    text(`タイムボーナス（${clearBonus.seconds} 秒）  +${clearBonus.time}`, W / 2, 190, 20);
    text(`のこりクマボーナス  +${clearBonus.lives}`, W / 2, 222, 20);
    text(`スコア ${score}`, W / 2, 270, 30);
    text(`ハイスコア ${highScore}`, W / 2, 308, 18, "#e8ffe0");
    const next = last ? "もう一度あそぶ" : `ステージ ${stage + 1}「${STAGES[stage + 1].title}」へ`;
    if (blink && performance.now() - stateChangedAt > 1500) text(`${startKey} で${next}`, W / 2, 360, 20);
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
