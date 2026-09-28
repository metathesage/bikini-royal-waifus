import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Percent-encode each path segment so kits with spaces in folder names resolve. */
function url(...parts) {
  return parts.map((p) => p.split('/').map(encodeURIComponent).join('/')).join('/');
}

/** Self-contained character GLBs served from public/assets/characters. */
export const CHARACTERS = {
  girl_sexy: { id: 'girl_sexy', name: 'Girl Sexy', rarity: 'epic', url: '/assets/characters/girl_sexy.glb' },
  goddess_of_victory_nikke: { id: 'goddess_of_victory_nikke', name: 'Nayuta Wu Wei', rarity: 'legendary', url: '/assets/characters/goddess_of_victory_nikke_-_nayuta_wu_wei_ver..glb' },
  venus_goddess: { id: 'venus_goddess', name: 'Venus Goddess', rarity: 'legendary', url: '/assets/characters/venus_goddess..glb' },
  alice_nikke: { id: 'alice_nikke', name: 'Alice NIKKE', rarity: 'mythic', url: '/assets/characters/alice_-_nikke_goddess_of_victory.glb' },
  bunny_girl_dark: { id: 'bunny_girl_dark', name: 'Bunny Noir', rarity: 'epic', url: '/assets/characters/bunny_girl_dark.glb' },
  chicken_gun_fruzer: { id: 'chicken_gun_fruzer', name: 'Fruzer Cyberpunk', rarity: 'rare', url: '/assets/characters/chicken_gun_fruzer_cyberpunk.glb' },
  elaina_witch: { id: 'elaina_witch', name: 'Elaina', rarity: 'legendary', url: '/assets/characters/elaina_-_the_witchs_journey.glb' },
  lucy_wuthering: { id: 'lucy_wuthering', name: 'Lucy Waves', rarity: 'mythic', url: '/assets/characters/wuthering_waves_lucy_downloadable.glb' },
  jemadia_open_data: { id: 'jemadia_open_data', name: 'Open Data', rarity: 'rare', url: '/assets/characters/jemadia_suekentonmiller_grishin2014_open_data (1).glb' },
  the_lament: { id: 'the_lament', name: 'The Lament', rarity: 'legendary', url: '/assets/characters/the_lament_-_destiny_2.glb' },
  angle_fantasy: { id: 'angle_fantasy', name: 'Angle Fantasy', rarity: 'epic', url: '/assets/characters/angle_fantasy_ai.glb' },
  chaperone: { id: 'chaperone', name: 'Chaperone', rarity: 'rare', url: '/assets/characters/chaperone_from_destiny_2.glb' },
  citlali: { id: 'citlali', name: 'Citlali', rarity: 'epic', url: '/assets/characters/citlali.glb' },
  black_panther: { id: 'black_panther', name: 'Black Panther', rarity: 'rare', url: '/assets/characters/black_panther.glb' },
  lucy_edgerunner: { id: 'lucy_edgerunner', name: 'Lucy Edgerunner', rarity: 'mythic', url: '/assets/characters/lucy_edgerunner.glb' },
  lucy_edgerunner_2: { id: 'lucy_edgerunner_2', name: 'Lucy Edgerunner II', rarity: 'legendary', url: '/assets/characters/lucy_edgerunner (2).glb' },
  // Extra rigged heroes. Kasumi and the Scifi Soldier carry no clips, so they are
  // driven entirely by the procedural rig; Mai Maid and Miyazawa ship real
  // lobby animation clips as well.
  kasumi_sailor: { id: 'kasumi_sailor', name: 'Kasumi Sailor', rarity: 'legendary', url: '/assets/characters/Kasumi_Tactical_Sailor.glb' },
  kasumi_sailor_hd: { id: 'kasumi_sailor_hd', name: 'Kasumi HD', rarity: 'mythic', url: '/assets/characters/Kasumi_Tactical_Sailor_AAA_100k.glb' },
  scifi_soldier: { id: 'scifi_soldier', name: 'Scifi Soldier', rarity: 'epic', url: '/assets/characters/SciFi_Waifu_Soldier.glb' },
  mai_maid: { id: 'mai_maid', name: 'Mai Maid', rarity: 'legendary', url: '/assets/characters/mai_maid_-bourin.glb' },
  miyazawa_idol: { id: 'miyazawa_idol', name: 'Miyazawa Idol', rarity: 'epic', url: '/assets/maps/miyazawa_blank_city.glb' },
};

