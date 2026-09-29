import { ENVIRONMENT_GLB, ENVIRONMENT_MB } from '../data/assets.js';
import { makeBox } from '../game/collision.js';

/* ------------------------------------------------------------------ *
 * Imported environment dressing
 *
 * The table below is the whole feature: which piece goes where, at what size,
 * on which map. It is data, not code, on purpose. Placement is the part of set
 * dressing that is wrong most often and hardest to review -- a piece three
 * metres inside a wall reads as a rendering bug, and a chest under a building
 * reads as the map being empty -- so the numbers live somewhere
 * `tools/probe-dress.mjs` can check all of them without a browser or a GLB
 * load.
 *
 * Three rules the table obeys, all of them learned from the blockouts:
 *
 *   1. Nothing goes in a loot ring. Every district places its chests and floor
 *      loot on rings at 0.4-0.75 of its radius, so dressing sits either inside
 *      that ring (street furniture, interleaved with the stalls) or outside it,
 *      on the open annulus between the loot ring and the shoreline. A piece
 *      over an anchor is worse than no piece: the map reads as stocked and the
 *      loot can never be taken.
 *
 *   2. Nothing goes on a bridge axis. The six districts are joined by bridge
 *      corridors, and those corridors are also the sight lines the blockout was
 *      built to guarantee -- `probe-sakura` fails the map outright when one
 *      drops under 8%. A 16 m restaurant dropped on the plaza-to-temple axis is
 *      a dead sight line, which is the exact bug the second island exists to
 *      fix. Angles are chosen in the gaps between corridor bearings.
 *
 *   3. Collision is opt-in, and only for buildings. A tree you walk through is
 *      a cosmetic nit; a house you walk through is a bug report. So `box` is
 *      present on the buildings and absent everywhere else, and the probe
 *      asserts every box is at least 0.6 m clear of every loot anchor -- the
 *      same clearance `probe-sakura` demands of the blockout itself.
 *
 * `height` normalizes by authored height (right for anything whose real size is
 * known: a 1.8 m vending machine, a 7 m tree) and `size` fits the longest axis
 * to a footprint (right for a landmark, where only "how much room does this
 * take" matters: an 830 m dragon, a 255 m ship).
 *
 * `y` is absolute. Ground pieces omit it and sit on the terrain; pieces on a
 * deck rather than on the terrain -- the plaza slab, the temple apron -- name
 * the deck's top face, because the terrain sampler knows nothing about slabs
 * and would sink them 0.4 m.
 * ------------------------------------------------------------------ */

/** Sunset Plaza's deck: 34 x 34 slab, top face 0.4 above the plateau. */
const PLAZA_DECK = 2.6;


/**
 * Sakura Isle.
 *
 * Bearings are the angle a piece sits at from its district centre, which is
 * what makes them reviewable: the plaza's bridge corridors leave at 41, 139,
 * 219, 272 and 321 degrees, so every plaza entry below sits in a gap between
 * two of them and none is within 20 degrees of one.
 */
/** Stamp a group of entries with the district they were authored around. */
const at = (poi, list) => list.map((e) => ({ ...e, poi }));

