/**
 * Probe FBX files in a directory: bones, meshes, UVs, materials, rest bounds.
 * Used to characterise a character library before wiring it into the game.
 *
 *   node tools/probe-fbx.mjs <dir> [limit]
 */
import fs from 'node:fs';
import path from 'node:path';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as THREE from 'three';

// FBXLoader pokes at the DOM to sniff texture support.
globalThis.document = {
  createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }) }),
  createElementNS: () => ({
    getContext: () => new Proxy({}, { get: () => () => {} }),
    style: {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
  }),
};

const dir = process.argv[2];
const limit = Number(process.argv[3] || 8);
if (!dir) {
  console.error('usage: node tools/probe-fbx.mjs <dir> [limit]');
  process.exit(1);
}

const files = fs.readdirSync(dir).filter((f) => /\.fbx$/i.test(f));
const loader = new FBXLoader();
const loaderQuiet = { warn() {}, error() {} };
loaderManagerConsole(loader);

function loaderManagerConsole() {
  // three logs a skinning-weight warning per file; keep the table readable.
  const orig = console.warn;
  console.warn = () => {};
  process.on('exit', () => { console.warn = orig; });
}

const rows = [];
for (const f of files.slice(0, limit > 0 ? limit : files.length)) {
  const raw = fs.readFileSync(path.join(dir, f));
  let group = null;
  try {
    group = loader.parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  } catch (err) {
    rows.push({ f, error: err.message });
    continue;
  }
  let bones = 0;
  let skinned = 0;
  let meshes = 0;
  let verts = 0;
  let withUv = 0;
  const boneNames = [];
  const materials = new Set();
  group.traverse((o) => {
    if (o.isBone) {
      bones += 1;
      if (boneNames.length < 60) boneNames.push(o.name);
    }
    if (o.isSkinnedMesh) skinned += 1;
    if (o.isMesh) {
      meshes += 1;
      verts += o.geometry.attributes.position?.count || 0;
      if (o.geometry.attributes.uv) withUv += 1;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material].filter(Boolean))) {
        materials.add(`${m.name || '-'}${m.map ? '[tex]' : ''}`);
      }
    }
  });
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  rows.push({ f, bones, skinned, meshes, verts, withUv, materials: [...materials], size, minY: box.min.y, boneNames });
}

for (const r of rows) {
  if (r.error) {
    console.log(`FAIL ${r.f}: ${r.error}`);
    continue;
  }
  console.log(
    `${r.f.padEnd(34)} bones=${String(r.bones).padStart(3)} skinned=${r.skinned} meshes=${r.meshes} verts=${String(r.verts).padStart(6)} uv=${r.withUv} `
    + `h=${r.size.y.toFixed(2)} minY=${r.minY.toFixed(2)} mats=[${r.materials.join(' ')}]`,
  );
}
if (rows[0]?.boneNames?.length) console.log(`\nbones: ${rows[0].boneNames.join(`, `)}`);
console.log(`\n${rows.length}/${files.length} probed`);
