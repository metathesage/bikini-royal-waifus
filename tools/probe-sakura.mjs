/**
 * Sakura Isle blockout validator.
 *
 * Answers the questions that actually broke the previous island, and that a
 * screenshot cannot. The city was 52 boxes over 6m tall and the player
 * reported never seeing another fighter; four chests were sitting in the sea;
 * 63 loot anchors were buried under paving. Every one of those is invisible
 * in a render and obvious in these numbers.
 *
 * Run: node tools/probe-sakura.mjs
 */
import * as THREE from 'three';
import { buildSakuraIsle, isleHeightAt, ISLE_POIS, ISLE_R } from '../src/world/sakuraIsle.js';
import { rayAABB } from '../src/game/collision.js';
import { heightAt, SEA_Y } from '../src/world/map.js';
import { SAKURA_PLACEMENTS, placementBoxes, environmentLoadMb } from '../src/world/envDress.js';

/**
 * The ground a loot item should sit on: the terrain, plus a lift for paving.
 *
 * `floorAt` on its own returns the highest box top under a point, which is
 * right for a player standing on a roof and wrong for a chest authored at
 * ground level -- it reports the roof of the building next to it. Anything
 * more than a metre above the terrain is a structure, not a floor, so this
 * refuses that lift. Same rule the map itself applies in settleAnchors.
 */
function groundUnder(x, z, boxes) {
  const terrain = isleHeightAt(x, z);
  let g = terrain;
  for (const b of boxes) {
    if (x <= b.minX - 0.085 || x >= b.maxX + 0.085) continue;
    if (z <= b.minZ - 0.085 || z >= b.maxZ + 0.085) continue;
    // The limit has to be applied while searching, not after: taking the
    // single highest box and then rejecting it returns the terrain whenever
    // a building is nearby, which buries every chest that stands on a deck.
    if (b.maxY > g && b.maxY - terrain <= 1.0) g = b.maxY;
  }
  return g;
}

/** True when something solid occupies the space a loot item needs. */
function blocked(x, y, z, boxes) {
  for (const b of boxes) {
    if (x < b.minX - 0.6 || x > b.maxX + 0.6) continue;
    if (z < b.minZ - 0.6 || z > b.maxZ + 0.6) continue;
    // Ignore the floor the item rests on, and anything entirely above it.
    if (b.maxY <= y + 0.35) continue;
    if (b.minY >= y + 1.4) continue;
    return b;
  }
  return null;
}

const scene = new THREE.Scene();
const world = buildSakuraIsle(scene, 11);
/**
 * The blockout's boxes *plus* the imported dressing's.
 *
 * Headless, the map skips the GLBs entirely, so `world.boxes` is the blockout
 * alone -- a map that no longer exists in the browser, where the restaurants
 * and the temple town carry collision. Every check below therefore runs against
 * this list rather than against `world.boxes`: openness, sight lines and loot
 * reachability are all things the dressing can break, and a validator that
 * cannot see it would pass a map that buries its own chests.
 */
const dressing = placementBoxes(SAKURA_PLACEMENTS, (id) => ISLE_POIS.find((p) => p.id === id), isleHeightAt);
const boxes = [...world.boxes, ...dressing];
const anchors = [
  ...world.anchors.chests.map((a) => ['chest', a]),
  ...world.anchors.floors.map((a) => ['floor', a]),
  ...world.anchors.crystals.map((a) => ['crystal', a]),
];

const fail = [];
const warn = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); return ok; };

/* --- 1. Contract match.js relies on --------------------------------- */
check(world.boxes.length > 150, `only ${world.boxes.length} collision boxes`);
check(world.ufo && world.ufo.seats.length === 6, 'drop ship needs 6 seats');
check(world.lobby && world.lobby.userData.box, 'lobby deck needs a collision box');
check(world.progress() === 1, 'a map with no assets must report full progress');
check(!world.noZone, 'this map has a storm, so noZone must be falsy');
check(!world.isGraybox, 'this map is a match, not the range');
check(typeof world.makeChest() === 'object', 'makeChest must return a chest');
check(world.pois.length === 6, 'expected 6 districts');

