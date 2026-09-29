import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { selfTestBasis } from './core/basis.js';
import { createInput } from './core/input.js';
import { createAudio } from './core/audio.js';
import { loadSave, writeSave, snapshotLook, progress as awardProgress } from './core/store.js';
import { rollLook, DEFAULT_SETTINGS, addVrmModels } from './data/catalog.js';
import { ANIMATED } from './game/bots.js';
import { candidateLook, candidateById } from './data/candidates.js';
import { primePsxRoster, assetReport, CHARACTERS } from './data/assets.js';
import { createStudio } from './scene/studio.js';
import { createMatch } from './game/match.js';
import { createShell } from './ui/shell.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Cel outlines: inverted-hull ink line around every toon mesh (three's OutlineEffect).
const outlineFx = new OutlineEffect(renderer, { defaultThickness: 0.0032, defaultColor: [0.09, 0.03, 0.08], defaultAlpha: 1, defaultKeepAlive: true });
let outlinesOn = true;
const outline = { render: (sc, cam) => (outlinesOn ? outlineFx.render(sc, cam) : renderer.render(sc, cam)) };
window.__brOutlines = (on) => { outlinesOn = !!on; };

const basisErrors = selfTestBasis();
if (basisErrors.length) console.error(basisErrors);

const save = loadSave();
let look = save.look;

// VRoid characters: drop .vrm files in public/assets/vrm and list them in manifest.json.
try {
  const r = await fetch('/assets/vrm/manifest.json', { cache: 'no-store' });
  if (r.ok) {
    const list = await r.json();
    for (const e of list) {
      CHARACTERS[e.id] = { id: e.id, name: e.name, rarity: e.rarity || 'legendary', url: '/assets/vrm/' + e.file, retarget: true, vrm: true, jiggle: e.jiggle !== false };
    }
    const ids = addVrmModels(list);
    for (const id of ids) if (!ANIMATED.includes(id)) ANIMATED.unshift(id);
    if (list.length && !look.model.startsWith('vrm_') && !ids.includes(look.model)) look = { ...look, model: list[0].id };
  }
} catch (e) { console.warn('no VRM manifest', e); }
let settings = save.settings;
let presets = save.presets;
/** Lifetime level/XP/wallet shown by the menu profile chip. */
let stats = save.stats;
/**
 * A finished match's result stays set on every later frame, so the payout needs
 * its own one-shot. Cleared when a new match starts, armed the first frame the
 * match reports a result.
 */
let countedResult = false;
let screen = 'splash';
let paused = false;
let returnTo = null;
let viewerPose = 'idle';
let previewJiggle = null;
let match = null;

const audio = createAudio(() => settings);
const input = createInput(() => settings);
const studio = createStudio(canvas, renderer, look);

function persist() {
  writeSave({ look, settings, presets, stats });
}

function ended() {
  return !!(match && match.ready() && match.getResult());
}

/** Model swaps change which character object exists (GLB vs procedural), so rebuild instead of re-dress. */
function rebuildHero() {
  studio.rebuild(look);
  if (match) match.applyProfile();
}

