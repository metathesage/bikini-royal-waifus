import * as THREE from 'three';
import { POIS } from '../data/catalog.js';
import { makeBox } from '../game/collision.js';
import {
  MAP_DECOR_GLB, MODULAR_FBX, PROP_GLB, GRAVEYARD_OBJ, CITY_GLB, ITEM_GLB, ITEM_LID_PART,
  loadGltf, loadFbx, loadObj, normalizeScene, fitToFootprint, tintScene, instanceOf,
} from '../data/assets.js';

/* ------------------------------------------------------------------ *
 * Kit placement
 *
 * Every environment asset is fetched once, normalized once, then cloned per
 * placement. Clones share geometry, materials and textures, so dressing a POI
 * with 30 pieces costs 30 draw calls, not 30 copies of the mesh data.
 * ------------------------------------------------------------------ */

const PIECE_CACHE = new Map();

/**
 * True when a mesh is a flat card: essentially zero thickness on one axis.
 *
 * Used to decide sidedness, not to decide what a thing is. Leaf clusters,
 * fence pickets, sign faces and gravestone plates are all built as quads in
 * these packs, and a quad is the one shape whose single most likely authoring
 * mistake is a normal pointing the wrong way.
 */
function isCard(geometry) {
  if (!geometry) return false;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const s = geometry.boundingBox.getSize(new THREE.Vector3());
  // Ignore degenerate spans on all three axes (a stray line or point).
  const extent = Math.max(s.x, s.y, s.z);
  if (extent <= 1e-6) return false;
  return Math.min(s.x, s.y, s.z) / extent < 0.02;
}

/**
 * Placement helper bound to one world.
 *
 * Each asset is fetched once, normalized once, then cloned per placement.
 * Clones share geometry, materials and textures, so dressing a POI with 30
 * pieces costs 30 draw calls rather than 30 copies of the mesh data ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â which is
 * what makes it safe to build the whole island out of kit pieces.
 */
/**
 * The colour dark props are lifted toward.
 *
 * A mid grey, so the lift only restores legibility without imposing a palette:
 * a genuinely dark prop still reads darker than a light one, it just stops
 * reading as a hole in the world.
 */
const NEUTRAL_FLOOR = new THREE.Color(0x8f96a0);

/**
 * True when a base-colour map can only subtract light.
 *
 * Two shapes of the same defect, both ending in a black surface:
 *
 * 1. A map whose image is pure black. The modular FBX kit points at
 *    "aap color palette.png", which was never shipped, so the loader falls back to
 *    the 8x8 `texture.png` beside it -- a pure-black placeholder. Every piece
 *    then multiplies a perfectly good base colour (#6c79a1, a slate blue) by
 *    black and renders as a cut-out, which is what turned the lobby deck, its
 *    pillars, railings and market stalls into silhouettes.
 *
 * 2. A map with no usable image at all. When the referenced file is missing
 *    entirely the loader hands back a texture with `image` undefined, and a
 *    sampler bound to it reads as black. Same symptom, and a pixel test cannot
 *    see it because there are no pixels to read.
 *
 * Detecting by value rather than by filename is the point: the bug is not "this
 * pack is broken", it is "a map with nothing in it can only darken", and any
 * future pack hitting either case lands on the same fix.
 */
function isBlackMap(texture) {
  if (!texture) return true;
  const img = texture.image;
  // No image, or a zero-sized one: nothing to sample, so nothing to show.
  if (!img || !img.width || !img.height) return true;
  const N = 4;
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(N, N)
    : Object.assign(document.createElement('canvas'), { width: N, height: N });
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  try {
    ctx.drawImage(img, 0, 0, N, N);
  } catch {
    return false; // tainted or not decodable; leave it alone
  }
  const data = ctx.getImageData(0, 0, N, N).data;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const l = Math.max(data[i], data[i + 1], data[i + 2]);
    if (l > max) max = l;
  }
  // Under 8/255 is black for practical purposes; anything above has real signal.
  return max < 8;
}

/**
 * Drop a base-colour map that turns out to be pure black, now or later.
 *
 * The "later" matters. Textures are decoded asynchronously by the loader, so at
 * the moment an imported piece is normalised its map usually has an image with
 * zero width -- not yet loaded -- and the pixel test has nothing to read. Doing
 * the check once, eagerly, therefore silently does nothing and the props stay
 * black, which looks exactly like the fix not working. Re-run it when the image
 * arrives instead, and detach the map then.
 */
function detachBlackMap(material) {
  const check = () => {
    if (!material.map || !isBlackMap(material.map)) return false;
    material.map = null;
    material.needsUpdate = true;
    return true;
  };
  if (check()) return;
  const img = material.map && material.map.image;
  // An <img> still in flight is the only case worth waiting on; a canvas or
  // ImageBitmap is already decoded.
  if (img && img.tagName === 'IMG' && !img.complete) {
    img.addEventListener('load', check, { once: true });
  }
}

/**
 * Make an imported prop survive this scene's lighting.
 *
 * Two separate failure modes produce the same symptom — a prop that rasterises
 * as a black silhouette no matter how the scene is lit:
 *
 * 1. Sidedness. These packs dress their foliage with flat alpha cards, and
 *    roughly half of them are authored with the normal pointing away from the
 *    sun. A back-facing normal gets no light and no environment, so an entire
 *    tree rasterises as a black spiky shape. Cards are detected by their
 *    geometry rather than by asset name, so this also covers bench slats,
 *    fence pickets and gravestone faces. Winding is left alone and only `side`
 *    is set, which keeps shadows and raycasts sane.
 *
 * 2. Authored-as-metal. The props are authored as metals and render near-black
 *    with nothing in the environment to reflect, so metalness is clamped down
 *    and roughness pushed up until every piece catches diffuse light.
 *
 * Applied to every imported scene: the kit pieces AND the one-off scatters like
 * the island plant decor, which previously skipped it and stayed black.
 */
function makeLit(scene) {
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (isCard(o.geometry)) for (const m of mats) if (m) m.side = THREE.DoubleSide;
    for (const m of mats) {
      if (!m) continue;
      // 0. A pure-black base-colour map, which is the strongest form of the same
      // bug: it multiplies the surface to nothing, and no amount of lifting the
      // base colour can bring it back. Detach it and let the material's own
      // colour show. This is the case that made the lobby deck, its pillars and
      // the market stalls read as black cut-outs.
      detachBlackMap(m);
      // 3. The case the first two cannot reach: a Phong/Lambert material whose
      // base colour is already near-black. These packs multiply a dark navy
      // (#0041a3, luminance 0.06) by their texture, and the result is a stall
      // wall or a pillar that reads as a black hole in the market. Phong has no
      // metalness and roughness, so the clamps above are silently no-ops on it
      // and the sidedness fix does not apply to a solid box. Lifting the base
      // colour to a readable floor is the only lever left, and because any
      // surviving texture still multiplies on top, the piece keeps its detail.
      if (m.color) {
        const lum = 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b;
        if (lum < 0.35) m.color.lerp(NEUTRAL_FLOOR, 0.55);
      }
      if ('metalness' in m && m.metalness > 0.2) m.metalness = 0.1;
      if ('roughness' in m && m.roughness < 0.45) m.roughness = 0.7;
      if ('envMapIntensity' in m && !(m.envMapIntensity > 0)) m.envMapIntensity = 0.7;
      m.needsUpdate = true;
    }
  });
  return scene;
}

