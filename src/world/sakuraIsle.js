import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeBox } from '../game/collision.js';
import { setTerrain, buildChest, createKit, SEA_Y } from './map.js';
import { dressEnvironment, ENV_PLACEMENTS } from './envDress.js';

/* ------------------------------------------------------------------ *
 * Sakura Isle: the greybox blockout.
 *
 * A second battle-royale map, built from the concept layout rather than
 * from imported art. Six named districts sit on six separate landmasses
 * with open water between them, linked by bridges:
 *
 *      Celestial Temple   (far north, raised 9m on its own rock)
 *   Sakura Village          Crystal Caverns
 *              \          /
 *               Sunset Plaza        <- the hub, everything meets here
 *              /          \
 *    Statue Gardens        Alien Oasis
 *
 * That layout is a deliberate answer to the problem the previous island
 * kept running into. Downtown was a solid wall of cover that broke every
 * sight line, and the player reported never seeing a single other fighter
 * on a map with 43 of them. Here the water *is* the separation: you can
 * always see whether anyone has crossed, and the bridges are chokepoints
 * rather than open ground.
 *
 * "Greybox" here means the geometry is blockout-only -- untextured
 * primitives, no imported assets, no streaming -- but it is deliberately
 * NOT the mid-grey-on-mid-grey that the shooting range used to be. That
 * version made a 100m target the hardest thing on the map to see, which
 * defeats the entire point of a blockout. So the mass is a light neutral
 * and the ground is a distinctly darker one, and each district carries a
 * faint accent so the six zones stay tellable apart on the minimap, in
 * the compass, and through a sight line.
 *
 * Two hard constraints, both inherited rather than invented:
 *
 *   1. `progress()` is 1 the moment this returns. There are no assets to
 *      wait for, so the loading bar has nothing to lie about.
 *   2. Materials are Lambert/Toon/Basic only. A PBR material with nothing
 *      to reflect renders black, and map.js documents that failure at
 *      length; a blockout that renders black is not a blockout.
 * ------------------------------------------------------------------ */

/** Outer radius of the buildable isle. Water past this is open sea. */
export const ISLE_R = 62;

/** Seabed. Well below SEA_Y, so the channels read as water and not mud. */
const BED = -6.5;

/**
 * The six districts.
 *
 * `r` is the landmass radius and `h` the plateau height it flattens to.
 * Positions are chosen so the whole thing fits inside a 45m endgame circle
 * centred on (6,-4) -- which is where match.js parks the storm when it
 * finishes shrinking. A district outside the last ring would be
 * permanently unplayable no matter how good it looked.
 */
export const ISLE_POIS = [
  { id: 'plaza', name: 'Sunset Plaza', x: 0, z: 0, r: 20, h: 2.2, color: '#ffb36b' },
  { id: 'sakura', name: 'Sakura Village', x: -30, z: -24, r: 16, h: 1.8, color: '#ff9ecb' },
  { id: 'crystal', name: 'Crystal Caverns', x: 31, z: -25, r: 15, h: 2.6, color: '#7ad7ff' },
  { id: 'statue', name: 'Statue Gardens', x: -31, z: 27, r: 15, h: 2.0, color: '#e6e0ff' },
  { id: 'oasis', name: 'Alien Oasis', x: 31, z: 27, r: 15, h: 1.5, color: '#5fffc8' },
  // The temple is the outlier: far north, on its own rock, 9m up. The long
  // climb is the price of the best sight line on the map, and it sits
  // outside the late circles, so it is a confident early drop rather than a
  // place to be holding a fight you cannot leave.
  { id: 'temple', name: 'Celestial Temple', x: 2, z: -54, r: 13, h: 9.5, color: '#ffe98a' },
];

/**
 * Bridges, as [from, to, width].
 *
 * Every one of these is a chokepoint, which is the whole point of splitting
 * the map. The temple span is deliberately longer and wider than any other:
 * it is the only way up there and it is exposed the entire way.
 */
const BRIDGES = [
  ['plaza', 'sakura', 7],
  ['plaza', 'crystal', 7],
  ['plaza', 'statue', 7],
  ['plaza', 'oasis', 7],
  ['plaza', 'temple', 9],
  ['sakura', 'crystal', 5],
  ['statue', 'oasis', 5],
];

const BY_ID = Object.fromEntries(ISLE_POIS.map((p) => [p.id, p]));

/**
 * Local depressions inside a district, in metres below its plateau.
 *
 * The crater and the oasis basin are described here rather than stamped
 * into the height function, so the terrain mesh, the collision floor and
 * the sight lines all read from one source.
 */
const BASINS = [
  { x: 31, z: -25, r: 9, depth: 3.0 },   // the Crystal Caverns bowl
  { x: 34, z: 30, r: 8, depth: 1.9 },   // the Alien Oasis pool
  { x: -31, z: 27, r: 7, depth: 0.8 },  // the Statue Gardens fountain
];

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * The ground sampler.
 *
 * Installed through `setTerrain` so match.js -- which calls the shared
 * `heightAt` at roughly twenty sites -- keeps working against this map
 * without a single call site being rewired. That indirection is the reason a
 * second map is affordable at all.
 *
 * Built as a max() over the six landmasses rather than as a heightmap blend.
 * A max means each district keeps its own flat plateau out to ~60% of its
 * radius, which is what a blockout needs: buildings want level ground, and
 * the transitions want to be short and legible rather than gently blended.
 */
export function isleHeightAt(x, z) {
  let h = BED;
  for (const p of ISLE_POIS) {
    const d = Math.hypot(x - p.x, z - p.z) / p.r;
    if (d > 1.2) continue;
    // 1 well inside the plateau, 0 out past the shoreline. The plateau holds
    // to 78% of the radius rather than the 62% this started at, because the
    // districts put their loot rings out at 65-70% and at 62% those rings
    // were already down the beach slope -- four chests sitting in the sea.
    // The low end is the seabed rather than zero, so the channels between
    // districts genuinely stay under SEA_Y instead of becoming sandbars.
    const y = lerp(BED, p.h, 1 - smoothstep(0.78, 1.0, d));
    if (y > h) h = y;
  }
  for (const b of BASINS) {
    const d = Math.hypot(x - b.x, z - b.z) / b.r;
    if (d >= 1) continue;
    h -= b.depth * (1 - smoothstep(0.25, 1, d));
  }
  return h;
}

/* ------------------------------------------------------------------ *
 * Palette
 *
 * A blockout still has to be readable, so the value range is deliberate:
 * ground sits dark, mass sits light, and accents identify a district without
 * being a paint job. Everything that must be seen through a sight line is
 * lighter than everything meant to hide behind it.
 * ------------------------------------------------------------------ */

