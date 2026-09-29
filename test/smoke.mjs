import * as THREE from 'three';
import fs from 'node:fs';
import { installAssetFetch } from './asset-fetch.mjs';

installAssetFetch();

const ctx2d = new Proxy({}, { get: () => () => {} });
globalThis.document = {
  createElement() {
    return { width: 128, height: 128, getContext: () => ctx2d };
  },
};

const { createMatch } = await import('../src/game/match.js');
const { createRoster, assignBotModels, ANIMATED } = await import('../src/game/bots.js');
const { setAssetManifest, loadPsxManifest } = await import('../src/data/assets.js');
const { addPsxModels } = await import('../src/data/catalog.js');
const { ISLAND_R, CITY_R, CITY_LIFT, PLAZA_Y, SEA_Y, heightAt, setTerrain, buildWorld } = await import('../src/world/map.js');
const { readFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const look = {
  name: 'Yuna', title: 'Crystal Darling', body: 'darling', face: 'doll', skin: '#ffd0c2',
  makeup: 'blush', hair: 'long', hairColor: '#ff4f9a', eye: '#3ee0ff', top: 'triangle',
  bottom: 'micro', cloth: '#ff3d8a', pattern: 'solid', trim: '#7af6ff', wet: false, sheer: false,
  glow: true, accessories: ['choker'], wrap: 'sakura', charm: 'heart', melee: 'katana',
  // Candidate A rides along so the royal decree is exercised against a real
  // storm further down; her ability lives on the sheet, not on the match.
  candidate: 'thalassa',
  emote: 'blowkiss', victory: 'sparkle', loading: 'beam', banner: 'mythic',
};
const settings = { mouse: 0.002, gamepad: 2, fov: 78, invert: false, volume: 0, music: 0, jiggle: 1, assist: true, shake: false, text: 1, touch: false, bindings: {} };
const audio = { sfx() {}, setMusicDuck() {}, apply() {} };
const match = createMatch({ getSettings: () => settings, audio, getLook: () => look, map: 'island' });

// The bot roster and the player locker both read the generated asset manifest,
// which the browser fetches and node cannot. Seed it from disk so both paths run.
setAssetManifest(JSON.parse(readFileSync(
  fileURLToPath(new URL('../public/assets/manifest.json', import.meta.url)),
  'utf8',
)));

/* --- What is actually in the city model? -------------------------- */
/* A bounding box is the difference between "scale the city to fit" and
   "scale it to fit one stray outlying prop". Measured, not assumed. */
{
  const buf = fs.readFileSync(PUBLIC + 'assets/maps/pvp_map.glb');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) === 0x46546c67) {
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(Buffer.from(buf.buffer, buf.byteOffset + 20, jsonLen).toString('utf8'));
    let meshes = 0; let nodes = 0; let withSkin = 0;
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    // Accessor min/max are per-mesh, which is enough to bound the whole model.
    for (const mesh of json.meshes || []) {
      meshes++;
      for (const prim of mesh.primitives || []) {
        for (const key of ['POSITION']) {
          const a = (json.accessors || [])[prim.attributes[key]];
          if (!a || !a.min) continue;
          for (let i = 0; i < 3; i++) {
            if (a.min[i] < min[i]) min[i] = a.min[i];
            if (a.max[i] > max[i]) max[i] = a.max[i];
          }
        }
      }
    }
    nodes = (json.nodes || []).length;
    withSkin = (json.nodes || []).filter((n) => n.skin).length;
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map((v) => v.toFixed(1));
    console.log(`city model: ${meshes} meshes, ${nodes} nodes, ${withSkin} skinned`);
    console.log(`city model local size: ${size.join(' x ')}  (min ${min.map((v) => v.toFixed(0)).join(',')})`);
    console.log(`city model: ${(json.materials || []).length} materials, ` +
      `${(json.images || []).length} images, ${(json.textures || []).length} textures, ` +
      `${(json.accessors || []).length} accessors`);

    // A 13 MB model with no textures is a shape dump, not a city. It will render
    // as flat untextured silhouettes no matter how well it is placed.
    if (!(json.materials || []).length) throw new Error('city model has no materials');
    if (!(json.images || []).length) throw new Error('city model has no textures  Æ —Å— it will render untextured');
    // Nine units of height for a 55-unit footprint reads as a car park.
    if (size[1] / Math.max(size[0], size[2]) < 0.12) {
      throw new Error(`city is too flat to read as vertical: ${size.join(' x ')}`);
    }

    // The bug this catches: fitting to a bounding box that one far-flung prop
    // inflates leaves the actual city a fraction of its intended footprint.
    if (Math.min(size[0], size[2]) <= 0) throw new Error('city model is flat on one axis');
  }
}

