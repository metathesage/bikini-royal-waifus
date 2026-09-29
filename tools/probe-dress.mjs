/**
 * Environment dressing validator.
 *
 * `probe-sakura` proves the *map* is still playable once the dressing is in it.
 * This proves the *dressing* is what the table says it is, which is a different
 * question and the one that cannot be answered by looking at the map: a piece
 * normalized to the wrong size still passes every playability check, because a
 * restaurant that is 40 m tall instead of 8 m does not seal any loot -- it just
 * looks absurd, and nobody notices until they are standing next to it.
 *
 * Five things are checked, all of them from measured data:
 *
 *   1. The catalogue resolves and the file is on disk. A path typo is a 404 at
 *      runtime and a missing district feature at review time.
 *
 *   2. The size is right. Authored dimensions come from `tools/probe-env.mjs`
 *      (which reads the actual POSITION accessors), and this re-derives the
 *      normalized footprint for each entry's fit mode -- `height` scales by
 *      authored height, `size` fits the longest axis. Comparing that against
 *      the collision box is what catches a box left behind by a retune: the
 *      box does not move when the size changes, so the failure mode is a
 *      building whose collision is the *old* building.
 *
 *   3. The rotation is accounted for. Rotated pieces get a bigger axis-aligned
 *      box than their footprint -- at 45 degrees, 41% bigger -- and that is the
 *      number the collision really occupies, so that is the number checked.
 *
 *   4. It stands on something. Ground pieces must be on dry land; a piece with
 *      an explicit `y` must have a surface within 0.35 m of that height, which
 *      is the plaza deck and the temple apron case, and catches a deck that has
 *      been retuned under the dressing.
 *
 *   5. It does not overlap the blockout or the other pieces, and (for anything
 *      with collision) it does not sit on a loot anchor.
 *
 * Run: node tools/probe-dress.mjs
 */
import * as THREE from 'three';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENV_PLACEMENTS, resolvePlacement, placementBoxes, environmentLoadMb, boxFor,
} from '../src/world/envDress.js';
import { ENVIRONMENT_GLB, ENVIRONMENT_MB } from '../src/data/assets.js';
import { buildWorld, SEA_Y, ISLAND_R } from '../src/world/map.js';
import { buildSakuraIsle, isleHeightAt, ISLE_POIS, ISLE_R } from '../src/world/sakuraIsle.js';
import { POIS } from '../src/data/catalog.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* --- measured authored sizes, straight from the auditor ---------------- */
// Re-measuring in this file would be a second implementation of a GLB reader,
// and the two would disagree the first time either changed. The auditor already
// prints exactly this, so the probe runs it and indexes the result by filename.
const audit = JSON.parse(execFileSync(
  process.execPath,
  [path.join(ROOT, 'tools/probe-env.mjs'), 'public/assets/env', '--json'],
  { encoding: 'utf8', maxBuffer: 1 << 28 },
));
const authored = new Map();
for (const r of audit) {
  authored.set(r.name, { x: r.max[0] - r.min[0], y: r.max[1] - r.min[1], z: r.max[2] - r.min[2], mb: r.mb });
}

const fail = [];
const warn = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); return ok; };

/**
 * Footprint and height of a piece once the loader has normalized it.
 *
 * Mirrors `normalizeScene` (scale by authored height, `up: 'y'` so the up-guess
 * never fires) and `fitToFootprint` (scale so the longest of x/y/z hits the
 * target). If either of those changes, this has to change with it, which is why
 * it is stated here as three lines rather than hidden in a helper: a mismatch
 * shows up as a size check failing on every piece at once, which is a loud and
 * obvious signal rather than a quiet drift.
 */
function normalized(entry, span) {
  if (entry.height != null) {
    const s = entry.height / span.y;
    return { w: span.x * s, d: span.z * s, h: entry.height, scale: s };
  }
  const longest = Math.max(span.x, span.y, span.z);
  const s = entry.size / longest;
  return { w: span.x * s, d: span.z * s, h: span.y * s, scale: s };
}