const C = {
  ground: 0x6fae5a,
  seabed: 0x2f6f86,
  sand: 0xead7a8,
  mass: 0xf4e7d3,
  massAlt: 0xd8a56a,
  // Mid grey. Sits between the light mass and the dark ground so accent
  // structures read as their own layer without competing with either.
  accent: 0xc9524f,
  // The darkest structural tone. This was 0x2f3540 and read as a black hole
  // punched through the scene: the toon ramp's lowest band is 64/255, so a
  // surface already that dark lands at ~0.05 luminance on its unlit side and
  // every parapet, rail and roof cap rendered as a silhouette. The range from
  // here to `mass` is about 2.5 stops, which is enough to read as "darker
  // material" without anything becoming a void. graybox.js documents the same
  // failure at length when the range tried to be honestly black.
  dark: 0x5a4650,
  water: 0x3fa9c9,
};

let RAMP = null;
function toonRamp() {
  if (RAMP) return RAMP;
  const steps = new Uint8Array([64, 128, 196, 255]);
  RAMP = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  RAMP.minFilter = THREE.NearestFilter;
  RAMP.magFilter = THREE.NearestFilter;
  RAMP.generateMipmaps = false;
  RAMP.needsUpdate = true;
  return RAMP;
}

function massMat(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), ...opts });
}

function flatMat(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, ...opts });
}

function glowMat(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
}

/* ------------------------------------------------------------------ *
 * Geometry batching
 *
 * The whole blockout is a few thousand primitives. Left as individual
 * meshes that is a few thousand draw calls and a slideshow; merged per
 * material it is about a dozen. One batch per material, so the draw-call
 * saving never costs the ability to tint a district.
 * ------------------------------------------------------------------ */

class Batch {
  constructor(material, name) {
    this.material = material;
    this.name = name;
    this.geos = [];
    this.sources = new Set();
  }

  /** Queue a primitive, transformed into world space. */
  push(geo, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
    this.sources.add(geo);
    const g = geo.clone();
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    o.scale.set(sx, sy, sz);
    o.rotation.set(rx, ry, rz);
    o.updateMatrix();
    g.applyMatrix4(o.matrix);
    this.geos.push(g);
    return g;
  }