/* --- The island must face the sky ------------------------------- */
/* An inverted terrain winding produces no error, no warning and no missing
   geometry  Æ —Å— it just lights the whole island from underneath, so the grass,
   the beach and the crater all render as one flat dark mass. The only way to
   notice is to look at the normals, so look at the normals. */
{
  let up = 0;
  let down = 0;
  const scene = new THREE.Scene();
  await buildWorld(scene, 11);
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.color) return;
    const n = o.geometry.attributes.normal;
    if (!n) return;
    let sum = 0;
    for (let i = 0; i < n.count; i++) sum += n.getY(i);
    if (sum > 0) up++;
    else down++;
  });
  if (up === 0) throw new Error('every coloured surface has downward normals  Æ —Å— the terrain is inside-out');
  if (down > 0) throw new Error(`${down} coloured surface(s) are inside-out`);

  // And the island must actually have relief: a flat plane passes the normal
  // test but is not a map.
  const heights = [];
  for (let i = 0; i < 400; i++) {
    const a = (i / 400) * Math.PI * 2;
    const r = ISLAND_R * 0.8;
    heights.push(heightAt(Math.cos(a) * r, Math.sin(a) * r));
  }
  const spread = Math.max(...heights) - Math.min(...heights);
  if (spread < 1.5) throw new Error(`island is essentially flat (relief ${spread.toFixed(2)} units)`);

  // The city must be tall enough to be a skyline, and short enough to fight in.
  // The city must be real cover you can fight around AND see over.
  //
  // This used to assert the opposite: it required the block to top out above 12
  // units so downtown would "read as a skyline". At CITY_LIFT 2.6 that produced
  // 52 collision boxes over 6m tall, which turned downtown into a solid wall that
  // broke every sight line - the player reported never seeing another fighter
  // while 43 actors stood around them, the nearest 10m away at eye level.
  //
  // So the assertion is about playability rather than silhouette: low enough that
  // a standing player can see and shoot over the rooftops, tall enough to still be
  // cover worth breaking a sight line for.
  const cityScaleY = (CITY_R * 2 - 16) / 54.8 * CITY_LIFT;
  const cityTop = PLAZA_Y + 9.4 * cityScaleY;
  const EYE = 1.58;
  console.log(`city tops out at y=${cityTop.toFixed(1)} (plaza ${PLAZA_Y}), island relief ${spread.toFixed(1)}`);
  // A player standing on the plaza must be able to see over the block from a
  // standing eye height, otherwise downtown is a wall again. "Over" means the
  // rooftops sit below eye level plus headroom for the horizon to read.
  if (cityTop > PLAZA_Y + EYE + 6) {
    throw new Error(`city reaches ${cityTop.toFixed(1)}, well over eye height above the ${PLAZA_Y} plaza - it blocks sight lines again`);
  }
  if (cityTop < PLAZA_Y + 3) throw new Error(`city only reaches ${cityTop.toFixed(1)} units - too low to be cover`);
  if (cityTop > 60) throw new Error(`city reaches ${cityTop.toFixed(1)} units - absurd for a ${ISLAND_R}-unit island`);
}


/* --- Effects must never put NaN in the scene graph ------------------ */
/* A particle with a NaN transform rasterises as a large black rectangle
   hanging in the sky. It reads as a broken map, not a broken effect, and it
   leaves no trace in any log — so assert the scene stays finite after the FX
   layer is deliberately fed garbage. */
{
  const { createFx } = await import('../src/vfx/fx.js');
  const scene = new THREE.Scene();
  const f = createFx(scene);
  const bad = { x: NaN, y: 1, z: 0 };
  const inf = { x: Infinity, y: 0, z: 0 };
  const good = new THREE.Vector3(1, 2, 3);
  // None of these should throw, and none should leave a non-finite transform.
  f.burst(bad, '#ff4f9a', 6, 3);
  f.burst(inf, '#ff4f9a', 6, 3);
  f.hearts(bad);
  f.muzzle(inf);
  f.confetti(bad);
  f.tracer(bad, good);
  f.tracer(good, inf);
  f.tracer(good, good);          // coincident endpoints: lookAt would be NaN
  f.burst(good, '#7dfff0', 4, 2); // sanity: a good call still spawns
  f.update(1 / 60);

  let offenders = 0;
  scene.traverse((o) => {
    if (!o.isMesh && !o.isLight) return;
    const p = o.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) offenders++;
    o.updateMatrixWorld(true);
    for (const v of o.matrixWorld.elements) if (!Number.isFinite(v)) offenders++;
  });
  if (offenders) throw new Error(`${offenders} fx transform(s) went non-finite — expect black rectangles in the sky`);
}

/* --- Every bot should get a clip-driven body ------------------------- */
{
  const roster = await loadPsxManifest();
  const added = addPsxModels(roster);
  if (added !== roster.length) throw new Error(`locker took ${added}/${roster.length} rigged characters`);

  const bots = createRoster('Yuna');
  if (bots.length !== 49) throw new Error(`expected 49 bots, got ${bots.length}`);
  await assignBotModels(bots);

  /**
   * This used to assert 25+ PSX bodies with 20+ distinct silhouettes, and it
   * was right for the decision it was written for. That decision has been
   * reversed: the PSX models are static FBX files with no clips, so they are
   * driven by the procedural rig, which slides rather than steps and does not
   * handle a weapon convincingly. Variety was bought at the cost of the
   * characters reading as people, and the player reported exactly that.
   *
   * So the assertion is the opposite one now: every bot draws from the small
   * set of models that actually ship animation clips, and the whole set is
   * used. Three repeated silhouettes is a known, accepted cost of having
   * anyone move properly at all, and it is what `usePsx: true` is there to
   * undo if more rigged models land.
   */
  const unassigned = bots.filter((b) => !b.look.model);
  if (unassigned.length) throw new Error(`${unassigned.length} bot(s) got no model at all`);
  const wrong = bots.filter((b) => !ANIMATED.includes(b.look.model));
  if (wrong.length) {
    throw new Error(`${wrong.length} bot(s) are not clip-driven, e.g. ${wrong[0].look.model}`);
  }
  const distinct = new Set(bots.map((b) => b.look.model));
  if (distinct.size !== ANIMATED.length) {
    throw new Error(`only ${distinct.size}/${ANIMATED.length} clip-driven models are in use`);
  }
  // The PSX library must stay reachable, or the fallback is gone for good
  // rather than merely off.
  const psxBots = createRoster('Yuna');
  await assignBotModels(psxBots, { animatedEvery: 0, usePsx: true });
  if (!psxBots.some((b) => String(b.look.model).startsWith('character_'))) {
    throw new Error('the PSX fallback no longer assigns anything');
  }

  // The model has to survive the trip into an avatar. `createWaifu` chooses
  // between an import and the procedural body, and a detail-level guard once
  // meant every bot silently got the fallback  Æ —Å— the models were on disk, in the
  // manifest, and never once rendered.
  const { createWaifu } = await import('../src/avatar/waifu.js');
  // Sampled from the whole roster now, not from the PSX slice, because the
  // roster no longer has one.
  for (const look of bots.slice(0, 3).map((b) => b.look)) {
    const av = createWaifu(look, 'lite');
    if (av.isGlb !== true) throw new Error(`bot look "${look.model}" built a procedural avatar at detail 'lite'`);
    if (!av.load.url) throw new Error(`import avatar for "${look.model}" has no asset url`);
  }
}

