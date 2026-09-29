import * as THREE from 'three';
import { POIS } from '../data/catalog.js';
import { makeBox } from '../game/collision.js';
import {
  createKit, buildUfo, buildLobby, buildChest, mulberry, gradient, smoothstep, radialDisc,
  setTerrain, heightAt, SEA_Y,
} from './map.js';

/**
 * Sakura Isle: the default battle royale map.
 *
 * Six districts laid out like the key art, north (-z) at the top:
 *
 *   Sakura Village      Celestial Temple      Crystal Caverns
 *               (lake)   Sunset Plaza   (crash crater)
 *   Statue Gardens          (river)           Alien Oasis
 *
 * Everything is procedural low-poly geometry: flat-shaded terrain with painted
 * vertex colour, toon materials on a 4-step ramp, and inverted-hull ink lines
 * on every landmark, so it reads as a hand-drawn cel frame from any angle.
 */

const P = Object.fromEntries(POIS.map((p) => [p.id, p]));
const EDGE_R = 64;

// ---------------------------------------------------------------- terrain --

/** A flat-topped mesa with a short cliff band. */
function mesa(x, z, cx, cz, r, h, soft = 5) {
  const d = Math.hypot(x - cx, z - cz);
  return h * smoothstep(r + soft, r, d);
}

/** Distance from (x, z) to segment ab. */
function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

// River: from the west lake, bending under the plaza, out through the south.
const RIVER = [[-50, -8], [-30, 8], [-12, 16], [-2, 30], [4, 46], [2, 70]];
const LAKE = { x: -42, z: -8, r: 11 };
const CRATER = { x: 30, z: 2 };

function riverDist(x, z) {
  let d = Infinity;
  for (let i = 0; i < RIVER.length - 1; i++) {
    d = Math.min(d, segDist(x, z, RIVER[i][0], RIVER[i][1], RIVER[i + 1][0], RIVER[i + 1][1]));
  }
  return d;
}

function sakuraHeightAt(x, z) {
  const r = Math.hypot(x, z);
  // Rolling meadow base.
  let h = 1.2 + Math.sin(x * 0.11) * Math.cos(z * 0.09) * 0.6;
  // District plateaus. Max rather than sum so each top stays flat.
  h = Math.max(h, mesa(x, z, P.plaza.x, P.plaza.z, 15, 2.6));
  h = Math.max(h, mesa(x, z, P.village.x, P.village.z, 14, 3.8, 4));
  h = Math.max(h, mesa(x, z, P.temple.x, P.temple.z + 2, 11, 9.5, 3));
  h = Math.max(h, mesa(x, z, P.caverns.x, P.caverns.z, 15, 4.6, 4));
  h = Math.max(h, mesa(x, z, P.gardens.x, P.gardens.z, 14, 2.4));
  h = Math.max(h, mesa(x, z, P.oasis.x, P.oasis.z, 13, 1.8));
  // Temple approach: a straight ramp climbing north out of the plaza.
  if (Math.abs(x) < 4.5 && z < -12 && z > -34) {
    const t = (-12 - z) / 22;
    const ramp = 2.6 + t * 6.9;
    h = Math.max(h, ramp * smoothstep(4.5, 3.2, Math.abs(x)) + h * (1 - smoothstep(4.5, 3.2, Math.abs(x))));
  }
  // Village terrace ramp down to the lake shore.
  // Crash crater: rim then bowl.
  const cd = Math.hypot(x - CRATER.x, z - CRATER.z);
  h += Math.exp(-((cd - 9) ** 2) / 8) * 1.6;
  h -= smoothstep(9, 2, cd) * 3.0;
  // Water cuts.
  const rd = riverDist(x, z);
  h = h * smoothstep(3.5, 7, rd) + (SEA_Y - 1.4) * (1 - smoothstep(3.5, 7, rd));
  const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
  h = h * smoothstep(LAKE.r - 2, LAKE.r + 3, ld) + (SEA_Y - 1.8) * (1 - smoothstep(LAKE.r - 2, LAKE.r + 3, ld));
  // Coastline, then a shelf.
  const coast = smoothstep(EDGE_R, EDGE_R - 10, r);
  const shelf = -8 - smoothstep(EDGE_R, EDGE_R + 60, r) * 14;
  return h * coast + shelf * (1 - coast);
}

// -------------------------------------------------------------- materials --

const INK = new THREE.MeshBasicMaterial({ color: 0x2a1530, side: THREE.BackSide, fog: true });
const MATS = new Map();
function toon(color, emissive = null, intensity = 0) {
  const key = `${color}|${emissive}|${intensity}`;
  if (!MATS.has(key)) {
    MATS.set(key, new THREE.MeshToonMaterial({
      color, gradientMap: gradient(), flatShading: true,
      emissive: emissive || new THREE.Color(color).multiplyScalar(0.1), emissiveIntensity: emissive ? intensity : 1,
    }));
  }
  return MATS.get(key);
}

const PAL = {
  wood: '#8a4a36', woodDark: '#5a2e2c', plaster: '#fbe7d2', roof: '#4b3a6b', roofRed: '#b24a4a',
  stone: '#efe7f2', stoneDark: '#b9a9c6', gold: '#ffc94d', grass: '#8fd46a', trunk: '#6b3b3b',
  blossom: ['#ffb3d4', '#ff9cc6', '#ffc7e0', '#f58bbd'], crystal: ['#9b7bff', '#6fb8ff', '#c79bff', '#7ae8ff'],
};

// ----------------------------------------------------------------- builder --

