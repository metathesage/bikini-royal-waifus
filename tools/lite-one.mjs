// node tools/lite-one.mjs <in.glb> <out.glb> <tris> [texSize]
import { NodeIO } from '@gltf-transform/core';
import { normals, flatten, join, weld, simplify, dedup, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
const [inp, out, tris, tex = '512'] = process.argv.slice(2);
await MeshoptSimplifier.ready;
const io = new NodeIO();
const doc = await io.read(inp);
let before = 0;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) before += p.getIndices() ? p.getIndices().getCount() / 3 : p.getAttribute('POSITION').getCount() / 3;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { p.setAttribute('NORMAL', null); p.setAttribute('TANGENT', null); }
await doc.transform(flatten(), dedup(), join(), weld({ tolerance: 1e-4 }), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, Number(tris) / before), error: 0.5 }), textureCompress({ encoder: sharp, resize: [Number(tex), Number(tex)], targetFormat: 'webp' }), prune(), normals({ overwrite: true }));
await io.write(out, doc);
console.log(inp.split('/').pop(), Math.round(before), 'tris ->', out);