/** Weapon viewmodel GLBs (Styloo normal-version) per gun id. */
export const WEAPON_GLB = {
  ar: '/assets/weapons/ak47.glb',
  smg: '/assets/weapons/mac10.glb',
  shot: '/assets/weapons/shotgun.glb',
  snip: '/assets/weapons/awp.glb',
  // Hawkmoon, a Destiny hand cannon. NOT pew.glb: in the Styl'oo pack "pew" is
  // the *bullet* mesh that sits beside bulletPEW.glb, so pointing the pistol at
  // it put a projectile in the player's hand. That is a PROP_WEAPON_GLB entry
  // (bulletPistol), not a weapon.
  pistol: '/assets/weapons/hawkmoon_handcannon.glb',
  arVariant: '/assets/weapons/ak47variant.glb',
  rocket: '/assets/weapons/rocketlaucher.glb',
  rocketVariant: '/assets/weapons/rocketlaunchervariant.glb',
  quadRocket: '/assets/weapons/quadrocket.glb',
};

/**
 * Melee viewmodel GLBs. Separate from WEAPON_GLB because the melee ids live in
 * MELEE, not GUNS, and mixing the two tables used to let a melee id quietly
 * pick up a gun model.
 */
export const MELEE_GLB = {
  // A plasma sword for the sunlance: a long glowing blade with a hilt, which is
  // the shape the procedural sunlance stand-in was already imitating.
  sunlance: '/assets/weapons/energy_sword_plasma.glb',
};

/**
 * Sandbox cast: one entry per real fighter on the arena floor. glbWaifu's
 * default and the dummy bodies both read this, so every visible character is
 * an actual shipped model with real textures — never the procedural fallback.
 */
export const SANDBOX_CAST = [
  'kasumi_sailor',
  'scifi_soldier',
  'mai_maid',
  'lucy_edgerunner',
  'citlali',
  'elaina_witch',
];

/** Small shared scene environment so PBR metals have something to reflect. */
let envTexture = null;
export function ensureEnvironment(renderer) {
  if (envTexture || !renderer) return envTexture;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTexture = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
    pmrem.dispose();
  } catch {
    envTexture = null;
  }
  return envTexture;
}

export function applyEnvironment(scene, renderer) {
  const tex = ensureEnvironment(renderer);
  if (tex && scene && !scene.environment) scene.environment = tex;
  return tex;
}

/** PvP arena map shipped in game dev files. Static shell, so no anim check. */
/** Decor GLB scattered across the island (plants). */
export const MAP_DECOR_GLB = '/assets/maps/low_poly_jungle_plant_package.glb';

/* ------------------------------------------------------------------ *
 * Environment kits
 * ------------------------------------------------------------------ */

const MODULAR = '/assets/props/free-modular/Free 3D Modular Game Assets For Prototyping/Pieces';
const KAYKIT = '/assets/props/KayKit_HalloweenBits_1.0_FREE/KayKit_HalloweenBits_1.0_FREE/Assets/gltf';
const GRAVEYARD = '/assets/props/VoxelGraveyard_Assets/Assets';

/**
 * "Free 3D Modular Game Assets For Prototyping" â€” FBX pieces used to build the
 * lobby platform, drop-ship, market stalls, cover crates and POI structures.
 * Keys are semantic so map.js never hardcodes a filename.
 */
export const MODULAR_FBX = {
  crate: `${url(MODULAR)}/box.fbx`,
  crateAlt: `${url(MODULAR)}/cube4.fbx`,
  cube: `${url(MODULAR)}/cube5.fbx`,
  cubeTall: `${url(MODULAR)}/cube6.fbx`,
  cubeWide: `${url(MODULAR)}/cube7.fbx`,
  cubeLow: `${url(MODULAR)}/cube8.fbx`,
  cubeSlab: `${url(MODULAR)}/cube9.fbx`,
  pillar: `${url(MODULAR)}/pillar.fbx`,
  pillar2: `${url(MODULAR)}/pillar1.fbx`,
  pillarThin: `${url(MODULAR)}/pillar2.fbx`,
  railing: `${url(MODULAR)}/railing.fbx`,
  railingEdge: `${url(MODULAR)}/railing edge.fbx`,
  wall: `${url(MODULAR)}/wall.fbx`,
  wallAlt: `${url(MODULAR)}/wall1.fbx`,
  wallWindow: `${url(MODULAR)}/wall window.fbx`,
  wallDoor: `${url(MODULAR)}/wall door.fbx`,
  wallCorner: `${url(MODULAR)}/wall corner.fbx`,
  wallTop: `${url(MODULAR)}/wall corner top.fbx`,
  floor: `${url(MODULAR)}/ground.fbx`,
  floorAlt: `${url(MODULAR)}/ground1.fbx`,
  floorCorner: `${url(MODULAR)}/ground corner.fbx`,
  stairs: `${url(MODULAR)}/stairs.fbx`,
  stairs2: `${url(MODULAR)}/stairs1.fbx`,
  ramp: `${url(MODULAR)}/ramp.fbx`,
  ladder: `${url(MODULAR)}/ladder.fbx`,
  barrel: `${url(MODULAR)}/cylinder.fbx`,
  barrel2: `${url(MODULAR)}/cylinder1.fbx`,
  table: `${url(MODULAR)}/cylinder2.fbx`,
  bollard: `${url(MODULAR)}/cylinder3.fbx`,
  fence: `${url(MODULAR)}/fence wood.fbx`,
  fenceAlt: `${url(MODULAR)}/fence2.fbx`,
  fenceEdge: `${url(MODULAR)}/fence edge.fbx`,
  door: `${url(MODULAR)}/door.fbx`,
};