const shell = createShell({
  audio: () => audio.unlock(),
  look: () => look,
  settings: () => settings, // state getter  Æ  † ™—„—Æ —Å—Æ  † ™—Æ —Å—Æ —Å—Æ  † ™—Æ —…—Æ —Å— shell reads this; navigation uses openSettings().
  presets: () => presets,
  paused: () => paused,
  ended,
  result: () => (match ? match.getResult() : null),
  stats: () => match ? {
    kills: match.player.kills,
    damage: Math.round(match.player.damage),
    accuracy: match.player.shots ? Math.round((match.player.hits / match.player.shots) * 100) : 0,
    revived: match.player.revived,
  } : null,
  // Lifetime level/XP/wallet for the menu profile chip. Deliberately a different
  // key from `stats`, which the end screen reads for this match's numbers.
  progression: () => stats,
  // Read by the HUD's directional damage indicators, which animate on every
  // frame including in the menu  Æ  † ™—„—Æ —Å—Æ  † ™—Æ —Å—Æ —Å—Æ  † ™—Æ —…—Æ —Å— so they must survive match being null.
  playerPos: () => (match ? { x: match.player.pos.x, z: match.player.pos.z } : null),
  playerYaw: () => (match ? match.player.yaw : 0),
  boot() { audio.unlock(); go('menu'); },
  play() { startMatch(); },
  /**
   * Boot straight into the graybox proving ground.
   *
   * A full navigation rather than a mode flag on the live match: the map is
   * chosen once, in createMatch, when the world is built, and rebuilding the
   * world under a running match is exactly the kind of state juggling that
   * produces a half-island. Reloading costs a second and cannot leave a stale
   * world behind.
   *
   * Still a URL parameter underneath, so the QA path stays out of the save
   * file and behaves identically for a human and for tools/render.mjs.
   */
  range() { location.search = '?map=graybox'; },
  locker() { open('locker'); },
  viewer() { open('viewer'); },
  armory() { open('armory'); },
  openSettings() { open('settings'); },
  menu() { returnTo = null; paused = false; modeStudio('menu'); },
  back,
  resume() { paused = false; screen = 'game'; shell.setScreen('game'); },
  /**
   * Freeze the simulation without changing screen. The bag needs exactly this
   * and must not use the pause *screen*: the player should come back to the
   * fight, not to a menu they then have to dismiss.
   */
  pause() { if (match && !ended() && !paused) paused = true; },
  toggleBag() { shell.toggleBag(); },
  randomize() {
    const name = look.name;
    look = { ...rollLook(Math.random), name };
    rebuildHero();
    persist();
    shell.paintLocker();
  },
  rename(name, title) {
    if (name != null) look.name = name || 'Yuna';
    if (title != null) look.title = title || 'Crystal Darling';
    persist();
  },
  toggle(key, value) {
    look[key] = value;
    studio.dress(look);
    persist();
  },
  equip(kind, id) {
    if (kind === 'accessory') {
      const set = new Set(look.accessories || []);
      if (set.has(id)) set.delete(id); else set.add(id);
      look.accessories = [...set];
    } else if (kind === 'model') look.model = id;
    else if (kind === 'body') look.body = id;
    else if (kind === 'face') look.face = id;
    else if (kind === 'makeup') look.makeup = id;
    else if (kind === 'top') look.top = id;
    else if (kind === 'bottom') look.bottom = id;
    else if (kind === 'pattern') look.pattern = id;
    else if (kind === 'hair') look.hair = id;
    else if (kind === 'wrap') look.wrap = id;
    else if (kind === 'charm') look.charm = id;
    else if (kind === 'emote') look.emote = id;
    else if (kind === 'victory') look.victory = id;
    else if (kind === 'loading') look.loading = id;
    else if (kind === 'banner') look.banner = id;
    else if (kind === 'melee') look.melee = id;
    if (kind === 'model') {
      look.model = id;
      rebuildHero();
    } else studio.dress(look);
    if (match) match.applyProfile();
    persist();
    if (screen === 'locker') shell.paintLocker();
    if (screen === 'armory') shell.setScreen('armory');
  },
  color(field, value) {
    look[field] = value;
    studio.dress(look);
    persist();
    shell.paintLocker();
  },
  preset(i, mode) {
    if (mode === 'save') presets[i] = { name: look.name, look: snapshotLook(look) };
    else if (presets[i]) {
      look = { ...presets[i].look };
      rebuildHero();
    }
    persist();
    shell.paintLocker();
  },
  /**
   * Equip a royal candidate.
   *
   * One call dresses every slot, fixes her signature melee and grants her
   * ability — the ability lives on the candidate id in the look, so she keeps
   * it while a player restyles her and loses it if they swap the model.
   */
  candidate(id) {
    const next = candidateLook(id);
    if (!next) return;
    const c = candidateById(id);
    look = next;
    rebuildHero();
    persist();
    if (screen === 'locker') shell.paintLocker();
    shell.toast(`Candidate ${c.candidate}   ${c.codename} equipped — ${c.ability.name}`);
  },
  light(id) { studio.setLighting(id === 'sunset' ? 'sunset' : id); },
  anim(id) {
    viewerPose = id;
    if (id === 'walk' || id === 'run' || id === 'idle') studio.setPose('idle');
    else studio.setPose(id);
  },
  focus(part) { studio.focus(part); },
  previewJiggle(v) { previewJiggle = v; settings.jiggle = v; persist(); },
  setting(key, value) {
    settings[key] = value;
    if (key === 'volume' || key === 'music') audio.apply();
    if (key === 'text') document.documentElement.style.setProperty('--text', value);
    if (key === 'touch') document.body.classList.toggle('touch-on', !!value || matchMedia('(pointer: coarse)').matches);
    persist();
  },
  bind(action, code) {
    for (const [k, v] of Object.entries(settings.bindings)) {
      if (v === code && k !== action) settings.bindings[k] = settings.bindings[action];
    }
    settings.bindings[action] = code;
    persist();
  },
  resetBinds() {
    settings.bindings = { ...DEFAULT_SETTINGS.bindings };
    persist();
    shell.paintSettings();
  },
  selectItem(i) { if (match) match.selectItem(i); },
  cycleItem(d) { if (match) match.cycleItem(d); },
  useItem() { if (match) match.useItem(); },
  dropItem() { if (match) match.dropItem(); },
  sortItems() { if (match) match.sortItems(); },
  moveItem(a, b) { if (match) match.moveItem(a, b); },
  paused() { return !!paused; },
  ended() { return !!(match && match.ended && match.ended()); },
});

