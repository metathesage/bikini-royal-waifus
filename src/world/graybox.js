import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeBox } from '../game/collision.js';
import { setTerrain } from './map.js';
import { GUNS } from '../game/weapons.js';
import {
  MODULAR_FBX, PROP_GLB, GRAVEYARD_OBJ, ITEM_GLB,
  loadGltf, loadFbx, loadObj, instanceOf, normalizeScene, fitToFootprint,
} from '../data/assets.js';

/* ------------------------------------------------------------------ *
 * The range: neon brutalist, moonlit, in a Japanese memorial garden.
 *
 * Everything else in this project is a content map, which makes it a
 * bad place to answer "does the gun feel right". The island has 43
 * bots, a storm, thousands of triangles of art and a random spawn, so
 * a bad TTK or a broken reload is indistinguishable from a bad fight.
 *
 * The range removes every variable except the one under test:
 *
 *   - dead flat ground, so a shot that misses has only one possible reason
 *   - measured lanes at 10/25/50/75/100m, colour-coded in neon and
 *     readable from the firing line, so falloff is checkable by reading
 *     the floor rather than by estimating
 *   - target dummies that take damage through the real hurtBot path, so the
 *     numbers on the HUD are the numbers the game will actually show
 *   - no storm, no drop, no lobby: you are on the range immediately
 *
 * What it is *not* any more is a grey box. The old version was untextured
 * mid-grey cubes on a grey plane under a grey sky, on the argument that
 * "nothing can be black or metallic" there. That argument was about
 * *hiding* rendering bugs, and it cost the range its entire read: you
 * could not see a target at 100m against the sky, so the one thing the
 * map exists to measure was the one thing it made hardest to see.
 *
 * So the art direction is load-bearing instead of decorative:
 *
 *   - black lacquer wet stone, hot magenta and electric cyan. Every
 *     measured distance is a coloured neon gantry, so a target at 100m
 *     is a bright silhouette against an ink sky rather than a grey dot
 *     on a grey line
 *   - brutalist architecture: monolithic slabs, buttresses, trenches and
 *     lintels, all hard right angles. Kit pieces dress it; they never
 *     replace it
 *   - a moonlit garden around the range - stone lanterns, torii, sakura,
 *     tombs, black reflecting water - so the place you stand has a sky
 *
 * Two hard constraints shape the material layer, both asserted by
 * test/smoke.mjs:
 *
 *   1. No MeshStandardMaterial, no MeshPhysicalMaterial, and no truthy
 *      `metalness` anywhere in the scene. A PBR material with nothing to
 *      reflect renders black, which is the exact failure this map is
 *      supposed to make impossible. So: MeshLambertMaterial for mass,
 *      MeshToonMaterial for the cel-shaded slabs, MeshBasicMaterial for
 *      anything that is pure emitted light. All three ignore metalness.
 *   2. `progress()` must be 1 the instant buildGraybox returns, because
 *      the range is asserted to be fully playable on its procedural
 *      geometry alone. Every gate, lane marker, plinth, dummy and
 *      collision box here is built synchronously; the streamed kit is
 *      dressing and lands during play, exactly as it does on the island
 *      after its grace window. The loading bar never waits on art.
 * ------------------------------------------------------------------ */

/** Range is this big, centred on the origin. Wide enough for a 100m lane. */
export const GRAY_R = 70;
/** Where the player is put at match start, facing down the range. */
export const GRAY_SPAWN = { x: 0, y: 0, z: 34 };
/** Lane gates, in metres from the firing line. */
export const GRAY_GATES = [10, 25, 50, 75, 100];

/** Downrange is -Z, so a gate at N metres sits at z = spawn.z - N. */
const zAt = (m) => GRAY_SPAWN.z - m;

/**
 * Flat ground at y = 0 inside the range, falling away outside so a player who
 * runs off the edge is punished by the fall rather than by an invisible wall.
 */
function grayHeightAt(x, z) {
  const r = Math.hypot(x, z);
  if (r <= GRAY_R) return 0;
  return -Math.min(30, (r - GRAY_R) * 1.5);
}

/* ------------------------------------------------------------------ *
 * Palette.
 *
 * The reference is a *moonlit* garden, not an unlit one: black lacquer and
 * concrete, but every surface still has to read. The first pass at this
 * palette was honest about "black lacquer" and produced a frame with a
 * legible sky and an entirely black floor, which is the same failure as the
 * grey box in a different costume. So the darks here are dark *relative to
 * the neon*, not dark in absolute terms, and the hemisphere light is doing
 * real work rather than being set to a token value.
 * ------------------------------------------------------------------ */
const INK = 0x04050b;
const VOID = 0x01020a;
const LACQUER = 0x181c2b;
const CONCRETE = 0x39415f;
const CONCRETE_HI = 0x5a6590;
const STEEL = 0x5b6584;
const CHROME = 0xb9c6de;
const MAGENTA = 0xff2d95;
const CYAN = 0x2ff3ff;
const SAKURA = 0xff9ecb;
const GOLD = 0xffc46b;
const VIOLET = 0x9d5cff;

/** Each measured gate gets its own neon so distance is a colour, not a number. */
const GATE_HUE = [CYAN, MAGENTA, GOLD, VIOLET, SAKURA];

/* ------------------------------------------------------------------ *
 * Materials
 *
 * Three classes only, and all three ignore metalness entirely:
 *   mass  - MeshToonMaterial, cel-shaded, vertex-coloured
 *   skin  - MeshLambertMaterial, smooth, for kit props once de-PBR'd
 *   light - MeshBasicMaterial, unlit, for anything that emits
 * ------------------------------------------------------------------ */

/** Shared cel ramp: four hard bands, nearest-filtered so they stay hard. */
let RAMP = null;
function toonRamp() {
  if (RAMP) return RAMP;
  const steps = new Uint8Array([24, 88, 172, 255]);
  RAMP = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  RAMP.minFilter = THREE.NearestFilter;
  RAMP.magFilter = THREE.NearestFilter;
  RAMP.generateMipmaps = false;
  RAMP.needsUpdate = true;
  return RAMP;
}

/** Cel-shaded mass. Vertex-coloured, so one material dresses a whole skyline. */
function massMat(opts = {}) {
  return new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp(), ...opts });
}

/** Smooth lit surface, for imported kit props. */
function skinMat(opts = {}) {
  return new THREE.MeshLambertMaterial(opts);
}

/** Pure emitted light. Unlit, so it reads at any distance, at night, forever. */
function glowMat(opts = {}) {
  return new THREE.MeshBasicMaterial({ vertexColors: true, ...opts });
}

/* ------------------------------------------------------------------ *
 * Canvas art
 *
 * Every texture on the range is drawn here rather than shipped as a
 * file: a sign is a plate, a border, a bar of accent and a number, and
 * that is a drawing, not a bitmap. It is also the only way to get
 * readable type at 100m without a font pipeline.
 *
 * Only fillRect/fillText/arc and friends are used. The node test suite
 * stubs 2d contexts with a Proxy whose every getter is a no-op function,
 * so nothing here may read a value *out* of the context (no
 * measureText, no getImageData) or draw a canvas at import time.
 * ------------------------------------------------------------------ */
const CANVAS_TEXTURES = new Map();

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, { aniso = 4, repeat = false } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  return tex;
}

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * A soft radial blob, used for mist, moon halo, water sheen and the pool
 * of light under every neon strip. Built from concentric discs rather than
 * createRadialGradient so it degrades to *something* rather than throwing
 * under a stubbed context.
 */