  build(parent) {
    if (!this.geos.length) return null;
    const merged = mergeGeometries(this.geos, false);
    for (const g of this.geos) g.dispose();
    this.geos.length = 0;
    for (const s of this.sources) s.dispose();
    this.sources.clear();
    if (!merged) return null;
    const mesh = new THREE.Mesh(merged, this.material);
    mesh.name = this.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
}

/** Small deterministic PRNG, so the same seed lays the block out identically. */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Terrain, water, sky
 *
 * The ground is a single grid that samples `isleHeightAt` directly, so the
 * mesh and the collision floor are the same function and cannot drift. It is
 * vertex-coloured by depth rather than textured, which keeps the whole map
 * asset-free while still making the shoreline legible: dark where it is
 * underwater, a sand band at the waterline, grey mass above it. On a
 * blockout that band is doing real work -- it is how you read "I am about to
 * step off the edge" without any art at all.
 * ------------------------------------------------------------------ */

const GRID = 132;   // vertices per side
const SPAN = ISLE_R * 2.5;

function buildTerrain(parent) {
  const step = SPAN / (GRID - 1);
  const half = SPAN / 2;
  const pos = new Float32Array(GRID * GRID * 3);
  const col = new Float32Array(GRID * GRID * 3);
  const idx = new Uint32Array((GRID - 1) * (GRID - 1) * 6);

  const ground = new THREE.Color(C.ground);
  const seabed = new THREE.Color(C.seabed);
  const sand = new THREE.Color(C.sand);
  const tmp = new THREE.Color();

  let v = 0;
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = -half + i * step;
      const z = -half + j * step;
      const y = isleHeightAt(x, z);
      pos[v * 3] = x;
      pos[v * 3 + 1] = y;
      pos[v * 3 + 2] = z;
      // Below the waterline: sand, fading to seabed as it gets deeper.
      // Above it: a short sand band, then flat grey ground.
      if (y < SEA_Y - 0.2) {
        const t = Math.min(1, (SEA_Y - 0.2 - y) / 4);
        tmp.copy(sand).lerp(seabed, t);
      } else if (y < SEA_Y + 0.9) {
        const t = (y - (SEA_Y - 0.2)) / 1.1;
        tmp.copy(sand).lerp(ground, Math.max(0, Math.min(1, t)));
      } else {
        tmp.copy(ground);
      }
      col[v * 3] = tmp.r;
      col[v * 3 + 1] = tmp.g;
      col[v * 3 + 2] = tmp.b;
      v++;
    }
  }

  let t = 0;
  for (let j = 0; j < GRID - 1; j++) {
    for (let i = 0; i < GRID - 1; i++) {
      const a = j * GRID + i;
      const b = a + GRID;
      // Wound counter-clockwise seen from +Y. Get this backwards and every
      // normal points down and the whole isle lights from underneath -- the
      // exact bug map.js documents on its own disc.
      idx[t++] = a; idx[t++] = b; idx[t++] = a + 1;
      idx[t++] = a + 1; idx[t++] = b; idx[t++] = b + 1;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();

  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'isle-terrain';
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** The water sheet the channels and the sea share. */
function buildWater(parent) {
  const g = new THREE.PlaneGeometry(SPAN * 2.4, SPAN * 2.4, 1, 1);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color: C.water, transparent: true, opacity: 0.72, depthWrite: false,
  }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = SEA_Y;
  m.name = 'isle-water';
  m.renderOrder = 1;
  parent.add(m);
  return m;
}

/**
 * Sky dome and sun.
 *
 * Rebuilt here rather than shared with map.js because the fog and the sun
 * angle are art direction for *this* map: the storm wall is a 250-unit
 * cylinder, so fog has to start well outside the playable area or the whole
 * isle washes out to one flat sheet.
 */
function buildSkyAndLight(scene) {
  scene.background = null;
  scene.fog = new THREE.Fog(0xbcd0e8, 120, 460);

  const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x3b4351, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff6e6, 1.3);
  sun.position.set(70, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 420;
  sun.shadow.camera.left = -100;
  sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 120;
  sun.shadow.camera.bottom = -100;
  // Without a normalBias a 2048 map stretched over 300 world units
  // self-samples so badly that whole surfaces test as occluded and render
  // solid black. map.js documents the same fix on its own sun.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);
  scene.add(sun.target);

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      top: { value: new THREE.Color('#5f7fc4') },
      mid: { value: new THREE.Color('#a8c4e8') },
      horizon: { value: new THREE.Color('#e6eef8') },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 horizon;
      void main(){
        float h = normalize(vP).y;
        vec3 c = mix(horizon, mid, smoothstep(-0.02, 0.28, h));
        c = mix(c, top, smoothstep(0.18, 0.8, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 20, 14), skyMat);
  sky.name = 'isle-sky';
  scene.add(sky);

  return { sky, sun, hemi };
}

/* ------------------------------------------------------------------ *
 * District construction
 *
 * Every district follows the same shape: a `Builder` that owns the batches
 * and the collision list, with `box`/`pillar`/`slab` helpers that write
 * geometry and collision together.
 *
 * That coupling is the important part. A blockout whose visual and its
 * collision are authored separately always drifts, and the symptom is
 * always the same and very confusing: you can see a wall you walk through.
 * Every solid here is emitted by one call that does both.
 * ------------------------------------------------------------------ */

class Builder {
  constructor(group, boxes) {
    this.group = group;
    this.boxes = boxes;
    this.anchors = { chests: [], floors: [], crystals: [], drops: [] };
    this.mass = new Batch(massMat(C.mass), 'isle-mass');
    this.alt = new Batch(massMat(C.massAlt), 'isle-mass-alt');
    this.dark = new Batch(massMat(C.dark), 'isle-dark');
    this.accent = new Batch(massMat(C.accent), 'isle-accent');
    this.glow = new Batch(glowMat(0xffffff), 'isle-glow');
    this.unit = new THREE.BoxGeometry(1, 1, 1);
    this.cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    this.cone = new THREE.ConeGeometry(0.5, 1, 8);
    this.sphere = new THREE.SphereGeometry(0.5, 10, 8);
  }

  /** A solid box. `y` is the CENTRE, matching makeBox. */
  box(batch, x, y, z, w, h, d, ry = 0, tag = 'solid') {
    batch.push(this.unit, x, y, z, w, h, d, ry);
    // Rotated boxes are approximated by their axis-aligned bounds. On a
    // blockout that is the right trade: the collision is a fraction larger
    // than the visual, which stops you clipping a corner, rather than
    // smaller, which would let you stand inside a wall.
    const c = Math.abs(Math.cos(ry));
    const s = Math.abs(Math.sin(ry));
    const bw = w * c + d * s;
    const bd = w * s + d * c;
    this.boxes.push(makeBox(x, y, z, bw, h, bd, tag));
  }

  /** A solid cylinder, for columns, trunks and silo shapes. */
  pillar(batch, x, y, z, r, h, tag = 'solid') {
    batch.push(this.cyl, x, y, z, r * 2, h, r * 2);
    this.boxes.push(makeBox(x, y, z, r * 2, h, r * 2, tag));
  }

  /**
   * Decoration with no collision: roofs, caps, beacons, water discs.
   *
   * Deliberately separate from `box`. A blockout full of invisible walls is
   * miserable to fight in, and these are the shapes where a collision box
   * would be actively wrong -- a roof cone or a pool of water.
   */
  push(batch, geo, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
    return batch.push(geo, x, y, z, sx, sy, sz, ry, rx, rz);
  }

  /**
   * Decoration in a caller-chosen batch, in the district's own material.
   *
   * `accent` is the default because most decoration is a trim, a roof or a
   * cap, and those want the mid grey rather than the bright structural
   * white -- using `mass` for everything flattens the silhouette.
   */
  decor(geo, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
    return this.accent.push(geo, x, y, z, sx, sy, sz, ry, rx, rz);
  }

  /**
   * Collision for a shape `box` did not draw, or could not draw.
   *
   * Used for cones and spheres, whose visual is a batch push but which are
   * still solid -- a player must not walk through a crystal spire just
   * because its collision is a box rather than a cone. The box is fitted to
   * the shape's width and full height, which is close enough at blockout
   * scale and, again, errs on the side of being solid.
   */
  collide(x, y, z, w, h, d, tag = 'solid') {
    this.boxes.push(makeBox(x, y, z, w, h, d, tag));
  }

  /** Flat, walkable-topped platform. The top face is the collision top. */
  slab(batch, x, y, z, w, d, h = 0.5, ry = 0, tag = 'solid') {
    this.box(batch, x, y + h / 2, z, w, h, d, ry, tag);
    return y + h;
  }

  finish() {
    for (const b of [this.mass, this.alt, this.dark, this.accent, this.glow]) b.build(this.group);
  }
}

/** Ground level at a point, for seating things on the terrain. */
const g = isleHeightAt;

/* ------------------------------------------------------------------ *
 * Sunset Plaza -- the hub.
 *
 * The only district with real verticality, because it is the one everyone
 * has to cross. Buildings are kept to 5-9m and spaced 12m apart on purpose:
 * the earlier island's city was 52 boxes over 6m tall packed shoulder to
 * shoulder, which is a wall, not a district. Here you can see across the
 * square and count the people in it, which is the entire reason a hub
 * exists.
 * ------------------------------------------------------------------ */
function buildPlaza(B, rng) {
  const p = BY_ID.plaza;
  const base = g(p.x, p.z);

  // The square itself, one step above the grass so the hub reads as built.
  // 34 wide rather than 26: the civic ring below needs a clear margin outside
  // it for loot, and at 26 the deck edge and the building footprints were the
  // same distance from the centre, so every chest ring landed inside a wall.
  const deck = B.slab(B.alt, p.x, base, p.z, 34, 34, 0.4);

  // Six civic blocks, not eight, at 14m out on a 17m deck. The count and the
  // distance are both load-bearing: eight 5.5m blocks on a 20m radius left
  // only 9% of the hub's floor open, which is the same "downtown is a wall"
  // failure the last island had, just at a smaller scale. Pushing the ring
  // out and thinning it keeps the middle of the square open to fight in,
  // which is the entire reason a hub exists.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.39;
    const d = 14;
    const bx = p.x + Math.cos(a) * d;
    const bz = p.z + Math.sin(a) * d;
    const by = g(bx, bz);
    const w = 4 + rng() * 1.5;
    const dp = 4 + rng() * 1.5;
    const h = i % 2 ? 5 : 8.5;
    B.box(i % 2 ? B.mass : B.alt, bx, by + h / 2, bz, w, h, dp, -a + 0.2);
    // A parapet, so roofs are readable as ledges and give a height cue.
    B.box(B.dark, bx, by + h + 0.25, bz, w + 0.5, 0.5, dp + 0.5, -a + 0.2);
    if (i % 3 === 0) {
      B.box(B.accent, bx, by + h + 1.1, bz, 1.6, 1.2, 1.6, -a);
      B.anchors.floors.push({ x: bx, y: by + h + 0.6, z: bz, poi: p.id });
    }
  }

  // The clock tower: the one thing on the map you can navigate by from
  // anywhere, which is the actual job of a landmark in a game.
  const th = 16;
  B.box(B.mass, p.x, base + th / 2, p.z, 4.4, th, 4.4, 0.4);
  B.box(B.dark, p.x, base + th + 0.4, p.z, 5.6, 0.8, 5.6, 0.4);
  B.box(B.accent, p.x, base + th + 1.6, p.z, 2.4, 1.6, 2.4, 0.4);
  // Four clock faces, one per side, so the tower reads from any approach.
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2) + 0.4;
    B.decor(B.sphere, p.x + Math.cos(a) * 2.3, base + th - 2, p.z + Math.sin(a) * 2.3, 2.6, 2.6, 0.5, a);
  }

  // Fountain at the centre: hard cover in the open, and a reason to stop.
  B.pillar(B.alt, p.x, base + 0.4, p.z, 3.4, 0.8);
  B.pillar(B.accent, p.x, base + 1.2, p.z, 0.7, 1.6);
  B.decor(B.sphere, p.x, base + 2.4, p.z, 1.8, 1.8, 1.8);

  // Market stalls ringing the deck, giving waist-high cover to cross behind.
  // Floor loot sits just outside each stall rather than under it: authored at
  // the stall's own centre it was sealed inside the stall's collision, which
  // is loot the map shows and the player can never take.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.8;
    const sx = p.x + Math.cos(a) * 6.5;
    const sz = p.z + Math.sin(a) * 6.5;
    B.box(B.accent, sx, deck + 0.6, sz, 2.2, 1.2, 2.2, a);
    const lx = p.x + Math.cos(a) * 8.4;
    const lz = p.z + Math.sin(a) * 8.4;
    B.anchors.floors.push({ x: lx, y: g(lx, lz), z: lz, poi: p.id });
  }

  // Chests on the same 8.6m ring, offset from the stall loot so the two sets
  // do not stack on top of each other.
  for (let i = 0; i < 4; i++) {
    const a = i * 1.9 + 0.4;
    const cx = p.x + Math.cos(a) * 8.6;
    const cz = p.z + Math.sin(a) * 8.6;
    B.anchors.chests.push({ x: cx, y: g(cx, cz), z: cz, poi: p.id });
  }
  // The crystal goes out past the fountain (3.4m) rather than dead centre,
  // where the fountain's own collision sealed it.
  B.anchors.crystals.push({ x: p.x + 5.4, y: g(p.x + 5.4, p.z), z: p.z, poi: p.id, kind: 'jump' });
  // Scattered floor loot, confined to the open annulus between the stall ring
  // and the civic ring. Sampled from the whole square it landed on the
  // fountain, the stalls and the buildings.
  for (let i = 0; i < 8; i++) {
    const a = rng() * Math.PI * 2;
    const d = 9.6 + rng() * 1.2;
    const fx = p.x + Math.cos(a) * d;
    const fz = p.z + Math.sin(a) * d;
    B.anchors.floors.push({ x: fx, y: g(fx, fz), z: fz, poi: p.id });
  }
}