// The PSX roster is no longer pulled. Those 45 Mixamo FBX files ship skeletons
// but no animation clips, so every one of them is posed by the procedural rig
// and slides instead of stepping -- which is the exact "unanimated characters"
// this build was asked to drop. Leaving the call in place meant the locker
// repainted with 45 statues and the drop paid for 45 FBX downloads that nothing
// animated. The cast is now the seven clip-driven models in CHARACTERS; if a
// genuinely animated FBX roster ever lands, re-add this alongside a clip-count
// check, not a joint-count one.
function go(name) {
  screen = name;
  paused = false;
  shell.setScreen(name);
}

function modeStudio(name) {
  screen = name;
  shell.setScreen(name);
  if (document.pointerLockElement) document.exitPointerLock();
}

function open(name) {
  if (screen === 'game' || screen === 'pause' || ended()) returnTo = paused ? 'pause' : ended() ? 'end' : screen === 'menu' ? null : 'menu';
  if (screen === 'menu' || screen === 'splash') returnTo = null;
  if (name === 'viewer' || name === 'locker' || name === 'armory' || name === 'settings') {
    if (screen === 'game' || screen === 'pause') returnTo = paused || screen === 'pause' ? 'pause' : 'end';
  }
  modeStudio(name);
  if (name === 'viewer') {
    studio.setPose(look.loading || 'idle');
    viewerPose = 'idle';
  }
}

function back() {
  if (screen === 'pause') {
    paused = false;
    screen = 'game';
    shell.setScreen('game');
    return;
  }
  if (returnTo === 'pause' || returnTo === 'end') {
    const dest = returnTo;
    returnTo = null;
    screen = dest === 'pause' ? 'pause' : 'game';
    if (dest === 'pause') paused = true;
    if (match) match.applyProfile();
    shell.setScreen(screen);
    return;
  }
  returnTo = null;
  modeStudio('menu');
}

/**
 * Which map to build.
 *
 * `?map=graybox` loads the proving ground instead of the island: flat measured
 * terrain, stationary dummies, every gun on a plinth and no storm.
 * `?map=sakura` loads Sakura Isle, the six-district blockout. It is a real
 * battle-royale map -- real drop, real storm, real bots -- built entirely from
 * untextured primitives, so it loads instantly and costs no assets.
 *
 * The map is read from the URL rather than from the save file so it cannot be
 * written into a player's profile by accident, and so it behaves identically
 * for a person with a browser and for the headless render harness in tools/.
 * The menu's "Range (dev)" button just sets this parameter and reloads.
 */
function currentMap() {
  const p = new URLSearchParams(location.search).get('map');
  if (p === 'graybox' || p === 'range') return 'graybox';
  if (p === 'island' || p === 'classic') return 'island';
  if (p === 'sakura' || p === 'isle') return 'sakura';
  return 'city';
}