/* --- The island is meant to be small, flat where the city stands ------ */
if (ISLAND_R > 60) throw new Error(`island is still huge (r=${ISLAND_R})`);
if (Math.abs(heightAt(0, 0) - heightAt(20, 20)) > 0.8) throw new Error('the city plaza is not flat');
if (heightAt(ISLAND_R + 10, 0) > -4) throw new Error('terrain does not fall away past the island edge');

// buildStep is driven from requestAnimationFrame in the browser, so yield
// between calls here too  Æ —Å— the world streams its kit assets asynchronously.
const yieldTick = () => new Promise((r) => setTimeout(r, 0));
let p = 0;
// three only warns about an undefined material `color`, which is easy to miss
// and surfaces on screen as a black surface. Trap it while the world is built.
const realWarn = console.warn;
const colourless = [];
console.warn = (...a) => {
  if (String(a[0]).includes("'color' has value of undefined")) {
    colourless.push(new Error('material').stack.split('\n').slice(1, 4).join(' <- '));
  } else realWarn(...a);
};
for (let i = 0; i < 400 && p < 1; i++) {
  const next = match.buildStep();
  if (next < p - 1e-6) throw new Error(`build progress went backwards (${p} -> ${next})`);
  p = next;
  await yieldTick();
}
console.warn = realWarn;
if (p < 1) { console.error('build did not finish', p); process.exit(1); }
if (colourless.length) {
  console.error(`materials built without a colour: ${[...new Set(colourless)].join(' | ')}`);
  process.exit(1);
}
const input = {
  moveX: 0, moveY: 1, lookX: 0.01, lookY: 0, fire: false, aim: false,
  jumpHeld: false, jumpPressed: false, crouchHeld: false, crouchPressed: false,
  sprint: true, reloadPressed: false, interactPressed: false, interactHeld: false,
  meleePressed: false, dashPressed: false, usePressed: false, swapPressed: false,
  inspectPressed: false, emotePressed: false, scoreHeld: false, pausePressed: false,
  confirmPressed: false, backPressed: false, uiLeft: false, uiRight: false, uiUp: false, uiDown: false,
  weaponSlot: 0, itemPrev: false, itemNext: false, device: 'keyboard',
};
// Walk forward for a few frames first, then play the match out so the phase
// machine, the bots and the zone are all actually exercised.
let snap = null;
/* --- The player must never have a non-finite position --------------- */
/* A NaN position is invisible in a screenshot and fatal in play: the camera
   stops following, collision silently stops, and the player falls forever.
   It is easy to introduce by feeding a partial input object into a function
   that expects look deltas, so assert the invariant every frame instead. */
{
  const st = match.debugState();
  for (const [k, v] of Object.entries(st)) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new Error(`match.debugState().${k} is ${v} — the player position went non-finite`);
    }
  }
  if (st.outside) throw new Error('the player starts outside the play zone — the whole screen goes storm-purple');
  // The storm must still be readable, not a blackout.
  if (st.fog.far < 60) throw new Error(`out-of-bounds fog far=${st.fog.far} blinds the player`);
  console.log(`player at (${st.px}, ${st.py}, ${st.pz}), zone r=${st.zone.r}, storm fog far=${st.fog.far}`);
}

for (let i = 0; i < 30; i++) match.update(1 / 60, input);
const walked = match.player.pos.z;
if (!Number.isFinite(walked)) { console.error('bad pos'); process.exit(1); }
if (walked > -0.4) { console.error('forward moved the wrong way', match.player.pos.toArray()); process.exit(1); }

const phases = new Set();
let maxY = match.player.pos.y;
for (let i = 0; i < 30 * 60 * 8 && !match.getResult(); i++) {
  input.moveY = Math.sin(i * 0.01) > 0 ? 1 : -1;
  input.moveX = Math.cos(i * 0.007);
  input.lookX = 0.01;
  input.fire = i % 7 < 3;
  input.aim = i % 21 < 6;
  input.jumpPressed = i % 90 === 0;
  input.jumpHeld = i % 90 < 6;
  input.usePressed = i % 150 === 0;
  match.update(1 / 30, input);
  phases.add(match.phase());
  const p = match.player.pos;
  if (!Number.isFinite(p.x + p.y + p.z)) { console.error('player position went NaN', i); process.exit(1); }
  if (p.y < -20) { console.error('player fell through the world', i, p.y); process.exit(1); }
  if (Math.hypot(p.x, p.z) > 200) { console.error('player left the island', i, p.toArray()); process.exit(1); }
  maxY = Math.max(maxY, p.y);
  snap = match.snapshot();
  if (!Number.isFinite(snap.aliveCount) || snap.aliveCount < 0) {
    console.error('bad alive count at step', i, snap.aliveCount);
    process.exit(1);
  }
}
console.log('phase', match.phase(), 'alive', snap.aliveCount, 'pos', match.player.pos.x.toFixed(2), match.player.pos.z.toFixed(2), 'phases', [...phases].join('>'));
// The phase machine has to actually move, not sit in the lobby for 8 minutes.
for (const want of ['bus', 'play']) {
  if (!phases.has(want)) { console.error(`never reached the ${want} phase (saw ${[...phases].join(', ')})`); process.exit(1); }
}
if (maxY > 200) { console.error('player launched out of the map', maxY); process.exit(1); }
match.resize(1280, 720);
rendererCheck();
await worldChecks();
await grayboxChecks();
await sightLineChecks();
console.log('smoke ok');

/**
 * The island must build completely from its procedural geometry, and a kit
 * asset that fails to load must never stall the loading bar.
 */