/** KayKit Halloween Bits â€” gltf/.bin pairs, used for dressing POIs and cover. */
export const PROP_GLB = {
  arch: `${url(KAYKIT)}/arch.gltf`,
  archGate: `${url(KAYKIT)}/arch_gate.gltf`,
  bench: `${url(KAYKIT)}/bench.gltf`,
  benchDecorated: `${url(KAYKIT)}/bench_decorated.gltf`,
  candle: `${url(KAYKIT)}/candle.gltf`,
  candleTriple: `${url(KAYKIT)}/candle_triple.gltf`,
  coffin: `${url(KAYKIT)}/coffin.gltf`,
  coffinDecorated: `${url(KAYKIT)}/coffin_decorated.gltf`,
  crypt: `${url(KAYKIT)}/crypt.gltf`,
  fence: `${url(KAYKIT)}/fence.gltf`,
  fenceBroken: `${url(KAYKIT)}/fence_broken.gltf`,
  fenceGate: `${url(KAYKIT)}/fence_gate.gltf`,
  fencePillar: `${url(KAYKIT)}/fence_pillar.gltf`,
  fenceSeparate: `${url(KAYKIT)}/fence_seperate.gltf`,
  fenceSeparateBroken: `${url(KAYKIT)}/fence_seperate_broken.gltf`,
  lanternHanging: `${url(KAYKIT)}/lantern_hanging.gltf`,
  lanternStanding: `${url(KAYKIT)}/lantern_standing.gltf`,
  pillar: `${url(KAYKIT)}/pillar.gltf`,
  post: `${url(KAYKIT)}/post.gltf`,
  postLantern: `${url(KAYKIT)}/post_lantern.gltf`,
  postSkull: `${url(KAYKIT)}/post_skull.gltf`,
  shrine: `${url(KAYKIT)}/shrine.gltf`,
  shrineCandles: `${url(KAYKIT)}/shrine_candles.gltf`,
  graveA: `${url(KAYKIT)}/grave_A.gltf`,
  graveB: `${url(KAYKIT)}/grave_B.gltf`,
  graveDestroyed: `${url(KAYKIT)}/grave_A_destroyed.gltf`,
  gravestone: `${url(KAYKIT)}/gravestone.gltf`,
  pathA: `${url(KAYKIT)}/path_A.gltf`,
  pathB: `${url(KAYKIT)}/path_B.gltf`,
  pathC: `${url(KAYKIT)}/path_C.gltf`,
  pathD: `${url(KAYKIT)}/path_D.gltf`,
  plaque: `${url(KAYKIT)}/plaque.gltf`,
  plaqueCandles: `${url(KAYKIT)}/plaque_candles.gltf`,
  pumpkin: `${url(KAYKIT)}/pumpkin_orange.gltf`,
  pumpkinJack: `${url(KAYKIT)}/pumpkin_orange_jackolantern.gltf`,
  pumpkinSmall: `${url(KAYKIT)}/pumpkin_orange_small.gltf`,
  ribcage: `${url(KAYKIT)}/ribcage.gltf`,
  skull: `${url(KAYKIT)}/skull.gltf`,
  treeDeadSmall: `${url(KAYKIT)}/tree_dead_small.gltf`,
  treeDeadMedium: `${url(KAYKIT)}/tree_dead_medium.gltf`,
  treeDeadLarge: `${url(KAYKIT)}/tree_dead_large.gltf`,
  treeOrangeSmall: `${url(KAYKIT)}/tree_pine_orange_small.gltf`,
  treeOrangeMedium: `${url(KAYKIT)}/tree_pine_orange_medium.gltf`,
  treeOrangeLarge: `${url(KAYKIT)}/tree_pine_orange_large.gltf`,
  treeYellowSmall: `${url(KAYKIT)}/tree_pine_yellow_small.gltf`,
  treeYellowMedium: `${url(KAYKIT)}/tree_pine_yellow_medium.gltf`,
  treeYellowLarge: `${url(KAYKIT)}/tree_pine_yellow_large.gltf`,
};

