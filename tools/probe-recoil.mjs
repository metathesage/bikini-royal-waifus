/**
 * Recoil measurement. Fires a real burst on the real graybox range and reports
 * what the recoil actually did, rather than what the constants imply.
 *
 * The question is "does the gun recover", and it has two possible failure modes
 * that look identical in code review and opposite in the hand:
 *
 *   - ratchets: recoilP accumulates and never returns, so a long burst walks the
 *     aim off the target permanently;
 *   - vanishes: recoil decays faster than the fire interval, so consecutive
 *     shots never stack and the gun has no recoil at all.
 *
 * `recoilP *= exp(-12*dt)` gives an 83ms time constant against a 111ms gap at
 * 540rpm, which points at the second. Measuring is the only way to know, so
 * this prints the per-shot series and the recovery curve instead of asserting.
 */
import { installAssetFetch } from '../test/asset-fetch.mjs';

installAssetFetch();

const ctx2d = new Proxy({}, { get: () => () => {} });
globalThis.document = {
  createElement() { return { width: 128, height: 128, getContext: () => ctx2d }; },
};

const { createMatch } = await import('../src/game/match.js');
const { GUNS } = await import('../src/game/weapons.js');
const { setAssetManifest } = await import('../src/data/assets.js');
const { readFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');

setAssetManifest(JSON.parse(readFileSync(
  fileURLToPath(new URL('../public/assets/manifest.json', import.meta.url)), 'utf8',
)));

const look = {
  name: 'Yuna', title: 'Crystal Darling', body: 'darling', face: 'doll', skin: '#ffd0c2',
  makeup: 'blush', hair: 'long', hairColor: '#ff4f9a', eye: '#3ee0ff', top: 'triangle',
  bottom: 'micro', cloth: '#ff3d8a', pattern: 'solid', trim: '#7af6ff', wet: false, sheer: false,
  glow: true, accessories: ['choker'], wrap: 'sakura', charm: 'heart', melee: 'katana',
  candidate: 'thalassa', emote: 'blowkiss', victory: 'sparkle', loading: 'beam', banner: 'mythic',
};
const settings = {
  mouse: 0.002, gamepad: 2, fov: 78, invert: false, volume: 0, music: 0,
  jiggle: 1, assist: true, shake: false, text: 1, touch: false, bindings: {},
};
const audio = { sfx() {}, setMusicDuck() {}, apply() {} };

const range = createMatch({ getSettings: () => settings, audio, getLook: () => look, map: 'graybox' });
for (let i = 0; i < 2000 && range.buildStep() < 1; i++) {
  range.buildStep();
  if (range.buildStep() >= 1) break;
  await new Promise((r) => setTimeout(r, 2));
}
if (range.phase() !== 'play') throw new Error(`graybox did not start in play, got ${range.phase()}`);

const idle = {
  moveX: 0, moveY: 0, lookX: 0, lookY: 0, fire: false, aim: false,
  jumpHeld: false, jumpPressed: false, crouchHeld: false, crouchPressed: false,
  sprint: false, reloadPressed: false, interactPressed: false, interactHeld: false,
  meleePressed: false, dashPressed: false, usePressed: false, swapPressed: false,
  inspectPressed: false, emotePressed: false, scoreHeld: false, pausePressed: false,
  confirmPressed: false, backPressed: false, uiLeft: false, uiRight: false, uiUp: false,
  uiDown: false, weaponSlot: 0, itemPrev: false, itemNext: false, device: 'keyboard',
};

const DT = 1 / 60;
const DEG = 180 / Math.PI;

// Select a gun and zero every piece of accumulated state, so each measurement
// starts from a genuinely cold trigger instead of inheriting the last gun.
//
// The equipped weapon lives in `player.guns[player.active]`, not on a `weapon`
// field: the locker holds two instances and `active` indexes them, and `shoot`
// reads `gun.mag` off the instance. Writing a `weapon` field here is silently
// ignored and the probe silently measures whatever the default loadout was —
// which is exactly how the first run reported "no recoil at all" for four guns
// while the fifth, the only one actually equipped, measured fine.
function select(id) {
  const p = range.player;
  const slot = p.active === 2 ? 0 : p.active;
  p.guns[slot] = { id, mag: GUNS[id].mag };
  p.active = slot;
  p.gunIndex = slot;
  p.recoilP = 0;
  p.recoilY = 0;
  p.recoilStep = 0;
  p.bloom = 0;
  p.nextShot = 0;
  p.reload = 0;
  p.shots = 0;
  // The viewmodel is driven from the equipped id, so it has to be re-synced or
  // the punch/kick decay being measured belongs to the previously equipped gun.
  range.syncWeapon();
}

const rows = [];
for (const id of ['ar', 'smg', 'shot', 'snip', 'pistol']) {
  const spec = GUNS[id];
  select(id);
  for (let i = 0; i < 12; i++) range.update(DT, idle); // settle startup transients

  const interval = 60 / spec.rpm + (spec.bolt || 0);
  const burstShots = spec.auto ? Math.min(30, spec.mag) : Math.min(6, spec.mag);
  const totalFrames = Math.ceil((burstShots * interval + 1.0) * 60);

  const shots = [];
  const series = [];
  let prevShots = range.player.shots;

  for (let f = 0; f < totalFrames; f++) {
    const firing = range.player.shots < burstShots;
    range.update(DT, { ...idle, fire: firing });
    series.push(range.player.recoilP);
    if (range.player.shots > prevShots) {
      shots.push({ n: range.player.shots, at: range.player.recoilP });
      prevShots = range.player.shots;
    }
  }
  const burstPeak = Math.max(...series.map(Math.abs), 0);
  const lastIdx = series.length - 1;
  const heldAtEnd = Math.abs(series[lastIdx] || 0);

  // Recovery: frames from the final shot until recoilP is under 5% of the peak.
  const lastShotIdx = lastIdx - [...series].reverse().findIndex((v) => Math.abs(v) > burstPeak * 0.05);
  let recoverMs = null;
  for (let i = Math.max(lastShotIdx, 0); i < series.length; i++) {
    if (Math.abs(series[i]) <= burstPeak * 0.05) { recoverMs = (i - lastShotIdx) * DT * 1000; break; }
  }

  // The single most diagnostic number: how much of the accumulated climb is
  // still on the camera when the burst ends. Near 0% means consecutive shots are
  // not stacking, and the gun will feel like it has no recoil at all.
  const climb = shots.reduce((a, s) => a + spec.recoil[(s.n - 1) % spec.recoil.length], 0);
  const retainedPct = 100 * heldAtEnd / Math.max(climb, 1e-9);

  const row = {
    id,
    rpm: spec.rpm,
    gapMs: +(interval * 1000).toFixed(1),
    fired: shots.length,
    peakDeg: +(burstPeak * DEG).toFixed(3),
    climbDeg: +(climb * DEG).toFixed(3),
    heldDeg: +(heldAtEnd * DEG).toFixed(3),
    retainedPct: +retainedPct.toFixed(1),
    recoverMs: recoverMs === null ? '>1s' : +recoverMs.toFixed(0),
  };
  rows.push(row);

  console.log(`\n=== ${id} (${spec.name}) — ${spec.rpm} rpm, ${row.gapMs}ms between shots ===`);
  console.log(`  recoilP on each shot (deg): ${shots.slice(0, 12).map((s) => (s.at * DEG).toFixed(3)).join('  ')}`);
  if (shots.length > 12) console.log(`  ... ${shots.length - 12} more shots`);
  console.log(`  peak ${row.peakDeg}deg | total climb ${row.climbDeg}deg | held at burst end ${row.heldDeg}deg (${row.retainedPct}% of climb)`);
  console.log(`  recovery to 5% of peak: ${row.recoverMs}ms`);
}

console.log('\n================ RECOIL SUMMARY ================');
console.table(rows);

// A ratchet and a no-op are both failures, so assert the useful middle: recoil
// must be visible at the moment of firing, must stack a little across a burst,
// and must come back. Which side of the line is a design call, not a bug fix.
const bad = rows.filter((r) => r.peakDeg < 0.05 || (r.retainedPct > 95 && r.climbDeg > 0.3));
if (bad.length) {
  console.error(`\nrecoil is degenerate for: ${bad.map((r) => r.id).join(', ')}`);
  process.exit(1);
}