/* --- 2. The terrain sampler is actually installed ------------------- */
for (const p of ISLE_POIS) {
  check(Math.abs(isleHeightAt(p.x, p.z) - heightAt(p.x, p.z)) < 1e-6,
    `heightAt was not switched to this map (${p.id})`);
  check(isleHeightAt(p.x, p.z) > SEA_Y, `${p.name} centre is underwater`);
}

/* --- 3. Districts are separated by real water ------------------------ */
let touching = 0;
for (let i = 0; i < ISLE_POIS.length; i++) {
  for (let j = i + 1; j < ISLE_POIS.length; j++) {
    const a = ISLE_POIS[i];
    const b = ISLE_POIS[j];
    // Walk the line between the two centres; if it never dips below the
    // waterline the two landmasses have merged into one blob.
    let wet = false;
    for (let s = 0; s <= 60; s++) {
      const t = s / 60;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const inside = (p) => Math.hypot(x - p.x, z - p.z) < p.r * 0.99;
      if (!inside(a) && !inside(b) && isleHeightAt(x, z) < SEA_Y) { wet = true; break; }
    }
    if (!wet) touching++;
  }
}
check(touching === 0, `${touching} district pair(s) have no water between them`);

/* --- 4. Loot is reachable, dry, and not inside geometry -------------- */
let wet = 0;
let offFloor = 0;
let stuck = 0;
const stuckList = [];
for (const [kind, a] of anchors) {
  if (isleHeightAt(a.x, a.z) < SEA_Y + 0.1) {
    wet++;
    fail.push(`${kind} at ${a.x.toFixed(0)},${a.z.toFixed(0)} (${a.poi}) is in the water`);
  }
  const g = groundUnder(a.x, a.z, boxes);
  if (a.y == null || Math.abs(a.y - g) > 0.35) {
    offFloor++;
    fail.push(`${kind} at ${a.x.toFixed(0)},${a.z.toFixed(0)} sits at y=${(a.y || 0).toFixed(2)} but the floor is ${g.toFixed(2)}`);
  }
  const b = blocked(a.x, a.y ?? g, a.z, boxes);
  if (b) {
    stuck++;
    // Loot sealed inside geometry is worse than no loot: the map reads as
    // stocked and the player can never take it. This is a failure, not a
    // note, because every instance of it so far has been a real placement
    // mistake rather than a strict test.
    if (stuckList.length < 6) stuckList.push(`${a.poi}@${a.x.toFixed(0)},${a.z.toFixed(0)}`);
  }
}
check(stuck === 0, `${stuck} loot anchor(s) are sealed inside geometry: ${stuckList.join(', ')}`);

/* --- 5. Every district has open ground to fight on ----------------- */
// Sampled on a grid across the plateau rather than on a ring. A ring at
// 55% of the radius runs straight through the buildings -- the plaza's civic
// blocks sit at 9.5m on a 20m radius, so every sample landed inside one and
// the district scored 0/24, which says nothing about whether it is playable.
let worst = null;
for (const p of ISLE_POIS) {
  let standable = 0;
  let total = 0;
  for (let gx = -2; gx <= 2; gx++) {
    for (let gz = -2; gz <= 2; gz++) {
      const x = p.x + (gx / 2.2) * p.r * 0.72;
      const z = p.z + (gz / 2.2) * p.r * 0.72;
      if (isleHeightAt(x, z) < SEA_Y) continue;
      total++;
      if (!blocked(x, groundUnder(x, z, boxes) + 0.1, z, boxes)) standable++;
    }
  }
  const frac = total ? standable / total : 0;
  if (!worst || frac < worst.frac) worst = { name: p.name, frac, standable, total };
  // A district that is nearly all cover is a wall, which is exactly what the
  // old downtown was. A quarter of the plateau open is the floor.
  check(frac >= 0.25, `${p.name}: only ${standable}/${total} sample points are open ground (${(frac * 100) | 0}%)`);
}

