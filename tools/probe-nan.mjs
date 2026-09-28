/**
 * Find where the NaN in a weapon viewmodel comes from.
 *
 * The island probe can pick up a gun, the model loads (pending clears, meshes
 * appear, every transform on the chain is finite) and yet the world bounding box
 * comes back NaN. `Box3.isEmpty()` is a min/max comparison and NaN fails every
 * comparison, so a NaN-bearing box reports "not empty" - which is why every
 * `box.isEmpty()` guard in the codebase passes while the size is garbage.
 *
 * This loads the same GLBs the viewmodel uses and reports, per file, how many
 * meshes carry a non-finite position and what their transforms are. That splits
 * the two possibilities apart: bad vertex data baked into the asset, versus a
 * transform applied after load.
 *
 *   node tools/probe-nan.mjs
 */
import { installAssetFetch } from '../test/asset-fetch.mjs';

installAssetFetch();

const ctx2d = new Proxy({}, { get: () => () => {} });
globalThis.document = {
  createElement() { return { width: 128, height: 128, getContext: () => ctx2d }; },
};

const { loadGltf, instanceOf, WEAPON_GLB, setAssetManifest } = await import('../src/data/assets.js');
const THREE = await import('three');
const { readFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');

setAssetManifest(JSON.parse(readFileSync(
  fileURLToPath(new URL('../public/assets/manifest.json', import.meta.url)), 'utf8',
)));

/** Every non-finite number in a geometry attribute, by name. */
function auditGeometry(geo) {
  const bad = {};
  if (!geo || !geo.attributes) return bad;
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const arr = attr.array;
    if (!arr) continue;
    let n = 0;
    for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) n++;
    if (n) bad[name] = n;
  }
  return bad;
}

const finite = (a) => a.every(Number.isFinite);

async function audit(id, url) {
  let gltf;
  try {
    gltf = await loadGltf(url);
  } catch (e) {
    return { id, error: e.message.slice(0, 60) };
  }
  const inst = instanceOf(gltf.scene);

  // Audit the RAW clone, before any of the viewmodel's centring/scaling.
  let badMeshes = 0;
  let totalMeshes = 0;
  const badAttrs = {};
  let badTransforms = 0;
  const offenders = [];
  inst.traverse((o) => {
    if (o.isMesh) {
      totalMeshes++;
      const bad = auditGeometry(o.geometry);
      if (Object.keys(bad).length) {
        badMeshes++;
        for (const [k, v] of Object.entries(bad)) badAttrs[k] = (badAttrs[k] || 0) + v;
        if (offenders.length < 3) {
          offenders.push(`${o.name || '(unnamed)'} ${JSON.stringify(bad)}`);
        }
      }
    }
    const p = o.position;
    const s = o.scale;
    if (!finite([p.x, p.y, p.z, s.x, s.y, s.z])) badTransforms++;
  });

  // The box the viewmodel actually computes, on the untouched clone. If this is
  // NaN then `longest` is NaN, `s = 0.62 / longest` is NaN, and the whole
  // instance is scaled to nothing - which is the visible symptom.
  const rawBox = new THREE.Box3().setFromObject(inst);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const longest = Math.max(rawSize.x, rawSize.y, rawSize.z);
  const scale = longest > 0.001 ? 0.62 / longest : 1;

  return {
    id,
    totalMeshes,
    badMeshes,
    badAttrs: Object.keys(badAttrs).length ? JSON.stringify(badAttrs) : '-',
    badTransforms,
    boxFinite: finite([rawBox.min.x, rawBox.min.y, rawBox.min.z, rawBox.max.x, rawBox.max.y, rawBox.max.z]),
    rawSize: [rawSize.x, rawSize.y, rawSize.z].map((v) => (Number.isFinite(v) ? +v.toFixed(3) : 'NaN')).join(' x '),
    scale: +scale.toFixed(4),
    offenders: offenders.length ? offenders.join(' | ') : '-',
  };
}

const rows = [];
for (const [id, url] of Object.entries(WEAPON_GLB)) rows.push(await audit(id, url));

console.log('\n=== weapon viewmodel NaN audit ===\n');
console.table(rows);

const bad = rows.filter((r) => r.badMeshes > 0 || r.badTransforms > 0 || r.boxFinite === false);
if (bad.length) {
  console.error(`\nNaN in the source geometry of: ${bad.map((r) => r.id).join(', ')}`);
  console.error('The viewmodel centres and scales these with Box3 maths, so a NaN here');
  console.error('propagates into inst.position and the weapon is never drawn on screen.');
  process.exit(1);
}
console.log('\nno NaN in any weapon viewmodel source');