async function worldChecks() {
  const THREE = (await import('three'));
  const { buildWorld, heightAt } = await import('../src/world/map.js');
  const scene = new THREE.Scene();
  const world = buildWorld(scene, 11);

  if (world.boxes.length < 10) throw new Error(`expected collision boxes, got ${world.boxes.length}`);
  if (!world.anchors.chests.length) throw new Error('no chest anchors');
  if (!world.anchors.floors.length) throw new Error('no floor loot anchors');
  if (!world.anchors.crystals.length) throw new Error('no crystal anchors');
  if (world.ufo.seats.length !== 6) throw new Error(`expected 6 drop-ship seats, got ${world.ufo.seats.length}`);
  if (!world.lobby.userData.box) throw new Error('lobby deck has no collision box');

  // The chest factory is what match.js drops at every loot anchor.
  const chest = world.makeChest();
  if (typeof chest.userData.setOpen !== 'function') throw new Error('chest missing setOpen');
  if (!chest.userData.lid) throw new Error('chest missing hinged lid');
  chest.userData.setOpen(true);
  if (Math.abs(chest.userData.lid.rotation.x) < 1) throw new Error('chest lid did not open');

  // A bogus kit url must be survivable, not fatal.
  world.kit.put('/assets/__nope__/missing.fbx', { x: 0, z: 0 });

  // Every placement settles even though node cannot resolve the relative urls,
  // so the loading bar always reaches the end.
  await world.ready();
  if (world.progress() !== 1) throw new Error(`kit never settled: ${world.progress()}`);
  if (Math.abs(heightAt(0, 0) - heightAt(0, 0)) > 1e-9) throw new Error('heightAt unstable');
}

/**
 * The graybox must be a usable proving ground, not just a scene that renders.
 *
 * These are the properties gameplay testing actually depends on. If any of
 * them breaks, every TTK and recoil number measured on the range becomes
 * suspect, so they are asserted rather than assumed.
 */
async function grayboxChecks() {
  const THREE = (await import('three'));
  const { buildGraybox, GRAY_GATES, GRAY_SPAWN, GRAY_R } = await import('../src/world/graybox.js');
  const { heightAt } = await import('../src/world/map.js');
  const scene = new THREE.Scene();
  const world = buildGraybox(scene, 11);

  if (!world.isGraybox) throw new Error('graybox did not identify itself');
  if (world.boxes.length < 20) throw new Error(`too few collision boxes: ${world.boxes.length}`);
  if (!world.dummies.length) throw new Error('no target dummies');

  // Building the graybox must install its terrain. If it did not, the player
  // would fall through the floor using the island sampler.
  if (Math.abs(heightAt(0, 0)) > 1e-9) throw new Error(`graybox ground is not flat at the origin: ${heightAt(0, 0)}`);
  for (const [x, z] of [[0, 0], [20, 0], [0, 20], [-40, 30], [10, -10]]) {
    if (Math.abs(heightAt(x, z)) > 1e-9) throw new Error(`graybox ground is not flat at ${x},${z}: ${heightAt(x, z)}`);
  }

  // Every gate must be reachable ground inside the range, and each must have a
  // dummy standing on it or the falloff ladder is missing a rung.
  for (const m of GRAY_GATES) {
    const z = GRAY_SPAWN.z - m;
    if (heightAt(0, z) !== 0) throw new Error(`the ${m}m gate is not on flat ground`);
    if (Math.hypot(0, z) > GRAY_R) throw new Error(`the ${m}m gate is outside the range`);
    const hit = world.dummies.some((d) => d.x === 0 && Math.abs(d.z - z) < 0.01);
    if (!hit) throw new Error(`no dummy at the ${m}m gate`);
  }

  // A shot fired from the firing line at a gate dummy must not be blocked by
  // map geometry, or the lane measures a wall instead of a distance.
  const { rayAABB } = await import('../src/game/collision.js');
  for (const m of GRAY_GATES) {
    const oy = 1.5;
    const dz = -1;
    let blocked = false;
    for (const b of world.boxes) {
      const t = rayAABB(0, oy, GRAY_SPAWN.z, 0, 0, dz, b, m + 4);
      if (t != null && t < m) { blocked = true; break; }
    }
    if (blocked) throw new Error(`the firing lane is blocked before ${m}m`);
  }

  // Dummies must be inside the play area and standing on the ground.
  for (const d of world.dummies) {
    if (Math.hypot(d.x, d.z) > GRAY_R) throw new Error(`dummy outside the range at ${d.x},${d.z}`);
    if (heightAt(d.x, d.z) !== 0) throw new Error(`dummy is not on the ground at ${d.x},${d.z}`);
  }

  // The range opts out of the match systems, so those must be genuinely absent
  // rather than merely unused.
  if (world.ufo !== null) throw new Error('graybox should have no drop ship');
  if (world.lobby !== null) throw new Error('graybox should have no lobby deck');
  if (!world.noZone) throw new Error('graybox should opt out of the storm');
  if (world.progress() !== 1) throw new Error('graybox has no assets to stream, so it must report full progress');

  // Every gun needs a plinth, or a weapon cannot be tested on the range.
  if (world.plinths.length !== 5) throw new Error(`expected a plinth per gun, got ${world.plinths.length}`);
  const gunAnchors = world.anchors.floors.filter((a) => a.gun);
  if (gunAnchors.length !== 5) throw new Error(`expected 5 gun anchors, got ${gunAnchors.length}`);
  const ammoAnchors = world.anchors.floors.filter((a) => a.ammo);
  if (ammoAnchors.length !== 4) throw new Error(`expected 4 ammo anchors, got ${ammoAnchors.length}`);

  // No material on the range may be a black-body metal, because that is the
  // failure mode the graybox exists to make impossible.
  const seen = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m || seen.has(m.uuid)) continue;
      seen.add(m.uuid);
      if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
        throw new Error('graybox must not use PBR materials; they can render black');
      }
      if (m.metalness) throw new Error('graybox material has metalness');
    }
  });
}