function createKit(group, boxes) {
  const jobs = [];
  let done = 0;

  /**
   * Fetch + normalize one kit piece, memoised by url *and* the normalization
   * options, so `size: 3.6` and `size: 1.2` of the same crate stay distinct.
   */
  function baseFor(src, opts) {
    if (typeof src !== 'string' || !src) {
      console.error('kit piece needs a url string, got', src);
      return Promise.resolve(null);
    }
    const key = [src, opts.height, opts.size, opts.up, opts.tint?.color, opts.emissive].join('|');
    if (!PIECE_CACHE.has(key)) {
      const loader = src.endsWith('.fbx') ? loadFbx : src.endsWith('.obj') ? loadObj : loadGltf;
      PIECE_CACHE.set(key, loader(src).then((loaded) => {
        const inst = instanceOf(loaded.scene || loaded);
        if (opts.height != null) normalizeScene(inst, opts.height, { up: opts.up || 'auto' });
        else fitToFootprint(inst, opts.size || 1);
        // Imported props are authored as metals and render pure black with
        // nothing to reflect, and their foliage cards are often back-facing.
        // makeLit() handles both, and correctly iterates material arrays.
        makeLit(inst);
        if (opts.tint) tintScene(inst, opts.tint);
        if (opts.emissive) glow(inst, opts.emissive, opts.emissiveIntensity ?? 0.5);
        return inst;
      }).catch((err) => {
        console.error('kit piece failed', src, err);
        return null;
      }));
    }
    return PIECE_CACHE.get(key);
  }

  function glow(scene, color, intensity) {
    scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (m.emissive) m.emissive.set(color);
        if ('emissiveIntensity' in m) m.emissiveIntensity = intensity;
        if ('envMapIntensity' in m) m.envMapIntensity = 0.4;
        m.needsUpdate = true;
      }
    });
  }

  function spawn(parent, src, opts, withCollision) {
    const {
      x = 0, z = 0, y = null, ground = true, rotY = 0,
      scale = 1, shadow = true, box = null, tag = 'solid',
    } = opts;
    const baseY = y != null ? y : (ground ? heightAt(x, z) : 0);
    if (box && withCollision) {
      boxes.push(makeBox(x, baseY + box.h / 2, z, box.w, box.h, box.d, tag));
    }
    const job = baseFor(src, opts).then((proto) => {
      if (!proto) return null;
      const inst = instanceOf(proto);
      inst.position.set(x, baseY, z);
      inst.rotation.y = rotY;
      if (scale !== 1) inst.scale.multiplyScalar(scale);
      inst.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = !!shadow;
          o.receiveShadow = !!shadow;
        }
      });
      parent.add(inst);
      return inst;
    });
    jobs.push(job.then(() => { done += 1; }));
    return job;
  }

  return {
    /** Place into the island, optionally registering a collision box. */
    put(src, opts = {}) { return spawn(group, src, opts, true); },
    /** Place into a sub-assembly (drop-ship hull, market stall) with no collision. */
    putIn(parent, src, opts = {}) { return spawn(parent, src, opts, false); },
    progress() { return jobs.length ? done / jobs.length : 1; },
    settled() { return Promise.all(jobs); },
  };
}

/**
 * The central district: a real multi-level city block.
 *
 * The source asset is 359 meshes of buildings, walkways and interiors stacked
 * from about y = -3 to y = +9, textured and already laid out. Rather than
 * rebuild that by hand we drop it onto the plaza, then derive two things from
 * it automatically:
 *
 *   - collision boxes, filtered by footprint so we do not pay for 359 AABBs on
 *     every raycast (trimmed pieces contribute nothing),
 *   - loot anchors, taken from the tops of the large flat slabs, so chests and
 *     pickups land on the rooftops and balconies the player can actually reach.
 */
function buildCity(kit, group, boxes, anchors, rng) {
  return loadGltf(CITY_GLB).then((gltf) => {
    const city = instanceOf(gltf.scene);
    city.updateMatrixWorld(true);

    const raw = new THREE.Box3().setFromObject(city);
    const rawSize = raw.getSize(new THREE.Vector3());
    // Fit the footprint to the block, then stretch vertically.
    //
    // The asset is a 55 x 53 x 9.4 slab — a low-rise sprawl, not a skyline.
    // Scaled uniformly it reads as a car park from every angle, which is the
    // opposite of a multi-level city block. Compressing the footprint and
    // stretching the height is the standard blockout-city trick: it turns a
    // sprawl into towers without re-modelling a single vertex.
    const fit = (CITY_R * 2 - 16) / Math.max(rawSize.x, rawSize.z);
    city.scale.set(fit, fit * CITY_LIFT, fit);
    // Lowest geometry sits exactly on the plateau.
    city.position.set(
      -(raw.min.x + raw.max.x) / 2,
      PLAZA_Y - raw.min.y * fit * CITY_LIFT,
      -(raw.min.z + raw.max.z) / 2,
    );
    city.updateMatrixWorld(true);
    group.add(city);

    const boxesBefore = boxes.length;
    const slabs = [];
    city.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.isSkinnedMesh) o.visible = false; // a stray character, not architecture
      // Architecture has to be legible. A near-perfect metal with nothing to
      // reflect is simply black, and this asset is authored almost entirely that
      // way, so clamp it to something that catches the sun.
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m) continue;
        if ('metalness' in m) m.metalness = Math.min(m.metalness, 0.15);
        if ('roughness' in m && m.roughness < 0.5) m.roughness = 0.7;
        // The asset is full of single-sided floor and roof planes whose normals
        // face down. Viewed from above they are unlit and rasterise as big flat
        // black rectangles scattered through the skyline — which is exactly what
        // they looked like. DoubleSide flips the normal for back faces, so they
        // light correctly from whichever side you approach, and it also means
        // you can never see through a rooftop while mantling.
        m.side = THREE.DoubleSide;
        // The asset ships its colour entirely in base-colour textures -- a brick
        // red on the walls, dark browns on the trim -- with a white
        // baseColorFactor, so tinting `m.color` does nothing: color and map
        // multiply, and tinting white leaves red exactly as red. Detach the map
        // for the materials we have a palette colour for and set that colour
        // outright. Anything unmapped keeps the old tint so a future pack with
        // untextured surfaces still lands on the pink-white key.
        const flat = m.name && CITY_FLAT_COLORS[m.name];
        if (flat) {
          m.map = null;
          m.color.set(flat);
        } else if (m.color) {
          m.color.lerp(CITY_TINT, 0.72);
          // And a few of its materials are near-black to begin with, which the
          // tint alone cannot rescue: lerping toward a pale pink from luminance
          // 0.02 still lands dark. Same readable floor the kit props get.
          const lum = 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b;
          if (lum < 0.35) m.color.lerp(NEUTRAL_FLOOR, 0.5);
        }
        m.needsUpdate = true;
      }
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      const s = b.getSize(new THREE.Vector3());
      const foot = Math.max(s.x, s.z);
      // Skip slivers: they are trim, not surfaces you can stand on or hide behind.
      if (foot < 1.4 || s.y < 0.35) return;
      boxes.push(makeBox(
        (b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2,
        Math.max(0.4, s.x), Math.max(0.4, s.y), Math.max(0.4, s.z), 'city',
      ));
      // Wide and thin means a floor, a balcony or a roof ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â loot goes on top.
      if (foot >= 3.5 && s.y <= 2.4) {
        slabs.push({ x: (b.min.x + b.max.x) / 2, y: b.max.y, z: (b.min.z + b.max.z) / 2, foot });
      }
    });

    // Loot spread over the slabs, weighted toward the higher ones so the
    // vertical routes carry the good loot.
    for (const s of slabs) {
      const roll = rng();
      if (roll < 0.22) anchors.chests.push({ x: s.x, y: s.y + 0.05, z: s.z, poi: 'downtown', onCity: true });
      else if (roll < 0.85) anchors.floors.push({ x: s.x, z: s.z, poi: 'downtown', onCity: true });
      else anchors.crystals.push({ x: s.x, y: s.y + 0.05, z: s.z, poi: 'downtown', kind: 'speed', onCity: true });
    }
    // Ground-level loot under the block, so the streets are not dead.
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      const d = CITY_R * (0.35 + rng() * 0.75);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      anchors.floors.push({ x, z, poi: 'downtown' });
    }
    for (let i = 0; i < 5; i++) {
      const a = rng() * Math.PI * 2;
      const d = CITY_R * (0.5 + rng() * 0.6);
      anchors.chests.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, poi: 'downtown' });
    }

    return { city, boxCount: boxes.length - boxesBefore, slabs: slabs.length };
  }).catch((e) => {
    console.error('city load failed', e);
    return null;
  });
}

