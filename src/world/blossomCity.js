import * as THREE from 'three';
import { makeBox } from '../game/collision.js';
import { setTerrain, buildChest, createKit, SEA_Y } from './map.js';
import { ENVIRONMENT_GLB } from '../data/assets.js';
import { buildUfo, buildLobby } from './sakuraIsle.js';

/**
 * Blossom City: one continuous landmass, six large districts.
 *
 * A 430 m coastline with a river cutting through it, six points of interest
 * of roughly 35 m radius each (enough loot and cover for a squad of five or
 * six to land and gear up without stepping on each other), joined by roads and
 * bridges, with cherry-blossom groves in between. Buildings and landmarks are
 * the imported GLBs; the ground is a vertex-coloured toon mesh that samples
 * the same height function the collision uses.
 */

const S = 0.88;
export const CITY_R = 205 * S;
const BED = -6;
const ROAD_H = 1.6;

const HF = (n) => `/assets/hf/${n}.glb`;
const LITE = (n) => `/assets/env-lite/${n}.glb`;
const URLS = {
  restaurant: LITE('japanese_restaurant'),
  izakaya: LITE('japanese_restaurant_inakaya'),
  shrine: LITE('japanese_shrine'),
  vending: LITE('jpn_vending_machine'),
  neonSign: LITE('japanese_neon_street_sign'),
  pinkTree: LITE('big_pink_tree'),
  tree: ENVIRONMENT_GLB.tree,
  lantern: HF('lantern'), torii: HF('torii'), sakura: HF('sakura'), tower: HF('cyberpagoda'),
  stall: HF('stall'), bamboo: HF('bamboo'), bridge: HF('bridge'), kiosk: HF('kiosk'), machiya: HF('machiya'),
};

export const CITY_POIS = [
  { id: 'downtown', name: 'Neon Downtown', x: 0, z: 0, r: 40, h: 1.6, color: '#e58fa8' },
  { id: 'village', name: 'Sakura Village', x: -118 * S, z: -78 * S, r: 36, h: 2.2, color: '#f3bccb' },
  { id: 'temple', name: 'Celestial Temple', x: 12 * S, z: -150 * S, r: 34, h: 13, color: '#e9d3a1' },
  { id: 'harbor', name: 'Harbor Market', x: 128 * S, z: -52 * S, r: 36, h: 1.4, color: '#c9a45a' },
  { id: 'gardens', name: 'Moon Gardens', x: -108 * S, z: 88 * S, r: 36, h: 1.8, color: '#b98fa1' },
  { id: 'station', name: 'Skyline Station', x: 118 * S, z: 92 * S, r: 36, h: 1.6, color: '#8fd3ff' },
];
const BY_ID = Object.fromEntries(CITY_POIS.map((p) => [p.id, p]));

const RIVER = [[-215, 15], [-150, 6], [-96, 8], [-60, -8], [-48, -50], [-40, -95], [-26, -140], [-16, -215]].map(([x, z]) => [x * S, z * S]);
const RIVER_W = 8;
const ROADS = [
  ['downtown', 'village'], ['downtown', 'temple'], ['downtown', 'harbor'], ['downtown', 'gardens'], ['downtown', 'station'],
  ['village', 'temple'], ['village', 'gardens'], ['harbor', 'station'],
];
const ROAD_W = 5;

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
function riverDist(x, z) {
  let d = 1e9;
  for (let i = 0; i < RIVER.length - 1; i++) d = Math.min(d, segDist(x, z, RIVER[i][0], RIVER[i][1], RIVER[i + 1][0], RIVER[i + 1][1]));
  return d;
}
function roadDist(x, z) {
  let d = 1e9;
  for (const [a, b] of ROADS) d = Math.min(d, segDist(x, z, BY_ID[a].x, BY_ID[a].z, BY_ID[b].x, BY_ID[b].z));
  return d;
}

/** Signed distance to the coast: positive on land. */
function coast(x, z) {
  const r = Math.hypot(x, z);
  const a = Math.atan2(z, x);
  const edge = CITY_R + 9 * Math.sin(a * 3 + 1) + 6 * Math.sin(a * 7 + 2) + 4 * Math.sin(a * 13 + 0.5);
  return edge - r;
}