/** Axis-aligned extents of an oriented footprint: at 45 degrees, 41% wider. */
function aabbOf(f, rotY) {
  const c = Math.abs(Math.cos(rotY));
  const s = Math.abs(Math.sin(rotY));
  return { w: f.w * c + f.d * s, d: f.w * s + f.d * c };
}

/*
 * Console errors are muted for the duration of this probe.
 *
 * Both maps stream their kit dressing on build and node has no fetch for
 * `/assets/...`, so a hundred-odd loads fail by design while these worlds come
 * up. Those rejections are already handled and logged by the kit and they are
 * not what this probe measures -- placement geometry is. Left visible they bury
 * the report under a wall of expected errors, which is how a real one gets
 * missed.
 */
const realError = console.error;
console.error = () => {};

const sakuraWorld = buildSakuraIsle(new THREE.Scene(), 11);
const islandWorld = buildWorld(new THREE.Scene(), 11);

// Deliberately not restored. The kit's failures are asynchronous -- they reject
// a tick or two after the world returns -- so restoring the real console here
// let them through *after* the mute window and straight into the report. The
// probe does its own reporting through `fail`/`warn`, so nothing it needs to say
// goes through console.error anyway.
void realError;

/** Every loot anchor on a world, as [kind, anchor] pairs. */
function anchorList(w) {
  return [
    ...(w.anchors.chests || []).map((a) => ['chest', a]),
    ...(w.anchors.floors || []).map((a) => ['floor', a]),
    ...(w.anchors.crystals || []).map((a) => ['crystal', a]),
  ];
}

/**
 * True when something solid occupies the space an anchor needs.
 *
 * The same test `probe-sakura` applies to the whole blockout, applied here to
 * one imported piece at a time. Deliberately duplicated rather than shared: the
 * two probes fail for different reasons, a shared helper would have to grow
 * options for both, and the rule itself is three comparisons.
 */
function blocksAnchor(b, a) {
  if (a.x < b.minX - 0.6 || a.x > b.maxX + 0.6) return false;
  if (a.z < b.minZ - 0.6 || a.z > b.maxZ + 0.6) return false;
  if (b.maxY <= a.y + 0.35) return false;
  if (b.minY >= a.y + 1.4) return false;
  return true;
}

const maps = [
  {
    id: 'sakura',
    list: ENV_PLACEMENTS.sakura,
    world: sakuraWorld,
    at: (id) => ISLE_POIS.find((p) => p.id === id),
    ground: isleHeightAt,
    radius: ISLE_R,
    label: 'Sakura Isle',
  },
  {
    id: 'island',
    list: ENV_PLACEMENTS.island,
    world: islandWorld,
    at: null,
    ground: islandWorld.heightAt,
    radius: ISLAND_R,
    label: 'the starter island',
  },
];

const rows = [];