/** VoxelGraveyard â€” OBJ/MTL voxel props for the crater and grove POIs. */
export const GRAVEYARD_OBJ = {
  tree: `${url(GRAVEYARD)}/SM-1-Tree.obj`,
  tomb1: `${url(GRAVEYARD)}/SM-3-Tomb1.obj`,
  tomb2: `${url(GRAVEYARD)}/SM-4-Tomb2.obj`,
  tomb3: `${url(GRAVEYARD)}/SM-5-Tomb3.obj`,
  fence: `${url(GRAVEYARD)}/SM-7-Fence.obj`,
  pillar: `${url(GRAVEYARD)}/SM-8-Pillar.obj`,
  spade: `${url(GRAVEYARD)}/SM-10-Spade.obj`,
};

/** Small weapon props used for pickups, projectiles and supply crates. */
export const PROP_WEAPON_GLB = {
  ammoBox: '/assets/weapons/ammobox_low.glb',
  bulletRifle: '/assets/weapons/bullet1.glb',
  bulletPistol: '/assets/weapons/bulletPEW.glb',
  bulletShotgun: '/assets/weapons/bulletshotgun.glb',
  bulletSniper: '/assets/weapons/bulletsniper.glb',
  nade: '/assets/weapons/nade_low.glb',
  nadeVariant: '/assets/weapons/nadevariant_low.glb',
  smoke: '/assets/weapons/smoke_low.glb',
  flashbang: '/assets/weapons/flashbang_low.glb',
  incendiary: '/assets/weapons/incendiary_low.glb',
  quadRocket: '/assets/weapons/quadrocket.glb',
  // Note: the shipped file is misspelled "rocketlaucher" on disk.
  rocketLauncher: '/assets/weapons/rocketlaucher.glb',
  rocketLauncherVariant: '/assets/weapons/rocketlaunchervariant.glb',
  ak47Variant: '/assets/weapons/ak47variant.glb',
  plank: '/assets/weapons/board.glb',
};

/**
 * Item models from the shared library. Every one is a small, hand-named prop
 * with a distinct sub-mesh for its lid or core, which is what lets the loot
 * chests actually swing open instead of just recolouring.
 */
export const ITEM_GLB = {
  chest: '/assets/items/BR_Supply_Chest_Legendary.glb',
  ammoCrate: '/assets/items/Heavy_Munitions_Ammo_Crate.glb',
  grenade: '/assets/items/Plasma_Sticky_Grenade.glb',
  shieldCell: '/assets/items/Shield_Battery_Cell.glb',
  powerCore: '/assets/items/Overshield_Power_Core.glb',
  medkit: '/assets/items/BioFoam_Medkit.glb',
  speedPack: '/assets/items/Speed_Boost_Thruster_Pack.glb',
  damageCrown: '/assets/items/Damage_Boost_Overdrive.glb',
  camoPrism: '/assets/items/Active_Camo_Prism.glb',
  shieldPuck: '/assets/items/Deployable_Drop_Shield_Puck.glb',
};

/** Sub-mesh names worth animating, keyed by item model. */
export const ITEM_LID_PART = {
  chest: 'GEO-chest_lid',
  ammoCrate: 'GEO-ammo_lid',
  grenade: 'GEO-plasma_grenade_cap',
};

/**
 * The dense multi-level city block that forms the centre of the new map: 359
 * meshes of buildings, walkways and interiors spanning roughly y = -3..+9.
 */
export const CITY_GLB = '/assets/maps/pvp_map.glb';

/** Generated by tools/sync-assets.mjs; cached after the first fetch. */
let manifestPromise = null;

/** Pre-seed the manifest (tests, or a build that inlines it). */
export function setAssetManifest(m) {
  manifestPromise = Promise.resolve(m);
}

/** Fetch the generated manifest once. */
export function loadAssetManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch('/assets/manifest.json')
      .then((r) => {
        if (!r.ok) throw new Error(`manifest ${r.status}`);
        return r.json();
      })
      .catch((e) => {
        console.error('asset manifest failed', e);
        manifestPromise = null;
        return null;
      });
  }
  return manifestPromise;
}

/**
 * The 45-entry rigged female roster (FBX + matching albedo PNG), with urls
 * normalised to absolute paths.
 */