function startMatch() {
  audio.unlock();
  audio.setMusicDuck(false);
  paused = false;
  returnTo = null;
  countedResult = false;
  if (document.pointerLockElement) document.exitPointerLock();
  if (!match) {
    match = createMatch({ getSettings: () => settings, audio, getLook: () => look, renderer, map: currentMap() });
    screen = 'loading';
    shell.setScreen('loading');
    studio.setPose(look.loading || 'beam');
    return;
  }
  if (!match.ready()) {
    screen = 'loading';
    shell.setScreen('loading');
    return;
  }
  match.reset();
  match.applyProfile();
  screen = 'game';
  shell.setScreen('game');
}

/**
 * Viewport height, kept at module scope so the on-screen size ranking in
 * window.__brDiag can use it as a pixel scale. Declared inside resize() it
 * would be a local, and the diagnostic would quietly report nothing.
 */
let H = 720;

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  H = h;
  studio.camera.aspect = w / h;
  studio.camera.updateProjectionMatrix();
  if (match) match.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('click', () => {
  audio.unlock();
  if (screen === 'game' && !paused && match && match.ready() && !match.setCaptureWanted() && !ended()) {
    canvas.requestPointerLock();
  }
});

bindStick('stick-move', false);
bindStick('stick-look', true);
for (const btn of document.querySelectorAll('[data-touch]')) {
  const key = btn.dataset.touch;
  const down = (v) => {
    const patch = {};
    patch[key] = v;
    input.setVirtual(patch);
  };
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); down(true); });
  btn.addEventListener('pointerup', () => down(false));
  btn.addEventListener('pointercancel', () => down(false));
}