/* --- 6. Sight lines: this is the check the old island failed ---------- */
// From the plaza deck, how much of the way to each other district is visible
// from standing height? A map that scores near zero here is the "I never saw
// anyone" bug all over again.
function visibleFraction(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d < 1) return 1;
  const ux = dx / d;
  const uz = dz / d;
  const oy = groundUnder(from.x, from.z, boxes) + 1.7;
  const toY = groundUnder(to.x, to.z, boxes) + 1.0;
  let seen = 0;
  let total = 0;
  for (let s = 1; s < d; s += 1.5) {
    total++;
    const x = from.x + ux * s;
    const z = from.z + uz * s;
    const ty = oy + (toY - oy) * (s / d);
    const hit = boxes.find((k) => rayAABB(x - ux, ty, z - uz, ux, 0, uz, k, 1.6) != null);
    if (!hit) seen++;
  }
  return total ? seen / total : 1;
}
const plaza = ISLE_POIS[0];
const sight = ISLE_POIS.filter((p) => p.id !== 'plaza')
  .map((p) => ({ name: p.name, frac: visibleFraction(plaza, p) }));
for (const s of sight) {
  // Under 8% is a dead sight line and a failure; under 25% is worth knowing.
  if (s.frac < 0.08) fail.push(`no sight line from the plaza to ${s.name} (${(s.frac * 100) | 0}%)`);
  else if (s.frac < 0.25) warn.push(`only ${(s.frac * 100) | 0}% of the way to ${s.name} is visible from the plaza`);
}

/* --- 7. Nothing absurdly tall --------------------------------------- */
let tallest = 0;
for (const b of boxes) if (b.maxY > tallest) tallest = b.maxY;
// The drop ship cruises at 54-61m. A box at that height means a drop can put
// you on a roof with no line of sight to anything, which is the failure the
// old city's 48m towers caused.
if (tallest > 40) fail.push(`something is ${tallest.toFixed(1)}m tall -- at or above the drop altitude`);

/* --- Report ---------------------------------------------------------- */
let meshes = 0;
let tris = 0;
scene.traverse((o) => {
  if (!o.isMesh) return;
  meshes++;
  const geo = o.geometry;
  tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
});

console.log('--- Sakura Isle blockout -------------------------------------');
console.log(`districts   : ${ISLE_POIS.length}   isle radius ${ISLE_R}m`);
console.log(`geometry    : ${meshes} meshes, ${Math.round(tris).toLocaleString()} tris, ${boxes.length} collision boxes`);
console.log(`dressing    : ${SAKURA_PLACEMENTS.length} imported pieces, ${environmentLoadMb(SAKURA_PLACEMENTS).toFixed(1)} MB, ${dressing.length} carrying collision`);
// The mesh count above is the blockout's: the imported pieces are skipped
// headlessly, so this run proves the map is playable, not that it is pretty.
console.log(`              (blockout only -- no GLB is loaded in this run)`);
console.log(`loot        : ${world.anchors.chests.length} chests, ${world.anchors.floors.length} floor, ${world.anchors.crystals.length} crystal`);
console.log(`anchors     : ${world.settledAnchors.moved} lifted onto their real floor, ${world.settledAnchors.refused} roof lifts refused`);
console.log(`loot checks : ${wet} wet, ${offFloor} off-floor, ${stuck} blocked${stuckList.length ? ' (' + stuckList.join(', ') + ')' : ''}`);
console.log(`tallest     : ${tallest.toFixed(1)}m`);
console.log('sight lines from Sunset Plaza:');
for (const s of sight) console.log(`  ${s.name.padEnd(18)} ${String((s.frac * 100) | 0).padStart(3)}%`);

if (warn.length) {
  console.log('\nwarnings:');
  for (const w of warn) console.log(`  ! ${w}`);
}
if (fail.length) {
  console.log(`\nFAILED (${fail.length}):`);
  for (const f of fail) console.log(`  x ${f}`);
  process.exit(1);
}
console.log('\nsakura blockout ok');