/**
 * The island is deliberately small. A battle royale that takes four minutes to
 * cross is four minutes of nothing happening, so the play space is a compact
 * district: dense, layered, and every fight within earshot of another.
 */
export const ISLAND_R = 56;
export const CITY_R = 30;
/** Height of the flat plateau the city block stands on. */
export const PLAZA_Y = 2.8;
/**
 * Vertical exaggeration applied to the imported city.
 *
 * The asset is 9.4 units tall over a 55-unit footprint. Scaled to fit the block
 * that is a low-rise sprawl that reads as a car park, so we stretch it into
 * towers. Tuned so the tallest rooftops clear the drop ship comfortably and
 * every storey is still jumpable.
 */
export const CITY_LIFT = 2.6;

/** Downtown is pulled toward the game's pink-white key on load. */
const CITY_TINT = new THREE.Color('#ffe8f2');

/**
 * Flat replacement colours for the city, keyed by the material's own name.
 *
 * The city ships five materials whose `baseColorFactor` is *white* and whose
 * entire colour lives in a base-colour texture. Three of those textures are the
 * problem: a brick red (#c14a35) covering the walls, and two dark browns
 * (#50463d, #745336) on the trim and pallets. Multiplying by a tint cannot fix
 * any of them, because `material.color` and `map` are combined by
 * multiplication -- a white tint leaves a red wall exactly as red as it was,
 * which is why `lerp(CITY_TINT, 0.72)` had no visible effect on downtown and the
 * screenshots kept coming back brick red.
 *
 * The fix is to stop letting the map carry the hue at all. These materials are
 * flat colour surfaces once the texture is detached, so give each one a colour
 * from the game's palette directly. Detail comes from the lighting and the
 * silhouettes, and the block stops reading as a hazard marker dropped on a
 * pastel island.
 */
const CITY_FLAT_COLORS = {
  wall_text_1: '#ffd9e6',
  'test.001': '#ffc2d6',
  'Material.016': '#efe6ee',
  floor_text_1: '#e7dbe8',
  pallet_base: '#d9c7d6',
};

function islandHeightAt(x, z) {
  const r = Math.hypot(x, z);
  const island = smoothstep(ISLAND_R, ISLAND_R - 16, r);
  // Gentle rolls only ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â verticality comes from the buildings, not the terrain.
  let h = Math.sin(x * 0.07) * Math.cos(z * 0.06) * 0.9;
  h += Math.exp(-((x + 34) * (x + 34) + (z - 26) * (z - 26)) / 260) * 2.6;  // crater rim
  h -= Math.exp(-((x + 34) * (x + 34) + (z - 26) * (z - 26)) / 90) * 3.4;   // crater bowl
  h -= Math.exp(-((x + 40) * (x + 40) + (z + 2) * (z + 2)) / 220) * 1.8;   // pool
  h += Math.exp(-((x - 36) * (x - 36) + (z + 20) * (z + 20)) / 300) * 2.2;  // ridge
  h += Math.exp(-((x - 12) * (x - 12) + (z + 40) * (z + 40)) / 240) * 1.6;  // south rise
  // Flatten a plaza wide enough to sit the whole city block on, so its ground
  // floor is flush and the rooftops are true storeys rather than sloping steps.
  const plaza = smoothstep(CITY_R + 10, CITY_R + 2, r);
  h = h * (1 - plaza) + PLAZA_Y * plaza;
  // Beach, then a real shelf. The old version clipped the terrain to a flat
  // -4.5 shelf, which the sea then rendered as a single enormous flat sheet —
  // the "giant purple quad" that used to swallow half the screen.
  const shelf = -12 - smoothstep(ISLAND_R, ISLAND_R + 70, r) * 16;
  return h * island + (1 - island) * shelf;
}

/**
 * Active terrain sampler.
 *
 * `heightAt` is imported directly by match.js at ~20 call sites, so a second
 * map cannot simply export its own function — every consumer would have to be
 * rewired and could drift out of sync. Instead the ground under the match is a
 * swappable function: whichever map was built installs its sampler here, and
 * every existing consumer keeps calling `heightAt`.
 */
let activeHeightAt = islandHeightAt;

/** Install a map's ground sampler. Called by each map builder on construction. */
export function setTerrain(fn) {
  activeHeightAt = fn || islandHeightAt;
}

export function heightAt(x, z) {
  return activeHeightAt(x, z);
}

/** Sea level. Anything below this is underwater and slows the player down. */
export const SEA_Y = -1.6;

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (edge0 - x) / (edge0 - edge1)));
  return t * t * (3 - 2 * t);
}

/**
 * A flat disc in the XZ plane whose rings are quadratically spaced.
 *
 * Quadratic spacing puts most of the vertices near the middle, where the island
 * actually is, and stretches the rest out to the horizon. That gives the crater
 * and the plaza real geometric detail without paying for a uniformly dense mesh
 * out to 190 units where nothing but water lives.
 */
function radialDisc(radius, rings, segs) {
  const count = (rings + 1) * (segs + 1);
  const verts = new Float32Array(count * 3);
  const idx = new Uint32Array(rings * segs * 6);
  let v = 0;
  for (let r = 0; r <= rings; r++) {
    const rad = radius * (r / rings) * (r / rings);
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      verts[v * 3] = Math.cos(a) * rad;
      verts[v * 3 + 1] = 0;
      verts[v * 3 + 2] = Math.sin(a) * rad;
      v++;
    }
  }
  let t = 0;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * (segs + 1) + s;
      const b = a + segs + 1;
      // Wound counter-clockwise seen from +Y. Get this backwards and every
      // normal points down, the whole island lights from underneath, and the
      // terrain reads as one flat dark mass — which is exactly how it looked.
      idx[t++] = a; idx[t++] = a + 1; idx[t++] = b;
      idx[t++] = b; idx[t++] = a + 1; idx[t++] = b + 1;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let GRAD = null;