export async function loadPsxManifest() {
  const m = await loadAssetManifest();
  return ((m && m.psxFemale) || []).map((e) => ({
    ...e,
    url: `/${e.url.replace(/^\//, '')}`,
    tex: e.tex ? `/${e.tex.replace(/^\//, '')}` : null,
  }));
}

/**
 * The PSX roster indexed by id, for lookups that must resolve synchronously
 * (bot spawning happens inside a build step). Populated by `primePsxRoster`;
 * empty until the manifest has been fetched once.
 */
export const PSX_BY_ID = {};
let psxRoster = null;

/**
 * Fetch the manifest and index the roster. Safe to call repeatedly; returns the
 * same array each time so callers can await it at several call sites.
 */
export function primePsxRoster() {
  if (!psxRoster) {
    psxRoster = loadPsxManifest().then((list) => {
      PSX_BY_ID.length = 0;
      for (const e of list) PSX_BY_ID[e.id] = e;
      return list;
    });
  }
  return psxRoster;
}

/** The roster array, priming the manifest on first use. */
export function getPsxRoster() {
  return primePsxRoster();
}

/**
 * Per-model download size in MB. The locker shows this so a 117 MB download is
 * never a surprise, and bots are kept off the heavy end of the list.
 */
export const CHARACTER_MB = {
  girl_sexy: 117,
  goddess_of_victory_nikke: 108,
  venus_goddess: 59,
  alice_nikke: 52,
  bunny_girl_dark: 46,
  chicken_gun_fruzer: 42,
  elaina_witch: 25,
  lucy_wuthering: 21,
  jemadia_open_data: 13,
  the_lament: 12,
  angle_fantasy: 11,
  chaperone: 9,
  citlali: 8,
  black_panther: 7,
  lucy_edgerunner: 5,
  kasumi_sailor: 8.5,
  kasumi_sailor_hd: 12,
  scifi_soldier: 8.8,
  mai_maid: 4.1,
  miyazawa_idol: 4.8,
  lucy_edgerunner_2: 5,
};

/**
 * The cheapest character GLBs in the locker.
 *
 * Bots no longer draw from this — they deal out the rigged PSX roster, which is
 * both smaller and far more varied. This stays as the documented "cheap tier":
 * it is what a lightweight bot pass would use, and the asset tests walk it to
 * make sure those files keep resolving.
 */
export const BOT_MODEL_POOL = [
  'lucy_edgerunner',
  'black_panther',
  'citlali',
  'chaperone',
  'angle_fantasy',
];

/* ------------------------------------------------------------------ *
 * Loading registry
 *
 * Every asset URL goes through one cache so a 117 MB character downloads
 * once per session no matter how many actors, previews or pickups reference
 * it. Callers subscribe for progress without racing the promise.
 * ------------------------------------------------------------------ */

const REGISTRY = new Map();
const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();
const objLoader = new OBJLoader();
const mtlLoader = new MTLLoader();
const textureLoader = new THREE.TextureLoader();

function entry(url) {
  let e = REGISTRY.get(url);
  if (!e) {
    e = { url, state: 'idle', progress: 0, error: null, promise: null, listeners: new Set() };
    REGISTRY.set(url, e);
  }
  return e;
}

function publish(e, state) {
  e.state = state;
  if (state === 'ready' || state === 'error') e.listeners.clear();
  else for (const cb of e.listeners) cb(e.state, e.progress, e.error);
}

function track(e, start) {
  e.promise = new Promise((resolve, reject) => {
    start(
      (value) => {
        e.progress = value;
        for (const cb of e.listeners) cb(e.state, e.progress, e.error);
        resolve(value);
      },
      (err) => {
        e.progress = 0;
        e.error = err;
        publish(e, 'error');
        reject(err);
      },
    );
  });
  // Callers that only want state (not the mesh) must not trip an unhandled
  // rejection when an asset 404s.
  //
  // This has to be attached to the *rejected* promise rather than to a re-read
  // of it. `e.promise.catch(() => {})` returns a NEW promise; it marks the
  // original as handled, which is what we want, and it must stay attached to
  // the same promise object forever. Reassigning `e.promise` here would hand
  // later callers a promise that never rejects, so a genuine failure would be
  // silently swallowed instead of surfacing as a load error.
  e.promise.catch(() => {});
  return e.promise;
}

function reportProgress(e, ev) {
  if (!ev) return;
  if (ev.lengthComputable && ev.total) e.progress = Math.min(1, ev.loaded / ev.total);
  else if (ev.loaded) e.progress = Math.min(0.99, e.loaded / 5_000_000);
  for (const cb of e.listeners) cb(e.state, e.progress, e.error);
}