export const SAKURA_PLACEMENTS = [
  ...at('plaza', [
  // --- Sunset Plaza: the hub, and the one district that gets no imported
  // *building*. The hub's loot ring sits at 9.6-10.8 m and its six civic blocks
  // own the 11.5-16.5 m annulus, so an 8-13 m building anywhere on this deck
  // either seals a chest or shares a wall with a block -- the probe caught both
  // on its first run. The hub keeps street furniture instead and the buildings
  // go to the quieter districts, which is also the right call for play: the
  // square exists to be crossed.
  { key: 'vending', angle: 0, dist: 11.5, y: PLAZA_DECK, rot: 'inward', height: 1.85, box: [1.1, 1.85, 1.1], why: 'machine against the stall line' },
  { key: 'neonSign', angle: 172, dist: 15, y: PLAZA_DECK, rot: 'inward', height: 5, why: 'the sign you navigate the hub by' },
  { key: 'trafficLight', angle: 292, dist: 13.5, y: PLAZA_DECK, rot: 'inward', height: 4.6, why: 'junction furniture on the west edge' },
  ]),

  ...at('sakura', [

  // --- Sakura Village: low, wooden, no long sight lines. The shrine takes the
  // far side from both of the village's bridges (it leaves for the plaza at 39
  // degrees and for the caverns at 1), which puts it west of the west houses,
  // 0.65 m clear of the nearest house wall and well clear of the porch loot.
  // Height 9 rather than its authored 16.4: the village roofs are 5.6 m to the
  // ridge, and a shrine twice their height stops reading as part of the village.
  { key: 'shrine', angle: 180, dist: 13, rot: 'inward', height: 9, box: [4.3, 9, 4.0], why: 'the village landmark, facing the lane' },
  { key: 'pinkTree', angle: 200, dist: 7.2, rot: 'spin', height: 7.6, why: 'the blossom the district is named for' },
  { key: 'tree', angle: 268, dist: 13.5, rot: 'spin', height: 11, why: 'canopy closing the north edge' },
  ]),

  ...at('crystal', [

  // --- Crystal Caverns: the one district with no imported piece at all.
  //
  // Eleven spires stand on the rim at 6.5-8.7 m, three chests sit at 11.2 m and
  // the plateau ends at 11.7 m, so every bearing on the rim is either inside a
  // spire's collision or inside the chest ring -- the probe rejected five
  // different bearings for the station before this was called. The caverns keep
  // their own cave mouth as the landmark, which is a better one anyway, and the
  // station goes to the starter island where the geography allows it.
  { key: 'tree', angle: 330, dist: 12, rot: 'spin', height: 10, why: 'overgrowth on the rim' },
  ]),

  ...at('statue', [

  // --- Statue Gardens: open ground and long lanes. The dragon is a sky piece:
  // 120 m of it, no collision, well above the lamp line, and readable from
  // every other district -- which is what a landmark on the long-range
  // district should do.
  { key: 'dragon', angle: 250, dist: 26, y: 46, rot: 'spin', height: 120, why: 'the sky landmark over the gardens' },
  { key: 'pinkTree', angle: 90, dist: 11, rot: 'spin', height: 7, why: 'the one soft edge on a hard district' },
  ]),

  ...at('oasis', [

  // --- Alien Oasis: the lowest, strangest ground on the map. The overgrown
  // location is 61 m of foreign architecture, fitted to a 26 m footprint so it
  // sits on the plateau as a ruin rather than swallowing the district, and the
  // eating house goes on the opposite rim: 55 degrees from the ruin, and clear
  // of all four chest bearings (29, 120, 212, 304).
  { key: 'overgrown', angle: 300, dist: 11, rot: 'inward', size: 26, why: 'the overgrown thing in the water garden' },
  ]),

  ...at('temple', [

  // --- Celestial Temple: 9 m up its own rock, the best sight line on the map,
  // and the most crowded apron on it -- nine loot anchors on two rings inside a
  // 22 m platform. That is why the temple gets a tree and no building: it is the
  // one district where the imported landmark is the only thing left to place,
  // and its landmark is the 70 MB temple, which is blocked on the re-exporter
  // rather than on placement.
  { key: 'tree', angle: 150, dist: 9.5, rot: 'spin', height: 9, why: 'green below the approach stair' },
  ]),
];

/**
 * The starter island (map.js).
 *
 * Same rules, different geography: this island's landmarks are procedural and
 * its POIs are 6-20 m rings of kit dressing, so imported pieces go outside
 * those rings or above them. Absolute coordinates here rather than district
 * bearings, because this map's POIs are offsets on a radial island and a
 * bearing would have to be re-derived at every call site.
 *
 * Every coordinate was picked off a sampled heightmap of the built island, and
 * the reason they are all at a radius of 30-42 m is that the island is smaller
 * than `ISLAND_R` suggests: the land falls below the waterline past ~42 m, so
 * the obvious "put it on the outside edge" is a building standing in the sea.
 * That is exactly the mistake the first draft made, and `probe-dress` reports
 * it as `in the water (ground -7.81, sea -1.6)`.
 *
 * The capital ship does the real work here: 96 m up over downtown it is the one
 * object visible from the drop bus, which is its own kind of landmark, and it
 * sits above the bus's 54-61 m cruise rather than in its path.
 */
