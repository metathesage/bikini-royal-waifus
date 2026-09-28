import * as THREE from 'three';
import { installAssetFetch } from './asset-fetch.mjs';

installAssetFetch();

import { planarBasis, yawForDirection, selfTestBasis, screenBearing, bearingTo } from '../src/core/basis.js';
import { raySphere, rayAABB, pushOut, floorAt, makeBox } from '../src/game/collision.js';
import { normalizeScene, fitToFootprint, instanceOf, watchAsset, assetState } from '../src/data/assets.js';

function check(cond, msg) {
  if (!cond) {
    console.error(msg);
    process.exit(1);
  }
}

const errors = selfTestBasis();
if (errors.length) {
  console.error(errors);
  process.exit(1);
}

const cam = new THREE.PerspectiveCamera();
cam.position.set(0, 1.6, 5);
cam.lookAt(0, 1.6, 0);
cam.updateMatrixWorld(true);
const camBasis = planarBasis(cam);
check(camBasis.forward.distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-3, 'cam forward');
check(camBasis.right.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-3, 'cam right');

const yaw = new THREE.Object3D();
yaw.rotation.y = 0;
yaw.updateMatrixWorld(true);
const yawBasis = planarBasis(yaw);
check(yawBasis.forward.distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-3, `yaw0 forward ${yawBasis.forward.toArray()}`);
check(yawBasis.right.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-3, `yaw0 right ${yawBasis.right.toArray()}`);
check(Math.abs(yawForDirection(0, -1)) < 1e-6, 'yaw -z');
check(Math.abs(yawForDirection(1, 0) + Math.PI / 2) < 1e-4, 'yaw +x');

const t = raySphere(0, 0, 0, 0, 0, -1, 0, 0, -5, 1);
check(t != null && Math.abs(t - 4) < 1e-3, `sphere hit ${t}`);
check(raySphere(0, 0, 0, 0, 0, 1, 0, 0, -5, 1) == null, 'sphere miss');

const box = makeBox(0, 0, -5, 2, 2, 2);
const tb = rayAABB(0, 0, 0, 0, 0, -1, box);
check(tb != null && tb > 0, `aabb hit ${tb}`);

const pushed = pushOut(0.2, 0, 0.5, 0, 2, [makeBox(0, 1, 0, 2, 2, 2)]);
check(Math.abs(pushed.z) > 0.4 || Math.abs(pushed.x) > 0.4, `pushOut ${JSON.stringify(pushed)}`);

const floor = floorAt(0, 0, 0.3, [makeBox(0, 1, 0, 4, 2, 4)], 0);
check(Math.abs(floor - 2) < 1e-6, `floor ${floor}`);

/* --- Directional hit indicators ------------------------------------- */
// Camera yaw 0 looks down -Z, so +X is to the right of the screen.
check(Math.abs(screenBearing(0, -1, 0)) < 1e-6, 'bearing straight ahead is 0');
check(screenBearing(1, 0, 0) < -1.5, 'bearing to +X is to the right (negative)');
check(screenBearing(-1, 0, 0) > 1.5, 'bearing to -X is to the left (positive)');
check(Math.abs(screenBearing(0, 1, 0) - Math.PI) < 1e-6, 'bearing behind is PI');
// Positive yaw turns the player left (facing -X at +PI/2), so a +X target ends
// up behind; negative yaw turns right and brings that same target dead ahead.
check(Math.abs(screenBearing(1, 0, -Math.PI / 2)) < 1e-6, 'turning right to face a +X shooter reads as ahead');
check(Math.abs(Math.abs(screenBearing(1, 0, Math.PI / 2)) - Math.PI) < 1e-6, 'turning left puts a +X shooter behind');
// Turning right by a quarter leaves the target a quarter-turn to the right,
// which is the negative bearing.
const half = screenBearing(1, 0, -Math.PI / 4);
check(Math.abs(half + Math.PI / 4) < 1e-6, `quarter turn bearing ${half}`);
check(Math.abs(bearingTo(0, 0, 0, -10, 0)) < 1e-6, 'bearingTo ahead');
check(bearingTo(0, 0, 10, 0, 0) < -1.5, 'bearingTo right');
// Wrapping: a target behind-right must not produce an out-of-range angle.
for (const yaw of [0, 1, 2, 3, -1, -2, -3, Math.PI]) {
  const a = screenBearing(0.7, 0.7, yaw);
  check(a > -Math.PI - 1e-9 && a <= Math.PI + 1e-9, `bearing wrapped for yaw ${yaw}: ${a}`);
}

/* --- Asset normalization -------------------------------------------- */
function boxOf(o) {
  const b = new THREE.Box3().setFromObject(o);
  return { min: b.min.toArray(), max: b.max.toArray(), size: b.getSize(new THREE.Vector3()).toArray() };
}