function blobCanvas(size, rgb, power = 2.2) {
  const c = mkCanvas(size, size);
  const g = c.getContext('2d');
  const r = size / 2;
  const rings = 26;
  for (let i = rings; i > 0; i--) {
    const t = i / rings;
    g.globalAlpha = Math.pow(1 - t, power) * 0.5;
    g.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    g.beginPath();
    g.arc(r, r, r * t, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  return c;
}

/**
 * A backlit sign: dark plate, neon border, accent bar, big number.
 * `main` is the headline (a distance), `sub` the caption.
 */
function signTexture(main, sub, color) {
  const key = `sign|${main}|${sub}|${color}`;
  if (CANVAS_TEXTURES.has(key)) return CANVAS_TEXTURES.get(key);
  const W = 512;
  const H = 256;
  const c = mkCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#05060c';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#12162a';
  g.fillRect(0, 0, W, 10);
  g.fillRect(0, H - 10, W, 10);
  g.globalAlpha = 0.2;
  g.strokeStyle = hex(color);
  g.lineWidth = 22;
  g.strokeRect(12, 12, W - 24, H - 24);
  g.globalAlpha = 1;
  g.lineWidth = 8;
  g.strokeRect(12, 12, W - 24, H - 24);
  g.fillStyle = hex(color);
  g.fillRect(30, H - 62, W - 60, 8);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowBlur = 26;
  g.shadowColor = hex(color);
  g.fillStyle = '#ffffff';
  g.font = 'bold 132px "Segoe UI", system-ui, sans-serif';
  g.fillText(main, W / 2, 108);
  g.fillStyle = hex(color);
  g.fillText(main, W / 2, 108);
  g.shadowBlur = 12;
  g.font = 'bold 38px "Segoe UI", system-ui, sans-serif';
  g.fillText(sub, W / 2, 206);
  g.shadowBlur = 0;
  const tex = finish(c);
  CANVAS_TEXTURES.set(key, tex);
  return tex;
}

/**
 * The wide header band each gate wears.
 *
 * A gate sign is seen at every distance from 10m to 100m and at every angle
 * the player can stand at, so it is drawn as signage rather than as a poster:
 * one big numeral, a rule, a unit, and a hazard chevron at each end. The
 * numeral is repeated small at the right so the band still reads as "10" when
 * it is forty pixels wide.
 */
function bandTexture(main, color) {
  const key = `band|${main}|${color}`;
  if (CANVAS_TEXTURES.has(key)) return CANVAS_TEXTURES.get(key);
  const W = 1024;
  const H = 192;
  const c = mkCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#04050c';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#0f1428';
  g.fillRect(0, 0, W, 6);
  g.fillRect(0, H - 6, W, 6);
  // end caps
  g.fillStyle = hex(color);
  for (let i = 0; i < 7; i++) {
    g.globalAlpha = 0.85 - i * 0.11;
    g.beginPath();
    g.moveTo(10 + i * 13, 16);
    g.lineTo(20 + i * 13, H / 2);
    g.lineTo(10 + i * 13, H - 16);
    g.lineTo(2 + i * 13, H - 16);
    g.lineTo(12 + i * 13, H / 2);
    g.lineTo(2 + i * 13, 16);
    g.fill();
    g.beginPath();
    g.moveTo(W - 10 - i * 13, 16);
    g.lineTo(W - 20 - i * 13, H / 2);
    g.lineTo(W - 10 - i * 13, H - 16);
    g.lineTo(W - 2 - i * 13, H - 16);
    g.lineTo(W - 12 - i * 13, H / 2);
    g.lineTo(W - 2 - i * 13, 16);
    g.fill();
  }
  g.globalAlpha = 1;
  g.textBaseline = 'middle';
  g.shadowBlur = 24;
  g.shadowColor = hex(color);
  g.font = 'bold 150px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'left';
  g.fillStyle = '#ffffff';
  g.fillText(main, 118, H / 2 - 6);
  g.fillStyle = hex(color);
  g.fillText(main, 118, H / 2 - 6);
  // the rule and the unit
  const wNum = 118 + 150 * main.length * 0.62;
  g.fillStyle = hex(color);
  g.fillRect(wNum + 14, H / 2 - 46, 4, 92);
  g.shadowBlur = 10;
  g.font = 'bold 62px "Segoe UI", system-ui, sans-serif';
  g.fillText('METRES', wNum + 40, H / 2 - 18);
  g.font = 'bold 40px "Segoe UI", system-ui, sans-serif';
  g.fillStyle = '#8fa4d8';
  g.fillText('RANGE  /  TARGET LANE', wNum + 40, H / 2 + 36);
  // a small repeat of the numeral, right-aligned, for when it is tiny
  g.textAlign = 'right';
  g.shadowBlur = 14;
  g.font = 'bold 96px "Segoe UI", system-ui, sans-serif';
  g.fillStyle = hex(color);
  g.fillText(main, W - 108, H / 2);
  g.shadowBlur = 0;
  const tex = finish(c);
  CANVAS_TEXTURES.set(key, tex);
  return tex;
}

/**
 * A small lane marker: one word or number stroked in neon on a transparent
 * plate, so it can float over the target it names without a visible panel.
 */
function tagTexture(text, color) {
  const key = `tag|${text}|${color}`;
  if (CANVAS_TEXTURES.has(key)) return CANVAS_TEXTURES.get(key);
  const W = 256;
  const H = 128;
  const c = mkCanvas(W, H);
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 84px "Segoe UI", system-ui, sans-serif';
  g.shadowBlur = 12;
  g.shadowColor = hex(color);
  g.strokeStyle = hex(color);
  g.lineWidth = 7;
  g.strokeText(text, W / 2, H / 2);
  g.shadowBlur = 4;
  g.fillStyle = '#ffffff';
  g.fillText(text, W / 2, H / 2);
  g.shadowBlur = 0;
  const tex = finish(c);
  CANVAS_TEXTURES.set(key, tex);
  return tex;
}

/** A cherry petal: a notched teardrop, drawn white so the tint can vary it. */
function petalCanvas() {
  const c = mkCanvas(32, 32);
  const g = c.getContext('2d');
  g.translate(16, 16);
  g.rotate(-0.5);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(0, -11);
  g.quadraticCurveTo(9, -3, 0, 12);
  g.quadraticCurveTo(-9, -3, 0, -11);
  g.fill();
  return c;
}

/** The moon: a hard disc inside a soft blue limb, so it reads as a light. */
function moonCanvas() {
  const S = 256;
  const c = mkCanvas(S, S);
  const g = c.getContext('2d');
  const r = S / 2;
  for (let i = 24; i > 0; i--) {
    const t = i / 24;
    g.globalAlpha = t > 0.87 ? 0.05 : 0.95;
    g.fillStyle = t > 0.87 ? '#7ea6ff' : '#f6f8ff';
    g.beginPath();
    g.arc(r, r, r * t, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 0.13;
  g.fillStyle = '#93a9d4';
  for (const [u, v, cr] of [[0.34, 0.40, 16], [0.46, 0.60, 11], [0.38, 0.68, 7], [0.60, 0.36, 6]]) {
    g.beginPath();
    g.arc(r * 2 * u, r * 2 * v, cr, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  return c;
}

/* ------------------------------------------------------------------ *
 * Geometry batching
 *
 * The brutalist forms are hundreds of axis-aligned slabs. Built as
 * individual meshes that is hundreds of draw calls for what is really
 * one silhouette, so every slab is baked to per-vertex colour and
 * merged: the whole range architecture is a handful of draw calls.
 *
 * The vertical gradient baked per piece is a stand-in for a shadow pass.
 * Each slab is darkest at its own base and brightest at its own top, so
 * a stack of boxes reads as one heavy mass under a moon instead of a
 * flat silhouette. It costs nothing, and it is most of what makes the
 * concrete look like concrete.
 * ------------------------------------------------------------------ */
class Batch {
  constructor() {
    this.parts = [];
  }

  /**
   * @param {THREE.BufferGeometry} geo  consumed; do not reuse it afterwards
   * @param {number} color              base colour
   * @param {object} o  {x,y,z,rx,ry,rz,grade} - grade 0 is flat, 1 is the
   *                     full base-to-top ramp measured across the piece
   */
  add(geo, color, o = {}) {
    const { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, grade = 0.6 } = o;
    // Bake the ramp from the piece's *local* Y, before any transform, so the
    // gradient belongs to the object rather than to wherever it ended up.
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const spanY = Math.max(0.001, bb.max.y - bb.min.y);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color(color);
    const lo = 1 - grade;
    for (let i = 0; i < pos.count; i++) {
      const t = lo + grade * Math.min(1, Math.max(0, (pos.getY(i) - bb.min.y) / spanY));
      col[i * 3] = c.r * t;
      col[i * 3 + 1] = c.g * t;
      col[i * 3 + 2] = c.b * t;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (rx) geo.rotateX(rx);
    if (ry) geo.rotateY(ry);
    if (rz) geo.rotateZ(rz);
    geo.translate(x, y, z);
    this.parts.push(geo);
    return this;
  }

  /** An axis-aligned slab. `y` is its *base*, the way levels are authored. */
  box(x, y, z, w, h, d, color, o = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    return this.add(g, color, { ...o, x, y, z });
  }

  build(material, name) {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    this.parts.length = 0;
    if (!merged) return null;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = name || 'batch';
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }
}

/* ------------------------------------------------------------------ *
 * Kit loading
 *
 * Load once, normalise once, clone per placement, exactly as the island
 * does it. Two things differ here:
 *
 *   - every imported material is rebuilt as MeshLambertMaterial. glTF
 *     hands back MeshStandardMaterial and OBJ hands back MeshPhong, both
 *     of which can render as a black cut-out with nothing to reflect,
 *     and the smoke test rejects PBR outright. Converting at load time
 *     is the only place this can be done once for every clone.
 *   - the modular FBX kit ships a pure-black placeholder texture, so its
 *     base-colour map is dropped and the piece is painted by vertex-tint
 *     instead. Keeping it would multiply a good colour by black.
 * ------------------------------------------------------------------ */
const KIT_CACHE = new Map();

/** True when a mesh is a flat card, whose normal is the one thing to distrust. */
function isCard(geometry) {
  if (!geometry) return false;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const s = geometry.boundingBox.getSize(new THREE.Vector3());
  const extent = Math.max(s.x, s.y, s.z);
  if (extent <= 1e-6) return false;
  return Math.min(s.x, s.y, s.z) / extent < 0.02;
}

/** Rebuild any material as Lambert, preserving map, colour and emissive. */
function toLambert(m) {
  if (!m) return m;
  if (m.isMeshLambertMaterial) return m;
  const out = new THREE.MeshLambertMaterial({
    map: m.map || null,
    color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
    emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0x000000),
    emissiveIntensity: m.emissiveIntensity ?? 1,
    transparent: !!m.transparent,
    opacity: m.opacity ?? 1,
    alphaTest: m.alphaTest ?? 0,
    side: m.side ?? THREE.FrontSide,
    depthWrite: m.depthWrite !== false,
    fog: m.fog !== false,
  });
  out.name = m.name || '';
  return out;
}

/** Make an imported prop survive this scene: de-PBR it, un-black it, light it. */
function dePBR(root, { dropMap = false } = {}) {
  const swapped = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const src = Array.isArray(o.material) ? o.material : [o.material];
    const out = src.map((m) => {
      if (!m) return m;
      if (!swapped.has(m)) {
        const n = toLambert(m);
        if (dropMap) n.map = null;
        if (n.map) n.map.colorSpace = THREE.SRGBColorSpace;
        // A near-black base colour is the other way a prop becomes a hole.
        if (n.color) {
          const lum = 0.2126 * n.color.r + 0.7152 * n.color.g + 0.0722 * n.color.b;
          if (lum < 0.06) n.color.setHex(0x6a7183);
        }
        swapped.set(m, n);
      }
      return swapped.get(m);
    });
    o.material = Array.isArray(o.material) ? out : out[0];
    if (isCard(o.geometry)) o.material.side = THREE.DoubleSide;
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return root;
}

/**
 * Placement helper bound to this world.
 *
 * Each asset is fetched once, normalised once, then cloned per placement.
 * Clones share geometry, materials and textures, so dressing the range with
 * 70 pieces costs 70 draw calls rather than 70 copies of the mesh data.
 * Every load is catch-guarded: a 404 must cost a prop, never the match.
 */
function createKit(parent, boxes) {
  const jobs = [];
  let done = 0;

  /** Fetch + normalise one piece, memoised by url *and* normalisation options. */
  function baseFor(src, opts) {
    if (typeof src !== 'string' || !src) {
      console.error('range kit piece needs a url string, got', src);
      return Promise.resolve(null);
    }
    const key = [src, opts.height, opts.size, opts.tint, opts.emissive, opts.dropMap].join('|');
    if (!KIT_CACHE.has(key)) {
      const loader = src.endsWith('.fbx') ? loadFbx : src.endsWith('.obj') ? loadObj : loadGltf;
      KIT_CACHE.set(key, loader(src).then((loaded) => {
        const inst = instanceOf(loaded.scene || loaded);
        if (opts.height != null) normalizeScene(inst, opts.height);
        else fitToFootprint(inst, opts.size || 1);
        dePBR(inst, { dropMap: !!opts.dropMap });
        if (opts.tint != null) tint(inst, opts.tint);
        if (opts.emissive) {
          inst.traverse((o) => {
            if (!o.isMesh) return;
            for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
              if (m && m.emissive) m.emissive.setHex(opts.emissive);
            }
          });
        }
        return inst;
      }).catch((err) => {
        console.error('range kit piece failed', src, err);
        return null;
      }));
    }
    return KIT_CACHE.get(key);
  }

  /** Recolour a normalised prop, and lift it off the floor if it is authored dark. */
  function tint(root, color) {
    const c = new THREE.Color(color);
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m || !m.color) continue;
        const lum = 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b;
        // Multiplying a dark texture by a dark tint is how a prop disappears,
        // so the tint is normalised against the colour's own brightness.
        m.color.setRGB(
          c.r * (0.45 + 0.55 * lum),
          c.g * (0.45 + 0.55 * lum),
          c.b * (0.45 + 0.55 * lum),
        );
        m.needsUpdate = true;
      }
    });
    return root;
  }

  /**
   * Place one piece. `box: {w,h,d}` registers collision, so what stops a
   * bullet and what you can see are the same object by construction.
   */
  function spawn(src, opts = {}) {
    const {
      x = 0, z = 0, y = 0, rotY = 0, scale = 1, box = null, tag = 'solid',
    } = opts;
    if (box) boxes.push(makeBox(x, y + box.h / 2, z, box.w, box.h, box.d, tag));
    const job = baseFor(src, opts).then((proto) => {
      if (!proto) return null;
      const inst = instanceOf(proto);
      inst.position.set(x, y, z);
      inst.rotation.y = rotY;
      if (scale !== 1) inst.scale.multiplyScalar(scale);
      inst.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.receiveShadow = false;
        }
      });
      parent.add(inst);
      return inst;
    });
    jobs.push(job.then(() => { done += 1; }));
    return job;
  }

  return {
    put(src, opts = {}) { return spawn(src, opts); },
    progress() { return jobs.length ? done / jobs.length : 1; },
    settled() { return Promise.all(jobs); },
  };
}