/**
 * Sakura Village -- low, tight, wooden.
 *
 * Deliberately the opposite of the plaza: single-storey houses with steep
 * roofs on a lane. Close quarters and no long sight lines, so it is the
 * district where you win by hearing someone rather than seeing them.
 */
function buildSakura(B, rng) {
  const p = BY_ID.sakura;
  const base = g(p.x, p.z);

  // A lane, laid as a straight run of paving so the layout reads as a plan.
  B.box(B.alt, p.x, base + 0.1, p.z, 22, 0.2, 5);

  // Six houses, two per side of the lane, roofs stepped so the silhouette
  // has rhythm rather than being six identical sheds.
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const hx = p.x - 7.5 + (i % 3) * 7.5;
    const hz = p.z + side * 6.5;
    const hy = g(hx, hz);
    const w = 5.5;
    const dp = 5;
    const h = 3.2;
    B.box(B.alt, hx, hy + h / 2, hz, w, h, dp);
    // A wide, low pyramid roof: cheap, and unmistakably a roof in silhouette.
    B.decor(B.cone, hx, hy + h + 1.1, hz, w * 1.5, 2.4, dp * 1.5, Math.PI / 4, 0, Math.PI / 4);
    // Porch rail: waist-high cover you actually fight behind.
    B.box(B.dark, hx, hy + 1.1, hz - side * 3.2, w * 0.8, 2.2, 0.4);
    // Loot on the porch, between the rail and the lane, rather than at the
    // house's own centre -- which is inside the house, and is loot the map
    // shows and the player can never walk into.
    const lz = hz - side * 4.4;
    B.anchors.floors.push({ x: hx, y: g(hx, lz), z: lz, poi: p.id });
  }

  // The pagoda: five tapering tiers with a gap you can see and shoot through.
  let ty = base;
  for (let i = 0; i < 5; i++) {
    const w = 6.4 - i * 0.9;
    B.box(B.mass, p.x + 11, ty + 1.4, p.z - 9, w, 2.8, w);
    B.box(B.dark, p.x + 11, ty + 3.1, p.z - 9, w + 1.6, 0.5, w + 1.6);
    ty += 3.4;
  }
  B.decor(B.cone, p.x + 11, ty + 1.4, p.z - 9, 2.4, 3, 2.4);

  // Torii gate on the bridge approach: a silhouette that says "this is the
  // way in" from a long way off.
  for (const s of [-1.6, 1.6]) {
    B.box(B.dark, p.x + s, base + 2.2, p.z + 13, 0.5, 4.4, 0.5);
  }
  B.box(B.dark, p.x, base + 4.7, p.z + 13, 5, 0.5, 0.7);
  B.box(B.dark, p.x, base + 3.9, p.z + 13, 4.2, 0.4, 0.6);

  // Chests on the lane itself, spread along it. Placing them on a ring put
  // them inside the houses: the ring passed through the gaps between the
  // roof blocks and landed on their corners. The street is the one strip of
  // this district that is guaranteed clear, and loot in the street is where
  // you would actually look for it.
  for (let i = 0; i < 4; i++) {
    const t = -8 + i * 5.2;
    B.anchors.chests.push({ x: p.x + t, y: g(p.x + t, p.z), z: p.z, poi: p.id });
  }
  B.anchors.crystals.push({ x: p.x, y: base + 0.4, z: p.z, poi: p.id, kind: 'speed' });
}

/**
 * Crystal Caverns -- a bowl you fight down into.
 *
 * The basin in BASINS digs the floor down 3m here, and the spires stand in
 * and around it. Everything is a vertical edge, so it plays completely
 * differently from the plaza: you are looking up and across a pit rather
 * than across a square.
 */
