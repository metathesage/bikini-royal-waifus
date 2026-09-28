/**
 * Kit asset validation.
 *
 * The environment is built from three source formats living in
 * `public/assets/props`. A typo in a path, a missing .bin, or a loader fed the
 * wrong object all fail *silently at runtime* in the browser â€” the island just
 * comes up undressed. So parse every kit asset here and assert real geometry
 * comes out, plus that the same normalization the world applies is sound.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { installAssetFetch } from './asset-fetch.mjs';
import {
  MODULAR_FBX, PROP_GLB, GRAVEYARD_OBJ, WEAPON_GLB, PROP_WEAPON_GLB,
  instanceOf, fitToFootprint, normalizeScene,
} from '../src/data/assets.js';

// Without this the loader path below has no base url under node and every kit
// asset throws ERR_INVALID_URL instead of parsing, which is the failure this
// file exists to catch.
installAssetFetch();

const failures = [];
function check(cond, msg) {
  if (!cond) failures.push(msg);
}

// FBXLoader and MaterialCreator both build an <img>/<canvas> to sniff texture
// support. Node has no DOM, so give them just enough to get through parsing.
globalThis.document = {
  createElement: () => ({ getContext: () => stubCtx(), width: 0, height: 0 }),
  createElementNS: () => ({
    getContext: () => stubCtx(),
    style: {},
    width: 0,
    height: 0,
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
  }),
};
function stubCtx() {
  return new Proxy({}, { get: () => () => {} });
}
// FileLoader raises a real ProgressEvent for data-uri requests.
globalThis.ProgressEvent = class ProgressEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
};

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const onDisk = (u) => ROOT + decodeURIComponent(u.replace(/^\//, ''));

function stats(root) {
  const s = { meshes: 0, verts: 0, withUv: 0, normals: 0 };
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    s.meshes += 1;
    s.verts += o.geometry.attributes.position?.count || 0;
    if (o.geometry.attributes.uv) s.withUv += 1;
    if (o.geometry.attributes.normal) s.normals += 1;
  });
  return s;
}

/** Drop image references so an asset parses with no network access. */
function stripTextures(json) {
  json.images = [];
  json.textures = [];
  json.samplers = [];
  for (const m of json.materials || []) {
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
  }
  return json;
}

/** Unpack a .glb container into plain glTF json with its BIN chunk inlined. */
function glbToJson(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'glTF') throw new Error('not a glb container');
  const jsonLength = dv.getUint32(12, true);
  const jsonType = dv.getUint32(16, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLength)));
  if (jsonType === 0x4E4F534A) {
    const binHeader = 20 + jsonLength;
    const binLength = dv.getUint32(binHeader, true);
    const binType = dv.getUint32(binHeader + 4, true);
    if (binType === 0x004E4942) {
      const bin = buf.subarray(binHeader + 8, binHeader + 8 + binLength);
      json.buffers = [{
        byteLength: binLength,
        uri: `data:application/octet-stream;base64,${Buffer.from(bin).toString('base64')}`,
      }];
    }
  }
  return json;
}

/* --- FBX: the modular prototyping kit ---------------------------------- */
{
  const loader = new FBXLoader();
  let total = 0;
  for (const [key, url] of Object.entries(MODULAR_FBX)) {
    const file = onDisk(url);
    if (!fs.existsSync(file)) {
      failures.push(`MODULAR_FBX.${key} missing on disk`);
      continue;
    }
    const buf = fs.readFileSync(file);
    let group = null;
    try {
      group = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    } catch (err) {
      failures.push(`MODULAR_FBX.${key} failed to parse: ${err.message}`);
      continue;
    }
    const s = stats(group);
    check(s.meshes > 0, `MODULAR_FBX.${key} parsed with no meshes`);
    check(s.verts > 0, `MODULAR_FBX.${key} has no vertices`);
    total += 1;
  }
  check(total === Object.keys(MODULAR_FBX).length, `only ${total}/${Object.keys(MODULAR_FBX).length} fbx parsed`);
}