/**
 * The camera must be where the player is, at the moment a shot leaves it.
 *
 * The rig used to be positioned by applyCamera, which runs *after* the gameplay
 * update, so every shot was cast from the previous frame's camera pose. On a
 * map that teleports you that is not a lag but a different place: on the frame
 * the range spawns the player the rig was still at the world origin, so the
 * shot left (0,0,0) travelling flat along the ground, passed underneath every
 * dummy, and reported a clean miss on a target dead centre.
 *
 * A unit test on the maths could never have caught that, because the maths was
 * always right - it was being handed the wrong origin. So this drives a real
 * graybox match, fires a real shot down the 10m lane, and checks the damage
 * that comes out the far end.
 */
async function sightLineChecks() {
  const { falloffDamage, GUNS } = await import('../src/game/weapons.js');
  const range = createMatch({ getSettings: () => settings, audio, getLook: () => look, map: 'graybox' });
  for (let i = 0; i < 400 && range.buildStep() < 1; i++) await yieldTick();
  if (range.phase() !== 'play') throw new Error(`graybox did not start in play, got ${range.phase()}`);

  const idle = { ...input, moveX: 0, moveY: 0, lookX: 0, fire: false };

  // Fire on the very first frame after the build. This is the whole test.
  //
  // An earlier version stepped once with no input before checking anything, and
  // it passed with the bug present - that step ran applyCamera, which quietly
  // put the rig in the right place, and the frame under test was already warm.
  // The defect only exists on the single frame between "the world finished
  // building and teleported the player" and "applyCamera has run once", so the
  // test has to shoot inside that window or it proves nothing.
  const gun = GUNS.ar;
  range.update(1 / 60, { ...idle, fire: true });

  if (range.player.shots === 0) throw new Error('firing on the range produced no shot at all');
  if (range.player.hits === 0) {
    throw new Error(`the first shot after spawning missed a dummy dead ahead - the rig had not been placed`);
  }

  // The camera must also be sitting at the player's eye, not their feet.
  const cam = range.activeCamera();
  cam.updateMatrixWorld(true);
  const eye = cam.getWorldPosition(new THREE.Vector3());
  const p = range.player.pos;
  const drift = Math.hypot(eye.x - p.x, eye.z - p.z);
  if (drift > 0.01) {
    throw new Error(`camera is ${drift.toFixed(2)}m from the player - shots leave the wrong place`);
  }
  if (Math.abs(eye.y - (p.y + 1.58)) > 0.05) {
    throw new Error(`camera eye is at y=${eye.y.toFixed(2)}, expected ~${(p.y + 1.58).toFixed(2)}`);
  }

  // Keep firing to confirm the sight line holds once the rig is warm.
  for (let i = 0; i < 8; i++) range.update(1 / 60, { ...idle, fire: true });
  range.update(1 / 60, idle);

  // The 10m gate is inside the AR's 28m no-falloff band, so a body shot is
  // exactly 16 and a headshot exactly 16 * 1.75. Anything else means falloff,
  // the headshot multiplier or the hitbox is not what weapons.js claims.
  const expect = falloffDamage(gun, 10) * gun.head;
  if (expect !== 28) throw new Error(`the AR headshot maths changed: 16 * ${gun.head} = ${expect}, not 28`);
  const dealt = range.player.damage;
  if (dealt < gun.dmg) {
    throw new Error(`a hit at 10m dealt ${dealt}, less than the ${gun.dmg} floor damage - falloff is inverted`);
  }

  // And the panel the tester actually reads has to agree with the simulation.
  const snap = range.snapshot();
  if (!snap.range) throw new Error('the range did not publish a `range` snapshot, so the instrument panel is dead');
  if (!snap.range.curve.length) throw new Error('the range panel has no falloff curve to show');
  const at10 = snap.range.curve.find((c) => c.m === 10);
  if (!at10 || at10.dmg !== gun.dmg) {
    throw new Error(`range panel says the AR does ${at10 ? at10.dmg : 'nothing'} at 10m, the table says ${gun.dmg}`);
  }
  if (!snap.range.last || !(snap.range.last.dmg > 0)) {
    throw new Error('the range panel recorded no hit even though the match took damage');
  }
  console.log(`range: first shot connected, ${dealt} dmg total, panel last hit ${snap.range.last.dmg} @ ${snap.range.last.dist}m`);

  await drillChecks(range, idle);
}

/**
 * The range has to be a *drill*, not just a ballistic measurement rig.
 *
 * The original graybox measured damage perfectly and was miserable to play:
 * nothing rewarded a follow-up shot, targets took 2s to stand back up, and every
 * target was nailed to the same spot. The three properties below are the ones
 * that turn it into something worth re-entering, and each of them is the kind
 * of thing that silently disappears in a refactor without failing anything
 * else — the damage numbers stay correct while the game around them rots.
 */