function bindStick(id, lookStick) {
  const el = document.getElementById(id);
  if (!el) return;
  let pid = null;
  let ox = 0;
  let oy = 0;
  el.addEventListener('pointerdown', (e) => {
    pid = e.pointerId;
    ox = e.clientX;
    oy = e.clientY;
    el.setPointerCapture(pid);
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    const dx = (e.clientX - ox) / 48;
    const dy = (e.clientY - oy) / 48;
    if (lookStick) input.addLook(dx * 0.07, dy * 0.07);
    else input.setVirtual({
      moveX: Math.max(-1, Math.min(1, dx)),
      moveY: Math.max(-1, Math.min(1, -dy)),
    });
  });
  const end = (e) => {
    if (pid != null && e.pointerId !== pid) return;
    pid = null;
    if (!lookStick) input.setVirtual({ moveX: 0, moveY: 0 });
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

document.documentElement.style.setProperty('--text', settings.text || 1);
if (settings.touch) document.body.classList.add('touch-on');

const caps = ['Raising the plaza', 'Dressing the market', 'Stacking the skyline', 'Wiring the lights', 'Waking the roster'];
let last = performance.now();
let gameMode = false;

// Frame-time accumulator, reported through window.__brDiag.
const perf = { frames: 0, fps: 0, worst: 0, acc: 0, n: 0 };
let perfLast = 0;
/** Set by window.__brFreeCam; applied every frame until replaced. */
let freeCam = null;
/**
 * Scratch objects for the free-cam world->local conversion below. Allocated
 * once at module scope: this runs every frame while an inspection camera is
 * parked, and a debug view is not worth the garbage.
 */
const _freecamEye = new THREE.Vector3();
const _freecamPos = new THREE.Vector3();
const _freecamTgt = new THREE.Vector3();
const _freecamUp = new THREE.Vector3(0, 1, 0);
const _freecamMat = new THREE.Matrix4();
const _freecamInv = new THREE.Matrix4();
const _freecamQuat = new THREE.Quaternion();
const _freecamParentQuat = new THREE.Quaternion();
const _freecamIdent = new THREE.Matrix4();

function frame(now) {
  // Frame timing for the headless render harness, averaged over 500 ms so a
  // single slow frame does not make the number useless. perfLast starts at 0,
  // so seed it on the first frame rather than reporting a multi-second "frame".
  if (perfLast === 0) perfLast = now;
  {
    const ms = now - perfLast;
    perfLast = now;
    perf.frames += 1;
    perf.acc += ms;
    perf.n += 1;
    if (ms > perf.worst) perf.worst = ms;
    if (perf.acc >= 500) {
      perf.fps = Math.round((perf.n * 1000) / perf.acc);
      perf.acc = 0;
      perf.n = 0;
    }
  }
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  const actions = input.update(dt);
  input.setCapture(screen === 'game' && match && match.setCaptureWanted());

  // The bag is a modal over the game screen, so it is handled before the
  // pause/menu branch: Escape has to close the bag rather than drop the player
  // a level further back into the pause menu, and Tab has to reach the shell
  // instead of being swallowed by the generic activate path.
  if (shell.bagOpen()) {
    if (actions.invPressed || actions.pausePressed || actions.backPressed) {
      shell.toggleBag(false);
      document.pointerLockElement && document.exitPointerLock();
    } else {
      shell.pump(actions);
    }
  } else if (screen === 'game' && actions.invPressed && !ended()) {
    shell.toggleBag(true);
    document.pointerLockElement && document.exitPointerLock();
  } else if (screen === 'pause' && (actions.pausePressed || actions.backPressed)) {
    paused = false;
    screen = 'game';
    shell.setScreen('game');
  } else if (screen === 'game' && actions.pausePressed && !ended()) {
    paused = true;
    screen = 'pause';
    document.pointerLockElement && document.exitPointerLock();
    shell.setScreen('pause');
  } else {
    shell.pump(actions);
  }
  const flags = {
    autoRotate: screen === 'menu' || screen === 'splash' || screen === 'loading',
    orbit: screen !== 'game',
    gamepadOrbit: actions.device === 'gamepad' && screen !== 'game' && screen !== 'loading',
    jiggle: previewJiggle || settings.jiggle || 1,
    extra: screen === 'splash' || screen === 'viewer' && (previewJiggle || settings.jiggle) > 1.25,
    walk: viewerPose === 'walk' || viewerPose === 'run',
    run: viewerPose === 'run',
  };

  if (screen === 'loading' && match) {
    const p = match.buildStep();
    shell.progress(p, caps[Math.min(caps.length - 1, Math.floor(p * caps.length))]);
    studio.setPose(look.loading || 'beam');
    if (p >= 1) {
      screen = 'game';
      shell.setScreen('game');
      shell.toast('Click to look. Xbox pad works without the click.');
    }
    studio.update(dt, actions, flags);
    outline.render(studio.scene, studio.camera);
  } else if (screen === 'game' || screen === 'pause') {
    gameMode = true;
    if (!paused && match) {
      match.update(dt, actions);
      for (const e of match.pull()) shell.onEvent(e);
      shell.hud(match.snapshot(), actions.device);
    } else if (match) {
      shell.hud(match.snapshot(), actions.device);
    }
    // Pay the match out once. The result object survives every later frame (and
    // every return to the menu), so without this guard the same win would be
    // credited every frame from the end screen to the next drop.
    const result = match.getResult();
    if (result && !countedResult) {
      countedResult = true;
      stats = awardProgress(stats, result);
      persist();
    }
    const cam = match.activeCamera();
    if (freeCam) {
      // Place the camera at a *world* pose. The game camera is a child of
      // pitchPivot, so assigning position/lookAt directly sets its pose in the
      // pivot's local space and the player rig silently moves it -- a request for
      // an eye at y=10 came back at y=60 whenever the player was up on the lobby
      // deck, and every inspection shot framed the underside of the lobby
      // instead of the city it was meant to be auditing. Convert the requested
      // world pose into the parent's space before applying it.
      // `lookAt` needs the eye in world space, but the value assigned to the
      // camera has to be in the parent's space -- so keep them in two separate
      // vectors. Sharing one let the world-space `set()` overwrite the local
      // position moments before it was copied in, so the rig offset got added
      // on top of an eye that was already in world terms.
      _freecamEye.set(freeCam.eye[0], freeCam.eye[1], freeCam.eye[2]);
      _freecamTgt.set(freeCam.target[0], freeCam.target[1], freeCam.target[2]);
      const parent = cam.parent;
      if (parent) parent.updateWorldMatrix(true, false);
      const inv = _freecamInv.copy(parent ? parent.matrixWorld : _freecamIdent).invert();
      _freecamPos.copy(_freecamEye).applyMatrix4(inv);
      _freecamQuat.setFromRotationMatrix(_freecamMat.lookAt(_freecamEye, _freecamTgt, _freecamUp));
      _freecamQuat.premultiply(_freecamParentQuat.setFromRotationMatrix(inv));
      cam.position.copy(_freecamPos);
      cam.quaternion.copy(_freecamQuat);
    }
    outline.render(match.scene, cam);
  } else {
    if (screen === 'splash') studio.setPose('idle');
    studio.update(dt, actions, flags);
    outline.render(studio.scene, studio.camera);
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);


window.__brSkipBus = () => (match ? match.skipBus() : 'no-match');

/**
 * The live match object, for probes that have to drive a whole match.
 *
 * Every other hook here answers one narrow question (what is drawn, what is in
 * hand, where is the camera). None of them can answer "does a match actually
 * run from lobby to a landed, armed player", which is the question the island
 * probe needs: the graybox range starts already in `play` with a full loadout,
 * so the entire drop path is invisible to it.
 *
 * Handing back the live object is the same deal as `bots()`/`player` in
 * match.js - read it, step it, but the game keeps owning it. Probes drive it
 * through `update()` with a synthetic input frame, which advances the sim clock
 * exactly the way the render loop does, minus the waiting for a drawn frame.
 */
window.__brMatch = () => match;

/**
 * Arm a specific weapon in the first-person viewmodel, for render-harness probes.
 * Goes through the match (not through a direct viewmodel.js import) because the
 * page's own module instance is the one holding the live viewmodel.
 */
window.__brSetWeapon = (id) => (match ? match.setViewmodelWeapon(id) : 'no-match');

/**
 * The live scene graph, for render-harness probes.
 *
 * A screenshot says "something is black"; only the scene can say which mesh and
 * why. Black-silhouette bugs in this project have had three unrelated causes
 * (back-facing foliage cards, authored-as-metal props, and a double-sided
 * transparent wall compositing over the whole screen), and telling them apart
 * from a PNG is guesswork.
 */
window.__brScene = () => (match ? match.scene : studio.scene);

/**
 * The live renderer and camera, for probes that need to render on demand.
 *
 * Reading the scene graph tells you what *could* be drawing black; only
 * rendering it tells you what *is*. An isolation probe that hides one subtree
 * at a time and samples the framebuffer needs both of these, and rebuilding
 * either from the scene is guesswork. Deliberately read-only: a probe gets
 * pointers, never ownership.
 */
window.__brRenderer = () => renderer;
window.__brCamera = () => (match ? match.activeCamera() : studio.camera);
/**
 * The three.js namespace the app is already running.
 *
 * Probes run in the page and cannot `import('three')` — there is no import map
 * in the document, so the specifier fails to resolve. Handing back the live
 * module costs nothing and lets a probe construct a Raycaster or a Vector3
 * without bundling a second copy.
 */
window.__brTHREE = THREE;

/**
 * Park a debug camera so the render harness can inspect the island from angles
 * the player camera can never reach.
 *
 * Sticky: it stays applied every frame until replaced or released with null.
 * A one-shot override looked like it worked — the harness screenshot 2.5 s later
 * caught the player camera instead, and every "inspection shot" was a duplicate
 * of the gameplay view.
 */
window.__brFreeCam = (eye, target) => {
  freeCam = eye ? { eye, target } : null;
};

/** Turn shadow casting off, to separate "unlit" from "wrongly self-shadowed". */
window.__brNoShadows = () => {
  const s = match ? match.scene : studio.scene;
  let n = 0;
  s.traverse((o) => {
    if (o.isLight && o.castShadow) { o.castShadow = false; n += 1; }
  });
  return n;
};

/**
 * Measure the first-person viewmodel instead of squinting at a screenshot.
 *
 * The viewmodel is procedural, so it exists before a single GLB resolves, and
 * `__brDiag` deliberately ignores anything within 1.5m of the lens - which is
 * exactly where it lives. The result is that "the gun is not drawn" and "the
 * gun is drawn at forty times life size" produce the same picture, and only one
 * of them is a bug.
 *
 * Projects the viewmodel's world bounding box through the live camera and
 * reports how much of the viewport it claims. A first-person body should sit in
 * a corner; anything covering most of the screen is a wall, not a viewmodel.
 */
window.__brViewmodel = () => {
  const cam = match ? match.activeCamera() : studio.camera;
  cam.updateMatrixWorld(true);
  const pivot = cam.parent;
  if (!pivot) return { error: 'camera has no parent pivot' };
  const vm = pivot.children.find((c) => !c.isPerspectiveCamera);
  if (!vm) return { error: 'no viewmodel group beside the camera' };

  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const box = new THREE.Box3().setFromObject(vm);
  box.getSize(size);
  box.getCenter(centre);
  // The box is in world space, so it has to be compared against the camera's
  // world position. camera.position is local to the pitch pivot and reads
  // (0,0,0) from here, which silently turns "how far is the gun from my eye"
  // into "how far is the island from the origin".
  const camWorld = cam.getWorldPosition(new THREE.Vector3());

  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  let behind = 0;
  for (const cx of [box.min.x, box.max.x]) {
    for (const cy of [box.min.y, box.max.y]) {
      for (const cz of [box.min.z, box.max.z]) {
        const v = new THREE.Vector3(cx, cy, cz).project(cam);
        if (v.z > 1) behind += 1;
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
    }
  }
  const frac = (a, b) => Math.max(0, Math.min(1, (b - a) / 2));
  return {
    near: cam.near,
    fov: cam.fov,
    distToLens: +centre.distanceTo(camWorld).toFixed(3),
    worldSize: [size.x, size.y, size.z].map((n) => +n.toFixed(2)),
    ndcX: [+minX.toFixed(2), +maxX.toFixed(2)],
    ndcY: [+minY.toFixed(2), +maxY.toFixed(2)],
    coveragePct: [Math.round(frac(minX, maxX) * 100), Math.round(frac(minY, maxY) * 100)],
    cornersBehindCamera: behind,
  };
};

/**
 * Every viewmodel child with its world-space size, largest first.
 *
 * `__brViewmodel` answers "is the viewmodel too big"; it cannot answer "which
 * part of it is too big". A first-person body is ~15 small primitives plus a
 * weapon, and a single mis-scaled GLB child among them is invisible in an
 * aggregate number. This names the offender with its geometry, colour and
 * on-screen pixel span, so "the ak47 is life size" is a fact, not a guess.
 */
window.__brViewmodelTree = () => {
  const cam = match ? match.activeCamera() : studio.camera;
  cam.updateMatrixWorld(true);
  const pivot = cam.parent;
  if (!pivot) return { error: 'camera has no parent pivot' };
  const vm = pivot.children.find((c) => !c.isPerspectiveCamera);
  if (!vm) return { error: 'no viewmodel group beside the camera' };
  vm.updateMatrixWorld(true);

  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const camWorld = cam.getWorldPosition(new THREE.Vector3());
  const rows = [];
  vm.traverse((o) => {
    if (!o.isMesh) return;
    box.setFromObject(o);
    if (box.isEmpty()) return;
    box.getSize(size);
    box.getCenter(centre);
    const dist = centre.distanceTo(camWorld);
    if (dist < 1e-4) return;
    rows.push({
      name: o.name || o.geometry.type,
      geo: o.geometry.type,
      scale: +o.scale.x.toFixed(3),
      world: [size.x, size.y, size.z].map((n) => +n.toFixed(3)),
      dist: +dist.toFixed(3),
      // Where the centre of this part actually lands on screen. `px` below is how
      // much of the frame it spans; this is *where*, which is what tells you a
      // weapon is pointing sideways or sitting under the bezel.
      ndc: (() => {
        const v = centre.clone().project(cam);
        return [+v.x.toFixed(2), +v.y.toFixed(2)];
      })(),
      // Same span estimate __brDiag uses: a span at a distance, in viewport
      // heights. Comparable across children, so one row is obviously the wall.
      px: Math.round((Math.max(size.x, size.y, size.z) / dist) * H * 0.9),
      color: o.material && o.material.color ? `#${o.material.color.getHexString()}` : '??',
    });
  });
  rows.sort((a, b) => b.px - a.px);
  return { total: rows.length, viewportH: H, rows };
};

/**
 * Runtime diagnostics for the headless render harness.
 *
 * The whole point of this block is to turn "the map looks wrong" into a number
 * you can act on. Each section is wrapped so a bug in one measurement cannot
 * blind all the others.
 */
window.__brDiag = () => {
  const info = renderer.info;
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const scene = match ? match.scene : studio.scene;
  const cam = match ? match.activeCamera() : studio.camera;
  const safe = (fn) => {
    try { return fn(); } catch (e) { return { error: e.message }; }
  };

  let meshes = 0;
  let skinned = 0;
  let bones = 0;
  let mirrors = 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes += 1;
    if (o.isSkinnedMesh) {
      skinned += 1;
      bones += o.skeleton ? o.skeleton.bones.length : 0;
    }
    const m = o.material;
    if (m && m.metalness >= 0.9 && (m.roughness ?? 1) < 0.35) mirrors += 1;
  });

  return {
    screen,
    phase: match ? match.phase() : null,
    fps: perf.fps,
    worstFrameMs: Math.round(perf.worst),
    frames: perf.frames,
    drawCalls: info.render.calls,
    triangles: info.render.triangles,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: info.programs ? info.programs.length : 0,
    sceneMeshes: meshes,
    sceneSkinnedMeshes: skinned,
    skinnedBones: bones,
    // A near-perfect metal with nothing to reflect renders pure black, which is
    // how an entire kit of imported props turns into black cut-outs.
    mirrorMaterials: mirrors,
    envSet: !!scene.environment,
    assets: assetReport(),
    player: match && match.debugState ? safe(() => match.debugState()) : null,
    bots: match && match.debugBots ? safe(() => match.debugBots()) : null,
    city: match && match.cityBounds ? safe(() => match.cityBounds()) : null,
    // Whatever is actually filling the frame. A 0.5-unit quad a metre from the
    // lens covers far more pixels than a 100-unit one on the horizon, so world
    // size is the wrong question - ask what is big *on screen* instead.
    onScreen: safe(() => {
      cam.updateMatrixWorld(true);
      const out = [];
      const box = new THREE.Box3();
      const size = new THREE.Vector3();
      const centre = new THREE.Vector3();
      const v = new THREE.Vector3();
      scene.traverse((o) => {
        if (!o.isMesh) return;
        box.setFromObject(o);
        box.getSize(size);
        const span = Math.max(size.x, size.y, size.z);
        if (!(span > 0.05) || span > 300) return;
        box.getCenter(centre);
        const dist = centre.distanceTo(cam.position);
        // Skip anything sitting on the lens: distance 0 makes the projected size
        // infinite and floods the ranking with pooled particles at the origin.
        if (dist < 1.5 || dist > 140) return;
        v.copy(centre).project(cam);
        if (v.z > 1) return; // behind the camera
        const px = (span / dist) * H * 0.9;
        if (!(px >= 40)) return;
        out.push({
          px: Math.round(px),
          span: +span.toFixed(2),
          size: [size.x, size.y, size.z].map((n) => +n.toFixed(2)),
          dist: +dist.toFixed(1),
          type: o.material ? o.material.type : '?',
          color: o.material && o.material.color ? `#${o.material.color.getHexString()}` : '??',
          hasMap: !!(o.material && o.material.map),
          at: [box.min.x, box.min.y, box.min.z].map((n) => +n.toFixed(1)),
        });
      });
      out.sort((a, b) => b.px * b.px - a.px * a.px);
      return out.slice(0, 10);
    }),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
  };
};

/**
 * Every bot's rig state, for render-harness probes.
 *
 * `__brDiag` reports counts; this reports the per-bot truth that explains them.
 * The question it exists to answer is "is this actor actually being driven by
 * the rig, or is it a static mesh with an avatar object attached" — which
 * looks identical in a screenshot and completely different here.
 */
window.__brBots = () => (match ? match.debugBots() : null);
window.__brGiveItem = (id, n) => (match ? match.debugGiveItem(id, n) : { ok: false, reason: 'no-match' });
window.__brInv = () => (match ? match.debugInventory() : null);
// The top-down island image for the HUD minimap, built on first ask.
window.__brMapImage = () => (match && match.mapImage ? match.mapImage() : null);
// World radius that image covers, in metres. The minimap crop has to convert
// metres-to-pixels with it; guessing that ratio is how the first version drew a
// one-to-one crop of a 1024px image into a 160px box.
window.__brMapRadius = () => (match && match.mapRadius ? match.mapRadius() : 0);
window.__brOpenBag = () => { shell.toggleBag(true); return shell.bagOpen(); };

/** The per-actor rig truth: which model, is it rigged, is it on screen. */
window.__brCast = () => (match && match.debugCast ? match.debugCast() : null);

window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
});