/* --- OBJ/MTL: the voxel graveyard -------------------------------------- */
{
  let total = 0;
  for (const [key, url] of Object.entries(GRAVEYARD_OBJ)) {
    const file = onDisk(url);
    if (!fs.existsSync(file)) {
      failures.push(`GRAVEYARD_OBJ.${key} missing on disk`);
      continue;
    }
    let group = null;
    try {
      const creator = new MTLLoader().parse(fs.readFileSync(file.replace(/\.obj$/, '.mtl'), 'utf8'), '');
      creator.preload();
      // OBJLoader calls materials.create(name) per face, so it needs the
      // MaterialCreator itself â€” not the creator's plain materials map.
      const obj = new OBJLoader();
      obj.setMaterials(creator);
      group = obj.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      failures.push(`GRAVEYARD_OBJ.${key} failed to parse: ${err.message}`);
      continue;
    }
    const s = stats(group);
    check(s.meshes > 0, `GRAVEYARD_OBJ.${key} parsed with no meshes`);
    check(s.withUv > 0, `GRAVEYARD_OBJ.${key} has no UVs (textures would not show)`);
    total += 1;
  }
  check(total === Object.keys(GRAVEYARD_OBJ).length, `only ${total}/${Object.keys(GRAVEYARD_OBJ).length} obj parsed`);
}

/* --- glTF: KayKit props plus the weapon viewmodels/pickups --------------- */
{
  const loader = new GLTFLoader();

  /** Parse a gltf/GLB entirely offline, with buffers inlined as data uris. */
  async function parseGltf(url) {
    const file = onDisk(url);
    const raw = fs.readFileSync(file);
    let json;
    if (/\.glb$/i.test(file)) {
      json = glbToJson(raw);
    } else {
      json = JSON.parse(raw.toString('utf8'));
      const dir = file.slice(0, file.lastIndexOf('/') + 1);
      json.buffers = (json.buffers || []).map((b) => {
        if (b.uri && !/^data:/.test(b.uri)) {
          const bin = fs.readFileSync(dir + b.uri.replace(/^\.\//, ''));
          b.uri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
        }
        return b;
      });
    }
    return loader.parseAsync(JSON.stringify(stripTextures(json)), '');
  }

  for (const [group, entries] of [['PROP_GLB', PROP_GLB], ['WEAPON_GLB', WEAPON_GLB], ['PROP_WEAPON_GLB', PROP_WEAPON_GLB]]) {
    let total = 0;
    for (const [key, url] of Object.entries(entries)) {
      if (!fs.existsSync(onDisk(url))) {
        failures.push(`${group}.${key} missing on disk`);
        continue;
      }
      let gltf = null;
      try {
        gltf = await parseGltf(url);
      } catch (err) {
        failures.push(`${group}.${key} failed to parse: ${err.message}`);
        continue;
      }
      const s = stats(gltf.scene);
      check(s.meshes > 0, `${group}.${key} parsed with no meshes`);
      check(s.verts > 0, `${group}.${key} has no vertices`);
      check(s.normals > 0, `${group}.${key} has no normals (would render unlit)`);
      total += 1;
    }
    check(total === Object.keys(entries).length, `only ${total}/${Object.keys(entries).length} parsed from ${group}`);
  }
}

/* --- The world must be able to place these ----------------------------- */
{
  // A kit piece is normalized once, then cloned per placement. The clone has to
  // keep the same world size, or the island slowly inflates.
  const buf = fs.readFileSync(onDisk(MODULAR_FBX.crate));
  const group = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const base = instanceOf(group);
  fitToFootprint(base, 2);
  const sizeA = new THREE.Box3().setFromObject(base).getSize(new THREE.Vector3());
  const clone = instanceOf(base);
  clone.position.set(50, 0, 50);
  const sizeB = new THREE.Box3().setFromObject(clone).getSize(new THREE.Vector3());
  check(Math.abs(Math.max(...sizeA.toArray()) - 2) < 1e-3, `fitToFootprint size ${sizeA.toArray()}`);
  check(sizeA.distanceTo(sizeB) < 1e-4, `clone changed size ${sizeA.toArray()} -> ${sizeB.toArray()}`);

  // Characters normalize to human height whatever their source orientation.
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4, 0.5));
  m.position.set(0, 2, 0);
  g.add(m);
  normalizeScene(g, 1.7);
  const s = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
  check(Math.abs(s.y - 1.7) < 1e-3, `character height ${s.y}`);
}

