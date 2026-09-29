// node tools/decimate.mjs  -> welds + simplifies the generated HF meshes in place (originals kept in hf-concepts/glb/orig)
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { weld, simplify, normals } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
const TARGET = { sakura: 6000, lantern: 2500, cyberpagoda: 9000, machiya: 9000, bamboo: 1200, stall: 5000, kiosk: 3000, torii: 3500, bridge: 4000, chest: 3500 };
const dir = 'public/assets/hf';
fs.mkdirSync('hf-concepts/glb/orig', { recursive: true });
await MeshoptSimplifier.ready;
const io = new NodeIO();
for (const [name, tris] of Object.entries(TARGET)) {
  const f = `${dir}/${name}.glb`;
  const backup = `hf-concepts/glb/orig/${name}.glb`;
  if (!fs.existsSync(backup)) fs.copyFileSync(f, backup);
  const doc = await io.read(backup);
  let before = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) before += p.getIndices() ? p.getIndices().getCount() / 3 : p.getAttribute('POSITION').getCount() / 3;
  await doc.transform(weld({ tolerance: 1e-4 }), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, tris / before), error: 0.02, lockBorder: false }), normals({ overwrite: false }));
  await io.write(f, doc);
  let after = 0;
  const d2 = await io.read(f);
  for (const m of d2.getRoot().listMeshes()) for (const p of m.listPrimitives()) after += p.getIndices() ? p.getIndices().getCount() / 3 : 0;
  console.log(name, Math.round(before), '->', Math.round(after), (fs.statSync(f).size / 1e6).toFixed(2) + 'MB');
}
