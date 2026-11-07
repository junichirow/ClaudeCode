// 音：Web Audio API でその場で合成する BGM と効果音（音声ファイルは使わない）
"use strict";

const Sound = (() => {
  const MUTE_KEY = "kuma-shooter-muted";

  // 曲データ：8分音符ごとの MIDI ノート番号（0 は休符）。4 小節でループする
  const TRACKS = {
    // 通常面：Am - F - C - G の明るめのループ
    main: {
      bpm: 140,
      melody: [
        69, 0, 72, 0, 76, 74, 72, 69,
        65, 0, 69, 72, 77, 76, 72, 0,
        67, 0, 72, 76, 79, 0, 76, 72,
        74, 0, 71, 67, 74, 76, 74, 0,
      ],
      bassRoots: [45, 41, 48, 43],
      bassPattern: [0, 12, 0, 12, 0, 12, 0, 12],
    },
    // ボス戦：Dm の速くて不穏なループ
    boss: {
      bpm: 168,
      melody: [
        62, 0, 65, 0, 69, 0, 68, 69,
        74, 0, 72, 0, 69, 0, 65, 0,
        70, 0, 69, 0, 65, 0, 62, 0,
        69, 0, 0, 73, 76, 0, 73, 0,
      ],
      bassRoots: [38, 38, 46, 45],
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
      musicGain.gain.value = 0.35;
      musicGain.connect(master);
      sfxGain = ac.createGain();
      sfxGain.gain.value = 0.5;
      sfxGain.connect(master);

      // 爆発やドラム用のホワイトノイズ
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
    if (m) tone(freq(m), time, stepDur * 0.9, { vol: 0.18, dest: musicGain });
    const root = t.bassRoots[Math.floor(i / 8)];
    tone(freq(root + t.bassPattern[i % 8]), time, stepDur * 0.8, { type: "triangle", vol: 0.5, dest: musicGain });
    // ドラム：表拍にキック、裏拍にハイハット
    if (i % 2 === 0) tone(150, time, 0.12, { type: "sine", vol: 0.5, dest: musicGain, toFreq: 40 });
    else noise(time, 0.04, { vol: 0.12, dest: musicGain, filter: 8000 });
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
    shot: sfx((now) => tone(1400, now, 0.05, { vol: 0.04, toFreq: 700 })),
    hit: sfx((now) => tone(500, now, 0.04, { vol: 0.06 })),
    explode: sfx((now, big = false) => noise(now, big ? 0.5 : 0.25, { vol: big ? 0.6 : 0.4, filter: big ? 1500 : 3000 })),
    damage: sfx((now) => {
      tone(400, now, 0.4, { type: "sawtooth", vol: 0.3, toFreq: 60 });
      noise(now, 0.3, { vol: 0.4 });
    }),
    warning: sfx((now) => {
      for (let i = 0; i < 4; i++) tone(i % 2 ? 660 : 880, now + i * 0.25, 0.22, { vol: 0.2 });
    }),
    bossDown: sfx((now) => {
      for (let i = 0; i < 4; i++) noise(now + i * 0.15, 0.5, { vol: 0.5, filter: 1200 });
      [72, 76, 79, 84].forEach((n, i) => tone(freq(n), now + 0.6 + i * 0.1, 0.25, { vol: 0.2 }));
    }),
    gameOver: sfx((now) => {
      [67, 64, 60, 55].forEach((n, i) => tone(freq(n), now + 0.3 + i * 0.25, 0.3, { type: "triangle", vol: 0.4 }));
    }),
  };
})();