function buildCrystal(B, rng) {
  const p = BY_ID.crystal;
  const base = g(p.x, p.z);

  // Spires on a ring, tall enough to break every line through the bowl but
  // spaced so there is always a gap to move between them.
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const d = 6.5 + (i % 3) * 1.1;
    const x = p.x + Math.cos(a) * d;
    const z = p.z + Math.sin(a) * d;
    const y = g(x, z);
    const h = 5 + (i % 4) * 2.6;
    // Octagonal and tapering: reads as a crystal, and a cone is a cheap way
    // to make a blockout read as faceted.
    B.decor(B.cone, x, y + h / 2, z, 2.2 + (i % 3) * 0.5, h, 2.2 + (i % 3) * 0.5, a);
    B.collide(x, y + h / 2, z, 2.2, h, 2.2, 'crystal');
    if (i % 2 === 0) B.anchors.floors.push({ x, y: y + 0.1, z, poi: p.id });
  }

  // Cave mouth: a lintel on two legs at the bowl's edge. The one place on
  // this map with a real interior, and the reason the district has a back.
  const cx = p.x - 9.5;
  const cz = p.z + 4;
  const cy = g(cx, cz);
  B.box(B.dark, cx - 3, cy + 1.6, cz, 1.2, 3.2, 1.2);
  B.box(B.dark, cx + 3, cy + 1.6, cz, 1.2, 3.2, 1.2);
  B.box(B.mass, cx, cy + 3.9, cz, 8.4, 1.4, 2.4);
  B.anchors.chests.push({ x: cx, y: cy + 0.1, z: cz, poi: p.id });

  // Rubble in the bowl: waist-high cover at the bottom, where the fight is.
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    const d = 2 + rng() * 5;
    const x = p.x + Math.cos(a) * d;
    const z = p.z + Math.sin(a) * d;
    B.box(B.alt, x, g(x, z) + 0.5, z, 1.6, 1, 1.6, rng() * 3);
  }

  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 0.3;
    // 11.2m clears the spire ring. The spires sit at 6.5-8.7m and their
    // collision is a 2.2m box, so they reach 9.8m, and the ring at 10.3-10.5m
    // was still clipping two of them.
    const cx = p.x + Math.cos(a) * 11.2;
    const cz = p.z + Math.sin(a) * 11.2;
    B.anchors.chests.push({ x: cx, y: g(cx, cz), z: cz, poi: p.id });
  }
  B.anchors.crystals.push({ x: p.x, y: base + 0.3, z: p.z, poi: p.id, kind: 'jump' });
}

/**
 * Statue Gardens -- open, symmetrical, long sight lines.
 *
 * The opposite of the village again. Tall thin statues on plinths give cover
 * you can see straight over, which makes this the district where long-range
 * weapons actually belong. Worth having on a map this size.
 */
function buildStatue(B, rng) {
  const p = BY_ID.statue;
  const base = g(p.x, p.z);

  B.box(B.alt, p.x, base + 0.1, p.z, 20, 0.2, 20);

  // Twelve statues on a ring: plinth, body, head. All three are solid, so a
  // statue is cover from the waist down and a silhouette above it.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const d = i % 2 ? 6.5 : 8;
    const x = p.x + Math.cos(a) * d;
    const z = p.z + Math.sin(a) * d;
    const y = g(x, z);
    B.box(B.alt, x, y + 0.4, z, 2, 0.8, 2, a);
    B.box(B.mass, x, y + 2.6, z, 1.1, 3.6, 1.1, a);
    B.decor(B.sphere, x, y + 4.9, z, 1.1, 1.3, 1.1);
    if (i % 3 === 0) B.anchors.floors.push({ x, y: y + 0.9, z, poi: p.id });
  }

  // Colonnade down two sides: a corridor with lanes between the columns,
  // which is the only place on the map where a sniper has natural lanes.
  for (let i = 0; i < 5; i++) {
    const t = -6 + i * 3;
    for (const s of [-1, 1]) {
      B.pillar(B.mass, p.x + t, base + 2.6, p.z + s * 5.5, 0.55, 5.2);
    }
  }
  B.box(B.dark, p.x, base + 5.5, p.z - 5.5, 13, 0.7, 1.4);
  B.box(B.dark, p.x, base + 5.5, p.z + 5.5, 13, 0.7, 1.4);

  // The fountain basin, sunk into the ground so it holds cover you crouch
  // behind rather than a kerb you walk over.
  B.pillar(B.alt, p.x, g(p.x, p.z) + 0.3, p.z, 3, 1.4);
  B.pillar(B.mass, p.x, g(p.x, p.z) + 1.4, p.z, 0.8, 1.6);

  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + 0.9;
    B.anchors.chests.push({ x: p.x + Math.cos(a) * 10.5, y: g(p.x + Math.cos(a) * 10.5, p.z + Math.sin(a) * 10.5), z: p.z + Math.sin(a) * 10.5, poi: p.id });
  }
  B.anchors.crystals.push({ x: p.x, y: base + 0.4, z: p.z, poi: p.id, kind: 'shield' });
}

/**
 * Alien Oasis -- the lowest ground on the map, and the strangest.
 *
 * A sunken pool with a ring of bulbous columns around it. Because BASINS
 * drops this district below the others, you approach it downhill and you
 * are lit from below by the water, which makes it the district that reads
 * as "somewhere else" from every approach.
 */
function buildOasis(B, rng) {
  const p = BY_ID.oasis;
  const base = g(p.x, p.z);

  // Bulb columns: a fat base, a thin neck, a big cap. The silhouette is the
  // whole identity of the district, so it is worth three primitives each.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const d = 5.5 + (i % 3) * 1.1;
    const x = p.x + Math.cos(a) * d;
    const z = p.z + Math.sin(a) * d;
    const y = g(x, z);
    B.pillar(B.alt, x, y + 0.9, z, 1.3, 1.8);
    B.pillar(B.mass, x, y + 2.9, z, 0.45, 2.2);
    B.decor(B.sphere, x, y + 4.6, z, 2.6, 2, 2.6);
    if (i % 2 === 0) B.anchors.floors.push({ x, y: y + 0.1, z, poi: p.id });
  }

  // The pool: a wide, low disc at the basin floor. Deliberately NOT solid --
  // it is water, and you wade through it, which is what makes this the one
  // district where `slowAt` matters.
  const px = 34;
  const pz = 30;
  B.decor(B.cyl, px, g(px, pz) + 0.15, pz, 11, 0.3, 11);
  B.pillar(B.accent, px, g(px, pz) + 0.9, pz, 0.6, 1.8);

  // Two low walls flanking the pool, the only real cover down here.
  B.box(B.alt, px - 6, g(px, pz) + 1, pz - 2, 1.2, 2, 8, 0.3);
  B.box(B.alt, px + 6, g(px, pz) + 1, pz + 2, 1.2, 2, 8, -0.3);

  for (let i = 0; i < 4; i++) {
    const a = i * 1.6 + 0.5;
    // 10.5m clears the bulb columns (which reach ~7.7m) and the flanking
    // walls, and is still on the 11.7m plateau.
    const cx = p.x + Math.cos(a) * 10.5;
    const cz = p.z + Math.sin(a) * 10.5;
    B.anchors.chests.push({ x: cx, y: g(cx, cz), z: cz, poi: p.id });
  }
  B.anchors.crystals.push({ x: px, y: g(px, pz) + 0.5, z: pz, poi: p.id, kind: 'speed' });
}

/**
 * Celestial Temple -- the high ground, and the reason to fight for a map.
 *
 * Nine metres up on its own rock at the far north. The approach is one long
 * bridge, so holding it is a decision rather than a formality, and being up
 * here means you can see every other district on the isle.
 */