/** Subscribe to an asset's lifecycle. Fires immediately with the current state. */
export function watchAsset(url, cb) {
  const e = entry(url);
  e.listeners.add(cb);
  cb(e.state, e.progress, e.error);
  return () => e.listeners.delete(cb);
}

/**
 * Aggregate view of everything the asset registry has been asked for.
 *
 * `skinned: 0` while 43 rigged bots are supposedly on the island is the kind of
 * bug that looks like a modelling problem and is actually a loader problem, so
 * the registry reports its own state rather than making us guess.
 */
export function assetReport() {
  const byState = { idle: 0, loading: 0, ready: 0, error: 0 };
  const failures = [];
  for (const [url, e] of REGISTRY) {
    byState[e.state] = (byState[e.state] || 0) + 1;
    if (e.state === 'error') {
      failures.push({ url, error: e.error ? (e.error.message || String(e.error)) : 'unknown' });
    }
  }
  return { total: REGISTRY.size, byState, failures: failures.slice(0, 12), failureCount: failures.length };
}

/** Snapshot of an asset's state: 'idle' | 'loading' | 'ready' | 'error'. */
export function assetState(url) {
  const e = REGISTRY.get(url);
  return e ? { state: e.state, progress: e.progress, error: e.error } : { state: 'idle', progress: 0, error: null };
}

/**
 * Download (once) and return the parsed glTF.
 *
 * The `onLoad` guard matters more than it looks. These URLs are shared across
 * a dozen subsystems through one cache, and a GLB whose scene fails to build
 * used to hand back a result with no `.scene`, so the failure surfaced later
 * as `Cannot read properties of undefined (reading 'traverse')` inside an
 * unrelated consumer. Failing here names the asset that actually broke.
 */
export function loadGltf(u) {
  const e = entry(u);
  if (!e.promise) {
    e.state = 'loading';
    track(e, (resolve, reject) => {
      gltfLoader.load(
        u,
        (gltf) => {
          if (!gltf || !gltf.scene) {
            publish(e, 'error');
            reject(new Error(`gltf has no scene: ${u}`));
            return;
          }
          publish(e, 'ready');
          resolve(gltf);
        },
        (ev) => reportProgress(e, ev),
        (err) => reject(err || new Error(`gltf failed: ${u}`)),
      );
    });
  }
  return e.promise;
}

export function gltfScene(u) {
  return loadGltf(u).then((g) => g.scene);
}

/** Download (once) and return an FBX group from the modular kit. */
export function loadFbx(u) {
  const e = entry(u);
  if (!e.promise) {
    e.state = 'loading';
    track(e, (resolve, reject) => {
      fbxLoader.load(
        u,
        (fbx) => { publish(e, 'ready'); resolve(fbx); },
        (ev) => reportProgress(e, ev),
        (err) => reject(err || new Error(`fbx failed: ${u}`)),
      );
    });
  }
  return e.promise;
}

/**
 * Load a PSX-roster character: an FBX whose albedo lives in a sibling PNG.
 *
 * The FBX declares a texture reference the loader cannot resolve, so the map is
 * attached explicitly afterwards. Geometry, material and the image are each
 * fetched once and shared by every actor using this character.
 */
export function loadPsxCharacter(rec) {
  // Note the parameter is `rec`, not `entry`: `entry()` is the registry helper
  // and a parameter of the same name would shadow it into a non-callable.
  const e = entry(`psx:${rec.url}`);
  if (!e.promise) {
    e.state = 'loading';
    track(e, (resolve, reject) => {
      Promise.all([loadFbx(rec.url), rec.tex ? loadTexture(rec.tex) : null])
        .then(([fbx, tex]) => {
          const scene = fbx;
          scene.traverse((o) => {
            if (!o.isMesh || !o.material) return;
            for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
              // Always override, never "fill in if missing". FBXLoader hands back
              // materials whose `map` is a real Texture object whose image never
              // resolved — it is non-null, so a `if (!m.map)` guard skips it and
              // every character renders as a black silhouette. The manifest's
              // atlas is the texture we actually want, unconditionally.
              if (tex) m.map = tex;
              if (m.map) {
                m.map.colorSpace = THREE.SRGBColorSpace;
                m.map.anisotropy = 4;
                m.map.needsUpdate = true;
              }
              m.color = new THREE.Color(0xffffff);
              if ('roughness' in m) m.roughness = 0.85;
              if ('metalness' in m) m.metalness = 0;
              if ('envMapIntensity' in m) m.envMapIntensity = 0.4;
              m.side = THREE.FrontSide;
              m.needsUpdate = true;
            }
            // A skinned mesh is posed by moving its bones, so its bounds are
            // whatever the bind pose says — culling on that is always wrong
            // once the rig starts animating.
            if (o.isSkinnedMesh) o.frustumCulled = false;
          });
          publish(e, 'ready');
          resolve(scene);
        })
        .catch((err) => reject(err || new Error(`psx character failed: ${rec.url}`)));
    });
  }
  return e.promise;
}

