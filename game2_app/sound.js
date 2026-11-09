// 音：Web Audio API でその場で合成する BGM と効果音（音声ファイルは使わない）
"use strict";

const Sound = (() => {
  const MUTE_KEY = "kuma-action-muted";

  // 曲データ：8分音符ごとの MIDI ノート番号（0 は休符）。4 小節でループする
  const TRACKS = {
    // 森のステージ：C - Am - F - G の明るいループ
    forest: {
      bpm: 132,
      melody: [
        72, 0, 76, 79, 76, 0, 72, 74,
        76, 0, 72, 69, 72, 0, 76, 0,
        77, 0, 76, 74, 72, 0, 69, 72,
        74, 0, 71, 67, 71, 74, 79, 0,
      ],
      bassRoots: [48, 45, 41, 43],
      bassPattern: [0, 12, 7, 12, 0, 12, 7, 12],
    },
    // 竹林のステージ：Dm - B♭ - C - A の和風っぽいループ（5 音の音階）
    bamboo: {
      bpm: 120,
      melody: [
        74, 0, 72, 69, 67, 0, 69, 0,
        72, 0, 69, 67, 65, 0, 62, 0,
        65, 0, 67, 69, 72, 0, 74, 72,
        69, 0, 67, 65, 67, 0, 0, 0,
      ],
      bassRoots: [38, 34, 36, 33],
      bassPattern: [0, 7, 12, 7, 0, 7, 12, 7],
    },
    // ボス戦：Em - C - D - B の速くて緊張感のあるループ
    boss: {
      bpm: 160,
      melody: [
        64, 0, 67, 71, 76, 0, 74, 71,
        72, 0, 71, 67, 64, 0, 67, 0,
        74, 0, 72, 69, 66, 0, 69, 74,
        71, 0, 75, 78, 75, 0, 71, 0,
      ],
      bassRoots: [40, 36, 38, 35],
      bassPattern: [0, 0, 12, 0, 0, 12, 0, 12],
    },
  };

  let ac = null;
  let master, musicGain, sfxGain, noiseBuffer;
  let muted = localStorage.getItem(MUTE_KEY) === "1";
  let track = null;
  let step = 0;
  let nextTime = 0;
  let paused = false;

  const freq = (n) => 440 * 2 ** ((n - 69) / 12);

  // ブラウザはユーザー操作があるまで音を鳴らせないので、クリックやキー入力のたびに呼ぶ
  function unlock() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.6;
      master.connect(ac.destination);
      musicGain = ac.createGain();
      musicGain.gain.value = 0.3;
      musicGain.connect(master);
      sfxGain = ac.createGain();
      sfxGain.gain.value = 0.5;
      sfxGain.connect(master);

      // パンチやドラム用のホワイトノイズ
      noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      setInterval(schedule, 25);
    }
    if (ac.state === "suspended") ac.resume();
  }

  // 1 音鳴らす。周波数を toFreq まで滑らせることもできる
  function tone(f, start, dur, { type = "square", vol = 0.3, dest = sfxGain, toFreq = null } = {}) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, start);
    if (toFreq) osc.frequency.exponentialRampToValueAtTime(toFreq, start + dur);
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(g).connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  function noise(start, dur, { vol = 0.3, dest = sfxGain, filter = 2000 } = {}) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(filter, start);
    lp.frequency.exponentialRampToValueAtTime(100, start + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.connect(lp).connect(g).connect(dest);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  // 音の並びを順番に鳴らす（ジングル用）。0 は休符
  function arpeggio(now, notes, gap, dur, opts = {}) {
    notes.forEach((n, i) => n && tone(freq(n), now + i * gap, dur, opts));
  }

  // ---- BGM（少し先の音まで予約しておく方式で、タイマーのずれがあってもリズムが崩れない） ----
  function schedule() {
    if (!ac || !track || paused) return;
    const t = TRACKS[track];
    const stepDur = 60 / t.bpm / 2;
    // タブが裏に回ってタイマーが止まっていた場合は、まとめて鳴らさずに今から再開する
    if (nextTime < ac.currentTime - 0.2) nextTime = ac.currentTime + 0.05;
    while (nextTime < ac.currentTime + 0.12) {
      playStep(t, step, nextTime, stepDur);
      nextTime += stepDur;
      step = (step + 1) % t.melody.length;
    }
  }

  function playStep(t, i, time, stepDur) {
    const m = t.melody[i];
    if (m) tone(freq(m), time, stepDur * 0.9, { vol: 0.16, dest: musicGain });
    const root = t.bassRoots[Math.floor(i / 8)];
    tone(freq(root + t.bassPattern[i % 8]), time, stepDur * 0.8, { type: "triangle", vol: 0.5, dest: musicGain });
    // ドラム：表拍にキック、裏拍にハイハット
    if (i % 2 === 0) tone(150, time, 0.12, { type: "sine", vol: 0.5, dest: musicGain, toFreq: 40 });
    else noise(time, 0.04, { vol: 0.1, dest: musicGain, filter: 8000 });
  }

  function playMusic(name) {
    if (!ac || track === name) return;
    track = name;
    step = 0;
    nextTime = ac.currentTime + 0.05;
  }

  function stopMusic() {
    track = null;
  }

  function setPaused(p) {
    paused = p;
    if (ac && !p) nextTime = ac.currentTime + 0.05;
  }

  function toggleMute() {
    muted = !muted;
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    if (ac) master.gain.setTargetAtTime(muted ? 0 : 0.6, ac.currentTime, 0.02);
  }

  // ---- 効果音 ----
  // 効果音は ac が無い（まだ操作されていない）ときは何もしない
  const sfx = (fn) => (...args) => {
    if (ac) fn(ac.currentTime, ...args);
  };

  return {
    unlock,
    playMusic,
    stopMusic,
    setPaused,
    toggleMute,
    isMuted: () => muted,
    jump: sfx((now) => tone(320, now, 0.15, { vol: 0.12, toFreq: 760 })),
    punch: sfx((now) => {
      noise(now, 0.08, { vol: 0.25, filter: 3000 });
      tone(220, now, 0.08, { type: "sawtooth", vol: 0.08, toFreq: 110 });
    }),
    hit: sfx((now) => {
      noise(now, 0.15, { vol: 0.4, filter: 4000 });
      tone(880, now, 0.12, { vol: 0.12, toFreq: 1760 });
    }),
    stomp: sfx((now, big = false) => {
      tone(big ? 90 : 180, now, big ? 0.4 : 0.15, { type: "sine", vol: 0.6, toFreq: 40 });
      noise(now, big ? 0.4 : 0.1, { vol: big ? 0.5 : 0.25, filter: big ? 800 : 1500 });
    }),
    honey: sfx((now) => arpeggio(now, [83, 88], 0.07, 0.12, { vol: 0.12 })),
    heart: sfx((now) => arpeggio(now, [72, 76, 79, 84], 0.06, 0.15, { type: "triangle", vol: 0.35 })),
    checkpoint: sfx((now) => arpeggio(now, [67, 72, 76, 79, 84], 0.08, 0.2, { vol: 0.12 })),
    damage: sfx((now) => {
      tone(400, now, 0.35, { type: "sawtooth", vol: 0.25, toFreq: 80 });
      noise(now, 0.2, { vol: 0.3 });
    }),
    miss: sfx((now) => arpeggio(now, [72, 67, 64, 60, 55], 0.12, 0.2, { type: "triangle", vol: 0.4 })),
    warning: sfx((now) => {
      for (let i = 0; i < 4; i++) tone(i % 2 ? 660 : 880, now + i * 0.25, 0.22, { vol: 0.18 });
    }),
    bossHit: sfx((now) => {
      noise(now, 0.2, { vol: 0.5, filter: 2500 });
      tone(300, now, 0.15, { type: "square", vol: 0.12, toFreq: 150 });
    }),
    laserCharge: sfx((now) => tone(300, now, 0.25, { type: "sine", vol: 0.25, toFreq: 1400 })),
    laserFire: sfx((now) => {
      tone(1400, now, 0.55, { type: "sawtooth", vol: 0.12, toFreq: 250 });
      tone(90, now, 0.5, { type: "sine", vol: 0.5, toFreq: 35 });
      noise(now, 0.5, { vol: 0.35, filter: 6000 });
    }),
    laserReady: sfx((now) => arpeggio(now, [84, 91], 0.08, 0.15, { type: "triangle", vol: 0.3 })),
    throwBall: sfx((now) => tone(600, now, 0.12, { type: "triangle", vol: 0.2, toFreq: 300 })),
    bossDown: sfx((now) => {
      for (let i = 0; i < 4; i++) noise(now + i * 0.15, 0.5, { vol: 0.5, filter: 1200 });
      arpeggio(now + 0.6, [72, 76, 79, 84], 0.1, 0.25, { vol: 0.18 });
    }),
    clear: sfx((now) => {
      arpeggio(now, [72, 72, 72, 72, 68, 70, 72, 0, 70, 72], 0.13, 0.2, { vol: 0.16 });
      arpeggio(now, [48, 48, 48, 48, 44, 46, 48, 0, 46, 48], 0.13, 0.2, { type: "triangle", vol: 0.4 });
    }),
    gameOver: sfx((now) => arpeggio(now + 0.3, [67, 64, 60, 55], 0.25, 0.3, { type: "triangle", vol: 0.4 })),
  };
})();