export const ISLAND_PLACEMENTS = [
  { key: 'pyramidShip', x: 0, z: 0, y: 96, rot: 'spin', size: 150, why: 'the rival ship, parked over downtown' },
  { key: 'town', x: 0, z: -42, size: 16, box: [16, 5.2, 11.3], why: 'the town quarter, on the south shore' },
  { key: 'station', x: -14, z: -38, size: 11, box: [9.5, 3.6, 6.7], why: 'a station on the south-west approach' },
  { key: 'izakaya', x: -24, z: -34, size: 9, box: [5.6, 4.2, 9], why: 'the kitchen on the north beach' },
  { key: 'pinkTree', x: 30, z: 22, rot: 'spin', height: 7.6, why: 'blossom in the neon grove' },
  { key: 'tree', x: 36, z: 8, rot: 'spin', height: 11, why: 'a canopy on the grove rim' },
  { key: 'tree', x: -36, z: 0, rot: 'spin', height: 10, why: 'canopy behind the lagoon' },
  { key: 'neonSign', x: 6, z: 30, rot: 'spin', height: 5, why: 'market signage on the approach' },
];


/** Both maps, keyed by world id, which is how a map asks for its own table. */
export const ENV_PLACEMENTS = {
  sakura: SAKURA_PLACEMENTS,
  island: ISLAND_PLACEMENTS,
};

/**
 * Deterministic spin, for `rot: 'spin'`.
 *
 * A hash of the placement rather than a random number, so the map lays out
 * identically on every load and a probe can predict where a piece will be.
 * A tree that lands at a different angle each reload makes "the tree is in the
 * wall" impossible to compare between two runs of the same probe.
 */
function spinFor(entry) {
  let h = 0x811c9dc5;
  const seed = `${entry.poi || 'island'}:${entry.key}:${entry.x ?? entry.angle}:${entry.z ?? entry.dist}`;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) / 0xffffffff) * Math.PI * 2;
}

const rad = (deg) => (deg * Math.PI) / 180;

/**
 * A placement's collision box in world axes.
 *
 * `entry.box` is authored as the piece's own footprint -- width, height, depth
 * as the model is built -- because that is the only form a person can sanity
 * check against the asset. Collision, though, is axis-aligned: `makeBox` builds
 * a box parallel to the world axes, and a box that is not expanded for the
 * placement's rotation leaves the corners of a turned building sticking out of
 * its own collision, which the player walks straight through. So the footprint
 * is rotated here, once, for both the loader and the validator.
 */
export function boxFor(entry, rotY) {
  if (!entry.box) return null;
  const [w, h, d] = entry.box;
  const c = Math.abs(Math.cos(rotY));
  const s = Math.abs(Math.sin(rotY));
  return { w: w * c + d * s, h, d: w * s + d * c };
}

/**
 * Resolve one entry to absolute world space.
 *
 * `at(poiId)` returns that district's centre; island entries carry absolute
 * coordinates and never call it. Rotation is the part worth stating: three's
 * `rotation.y = t` sends a model's local +Z to (sin t, cos t), so "face the
 * centre" from a bearing is atan2 of the *negative* direction, and "along the
 * tangent" is the perpendicular. Getting either backwards puts a restaurant's
 * back to the square, which no test can see and every player can.
 */
export function resolvePlacement(entry, at) {
  const centred = entry.angle != null;
  const base = centred ? at(entry.poi) : null;
  if (centred && !base) throw new Error(`no such district: ${entry.poi}`);
  const a = centred ? rad(entry.angle) : 0;
  const x = centred ? base.x + Math.cos(a) * entry.dist : entry.x;
  const z = centred ? base.z + Math.sin(a) * entry.dist : entry.z;
  let rotY = 0;
  if (entry.rot === 'spin') rotY = spinFor(entry);
  else if (entry.rot === 'inward' && centred) rotY = Math.atan2(-Math.cos(a), -Math.sin(a));
  else if (entry.rot === 'tangent' && centred) rotY = Math.atan2(-Math.sin(a), Math.cos(a));
  return { key: entry.key, url: ENVIRONMENT_GLB[entry.key], x, z, y: entry.y ?? null, rotY, entry };
}