export function cityHeightAt(x, z) {
  const d = coast(x, z);
  const land = smoothstep(-8, 14, d);
  let h = lerp(BED, ROAD_H, land);
  const inland = smoothstep(10, 40, d);
  h += (2.4 * Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017) + 1.5 * Math.sin(x * 0.043 + z * 0.05)) * inland;
  // Flatten each district onto its own plateau.
  for (const p of CITY_POIS) {
    const dist = Math.hypot(x - p.x, z - p.z) / p.r;
    if (dist > 1.5) continue;
    const t = 1 - smoothstep(0.75, 1.35, dist);
    h = lerp(h, p.h, t);
  }
  // Temple mound: a proper hill under the temple.
  const bt = BY_ID.temple;
  const dt = Math.hypot(x - bt.x, z - bt.z);
  h += 11 * (1 - smoothstep(6, 46, dt)) * (dt < 46 ? 1 : 0) * 0.45;
  // The river carves a channel below the waterline.
  const rd = riverDist(x, z);
  if (rd < RIVER_W + 6) {
    const c = 1 - smoothstep(RIVER_W * 0.55, RIVER_W + 5, rd);
    h = lerp(h, -3.6, c);
  }
  return h;
}

const RAMP = (() => {
  const steps = new Uint8Array([70, 140, 205, 255]);
  const t = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
})();

function buildTerrain(parent) {
  const SPAN = 470;
  const GRID = 236;
  const step = SPAN / (GRID - 1);
  const half = SPAN / 2;
  const pos = new Float32Array(GRID * GRID * 3);
  const col = new Float32Array(GRID * GRID * 3);
  const idx = new Uint32Array((GRID - 1) * (GRID - 1) * 6);
  const grass = new THREE.Color('#79bf68');
  const grass2 = new THREE.Color('#9ad07a');
  const sand = new THREE.Color('#ecd9a9');
  const bed = new THREE.Color('#3b7f93');
  const road = new THREE.Color('#d7c4a0');
  const paved = new THREE.Color('#6d6a7c');
  const petal = new THREE.Color('#f4bcd2');
  const dirt = new THREE.Color('#b89a72');
  const tmp = new THREE.Color();
  let v = 0;
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = -half + i * step;
      const z = -half + j * step;
      const y = cityHeightAt(x, z);
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
      const n = 0.5 + 0.5 * Math.sin(x * 0.11) * Math.cos(z * 0.09);
      tmp.copy(grass).lerp(grass2, n);
      if (y < SEA_Y - 0.3) tmp.copy(sand).lerp(bed, Math.min(1, (SEA_Y - 0.3 - y) / 3.5));
      else if (y < SEA_Y + 1.1) tmp.copy(sand);
      else {
        // Blossom-petal carpet under the village and the gardens, dirt on the temple hill.
        const pv = Math.hypot(x - BY_ID.village.x, z - BY_ID.village.z);
        const pg = Math.hypot(x - BY_ID.gardens.x, z - BY_ID.gardens.z);
        const pt = Math.hypot(x - BY_ID.temple.x, z - BY_ID.temple.z);
        const pd = Math.hypot(x, z);
        const petalK = Math.max(1 - smoothstep(14, 46, pv), 0.7 * (1 - smoothstep(14, 44, pg)));
        if (petalK > 0) tmp.lerp(petal, petalK * (0.5 + 0.5 * n));
        if (pt < 40) tmp.lerp(dirt, 0.55 * (1 - smoothstep(20, 40, pt)));
        if (pd < 36) tmp.lerp(paved, 0.85 * (1 - smoothstep(24, 36, pd)));
        const rr = roadDist(x, z);
        if (rr < ROAD_W * 0.6 + 1.5) tmp.lerp(road, 1 - smoothstep(ROAD_W * 0.5, ROAD_W * 0.5 + 2, rr));
      }
      col[v * 3] = tmp.r; col[v * 3 + 1] = tmp.g; col[v * 3 + 2] = tmp.b;
      v++;
    }
  }
  let t = 0;
  for (let j = 0; j < GRID - 1; j++) {
    for (let i = 0; i < GRID - 1; i++) {
      const a = j * GRID + i;
      const b = a + GRID;
      idx[t++] = a; idx[t++] = b; idx[t++] = a + 1;
      idx[t++] = a + 1; idx[t++] = b; idx[t++] = b + 1;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: RAMP }));
  mesh.name = 'isle-terrain';
  mesh.receiveShadow = true;
  parent.add(mesh);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x4fb6cf, transparent: true, opacity: 0.78, depthWrite: false }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = SEA_Y;
  water.name = 'isle-water';
  water.renderOrder = 1;
  parent.add(water);
}