function gradient() {
  if (GRAD) return GRAD;
  const data = new Uint8Array([80, 70, 110, 255, 170, 150, 200, 255, 230, 220, 240, 255, 255, 255, 255, 255]);
  GRAD = new THREE.DataTexture(data, 4, 1);
  GRAD.magFilter = THREE.NearestFilter;
  GRAD.minFilter = THREE.NearestFilter;
  GRAD.colorSpace = THREE.SRGBColorSpace;
  GRAD.needsUpdate = true;
  return GRAD;
}

function toon(color, emissive = null, intensity = 0) {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: gradient(),
    emissive: emissive || 0x000000,
    emissiveIntensity: intensity,
  });
}

export function buildWorld(scene, seed = 7, renderer = null) {
  setTerrain(islandHeightAt);
  const rng = mulberry(seed);
  const boxes = [];
  const group = new THREE.Group();
  scene.add(group);

  scene.background = null;
  // Fog has to sit far enough back that a 112-unit island is not uniformly
  // washed to one flat colour. Starting at 30 units turned the entire playable
  // area into a single pink sheet with no depth cue at all.
  scene.fog = new THREE.Fog(0xf7c6e4, 70, 340);

  const hemi = new THREE.HemisphereLight(0xffc4ea, 0x2f8a55, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e4, 1.35);
  sun.position.set(48, 96, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 320;
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 110;
  sun.shadow.camera.bottom = -90;
  // Without a bias, a 2048 map stretched over 180 world units self-samples so
  // badly that whole surfaces test as occluded and render solid black — which is
  // exactly what every kit prop on the island was doing. normalBias pushes the
  // sample along the surface normal, the correct cure for acne on the large flat
  // geometry this scene is made of.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);
  scene.add(sun.target);

  const skyGeo = new THREE.SphereGeometry(420, 20, 14);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      top: { value: new THREE.Color('#9eb6ff') },
      mid: { value: new THREE.Color('#ffb0e4') },
      horizon: { value: new THREE.Color('#ffe3c4') },
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
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  /*
   * Image-based lighting from the sky itself.
   *
   * Nearly every imported glTF in this project is authored as a metal: with
   * metallicFactor 1 and no environment to reflect, a metal surface has nothing
   * to show and renders pure black. That is why the whole kit — benches,
   * railings, walls — came out as flat black cut-outs against the sky. One PMREM
   * built from our own sky shader fixes every imported material at once, and
   * gives the whole scene a coherent sense of place and time of day.
   *
   * Needs a WebGL context, so headless simulation just skips it.
   */
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), skyMat.clone());
    // The env capture is a light probe, not a view: no depth tricks, no fog.
    envSky.material.fog = false;
    envSky.material.depthWrite = false;
    envSky.material.side = THREE.BackSide;
    envScene.add(envSky);
    // A dim ground half keeps reflections from being lit from below.
    const envGround = new THREE.Mesh(
      new THREE.SphereGeometry(9.4, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x6f8fa8, side: THREE.BackSide }),
    );
    envScene.add(envGround);
    const target = pmrem.fromScene(envScene, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.85;
    envSky.geometry.dispose();
    envGround.geometry.dispose();
    envGround.material.dispose();
    pmrem.dispose();
  }
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9 });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(16, 16, 12), moonMat);
  moon.position.set(-150, 120, -180);
  sky.add(moon);
  const moon2 = new THREE.Mesh(new THREE.SphereGeometry(8, 12, 10), new THREE.MeshBasicMaterial({ color: 0xd7c6ff }));
  moon2.position.set(180, 90, -120);
  sky.add(moon2);

  const stars = new THREE.BufferGeometry();
  const starPos = new Float32Array(600);
  for (let i = 0; i < 200; i++) {
    const theta = rng() * Math.PI * 2;
    const phi = rng() * 1.1;
    const rad = 300;
    starPos[i * 3] = Math.cos(theta) * Math.sin(phi) * rad;
    starPos[i * 3 + 1] = 40 + Math.cos(phi) * rad * 0.35;
    starPos[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * rad;
  }
  stars.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: true, fog: false })));

  // Terrain as a disc, not a square. A square plane ends in a hard straight
  // horizon edge, which is exactly what read as a giant flat quad from above.
  const GROUND_R = ISLAND_R * 3.4;
  const RINGS = 96;
  const SEGS = 128;
  const groundGeo = radialDisc(GROUND_R, RINGS, SEGS);
  const pos = groundGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color('#63c96f');
  const cHigh = new THREE.Color('#b9a6ff');
  const cSand = new THREE.Color('#ffe38a');
  const cDeep = new THREE.Color('#2f7f66');
  // Downtown paving. This was #6f7a99 -- a mid slate that reads as a shadow, not
  // a floor. Because the plaza is a flat disc of radius CITY_R + 1 it rendered
  // as one huge dark ellipse directly under the city, which is what looked like
  // a black slab floating in the middle of downtown. Pale, slightly cooler than
  // the city walls so the block still sits on something, but light enough that
  // the ground never competes with the buildings standing on it.
  const cPlaza = new THREE.Color('#e0d6ea');
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const crater = Math.hypot(x + 34, z - 26);
    const rr = Math.hypot(x, z);
    if (crater < 11) tmp.copy(cSand);                        // crater floor
    else if (rr < CITY_R + 1) tmp.copy(cPlaza);              // downtown paving
    else if (h < SEA_Y - 0.3) tmp.copy(cDeep);               // submerged shelf
    else if (h < SEA_Y + 1.6) tmp.copy(cSand);               // beach
    else if (h > 1.4) tmp.copy(cGrass).lerp(cHigh, Math.min(1, (h - 1.4) / 5));
    else tmp.copy(cGrass);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  ground.receiveShadow = true;
  group.add(ground);

  const ocean = new THREE.Mesh(
    new THREE.CircleGeometry(600, 64),
    new THREE.MeshStandardMaterial({ color: 0x3fbfe8, transparent: true, opacity: 0.82, roughness: 0.08, metalness: 0.2 }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = SEA_Y;
  group.add(ocean);

  const oasis = new THREE.Mesh(
    new THREE.CircleGeometry(9, 24),
    new THREE.MeshStandardMaterial({ color: 0x7af0ff, transparent: true, opacity: 0.72, roughness: 0.04, metalness: 0.2, emissive: 0x146080, emissiveIntensity: 0.4 }),
  );
  oasis.rotation.x = -Math.PI / 2;
  oasis.position.set(POIS[1].x, heightAt(POIS[1].x, POIS[1].z) + 0.15, POIS[1].z);
  group.add(oasis);

  const unit = new THREE.BoxGeometry(1, 1, 1);
  function solid(x, y, z, w, h, d, material, tag = 'solid', shadow = true) {
    const m = new THREE.Mesh(unit, material);
    m.position.set(x, y, z);
    m.scale.set(w, h, d);
    m.castShadow = shadow;
    m.receiveShadow = true;
    group.add(m);
    boxes.push(makeBox(x, y, z, w, h, d, tag));
    return m;
  }
  function decor(geo, material, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.y = rx;
    group.add(m);
    return m;
  }

  const crystalMat = toon('#c9b6ff', '#b388ff', 0.55);
  const whiteMat = toon('#fff6fb');
  const wood = toon('#c9845a');
  const leaf = toon('#3dffa6', '#39ffd2', 0.2);
  const neon = toon('#1a2430', '#39ffd2', 0.7);
  const rock = toon('#b9a4d4');
  const heartMat = toon('#ff4d7a', '#ff4d7a', 0.6);

  const anchors = { chests: [], floors: [], crystals: [], drops: [] };
  const kit = createKit(group, boxes);

  function landmarkCrystals(x, z, n, scale) {
    const base = heightAt(x, z);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rad = 2 + (i % 3);
      const px = x + Math.cos(a) * rad;
      const pz = z + Math.sin(a) * rad;
      const h = 3 + (i % 4) * 1.6 * scale;
      solid(px, base + h / 2, pz, 0.8, h, 0.8, crystalMat, 'crystal');
    }
  }

  // Downtown ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â the multi-level city block. Everything about it (collision,
  // rooftops, loot) is derived from the asset, so there is nothing to author.
  let city = null;
  const cityReady = buildCity(kit, group, boxes, anchors, rng).then((info) => {
    city = info && info.city;
    return info;
  });

  // Street cover ringing the block, so the plaza edge is not a death walk.
  {
    const p = POIS[0];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const d = CITY_R + 3;
      const px = p.x + Math.cos(a) * d;
      const pz = p.z + Math.sin(a) * d;
      if (Math.hypot(px, pz) > ISLAND_R - 8) continue;
      const s = 1.6 + rng() * 1.6;
      solid(px, heightAt(px, pz) + s / 2, pz, s, s, s, rng() > 0.5 ? rock : whiteMat);
    }
  }

  // Lagoon
  {
    const p = POIS[1];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const px = p.x + Math.cos(a) * 9;
      const pz = p.z + Math.sin(a) * 9;
      const b = heightAt(px, pz);
      solid(px, b + 1.6, pz, 0.5, 3.2, 0.5, wood);
      decor(new THREE.SphereGeometry(1.3, 10, 8), leaf, px, b + 4.2, pz, 1.4, 0.8, 1.4);
    }
    for (let i = 0; i < 5; i++) {
      const a = i * 1.4;
      anchors.chests.push({ x: p.x + Math.cos(a) * 7, z: p.z + Math.sin(a) * 7, poi: p.id });
    }
  }
  // Night Market ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â was the "Alien Bazaar". Six stalls assembled from the
  // modular kit: a shipping-pallet counter, a back wall, corner posts, a sign
  // and a hanging lantern. No more alien cones.
  {
    const p = POIS[2];
    for (let i = 0; i < 6; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const px = p.x - 9 + col * 9;
      const pz = p.z - 5 + row * 11;
      const b = heightAt(px, pz);
      const face = row === 0 ? 0 : Math.PI;
      const glowColor = i % 2 ? '#ff5ea8' : '#39ffd2';

      // Counter: the collision players bump into is the counter itself.
      kit.put(MODULAR_FBX.crate, {
        x: px, y: b, z: pz, rotY: face,
        size: 3.6, box: { w: 3.6, h: 1.3, d: 1.5 },
      });
      // Back wall + awning frame.
      kit.put(i % 2 ? MODULAR_FBX.wall : MODULAR_FBX.wallWindow, {
        x: px - Math.sin(face) * 2.4, y: b, z: pz - Math.cos(face) * 2.4, rotY: face,
        height: 3.2, box: { w: 3.8, h: 3.2, d: 0.5 },
      });
      for (const s of [-1, 1]) {
        kit.put(MODULAR_FBX.pillarThin, {
          x: px + Math.cos(face) * s * 1.7, y: b, z: pz - Math.sin(face) * s * 1.7,
          height: 3.2,
        });
      }
      kit.put(MODULAR_FBX.cubeSlab, { x: px, y: b + 3.2, z: pz, rotY: face, size: 4.2 });
      kit.put(PROP_GLB.plaque, {
        x: px, y: b + 3.5, z: pz + 0.1, rotY: face, size: 1.5,
        emissive: glowColor, emissiveIntensity: 0.9,
      });
      kit.put(PROP_GLB.lanternHanging, {
        x: px, y: b + 2.9, z: pz, rotY: face, size: 0.7,
        emissive: glowColor, emissiveIntensity: 1.1,
      });
      // Crates and barrels dressing the stall front.
      kit.put(i % 2 ? MODULAR_FBX.crateAlt : MODULAR_FBX.barrel, {
        x: px + Math.cos(face) * 2.2, y: heightAt(px + Math.cos(face) * 2.2, pz - Math.sin(face) * 2.2),
        z: pz - Math.sin(face) * 2.2, rotY: face * 0.5, size: 1.1,
      });
      anchors.chests.push({ x: px + 2.6, z: pz + 2.2, poi: p.id });
    }
    // Market square decking so the stalls read as built, not dropped.
    for (let i = -1; i <= 1; i++) {
      kit.put(MODULAR_FBX.floor, { x: p.x + i * 6, y: heightAt(p.x + i * 6, p.z) + 0.06, z: p.z, size: 6, shadow: false });
    }
  }
  // Neon Grove
  {
    const p = POIS[3];
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      const px = p.x + Math.cos(a) * (8 + (i % 3) * 3);
      const pz = p.z + Math.sin(a) * (8 + (i % 3) * 3);
      const b = heightAt(px, pz);
      solid(px, b + 1.5, pz, 1.1, 3, 1.1, wood);
      decor(new THREE.SphereGeometry(1.6, 10, 8), i % 2 ? neon : leaf, px, b + 4.2, pz, 1.5, 0.7, 1.5);
    }
    for (let i = 0; i < 4; i++) {
      const a = i * 1.5 + 0.2;
      anchors.chests.push({ x: p.x + Math.cos(a) * 12, z: p.z + Math.sin(a) * 12, poi: p.id });
    }
  }
  // Skyline: a stacked tower of modular decks, each reachable from the one
  // below. This is the map's vertical spine ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the only place you can be shot
  // from above, and the only place worth climbing for.
  {
    const p = POIS[4];
    const tiers = [0, 3.4, 6.8, 10.2, 13.6];
    const deck = 9 - 0.5;
    tiers.forEach((lift, i) => {
      const a = i * 0.7;
      const px = p.x + Math.cos(a) * (3 + i * 1.6);
      const pz = p.z + Math.sin(a) * (3 + i * 1.6);
      const y = heightAt(px, pz) + lift;
      solid(px, y, pz, deck, 0.5, deck, i % 2 ? crystalMat : toon('#9ad7ff', '#67d4ff', 0.4));
      // Support column + a stair run to the next deck.
      solid(px, y - lift / 2 - 0.4, pz, 1.6, Math.max(0.6, lift), 1.6, whiteMat);
      if (i < tiers.length - 1) {
        const nx = p.x + Math.cos(a + 0.7) * (4 + (i + 1) * 1.6);
        const nz = p.z + Math.sin(a + 0.7) * (4 + (i + 1) * 1.6);
        for (let s = 0; s < 6; s++) {
          const t = (s + 0.5) / 6;
          const sx = px + (nx - px) * t;
          const sz = pz + (nz - pz) * t;
          solid(sx, y + 3.4 * t, sz, 2.6, 0.35, 2.6, toon('#cfe4ff', '#8fc7ff', 0.25));
        }
      }
      anchors.floors.push({ x: px, y: y + 0.45, z: pz, poi: p.id });
      if (i % 2 === 1) anchors.chests.push({ x: px, y: y + 0.45, z: pz, poi: p.id });
      if (i === tiers.length - 1) {
        anchors.crystals.push({ x: px, y: y + 0.6, z: pz, poi: p.id, kind: 'jump' });
        anchors.chests.push({ x: px + 2.2, y: y + 0.45, z: pz - 1.4, poi: p.id });
      }
    });
  }
  // Heartfall: tombs and a scorched bowl in the north-west.
  {
    const p = POIS[5];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const px = p.x + Math.cos(a) * 14;
      const pz = p.z + Math.sin(a) * 14;
      const b = heightAt(px, pz);
      solid(px, b + 1.3, pz, 2.2, 2.6, 2.2, rock);
    }
    const b = heightAt(p.x, p.z);
    decor(new THREE.SphereGeometry(0.8, 12, 10), heartMat, p.x - 0.35, b + 1.5, p.z, 1, 1, 0.7);
    decor(new THREE.SphereGeometry(0.8, 12, 10), heartMat, p.x + 0.35, b + 1.5, p.z, 1, 1, 0.7);
    decor(new THREE.ConeGeometry(0.9, 1.1, 8), heartMat, p.x, b + 0.7, p.z, 1, 1, 0.6, 0);
    for (let i = 0; i < 4; i++) {
      const a = i * 1.6;
      anchors.chests.push({ x: p.x + Math.cos(a) * 9, z: p.z + Math.sin(a) * 9, poi: p.id });
    }
  }

  // Kit dressing for the remaining POIs: real trees, fences, arches, tombs and
  // lanterns layered over the procedural landmarks.
  dressPois(kit, rng);

  // Mid-map cover so rotations aren't empty.
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2;
    const px = Math.cos(a) * (CITY_R + 6);
    const pz = Math.sin(a) * (CITY_R + 6);
    if (Math.hypot(px, pz) > ISLAND_R - 6) continue;
    const b = heightAt(px, pz);
    solid(px, b + 1.2, pz, 2.4, 2.4, 2.4, i % 2 ? rock : crystalMat);
  }

  // Scatter cover across the whole island, skipping the city footprint so we do
  // not bury the architecture in crates.
  for (let i = 0; i < 40; i++) {
    const x = (rng() - 0.5) * ISLAND_R * 1.9;
    const z = (rng() - 0.5) * ISLAND_R * 1.9;
    const rad = Math.hypot(x, z);
    if (rad > ISLAND_R - 4 || rad < CITY_R + 2) continue;
    let close = false;
    for (const c of anchors.chests) if (Math.hypot(c.x - x, c.z - z) < 3.5) close = true;
    if (close) continue;
    const s = 1 + rng() * 2;
    const b = heightAt(x, z);
    solid(x, b + s / 2, z, s, s, s, rng() > 0.5 ? rock : whiteMat);
  }

  const crystalKinds = ['speed', 'regen', 'jump', 'magnet', 'speed', 'regen'];
  POIS.forEach((p, i) => {
    if (!anchors.crystals.some((c) => c.poi === p.id)) {
      anchors.crystals.push({ x: p.x + 4, z: p.z + 3, poi: p.id, kind: crystalKinds[i % crystalKinds.length] });
    }
    anchors.drops.push({ x: p.x, z: p.z, poi: p.id });
    for (let k = 0; k < 8; k++) {
      const a = rng() * Math.PI * 2;
      const rad = 6 + rng() * 16;
      anchors.floors.push({ x: p.x + Math.cos(a) * rad, z: p.z + Math.sin(a) * rad, poi: p.id });
    }
  });
  for (let k = 0; k < 22; k++) {
    const x = (rng() - 0.5) * ISLAND_R * 1.8;
    const z = (rng() - 0.5) * ISLAND_R * 1.8;
    if (Math.hypot(x, z) < ISLAND_R - 3) anchors.floors.push({ x, z, poi: 'wild' });
  }

  function placeY(anchor) {
    if (anchor.y != null) return anchor.y;
    return heightAt(anchor.x, anchor.z) + 0.45;
  }
  for (const list of [anchors.chests, anchors.floors, anchors.crystals, anchors.drops]) {
    for (const a of list) a.y = placeY(a);
  }

  // Soft plants, densified for the smaller island.
  const plant = new THREE.InstancedMesh(new THREE.ConeGeometry(0.25, 1.2, 5), leaf, 240);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 240; i++) {
    const x = (rng() - 0.5) * ISLAND_R * 2.1;
    const z = (rng() - 0.5) * ISLAND_R * 2.1;
    if (Math.hypot(x, z) > ISLAND_R - 2) { dummy.position.set(0, -50, 0); }
    else dummy.position.set(x, heightAt(x, z) + 0.5, z);
    dummy.scale.setScalar(0.6 + rng());
    dummy.updateMatrix();
    plant.setMatrixAt(i, dummy.matrix);
  }
  plant.instanceMatrix.needsUpdate = true;
  group.add(plant);

  // Imported GLB plant decor, scattered on the island (no collision).
  const decorUrl = MAP_DECOR_GLB;
  loadGltf(decorUrl).then((gltf) => {
    // Normalize a clone, never the cached scene: the registry hands the same
    // node to every subscriber and normalizeScene mutates in place.
    // makeLit() matters here as much as on the kit pieces: this is the
    // foliage pack, so skipping it is what left the island's trees rendering
    // as black silhouettes.
    const base = makeLit(normalizeScene(instanceOf(gltf.scene), 2.2));
    const placed = [];
    for (let i = 0; i < 26; i++) {
      const x = (rng() - 0.5) * 180;
      const z = (rng() - 0.5) * 180;
      if (Math.hypot(x, z) > 96) continue;
      let close = false;
      for (const c of anchors.chests) if (Math.hypot(c.x - x, c.z - z) < 4) close = true;
      if (close) continue;
      placed.push({ x, z, a: rng() * Math.PI * 2 });
    }
    for (const p of placed) {
      const inst = instanceOf(base);
      inst.position.set(p.x, heightAt(p.x, p.z), p.z);
      inst.rotation.y = p.a;
      group.add(inst);
    }
  }).catch((e) => {
    // The real error matters here: the island still builds without plant decor,
    // so a bare message would let a genuine load failure hide behind a scene
    // that looks fine. Log the message and a short stack rather than the error
    // object itself, which holds a THREE.Object3D and serialises as a circular
    // structure that buries the actual message.
    const where = e && e.stack ? String(e.stack).split('\n').slice(0, 4).join(' | ') : 'no stack';
    console.error('map decor glb load failed', decorUrl, (e && (e.message || e.type || String(e))) || e, where);
  });

  const ufo = buildUfo(kit);
  scene.add(ufo.group);

  const lobby = buildLobby(kit);
  scene.add(lobby);

  return {
    group, boxes, heightAt, anchors, pois: POIS, ufo, lobby, sky, sun, kit, cityReady,
    /** Real-world extent of the imported city block, for placement QA. */
    cityBounds: () => {
      if (!city) return null;
      const b = new THREE.Box3().setFromObject(city);
      const s = b.getSize(new THREE.Vector3());
      return {
        min: [b.min.x, b.min.y, b.min.z].map((v) => +v.toFixed(1)),
        max: [b.max.x, b.max.y, b.max.z].map((v) => +v.toFixed(1)),
        size: [s.x, s.y, s.z].map((v) => +v.toFixed(1)),
        scale: +city.scale.x.toFixed(3),
        meshes: (() => { let n = 0; city.traverse((o) => { if (o.isMesh) n++; }); return n; })(),
      };
    },
    /** Kit chest factory ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â match.js builds one per loot anchor. */
    makeChest: () => buildChest(),
    /** 0..1 while environment assets stream in; drives the loading bar. */
    progress: () => kit.progress(),
    /** Resolves once every placement made *so far* has landed (or failed). */
    ready: () => kit.settled(),
    slowAt(x, z) {
      // Wading through the lagoon slows you down.
      return Math.hypot(x - POIS[1].x, z - POIS[1].z) < 8;
    },
  };
}