export function buildSakura(scene, seed = 11, renderer = null) {
  setTerrain(sakuraHeightAt);
  const rng = mulberry(seed);
  const boxes = [];
  const group = new THREE.Group();
  scene.add(group);
  const anchors = { chests: [], floors: [], crystals: [], drops: [] };
  const animated = [];
  const clock = { t: 0 };

  /** Add a mesh with an ink outline and optional collision. */
  function add(geo, mat, x, y, z, { rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, ink = 0.05, box = null, parent = group, shadow = true } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.scale.set(sx, sy, sz);
    m.castShadow = shadow;
    m.receiveShadow = true;
    if (ink) {
      const o = new THREE.Mesh(geo, INK);
      o.scale.setScalar(1 + ink);
      m.add(o);
    }
    parent.add(m);
    if (box) boxes.push(makeBox(x, box.y ?? y, z, box.w, box.h, box.d, box.tag));
    return m;
  }
  const G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    roof4: new THREE.ConeGeometry(0.72, 1, 4, 1).rotateY(Math.PI / 4),
    cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
    cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    cone5: new THREE.ConeGeometry(0.5, 1, 5),
    cone6: new THREE.ConeGeometry(0.5, 1, 6),
    oct: new THREE.OctahedronGeometry(0.5, 0),
    ico: new THREE.IcosahedronGeometry(0.5, 0),
    dome: new THREE.SphereGeometry(0.5, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    disc: new THREE.CylinderGeometry(0.5, 0.5, 0.1, 10),
    torus: new THREE.TorusGeometry(0.5, 0.12, 5, 12),
  };
  const gy = (x, z) => heightAt(x, z);

  // ------------------------------------------------------------- sky + light
  scene.background = null;
  scene.fog = new THREE.Fog(0xffc2a8, 130, 460);
  scene.add(new THREE.HemisphereLight(0xffd0e8, 0x5a7a4a, 0.9));
  const sun = new THREE.DirectionalLight(0xffe2c0, 1.5);
  sun.position.set(-30, 70, -90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { near: 10, far: 260, left: -85, right: 85, top: 85, bottom: -85 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(0xb9a0ff, 0.45);
  rim.position.set(60, 30, 80);
  scene.add(rim);

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: {
      top: { value: new THREE.Color('#6b5bd6') }, mid: { value: new THREE.Color('#ff8fb4') },
      horizon: { value: new THREE.Color('#ffc07a') }, sunDir: { value: new THREE.Vector3(0, 0.08, -1).normalize() },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top, mid, horizon, sunDir;
      void main(){
        vec3 d = normalize(vP); float h = d.y;
        vec3 c = mix(horizon, mid, smoothstep(-0.02, 0.22, h));
        c = mix(c, top, smoothstep(0.2, 0.75, h));
        float s = max(dot(d, sunDir), 0.0);
        c += vec3(1.0, 0.75, 0.4) * pow(s, 24.0) * 0.8 + vec3(1.0, 0.9, 0.7) * step(0.9975, s);
        // painted cloud bands
        float band = sin(d.x * 9.0 + d.z * 4.0) * 0.5 + 0.5;
        float cl = smoothstep(0.62, 0.9, band) * smoothstep(0.05, 0.14, h) * (1.0 - smoothstep(0.16, 0.34, h));
        c = mix(c, vec3(1.0, 0.72, 0.62), cl * 0.55);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 24, 16), skyMat);
  scene.add(sky);
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = new THREE.Scene();
    const s = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), skyMat.clone());
    env.add(s);
    scene.environment = pmrem.fromScene(env, 0.04).texture;
    scene.environmentIntensity = 0.7;
    s.geometry.dispose();
    pmrem.dispose();
  }

  // Distant mountain ring: flat-shaded silhouettes behind the sea.
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rng() * 0.2;
    const d = 190 + rng() * 40;
    const hgt = 30 + rng() * 45;
    add(G.cone5, toon(i % 2 ? '#8a5a8e' : '#a0667f'), Math.cos(a) * d, hgt / 2 - 12, Math.sin(a) * d,
      { sx: 50 + rng() * 30, sy: hgt, sz: 50 + rng() * 30, ry: rng() * 3, ink: 0, shadow: false });
  }

  // ------------------------------------------------------------------ ground
  const disc = radialDisc(EDGE_R * 3.2, 70, 90).toNonIndexed();
  const pos = disc.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, sakuraHeightAt(pos.getX(i), pos.getZ(i)));
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const cols = {
    grass: new THREE.Color('#8fd46a'), grass2: new THREE.Color('#a6dd72'), sand: new THREE.Color('#ffd9a0'),
    cliff: new THREE.Color('#c98a5a'), cliffDark: new THREE.Color('#9c5e48'), path: new THREE.Color('#f3c9a0'),
    plaza: new THREE.Color('#f7d8b8'), bed: new THREE.Color('#3c6f8a'), crater: new THREE.Color('#6a4a5a'),
    temple: new THREE.Color('#e9f0c8'), glow: new THREE.Color('#6fe8c8'),
  };
  for (let f = 0; f < pos.count; f += 3) {
    let cx = 0, cy = 0, cz = 0, lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 3; k++) {
      const y = pos.getY(f + k);
      cx += pos.getX(f + k) / 3; cy += y / 3; cz += pos.getZ(f + k) / 3;
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    const slope = hi - lo;
    const edge = Math.hypot(pos.getX(f) - pos.getX(f + 1), pos.getZ(f) - pos.getZ(f + 1)) + 0.001;
    const steep = slope / edge;
    if (cy < SEA_Y + 0.2) c.copy(cols.bed);
    else if (cy < SEA_Y + 1.2) c.copy(cols.sand);
    else if (steep > 1.3) c.copy(Math.sin(cy * 2.1) > 0 ? cols.cliff : cols.cliffDark);
    else if (Math.hypot(cx - CRATER.x, cz - CRATER.z) < 8) c.copy(cols.crater);
    else if (Math.hypot(cx - P.plaza.x, cz - P.plaza.z) < 13 || (Math.abs(cx) < 3.2 && cz < -12 && cz > -34)) c.copy(cols.plaza);
    else if (Math.hypot(cx - P.temple.x, cz - P.temple.z) < 10) c.copy(cols.temple);
    else c.copy((Math.floor(cx * 0.3) + Math.floor(cz * 0.3)) & 1 ? cols.grass : cols.grass2);
    c.offsetHSL(0, 0, (rng() - 0.5) * 0.04);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (f + k) * 3);
  }
  disc.setAttribute('color', new THREE.BufferAttribute(col, 3));
  disc.computeVertexNormals();
  const ground = new THREE.Mesh(disc, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient(), flatShading: true }));
  ground.receiveShadow = true;
  group.add(ground);

  // Water: one animated toon sheet at sea level with painted foam bands.
  const waterMat = new THREE.ShaderMaterial({
    transparent: true, fog: true,
    uniforms: { t: { value: 0 }, ...THREE.UniformsLib.fog },
    vertexShader: `varying vec3 vW;
#include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
      }`,
    fragmentShader: `uniform float t; varying vec3 vW;
#include <fog_pars_fragment>
      void main(){
        float r = length(vW.xz);
        vec3 c = mix(vec3(0.36,0.62,0.95), vec3(0.2,0.32,0.72), smoothstep(40.0, 140.0, r));
        float w = sin(vW.x*0.35 + t*1.3) * sin(vW.z*0.3 - t*0.9);
        c += vec3(1.0,0.8,0.6) * step(0.86, w) * 0.35;
        gl_FragColor = vec4(c, 0.86);
#include <fog_fragment>
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(900, 900, 1, 1).rotateX(-Math.PI / 2), waterMat);
  water.position.y = SEA_Y;
  scene.add(water);
  animated.push((t) => { waterMat.uniforms.t.value = t; });

  // -------------------------------------------------------------- buildings

  /** A Japanese-style house: timber frame, plaster walls, one or two flared roofs. */
  function house(x, z, w, d, floors = 1, ry = 0, roofCol = PAL.roof) {
    const y = gy(x, z);
    const fh = 2.8;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    group.add(g);
    add(G.box, toon(PAL.woodDark), 0, 0.25, 0, { sx: w + 0.6, sy: 0.5, sz: d + 0.6, parent: g, ink: 0.02 });
    for (let f = 0; f < floors; f++) {
      const s = 1 - f * 0.18;
      add(G.box, toon(PAL.plaster), 0, 0.5 + fh * f + fh / 2, 0, { sx: w * s, sy: fh, sz: d * s, parent: g, ink: 0.03 });
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        add(G.box, toon(PAL.wood), px * w * s / 2, 0.5 + fh * f + fh / 2, pz * d * s / 2, { sx: 0.35, sy: fh, sz: 0.35, parent: g, ink: 0 });
      }
      add(G.box, toon(PAL.wood), 0, 0.5 + fh * f + fh * 0.55, d * s / 2 + 0.02, { sx: w * s, sy: 0.25, sz: 0.1, parent: g, ink: 0 });
      add(G.roof4, toon(roofCol), 0, 0.5 + fh * (f + 1) + 0.6, 0, { sx: (w * s + 2.2), sy: 1.6, sz: (d * s + 2.2), parent: g, ink: 0.04 });
    }
    // Paper lanterns at the door.
    for (const s of [-1, 1]) {
      add(G.cyl8, toon('#ff7a5a', '#ff7a3a', 0.9), s * (w / 2 - 0.3), 2.3, d / 2 + 0.5, { sx: 0.45, sy: 0.6, sz: 0.45, parent: g, ink: 0.06, shadow: false });
    }
    const cos = Math.abs(Math.cos(ry)), sin = Math.abs(Math.sin(ry));
    boxes.push(makeBox(x, y + (fh * floors + 0.5) / 2, z, w * cos + d * sin, fh * floors + 0.5, w * sin + d * cos));
    // Door-front loot.
    anchors.floors.push({ x: x + Math.sin(ry) * (d / 2 + 1.6), z: z + Math.cos(ry) * (d / 2 + 1.6) });
    return g;
  }

  /** An open pavilion you can fight through: four posts and a roof. */
  function pavilion(x, z, s = 5, roofCol = PAL.roofRed) {
    const y = gy(x, z);
    add(G.box, toon(PAL.stoneDark), x, y + 0.2, z, { sx: s + 1, sy: 0.4, sz: s + 1, ink: 0.02 });
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      add(G.cyl6, toon(PAL.roofRed), x + px * s / 2, y + 1.9, z + pz * s / 2, { sx: 0.4, sy: 3.2, sz: 0.4, ink: 0.08,
        box: { w: 0.5, h: 3.2, d: 0.5, y: y + 1.9 } });
    }
    add(G.roof4, toon(roofCol), x, y + 4.3, z, { sx: s + 2.5, sy: 1.8, sz: s + 2.5, ink: 0.04 });
    anchors.chests.push({ x, z, y: y + 0.45 });
  }

  function sakuraVillage() {
    const p = P.village;
    const spots = [[-8, -6, 7, 6, 2, 0.2], [6, -8, 6, 5, 1, -0.3], [-10, 6, 6, 5, 1, 0.5], [8, 5, 7, 6, 2, -0.1], [0, -12, 5, 4, 1, 0]];
    for (const [dx, dz, w, d, f, r] of spots) house(p.x + dx, p.z + dz, w, d, f, r);
    pavilion(p.x, p.z, 5);
    // Torii gate on the plaza road.
    const tx = p.x + 12, tz = p.z + 12;
    const ty = gy(tx, tz);
    for (const s of [-1, 1]) add(G.cyl8, toon('#e84a4a'), tx + s * 2.2, ty + 2.5, tz, { sx: 0.5, sy: 5, sz: 0.5, ry: 0.7, box: { w: 0.6, h: 5, d: 0.6, y: ty + 2.5 } });
    add(G.box, toon('#e84a4a'), tx, ty + 5.1, tz, { sx: 6.2, sy: 0.4, sz: 0.6, ry: -0.8 });
    add(G.box, toon('#3a2238'), tx, ty + 5.5, tz, { sx: 7, sy: 0.3, sz: 0.8, ry: -0.8 });
    for (let i = 0; i < 6; i++) anchors.floors.push({ x: p.x + (rng() - 0.5) * 20, z: p.z + (rng() - 0.5) * 20 });
    anchors.chests.push({ x: p.x - 4, z: p.z + 12 });
  }

  function sunsetPlaza() {
    const p = P.plaza;
    const y = gy(p.x, p.z);
    // Clock tower.
    add(G.box, toon(PAL.stone), p.x, y + 1, p.z, { sx: 5, sy: 2, sz: 5, box: { w: 5, h: 2, d: 5, y: y + 1 } });
    add(G.box, toon('#e6c8a8'), p.x, y + 6, p.z, { sx: 3.4, sy: 8, sz: 3.4, box: { w: 3.4, h: 8, d: 3.4, y: y + 6 } });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const face = add(G.disc, toon('#fff4d8', '#ffe8b0', 0.6), p.x + Math.sin(a) * 1.75, y + 8.4, p.z + Math.cos(a) * 1.75,
        { rx: Math.PI / 2, rz: -a, sx: 2.2, sy: 1, sz: 2.2, ink: 0.1 });
      const hand = add(G.box, toon('#3a2238'), 0, 0.08, 0, { sx: 0.06, sy: 0.3, sz: 0.4, parent: face, ink: 0 });
      animated.push((t) => { hand.rotation.y = -t * 0.3; });
    }
    add(G.roof4, toon(PAL.roof), p.x, y + 11.2, p.z, { sx: 5.4, sy: 3.4, sz: 5.4 });
    add(G.cone6, toon(PAL.gold, '#ffb020', 0.5), p.x, y + 13.6, p.z, { sx: 0.4, sy: 1.6, sz: 0.4 });
    // Shops ringing the square.
    const ring = [[-11, -6, 0.6], [11, -6, -0.6], [-11, 7, 2.5], [11, 8, -2.5], [0, 12, Math.PI]];
    ring.forEach(([dx, dz, r], i) => house(p.x + dx, p.z + dz, 6, 5, i % 2 ? 2 : 1, r, i % 2 ? PAL.roofRed : PAL.roof));
    // Van + market stalls for cover.
    const vx = p.x + 3, vz = p.z + 7, vy = gy(vx, vz);
    add(G.box, toon('#fff6f0'), vx, vy + 1.1, vz, { sx: 2, sy: 1.6, sz: 4, ry: 0.4, box: { w: 3, h: 2.2, d: 4, y: vy + 1.1 } });
    add(G.box, toon('#e84a4a'), vx, vy + 1.1, vz, { sx: 2.05, sy: 0.3, sz: 4.05, ry: 0.4, ink: 0 });
    add(G.box, toon('#6fb8ff'), vx + Math.sin(0.4) * 1.6, vy + 1.5, vz + Math.cos(0.4) * 1.6, { sx: 1.8, sy: 0.6, sz: 0.8, ry: 0.4, ink: 0 });
    for (const [dx, dz] of [[-5, 3], [5, -3], [-3, -6]]) {
      const sx = p.x + dx, sz = p.z + dz, sy = gy(sx, sz);
      add(G.box, toon(PAL.wood), sx, sy + 0.5, sz, { sx: 2.4, sy: 1, sz: 1.2, box: { w: 2.4, h: 1, d: 1.2, y: sy + 0.5 } });
      add(G.box, toon(['#ff8fc4', '#ffc94d', '#6fe8c8'][(dx + 9) % 3]), sx, sy + 2.2, sz, { sx: 2.8, sy: 0.15, sz: 1.8, rx: 0.15 });
      for (const s of [-1, 1]) add(G.cyl6, toon(PAL.wood), sx + s * 1.2, sy + 1.3, sz, { sx: 0.12, sy: 1.8, sz: 0.12, ink: 0 });
      anchors.floors.push({ x: sx, y: sy + 1.1, z: sz });
    }
    for (let i = 0; i < 4; i++) anchors.chests.push({ x: p.x + Math.cos(i * 1.57 + 0.78) * 6, z: p.z + Math.sin(i * 1.57 + 0.78) * 6 });
    for (let i = 0; i < 6; i++) anchors.floors.push({ x: p.x + (rng() - 0.5) * 22, z: p.z + (rng() - 0.5) * 22 });
    anchors.crystals.push({ x: p.x + 2.8, z: p.z, kind: 'speed' });
  }

  function celestialTemple() {
    const p = P.temple;
    const y = gy(p.x, p.z);
    add(G.box, toon(PAL.stone), p.x, y + 0.4, p.z, { sx: 16, sy: 0.8, sz: 12, ink: 0.02 });
    add(G.box, toon(PAL.stone), p.x, y + 1.0, p.z - 1, { sx: 12, sy: 0.6, sz: 8, ink: 0.02, box: { w: 12, h: 1.2, d: 8, y: y + 0.7 } });
    // Hall: open front, closed back so it is a real room to hold.
    const hy = y + 1.3;
    add(G.box, toon('#fff7ee'), p.x, hy + 2.5, p.z - 4, { sx: 10, sy: 5, sz: 0.8, box: { w: 10, h: 5, d: 0.8, y: hy + 2.5 } });
    for (const s of [-1, 1]) add(G.box, toon('#fff7ee'), p.x + s * 5, hy + 2.5, p.z - 1.5, { sx: 0.8, sy: 5, sz: 5.5, box: { w: 0.8, h: 5, d: 5.5, y: hy + 2.5 } });
    for (let i = 0; i < 6; i++) {
      const cx = p.x - 5 + i * 2;
      add(G.cyl8, toon(PAL.stone), cx, hy + 2.5, p.z + 1.4, { sx: 0.7, sy: 5, sz: 0.7, box: { w: 0.7, h: 5, d: 0.7, y: hy + 2.5 } });
    }
    add(G.box, toon(PAL.gold), p.x, hy + 5.2, p.z - 1.2, { sx: 11.5, sy: 0.5, sz: 6.8 });
    add(G.roof4, toon('#f4e8ff'), p.x, hy + 6.4, p.z - 1.2, { sx: 13, sy: 2, sz: 9 });
    add(G.dome, toon(PAL.gold, '#ffb020', 0.35), p.x, hy + 6.8, p.z - 1.2, { sx: 5, sy: 4, sz: 5 });
    add(G.cone6, toon(PAL.gold, '#ffd060', 0.6), p.x, hy + 10.2, p.z - 1.2, { sx: 0.9, sy: 3, sz: 0.9 });
    // Corner spires and floating portal panels.
    for (const [sx, sz] of [[-7, -5], [7, -5], [-7, 4], [7, 4]]) {
      add(G.box, toon(PAL.stone), p.x + sx, y + 3, p.z + sz, { sx: 1.4, sy: 6, sz: 1.4, box: { w: 1.4, h: 6, d: 1.4, y: y + 3 } });
      add(G.roof4, toon(PAL.gold), p.x + sx, y + 6.8, p.z + sz, { sx: 2, sy: 1.8, sz: 2 });
    }
    for (const s of [-1, 1]) {
      const panel = add(G.box, toon('#a8e4ff', '#7ad0ff', 1.2), p.x + s * 9, y + 3, p.z + 6, { sx: 0.3, sy: 3.2, sz: 1.6, ink: 0.08, shadow: false });
      animated.push((t) => { panel.position.y = y + 3 + Math.sin(t * 1.4 + s) * 0.3; panel.rotation.y = t * 0.4 * s; });
    }
    anchors.chests.push({ x: p.x, z: p.z - 2, y: hy + 0.05 }, { x: p.x - 3.5, z: p.z - 2.5, y: hy + 0.05 }, { x: p.x + 3.5, z: p.z - 2.5, y: hy + 0.05 });
    anchors.crystals.push({ x: p.x, z: p.z + 5, kind: 'jump' });
    for (let i = 0; i < 4; i++) anchors.floors.push({ x: p.x + (rng() - 0.5) * 14, z: p.z + 3 + rng() * 3 });
    // Stone lanterns lining the ramp.
    for (let z = -14; z > -34; z -= 5) for (const s of [-1, 1]) lantern(s * 4.3, z);
  }

  function lantern(x, z, glowCol = '#ffb86a') {
    const y = gy(x, z);
    add(G.box, toon(PAL.stoneDark), x, y + 0.6, z, { sx: 0.35, sy: 1.2, sz: 0.35, ink: 0.06 });
    add(G.box, toon('#fff0d0', glowCol, 1.1), x, y + 1.45, z, { sx: 0.6, sy: 0.5, sz: 0.6, ink: 0.06, shadow: false });
    add(G.roof4, toon(PAL.stoneDark), x, y + 1.95, z, { sx: 1.1, sy: 0.5, sz: 1.1, ink: 0.06 });
  }

  function crystalCaverns() {
    const p = P.caverns;
    // A ring of rock with a mouth facing the plaza, a forest of crystals inside.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      if (a > 2.1 && a < 3.3) continue;
      const rx = p.x + Math.cos(a) * 12, rz = p.z + Math.sin(a) * 12, ry = gy(rx, rz);
      const h = 3 + rng() * 3;
      add(G.ico, toon('#b77a5a'), rx, ry + h * 0.35, rz, { sx: 5, sy: h, sz: 4, ry: a, box: { w: 4, h, d: 4, y: ry + h / 2 } });
    }
    const clusters = [[0, 0, 11], [-5, 4, 6], [5, -4, 7], [4, 5, 5], [-4, -5, 5], [7, 2, 4], [-7, -1, 4]];
    clusters.forEach(([dx, dz, h], ci) => {
      const cx = p.x + dx, cz = p.z + dz, cy = gy(cx, cz);
      const n = 3 + Math.floor(h / 3);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const hh = h * (k === 0 ? 1 : 0.4 + rng() * 0.4);
        const off = k === 0 ? 0 : h * 0.12;
        const cr = PAL.crystal[(ci + k) % 4];
        const m = add(G.oct, toon(cr, cr, 0.55), cx + Math.cos(a) * off, cy + hh * 0.4, cz + Math.sin(a) * off,
          { sx: hh * 0.28, sy: hh, sz: hh * 0.28, rz: k === 0 ? 0 : Math.cos(a) * 0.4, rx: k === 0 ? 0 : Math.sin(a) * 0.4, ink: 0.05, shadow: false });
        if (k === 0) animated.push((t) => { m.material.emissiveIntensity = 0.5 + Math.sin(t * 2 + ci) * 0.15; });
      }
      boxes.push(makeBox(cx, cy + h * 0.35, cz, h * 0.3, h * 0.7, h * 0.3));
      if (ci) anchors.floors.push({ x: cx + 2, z: cz + 2 });
    });
    anchors.chests.push({ x: p.x - 2, z: p.z + 7 }, { x: p.x + 8, z: p.z - 6 }, { x: p.x - 8, z: p.z + 2 });
    anchors.crystals.push({ x: p.x + 2.5, z: p.z + 1, kind: 'speed' }, { x: p.x - 2, z: p.z - 3, kind: 'jump' });
  }

  function crashSite() {
    // The fallen saucer, half-buried and still burning.
    const y = gy(CRATER.x, CRATER.z);
    const g = new THREE.Group();
    g.position.set(CRATER.x, y + 0.8, CRATER.z);
    g.rotation.set(0.25, 0.4, -0.18);
    group.add(g);
    add(G.ico, toon('#c9c3dc'), 0, 0, 0, { sx: 7, sy: 1.4, sz: 7, parent: g });
    add(G.dome, toon('#8fe8ff', '#60d8ff', 0.8), 0, 0.5, 0, { sx: 3, sy: 2, sz: 3, parent: g });
    add(G.torus, toon('#7a6f94'), 0, 0, 0, { rx: Math.PI / 2, sx: 7, sy: 7, sz: 2, parent: g, ink: 0.02 });
    boxes.push(makeBox(CRATER.x, y + 1.2, CRATER.z, 6, 2.4, 6));
    for (let i = 0; i < 5; i++) {
      const a = rng() * 6.28, d = 4 + rng() * 3;
      const fx = CRATER.x + Math.cos(a) * d, fz = CRATER.z + Math.sin(a) * d;
      const fire = add(G.cone5, toon('#ff9a3a', '#ff6a1a', 1.4), fx, gy(fx, fz) + 0.6, fz, { sx: 0.9, sy: 1.4, sz: 0.9, ink: 0.06, shadow: false });
      animated.push((t) => { const k = 1 + Math.sin(t * 13 + i * 2) * 0.18; fire.scale.set(0.9 * k, 1.4 / k + 0.2, 0.9 * k); });
    }
    anchors.chests.push({ x: CRATER.x - 4, z: CRATER.z + 3 });
    anchors.crystals.push({ x: CRATER.x + 3, z: CRATER.z - 4, kind: 'speed' });
    anchors.drops.push({ x: CRATER.x, z: CRATER.z + 6 });
  }

  function angel(x, z, ry, scale = 1) {
    const y = gy(x, z);
    const m = toon('#f4eef8');
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    g.scale.setScalar(scale);
    group.add(g);
    add(G.box, toon(PAL.stoneDark), 0, 0.8, 0, { sx: 2, sy: 1.6, sz: 2, parent: g });
    add(G.cone6, m, 0, 3, 0, { sx: 1.5, sy: 2.8, sz: 1.5, parent: g });
    add(G.ico, m, 0, 4.7, 0, { sx: 0.8, sy: 0.9, sz: 0.8, parent: g });
    add(G.box, m, 0.5, 4.2, 0.2, { sx: 0.25, sy: 1.4, sz: 0.25, rz: -0.8, parent: g });
    for (const s of [-1, 1]) add(G.cone5, m, s * 1, 4.2, -0.4, { sx: 0.3, sy: 3, sz: 1.2, rz: s * 0.9, rx: -0.3, parent: g });
    boxes.push(makeBox(x, y + 2 * scale, z, 2 * scale, 4 * scale, 2 * scale));
  }

  function statueGardens() {
    const p = P.gardens;
    const y = gy(p.x, p.z);
    // Fountain.
    add(G.cyl8, toon(PAL.stone), p.x, y + 0.4, p.z, { sx: 7, sy: 0.8, sz: 7, box: { w: 6, h: 0.8, d: 6, y: y + 0.4 } });
    add(G.disc, toon('#7ad0ff', '#4ab0ff', 0.5), p.x, y + 0.8, p.z, { sx: 6.2, sy: 1, sz: 6.2, ink: 0 });
    add(G.cyl6, toon(PAL.stone), p.x, y + 1.6, p.z, { sx: 0.8, sy: 2, sz: 0.8 });
    add(G.cyl8, toon(PAL.stone), p.x, y + 2.6, p.z, { sx: 2.6, sy: 0.3, sz: 2.6 });
    const jet = add(G.cone6, toon('#bfeaff', '#9fe0ff', 0.9), p.x, y + 3.4, p.z, { sx: 0.5, sy: 1.6, sz: 0.5, ink: 0, shadow: false });
    animated.push((t) => { jet.scale.y = 1.6 + Math.sin(t * 6) * 0.2; });
    angel(p.x - 8, p.z - 6, 0.6, 1.3);
    angel(p.x + 7, p.z - 7, -0.5, 1.1);
    angel(p.x - 9, p.z + 6, 2.4, 1);
    angel(p.x + 6, p.z + 8, -2.6, 1.2);
    angel(p.x - 14, p.z - 12, 0.8, 1.6);
    // Hedge maze walls and stone lanterns.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const hx = p.x + Math.cos(a) * 12, hz = p.z + Math.sin(a) * 12, hy = gy(hx, hz);
      add(G.box, toon('#5fae5a'), hx, hy + 0.7, hz, { sx: 4, sy: 1.4, sz: 1, ry: -a + Math.PI / 2, box: { w: 3, h: 1.4, d: 3, y: hy + 0.7 } });
      if (i % 2) lantern(p.x + Math.cos(a + 0.4) * 9, p.z + Math.sin(a + 0.4) * 9);
    }
    anchors.chests.push({ x: p.x + 4, z: p.z - 1 }, { x: p.x - 13, z: p.z - 9 }, { x: p.x + 2, z: p.z + 11 });
    for (let i = 0; i < 6; i++) anchors.floors.push({ x: p.x + (rng() - 0.5) * 20, z: p.z + (rng() - 0.5) * 20 });
    anchors.crystals.push({ x: p.x, z: p.z + 4.5, kind: 'jump' });
  }

  function alienOasis() {
    const p = P.oasis;
    const y = gy(p.x, p.z);
    // Glowing pool.
    const pool = add(G.disc, toon('#5affd8', '#3affc8', 0.9), p.x - 4, y + 0.08, p.z + 3, { sx: 8, sy: 1, sz: 6, ink: 0, shadow: false });
    animated.push((t) => { pool.material.emissiveIntensity = 0.75 + Math.sin(t * 1.7) * 0.2; });
    // Dome habitat, walk-in through the front gap.
    const dx = p.x + 5, dz = p.z - 3;
    add(G.dome, toon('#cfd6e4'), dx, y, dz, { sx: 9, sy: 6, sz: 9 });
    add(G.torus, toon('#6fe8ff', '#4fd8ff', 1.3), dx, y + 0.3, dz, { rx: Math.PI / 2, sx: 9.2, sy: 9.2, sz: 1, ink: 0, shadow: false });
    boxes.push(makeBox(dx, y + 1.5, dz - 3.8, 7, 3, 1.2), makeBox(dx - 3.8, y + 1.5, dz, 1.2, 3, 6), makeBox(dx + 3.8, y + 1.5, dz, 1.2, 3, 6));
    anchors.chests.push({ x: dx, z: dz - 1 });
    // Mushrooms, alien bulbs, spiral plants.
    const glow = ['#ff7ad8', '#6fe8ff', '#b88aff', '#7aff9a'];
    for (let i = 0; i < 14; i++) {
      const a = rng() * 6.28, d = 6 + rng() * 9;
      const mx = p.x + Math.cos(a) * d, mz = p.z + Math.sin(a) * d, my = gy(mx, mz);
      if (my < SEA_Y + 0.4) continue;
      const hgt = 1.5 + rng() * 3.5, gc = glow[i % 4];
      add(G.cyl6, toon('#f2e6d8'), mx, my + hgt / 2, mz, { sx: 0.35 + hgt * 0.06, sy: hgt, sz: 0.35 + hgt * 0.06, ink: 0.06 });
      const cap = add(G.dome, toon(gc, gc, 0.7), mx, my + hgt, mz, { sx: hgt * 0.9, sy: hgt * 0.45, sz: hgt * 0.9, ink: 0.05 });
      animated.push((t) => { cap.scale.y = hgt * 0.45 * (1 + Math.sin(t * 2 + i) * 0.06); });
      if (hgt > 3) boxes.push(makeBox(mx, my + hgt / 2, mz, 0.6, hgt, 0.6));
    }
    anchors.chests.push({ x: p.x - 8, z: p.z - 4 }, { x: p.x + 1, z: p.z + 9 });
    for (let i = 0; i < 6; i++) anchors.floors.push({ x: p.x + (rng() - 0.5) * 20, z: p.z + (rng() - 0.5) * 20 });
    anchors.crystals.push({ x: p.x - 4, z: p.z - 6, kind: 'speed' });
  }

  /** Plank bridges wherever a route crosses the river. */
  function bridges() {
    const spans = [[-22, 12, 1.1], [0, 38, 0.35], [-36, 4, 0.9]];
    for (const [bx, bz, ry] of spans) {
      const len = 16, by = SEA_Y + 2.2;
      add(G.box, toon(PAL.wood), bx, by, bz, { sx: 3.2, sy: 0.35, sz: len, ry, ink: 0.02 });
      for (const s of [-1, 1]) {
        const ox = Math.cos(ry) * s * 1.6, oz = -Math.sin(ry) * s * 1.6;
        add(G.box, toon('#e84a4a'), bx + ox, by + 0.7, bz + oz, { sx: 0.15, sy: 0.15, sz: len, ry, ink: 0.1 });
      }
      // Collision as a row of deck tiles along the rotated span.
      for (let k = -3; k <= 3; k++) {
        const t = (k / 3) * (len / 2 - 1);
        boxes.push(makeBox(bx + Math.sin(ry) * t, by, bz + Math.cos(ry) * t, 3, 0.35, 3, 'solid'));
      }
    }
  }

  /** Waterfalls off the plateaus into the sea and lake. */
  function waterfalls() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, uniforms: { t: { value: 0 } }, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float t; varying vec2 vU;
        void main(){ float s = step(0.55, fract(vU.y * 3.0 + t * 1.6 + sin(vU.x * 18.0) * 0.15));
          vec3 c = mix(vec3(0.62,0.85,1.0), vec3(1.0), s * 0.8); gl_FragColor = vec4(c, 0.88 - vU.y * 0.0); }`,
    });
    animated.push((t) => { mat.uniforms.t.value = t; });
    const falls = [[-52, -30, 1.2], [-50, 30, 1.9], [14, 58, 3.3], [58, -20, -1.3]];
    for (const [fx, fz, a] of falls) {
      const top = gy(fx - Math.cos(a) * 4, fz - Math.sin(a) * 4);
      const h = top - SEA_Y;
      if (h < 1) continue;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3, h), mat);
      m.position.set(fx, SEA_Y + h / 2, fz);
      m.rotation.y = -a + Math.PI / 2;
      group.add(m);
    }
  }

  // ---------------------------------------------------------- sakura trees
  function blossomTrees() {
    const N = 170;
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 1, 5);
    const canopyGeo = new THREE.IcosahedronGeometry(1, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, toon(PAL.trunk), N);
    const canopy = new THREE.InstancedMesh(canopyGeo, new THREE.MeshToonMaterial({ gradientMap: gradient(), flatShading: true, emissive: '#ff9cc6', emissiveIntensity: 0.12 }), N * 3);
    const canopyInk = new THREE.InstancedMesh(canopyGeo, INK, N * 3);
    const d = new THREE.Object3D();
    const cc = new THREE.Color();
    let ti = 0, ci = 0;
    const clear = [...POIS.map((p) => [p.x, p.z, p.id === 'plaza' ? 16 : 13]), [CRATER.x, CRATER.z, 10], [0, -23, 6]];
    for (let tries = 0; tries < 900 && ti < N; tries++) {
      const x = (rng() - 0.5) * EDGE_R * 2, z = (rng() - 0.5) * EDGE_R * 2;
      if (Math.hypot(x, z) > EDGE_R - 6) continue;
      const y = gy(x, z);
      if (y < SEA_Y + 1) continue;
      if (clear.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r)) continue;
      const h = 2.4 + rng() * 2;
      d.position.set(x, y + h / 2, z); d.rotation.set(0, rng() * 6, (rng() - 0.5) * 0.2); d.scale.set(1, h, 1); d.updateMatrix();
      trunks.setMatrixAt(ti, d.matrix);
      boxes.push(makeBox(x, y + h / 2, z, 0.7, h, 0.7));
      for (let k = 0; k < 3; k++) {
        const s = 1.4 + rng() * 1.2;
        d.position.set(x + (rng() - 0.5) * 2.2, y + h + (rng() - 0.2) * 1.2, z + (rng() - 0.5) * 2.2);
        d.rotation.set(rng() * 3, rng() * 3, 0); d.scale.set(s * 1.2, s * 0.85, s * 1.2); d.updateMatrix();
        canopy.setMatrixAt(ci, d.matrix);
        cc.set(PAL.blossom[(ti + k) % 4]);
        canopy.setColorAt(ci, cc);
        d.scale.multiplyScalar(1.05); d.updateMatrix();
        canopyInk.setMatrixAt(ci, d.matrix);
        ci++;
      }
      ti++;
    }
    trunks.count = ti; canopy.count = ci; canopyInk.count = ci;
    trunks.castShadow = canopy.castShadow = true;
    canopy.receiveShadow = true;
    group.add(trunks, canopy, canopyInk);
  }

  // Falling petals: one points cloud animated entirely on the GPU.
  function petals() {
    const N = 1400;
    const arr = new Float32Array(N * 3);
    const seedA = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      arr[i * 3] = (rng() - 0.5) * 130; arr[i * 3 + 1] = rng() * 30; arr[i * 3 + 2] = (rng() - 0.5) * 130;
      seedA[i] = rng() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seedA, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { t: { value: 0 } },
      vertexShader: `attribute float seed; uniform float t; varying float vS;
        void main(){ vec3 p = position; float y = mod(p.y - t * (0.9 + fract(seed) * 0.6), 30.0);
          p.y = y + 1.0; p.x += sin(t * 0.7 + seed) * 2.0 + t * 0.6; p.z += cos(t * 0.5 + seed * 1.3) * 1.5;
          p.x = mod(p.x + 65.0, 130.0) - 65.0; vS = seed;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = 90.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vS; void main(){ vec2 c = gl_PointCoord - 0.5; c.x *= 1.7;
          if (length(c) > 0.45) discard; gl_FragColor = vec4(mix(vec3(1.0,0.72,0.85), vec3(1.0,0.88,0.94), fract(vS)), 0.9); }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    animated.push((t) => { mat.uniforms.t.value = t; });
  }

  sakuraVillage();
  sunsetPlaza();
  celestialTemple();
  crystalCaverns();
  crashSite();
  statueGardens();
  alienOasis();
  bridges();
  waterfalls();
  blossomTrees();
  petals();

  // Wild loot between the districts, and one drop per district.
  for (let i = 0; i < 24; i++) {
    const x = (rng() - 0.5) * EDGE_R * 1.8, z = (rng() - 0.5) * EDGE_R * 1.8;
    if (Math.hypot(x, z) < EDGE_R - 8 && gy(x, z) > SEA_Y + 0.6) anchors.floors.push({ x, z, poi: 'wild' });
  }
  for (const p of POIS) anchors.drops.push({ x: p.x, z: p.z + 3, poi: p.id });
  for (const list of [anchors.chests, anchors.floors, anchors.crystals, anchors.drops]) {
    for (const a of list) if (a.y == null) a.y = gy(a.x, a.z) + 0.45;
  }

  // One ticker, driven by the renderer so no game-loop hook is needed.
  const t0 = performance.now();
  ground.onBeforeRender = () => {
    const t = (performance.now() - t0) / 1000;
    if (t === clock.t) return;
    clock.t = t;
    for (const f of animated) f(t);
  };
  ground.frustumCulled = false;

  const kit = createKit(group, boxes);
  const ufo = buildUfo(kit);
  scene.add(ufo.group);
  const lobby = buildLobby(kit);
  scene.add(lobby);

  return {
    group, boxes, heightAt, anchors, pois: POIS, ufo, lobby, sky, sun, kit,
    cityReady: Promise.resolve(null),
    cityBounds: () => null,
    makeChest: () => buildChest(),
    progress: () => kit.progress(),
    ready: () => kit.settled(),
    slowAt: () => false,
  };
}