// A Y-up character is scaled to the requested height, feet on the ground and
// centred on the origin.
{
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3, 0.2));
  body.position.set(2, 1.5, -3);
  g.add(body);
  normalizeScene(g, 1.7);
  const { min, max, size } = boxOf(g);
  check(Math.abs(size[1] - 1.7) < 1e-4, `normalized height ${size[1]}`);
  check(Math.abs(min[1]) < 1e-4, `feet on ground ${min[1]}`);
  check(Math.abs((min[0] + max[0]) / 2) < 1e-4, `centred x ${(min[0] + max[0]) / 2}`);
  check(Math.abs((min[2] + max[2]) / 2) < 1e-4, `centred z ${(min[2] + max[2]) / 2}`);
}

// A Z-up export (tallest axis on Z) must be stood upright, not squashed.
{
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 3));
  body.position.set(0, 0, 1.5);
  g.add(body);
  normalizeScene(g, 1.7);
  const { size } = boxOf(g);
  check(size[1] > size[2], `z-up model stood up: size ${size}`);
  check(Math.abs(size[1] - 1.7) < 1e-3, `z-up height ${size[1]}`);
  check(Math.abs(size[0] - 0.4 / 3 * 1.7) < 1e-3, `z-up width preserved ${size[0]}`);
}

// Facing: a +Z-forward export is turned to face the game's -Z forward.
{
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  m.name = 'nose';
  m.position.set(0, 0.5, 0.4);
  g.add(m);
  normalizeScene(g, 1.7, { faceCamera: true });
  const nose = g.getObjectByName('nose');
  const world = nose.getWorldPosition(new THREE.Vector3());
  check(world.z < -0.1, `nose rotated to -Z, got ${world.z.toFixed(2)}`);
  check(Math.abs(world.x) < 1e-3, 'facing rotation keeps the model centred on x');
}

// fitToFootprint normalizes any prop to a target longest-edge size.
{
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 4));
  m.position.set(0, 1, 0);
  g.add(m);
  fitToFootprint(g, 3);
  const { min, size } = boxOf(g);
  check(Math.abs(Math.max(...size) - 3) < 1e-4, `footprint ${size}`);
  check(Math.abs(min[1]) < 1e-4, `footprint grounded ${min[1]}`);
}

// instanceOf must hand back an independent node: two actors sharing one loaded
// scene is what made characters vanish when a model was picked twice.
{
  const src = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mesh.name = 'body';
  src.add(mesh);
  const a = instanceOf(src);
  const b = instanceOf(src);
  check(a !== src && b !== src && a !== b, 'clones are distinct objects');
  check(a.getObjectByName('body') !== b.getObjectByName('body'), 'clone subtrees are distinct');
  check(a.getObjectByName('body').geometry === src.getObjectByName('body').geometry, 'geometry is shared (cheap clones)');
  const host = new THREE.Group();
  host.add(a);
  host.add(b);
  check(a.parent === host && b.parent === host, 'both clones parent independently');
  check(src.parent === null, 'source scene never re-parented');
}

/* --- Asset registry -------------------------------------------------- */
{
  const url = '/assets/__test__/missing.glb';
  const seen = [];
  const stop = watchAsset(url, (state, progress) => seen.push(state));
  check(assetState(url).state === 'idle', `fresh url is idle, got ${assetState(url).state}`);
  check(seen.length === 1 && seen[0] === 'idle', 'watcher fires immediately with current state');
  stop();
  check(assetState(url).state === 'idle', 'unsubscribing leaves state untouched');
}