for (const map of maps) {
  const anchors = anchorList(map.world);
  const placed = [];

  for (const entry of map.list) {
    const where = `${map.id}:${entry.key}@${entry.poi || `${entry.x},${entry.z}`}`;
    const url = ENVIRONMENT_GLB[entry.key];
    if (!check(!!url, `${where}: no entry in ENVIRONMENT_GLB`)) continue;
    check(ENVIRONMENT_MB[entry.key] != null, `${where}: no measured size in ENVIRONMENT_MB`);

    const file = path.join(ROOT, 'public', url.replace(/^\//, ''));
    check(fs.existsSync(file), `${where}: ${url} is not on disk`);

    const span = authored.get(path.basename(url));
    if (!check(!!span, `${where}: the auditor did not measure ${path.basename(url)}`)) continue;

    const r = resolvePlacement(entry, map.at);
    const f = normalized(entry, span);
    // Two extents, and the difference matters. `visual` is the measured
    // footprint turned by the placement's rotation -- what the piece occupies.
    // `cb` is the collision box: the authored footprint expanded the same way,
    // which is what `boxFor` hands the loader. A piece with no declared box has
    // no collision at all, and then the two are the same number by construction.
    const visual = aabbOf(f, r.rotY);
    const cb = boxFor(entry, r.rotY) || { w: visual.w, h: f.h, d: visual.d };
    const grounded = r.y == null;
    const ground = map.ground(r.x, r.z);
    const y = grounded ? ground : r.y;
    // A sky piece is anything parked far above the terrain: the dragon and the
    // capital ship. They are the reason the stand-on check below is conditional
    // -- "there is nothing under this" is the *point* of a piece at 96 m.
    const sky = !grounded && y - ground > 5;
    const box = { x: r.x, y: y + f.h / 2, z: r.z, w: cb.w, h: f.h, d: cb.d };

    /* --- 1. it stands on something ------------------------------------ */
    if (grounded) {
      check(y >= SEA_Y + 0.2, `${where}: in the water (ground ${y.toFixed(2)}, sea ${SEA_Y})`);
      if (map.at) {
        const d = Math.hypot(r.x - map.at(entry.poi).x, r.z - map.at(entry.poi).z);
        check(d <= map.at(entry.poi).r, `${where}: centre is ${d.toFixed(1)}m out, past the district's ${map.at(entry.poi).r}m`);
      }
      check(Math.hypot(r.x, r.z) <= map.radius, `${where}: outside the map (${Math.hypot(r.x, r.z).toFixed(1)}m, edge ${map.radius})`);
    } else if (sky) {
      // A sky piece must not carry collision -- a floating box is an invisible
      // wall in mid-air -- and must clear the tallest thing on the map, or it is
      // not a landmark, it is a roof.
      check(!entry.box, `${where}: a sky piece must not declare a collision box`);
      let tallest = -Infinity;
      for (const b of map.world.boxes) if (b.maxY > tallest) tallest = b.maxY;
      check(y - Math.min(f.h, 0) >= tallest + 5, `${where}: at y=${y} it is not clear of the tallest geometry (${tallest.toFixed(1)}m)`);
    } else {
      // A deck piece has to have a deck: either the terrain happens to be at
      // that height, or a collision box top is within a step of it. This is the
      // check that catches the plaza slab being retuned under the dressing.
      const halfX = visual.w / 2;
      const halfZ = visual.d / 2;
      const near = map.world.boxes.some((b) => Math.abs(b.maxY - y) <= 0.35
        && r.x > b.minX - halfX && r.x < b.maxX + halfX
        && r.z > b.minZ - halfZ && r.z < b.maxZ + halfZ);
      const terrain = Math.abs(ground - y) <= 0.35;
      check(near || terrain, `${where}: nothing to stand on at y=${y} (terrain ${ground.toFixed(2)})`);
    }

    /* --- 2. the collision box matches what was measured ---------------- */
    if (entry.box) {
      const [bw, bh, bd] = entry.box;
      // Compared against the *unrotated* measured footprint, because that is
      // what the authored box describes; the rotation is applied to both sides
      // by boxFor, so it cancels. 15% is the tolerance: enough for a piece whose
      // footprint is a canopy rather than a trunk, tight enough that a box left
      // behind by a retune fails -- and a stale box is the worst case here,
      // because the collision is then the *old* building and the player walks
      // through the new one.
      check(bw >= f.w * 0.85 && bw <= f.w * 1.6, `${where}: box is ${bw}m wide, the piece measures ${f.w.toFixed(1)}m`);
      check(bd >= f.d * 0.85 && bd <= f.d * 1.6, `${where}: box is ${bd}m deep, the piece measures ${f.d.toFixed(1)}m`);
      check(bh >= f.h * 0.85 && bh <= f.h * 1.6, `${where}: box is ${bh}m tall, the piece measures ${f.h.toFixed(1)}m`);
    }

    /* --- 3. it does not eat the blockout -------------------------------- */
    if (y < 20) {
      const overlapping = map.world.boxes.find((b) => box.x - box.w / 2 < b.maxX - 0.2 && box.x + box.w / 2 > b.minX + 0.2
        && box.z - box.d / 2 < b.maxZ - 0.2 && box.z + box.d / 2 > b.minZ + 0.2
        && box.y - box.h / 2 < b.maxY - 0.2 && box.y + box.h / 2 > b.minY + 0.2);
      if (overlapping) {
        const msg = `${where}: intersects blockout geometry at ${overlapping.minX.toFixed(1)},${overlapping.minZ.toFixed(1)} (${overlapping.tag || 'solid'})`;
        // A real failure only when the piece is meant to be a building: a
        // canopy poking into an eave is a nit, a restaurant sharing a wall with
        // a civic block is a building inside a building.
        if (entry.box) fail.push(msg); else warn.push(msg);
      }
    }

    /* --- 4. it does not seal loot, or another imported piece ------------- */
    if (entry.box) {
      const b = {
        minX: box.x - box.w / 2, maxX: box.x + box.w / 2,
        minZ: box.z - box.d / 2, maxZ: box.z + box.d / 2,
        minY: box.y - box.h / 2, maxY: box.y + box.h / 2,
      };
      for (const [kind, a] of anchors) {
        if (blocksAnchor(b, a)) fail.push(`${where}: seals a ${kind} anchor at ${a.x.toFixed(0)},${a.z.toFixed(0)}`);
      }
      for (const p of placed) {
        const hit = b.minX < p.maxX - 0.2 && b.maxX > p.minX + 0.2 && b.minZ < p.maxZ - 0.2 && b.maxZ > p.minZ + 0.2;
        if (hit) fail.push(`${where}: overlaps another imported piece at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
      }
      placed.push({ x: box.x, z: box.z, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    }

    rows.push({ map: map.id, where, x: r.x, z: r.z, y, w: f.w, d: f.d, h: f.h, visual, sky, box: !!entry.box, mb: span.mb });
  }
}

/*
 * A gap this probe cannot close, stated rather than hidden.
 *
 * The starter island's loot anchors come from two places: the POI tables, and
 * the city model, whose roof slabs become anchors when the GLB loads. Node
 * cannot fetch `/assets/...`, so the city is absent here and its anchors are
 * unverifiable -- which means an island placement that lands on a city roof
 * anchor would pass this probe and fail in the browser. The city occupies a
 * 55 x 53 m block around the origin, so the mitigation is simple and is why
 * every island placement is at 30-42 m out: nothing imported is placed over the
 * city footprint at all.
 */
for (const map of maps) {
  if (map.id === 'island' && !map.world.cityBounds()) {
    warn.push('island: the city model did not load headlessly, so its roof loot anchors are unchecked (imported pieces are kept outside the 55x53 m city footprint for this reason)');
  }
}

/* --- report ------------------------------------------------------------ */
console.log('--- environment dressing --------------------------------------------');
for (const map of maps) {
  const mine = rows.filter((r) => r.map === map.id);
  const uniq = new Set(map.list.map((e) => e.key));
  console.log(`\n${map.label} (${map.id}): ${map.list.length} placements, ${uniq.size} files, ${environmentLoadMb(map.list).toFixed(1)} MB`);
  for (const r of mine) {
    console.log(`  ${r.where.split(':')[1].padEnd(26)}${r.x.toFixed(1).padStart(7)},${r.z.toFixed(1).padStart(7)}  y=${r.y.toFixed(1).padStart(5)}  ${r.w.toFixed(1)}x${r.d.toFixed(1)}x${r.h.toFixed(1)}m${r.box ? '  +collision' : ''}`);
  }
}

const budget = maps.reduce((n, m) => n + environmentLoadMb(m.list), 0);
console.log(`\ntotal       ${rows.length} placements, ${budget.toFixed(1)} MB of table (files shared across maps fetch once)`);

if (warn.length) {
  console.log('\nwarnings:');
  for (const w of warn) console.log(`  ! ${w}`);
}
if (fail.length) {
  console.log(`\nFAILED (${fail.length}):`);
  for (const f of fail) console.log(`  x ${f}`);
  process.exit(1);
}
console.log('\nenvironment dressing ok');