function buildTemple(B, rng) {
  const p = BY_ID.temple;
  const base = g(p.x, p.z);

  // Terraced platform: three steps up to the summit, so it reads as built on
  // the rock rather than floating above it.
  B.box(B.alt, p.x, base - 0.4, p.z, 22, 1.6, 22);
  B.box(B.mass, p.x, base + 0.5, p.z, 17, 1, 17);
  const terrace = base + 1;

  // The hall: a colonnade of eight columns carrying a solid roof. Firing
  // lanes run between the columns in every direction, so this is cover you
  // can shoot through rather than a bunker.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    B.pillar(B.mass, p.x + Math.cos(a) * 5, terrace + 3, p.z + Math.sin(a) * 5, 0.7, 6);
  }
  B.box(B.dark, p.x, terrace + 6.6, p.z, 13, 1.2, 13, 0.4);
  B.decor(B.cone, p.x, terrace + 9, p.z, 9, 5, 9, Math.PI / 4);

  // Approach stair up the south face, wide enough to be worth fighting on.
  for (let s = 0; s < 6; s++) {
    const t = s / 6;
    B.box(B.alt, p.x, base - 1.2 + s * 0.3, p.z + 9 + s * 1.6, 7, 0.4, 1.8);
  }

  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + 0.2;
    const x = p.x + Math.cos(a) * 8.5;
    const z = p.z + Math.sin(a) * 8.5;
    B.anchors.floors.push({ x, y: g(x, z) + 0.1, z, poi: p.id });
  }
  for (let i = 0; i < 3; i++) {
    const a = i * 2.2 + 0.6;
    B.anchors.chests.push({ x: p.x + Math.cos(a) * 6, y: terrace + 0.1, z: p.z + Math.sin(a) * 6, poi: p.id });
  }
  B.anchors.crystals.push({ x: p.x, y: terrace + 0.6, z: p.z, poi: p.id, kind: 'jump' });
}

/* ------------------------------------------------------------------ *
 * Bridges
 *
 * A bridge is the only way between two districts, so it has to be walkable
 * end to end. That is harder than it sounds when the two ends are at
 * different heights: the temple sits 7m above the plaza, and a flat deck
 * between them would launch you off the top or drop you through the near
 * end. So each span is laid as a run of short segments that interpolate
 * between the two plateau heights, and every segment carries its own
 * collision box with its top face at the walking surface.
 *
 * The side rails are the other half of the job. A bridge over 3m of water
 * with no rails is a place players fall off constantly, and falling in
 * mid-fight is the least interesting way to lose a gunfight.
 * ------------------------------------------------------------------ */
function buildBridges(B) {
  for (const [fromId, toId, width] of BRIDGES) {
    const a = BY_ID[fromId];
    const b = BY_ID[toId];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;

    // Walk out from each district centre to find where its land actually
    // ends, and bridge the gap between those two points.
    //
    // The first version used a fixed fraction of each radius (`a.r * 0.72`)
    // and was wrong in a way that is invisible until you measure it: the
    // plaza's radius is 20, so the temple span began 14.4m out and then ramped
    // from 2.2m to 9.5m across the *plaza's own square*, hanging a ceiling
    // 7-11m over the middle of the hub.
    //
    // Marching the terrain is right in principle but the first cut of it
    // returned the last point still above the waterline, which is the
    // plateau's flat top rather than its edge -- for the temple that is 11m
    // out of a 13m radius, so the span still started on dry land and simply
    // shortened. What a span needs is the point where the ground *begins to
    // fall away*, which is where the profile leaves the plateau: sample the
    // slope and stop at the last place it is still flat.
    const shore = (p, dirX, dirZ) => {
      let flat = p.r * 0.4;
      for (let d = p.r * 0.4; d <= p.r * 1.2; d += 0.25) {
        const here = isleHeightAt(p.x + dirX * d, p.z + dirZ * d);
        const ahead = isleHeightAt(p.x + dirX * (d + 0.5), p.z + dirZ * (d + 0.5));
        // The plateau is level; the beach is not. Once the ground starts
        // dropping away, this is the shoreline.
        if (here - ahead > 0.06 || ahead < SEA_Y) break;
        flat = d;
      }
      return flat;
    };
    const startA = shore(a, ux, uz);
    const startB = shore(b, -ux, -uz);
    const start = startA;
    const end = len - startB;
    // Deck height at each end is the ground it actually lands on, not the
    // district's nominal plateau -- those differ wherever a basin has dug
    // the shoreline down, and a deck that ignores that leaves a step.
    const y0 = isleHeightAt(a.x + ux * startA, a.z + uz * startA);
    const y1 = isleHeightAt(b.x - ux * startB, b.z - uz * startB);
    if (end - start < 4) continue;   // districts already touch; nothing to span

    // One segment every ~3m. Short segments matter here: the collision top
    // has to follow the ramp closely or the player catches a lip between
    // boxes and stutters up the span.
    const segs = Math.max(4, Math.round((end - start) / 3));
    for (let i = 0; i < segs; i++) {
      const t0 = (start + (end - start) * (i / segs)) / len;
      const t1 = (start + (end - start) * ((i + 1) / segs)) / len;
      const mx = a.x + dx * (t0 + t1) / 2;
      const mz = a.z + dz * (t0 + t1) / 2;
      const y = y0 + (y1 - y0) * ((i + 0.5) / segs);
      const segLen = ((end - start) / segs) + 0.6;
      const ry = Math.atan2(ux, uz);
      // Deck.
      B.box(B.alt, mx, y - 0.2, mz, width, 0.4, segLen, ry);
      // Rails, offset to the sides. Slightly taller than waist height so
      // they are cover as well as a guard.
      const nx = -uz * (width / 2 - 0.3);
      const nz = ux * (width / 2 - 0.3);
      for (const s of [-1, 1]) {
        B.box(B.dark, mx + nx * s, y + 0.6, mz + nz * s, 0.3, 1.2, segLen, ry);
      }
      // Piers every third segment, down to the seabed, so the span reads as
      // built over the water rather than hovering on it.
      if (i % 3 === 1) {
        const bed = isleHeightAt(mx, mz);
        const h = Math.max(1, y - bed);
        B.box(B.dark, mx, y - 0.4 - h / 2, mz, 1.4, h, 1.4, ry);
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Drop ship and lobby deck
 *
 * Both are procedural and minimal. They exist because match.js reads
 * `world.ufo.seats` and `world.lobby.userData.box` unconditionally on the
 * match path, and this map takes that path -- it has a real drop, a real
 * storm and real bots. The seat ring is kept at 6 to match the island.
 * ------------------------------------------------------------------ */
function buildUfo() {
  const group = new THREE.Group();
  const black = new THREE.MeshToonMaterial({ color: '#0d0a12', gradientMap: toonRamp(), emissive: '#1a0f24', emissiveIntensity: 1 });
  const body = new THREE.CylinderGeometry(4.6, 17, 13, 4, 1).rotateY(Math.PI / 4);
  const hull = new THREE.Mesh(body, black);
  hull.position.y = -6.6;
  hull.castShadow = true;
  group.add(hull);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body), new THREE.LineBasicMaterial({ color: '#c9a2ff', fog: false }));
  hull.add(edges);
  // Crown deck the riders stand on.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.3, 6.4), new THREE.MeshToonMaterial({ color: '#1c1526', gradientMap: toonRamp() }));
  deck.position.y = 0.02;
  group.add(deck);
  // Glowing seam rings and a slow-pulsing underside core.
  const glow = new THREE.MeshBasicMaterial({ color: '#b98cff', fog: false });
  for (let i = 1; i <= 3; i++) {
    const w = 4.6 + (17 - 4.6) * (i / 4);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(w * 0.72, 0.08, 3, 4), glow);
    ring.rotation.set(Math.PI / 2, 0, 0);
    ring.position.y = -13 * (i / 4);
    group.add(ring);
  }
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.6, 0), new THREE.MeshBasicMaterial({ color: '#e7d4ff', fog: false }));
  core.position.y = -14.2;
  group.add(core);
  core.onBeforeRender = () => {
    const t = performance.now() / 1000;
    core.rotation.y = t;
    core.scale.setScalar(1 + Math.sin(t * 3) * 0.12);
  };
  const seats = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    seats.push({ x: Math.cos(a) * 2.4, y: 0.2, z: Math.sin(a) * 2.4, yaw: -a + Math.PI });
  }
  group.position.set(0, 70, 0);
  return { group, beam: null, seats, hullR: 8, roof: [] };
}

