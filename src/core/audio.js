/** Synth bus with file-based layering. Real gun/voice/music files stream in lazily; synth is the fallback. */

import { GUN_FIRE, GUN_RELOAD, GUN_DRY, GUN_AIM, GUN_EQUIP, MUSIC_TRACKS, DIALOGUE } from '../data/audioFiles.js';

const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

export function createAudio(getSettings) {
  let ctx = null;
  let master = null;
  let music = null;
  let timer = null;
  let step = 0;
  const fileCache = new Map();
  let musicSource = null;

  function fileBuffer(url) {
    if (!fileCache.has(url)) {
      fileCache.set(url, fetch(new URL(url, window.location.href))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`audio ${r.status}`))))
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => null));
    }
    return fileCache.get(url);
  }

  function playFile(url, vol = 1) {
    if (!ctx) return;
    fileBuffer(url).then((buf) => {
      if (!buf || !ctx) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(g);
      g.connect(master);
      src.start();
    });
  }

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    music = ctx.createGain();
    music.connect(master);
    apply();
    startMusic();
  }

  function apply() {
    if (!master) return;
    const s = getSettings();
    master.gain.value = s.volume ?? 0.7;
    if (music) music.gain.value = 0.16 * (s.music ?? 0.4);
  }

  function envGain(t, a, d, peak) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    return g;
  }

  function tone(freq, dur, type, peak, dest) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = envGain(t, 0.01, dur, peak);
    o.connect(g);
    g.connect(dest || master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, peak, hp = 800) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = hp;
    const g = envGain(t, 0.005, dur, peak);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
  }

  const VOICE_FILES = {
    hurt: DIALOGUE.damage,
    knock: DIALOGUE.damage,
    elim: DIALOGUE.death,
    defeat: DIALOGUE.death,
    victory: DIALOGUE.confirmation,
    revive: DIALOGUE.confirmation,
    pickup: DIALOGUE.confirmation,
    emote: DIALOGUE.greeting,
  };

  function voice(kind) {
    if (!ctx) return;
    const files = VOICE_FILES[kind];
    if (files && files.length && Math.random() < 0.65) {
      playFile(pickOne(files), 0.8);
      return;
    }
    const sets = {
      hurt: [520, 740],
      elim: [880, 1320, 1760],
      victory: [523, 659, 784, 1046],
      defeat: [392, 311, 247],
      revive: [660, 880, 1175],
      emote: [740, 988, 1318],
      pickup: [988, 1318],
    };
    const notes = sets[kind] || [880];
    notes.forEach((f, i) => tone(f, 0.12, 'sine', 0.08, master));
    notes.forEach((f, i) => setTimeout(() => tone(f, 0.14, 'triangle', 0.05), i * 70));
  }

  const GUN_FILES = {
    ar: GUN_FIRE, smg: GUN_FIRE, shot: GUN_FIRE, snip: GUN_FIRE, pistol: GUN_FIRE,
  };

  /** Play a file; if it fails to load/decode, run the synth fallback instead. */
  function playFileOr(urls, vol, fallback) {
    if (!ctx) return;
    fileBuffer(pickOne(urls)).then((buf) => {
      if (buf && ctx) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = vol;
        src.connect(g);
        g.connect(master);
        src.start();
      } else if (fallback) fallback();
    });
  }

  const guns = {
    ar: () => { playFile(pickOne(GUN_FIRE), 0.55); noise(0.07, 0.22, 900); },
    smg: () => { playFile(pickOne(GUN_FIRE), 0.5); noise(0.04, 0.16, 1400); },
    shot: () => { playFile(pickOne(GUN_FIRE), 0.75); noise(0.16, 0.32, 400); },
    snip: () => { playFile(pickOne(GUN_FIRE), 0.7); noise(0.12, 0.28, 500); },
    pistol: () => { playFile(pickOne(GUN_FIRE), 0.55); noise(0.06, 0.18, 1000); },
    melee: () => { noise(0.08, 0.14, 1800); tone(660, 0.08, 'sawtooth', 0.05); },
  };

  function sfx(name) {
    ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    apply();
    if (GUN_FILES[name]) {
      playFileOr(GUN_FILES[name], name === 'shot' || name === 'snip' ? 0.85 : 0.65, guns[name]);
      return;
    }
    switch (name) {
      case 'ui': tone(880, 0.06, 'sine', 0.06); tone(1320, 0.08, 'triangle', 0.04); break;
      case 'back': tone(440, 0.07, 'sine', 0.05); break;
      case 'dry': playFileOr(GUN_DRY, 0.7, () => tone(140, 0.05, 'square', 0.04)); break;
      case 'reload':
        playFileOr(GUN_RELOAD, 0.7, () => {
          tone(520, 0.05, 'triangle', 0.05);
          setTimeout(() => tone(780, 0.06, 'triangle', 0.05), 80);
        });
        break;
      case 'equip': playFileOr(GUN_EQUIP, 0.55, () => tone(880, 0.05, 'sine', 0.04)); break;
      case 'aim': playFileOr(GUN_AIM, 0.35, () => {}); break;
      case 'hit': tone(1400, 0.04, 'square', 0.04); break;
      case 'head': tone(1760, 0.06, 'square', 0.06); tone(990, 0.05, 'sine', 0.04); break;
      case 'hurt': noise(0.08, 0.1, 300); voice('hurt'); break;
      case 'elim': voice('elim'); break;
      case 'knock': tone(300, 0.2, 'sine', 0.08); voice('hurt'); break;
      case 'heal': tone(660, 0.1, 'sine', 0.06); tone(990, 0.14, 'sine', 0.05); break;
      case 'shield': tone(520, 0.1, 'triangle', 0.06); tone(1040, 0.12, 'sine', 0.04); break;
      case 'pickup': voice('pickup'); break;
      case 'chest': tone(523, 0.08, 'triangle', 0.07); setTimeout(() => tone(784, 0.1, 'sine', 0.06), 90); break;
      case 'zone': tone(180, 0.25, 'sawtooth', 0.04); break;
      case 'jump': tone(420, 0.08, 'sine', 0.04); break;
      case 'land': noise(0.06, 0.08, 200); break;
      case 'dash': noise(0.1, 0.1, 600); tone(880, 0.08, 'sine', 0.04); break;
      case 'explode': noise(0.3, 0.3, 200); tone(80, 0.3, 'sawtooth', 0.1); break;
      case 'revive': voice('revive'); break;
      case 'victory': voice('victory'); break;
      case 'defeat': voice('defeat'); break;
      case 'crystal': tone(1200, 0.12, 'sine', 0.06); tone(1600, 0.16, 'triangle', 0.04); break;
    // A royal decree: a low swell under a bright crest, not a gunshot.
    case 'decree': tone(150, 0.55, 'sine', 0.14); tone(320, 0.4, 'triangle', 0.07); noise(0.3, 0.1, 500); break;
      case 'emote': voice('emote'); break;
      default: tone(660, 0.05, 'sine', 0.04);
    }
  }

  let trackPlaying = false;
  function startTrack() {
    if (!ctx || trackPlaying) return;
    fileBuffer(pickOne(MUSIC_TRACKS)).then((buf) => {
      if (!buf || !ctx || trackPlaying) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(music);
      src.start();
      musicSource = src;
      trackPlaying = true;
    });
  }

  function startMusic() {
    if (timer || !ctx) return;
    startTrack();
    const kick = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0];
    const hat = [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1];
    const bass = [110, 0, 110, 0, 82, 0, 110, 0, 98, 0, 110, 0, 82, 0, 123, 0];
    const lead = [659, 0, 784, 880, 0, 784, 659, 0, 523, 0, 659, 784, 0, 880, 784, 659];
    timer = window.setInterval(() => {
      if (!ctx || ctx.state !== 'running') return;
      if (trackPlaying) return; // real track owns the bed; synth drums are the fallback.
      const i = step % 16;
      step++;
      const t = ctx.currentTime;
      if (kick[i]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
        const g = envGain(t, 0.005, 0.12, 0.9);
        o.connect(g); g.connect(music); o.start(t); o.stop(t + 0.14);
      }
      if (hat[i]) noiseBurstMusic();
      if (bass[i]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = bass[i];
        const g = envGain(t, 0.01, 0.16, 0.35);
        o.connect(g); g.connect(music); o.start(t); o.stop(t + 0.18);
      }
      if (lead[i] && step % 32 < 24) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = lead[i];
        const g = envGain(t, 0.01, 0.1, 0.08);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 1800;
        o.connect(f); f.connect(g); g.connect(music); o.start(t); o.stop(t + 0.12);
      }
    }, 140);
  }

  function noiseBurstMusic() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 5000;
    const g = envGain(t, 0.001, 0.03, 0.18);
    src.connect(f); f.connect(g); g.connect(music);
    src.start(t);
  }

  return {
    unlock() {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      apply();
    },
    sfx,
    apply,
    setMusicDuck(v) {
      if (!music || !ctx) return;
      const s = getSettings();
      music.gain.setTargetAtTime((v ? 0.05 : 0.16) * (s.music ?? 0.4), ctx.currentTime, 0.1);
    },
  };
}