/** Download (once) and return a texture, with sRGB colour space set. */
export function loadTexture(u) {
  const e = entry(u);
  if (!e.promise) {
    e.state = 'loading';
    track(e, (resolve, reject) => {
      textureLoader.load(
        u,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 4;
          publish(e, 'ready');
          resolve(tex);
        },
        (ev) => reportProgress(e, ev),
        (err) => reject(err || new Error(`texture failed: ${u}`)),
      );
    });
  }
  return e.promise;
}

/** Download (once) and return an OBJ group, resolving its .mtl sibling. */
export function loadObj(u) {
  const e = entry(u);
  if (!e.promise) {
    e.state = 'loading';
    track(e, (resolve, reject) => {
      const done = () => {
        objLoader.load(
          u,
          (group) => { publish(e, 'ready'); resolve(group); },
          (ev) => reportProgress(e, ev),
          (err) => reject(err || new Error(`obj failed: ${u}`)),
        );
      };
      mtlLoader.load(`${u.slice(0, u.lastIndexOf('/') + 1)}${u.slice(u.lastIndexOf('/') + 1).replace(/\.obj$/, '.mtl')}`, (creator) => {
        creator.preload();
        // OBJLoader calls materials.create(name) per face, so it needs the
        // MaterialCreator itself â€” not the creator's plain materials map.
        objLoader.setMaterials(creator);
        done();
      }, undefined, () => {
        // No usable .mtl â€” load geometry with the default material.
        objLoader.setMaterials(null);
        done();
      });
    });
  }
  return e.promise;
}

/**
 * Build an independent instance of a loaded asset. `Object3D.clone` would
 * share the source node, so a second actor using the same model would silently
 * steal it from the first; SkeletonUtils.clone also rebinds any skin.
 */
export function instanceOf(source) {
  if (!source || typeof source.clone !== 'function') {
    // Callers hand us `gltf.scene`. When a GLB parses to something without a
    // usable root, this used to throw `Cannot read properties of undefined
    // (reading 'traverse')` from deep inside hasSkeleton, with no clue which
    // asset was at fault. Fail here, loudly and by name.
    throw new Error(`instanceOf needs a cloneable Object3D, got ${source === undefined ? 'undefined' : typeof source}`);
  }
  if (hasSkeleton(source)) return skinnedClone(source);
  return source.clone(true);
}

/** Does this hierarchy contain a real skeleton we would need to rebind? */
function hasSkeleton(node) {
  let found = false;
  node.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton && o.skeleton.bones.length) found = true;
  });
  return found;
}
/**
 * Clone a skinned character so it can be posed independently.
 *
 * This is deliberately *not* `SkeletonUtils.clone`. That function exists to let
 * many meshes share one skeleton, and to do it it bakes every SkinnedMesh down
 * to a static Mesh — which silently turns a rigged character into a statue
 * while leaving the bones in the scene looking perfectly healthy. That is the
 * worst possible failure mode: the rig system appears to work and nothing moves.
 *
 * Instead: clone the whole tree (geometry and materials are shared, which is
 * what keeps 43 bots cheap), then rewire each clone's SkinnedMesh onto the
 * clone's own bones.
 */
function skinnedClone(source) {
  const clone = source.clone(true);

  // Map each original bone to its counterpart in the clone by walking both trees
  // in lockstep — clone() preserves child order exactly, so index alignment is
  // safe here and much cheaper than name matching.
  const boneMap = new Map();
  const pairBones = (src, dst) => {
    if (src.isBone && dst.isBone) boneMap.set(src, dst);
    const n = Math.min(src.children.length, dst.children.length);
    for (let i = 0; i < n; i++) pairBones(src.children[i], dst.children[i]);
  };
  pairBones(source, clone);

  // Same trick for the skinned meshes, so each clone knows which original
  // skeleton it is replacing.
  const srcSkinned = [];
  const dstSkinned = [];
  source.traverse((o) => { if (o.isSkinnedMesh) srcSkinned.push(o); });
  clone.traverse((o) => { if (o.isSkinnedMesh) dstSkinned.push(o); });

  for (let i = 0; i < dstSkinned.length; i++) {
    const src = srcSkinned[i];
    const dst = dstSkinned[i];
    if (!src || !src.skeleton) continue;
    const bones = src.skeleton.bones.map((b) => boneMap.get(b) || b);
    if (bones.some((b) => !b)) continue; // remap failed; leave the shared skeleton
    // The clone's bones sit at exactly the same transforms as the originals, so
    // the original bone-inverses are still correct — copy them, never recompute
    // them. Recomputing from the current pose is what quietly deforms a model.
    dst.bind(new THREE.Skeleton(bones, src.skeleton.boneInverses.slice()), dst.bindMatrix);
  }
  return clone;
}