async function drillChecks(range, idle) {
  // 1. Scoring. A hit must be worth points, and a streak must be buildable.
  const first = range.snapshot().range;
  if (!(first.score > 0)) {
    throw new Error(`a confirmed hit scored nothing (score=${first.score})`);
  }
  /**
   * Assert that a hit *opened* a streak, which is not the same as a streak
   * being open right now.
   *
   * This read `first.streak`, but the drill had already fired eight further
   * frames before the snapshot. A miss deliberately breaks the streak, and
   * every shot carries random spread, so whether the number was still standing
   * when the assertion ran came down to whether one of those later pellets
   * happened to miss. `bestStreak` records that a streak was opened and is not
   * erased by the miss that closes it, which is exactly the property here.
   */
  if (!(first.bestStreak >= 1)) {
    throw new Error(`a confirmed hit did not open a streak (bestStreak=${first.bestStreak})`);
  }
  if (!(first.last.score > 0)) {
    throw new Error('the panel does not report the points the last hit was worth');
  }
  if (!first.lanes.length) {
    throw new Error('no per-lane bookkeeping, so "which distance is this gun good at" is unanswerable');
  }

  // 2. A miss must cost the streak. Without this it is a counter, not a streak:
  //    you could open a run, walk away, and cash it in on the next target.
  const before = range.snapshot().range.streak;
  // Aim straight up: nothing is in that direction, so this is a guaranteed miss
  // rather than a shot that happens to whiff a small target.
  for (let i = 0; i < 40; i++) {
    range.update(1 / 60, { ...idle, fire: true, lookY: -0.02 });
  }
  const missed = range.snapshot().range;
  if (before > 0 && missed.streak !== 0) {
    throw new Error(`a deliberate miss left the streak at ${missed.streak}; it should have reset`);
  }
  if (missed.shots <= 0) throw new Error('the aim-up burst produced no shots at all');

  // 3. Targets must come back quickly enough to keep a rhythm. The old figure
  //    was 2s, which reads as "wait"; the point of the exercise is to stay in a
  //    run, so the bar is generous but real.
  const down = range.bots().filter((b) => b.dummy && !b.alive);
  if (down.length) {
    throw new Error(`${down.length} target(s) are still down after ${(40 * 2 / 60).toFixed(1)}s of fire`);
  }
  const settle = range.snapshot().range;
  if (settle.elapsed <= 0) throw new Error('the drill clock is not running');

  // 4. The moving targets must actually move. A `motion` descriptor that the
  //    clock ignores leaves hit spheres frozen while the world animates them (or
  //    worse, the reverse), and the symptom is "my shots land next to the guy".
  const moving = range.bots().filter((b) => b.dummy && b.motion);
  if (moving.length) {
    const start = moving.map((b) => b.pos.x);
    for (let i = 0; i < 45; i++) range.update(1 / 60, idle);
    const moved = moving.filter((b, i) => Math.abs(b.pos.x - start[i]) > 0.05).length;
    if (moved === 0) {
      throw new Error(`${moving.length} targets are marked as moving but none of them moved in 0.75s`);
    }
  }

  console.log(`range drill: score ${settle.score}, ${settle.lanes.length} lane(s) hit, ${moving.length} moving target(s) live`);
}

function rendererCheck() {
  const cam = match.activeCamera();
  cam.updateMatrixWorld(true);
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  if (!Number.isFinite(dir.x)) throw new Error('camera dir');
}

/* --- Water is swimmable, not a pit -------------------------------- */
/* The island shelves down to -28 offshore. Without buoyancy a player or bot
   that leaves the beach sinks to the seabed and stands there, fully submerged
   and permanently shot-blocking. Simulate stepping off the shore and require
   that the surface holds them. */
{
  // The terrain function is a module-level global, and an earlier block in this
  // file builds a range match whose flat ground reaches 70m. At ISLAND_R + 12 =
  // 68m that is still dry land, so whether the surface held the player depended
  // on which map happened to be live -- a coin flip, not a property of the water
  // code. Pin the island terrain so this measures buoyancy and nothing else.
  setTerrain(null);

  // The match has already been simulated to completion by the time we get
  // here, so put it back into a live play phase first — otherwise update() is
  // a no-op and this test passes without testing anything. reset() puts us
  // back in the lobby, so the lobby timer has to elapse before the bus exists.
  match.reset();
  for (let i = 0; i < 4000 && match.phase() !== 'bus'; i++) match.update(1 / 30, input);
  if (match.phase() !== 'bus') throw new Error(`never reached the bus (stuck in ${match.phase()})`);
  match.skipBus();
  if (match.phase() !== 'play') throw new Error(`could not reach the play phase (got ${match.phase()})`);
  const p = match.player;
  p.pos.set(ISLAND_R + 12, 6, 0);      // well out to sea
  p.vel.set(0, 0, 0);
  p.gliding = false;
  let worst = 0;
  let held = 0;
  // Pin the horizontal position every step. The storm shove and the mantle
  // recovery both drift the player, and over 400 steps that was enough to walk
  // them up onto the beach at r < ISLAND_R, where there is no water at all --
  // so the result flipped between 339/340 and 154/340 depending on which way
  // they drifted. This block is about whether the sea holds a body up, so the
  // horizontal position is pinned and only the vertical axis is left to the
  // physics.
  const SEA_X = ISLAND_R + 12;
  const SEA_Z = 0;
  for (let i = 0; i < 400; i++) {
    match.update(1 / 60, input);
    p.pos.x = SEA_X;
    p.pos.z = SEA_Z;
    p.vel.x = 0;
    p.vel.z = 0;
    if (!Number.isFinite(p.pos.y)) throw new Error(`player y went NaN at step ${i}`);
    worst = Math.max(worst, p.pos.y);
    if (i > 60 && Math.abs(p.pos.y - SEA_Y) < 1.2) held++;
  }
  console.log(`open water: y=${p.pos.y.toFixed(2)} (sea ${SEA_Y}), peak ${worst.toFixed(2)}, at surface ${held}/340 steps`);
  // A test that never reaches the surface proves nothing: require the player
  // to actually settle at the waterline.
  if (held < 200) throw new Error(`player only held the surface for ${held}/340 steps - buoyancy is not working`);
  if (p.pos.y < SEA_Y - 1.5) throw new Error(`player sank to ${p.pos.y.toFixed(2)}, well below the surface at ${SEA_Y} - water is a pit`);
  if (worst > SEA_Y + 14) throw new Error(`buoyancy launched the player to ${worst.toFixed(2)}`);

  // Candidate B's weakness is a rule about water, and the only way to prove a
  // rule about water is to stand in it. The range match earlier in this file
  // installed its own terrain, which shelves well below the sea past its 70m
  // edge, so 95m out is open water for whichever map is live. Her sun-court
  // toll must be suppressed there, and a suppressed cast is a refusal rather
  // than a cooldown it burns on her.
  {
    const { candidateById } = await import('../src/data/candidates.js');
    const solara = candidateById('solara');
    const keep = look.candidate;
    look.candidate = 'solara';
    match.applyProfile();
    p.abilityCd = 0;
    p.hp = 100;
    p.pos.set(95, SEA_Y + 0.2, 0);   // past the range edge: open water
    match.update(1 / 30, input);
    const wet = match.snapshot().ability;
    if (!wet) throw new Error('Candidate B published no ability');
    if (!wet.locked) throw new Error('open water did not suppress SOLARA\'s solar toll');
    if (wet.lockReason !== solara.weakness.name) throw new Error(`SOLARA is locked by "${wet.lockReason}"`);
    input.abilityPressed = true;
    match.update(1 / 30, input);
    input.abilityPressed = false;
    if (p.abilityCd !== 0) throw new Error(`a doused cast still burned ${p.abilityCd}s`);
    // Out of the water the same rule lets her through again.
    p.pos.set(0, 4, 0);
    p.abilityCd = 0;
    match.update(1 / 30, input);
    if (match.snapshot().ability.locked) throw new Error('SOLARA is still doused on dry land');
    look.candidate = keep;
    match.applyProfile();
    console.log(`doused: SOLARA suppressed at the waterline, castable on deck`);
  }
}