/**
 * The pre-drop platform.
 *
 * `userData.box` is not optional: match.js pushes it into the collision list
 * so the player has a floor to stand on during the lobby, and a missing one
 * drops them through the map before the match has even started.
 */
function buildLobby() {
  const g = new THREE.Group();
  const T = (c, e, i) => new THREE.MeshToonMaterial({ color: c, gradientMap: toonRamp(), emissive: e || '#000', emissiveIntensity: i || 0 });
  const put = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.y = ry;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // Island: grass lip, raked sand, rocky underside.
  put(new THREE.CylinderGeometry(8, 8.6, 0.6, 9), T('#8fd46a'), 0, -0.3, 0);
  put(new THREE.CylinderGeometry(6.2, 6.2, 0.1, 9), T('#f4e6cf'), 0, 0.02, 0);
  for (let r = 1.6; r < 6; r += 0.8) {
    put(new THREE.TorusGeometry(r, 0.04, 3, 36), T('#dcc8a8'), 0, 0.08, 0).rotation.x = Math.PI / 2;
  }
  put(new THREE.ConeGeometry(8.4, 9, 7), T('#b77a5a'), 0, -5.1, 0, 1, 1, 1, 0.3).rotation.x = Math.PI;
  // Rocks, a lantern, one sakura.
  for (const [x, z, s] of [[2.2, 1.4, 1.1], [-2.6, -1.6, 0.8], [-1.2, 2.8, 0.6]]) put(new THREE.DodecahedronGeometry(s, 0), T('#6f6a78'), x, s * 0.4, z);
  put(new THREE.BoxGeometry(0.4, 1.2, 0.4), T('#b9a9c6'), 5, 0.6, -3.5);
  put(new THREE.BoxGeometry(0.7, 0.5, 0.7), T('#fff0d0', '#ffb86a', 1.2), 5, 1.45, -3.5);
  put(new THREE.CylinderGeometry(0.25, 0.4, 2.8, 5), T('#6b3b3b'), -5, 1.4, 3.6);
  for (const [dx, dy, dz, s] of [[0, 3.2, 0, 1.8], [0.9, 2.8, 0.5, 1.3], [-0.8, 3, -0.4, 1.4]]) {
    put(new THREE.IcosahedronGeometry(1, 0), T('#ffb3d4', '#ff9cc6', 0.12), -5 + dx, dy, 3.6 + dz, s * 1.2, s * 0.85, s * 1.2);
  }
  g.position.set(0, 48, 0);
  g.userData.box = makeBox(0, 48 - 0.3, 0, 14, 0.6, 14, 'lobby');
  return g;
}

/**
 * Drop every loot anchor onto whatever surface is actually beneath it.
 *
 * The districts place anchors while they are building, and at that moment the
 * floor under a point is not always the terrain: Sunset Plaza has a raised
 * deck 40cm proud of the grass, Statue Gardens has a paved pad, and the
 * bridges have their own decks. An anchor authored against the terrain alone
 * therefore ends up *inside* the paving -- 63 of them were, by up to 0.4m,
 * which is exactly low enough to hide a loot marker behind a kerb.
 *
 * So rather than hand-tuning every radius against every slab, this runs once
 * at the end and asks `floorAt` -- the same function the player physics uses
 * -- where the ground really is. One source of truth, and it cannot go stale
 * when a district is retuned.
 */
function settleAnchors(anchors, boxes) {
  let moved = 0;
  let refused = 0;
  for (const list of [anchors.chests, anchors.floors, anchors.crystals]) {
    for (const a of list) {
      const y = floorSurface(a.x, a.z, boxes);
      // Anything solid well above the terrain is a roof, not a floor.
      for (const b of boxes) {
        if (a.x <= b.minX - 0.085 || a.x >= b.maxX + 0.085) continue;
        if (a.z <= b.minZ - 0.085 || a.z >= b.maxZ + 0.085) continue;
        if (b.maxY > y + 1.0 && b.minY < y + 1.2) refused++;
      }
      if (a.y == null || Math.abs(a.y - y) > 0.02) moved++;
      a.y = y;
    }
  }
  return { moved, refused };
}

/**
 * The floor a point actually stands on: the terrain, plus a lift for paving.
 *
 * `floorAt` from collision.js returns the single highest box top under a
 * point, which is right for a player standing on a roof and wrong for
 * anything authored at ground level -- given a plaza chest it returns the
 * roof of the building beside it. So the height limit is applied *while*
 * searching: the highest surface within a metre of the terrain is a floor
 * (a deck, a pad, a plinth), and anything higher is a roof.
 *
 * Shared by the settle pass, the deconflict pass and the probe so all three
 * agree on where the ground is. When they disagreed, the deconflict pass
 * treated the plaza's own paving as an obstacle and refused to place a single
 * anchor anywhere on the square.
 */
function floorSurface(x, z, boxes) {
  const terrain = isleHeightAt(x, z);
  let y = terrain;
  for (const b of boxes) {
    if (x <= b.minX - 0.085 || x >= b.maxX + 0.085) continue;
    if (z <= b.minZ - 0.085 || z >= b.maxZ + 0.085) continue;
    if (b.maxY > y && b.maxY - terrain <= 1.0) y = b.maxY;
  }
  return y;
}

/**
 * Nudge any loot anchor that ended up sealed inside geometry.
 *
 * Settling an anchor onto the right floor does not guarantee it is *reachable*
 * -- a chest can sit correctly on the paving and still be inside a market
 * stall, a fountain or the axis-aligned bound of a rotated building. Hand-
 * tuning every ring radius against those bounds is possible and hopeless at
 * the same time: the bounds move whenever a block is nudged, and 36 anchors
 * were sealed at once when the plaza was re-laid out.
 *
 * So this searches instead. From each blocked anchor it walks a short spiral
 * and takes the first spot that is clear and still on dry land. The nudge is
 * capped at 3m, which is close enough that the loot still reads as belonging
 * to the spot it was authored for, and the pass reports how many it had to
 * move so a district that is quietly drowning in loot cannot go unnoticed.
 */