/**
 * Layer imported kit dressing over the procedural POI landmarks. Nothing here
 * is load-bearing for gameplay: the collision layout stays exactly as built
 * above, this only replaces what the player looks at.
 */
function dressPois(kit, rng) {
  const spin = () => rng() * Math.PI * 2;

  // Downtown edges: street furniture ringing the block, so the city reads as a
  // place people hang around rather than an island of geometry.
  {
    const p = POIS[0];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const d = CITY_R + 1.5;
      const px = p.x + Math.cos(a) * d;
      const pz = p.z + Math.sin(a) * d;
      kit.put(i % 3 === 0 ? MODULAR_FBX.barrel : MODULAR_FBX.bollard, {
        x: px, z: pz, rotY: -a, size: 1.2, emissive: i % 3 === 0 ? '#b388ff' : null, emissiveIntensity: 0.8,
      });
    }
    for (let i = 0; i < 4; i++) {
      const a = i * (Math.PI / 2) + 0.5;
      kit.put(PROP_GLB.lanternStanding, {
        x: p.x + Math.cos(a) * (CITY_R - 1), z: p.z + Math.sin(a) * (CITY_R - 1),
        rotY: -a, size: 2.2, emissive: '#b388ff', emissiveIntensity: 1.2,
      });
    }
  }

  // Lagoon: palms, benches and a picket fence around the water.
  {
    const p = POIS[1];
    const trees = [PROP_GLB.treeOrangeLarge, PROP_GLB.treeOrangeMedium, PROP_GLB.treeYellowLarge, PROP_GLB.treeYellowMedium];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rng() * 0.3;
      const d = 12 + rng() * 9;
      const px = p.x + Math.cos(a) * d;
      const pz = p.z + Math.sin(a) * d;
      kit.put(trees[i % trees.length], { x: px, z: pz, rotY: spin(1), height: 4.5 + rng() * 2.5, shadow: true });
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = p.x + Math.cos(a) * 17;
      const pz = p.z + Math.sin(a) * 17;
      kit.put(i % 2 ? PROP_GLB.fence : PROP_GLB.fenceSeparate, { x: px, z: pz, rotY: -a + Math.PI / 2, size: 2.4 });
    }
    for (let i = 0; i < 4; i++) {
      const a = spin(1);
      kit.put(i % 2 ? PROP_GLB.benchDecorated : PROP_GLB.bench, {
        x: p.x + Math.cos(a) * 7, z: p.z + Math.sin(a) * 7, rotY: a, size: 2.2,
      });
    }
  }

  // Neon Grove: voxel trees, standing lanterns and low voxel fencing.
  {
    const p = POIS[3];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rng() * 0.25;
      const d = 10 + rng() * 12;
      const px = p.x + Math.cos(a) * d;
      const pz = p.z + Math.sin(a) * d;
      if (rng() > 0.45) {
        kit.put(GRAVEYARD_OBJ.tree, { x: px, z: pz, rotY: spin(1), height: 5 + rng() * 3 });
      } else {
        kit.put(PROP_GLB.lanternStanding, { x: px, z: pz, rotY: spin(1), size: 2.1, emissive: '#39ffd2', emissiveIntensity: 1.2 });
      }
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const d = 20;
      kit.put(GRAVEYARD_OBJ.fence, { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, rotY: -a + Math.PI / 2, size: 2.6 });
    }
  }

  // Skyline: rails and corner lights on every deck, so the tower reads as
  // climbable architecture rather than floating slabs.
  {
    const p = POIS[4];
    const tiers = [0, 3.4, 6.8, 10.2, 13.6];
    tiers.forEach((lift, i) => {
      const a = i * 0.7;
      const px = p.x + Math.cos(a) * (3 + i * 1.6);
      const pz = p.z + Math.sin(a) * (3 + i * 1.6);
      const y = heightAt(px, pz) + lift + 0.3;
      const span = 9 - 0.5;
      for (const s of [-1, 1]) {
        kit.put(MODULAR_FBX.railing, { x: px + s * span * 0.48, y, z: pz, rotY: 0, size: span, shadow: false });
        kit.put(MODULAR_FBX.railing, { x: px, y, z: pz + s * span * 0.48, rotY: Math.PI / 2, size: span, shadow: false });
      }
      kit.put(PROP_GLB.lanternStanding, { x: px, y, z: pz, size: 1.4, emissive: '#67d4ff', emissiveIntensity: 1.3, shadow: false });
    });
  }

  // Heartfall Crater: voxel tombs, leaning gravestones and loose bones.
  {
    const p = POIS[5];
    const tombs = [GRAVEYARD_OBJ.tomb1, GRAVEYARD_OBJ.tomb2, GRAVEYARD_OBJ.tomb3];
    const graves = [PROP_GLB.graveA, PROP_GLB.graveB, PROP_GLB.gravestone, PROP_GLB.graveDestroyed];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rng() * 0.2;
      const d = 10 + rng() * 10;
      const px = p.x + Math.cos(a) * d;
      const pz = p.z + Math.sin(a) * d;
      const src = i % 3 === 0 ? tombs[i % tombs.length] : graves[i % graves.length];
      kit.put(src, { x: px, z: pz, rotY: spin(1), height: i % 3 === 0 ? 2.4 : 1.5 });
    }
    for (let i = 0; i < 6; i++) {
      const a = spin(1);
      const d = 6 + rng() * 8;
      kit.put(i % 2 ? PROP_GLB.ribcage : PROP_GLB.skull, {
        x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, rotY: spin(1), size: 1.1,
      });
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      kit.put(GRAVEYARD_OBJ.pillar, { x: p.x + Math.cos(a) * 16, z: p.z + Math.sin(a) * 16, rotY: spin(1), height: 4 });
    }
  }
}