/* --- A candidate's decree, and her weakness, in a live match ---------- */
/* ROYAL DECREE: UNDERTOW is suppressed inside a storm wall, and a rule about
   storms can only be tested where a storm exists — the range has none on
   purpose. So this drives the match into a closing ring and checks both halves:
   refused out in the wall, castable in the calm centre, with the drag landing on
   the victim it caught. Candidate A's sheet is what decides all of it. */
{
  const { candidateById } = await import('../src/data/candidates.js');
  const candidate = candidateById(look.candidate);
  if (!candidate) throw new Error('the smoke waifu has no candidate sheet to test against');
  const ab = candidate.ability;

  const keepAlive = () => {
    match.player.hp = 100;
    match.player.knocked = false;
    match.player.alive = true;
  };
  // The full-match run left movement and firing latched on: measurement from
  // here needs a player who stands still.
  input.moveX = 0;
  input.moveY = 0;
  input.fire = false;
  input.aim = false;
  input.jumpPressed = false;
  input.jumpHeld = false;

  let closing = false;
  for (let i = 0; i < 6000 && !closing; i++) {
    keepAlive();
    match.update(1 / 30, input);
    closing = String(match.snapshot().zoneText).startsWith('Storm');
  }
  if (!closing) throw new Error('the storm never started closing, so the weakness cannot be checked');

  // Out in the wall: the sigil cannot hold, and a refused cast must not burn
  // the cooldown — otherwise her weakness would double as a self-punish.
  const zone = match.debugState().zone;
  match.player.abilityCd = 0;
  match.player.pos.x = zone.x + zone.r + 8;
  match.player.pos.z = zone.z;
  keepAlive();
  input.abilityPressed = true;
  match.update(1 / 30, input);
  input.abilityPressed = false;
  const outside = match.snapshot().ability;
  if (!outside) throw new Error('equipped candidate published no ability');
  if (!outside.locked) throw new Error("a closing storm did not suppress Candidate A's decree");
  if (outside.ready) throw new Error('the HUD calls a suppressed decree ready');
  if (match.player.abilityCd !== 0) throw new Error(`a suppressed cast still burned ${match.player.abilityCd}s`);

  // Calm centre, victim in arm's reach: the decree lands, bites and drags.
  const victim = match.bots().find((b) => b.alive && b.state === 'live' && b.team !== 0 && !b.partner);
  if (!victim) throw new Error('no live bot to aim the undertow at');
  match.player.pos.x = zone.x;
  match.player.pos.z = zone.z;
  victim.pos.x = zone.x;
  victim.pos.z = zone.z + 4;
  victim.knocked = true;   // a 1.6 m/s crawl cannot be mistaken for a 5.5 m/s drag
  victim.knockHp = 100;
  keepAlive();
  const dist0 = Math.hypot(victim.pos.x - match.player.pos.x, victim.pos.z - match.player.pos.z);

  input.abilityPressed = true;
  match.update(1 / 30, input);
  input.abilityPressed = false;

  const inside = match.snapshot().ability;
  if (inside.locked) throw new Error('the decree is still suppressed with the ring calm around her');
  if (Math.abs(match.player.abilityCd - ab.cooldown) > 1e-6) throw new Error(`the cast left ${match.player.abilityCd}s on the cooldown, not ${ab.cooldown}`);
  if (match.player.shield < ab.shield) throw new Error(`the decree did not shield her (${match.player.shield})`);
  if (!victim.pull) throw new Error('the undertow did not arm a drag on the victim it caught');
  const wantX = match.player.pos.x - victim.pos.x;
  const wantZ = match.player.pos.z - victim.pos.z;
  const len = Math.hypot(wantX, wantZ) || 1;
  if (Math.abs(victim.pull.x - wantX / len) > 1e-6 || Math.abs(victim.pull.z - wantZ / len) > 1e-6) {
    throw new Error('the drag does not point at the caster');
  }
  if (victim.pull.speed !== ab.pull) throw new Error(`the drag runs at ${victim.pull.speed} m/s, not the sheet's ${ab.pull}`);
  if (victim.knockHp >= 100) throw new Error('the decree did not cut the victim it caught');
  victim.knockHp = 100;   // hold her upright: the drag is what is being measured

  for (let i = 0; i < 20; i++) { keepAlive(); match.update(1 / 30, input); }
  const dist1 = Math.hypot(victim.pos.x - match.player.pos.x, victim.pos.z - match.player.pos.z);
  if (!(dist1 < dist0 - 1.5)) throw new Error(`the victim was not dragged into the crest (${dist0.toFixed(2)}m -> ${dist1.toFixed(2)}m)`);
  console.log(`decree: suppressed outside the ring, cast inside; victim dragged ${dist0.toFixed(1)}m -> ${dist1.toFixed(1)}m`);
}

