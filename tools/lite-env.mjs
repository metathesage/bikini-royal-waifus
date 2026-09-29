// node tools/lite-env.mjs -> joined + simplified copies of the heavy env GLBs in public/assets/env-lite
import { NodeIO } from '@gltf-transform/core';
import { flatten, join, weld, simplify, dedup, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
const T = { japanese_restaurant: 14000, japanese_restaurant_inakaya: 9000, japanese_shrine: 16000, big_pink_tree: 6000, jpn_vending_machine: 3500, japanese_neon_street_sign: 2500 };
await MeshoptSimplifier.ready;
const io = new NodeIO();
for (const [n, tris] of Object.entries(T)) {
  const doc = await io.read(`public/assets/env/${n}.glb`);
  let before = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) before += p.getIndices() ? p.getIndices().getCount() / 3 : p.getAttribute('POSITION').getCount() / 3;
  await doc.transform(flatten(), dedup(), join(), weld({ tolerance: 1e-4 }), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, tris / before), error: 0.03 }), prune());
  await io.write(`public/assets/env-lite/${n}.glb`, doc);
  let after = 0, prims = 0;
  const d2 = await io.read(`public/assets/env-lite/${n}.glb`);
  for (const m of d2.getRoot().listMeshes()) for (const p of m.listPrimitives()) { prims++; after += p.getIndices() ? p.getIndices().getCount() / 3 : p.getAttribute('POSITION').getCount() / 3; }
  console.log(n, Math.round(before), '->', Math.round(after), 'prims', prims);
}