export function buildGraybox(scene, seed = 7, renderer = null) {
  setTerrain(grayHeightAt);
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];

  const aniso = renderer && renderer.capabilities
    ? Math.min(8, renderer.capabilities.getMaxAnisotropy())
    : 1;

  const group = new THREE.Group();
  group.name = 'range';
  scene.add(group);
  const boxes = [];
  const anchors = { chests: [], floors: [], crystals: [], drops: [] };

  // Mass is merged into three meshes: lit concrete, unlit neon, and floor
  // paint. Everything else on the range is a clone or a point sprite.
  const mass = new Batch();
  const neon = new Batch();
  const paint = new Batch();

  /* --- night ------------------------------------------------------- *
   * A range you can measure has to be a range you can *see*, so the sky
   * is a graded ink dome with a magenta horizon bloom rather than a flat
   * black, and the fog is deep indigo instead of grey. Fog still has to
   * carry real depth cues: at 100m a target must read as nearer than the
   * backstop behind it.
   * ------------------------------------------------------------------ */
  scene.fog = new THREE.Fog(0x141c3c, 34, 430);

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x0a1132) },
      mid: { value: new THREE.Color(0x1d2b5e) },
      horizon: { value: new THREE.Color(0x74215c) },
      moonDir: { value: new THREE.Vector3(-0.45, 0.42, -0.79).normalize() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 moonDir;
      varying vec3 vDir;
      // Cheap value hash, only used for the star field.
      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      }
      void main() {
        float h = vDir.y;
        vec3 c = mix(mid, top, smoothstep(0.06, 0.85, h));
        c = mix(c, horizon, pow(max(0.0, 1.0 - abs(h) * 2.1), 2.0));
        // A cold bloom around the moon keeps one side of the sky alive.
        float m = max(0.0, dot(normalize(vDir), moonDir));
        c += vec3(0.16, 0.24, 0.44) * pow(m, 6.0);
        c += vec3(0.30, 0.10, 0.26) * pow(max(0.0, 1.0 - abs(h) * 5.0), 3.0);
        // Stars, only well above the horizon so the neon still wins low down.
        vec3 q = floor(vDir * 190.0);
        float s = hash(q);
        float star = step(0.9975, s) * smoothstep(0.05, 0.5, h);
        c += vec3(0.75, 0.85, 1.0) * star;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  // The dome has to enclose the moon and the skyline, and the camera's far
  // plane is 480 - so the radius is a real constraint, not a taste call. At
  // 320 the moon sat *outside* the dome and was never drawn at all.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 20), skyMat);
  sky.name = 'sky';
  group.add(sky);

  // The moon itself, a flat billboard: an unlit disc is the only thing in
  // this scene that is allowed to be pure white.
  //
  // Its placement is a consequence of the architecture, not a preference. The
  // gate gantries put their header bands across 27-36 degrees of elevation
  // from the firing line, and the top of a 78-degree frame is 39 - so a moon
  // at any "normal" height is behind the 10m sign for the entire first
  // impression. It hangs low and far instead, in the gap between the 50m
  // lintel and the target line, which is the one clear sightline downrange.
  const moon = new THREE.Mesh(
    new THREE.PlaneGeometry(52, 52),
    new THREE.MeshBasicMaterial({
      map: finish(moonCanvas(), { aniso }), transparent: true, depthWrite: false, fog: false,
    }),
  );
  moon.position.set(-152, 54, -280);
  moon.lookAt(0, 6, 0);
  group.add(moon);

  // Holographic skyline: a ring of towers past the range, well outside
  // GRAY_R so it can never be walked to, reached or shot at.
  const TOWERS = 84;
  // Instanced towers take their colour from `instanceColor`, so they must NOT
  // also ask for a per-vertex colour attribute the box geometry does not have.
  const towerMat = new THREE.MeshToonMaterial({ gradientMap: toonRamp() });
  const crownMat = new THREE.MeshBasicMaterial();
  const towers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), towerMat, TOWERS);
  const crowns = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), crownMat, TOWERS);
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const hue = [MAGENTA, CYAN, VIOLET, SAKURA];
    for (let i = 0; i < TOWERS; i++) {
      const ang = (i / TOWERS) * Math.PI * 2 + rng() * 0.05;
      const rad = 168 + rng() * 105;
      const h = 16 + rng() * 74;
      const w = 7 + rng() * 13;
      pos.set(Math.cos(ang) * rad, h / 2 - 6, Math.sin(ang) * rad);
      scl.set(w, h, w * (0.7 + rng() * 0.6));
      m.compose(pos, q, scl);
      towers.setMatrixAt(i, m);
      // A single neon band near the top of each tower: the "holographic"
      // read comes from the accent, not from the silhouette.
      scl.set(w * 1.06, 0.9 + rng() * 1.6, scl.z * 1.06);
      pos.y = h - 6 - rng() * h * 0.4;
      m.compose(pos, q, scl);
      crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, new THREE.Color(hue[i % hue.length]).multiplyScalar(0.5 + rng() * 0.4));
    }
    towers.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  }
  group.add(towers, crowns);

  /* --- ground ------------------------------------------------------- *
   * Black lacquer wet stone. The 10m measurement grid is *inlaid into the
   * texture* rather than drawn as lines on top, so it is part of the floor
   * instead of a debug overlay: one tile of the texture is one 10m cell,
   * mapped planar across the whole disc, which means the grid is exact.
   * ------------------------------------------------------------------ */
  const stoneCanvas = mkCanvas(256, 256);
  {
    const g = stoneCanvas.getContext('2d');
    g.fillStyle = '#4a5470';
    g.fillRect(0, 0, 256, 256);
    // mottling, so the lacquer is not a dead flat value
    for (let i = 0; i < 1100; i++) {
      const x = rng() * 256;
      const y = rng() * 256;
      const s = 2 + rng() * 18;
      g.globalAlpha = 0.05 + rng() * 0.12;
      g.fillStyle = rng() < 0.5 ? '#5c688c' : '#2c3450';
      g.fillRect(x, y, s, s * (0.3 + rng()));
    }
    g.globalAlpha = 1;
    // The inlaid 10m seam. This is the range's actual measuring scale, and it
    // has to survive being read at a grazing angle from 40m out, so the seam
    // is a real groove with a lit lip rather than a hairline.
    g.fillStyle = '#10141f';
    g.fillRect(0, 0, 256, 8);
    g.fillRect(0, 0, 8, 256);
    g.globalAlpha = 0.8;
    g.fillStyle = '#7fb2e8';
    g.fillRect(0, 8, 256, 3);
    g.fillRect(8, 0, 3, 256);
    g.globalAlpha = 0.35;
    g.fillStyle = '#c9dcff';
    g.fillRect(0, 8, 256, 1);
    g.fillRect(8, 0, 1, 256);
    g.globalAlpha = 1;
  }
  const stoneTex = finish(stoneCanvas, { aniso, repeat: true });
  stoneTex.repeat.set(14, 14);

  const groundGeo = new THREE.CircleGeometry(GRAY_R, 128);
  groundGeo.rotateX(-Math.PI / 2);
  {
    // Planar UVs in world units, so the texture tiles in metres and not in
    // polar coordinates (a CircleGeometry's own UVs smear at the rim).
    const pos = groundGeo.attributes.position;
    const uv = groundGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) + GRAY_R) / 20, (pos.getZ(i) + GRAY_R) / 20);
    }
    uv.needsUpdate = true;
  }
  const ground = new THREE.Mesh(groundGeo, skinMat({
    map: stoneTex, color: 0xffffff, emissive: 0x0d1220, emissiveIntensity: 1,
  }));
  ground.name = 'ground';
  group.add(ground);

  // What is past the edge: a black lacquer plate far below, so running off
  // the range drops you into a city rather than into nothing.
  const abyss = new THREE.Mesh(
    new THREE.CircleGeometry(320, 48),
    new THREE.MeshBasicMaterial({ color: VOID, fog: true }),
  );
  abyss.rotation.x = Math.PI / 2;
  abyss.position.y = -46;
  group.add(abyss);

  /* --- light -------------------------------------------------------- *
   * Moonlight plus a magenta bounce off the city. No shadow pass: the range
   * is a flat plane lit by a moon, shadows would buy almost nothing here and
   * cost a full extra render of the whole scene on a software rasteriser.
   * Form is carried instead by the baked per-slab gradient and by neon.
   *
   * The *budget* matters more than the rig. Four lights and a hemisphere at
   * "reasonable looking" intensities sum to an irradiance above 2.0, and at
   * that point every dark saturated colour in the palette clips toward white:
   * black lacquer turns navy and the magenta centreline turns lavender. A
   * night scene is a low total, cool-biased, with the neon carrying the
   * brightness. These sum to roughly 0.7 on an up-facing surface.
   * ------------------------------------------------------------------ */
  const hemi = new THREE.HemisphereLight(0x4a5f9e, 0x2a1030, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xd6e4ff, 0.85);
  sun.position.set(-52, 46, -74);
  scene.add(sun, sun.target);
  // A low magenta fill from behind the firing line and a cold cyan fill from
  // the left: two coloured rakes across the concrete, which is what stops a
  // night scene reading as a black rectangle with neon in it.
  const fill = new THREE.DirectionalLight(0xff5fa8, 0.3);
  fill.position.set(16, 9, 62);
  scene.add(fill, fill.target);
  const rim = new THREE.DirectionalLight(0x2ff3ff, 0.24);
  rim.position.set(-60, 14, -10);
  scene.add(rim, rim.target);
  scene.add(new THREE.AmbientLight(0x2a3358, 0.32));

  /* --- the lane ----------------------------------------------------- *
   * A polished strip down the middle of the range, flanked by two long
   * reflecting pools. The water is a black plate with a canvas of vertical
   * neon smears on it: without a reflection probe the honest cheap answer is
   * to *paint* the reflection, and painted vertical smears under a row of
   * neon strips is exactly what a wet surface looks like at a grazing angle.
   * ------------------------------------------------------------------ */
  const laneTex = (() => {
    const c = mkCanvas(128, 256);
    const g = c.getContext('2d');
    g.fillStyle = '#38425e';
    g.fillRect(0, 0, 128, 256);
    g.globalAlpha = 0.6;
    g.fillStyle = '#4d5a80';
    for (let i = 0; i < 80; i++) {
      g.fillRect(rng() * 128, rng() * 256, 1 + rng() * 4, 20 + rng() * 110);
    }
    g.globalAlpha = 1;
    return finish(c, { aniso, repeat: true });
  })();

  const lane = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 118),
    skinMat({ map: laneTex, color: 0xffffff, emissive: 0x0b1024 }),
  );
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, 0.02, -16);
  group.add(lane);

  const smear = (() => {
    const c = mkCanvas(64, 256);
    const g = c.getContext('2d');
    g.fillStyle = '#000000';
    g.fillRect(0, 0, 64, 256);
    const hues = [[255, 45, 149], [47, 243, 255], [255, 158, 203], [255, 196, 107]];
    for (let i = 0; i < 46; i++) {
      const hue = hues[Math.floor(rng() * hues.length) % hues.length];
      const x = rng() * 64;
      const w = 2 + rng() * 7;
      g.globalAlpha = 0.16 + rng() * 0.5;
      g.fillStyle = `rgb(${hue[0]},${hue[1]},${hue[2]})`;
      // Vertical smears, brighter at the top, which is where the neon is.
      const h = 60 + rng() * 190;
      g.fillRect(x, 0, w, h);
      g.globalAlpha *= 0.4;
      g.fillRect(x + 1, h, w, 256 - h);
    }
    g.globalAlpha = 1;
    return finish(c, { aniso, repeat: true });
  })();

  const pools = [];
  for (const side of [-1, 1]) {
    // The pool sits outboard of the gate pylons, so the strip between the
    // lane and the water stays walkable: 11m to 19m on each side.
    const cx = side * 23.5;
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 84),
      new THREE.MeshBasicMaterial({ color: 0x02030a }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(cx, 0.03, -14);
    group.add(plate);
    const t = smear.clone();
    t.needsUpdate = true;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 3);
    const refl = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 84),
      new THREE.MeshBasicMaterial({
        map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    refl.rotation.x = -Math.PI / 2;
    refl.position.set(cx, 0.05, -14);
    group.add(refl);
    pools.push(plate, refl);
    // The kerb that turns a puddle into a piece of architecture.
    mass.box(side * 27.6, 0, -14, 1.2, 0.5, 84, CONCRETE);
    boxes.push(makeBox(side * 27.6, 0.25, -14, 1.2, 0.5, 84, 'wall'));
    neon.box(side * 27.0, 0.5, -14, 0.16, 0.06, 84, CYAN, { grade: 0 });
  }

  /* --- air ---------------------------------------------------------- *
   * Ground mist and falling petals, animated from `onBeforeRender` - the
   * only per-frame hook a world object gets without the engine owning a
   * clock for it: three calls it immediately before every draw, so the
   * range can breathe without match.js knowing it exists.
   *
   * The mist is a row of upright banks, not a stack of horizontal sheets. A
   * horizontal plane below eye height is seen at a grazing angle, and at
   * 0.3m under the lens it smears into a hard-edged trapezoid across the
   * lower half of the frame - it reads as a pale road, not as air. Upright
   * banks have no horizon-parallel edge to give them away.
   * ------------------------------------------------------------------ */
  const mistTex = finish(blobCanvas(128, [168, 206, 255], 2.2), { aniso: 1 });
  const mistMat = new THREE.MeshBasicMaterial({
    map: mistTex, transparent: true, opacity: 0.14, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: true,
  });
  const mist = [];
  for (let i = 0; i < 12; i++) {
    const w = 26 + rng() * 30;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.34), mistMat);
    m.position.set((rng() - 0.5) * 46, 1.3 + rng() * 2.4, 30 - i * 8.4 - rng() * 5);
    m.renderOrder = 6;
    m.onBeforeRender = (r, s, cam) => {
      const t = (typeof performance !== 'undefined' ? performance.now() : 0) * 0.001;
      m.position.x += Math.sin(t * 0.06 + m.position.z) * 0.004;
    };
    group.add(m);
    mist.push(m);
  }

  const PETALS = 900;
  const petalState = {
    pos: new Float32Array(PETALS * 3),
    fall: new Float32Array(PETALS),
    drift: new Float32Array(PETALS),
    phase: new Float32Array(PETALS),
    last: 0,
  };
  for (let i = 0; i < PETALS; i++) {
    petalState.pos[i * 3] = (rng() - 0.5) * 74;
    petalState.pos[i * 3 + 1] = rng() * 17;
    petalState.pos[i * 3 + 2] = 34 - rng() * 116;
    petalState.fall[i] = 0.5 + rng() * 0.85;
    petalState.drift[i] = 0.25 + rng() * 0.7;
    petalState.phase[i] = rng() * 6.283;
  }
  const petalGeo = new THREE.BufferGeometry();
  petalGeo.setAttribute('position', new THREE.BufferAttribute(petalState.pos, 3));
  const petalMat = new THREE.PointsMaterial({
    map: finish(petalCanvas(), { aniso: 1 }),
    size: 0.34,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    opacity: 0.85,
    color: 0xffb7d8,
    fog: true,
  });
  const petals = new THREE.Points(petalGeo, petalMat);
  petals.frustumCulled = false;
  petals.name = 'petals';
  petals.onBeforeRender = () => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const dt = petalState.last ? Math.min(0.05, (now - petalState.last) * 0.001) : 0.016;
    petalState.last = now;
    const p = petalState.pos;
    for (let i = 0; i < PETALS; i++) {
      const j = i * 3;
      p[j + 1] -= petalState.fall[i] * dt;
      if (p[j + 1] < 0) {
        p[j + 1] = 16 + (i % 7) * 0.3;
        p[j] = (rng() - 0.5) * 74;
        p[j + 2] = 34 - rng() * 116;
      }
      p[j] += Math.sin(now * 0.0004 + petalState.phase[i]) * petalState.drift[i] * dt;
      p[j + 2] += Math.cos(now * 0.00031 + petalState.phase[i]) * petalState.drift[i] * dt * 0.6;
    }
    petalGeo.attributes.position.needsUpdate = true;
  };
  group.add(petals);

  /* --- the firing line ---------------------------------------------- *
   * The player spawns at z = 34 looking down -Z, so "downrange" is -Z and a
   * gate at N metres sits at z = 34 - N. Everything structural stands
   * off-centre or above 1.5m, because the one thing this lane may never
   * have is something in the way between the muzzle and the target.
   * ------------------------------------------------------------------ */
  const LANE_HALF = 7;

  // Two continuous neon rails down the full length of the lane: the primary
  // wayfinding device, and the thing that gives 100m a vanishing point.
  for (const side of [-1, 1]) {
    neon.box(side * LANE_HALF, 0.03, -17, 0.22, 0.05, 112, CYAN, { grade: 0 });
  }
  // A dashed magenta centreline, painted rather than lit: it marks the firing
  // axis without competing with the gates for attention.
  //
  // Kept deliberately thin. This is the closest thing in the scene to the
  // camera and the bottom of the frame is exactly where the player's eye
  // rests, so a wide, saturated dash here becomes the subject of the picture
  // rather than a guide to it.
  for (let z = 28; z > -70; z -= 8) {
    paint.box(0, 0.025, z, 0.14, 0.04, 2.2, 0x6b2a52, { grade: 0 });
  }
  // A hazard apron on the deck at the firing line. The lower third of the
  // frame is otherwise bare stone at the one spot the player always looks at,
  // and this is what a real range puts there.
  for (let i = -5; i <= 5; i++) {
    paint.add(new THREE.BoxGeometry(0.42, 0.04, 3.0), 0x7d2f5c, {
      x: i * 1.55, y: 0.02, z: GRAY_SPAWN.z - 2.6, ry: 0.62, grade: 0,
    });
  }
  paint.box(0, 0.02, GRAY_SPAWN.z - 4.4, 17, 0.04, 0.22, 0x9c3a6e, { grade: 0 });

  // The 10m measuring grid, as geometry rather than as texture.
  //
  // It is inlaid in the stone texture as well, and that is not enough: at the
  // grazing angle this view has, a 0.3m line in a 10m texture tile lands on a
  // high mip level and dissolves. The grid is the one thing on this map whose
  // whole job is to be read at a distance, so it is drawn as real strips in
  // the paint batch, 3.5cm proud of the lane so it crosses the polished
  // strip too rather than vanishing under it.
  for (let z = 30; z >= -60; z -= 10) {
    paint.box(0, 0.035, z, 62, 0.02, 0.22, 0x51689a, { grade: 0 });
  }
  for (const gx of [-30, -20, -10, 10, 20, 30]) {
    paint.box(gx, 0.035, -15, 0.22, 0.02, 90, 0x51689a, { grade: 0 });
  }

  /* --- the measured gates ------------------------------------------- *
   * One brutalist gantry per gate: two monolithic pylons, a deep lintel,
   * a colour-coded light box, and the distance in numerals big enough to
   * read from the firing line. A target at 100m now has a lit gate frame
   * behind it instead of an empty grey backdrop, which is the difference
   * between a lane you can measure and a lane you squint at.
   * ------------------------------------------------------------------ */
  GRAY_GATES.forEach((m, i) => {
    const z = zAt(m);
    const hue = GATE_HUE[i];

    // floor stripe, in the gate's own colour
    neon.box(0, 0.04, z, 19, 0.06, 0.5, hue, { grade: 0 });
    paint.box(0, 0.03, z + 0.6, 19, 0.04, 0.16, 0x1a2036, { grade: 0 });

    for (const side of [-1, 1]) {
      const x = side * 9.5;
      // The pylon, plus a buttress fin so it reads as structure and not a post
      mass.box(x, 0, z, 1.9, 11.0, 2.4, CONCRETE);
      mass.box(x + side * 1.5, 0, z, 1.1, 8.0, 3.4, CONCRETE_HI);
      mass.box(x, 11.0, z, 2.6, 0.7, 3.0, CONCRETE_HI);
      boxes.push(makeBox(x, 5.5, z, 1.9, 11.0, 2.4, 'wall'));
      boxes.push(makeBox(x + side * 1.5, 4.0, z, 1.1, 8.0, 3.4, 'wall'));
      // a recessed neon slot up the inner face
      neon.box(x - side * 0.98, 0.7, z, 0.12, 9.4, 1.5, hue, { grade: 0 });
      neon.box(x, 0.9, z + 1.24, 1.5, 0.1, 0.1, CYAN, { grade: 0 });
    }

    // The lintel, 9.8m up. It gets **no collision box**, and that is not an
    // oversight: `floorAt` in the combat code is a 2D query that returns the
    // highest box overlapping the player's footprint without ever asking
    // whether the player is above or below it. A collidable lintel is
    // therefore not a lintel, it is a floor - and the shooter spawns under
    // one. Overhead structure is decoration; only grounded mass is solid.
    mass.box(0, 9.8, z, 22.5, 1.6, 2.6, CONCRETE);
    mass.box(0, 11.4, z, 19.5, 0.6, 3.2, CONCRETE_HI);
    // The light box: everything here is offset toward the firing line (+Z),
    // because that is the only side of the gantry anyone ever stands on.
    neon.box(0, 9.7, z + 1.35, 21.4, 0.42, 0.14, hue, { grade: 0 });
    neon.box(0, 10.32, z + 1.35, 21.4, 0.1, 0.12, 0xffffff, { grade: 0 });

    // The numeral, as a header band slung under the lintel.
    //
    // Its height is the whole composition, and it is a hard geometric
    // constraint rather than a taste call. At the 10m gate the top of a 78deg
    // frame is only 9.7m above the eye, so a band centred at 8.6m is half off
    // the top of the screen from the one position the player always starts in.
    // Centred at 7.0m it sits in the top eighth of the frame there, and at
    // 100m the whole gantry is small enough that it does not matter.
    mass.box(0, 5.95, z + 1.2, 10.0, 1.85, 0.35, 0x0d1120, { grade: 0.4 });
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(9.3, 1.66),
      new THREE.MeshBasicMaterial({ map: bandTexture(`${m}`, hue), toneMapped: false }),
    );
    sign.position.set(0, 7.0, z + 1.42);
    group.add(sign);

    // The distance, painted on the deck as well as lit on the gantry.
    //
    // This is the floor doing the map's actual job. A gantry band is read
    // once, from the firing line; a numeral lying on the ground stays legible
    // from any angle and at any distance, and foreshortening is what makes it
    // read as *distance* rather than as a label.
    for (const side of [-1, 1]) {
      const num = new THREE.Mesh(
        new THREE.PlaneGeometry(3.4, 4.4),
        new THREE.MeshBasicMaterial({
          map: tagTexture(`${m}`, hue), transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending, toneMapped: false,
        }),
      );
      num.rotation.x = -Math.PI / 2;
      num.position.set(side * 4.9, 0.05, z + 3.4);
      group.add(num);
    }

    // The lit backdrop is a wall only where nothing stands behind the gate.
    // target you squint at - but only where nothing stands *behind* the gate,
    // because a wall behind the 10m gate would hide the 25m stack and a wall
    // behind the 75m gate would hide the 100m gantry. So the big backdrop
    // lives at the far end only, where the range ends anyway; every other
    // gate is framed by its open gantry instead.
    if (m === 100) {
      mass.box(0, 0, z - 2.4, 27, 10.5, 2.4, CONCRETE);
      mass.box(0, 10.5, z - 2.4, 28.4, 1.2, 3.4, CONCRETE_HI);
      for (const s of [-1, 1]) {
        mass.box(s * 14.2, 0, z - 2.4, 2.0, 13.0, 3.4, LACQUER);
        mass.box(s * 11.0, 0, z - 0.4, 1.2, 8.0, 1.6, CONCRETE_HI);
      }
      boxes.push(makeBox(0, 5.25, z - 2.4, 27, 10.5, 2.4, 'wall'));
      neon.box(0, 0.3, z - 1.15, 26, 0.3, 0.14, hue, { grade: 0 });
      neon.box(0, 9.7, z - 1.15, 26, 0.3, 0.14, hue, { grade: 0 });
      for (const s of [-1, 1]) {
        neon.box(s * 9.6, 0.5, z - 1.1, 0.26, 8.8, 0.14, hue, { grade: 0 });
        neon.box(s * 12.6, 0.5, z - 0.1, 0.18, 8.0, 0.12, CYAN, { grade: 0 });
      }
      // A monumental seal over the long shot: the thing you are shooting at
      // 100m has a 100m monument behind it.
      const seal = new THREE.Mesh(
        new THREE.PlaneGeometry(9, 4.5),
        new THREE.MeshBasicMaterial({ map: signTexture('100', 'LONG RANGE', hue), toneMapped: false }),
      );
      seal.position.set(0, 6.2, z - 1.05);
      group.add(seal);
    }
  });

  /* --- the range house ---------------------------------------------- *
   * The firing line is a piece of architecture rather than a spawn point:
   * two buttressed pylons flanking the shooter and a deep lintel overhead,
   * all of it above 1.5m or off the centre so the lane stays open.
   * ------------------------------------------------------------------ */
  for (const side of [-1, 1]) {
    const x = side * 13;
    mass.box(x, 0, 36, 5.2, 11.5, 13, LACQUER);
    mass.box(x + side * 3.1, 0, 36, 1.6, 8.0, 15, CONCRETE);
    mass.box(x, 11.5, 36, 6.4, 1.0, 14, CONCRETE_HI);
    boxes.push(makeBox(x, 5.75, 36, 5.2, 11.5, 13, 'wall'));
    boxes.push(makeBox(x + side * 3.1, 4.0, 36, 1.6, 8.0, 15, 'wall'));
    // vertical neon fins up the pylon face, the signature of the whole map
    for (let i = 0; i < 3; i++) {
      neon.box(x - side * 2.65, 1.2, 31.5 + i * 4.4, 0.14, 8.4, 0.5, i === 1 ? MAGENTA : CYAN, { grade: 0 });
    }
    neon.box(x, 11.4, 36, 6.4, 0.12, 14, MAGENTA, { grade: 0 });
  }
  // the overhead lintel. No collision: see the note on the gate lintels.
  mass.box(0, 12.5, 36, 34, 2.4, 5.0, CONCRETE);
  neon.box(0, 12.4, 33.4, 32, 0.3, 0.2, CYAN, { grade: 0 });
  neon.box(0, 12.4, 38.6, 32, 0.3, 0.2, CYAN, { grade: 0 });

  // The painted firing line itself, so muzzle-to-target distance is measured
  // from something visible rather than from an assumed origin. Corner ticks
  // rather than a closed box: a rectangle on the floor at four metres reads
  // as a floor graphic, four ticks read as a sight.
  neon.box(0, 0.04, GRAY_SPAWN.z, 15, 0.06, 0.34, 0xffffff, { grade: 0 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      paint.box(sx * 7.2, 0.03, GRAY_SPAWN.z + sz * 1.6, 1.5, 0.04, 0.26, 0x9c3a6e, { grade: 0 });
      paint.box(sx * 7.85, 0.03, GRAY_SPAWN.z + sz * 0.85, 0.26, 0.04, 1.7, 0x9c3a6e, { grade: 0 });
    }
  }

  // A backstop behind the shooter, so a shot that misses over their shoulder
  // hits something. That is how you notice stray pellets.
  mass.box(0, 0, 52, 80, 9, 3, CONCRETE);
  mass.box(0, 9, 52, 82, 1.2, 4.4, CONCRETE_HI);
  boxes.push(makeBox(0, 4.5, 52, 80, 9, 3, 'wall'));
  neon.box(0, 8.85, 50.4, 76, 0.3, 0.2, MAGENTA, { grade: 0 });

  /* --- gun stands --------------------------------------------------- *
   * Every gun on its own plinth at the firing line, so swapping is a walk
   * rather than a menu, and a pickup bug is impossible to miss. `gun`/`ammo`
   * are read by match.js's graybox loot spawner, which places exactly what
   * the anchor asks for instead of rolling a random pickup.
   * ------------------------------------------------------------------ */
  const plinths = [];
  Object.values(GUNS).forEach((g, i) => {
    const x = -8 + i * 4;
    // A chrome weapon table on a recessed plinth. The whole bench sits *behind*
    // the shooter (z > spawn.z), so everything readable on it faces -Z.
    mass.box(x, 0, GRAY_SPAWN.z + 5, 1.9, 0.72, 1.9, CONCRETE);
    mass.box(x, 0.72, GRAY_SPAWN.z + 5, 2.2, 0.18, 2.2, CHROME);
    boxes.push(makeBox(x, 0.45, GRAY_SPAWN.z + 5, 1.9, 0.9, 1.9, 'solid'));
    neon.box(x, 0.6, GRAY_SPAWN.z + 4.02, 1.7, 0.1, 0.08, i % 2 ? MAGENTA : CYAN, { grade: 0 });
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.3),
      new THREE.MeshBasicMaterial({
        map: signTexture(g.name.toUpperCase(), g.kind.toUpperCase(), i % 2 ? MAGENTA : CYAN),
        toneMapped: false,
      }),
    );
    plate.position.set(x, 1.9, GRAY_SPAWN.z + 6.05);
    plate.rotation.y = Math.PI;
    group.add(plate);
    mass.box(x, 0.9, GRAY_SPAWN.z + 6.2, 0.22, 2.0, 0.22, STEEL);
    anchors.floors.push({ x, y: 0.9, z: GRAY_SPAWN.z + 5, poi: 'range', gun: g.id });
    plinths.push({ id: g.id, x, y: 0.9, z: GRAY_SPAWN.z + 5 });
  });

  // A one-tap ammo bench behind the plinths, so you can top up without ever
  // leaving the range.
  mass.box(0, 0, GRAY_SPAWN.z + 9.5, 16, 0.55, 1.5, CONCRETE);
  mass.box(0, 0.55, GRAY_SPAWN.z + 9.5, 16.4, 0.16, 1.8, CHROME);
  boxes.push(makeBox(0, 0.355, GRAY_SPAWN.z + 9.5, 16, 0.71, 1.5, 'solid'));
  neon.box(0, 0.5, GRAY_SPAWN.z + 8.72, 15.6, 0.12, 0.1, CYAN, { grade: 0 });
  ['light', 'medium', 'heavy', 'shells'].forEach((t, i) => {
    const x = -6 + i * 4;
    mass.box(x, 0.71, GRAY_SPAWN.z + 9.5, 1.1, 0.3, 0.9, STEEL);
    mass.box(x, 0.71, GRAY_SPAWN.z + 10.15, 0.14, 0.9, 0.14, STEEL);
    const tag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.75),
      new THREE.MeshBasicMaterial({ map: signTexture(t.toUpperCase(), 'AMMO', CYAN), toneMapped: false }),
    );
    tag.position.set(x, 1.55, GRAY_SPAWN.z + 10.05);
    tag.rotation.y = Math.PI;
    group.add(tag);
    anchors.floors.push({ x, y: 0.71, z: GRAY_SPAWN.z + 9.5, poi: 'range', ammo: t });
  });

  /* --- perimeter ---------------------------------------------------- *
   * A ring of brutalist buttresses at r = 69, so "I cannot leave the range"
   * is a fact about the level rather than a rule you have to be told. It
   * sits inside GRAY_R, on flat ground, and its far arc is 103m from the
   * firing line - past the 100m gate, so it frames the longest shot
   * instead of shortening it.
   * ------------------------------------------------------------------ */
  const RING = 40;
  for (let i = 0; i < RING; i++) {
    const th = (i / RING) * Math.PI * 2;
    const cx = Math.cos(th) * 69;
    const cz = Math.sin(th) * 69;
    const ry = -(th + Math.PI / 2);
    const tall = 5.4 + (i % 3) * 1.5;
    mass.box(cx, 0, cz, 10.4, tall, 2.6, i % 2 ? CONCRETE : CONCRETE_HI, { ry });
    boxes.push(makeBox(cx, tall / 2, cz, 10.4, tall, 2.6, 'wall'));
    if (i % 2 === 0) {
      // a buttress fin on every other segment, and a neon cap on all of them
      const bx = Math.cos(th) * 71.4;
      const bz = Math.sin(th) * 71.4;
      mass.box(bx, 0, bz, 1.4, tall * 0.8, 4.2, LACQUER, { ry });
      boxes.push(makeBox(bx, tall * 0.4, bz, 1.4, tall * 0.8, 4.2, 'wall'));
    }
    mass.add(new THREE.BoxGeometry(10.4, 0.16, 2.8), i % 2 ? CYAN : MAGENTA, {
      x: cx, y: tall + 0.16, z: cz, ry, grade: 0,
    });
  }

  /* --- cover, in the four heights that matter ----------------------- *
   * Low (below the 1.15m crouch eye line), waist, chest and full. They
   * stand on the flank, well outside the lane, because a piece of cover
   * that blocks the lane blocks the measurement.
   * ------------------------------------------------------------------ */
  const COVER = [0.7, 1.0, 1.4, 2.2];
  COVER.forEach((h, i) => {
    const x = -26 - i * 5;
    const z = zAt(15);
    mass.box(x, 0, z, 3.4, h, 1.4, CONCRETE);
    mass.box(x, h, z, 3.8, 0.18, 1.8, CONCRETE_HI);
    boxes.push(makeBox(x, h / 2, z, 3.4, h, 1.4, 'cover'));
    neon.box(x, h + 0.19, z, 3.4, 0.06, 0.12, CYAN, { grade: 0 });
    const tag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 0.7),
      new THREE.MeshBasicMaterial({ map: signTexture(h.toFixed(1), 'COVER', CYAN), toneMapped: false }),
    );
    tag.position.set(x, h + 0.9, z + 0.95);
    group.add(tag);
  });

  /* --- movement rig -------------------------------------------------- *
   * Traversal bugs (step-up, mantle, slide) only reproduce on geometry
   * with a real height change, so the range keeps a staircase, a single
   * step, a 1m ledge and a vault-height wall - all on the flank, all
   * outside the lane.
   * ------------------------------------------------------------------ */
  for (let s = 0; s < 8; s++) {
    const h = 0.25 * (s + 1);
    const z = zAt(30) - s * 1.3;
    mass.box(-31, 0, z, 4.4, h, 1.3, CONCRETE);
    boxes.push(makeBox(-31, h / 2, z, 4.4, h, 1.3, 'solid'));
  }
  mass.box(31, 0, zAt(20), 5, 0.4, 5, CONCRETE);          // one small step
  boxes.push(makeBox(31, 0.2, zAt(20), 5, 0.4, 5, 'solid'));
  mass.box(31, 0, zAt(28), 6, 1.0, 6, CONCRETE);           // the classic mantle
  boxes.push(makeBox(31, 0.5, zAt(28), 6, 1.0, 6, 'solid'));
  neon.box(31, 1.02, zAt(28), 6, 0.06, 0.14, MAGENTA, { grade: 0 });
  mass.box(-31, 0, zAt(20), 4, 0.9, 0.6, CONCRETE);        // a wall to vault
  boxes.push(makeBox(-31, 0.45, zAt(20), 4, 0.9, 0.6, 'solid'));
  // A roof to test vertical fights, held on real pillars so there is cover
  // underneath rather than an empty floating slab. The roof is a canopy: it
  // is 4.2m up, so it carries no collision (see the gate lintels) and the
  // crate stack beside it is a step-up test in its own right.
  const roofY = 4.2;
  const roofZ = zAt(35);
  mass.box(36, roofY, roofZ, 11, 0.5, 11, CONCRETE);
  for (const [px, pz] of [[31.6, roofZ - 4.4], [40.4, roofZ - 4.4], [31.6, roofZ + 4.4], [40.4, roofZ + 4.4]]) {
    mass.box(px, 0, pz, 0.8, roofY, 0.8, CONCRETE_HI);
    boxes.push(makeBox(px, roofY / 2, pz, 0.8, roofY, 0.8, 'wall'));
  }
  for (let c = 0; c < 3; c++) {
    mass.box(36, c * 1.0, roofZ - 8.5 - c * 1.2, 1.2, 1.0, 1.2, STEEL);
    boxes.push(makeBox(36, c * 1.0 + 0.5, roofZ - 8.5 - c * 1.2, 1.2, 1.0, 1.2, 'solid'));
  }
  neon.box(36, roofY - 0.05, roofZ - 5.4, 11, 0.1, 0.16, CYAN, { grade: 0 });

  /* --- the flank: bunkers, terraces, and the 50m riser's cover -------- */
  // Brutalist service bunkers stepping down both sides of the range. They
  // give the eye something with *scale* between the shooter and the 100m
  // gate, which is what makes 100m read as 100m.
  const BUNKERS = [
    [-36, 26, 1.0], [-47, 8, 0.8], [39, 30, 0.9], [48, 6, 0.7],
    [-34, 2, 0.85], [37, -12, 1.0], [-43, -22, 0.75], [35, -30, 0.9],
    [-34, -38, 1.0], [41, -44, 0.8],
  ];
  for (const [x, z, s] of BUNKERS) {
    const w = 9 * s;
    const d = 7 * s;
    const h = 4.6 * s;
    // "Inboard" is whichever way faces the lane, derived from the sign rather
    // than authored per-bunker, so a terrace can never end up behind a wall.
    const inb = x < 0 ? 1 : -1;
    mass.box(x, 0, z, w, h, d, CONCRETE);
    mass.box(x, h, z, w + 1.2, 0.6 * s, d + 1.2, CONCRETE_HI);
    mass.box(x - inb * (w / 2 + 0.5), 0, z, 1.1 * s, h * 0.8, d * 0.7, LACQUER);
    mass.box(x + inb * (w / 2 + 0.06), 1.2, z, 0.16, h * 0.5, d * 0.28, 0x1a2036);
    boxes.push(makeBox(x, h / 2, z, w, h, d, 'wall'));
    boxes.push(makeBox(x - inb * (w / 2 + 0.5), h * 0.4, z, 1.1 * s, h * 0.8, d * 0.7, 'wall'));
    neon.box(x + inb * (w / 2 + 0.12), 1.3, z, 0.1, h * 0.45, 0.5, MAGENTA, { grade: 0 });
    neon.box(x, h + 0.62, z, w * 0.8, 0.08, 0.14, CYAN, { grade: 0 });
    // two steps on the lane side, which is where the kit dressing stands
    for (let s2 = 0; s2 < 2; s2++) {
      mass.box(x + inb * (w / 2 + 1.2 + s2 * 1.1), 0, z + 1.5, 1.1, (2 - s2) * 0.4, d * 0.8, CONCRETE_HI);
    }
  }

  // The cover the 50m riser pops out from behind. It is deliberately short
  // and off-axis: enough to break the shot, not enough to hide the target.
  mass.box(6, 0, zAt(50) - 1.5, 3.4, 1.15, 1.2, CONCRETE);
  mass.box(6, 1.15, zAt(50) - 1.5, 3.8, 0.16, 1.6, CONCRETE_HI);
  boxes.push(makeBox(6, 0.575, zAt(50) - 1.5, 3.4, 1.15, 1.2, 'cover'));
  neon.box(6, 1.32, zAt(50) - 1.5, 3.4, 0.06, 0.12, GOLD, { grade: 0 });
  // The riser's own shaft: two guide rails the target visibly travels between.
  for (const s of [-1, 1]) {
    mass.box(6 + s * 1.5, 0, zAt(50) - 4.6, 0.4, 4.2, 0.4, STEEL);
    neon.box(6 + s * 1.5, 0.2, zAt(50) - 4.4, 0.12, 3.8, 0.1, GOLD, { grade: 0 });
  }
  mass.box(6, 4.2, zAt(50) - 4.6, 3.4, 0.4, 0.6, CONCRETE_HI);
  neon.box(6, 4.18, zAt(50) - 4.35, 3.0, 0.1, 0.1, GOLD, { grade: 0 });

  /* --- target dummies ----------------------------------------------- *
   * Dummies are ordinary bots in the eyes of the combat code. They are
   * pushed onto the bot list with `dummy: true`, which match.js honours by
   * skipping their AI and pinning them in place. A shot at a dummy
   * therefore travels the same raycast, takes the same damage falloff and
   * raises the same hitmarker as a shot at a player, so a TTK measured here
   * is the TTK the island will produce. A bespoke dummy actor would drift
   * from the real numbers the moment either changed.
   *
   * The *visual* is built to the same numbers the hit test uses: the torso
   * is sized to the 0.42 body sphere at h*0.5 and the head is a 0.22 orb at
   * h*0.9, so what the player sees is what the raycast hits. The head is
   * unlit white-cyan against a dark chrome body, ringed and haloed, because
   * at 100m a 0.22m sphere is about one pixel of angle and a headshot has
   * to be *legible* to be worth anything.
   * ------------------------------------------------------------------ */
  const dummies = [];
  const dummyVisuals = [];
  const haloMat = new THREE.MeshBasicMaterial({
    map: finish(blobCanvas(64, [190, 250, 255], 2.4), { aniso: 1 }),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  });

  const bill = (o) => {
    o.onBeforeRender = (r, s, cam) => { o.lookAt(cam.position); };
  };

  /** One target. Returns the descriptor match.js turns into a bot. */
  function dummy(x, z, opts = {}) {
    const h = opts.h ?? 1.7;
    const accent = opts.accent ?? MAGENTA;
    const b = {
      x, y: opts.y ?? 0, z, h,
      hp: opts.hp ?? 100,
      shield: opts.shield ?? 0,
      label: opts.label || '',
    };
    if (opts.motion) b.motion = opts.motion;
    dummies.push(b);

    const g = new THREE.Group();
    g.position.set(b.x, b.y, b.z);
    group.add(g);
    dummyVisuals.push(g);

    const solid = new Batch();
    const lit = new Batch();

    // The stand: a machined base and a mast, so a target reads as range
    // equipment rather than as a person who wandered onto the lane. The base
    // is deliberately wider than the 0.42 hit sphere, because at 100m the
    // thing that tells the player a target is *there* is the pool of light
    // on the floor, not the eight pixels of body above it.
    solid.add(new THREE.CylinderGeometry(0.52, 0.42, 0.14, 12), 0x5d6a8c, { y: 0.07 });
    solid.add(new THREE.CylinderGeometry(0.10, 0.13, 0.22, 6), 0x4a5470, { y: 0.22 });
    lit.add(new THREE.TorusGeometry(0.86, 0.05, 5, 22), accent, { y: 0.04, rx: Math.PI / 2, grade: 0 });
    lit.add(new THREE.TorusGeometry(0.66, 0.03, 5, 20), accent, { y: 0.04, rx: Math.PI / 2, grade: 0 });

    // The torso, sized to the body sphere: a hard six-sided prism.
    const torsoH = h * 0.56;
    const torsoY = 0.32 + torsoH / 2;
    solid.add(new THREE.CylinderGeometry(0.40, 0.30, torsoH, 6), 0x6d7ba6, { y: torsoY });
    solid.add(new THREE.BoxGeometry(0.86, 0.13, 0.32), 0xa8b6d4, { y: torsoY + torsoH / 2 + 0.04 });
    solid.add(new THREE.CylinderGeometry(0.08, 0.08, 0.16, 6), 0x4a5470, { y: torsoY + torsoH / 2 + 0.16 });
    // Lit trim up the front and back of the prism, so the body is a bright
    // vertical bar at distance instead of a dark lozenge.
    lit.add(new THREE.BoxGeometry(0.70, 0.07, 0.40), accent, { y: torsoY - torsoH / 2 + 0.06, grade: 0 });
    lit.add(new THREE.BoxGeometry(0.70, 0.07, 0.40), accent, { y: torsoY + torsoH / 2 - 0.06, grade: 0 });
    lit.add(new THREE.BoxGeometry(0.10, torsoH * 0.86, 0.44), accent, { y: torsoY, grade: 0 });
    lit.add(new THREE.BoxGeometry(0.20, 0.22, 0.07), 0xffffff, { y: torsoY + 0.06, z: 0.33, grade: 0 });
    for (const s of [-1, 1]) {
      lit.add(new THREE.BoxGeometry(0.30, 0.05, 0.30), accent, {
        x: s * 0.34, y: torsoY + torsoH / 2 + 0.10, grade: 0,
      });
    }

    // The head: exactly the hit sphere, plus a ring and a halo that make it
    // findable at a hundred metres.
    lit.add(new THREE.SphereGeometry(0.22, 12, 10), 0xf2feff, { y: h * 0.9, grade: 0 });
    lit.add(new THREE.TorusGeometry(0.30, 0.055, 5, 16), accent, { y: h * 0.9, rx: Math.PI / 2, grade: 0 });
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), haloMat);
    halo.position.set(0, h * 0.9, 0);
    bill(halo);
    g.add(halo);

    if (opts.shield) {
      // A deployable shield puck, drawn as a lit frame so it reads as a
      // different kind of target from the first pixel.
      for (const s of [-1, 1]) {
        lit.add(new THREE.BoxGeometry(0.07, 1.5, 0.07), CYAN, { x: s * 0.62, y: 0.95, z: 0.52, grade: 0 });
      }
      lit.add(new THREE.BoxGeometry(1.3, 0.07, 0.07), CYAN, { y: 1.68, z: 0.52, grade: 0 });
      lit.add(new THREE.BoxGeometry(1.3, 0.07, 0.07), CYAN, { y: 0.22, z: 0.52, grade: 0 });
    }
    if (opts.hp >= 250) {
      // Armour: extra plate, heavier base. It has to be obvious at a glance
      // which of the two 50m targets is the one that will not die.
      solid.add(new THREE.BoxGeometry(1.0, 0.5, 0.42), 0x3b4459, { y: torsoY + 0.1 });
      lit.add(new THREE.BoxGeometry(1.02, 0.08, 0.44), MAGENTA, { y: torsoY + 0.34, grade: 0 });
      solid.add(new THREE.CylinderGeometry(0.5, 0.42, 0.2, 8), 0x4a5470, { y: 0.16 });
    }

    const bodyMesh = solid.build(massMat(), 'dummy-body');
    const litMesh = lit.build(glowMat(), 'dummy-lit');
    if (bodyMesh) g.add(bodyMesh);
    if (litMesh) g.add(litMesh);

    if (opts.label) {
      // The lane name goes on the *deck*, not in the air.
      //
      // Thirteen floating plates all sit within a metre of eye height, so from
      // the firing line they collapse into a single horizontal smear across
      // the middle of the frame - precisely where the targets are. Laid flat
      // in front of each target they spread downrange instead, they fill deck
      // that was otherwise bare, and foreshortening makes them read as
      // distance rather than as a label. A real range marks its lanes on the
      // floor for the same reason.
      const tag = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2, 0.9),
        new THREE.MeshBasicMaterial({
          map: tagTexture(opts.label, accent), transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending, toneMapped: false,
        }),
      );
      tag.rotation.x = -Math.PI / 2;
      tag.position.set(0, 0.06, 1.5);
      g.add(tag);
    }
    return b;
  }

  // One dummy dead centre at every gate: the primary falloff ladder. The
  // accent colour is the gate's own, so the panel and the world agree.
  GRAY_GATES.forEach((m, i) => dummy(0, zAt(m), { label: `${m}`, accent: GATE_HUE[i] }));

  // A vertical stack near 25m. Head, body and the gap between them are the
  // three cases a raycast can get wrong, and a horizontal row cannot show it.
  const stackZ = zAt(25) - 6;
  dummy(-4, stackZ, { label: 'hi', accent: CYAN });
  dummy(0, stackZ, { accent: MAGENTA });
  // 'lo' is the 25m lane's swiveller. Its travel is 1.5m to 6.5m, which is
  // wide enough to make a real tracking shot and narrow enough that it never
  // wanders across the centre line in front of the 25m gate target.
  dummy(4, stackZ, {
    label: 'lo', accent: CYAN, motion: { axis: 'x', span: 2.5, period: 3.0, phase: 0 },
  });
  // Crouched-height and tall targets, to confirm the height parameter is
  // actually reaching the hit spheres.
  dummy(-8, stackZ, { h: 1.1, label: 'crouch', accent: GOLD });
  dummy(8, stackZ, { h: 2.4, label: 'tall', accent: VIOLET });
  // Shielded and tough targets, so damage mitigation is measured rather than
  // assumed.
  dummy(12, zAt(50) - 4, { shield: 100, label: 'shield', accent: CYAN });
  dummy(16, zAt(50) - 4, { hp: 250, label: 'tank', accent: MAGENTA });

  /* --- moving targets ---------------------------------------------- *
   * A static range is a toy. Four of these move, and every one of them is
   * placed under a hard constraint: the sweep never reaches x = 0 and the
   * vertical ones never travel in Z, so no moving target can ever stand in
   * front of a dead-centre gate dummy and eat a shot meant for the ladder.
   * Their spans are also small enough that they stay well inside GRAY_R.
   * ------------------------------------------------------------------ */
  // 25m lane swiveller, on the free strip between the pylon buttresses and
  // the water. It sits 8m past its gate so it never clips a buttress.
  dummy(-14, zAt(25) - 8, {
    label: 'swirl', accent: SAKURA, motion: { axis: 'x', span: 3.4, period: 3.0, phase: 0.25 },
  });
  // 50m riser: rises out from behind the low slab, in its own lit shaft. Its
  // base is authored above the floor because the motion is a sine about the
  // base, and a target that spends half its cycle underground is a bug.
  dummy(6, zAt(50) - 4.6, {
    y: 0.9, label: 'rise', accent: GOLD, motion: { axis: 'y', span: 0.85, period: 2.2, phase: 0 },
  });
  // 75m strafe, three metres behind its gate so it clears the pylons.
  dummy(10, zAt(75) - 3, {
    label: 'strafe', accent: VIOLET, motion: { axis: 'x', span: 5.0, period: 4.0, phase: 0.1 },
  });
  // 100m hover, read against the lit long-range monument at the far end.
  dummy(-6.5, zAt(100), {
    y: 0.95, label: 'drift', accent: SAKURA, motion: { axis: 'y', span: 0.8, period: 1.6, phase: 0 },
  });

  /**
   * Move one target's *visual* to where the combat code has put its hit
   * spheres. match.js owns the clock and calls this every frame for any
   * dummy carrying a `motion` descriptor; the two must never disagree, or
   * the player is shooting at a thing that is not there.
   */
  function setDummyPos(i, x, y, z) {
    const v = dummyVisuals[i];
    if (!v) return;
    if (Number.isFinite(x)) v.position.x = x;
    if (Number.isFinite(y)) v.position.y = y;
    if (Number.isFinite(z)) v.position.z = z;
  }

  /* --- dressing: the garden the range is built inside ---------------- *
   * Every shipped prop pack gets used here, and all of it is dressing: the
   * lane, the gates, the targets and every collision box are procedural
   * and already live. That is deliberate, because it is what lets
   * `progress()` be honest at 1 while this streams in behind the shooter.
   * ------------------------------------------------------------------ */
  const kit = createKit(group, boxes);

  /** Refuse any placement that would hang over the cliff at the range edge. */
  function put(src, x, z, opts = {}) {
    if (Math.hypot(x, z) > GRAY_R - 3) return;
    kit.put(src, { x, z, y: 0, ...opts });
  }

  const FBX = { height: 2.6, dropMap: true };
  const CON = { height: 2.6, dropMap: true, tint: 0x2b3149 };
  const DARKS = { height: 2.6, dropMap: true, tint: 0x161a2a };
  const CHROMED = { height: 2.6, dropMap: true, tint: 0x7c8aa8 };
  const GLC = { height: 2.4, tint: 0x39425c };
  const STONE = { height: 2.2, tint: 0x4a5268 };
  const SAKURA_T = { height: 5.2, tint: 0xff86bd };
  const EMBER_T = { height: 5.2, tint: 0xff9a4d };
  const DEAD_T = { height: 5.6, tint: 0x2b3350 };
  const MEMORIAL = { height: 1.9, tint: 0x8fa0bd };

  // Torii: two piers and two beams, hard right angles, black lacquer with a
  // coloured light edge. Three of them, marking 10m, 50m and 100m. The far
  // one is pulled inboard, because at 100m the range is only 24m wide either
  // side of the lane and a torii hung off the edge would be a torii in mid-air.
  for (const [tz, px, hue] of [[zAt(10), 15.5, CYAN], [zAt(50), 15.5, GOLD], [zAt(100), 13, SAKURA]]) {
    for (const side of [-1, 1]) {
      put(MODULAR_FBX.pillar, side * px, tz, {
        height: 6.4, dropMap: true, tint: 0x141827, box: { w: 1.3, h: 6.4, d: 1.3 },
      });
      mass.box(side * px, 0, tz, 1.9, 0.45, 1.9, CONCRETE);
      neon.box(side * (px - 0.72), 0.7, tz, 0.1, 5.2, 0.6, hue, { grade: 0 });
    }
    const span = px * 2 + 3;
    mass.box(0, 6.4, tz, span, 0.9, 1.7, LACQUER);
    mass.box(0, 5.3, tz, span - 4, 0.55, 1.1, LACQUER);
    // The beams are overhead, so they carry no collision: a box above head
    // height is a floor to `floorAt`, and a torii you are lifted onto is
    // worse than no torii at all.
    neon.box(0, 7.32, tz + 0.87, span - 1, 0.12, 0.08, hue, { grade: 0 });
    neon.box(0, 5.86, tz + 0.57, span - 5, 0.1, 0.08, hue, { grade: 0 });
  }

  // Stone lanterns down both flanks, each with a lit flame panel and a warm
  // pool of light on the gravel beneath it. These are the reference image's
  // lanterns, and they are what make the range feel like a garden rather than
  // a car park - so the flame has to be the brightest warm thing on the
  // ground, not a 40cm panel lost in the dark.
  for (let i = 0; i < 11; i++) {
    const z = 28 - i * 8.6;
    for (const side of [-1, 1]) {
      const x = side * 12.6;
      if (Math.hypot(x, z) > GRAY_R - 3) continue;
      put(pick([PROP_GLB.lanternStanding, PROP_GLB.postLantern]), x, z, { ...STONE, height: 2.3 + rng() * 0.5 });
      mass.box(x, 0, z, 0.9, 0.3, 0.9, CONCRETE);
      neon.box(x, 1.5, z + 0.34, 0.62, 0.62, 0.06, 0xffc070, { grade: 0 });
      neon.box(x, 2.16, z + 0.2, 0.5, 0.08, 0.3, 0xffe0a8, { grade: 0 });
      // the pool of light the lantern throws, painted rather than lit
      paint.add(new THREE.CircleGeometry(1.5, 16), 0x6a4a2e, {
        x, y: 0.028, z, rx: -Math.PI / 2, grade: 0,
      });
    }
  }

  // Sakura and dead trees through the flank gardens. The orange pine kits
  // are the only tree geometry that ships at a sane triangle count, and
  // tinted hot pink they read as cherry blossom rather than autumn. They are
  // also, by a wide margin, the most expensive thing on the range - a dozen
  // large ones is most of its triangle budget - so the list is deliberately
  // short and leans on the medium and small variants.
  const TREES = [
    [-34, 30, SAKURA_T, 'treeOrangeMedium'], [40, 24, SAKURA_T, 'treeOrangeLarge'],
    [-46, 14, EMBER_T, 'treeYellowSmall'], [45, 2, DEAD_T, 'treeYellowMedium'],
    [-38, -6, SAKURA_T, 'treeOrangeMedium'], [43, -18, SAKURA_T, 'treeOrangeSmall'],
    [-47, -28, EMBER_T, 'treeOrangeSmall'], [38, -36, DEAD_T, 'treeYellowMedium'],
    [-36, -46, SAKURA_T, 'treeOrangeSmall'], [44, -48, EMBER_T, 'treeYellowSmall'],
  ];
  for (const [x, z, cfg, kind] of TREES) {
    put(PROP_GLB[kind], x, z, { ...cfg, rotY: rng() * 6.28 });
    mass.box(x, 0, z, 2.6, 0.22, 2.6, 0x14182a);
  }
  for (const [x, z] of [[-30, 20], [33, 12], [-44, -18], [40, -42], [-30, -34]]) {
    put(PROP_GLB.treeDeadMedium, x, z, { ...DEAD_T, rotY: rng() * 6.28 });
    mass.box(x, 0, z, 2.2, 0.2, 2.2, 0x10131f);
  }

  // The memorial garden: this is a range built inside a graveyard, and the
  // tombs are what give the neon something to be beautiful *against*.
  const MEM = [
    [-30, 14, PROP_GLB.graveA], [-32.6, 12.4, PROP_GLB.graveB], [-29, 11, PROP_GLB.gravestone],
    [31, 8, GRAVEYARD_OBJ.tomb2], [33.4, 6.6, GRAVEYARD_OBJ.tomb3], [30, 5, PROP_GLB.gravestone],
    [-31, -6, GRAVEYARD_OBJ.tomb3], [-33.6, -8, PROP_GLB.coffin], [-30, -9, PROP_GLB.graveDestroyed],
    [32, -20, PROP_GLB.coffinDecorated], [34.6, -21.4, GRAVEYARD_OBJ.tomb2], [31, -23, PROP_GLB.graveA],
    [-30, -24, PROP_GLB.crypt], [33, -40, GRAVEYARD_OBJ.tomb3], [-32, -44, PROP_GLB.graveB],
  ];
  for (const [x, z, src] of MEM) {
    const tall = src === PROP_GLB.crypt || src === PROP_GLB.coffinDecorated;
    put(src, x, z, { ...MEMORIAL, height: tall ? 2.6 : 1.9, rotY: (rng() - 0.5) * 0.7 });
    mass.box(x, 0, z, tall ? 2.4 : 1.5, 0.24, tall ? 2.0 : 1.3, CONCRETE);
    neon.box(x, 0.26, z + 0.6, 0.5, 0.05, 0.1, MAGENTA, { grade: 0 });
  }
  // Grave markers and a spade, because a garden with no names is a field.
  for (const [x, z] of [[-34, 16], [35, 4], [-36, -12], [36, -26], [-33, -30], [34, -46]]) {
    put(GRAVEYARD_OBJ.pillar, x, z, { height: 2.6, tint: 0x6f7d99, rotY: rng() * 6.28 });
    put(PROP_GLB.gravestone, x + 1.1, z + 0.6, { ...MEMORIAL, height: 1.5, rotY: rng() * 6.28 });
  }
  put(GRAVEYARD_OBJ.spade, -31.5, 13.2, { height: 1.9, tint: 0x8b98b6, rotY: 0.6 });

  // Fences, in runs, marking the gardens off from the range. Three kits, so
  // the boundary between "shooting range" and "cemetery" is a real object
  // rather than a change in ground colour.
  for (const [fx, fz, rot, n, src] of [
    [-19, 26, 0, 4, MODULAR_FBX.fence], [19, 26, 0, 4, PROP_GLB.fence],
    [-19, -2, 0, 5, PROP_GLB.fenceSeparate], [19, -2, 0, 5, GRAVEYARD_OBJ.fence],
    [-19, -34, 0, 4, MODULAR_FBX.fenceAlt], [19, -34, 0, 4, PROP_GLB.fenceBroken],
    [-19, -56, 0, 3, MODULAR_FBX.fence], [19, -56, 0, 3, PROP_GLB.fenceGate],
  ]) {
    for (let i = 0; i < n; i++) {
      const z = fz - i * 2.6;
      if (Math.hypot(fx, z) > GRAY_R - 3) continue;
      // No collision: a garden fence you can walk through is a fence, and
      // fifty extra AABBs in every shot's raycast buys nothing.
      put(src, fx, z, {
        height: 1.9, tint: 0x39415c, rotY: rot + (rng() - 0.5) * 0.08,
        dropMap: src.endsWith('.fbx'),
      });
    }
  }

  // Crates, barrels and tables: the clutter that says a place is used.
  for (const [x, z, src, h, tint] of [
    [-24, 22, MODULAR_FBX.crate, 1.5, 0x4a3a52], [-25.4, 20.6, MODULAR_FBX.crateAlt, 1.2, 0x3d4a5e],
    [25, 20, MODULAR_FBX.crate, 1.6, 0x4a3a52], [26.2, 18.4, MODULAR_FBX.barrel, 1.3, 0x2f3a52],
    [-25, 2, MODULAR_FBX.barrel2, 1.3, 0x2f3a52], [-23.4, 0.8, MODULAR_FBX.barrel, 1.2, 0x33405a],
    [24, -8, MODULAR_FBX.crateAlt, 1.3, 0x3d4a5e], [25.4, -9.4, MODULAR_FBX.barrel2, 1.2, 0x2f3a52],
    [-24, -18, MODULAR_FBX.crate, 1.5, 0x4a3a52], [-25.6, -19.6, MODULAR_FBX.crate, 1.1, 0x3d4a5e],
    [24, -30, MODULAR_FBX.barrel, 1.3, 0x2f3a52], [-24, -38, MODULAR_FBX.crateAlt, 1.4, 0x3d4a5e],
    [25, -44, MODULAR_FBX.crate, 1.5, 0x4a3a52],
  ]) {
    put(src, x, z, { height: h, dropMap: true, tint, rotY: rng() * 6.28, box: { w: 1.3, h, d: 1.3 } });
  }
  for (const [x, z] of [[-24, 12], [24, -16], [-24, -30]]) {
    put(MODULAR_FBX.table, x, z, { height: 1.1, dropMap: true, tint: 0x6a7690, rotY: rng() * 6.28 });
    put(MODULAR_FBX.crate, x + 1.4, z + 0.6, { height: 0.7, dropMap: true, tint: 0x4a3a52, rotY: rng() * 6.28 });
  }

  // Arches at the mouth of the range, and a shrine with its candles.
  for (const side of [-1, 1]) {
    put(PROP_GLB.archGate, side * 11, 30, { ...STONE, height: 5.2, rotY: side > 0 ? 0.25 : -0.25 });
    mass.box(side * 11, 0, 30, 4.4, 0.4, 1.2, CONCRETE);
    neon.box(side * 11, 4.9, 30.7, 4.2, 0.14, 0.1, MAGENTA, { grade: 0 });
  }
  put(PROP_GLB.shrine, -30, 4, { ...STONE, height: 2.4, rotY: 0.4 });
  put(PROP_GLB.shrineCandles, -30, 4, { ...STONE, height: 2.4, rotY: 0.4 });
  put(PROP_GLB.plaque, -28.6, 4.4, { ...MEMORIAL, height: 1.6, rotY: 0.4 });
  put(PROP_GLB.candleTriple, -30, 3.0, { height: 0.7, tint: 0xf0e2c0, emissive: 0xffb060 });
  put(PROP_GLB.benchDecorated, 29, 2, { ...MEMORIAL, height: 1.3, rotY: -0.5 });
  put(PROP_GLB.bench, 29, -22, { ...MEMORIAL, height: 1.3, rotY: 0.3 });
  put(PROP_GLB.postSkull, 28, -10, { ...STONE, height: 3.4, rotY: 0.2 });
  neon.box(28, 2.4, -9.7, 0.5, 0.5, 0.08, 0xd8e4ff, { grade: 0 });
  put(PROP_GLB.postSkull, -28, -20, { ...STONE, height: 3.4, rotY: -0.3 });
  neon.box(-28, 2.4, -19.7, 0.5, 0.5, 0.08, 0xd8e4ff, { grade: 0 });
  put(PROP_GLB.ribcage, -33, -40, { height: 1.2, tint: 0x9aa8c2, rotY: 0.8 });
  put(PROP_GLB.skull, -31.8, -41.2, { height: 0.7, tint: 0xb4c0d8, rotY: 1.4 });
  put(PROP_GLB.pumpkinJack, -29.6, -39.4, { height: 0.8, tint: 0xff8a3c, emissive: 0xff5a1e });
  neon.box(-29.6, 0.5, -39.0, 0.34, 0.24, 0.06, 0xffb060, { grade: 0 });

  /* --- modular accents ---------------------------------------------- *
   * The kit's architectural pieces, used as *detail* on the brutalist
   * forms rather than as the forms themselves: railings on the terraces,
   * doors and window bands set into the bunkers, a stair and a ramp, and
   * bollards along the lane edge.
   * ------------------------------------------------------------------ */
  for (const [x, z] of [[-33, 27.5], [40, 31.5], [-31, 3.5], [38, -10.5]]) {
    for (let i = 0; i < 3; i++) {
      put(pick([MODULAR_FBX.railing, MODULAR_FBX.railingEdge]), x, z + i * 2.4, {
        height: 1.3, dropMap: true, tint: 0x6a7690,
      });
    }
  }
  for (const [x, z] of [[-40.5, 26], [43.5, 6], [-38.5, -22], [39.5, -44]]) {
    put(MODULAR_FBX.door, x, z, {
      height: 2.3, dropMap: true, tint: 0x39415c, rotY: 1.57, box: { w: 0.5, h: 2.2, d: 1.6 },
    });
    neon.box(x, 2.45, z, 0.5, 0.08, 1.7, 0xffb060, { grade: 0 });
  }
  for (const [x, z] of [[-36, 22.4], [39, -16.4], [-34.4, -41.6]]) {
    for (let i = 0; i < 2; i++) {
      put(MODULAR_FBX.wallWindow, x, z + i * 3.4, { height: 2.6, dropMap: true, tint: 0x1b2036 });
      neon.box(x, 2.1, z + i * 3.4, 0.12, 1.1, 2.4, MAGENTA, { grade: 0 });
    }
  }
  put(MODULAR_FBX.stairs, 33.6, 3, { height: 2.2, dropMap: true, tint: 0x4a5268, box: { w: 2.4, h: 2.2, d: 3.2 } });
  put(MODULAR_FBX.stairs2, -40, -8, { height: 2.2, dropMap: true, tint: 0x4a5268, box: { w: 2.4, h: 2.2, d: 3.2 } });
  put(MODULAR_FBX.ramp, 41, -34, { height: 2.4, dropMap: true, tint: 0x3a4257, rotY: 0.3, box: { w: 3, h: 2.4, d: 3.4 } });
  put(MODULAR_FBX.ladder, 30.6, -6, { height: 4.2, dropMap: true, tint: 0x6a7690 });
  put(MODULAR_FBX.floorCorner, 32, 30, { height: 0.4, dropMap: true, tint: 0x2a3048, rotY: 0.4 });
  put(MODULAR_FBX.floorAlt, 43, 20, { height: 0.4, dropMap: true, tint: 0x232a40, rotY: 0.2 });
  put(MODULAR_FBX.wall, -45, 30, { height: 3.4, dropMap: true, tint: 0x222840, rotY: 0.5, box: { w: 4, h: 3.4, d: 0.6 } });
  put(MODULAR_FBX.wallAlt, 45, -6, { height: 3.4, dropMap: true, tint: 0x222840, rotY: -0.4, box: { w: 4, h: 3.4, d: 0.6 } });
  put(MODULAR_FBX.wallCorner, -46, -14, { height: 3.0, dropMap: true, tint: 0x1b2136, rotY: 0.8 });
  put(MODULAR_FBX.pillarThin, 29.5, 24, { height: 4.6, dropMap: true, tint: 0x2a3048 });
  put(MODULAR_FBX.pillar2, -29.5, -6, { height: 4.6, dropMap: true, tint: 0x2a3048 });
  put(MODULAR_FBX.cubeTall, 44, 34, { height: 3.2, dropMap: true, tint: 0x252c44, rotY: 0.3, box: { w: 1.6, h: 3.2, d: 1.6 } });
  put(MODULAR_FBX.cubeWide, -44, 36, { height: 1.4, dropMap: true, tint: 0x252c44, rotY: 0.2, box: { w: 3.4, h: 1.4, d: 1.6 } });
  put(MODULAR_FBX.cubeLow, 46, 26, { height: 0.8, dropMap: true, tint: 0x252c44, rotY: 0.1, box: { w: 2.2, h: 0.8, d: 2.2 } });
  put(MODULAR_FBX.cubeSlab, -47, 2, { height: 1.1, dropMap: true, tint: 0x252c44, rotY: 0.5, box: { w: 3, h: 1.1, d: 3 } });

  // Bollards along the lane edge: the only kit piece allowed near the lane,
  // and low enough (0.95m) that they never stand in a shot. Every 8m, not
  // every 4m - at 4m spacing they are forty-eight clones of a piece nobody
  // looks at directly, which is the most expensive way to say nothing.
  for (let z = 30; z > -66; z -= 8) {
    for (const side of [-1, 1]) {
      put(MODULAR_FBX.bollard, side * 8.1, z, {
        height: 0.95, dropMap: true, tint: 0x39415c, box: { w: 0.35, h: 0.95, d: 0.35 },
      });
    }
  }

  /* --- item props ---------------------------------------------------- *
   * The shared item library, used as range furniture: a supply chest by the
   * bench, munitions crates, and the odd piece of loot on the terraces.
   * They sit *beside* the pickup anchors rather than on them, so nothing
   * z-fights the real spawn match.js drops there.
   * ------------------------------------------------------------------ */
  for (const [src, x, z, h, glow] of [
    [ITEM_GLB.chest, -18.5, 41, 1.5, 0xffb060],
    [ITEM_GLB.ammoCrate, 18.5, 41, 1.3, 0x9aa8c2],
    [ITEM_GLB.ammoCrate, -18.5, 38, 1.2, 0x9aa8c2],
    [ITEM_GLB.medkit, 17.4, 37.4, 0.6, 0x7dffd0],
    [ITEM_GLB.powerCore, -17.6, 36.6, 0.7, 0x7af6ff],
    [ITEM_GLB.shieldCell, 16.6, 43, 0.7, 0x7af6ff],
    [ITEM_GLB.speedPack, -16.8, 43.4, 0.7, 0xff9ecb],
    [ITEM_GLB.grenade, -20, 26, 0.5, 0xff5a8c],
    [ITEM_GLB.shieldPuck, 20, 18, 0.5, 0x7af6ff],
    [ITEM_GLB.damageCrown, -20, -4, 0.6, 0xffc46b],
    [ITEM_GLB.camoPrism, 20, -24, 0.6, 0x9d5cff],
  ]) {
    put(src, x, z, { height: h, tint: glow, emissive: glow, rotY: rng() * 6.28 });
  }

  /* --- flush the merged geometry -------------------------------------- *
   * Everything above went into three buffers. Flushing them here is the
   * whole reason the range's architecture costs three draw calls instead of
   * the six hundred a slab-at-a-time build would have cost.
   * ------------------------------------------------------------------ */
  const massMesh = mass.build(massMat(), 'range-mass');
  const neonMesh = neon.build(glowMat(), 'range-neon');
  // `vertexColors` is not optional here. The paint batch bakes each marking's
  // colour into its vertices, and a MeshLambertMaterial that does not ask for
  // them ignores all of it - which renders every painted line on the range
  // pure white, including the centreline dash four metres in front of the
  // muzzle. Worth stating because the failure is silent: the geometry is
  // there, the colour is simply not being read.
  const paintMesh = paint.build(skinMat({ vertexColors: true, emissive: 0x060810 }), 'range-paint');
  for (const m of [massMesh, neonMesh, paintMesh]) if (m) group.add(m);

  return {
    group, boxes, anchors, pois: [], kit: null,
    heightAt: grayHeightAt,
    sun, hemi,
    /** Graybox-specific data read by match.js. */
    dummies,
    /**
     * Move a moving target's visual. match.js advances `motion` on its own
     * clock and calls this every frame, so the mesh and the hit spheres can
     * never drift apart.
     */
    setDummyPos,
    gates: GRAY_GATES,
    spawn: { ...GRAY_SPAWN },
    plinths,
    radius: GRAY_R,
    /**
     * No drop ship, no lobby, no chest factory. match.js checks for these and
     * takes the range path instead of the match path.
     */
    ufo: null,
    lobby: null,
    makeChest: null,
    cityReady: Promise.resolve(null),
    cityBounds: () => null,
    /**
     * The range is complete the instant this returns: every gate, lane
     * marker, target, plinth and collision box above is procedural and
     * already in the scene. The kit is pure dressing and lands during play,
     * exactly as the island's kit lands after its grace window, so the
     * loading bar never waits on art and never has to lie about it.
     */
    progress: () => 1,
    /** Resolves once the dressing has finished streaming, for callers who care. */
    ready: () => kit.settled().then(() => undefined),
    slowAt: () => false,
    // No storm on a proving ground: a circle creeping in while you time a
    // reload is a distraction, and it is not what we are testing.
    noZone: true,
    skipDrop: true,
    isGraybox: true,
  };
}