/**
 * The pre-match drop ship, assembled from the modular kit: a plated deck, a
 * railed perimeter, four corner posts carrying a canopy, plus cargo. Replaces
 * the old flying-saucer primitive entirely.
 */
function buildUfo(kit) {
  const group = new THREE.Group();
  const DECK = 10;

  // Deck plating ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â a cross of floor tiles so the hull has a real silhouette.
  kit.putIn(group, MODULAR_FBX.floor, { x: 0, y: 0, z: 0, size: DECK, ground: false, shadow: false });
  kit.putIn(group, MODULAR_FBX.floorAlt, { x: 0, y: 0.02, z: 0, rotY: Math.PI / 2, size: DECK, ground: false, shadow: false });
  kit.putIn(group, MODULAR_FBX.floorCorner, { x: 0, y: 0.04, z: 0, rotY: Math.PI / 4, size: DECK * 0.8, ground: false, shadow: false });

  // Perimeter railing.
  const R = DECK * 0.46;
  for (const [dx, dz, ry] of [[0, -R, 0], [0, R, 0], [-R, 0, Math.PI / 2], [R, 0, Math.PI / 2]]) {
    kit.putIn(group, MODULAR_FBX.railing, { x: dx, y: 0.2, z: dz, rotY: ry, size: DECK * 0.94, ground: false });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    kit.putIn(group, MODULAR_FBX.railingEdge, { x: Math.cos(a) * R, y: 0.2, z: Math.sin(a) * R, rotY: -a, size: 1.4, ground: false });
  }

  // Corner posts + canopy.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    kit.putIn(group, MODULAR_FBX.pillar, { x: Math.cos(a) * R * 0.86, y: 0.2, z: Math.sin(a) * R * 0.86, height: 4.4, ground: false });
  }
  kit.putIn(group, MODULAR_FBX.cubeSlab, { x: 0, y: 4.6, z: 0, size: DECK * 0.9, ground: false });
  kit.putIn(group, MODULAR_FBX.cubeLow, { x: 0, y: 4.1, z: 0, size: DECK * 0.55, ground: false });

  // Cargo and running lights.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    kit.putIn(group, i % 2 ? MODULAR_FBX.crateAlt : MODULAR_FBX.barrel, {
      x: Math.cos(a) * R * 0.6, y: 0.2, z: Math.sin(a) * R * 0.6, rotY: a, size: 1.3, ground: false,
    });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    kit.putIn(group, PROP_GLB.lanternStanding, {
      x: Math.cos(a) * R * 0.86, y: 4.2, z: Math.sin(a) * R * 0.86, size: 1.2, ground: false,
      emissive: '#7dfff0', emissiveIntensity: 1.4,
    });
  }

  // Descent beam, so the drop still reads from a distance.
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(3.2, 16, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xb7f6ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.position.y = -9;
  group.add(beam);

  const seats = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    seats.push({ x: Math.cos(a) * 3.1, y: 0.2, z: Math.sin(a) * 3.1, yaw: -a + Math.PI });
  }
  group.position.set(0, 70, 0);
  return { group, beam, seats };
}