/* --- The decrees that only a live bot can be measured against ------- */
/* The range has dummies, which are pinned and never dragged, so the two
   decrees whose whole point is what they do to a running body are checked
   here: Candidate E blows outward where Candidate A drags inward, and
   Candidate F pays back the damage she cuts. */
{
  const { candidateById } = await import('../src/data/candidates.js');
  const keep = look.candidate;
  const zone = match.debugState().zone;
  const victim = match.bots().find((b) => b.alive && b.state === 'live' && b.team !== 0 && !b.partner);
  if (!victim) throw new Error('no live bot to aim the other decrees at');
  const aim = (who) => {
    match.player.pos.x = zone.x;
    match.player.pos.z = zone.z;
    victim.pos.x = zone.x;
    victim.pos.z = zone.z + 4;
    victim.knocked = true;
    victim.knockHp = 100;
    /**
     * Clear the ring before every measured cast.
     *
     * Amaranth's gale is suppressed by its own weakness -- "three enemies
     * inside eight metres and the petals have nowhere to go" -- so any two
     * other bots that happened to be loitering near the caster would stop the
     * breath from blowing. The cast then armed nothing, and because the
     * undertow check above had already left an *inward* pull on this same
     * victim, the assertion read that stale vector and failed with an exact
     * dot of -1. The test was measuring where the other 41 bots happened to
     * be standing, which is why it failed about a third of the time.
     *
     * Pushing them out of the weakness ring makes the measurement about the
     * decree instead of about the crowd.
     */
    for (const b of match.bots()) {
      if (b === victim || !b.alive) continue;
      if (Math.hypot(b.pos.x - zone.x, b.pos.z - zone.z) < 30) {
        b.pos.x = zone.x + 60;
        b.pos.z = zone.z + 60;
      }
    }
    victim.pull = null;
    match.player.abilityCd = 0;
    match.player.hp = 100;
    match.player.shield = 60;
    look.candidate = who;
    match.applyProfile();
  };

  // Candidate E: a gale shoves the ring away from her, not into the crest.
  const gale = candidateById('amaranth').ability;
  aim('amaranth');
  input.abilityPressed = true;
  match.update(1 / 30, input);
  input.abilityPressed = false;
  if (!victim.pull) throw new Error('the thornbreath did not arm a drag on the victim it caught');
  const awayX = victim.pos.x - match.player.pos.x;
  const awayZ = victim.pos.z - match.player.pos.z;
  const awayLen = Math.hypot(awayX, awayZ) || 1;
  /**
   * Assert the *sign* of the push, not its exact components.
   *
   * This used to require `pull` to equal the player->victim unit vector to
   * within 1e-6. That is over-specified: the ability normalises the direction
   * at cast time, but bots keep moving inside the same update, so reading
   * `victim.pos` afterwards compares the push against a direction the cast
   * never saw. Whether it passed came down to whether the victim happened to
   * take a step that frame -- the test failed intermittently for reasons that
   * had nothing to do with the gale.
   *
   * The property actually under test is that a gale blows outward where an
   * undertow drags inward. A dot product against the away-vector answers that
   * directly, and an inverted sign still fails loudly at dot ~= -1.
   */
  const awayDot = victim.pull.x * (awayX / awayLen) + victim.pull.z * (awayZ / awayLen);
  if (awayDot < 0.9) {
    throw new Error(`the gale drags inward instead of blowing outward (dot=${awayDot.toFixed(3)})`);
  }
  if (victim.pull.speed !== gale.pull) throw new Error(`the gale runs at ${victim.pull.speed} m/s, not ${gale.pull}`);

  // Candidate F: half of what the hunger cuts comes back as shield.
  const hunger = candidateById('umbra').ability;
  aim('umbra');
  const before = victim.knockHp + victim.hp;
  input.abilityPressed = true;
  match.update(1 / 30, input);
  input.abilityPressed = false;
  const dealt = before - (victim.knockHp + victim.hp);
  if (dealt <= 0) throw new Error("the hunger opened on nobody");
  const leech = Math.min(hunger.shield, dealt * hunger.leech);
  if (match.player.shield < Math.min(100, 60 + hunger.shield + leech) - 1e-6) {
    throw new Error(`the hunger paid back ${(match.player.shield - 60).toFixed(1)} shield, not ${hunger.shield}+${leech.toFixed(1)}`);
  }
  look.candidate = keep;
  match.applyProfile();
  console.log(`decrees: gale blew the victim out to ${gale.pull} m/s; hunger cut ${dealt.toFixed(0)} and took ${leech.toFixed(0)} shield for it`);
}

/* --- Picking up a gun must work from the third-person camera ------------ */
{
  const gun = match.pickups().find((q) => !q.taken && q.kind === 'gun');
  if (!gun) throw new Error('no loose gun on the map to test pickup with');
  match.player.guns = [null, null];
  match.player.pos.set(gun.x + 1.2, gun.y, gun.z);
  const press = { ...input, moveX: 0, moveY: 0, lookX: 0, fire: false, interactPressed: true };
  for (let i = 0; i < 3; i++) match.update(1 / 30, press);
  if (!gun.taken) throw new Error('standing 1.2 m from a gun and pressing interact did not pick it up');
  console.log('pickup: gun taken from 1.2 m in third person');
}

/* --- An emote must end: D-pad left used to lock the player in inspect mode -- */
{
  const before = match.snapshot().inspect;
  const e = { ...input, moveX: 0, moveY: 0, lookX: 0, fire: false, emotePressed: true };
  match.update(1 / 30, e);
  const rest = { ...input, moveX: 0, moveY: 0, lookX: 0, fire: false, emotePressed: false };
  for (let i = 0; i < 120; i++) match.update(1 / 30, rest);
  if (match.snapshot().inspect && !before) throw new Error('an emote left the player stuck in inspect mode');
  console.log('emote: ends cleanly, no inspect lock');
}