const REACH_STEPS = [0.6, 1.2, 1.8, 2.4, 3.0];

function clearAt(x, y, z, boxes) {
  for (const b of boxes) {
    if (x < b.minX - 0.6 || x > b.maxX + 0.6) continue;
    if (z < b.minZ - 0.6 || z > b.maxZ + 0.6) continue;
    if (b.maxY <= y + 0.35) continue;   // the floor it rests on
    if (b.minY >= y + 1.4) continue;    // a roof well overhead
    return false;
  }
  return true;
}

function deconflictAnchors(anchors, boxes) {
  let moved = 0;
  let homeless = 0;
  for (const list of [anchors.chests, anchors.floors, anchors.crystals]) {
    for (const a of list) {
      if (clearAt(a.x, a.y, a.z, boxes)) continue;
      const ox = a.x;
      const oz = a.z;
      let placed = false;
      for (const step of REACH_STEPS) {
        for (let i = 0; i < 12 && !placed; i++) {
          const ang = (i / 12) * Math.PI * 2;
          const nx = ox + Math.cos(ang) * step;
          const nz = oz + Math.sin(ang) * step;
          if (isleHeightAt(nx, nz) < SEA_Y + 0.1) continue;
          // Keep the district it was authored for: loot drifting into the
          // water or the next district is worse than loot slightly buried.
          const home = BY_ID[a.poi];
          if (home && Math.hypot(nx - home.x, nz - home.z) > home.r * 0.95) continue;
          if (!clearAt(nx, floorSurface(nx, nz, boxes), nz, boxes)) continue;
          a.x = nx;
          a.z = nz;
          placed = true;
        }
        if (placed) break;
      }
      if (placed) moved++;
      else homeless++;
    }
  }
  return { moved, homeless };
}

/* ------------------------------------------------------------------ *
 * Entry point
 *
 * The returned object is the map contract match.js reads. The two that are
 * easy to get wrong:
 *
 *   - `noZone` and `isGraybox` must both be falsy. This map has a real drop
 *     and a real storm, so it takes the full match path. Setting either would
 *     quietly strip the storm out of a map designed around one.
 *   - `progress()` is 1 immediately. There is nothing to stream, and a
 *     loading bar that waits on nothing is just a delay.
 * ------------------------------------------------------------------ */

export function buildSakuraIsle(scene, seed = 7, renderer = null) {
  setTerrain(isleHeightAt);
  const rng = mulberry(seed);
  const boxes = [];
  const group = new THREE.Group();
  scene.add(group);

  const { sky, sun, hemi } = buildSkyAndLight(scene);
  buildTerrain(group);
  buildWater(group);

  // A light probe built from this map's own sky, so nothing in the scene is
  // lit from below and the toon ramp has something to work against. Skipped
  // without a renderer, which is the headless test path.
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(10, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xa8c4e8, side: THREE.BackSide }),
    );
    envScene.add(s);
    const target = pmrem.fromScene(envScene, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.6;
    s.geometry.dispose();
    s.material.dispose();
    pmrem.dispose();
  }

  const B = new Builder(group, boxes);
  buildPlaza(B, rng);
  buildSakura(B, rng);
  buildCrystal(B, rng);
  buildStatue(B, rng);
  buildOasis(B, rng);
  buildTemple(B, rng);
  buildBridges(B);
  B.finish();

  /*
   * Imported environment dressing.
   *
   * Runs *before* the anchor passes below, and that ordering is the whole
   * reason it is here rather than at the end with the other polish. `kit.put`
   * registers a collision box synchronously and loads the mesh
   * asynchronously, so dressing first means `settleAnchors` and
   * `deconflictAnchors` already know about every imported building -- an
   * anchor that ends up inside a restaurant gets nudged out like any other.
   * Dressing last would leave a chest sealed inside a building with nothing
   * left in the pipeline to notice, which is the failure this map's probe
   * exists to catch.
   *
   * Skipped without a renderer, which is the headless path: the pieces are
   * ~87 MB of GLB and node cannot decode them anyway. The placement table is
   * still checked headlessly by tools/probe-dress.mjs, which validates the
   * geometry of every entry against this blockout without loading a mesh.
   */
  const kit = renderer ? createKit(group, boxes) : null;
  if (kit) dressEnvironment(kit, ENV_PLACEMENTS.sakura, (id) => BY_ID[id]);

  const settled = settleAnchors(B.anchors, boxes);
  const nudged = deconflictAnchors(B.anchors, boxes);
  // A nudged anchor moved across sloping ground, so it needs settling again or
  // it ends up hovering over (or sunk into) whatever it landed on.
  if (nudged.moved) settleAnchors(B.anchors, boxes);

  const ufo = buildUfo();
  scene.add(ufo.group);
  const lobby = buildLobby();
  scene.add(lobby);

  return {
    group, boxes, anchors: B.anchors, heightAt: isleHeightAt,
    pois: ISLE_POIS,
    ufo, lobby, sky, sun, hemi,
    /** Same kit chest the island uses, so loot reads identically on both. */
    makeChest: () => buildChest(),
    /**
     * Real-world extent of the imported city block.
     *
     * Null here, but it has to be *present* rather than absent: match.js wraps
     * this as `cityBounds: () => world.cityBounds()` with no guard, so a map
     * that omits the key throws a TypeError the first time anything asks. The
     * render harness asks, to frame its inspection cameras, so omitting it
     * broke the map review outright.
     */
    cityBounds: () => null,
    /**
     * Loading progress for the imported dressing, 0..1.
     *
     * This map used to answer a flat 1 -- "no assets, nothing to lie about" --
     * and that was true while it was a pure blockout. It is not true any more:
     * the plaza alone streams 41 MB of Japanese street, and a loading bar that
     * claims 100% while 41 MB is in flight is exactly the lie the old comment
     * was written to avoid.
     *
     * Still 1 on the headless path, where there is no kit and nothing streams,
     * which keeps `probe-sakura`'s "a map with no assets must report full
     * progress" assertion meaningful rather than merely passing.
     */
    progress: () => (kit ? kit.progress() : 1),
    ready: () => (kit ? kit.settled() : Promise.resolve()),
    /**
     * Wading. The oasis pool is the one place on this map you fight in
     * water, and it is deliberately the slowest ground on the isle.
     */
    slowAt(x, z) {
      return isleHeightAt(x, z) < SEA_Y + 0.5;
    },
    /** How many anchors the settle pass had to lift onto their real floor. */
    settledAnchors: settled,
    /** How many sealed anchors the deconflict pass had to nudge, and any it could not free. */
    nudgedAnchors: nudged,
  };
}