/**
 * Place a whole table through the kit loader.
 *
 * Everything goes through `kit.put`, which is the same loader the procedural
 * POI dressing uses, so imported pieces inherit all of it: one fetch per URL
 * however many placements, `makeLit` rescuing the metal-and-black material
 * default, normalization to a usable size, and a place in the map's loading
 * progress. A second loader would have to re-earn all four.
 */
export function dressEnvironment(kit, list, at) {
  let placed = 0;
  for (const entry of list) {
    const r = resolvePlacement(entry, at);
    if (!r.url) {
      console.error('environment piece has no catalogue entry', entry.key);
      continue;
    }
    kit.put(r.url, {
      x: r.x,
      z: r.z,
      // A `y` that is not null means "on a deck, not on the terrain": the kit
      // only consults the terrain sampler when `ground` is true, and the
      // sampler knows nothing about the plaza slab or the temple apron.
      y: r.y,
      ground: r.y == null,
      rotY: r.rotY,
      height: entry.height ?? null,
      size: entry.size ?? 1,
      // These packs are Y-up as authored. Left on 'auto' the up-guess fires
      // whenever depth outruns height -- which the dragon, the ship and the
      // overgrown location all do -- and stands a landmark on its nose.
      up: 'y',
      // Authored in the piece's own axes and expanded here for the placement's
      // rotation, so the box covers the turned silhouette rather than leaving
      // its corners outside the collision.
      box: boxFor(entry, r.rotY),
      tag: 'env',
      shadow: true,
    });
    placed++;
  }
  return placed;
}

/**
 * Collision boxes for a placement table, resolved to world space.
 *
 * The map gets its boxes from `kit.put` at placement time, which is fine in the
 * browser and useless headlessly, where the kit is deliberately never built.
 * This is the mirror image: the same `entry.box` numbers, resolved the same
 * way, with the terrain sampler supplied by the caller. It exists so a probe
 * can ask "is the map as the player will meet it still playable?" -- openness,
 * sight lines and loot reachability all change once a 12 m restaurant carries
 * collision, and a validator that cannot see the dressing is validating a map
 * nobody will ever play.
 *
 * `ground(x, z)` is the terrain height, used only by entries with no explicit
 * `y`; deck-mounted pieces name their own deck, exactly as the loader does.
 *
 * Built with `makeBox`, not with a plain object: everything downstream --
 * `floorAt`, `pushOut`, `rayAABB` and both probes -- reads min/max fields, and
 * a box that only carries x/y/z/w/h/d is silently treated as infinitely large
 * by the range checks, which turns a two-metre vending machine into a wall
 * across the whole map. That mistake was made here first and is the reason the
 * dressing boxes go through the same factory the blockout does.
 */
export function placementBoxes(list, at, ground) {
  const out = [];
  for (const entry of list) {
    if (!entry.box) continue;
    const r = resolvePlacement(entry, at);
    const b = boxFor(entry, r.rotY);
    const y = r.y != null ? r.y : ground(r.x, r.z);
    out.push(makeBox(r.x, y + b.h / 2, r.z, b.w, b.h, b.d, 'env'));
  }
  return out;
}

/**
 * Total download the given table asks for, in MB.
 *
 * The heavy pieces are the ones worth knowing about before a match starts, and
 * the number moves as soon as a placement is added, so it is derived rather
 * than written down. The audit in `tools/probe-env.mjs` is the other half of
 * this: it measures the files, this measures the intent.
 */
export function environmentLoadMb(list) {
  return list.reduce((n, e) => {
    const mb = ENVIRONMENT_MB[e.key];
    if (mb == null) console.error('no measured size for environment piece', e.key);
    return n + (mb || 0);
  }, 0);
}