/**
 * Loot chest: the library's own legendary supply chest, with its lid actually
 * hinged. The asset names the lid as a separate node, so opening is a rotation
 * rather than a colour swap, and the glow plate underneath sells the loot.
 */
export function buildChest() {
  const group = new THREE.Group();
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xff4f9a, emissive: 0xff4f9a, emissiveIntensity: 1.2, roughness: 0.3,
  });
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.9), glowMat);
  glow.position.y = 0.03;
  group.add(glow);

  const lid = new THREE.Group();
  group.add(lid);
  const body = new THREE.Group();
  group.add(body);

  let opened = false;
  function applyLid() {
    lid.rotation.x = opened ? -2.1 : 0;
    glowMat.color.set(opened ? 0x7dfff0 : 0xff4f9a);
    glowMat.emissive.set(opened ? 0x7dfff0 : 0xff4f9a);
    glowMat.emissiveIntensity = opened ? 2.4 : 1.2;
  }
  applyLid();

  // The chest arrives after the world does; until then the glow plate is a
  // readable marker, exactly like the pickup markers.
  loadGltf(ITEM_GLB.chest).then((gltf) => {
    const src = instanceOf(gltf.scene);
    src.updateMatrixWorld(true);
    fitToFootprint(src, 1.15);
    src.updateMatrixWorld(true);
    let foundLid = false;
    const p = new THREE.Vector3();
    // Collect first, reparent afterwards. Adding a node to another parent while
    // `traverse` is still walking the source mutates the very array traverse is
    // iterating, and three.js then reads `children` off a node that no longer
    // has it — which surfaced as `Cannot read properties of undefined (reading
    // 'traverse')` and left every chest in the world as a bare glow plate.
    const parts = [];
    src.traverse((o) => {
      if (!o.isMesh) return;
      const isLid = new RegExp(ITEM_LID_PART.chest.split('_').pop(), 'i').test(o.name || '');
      if (isLid) foundLid = true;
      o.getWorldPosition(p);
      o.position.sub(p);
      parts.push({ node: o, isLid });
    });
    for (const { node, isLid } of parts) (isLid ? lid : body).add(node);
    if (!foundLid) body.add(src);
    // Hinge the lid about its own rear edge so it swings rather than spins.
    lid.position.set(0, 0.42, 0.3);
    lid.children.forEach((c) => { c.position.z -= 0.3; });
    applyLid();
  }).catch((e) => {
    // The chest degrades to its glow plate if the model never arrives, so a
    // bare message would let a real load failure hide behind a chest that
    // still looks like a chest. Surface the reason and the stack.
    const where = e && e.stack ? String(e.stack).split('\n').slice(0, 4).join(' | ') : 'no stack';
    console.error('chest model failed', ITEM_GLB.chest, (e && (e.message || e.type || String(e))) || e, where);
  });

  group.userData.lid = lid;
  group.userData.setOpen = (open) => {
    opened = open;
    applyLid();
  };
  return group;
}