/** Normalize a loaded scene: uniform scale to a target height, feet on y=0, centered on origin. */
export function normalizeScene(scene, targetHeight = 1.7, opts = {}) {
  const { faceCamera = false, up = 'auto' } = opts;

  scene.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(scene);
  let size = box.getSize(new THREE.Vector3());

  // Some exporters ship Z-up (or -Z-up) models. A standing humanoid always has
  // its longest axis vertical, so if depth outruns height the model is lying
  // down in its own space and has to be stood up before we measure anything.
  const shouldRotate = up === 'auto' ? size.z > size.y * 1.05 : up === 'z';
  if (shouldRotate && size.z > 0.001) {
    // Measure with the turn applied, then carry the turn on the scene itself.
    //
    // An earlier version kept a holder Group and remembered it in
    // `scene.userData.upHolder`. That was the root of two separate bugs:
    // `userData` is copied by value on `clone()`, so every clone pointed at a
    // holder that was no longer its parent, and the holder also parented the
    // scene away from whoever owned it. Rotating the scene in place and letting
    // the holder go leaves a clean tree that clones correctly.
    const holder = new THREE.Group();
    holder.rotation.x = -Math.PI / 2; // +Z -> +Y
    holder.add(scene);
    holder.updateMatrixWorld(true);
    const turned = new THREE.Box3().setFromObject(holder);
    const turnedSize = turned.getSize(new THREE.Vector3());
    // Undo the parent, then apply the same turn to the scene directly.
    scene.position.set(0, 0, 0);
    holder.remove(scene);
    scene.rotation.x -= Math.PI / 2;
    scene.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(scene);
    size = box.getSize(new THREE.Vector3());
    // Scaling is derived from the turned height, which the caller reads back
    // through `size`; fall back to the measured value when the direct turn
    // produced nothing.
    if (!(size.y > 0.001)) size.copy(turnedSize);
  }

  const scale = size.y > 0.001 ? targetHeight / size.y : 1;
  scene.scale.setScalar(scale);
  scene.updateMatrixWorld(true);

  box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  scene.position.x -= center.x;
  scene.position.z -= center.z;
  scene.position.y -= box.min.y;

  // glTF convention is +Z forward; the game's characters and viewmodels face
  // -Z, so a turn of PI puts imported characters the right way round.
  if (faceCamera) scene.rotation.y += Math.PI;

  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      if (o.isSkinnedMesh) o.frustumCulled = false;
    }
  });
  scene.updateMatrixWorld(true);
  return scene;
}

/**
 * Fit a prop to a target footprint instead of a height â€” used for kit pieces
 * whose real-world size is unknown until they stream in.
 */
export function fitToFootprint(scene, size = 1) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const ext = box.getSize(new THREE.Vector3());
  const longest = Math.max(ext.x, ext.y, ext.z);
  if (!(longest > 0.001)) return scene;
  scene.scale.setScalar(size / longest);
  scene.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(scene);
  const c = box2.getCenter(new THREE.Vector3());
  scene.position.x -= c.x;
  scene.position.z -= c.z;
  scene.position.y -= box2.min.y;
  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  scene.updateMatrixWorld(true);
  return scene;
}

/** Recolor + simplify a kit material so imported props sit in the toon world. */
export function tintScene(scene, { color = null, roughness = null, metalness = null, emissive = null, emissiveIntensity = 0 } = {}) {
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (color && m.color) m.color.set(color);
      if (roughness != null && 'roughness' in m) m.roughness = roughness;
      if (metalness != null && 'metalness' in m) m.metalness = metalness;
      if (emissive && m.emissive) m.emissive.set(emissive);
      if (emissiveIntensity && 'emissiveIntensity' in m) m.emissiveIntensity = emissiveIntensity;
      if ('envMapIntensity' in m) m.envMapIntensity = 0.4;
      m.needsUpdate = true;
    }
  });
  return scene;
}