/* --- Every kit path must resolve to a real file ------------------------- */
// The environment maps are hand-written, space-containing paths, so a typo is
// silent until the island fails to dress itself. Check them against the tree.
{
  const { existsSync, readFileSync } = await import('node:fs');
  const { CHARACTERS, WEAPON_GLB, MAP_DECOR_GLB, MODULAR_FBX, PROP_GLB, GRAVEYARD_OBJ, PROP_WEAPON_GLB, CHARACTER_MB, BOT_MODEL_POOL } = await import('../src/data/assets.js');
  const root = new URL('../public/', import.meta.url);
  const resolve = (u) => {
    // A url of /assets/x maps to public/assets/x, so drop only the leading slash.
    const rel = decodeURIComponent(u.replace(/^\//, ''));
    return new URL(rel, root);
  };
  const groups = { CHARACTERS, WEAPON_GLB, MODULAR_FBX, PROP_GLB, GRAVEYARD_OBJ, PROP_WEAPON_GLB };
  for (const [name, group] of Object.entries(groups)) {
    for (const [key, value] of Object.entries(group)) {
      const u = typeof value === 'string' ? value : value.url;
      check(typeof u === 'string' && u.startsWith('/assets/'), `${name}.${key} looks like a url: ${u}`);
      check(existsSync(resolve(u)), `${name}.${key} missing on disk: ${u}`);
    }
  }
  check(existsSync(resolve(MAP_DECOR_GLB)), `MAP_DECOR_GLB missing: ${MAP_DECOR_GLB}`);

  // KayKit ships gltf + declared buffer/texture siblings; a missing one is a
  // hard load failure that would only surface in the browser.
  for (const [key, u] of Object.entries(PROP_GLB)) {
    const p = resolve(u);
    const json = JSON.parse(readFileSync(p, 'utf8'));
    const refs = [...(json.buffers || []), ...(json.images || [])]
      .map((r) => r.uri)
      .filter((uri) => uri && !/^(data:|https?:)/.test(uri));
    check(refs.length > 0, `PROP_GLB.${key} declares no external resources`);
    for (const uri of refs) {
      check(existsSync(new URL(uri, p)), `PROP_GLB.${key} missing sibling ${uri}`);
    }
  }

  // VoxelGraveyard objs reference their .mtl + .png siblings.
  for (const [key, u] of Object.entries(GRAVEYARD_OBJ)) {
    const p = resolve(u);
    const mtl = new URL(p.href.replace(/\.obj$/, '.mtl'));
    const png = new URL(p.href.replace(/\.obj$/, '.png'));
    check(existsSync(mtl), `GRAVEYARD_OBJ.${key} has no sibling .mtl`);
    check(existsSync(png), `GRAVEYARD_OBJ.${key} has no sibling .png`);
    // The .mtl must actually point at a texture that exists too.
    const mtlText = readFileSync(mtl, 'utf8');
    for (const m of mtlText.matchAll(/^map_Kd\s+(\S+)/gm)) {
      check(existsSync(new URL(m[1], mtl)), `GRAVEYARD_OBJ.${key} mtl missing texture ${m[1]}`);
    }
  }

  // Every locker entry is priced, and bots never draw a heavy body.
  const { MODELS } = await import('../src/data/catalog.js');
  for (const m of MODELS) {
    if (m.id === 'procedural') continue;
    check(CHARACTERS[m.id], `locker model ${m.id} missing from CHARACTERS`);
    check(typeof CHARACTER_MB[m.id] === 'number', `locker model ${m.id} missing a download size`);
  }
  for (const id of BOT_MODEL_POOL) {
    check(CHARACTERS[id], `bot pool id ${id} missing from CHARACTERS`);
    check(CHARACTER_MB[id] <= 12, `bot pool id ${id} is too heavy for a 44-strong roster (${CHARACTER_MB[id]} MB)`);
  }
}

/* --- The weapon tables must not just exist, they must load -------------- */
// Every gun id has to resolve to a real gun model that parses into real
// geometry, and guns and melee may never borrow each other's models.
//
// What this deliberately does NOT do is try to recognise a projectile by its
// shape. `pistol` once pointed at pew.glb, a bullet mesh, and no geometric
// test could have caught it: the whole Styl'oo pack is authored flat, so
// pew.glb (0.148 x 0.065 x 0.013) and the perfectly good ak47.glb
// (0.743 x 0.226 x 0.025) are the same kind of shape. That was a naming
// mistake and only a human reading the pack could have seen it.
{
  const { WEAPON_GLB, MELEE_GLB, loadGltf } = await import('../src/data/assets.js');
  const { GUNS, MELEE } = await import('../src/game/weapons.js');

  // A melee id must never resolve to a gun model and vice versa. `rocket`,
  // `arVariant` and friends have models but no GUNS entry yet, so they are
  // deliberately not required to; what they may never do is collide with a
  // melee id or point at a file that is not a weapon.
  for (const id of Object.keys(WEAPON_GLB)) {
    check(MELEE[id] === undefined, `WEAPON_GLB.${id} is a melee id, not a gun`);
  }
  for (const id of Object.keys(MELEE_GLB)) {
    check(MELEE[id] !== undefined, `MELEE_GLB.${id} is not a real melee id`);
    check(GUNS[id] === undefined, `MELEE_GLB.${id} is a gun id, not a melee`);
  }

  // Every gun must have a model, and every model must parse into real geometry.
  // A projectile or a stray emitter fails the size check the way a missing file
  // fails the load. Melee is deliberately left out: it is built from primitives
  // in viewmodel.js, and a GLB is an extra flourish where one exists.
  for (const id of Object.keys(GUNS)) {
    check(!!WEAPON_GLB[id], `holdable gun ${id} has no viewmodel glb`);
  }
  for (const [tableName, table] of [['WEAPON_GLB', WEAPON_GLB], ['MELEE_GLB', MELEE_GLB]]) {
    for (const [key, u] of Object.entries(table)) {
      const gltf = await loadGltf(u);
      check(!!gltf && !!gltf.scene, `${tableName}.${key} produced no scene: ${u}`);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z);
      // A real weapon is centimetres-to-decimetres in source units; anything
      // degenerate (a single point, a stray emitter) fails here.
      check(longest > 0.01, `${tableName}.${key} has degenerate geometry (longest ${longest}): ${u}`);
    }
  }
}

console.log('frame tests ok');