/* --- A real character, end to end --------------------------------------- */
{
  // The cheapest character, so the test stays quick: parse it, normalize it the
  // way the locker does, and confirm a human-sized, grounded, front-facing rig.
  const { CHARACTERS, CHARACTER_MB } = await import('../src/data/assets.js');
  const loader = new GLTFLoader();
  const url = CHARACTERS.lucy_edgerunner.url;
  const file = onDisk(url);
  const json = stripTextures(glbToJson(fs.readFileSync(file)));
  const gltf = await loader.parseAsync(JSON.stringify(json), '');
  const s = stats(gltf.scene);
  check(s.meshes > 0, 'character parsed with no meshes');
  check(s.verts > 1000, `character looks empty (${s.verts} verts)`);

  const rig = instanceOf(gltf.scene);
  normalizeScene(rig, 1.7, { faceCamera: true });
  const box = new THREE.Box3().setFromObject(rig);
  const size = box.getSize(new THREE.Vector3());
  check(Math.abs(size.y - 1.7) < 0.02, `character height ${size.y.toFixed(3)}`);
  check(Math.abs(box.min.y) < 0.02, `character not grounded (${box.min.y.toFixed(3)})`);
  check(size.x < size.y && size.z < size.y, `character proportions look wrong ${size.toArray().map((n) => n.toFixed(2))}`);

  // Two actors on the same model must be independent objects.
  const other = instanceOf(gltf.scene);
  other.position.set(0, 0, 5);
  check(other !== rig, 'character clone is the same object');
  check(new THREE.Box3().setFromObject(rig).min.y < 0.05, 'moving one clone moved the other');
  check(CHARACTER_MB.lucy_edgerunner > 0, 'character missing a download size');
}

/* --- The city block the map is built around ----------------------------- */
{
  // buildCity() makes two assumptions about this asset: that it is genuinely
  // multi-level, and that enough of its meshes are wide-and-thin to read as
  // walkable slabs worth putting loot on. Both are load-bearing, so assert them
  // against the real file rather than trusting the numbers in a comment.
  const { CITY_GLB } = await import('../src/data/assets.js');
  const cityLoader = new GLTFLoader();
  const file = onDisk(CITY_GLB);
  check(fs.existsSync(file), 'city glb missing on disk');
  if (fs.existsSync(file)) {
    const gltf = await cityLoader.parseAsync(JSON.stringify(stripTextures(glbToJson(fs.readFileSync(file)))), '');
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z);
    check(span > 40, `city too small to be a district (${span.toFixed(1)})`);
    check(size.y > 8, `city is not multi-level (height ${size.y.toFixed(1)})`);

    let meshes = 0;
    let collide = 0;
    let slabs = 0;
    let tiers = new Set();
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      meshes += 1;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      const s = b.getSize(new THREE.Vector3());
      const foot = Math.max(s.x, s.z);
      // Same filters buildCity uses, so this is the real derived count.
      if (foot >= 1.4 && s.y >= 0.35) collide += 1;
      if (foot >= 3.5 && s.y <= 2.4) {
        slabs += 1;
        tiers.add(Math.round(b.max.y));
      }
    });
    check(meshes > 100, `city mesh count too low (${meshes})`);
    check(collide > 40, `not enough city collision surfaces (${collide})`);
    check(slabs >= 8, `too few walkable slabs for loot (${slabs})`);
    // "Multi-level" has to mean several distinct floors, not one tall box.
    check(tiers.size >= 3, `city only has ${tiers.size} usable tier(s): ${[...tiers].join(',')}`);
  }
}

if (failures.length) {
  for (const f of failures) console.error(f);
  console.error(`${failures.length} kit asset problem(s)`);
  process.exit(1);
}
console.log('kit assets ok');