/** Pre-match staging deck at y=48, assembled from the modular kit. */
function buildLobby(kit) {
  const g = new THREE.Group();
  const D = 16;
  kit.putIn(g, MODULAR_FBX.floor, { x: 0, y: 0, z: 0, size: D, ground: false, shadow: false });
  kit.putIn(g, MODULAR_FBX.floorAlt, { x: 0, y: 0.03, z: 0, rotY: Math.PI / 2, size: D * 0.8, ground: false, shadow: false });
  const R = D * 0.46;
  for (const [dx, dz, ry] of [[0, -R, 0], [0, R, 0], [-R, 0, Math.PI / 2], [R, 0, Math.PI / 2]]) {
    kit.putIn(g, MODULAR_FBX.railing, { x: dx, y: 0.3, z: dz, rotY: ry, size: D * 0.92, ground: false });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    kit.putIn(g, MODULAR_FBX.pillar2, { x: Math.cos(a) * R * 0.9, y: 0.3, z: Math.sin(a) * R * 0.9, height: 5, ground: false });
    kit.putIn(g, PROP_GLB.lanternHanging, {
      x: Math.cos(a) * R * 0.9, y: 5, z: Math.sin(a) * R * 0.9, size: 1.3, ground: false,
      emissive: '#ff4f9a', emissiveIntensity: 1.3,
    });
  }
  kit.putIn(g, MODULAR_FBX.cubeSlab, { x: 0, y: 5.3, z: 0, size: D * 0.55, ground: false });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    kit.putIn(g, i % 2 ? MODULAR_FBX.crateAlt : MODULAR_FBX.cube, {
      x: Math.cos(a) * R * 0.62, y: 0.3, z: Math.sin(a) * R * 0.62, rotY: a, size: 1.6, ground: false,
    });
  }
  g.position.set(0, 48, 0);
  g.userData.box = makeBox(0, 48, 0, 14, 1.2, 14, 'lobby');
  return g;
}

export function busPosition(u) {
  // A short, tight drop line over the new island rather than a 240-unit cruise.
  const x = -70 + 140 * u;
  const z = 40 - 80 * u;
  const y = 54 + Math.sin(u * Math.PI) * 7;
  return { x, y, z };
}