function buildSky(scene) {
  scene.background = null;
  scene.fog = new THREE.Fog(0xb98a9c, 90, 340);
  const hemi = new THREE.HemisphereLight(0xf2c9d6, 0x3a2f45, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd7a8, 1.4);
  sun.position.set(90, 70, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 320;
  sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);
  scene.add(sun.target);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
    uniforms: { top: { value: new THREE.Color('#141428') }, mid: { value: new THREE.Color('#6a3f62') }, horizon: { value: new THREE.Color('#f0b3a8') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 horizon;
      void main(){ float h = normalize(vP).y; vec3 c = mix(horizon, mid, smoothstep(-0.02, 0.28, h)); c = mix(c, top, smoothstep(0.18, 0.8, h)); gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 16), skyMat);
  sky.name = 'isle-sky';
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  scene.add(sky);
  return { sky, sun, hemi };
}

/* ------------------------------------------------------------------ *
 * Placement
 * ------------------------------------------------------------------ */

export function buildBlossomCity(scene, seed = 5, renderer = null) {
  setTerrain(cityHeightAt);
  const rng = mulberry(seed);
  const boxes = [];
  const group = new THREE.Group();
  scene.add(group);
  const { sky, sun, hemi } = buildSky(scene);
  buildTerrain(group);
  const kit = renderer ? createKit(group, boxes) : null;
  const anchors = { chests: [], floors: [], crystals: [], drops: [] };
  const instances = {};
  // Reference size each model is prepared at; instances scale from it.
  const NOMINAL = { tower: 30, sakura: 12, pinkTree: 9, tree: 10, lantern: 2.2, torii: 7.5, bamboo: 7, kiosk: 2.4, neonSign: 6, vending: 1.9, machiya: 9, izakaya: 12, restaurant: 15, stall: 4.4, shrine: 13, bridge: 16 };
  const HEIGHT_KEYS = new Set(['tower', 'sakura', 'pinkTree', 'tree', 'lantern', 'torii', 'bamboo', 'kiosk', 'neonSign', 'vending', 'shrine']);
  const SHADOW_KEYS = new Set(['tower', 'machiya', 'restaurant', 'izakaya', 'shrine']);
  const trunkBoxes = [];

  const aabb = (w, d, rot) => {
    const c = Math.abs(Math.cos(rot)); const s = Math.abs(Math.sin(rot));
    return [w * c + d * s, w * s + d * c];
  };

  /**
   * Place a model. `box` is [w, h, d] of its collision in the model's own axes
   * (rotated into world space here). Collision is pushed even headless.
   */
  function put(key, x, z, o = {}) {
    const rot = o.rot ?? 0;
    const y = o.y ?? cityHeightAt(x, z);
    if (o.box) {
      const [w, h, d] = o.box;
      const [bw, bd] = aabb(w, d, rot);
      boxes.push(makeBox(x, y + h / 2, z, bw, h, bd, o.tag || 'solid'));
    }
    if (kit && URLS[key]) {
      // Everything repeated is drawn as one InstancedMesh per sub-mesh, flushed at the end.
      const nominal = o.height ? o.height : (o.size || 4);
      const g = (instances[key] ||= { byHeight: !!o.height, nominal: NOMINAL[key] ?? nominal, items: [] });
      g.items.push({ x, y, z, rot, scale: nominal / g.nominal });
    }
  }

  const blockedAt = (x, z, r = 1.4) => {
    for (const b of boxes) {
      if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return true;
    }
    return false;
  };
  const onLand = (x, z, minY = -0.4) => cityHeightAt(x, z) > minY;

  /** A free, dry spot near (cx, cz) for loot, found by spiralling out. */
  function freeSpot(cx, cz, spread = 0) {
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2;
      const r = spread * Math.sqrt(rng()) + i * 0.6;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (onLand(x, z) && !blockedAt(x, z)) return { x, z };
    }
    return null;
  }
  function loot(kind, cx, cz, spread, poi) {
    const s = freeSpot(cx, cz, spread);
    if (!s) return;
    anchors[kind].push({ x: s.x, y: cityHeightAt(s.x, s.z), z: s.z, poi, ...(kind === 'crystals' ? { kind: ['speed', 'jump', 'shield'][Math.floor(rng() * 3)] } : {}) });
  }

  /* ---- landmarks per district ---- */
  const at = (p, dx, dz) => [p.x + dx, p.z + dz];

  // --- Neon Downtown: towers, a restaurant row, the town block, kiosks ---
  {
    const p = BY_ID.downtown;
    for (const [dx, dz, rot] of [[-26, -26, 0.4], [26, -26, -0.4], [-26, 26, 2.7], [26, 26, 3.5]]) {
      put('tower', ...at(p, dx, dz), { rot, height: 30, box: [10, 30, 12] });
    }
    put('restaurant', ...at(p, -6, -30), { rot: 0, size: 15, box: [15, 9, 11] });
    put('restaurant', ...at(p, 8, 31), { rot: Math.PI, size: 15, box: [15, 9, 11] });
    for (const [dx, dz, rot] of [[-34, 4, 0], [34, -3, Math.PI], [-12, 12, 0], [14, -14, Math.PI], [0, 19, Math.PI / 2], [-4, -19, -Math.PI / 2]]) {
      put('machiya', ...at(p, dx, dz), { rot, size: 9, box: [7.5, 7, 7.5] });
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      put('kiosk', p.x + Math.cos(a) * 9, p.z + Math.sin(a) * 9, { rot: -a, height: 2.4, box: [1.4, 2.4, 1.4] });
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5;
      put('neonSign', p.x + Math.cos(a) * 17, p.z + Math.sin(a) * 17, { rot: -a + Math.PI / 2, height: 6 });
    }
    for (let i = 0; i < 6; i++) put('vending', p.x + Math.cos(i + 0.3) * 21, p.z + Math.sin(i + 0.3) * 21, { rot: i, height: 1.9, box: [1, 1.9, 0.9] });
  }

  // --- Sakura Village: machiya lanes, blossoms, lanterns, a shrine ---
  {
    const p = BY_ID.village;
    let n = 0;
    for (const [dx, dz] of [[-16, -12], [0, -14], [16, -10], [-18, 8], [-2, 12], [16, 12]]) {
      put('machiya', ...at(p, dx, dz), { rot: (n++ % 2) * Math.PI + (dz > 0 ? Math.PI : 0), size: 9.5, box: [8, 7, 8] });
    }
    put('izakaya', ...at(p, -26, -2), { rot: Math.PI / 2, size: 12, box: [12, 5.5, 7.5] });
    put('shrine', ...at(p, 28, 0), { rot: -Math.PI / 2, height: 13, box: [5, 13, 5] });
    put('torii', ...at(p, 22, 0), { rot: Math.PI / 2, height: 7.5 });
    boxes.push(makeBox(p.x + 22, cityHeightAt(p.x + 22, p.z - 3) + 3.5, p.z - 3, 0.9, 7, 0.9, 'solid'));
    boxes.push(makeBox(p.x + 22, cityHeightAt(p.x + 22, p.z + 3) + 3.5, p.z + 3, 0.9, 7, 0.9, 'solid'));
    for (let i = 0; i < 12; i++) put('lantern', p.x - 24 + i * 4.4, p.z + (i % 2 ? 3 : -3), { height: 2.2 });
    for (let i = 0; i < 9; i++) {
      const a = rng() * Math.PI * 2; const r = 8 + rng() * 26;
      put('sakura', p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, { rot: rng() * 6, height: 11 + rng() * 3, box: [1.4, 6, 1.4] });
    }
  }

  // --- Celestial Temple: a hill crowned by the shrine, torii stairway ---
  {
    const p = BY_ID.temple;
    put('shrine', ...at(p, 0, -6), { rot: 0, height: 17, box: [6, 17, 6] });
    for (let i = 0; i < 4; i++) put('torii', p.x, p.z + 8 + i * 8, { rot: 0, height: 8.5 - i * 0.6 });
    for (let i = 0; i < 4; i++) {
      for (const s of [-1, 1]) boxes.push(makeBox(p.x + s * 3.4, cityHeightAt(p.x, p.z + 8 + i * 8) + 4, p.z + 8 + i * 8, 0.9, 8, 0.9, 'solid'));
    }
    put('machiya', ...at(p, -18, 4), { rot: 0.3, size: 10, box: [8.5, 7, 8.5] });
    put('machiya', ...at(p, 18, 5), { rot: -0.3, size: 10, box: [8.5, 7, 8.5] });
    put('izakaya', ...at(p, 0, -24), { rot: Math.PI / 2, size: 13, box: [13, 5.6, 8] });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      put('lantern', p.x + Math.cos(a) * 24, p.z + Math.sin(a) * 24, { height: 2.4 });
    }
    for (let i = 0; i < 6; i++) put('sakura', p.x + Math.cos(i * 1.05 + 0.4) * 29, p.z + Math.sin(i * 1.05 + 0.4) * 29, { rot: i, height: 12, box: [1.4, 6, 1.4] });
  }

  // --- Harbor Market: waterfront stalls, restaurants, neon ---
  {
    const p = BY_ID.harbor;
    put('restaurant', ...at(p, -14, -14), { rot: 0.2, size: 15, box: [15, 9, 11] });
    put('restaurant', ...at(p, 14, 14), { rot: Math.PI + 0.2, size: 15, box: [15, 9, 11] });
    put('izakaya', ...at(p, 20, -12), { rot: 0, size: 12, box: [7.5, 5.6, 12] });
    put('izakaya', ...at(p, -20, 14), { rot: 0, size: 12, box: [7.5, 5.6, 12] });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      put('stall', p.x + Math.cos(a) * 9.5, p.z + Math.sin(a) * 9.5, { rot: -a + Math.PI / 2, size: 4.4, box: [3.4, 1.5, 4] });
    }
    for (let i = 0; i < 6; i++) put('neonSign', p.x + Math.cos(i * 1.05) * 27, p.z + Math.sin(i * 1.05) * 27, { rot: i, height: 6 });
    for (let i = 0; i < 6; i++) put('kiosk', p.x + Math.cos(i * 1.05 + 0.5) * 19, p.z + Math.sin(i * 1.05 + 0.5) * 19, { rot: i, height: 2.4, box: [1.4, 2.4, 1.4] });
  }

  // --- Moon Gardens: bamboo, lanterns, tea houses, a pond bridge ---
  {
    const p = BY_ID.gardens;
    for (let c = 0; c < 9; c++) {
      const a = (c / 9) * Math.PI * 2 + 0.3;
      for (let k = 0; k < 6; k++) {
        put('bamboo', p.x + Math.cos(a) * 26 + (rng() - 0.5) * 6, p.z + Math.sin(a) * 26 + (rng() - 0.5) * 6, { height: 5 + rng() * 3 });
      }
    }
    put('machiya', ...at(p, -14, -10), { rot: 0.4, size: 10, box: [8.5, 7, 8.5] });
    put('machiya', ...at(p, 14, -12), { rot: -0.4, size: 10, box: [8.5, 7, 8.5] });
    put('izakaya', ...at(p, 0, 22), { rot: Math.PI / 2, size: 13, box: [13, 5.6, 8] });
    put('shrine', ...at(p, 0, -24), { rot: 0, height: 12, box: [5, 12, 5] });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      put('lantern', p.x + Math.cos(a) * 15, p.z + Math.sin(a) * 15, { height: 2.2 });
    }
    for (let i = 0; i < 8; i++) put('sakura', p.x + Math.cos(i * 0.785 + 0.2) * 20, p.z + Math.sin(i * 0.785 + 0.2) * 20, { rot: i, height: 11, box: [1.4, 6, 1.4] });
  }

  // --- Skyline Station: the cyber terminal, towers, vending ---
  {
    const p = BY_ID.station;
    put('tower', ...at(p, 0, 0), { rot: 0, height: 46, box: [15, 46, 18] });
    put('tower', ...at(p, -24, -20), { rot: 0.6, height: 30, box: [9.5, 30, 12] });
    put('tower', ...at(p, 26, 22), { rot: 2.2, height: 30, box: [9.5, 30, 12] });
    put('machiya', ...at(p, 22, -22), { rot: 0.5, size: 9, box: [7.5, 7, 7.5] });
    put('machiya', ...at(p, -22, 24), { rot: 3.6, size: 9, box: [7.5, 7, 7.5] });
    put('restaurant', ...at(p, -16, 20), { rot: 0, size: 14, box: [14, 8.5, 10.5] });
    put('izakaya', ...at(p, 24, -14), { rot: 0, size: 12, box: [7.5, 5.6, 12] });
    for (let i = 0; i < 8; i++) put('vending', p.x + Math.cos(i * 0.8) * 17, p.z + Math.sin(i * 0.8) * 17, { rot: i, height: 1.9, box: [1, 1.9, 0.9] });
    for (let i = 0; i < 6; i++) put('neonSign', p.x + Math.cos(i * 1.05 + 0.4) * 28, p.z + Math.sin(i * 1.05 + 0.4) * 28, { rot: i, height: 6 });
  }

  /* ---- bridges where roads meet the river ---- */
  for (const [a, b] of ROADS) {
    const A = BY_ID[a]; const Bp = BY_ID[b];
    const len = Math.hypot(Bp.x - A.x, Bp.z - A.z);
    let first = -1; let last = -1;
    for (let s = 0; s <= len; s += 1) {
      const t = s / len;
      const x = lerp(A.x, Bp.x, t); const z = lerp(A.z, Bp.z, t);
      if (riverDist(x, z) < RIVER_W * 0.9) { if (first < 0) first = s; last = s; }
    }
    if (first < 0) continue;
    const mid = (first + last) / 2 / len;
    const x = lerp(A.x, Bp.x, mid); const z = lerp(A.z, Bp.z, mid);
    const rot = -Math.atan2(Bp.z - A.z, Bp.x - A.x);
    const span = (last - first) + 10;
    const bank = ROAD_H;
    // A flat, walkable deck under the arch.
    put('bridge', x, z, { rot, y: bank, size: span, box: [span, 0.55, 4.6], tag: 'solid' });
  }

  /* ---- groves between districts ---- */
  const nearPoi = (x, z, pad = 6) => CITY_POIS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + pad);
  let placedTrees = 0;
  for (let i = 0; i < 900 && placedTrees < 130; i++) {
    const a = rng() * Math.PI * 2; const r = Math.sqrt(rng()) * (CITY_R - 12);
    const x = Math.cos(a) * r; const z = Math.sin(a) * r;
    if (!onLand(x, z, 0.4) || nearPoi(x, z) || roadDist(x, z) < 5 || riverDist(x, z) < RIVER_W + 4) continue;
    const pick = rng();
    if (pick < 0.45) put('sakura', x, z, { rot: rng() * 6, height: 10 + rng() * 5, box: [1.4, 6, 1.4] });
    else if (pick < 0.75) put('pinkTree', x, z, { rot: rng() * 6, height: 8 + rng() * 4, box: [1.2, 5, 1.2] });
    else put('tree', x, z, { rot: rng() * 6, height: 9 + rng() * 4, box: [1.2, 5, 1.2] });
    placedTrees++;
  }
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2; const r = Math.sqrt(rng()) * (CITY_R - 14);
    const x = Math.cos(a) * r; const z = Math.sin(a) * r;
    if (!onLand(x, z, 0.4) || nearPoi(x, z, 2) || roadDist(x, z) < 3) continue;
    put('lantern', x, z, { height: 2.2 });
  }
  // A torii on every road as it leaves a district.
  for (const [a, b] of ROADS) {
    const A = BY_ID[a]; const Bp = BY_ID[b];
    const dx = Bp.x - A.x; const dz = Bp.z - A.z; const len = Math.hypot(dx, dz);
    for (const [P, sgn] of [[A, 1], [Bp, -1]]) {
      const t = (P.r + 4) / len;
      const x = P === A ? A.x + dx * t : Bp.x - dx * t;
      const z = P === A ? A.z + dz * t : Bp.z - dz * t;
      if (riverDist(x, z) < RIVER_W + 3 || !onLand(x, z)) continue;
      put('torii', x, z, { rot: -Math.atan2(dz, dx) + Math.PI / 2, height: 7 });
      void sgn;
    }
  }

  /* ---- loot: enough per district for a squad of five or six ---- */
  for (const p of CITY_POIS) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + rng() * 0.5;
      loot('chests', p.x + Math.cos(a) * (12 + rng() * 14), p.z + Math.sin(a) * (12 + rng() * 14), 4, p.id);
    }
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2; const r = 5 + rng() * (p.r - 6);
      loot('floors', p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, 3, p.id);
    }
    loot('crystals', p.x, p.z, 10, p.id);
  }
  for (let i = 0; i < 10; i++) {
    const a = rng() * Math.PI * 2; const r = Math.sqrt(rng()) * (CITY_R * 0.8);
    const s = freeSpot(Math.cos(a) * r, Math.sin(a) * r, 4);
    if (s && onLand(s.x, s.z, 0.5)) anchors.drops.push({ x: s.x, y: cityHeightAt(s.x, s.z), z: s.z });
  }

  const _m4 = new THREE.Matrix4(); const _q = new THREE.Quaternion(); const _s = new THREE.Vector3(); const _p = new THREE.Vector3(); const _e = new THREE.Euler();
  if (kit) {
    for (const [key, g] of Object.entries(instances)) {
      const opts = HEIGHT_KEYS.has(key) ? { height: g.nominal, up: 'y' } : { size: g.nominal, up: 'y' };
      kit.proto(URLS[key], opts).then((proto) => {
        if (!proto) return;
        proto.updateMatrixWorld(true);
        const subs = [];
        proto.traverse((m) => { if (m.isMesh) subs.push(m); });
        // Bucket into 70 m cells so frustum culling still works on instanced groups.
        const cells = new Map();
        for (const it of g.items) {
          const k = `${Math.floor(it.x / 70)},${Math.floor(it.z / 70)}`;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(it);
        }
        for (const m of subs) {
          for (const items of cells.values()) {
            const im = new THREE.InstancedMesh(m.geometry, m.material, items.length);
            items.forEach((it, i) => {
              _e.set(0, it.rot, 0);
              _q.setFromEuler(_e);
              _s.setScalar(it.scale);
              _p.set(it.x, it.y, it.z);
              _m4.compose(_p, _q, _s).multiply(m.matrixWorld);
              im.setMatrixAt(i, _m4);
            });
            im.instanceMatrix.needsUpdate = true;
            im.computeBoundingSphere();
            im.castShadow = SHADOW_KEYS.has(key);
            im.receiveShadow = true;
            group.add(im);
          }
        }
      });
    }
  }

  const ufo = buildUfo();
  scene.add(ufo.group);
  const lobby = buildLobby();
  scene.add(lobby);
  void trunkBoxes;

  return {
    group, boxes, anchors, heightAt: cityHeightAt,
    pois: CITY_POIS, ufo, lobby, sky, sun, hemi,
    makeChest: () => buildChest(),
    cityBounds: () => null,
    progress: () => (kit ? kit.progress() : 1),
    ready: () => (kit ? kit.settled() : Promise.resolve()),
    slowAt: (x, z) => cityHeightAt(x, z) < SEA_Y + 0.5,
    followSun: true,
    /** Match tuning for a map this size; read by match.js. */
    profile: {
      zoneR: 205 * S, zoneCenter: [0, 0], zoneJitter: 50, oceanR: 232 * S, mapR: 245 * S,
      busTime: 24, planScale: 2.9, shrinkScale: 1.5, botPoiSpread: 26,
      bus: (u) => ({ x: (-235 + 470 * u) * S, y: 128 + Math.sin(u * Math.PI) * 10, z: (120 - 240 * u) * S }),
    },
  };
}
