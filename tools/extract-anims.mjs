// node tools/extract-anims.mjs in.glb out.glb -> skeleton + animations only (no meshes/skins/textures)
import { NodeIO } from '@gltf-transform/core';
import { prune, resample } from '@gltf-transform/functions';
const [inp, out, keep] = process.argv.slice(2);
const KEEP = keep ? new Set(keep.split(',').map((x) => x.toLowerCase())) : null;
const io = new NodeIO();
const doc = await io.read(inp);
for (const n of doc.getRoot().listNodes()) { n.setMesh(null); n.setSkin(null); }
for (const m of doc.getRoot().listMeshes()) m.dispose();
for (const s of doc.getRoot().listSkins()) s.dispose();
for (const t of doc.getRoot().listTextures()) t.dispose();
for (const m of doc.getRoot().listMaterials()) m.dispose();
if (KEEP) for (const a of doc.getRoot().listAnimations()) if (!KEEP.has(a.getName().toLowerCase())) { for (const sm of a.listSamplers()) sm.dispose(); a.dispose(); }
for (const a of doc.getRoot().listAnimations()) for (const ch of a.listChannels()) { const n = ch.getTargetNode(); const nm = n ? n.getName() : ''; const path = ch.getTargetPath(); if (/index|middle|pinky|ring|thumb|leaf|ik_|twist/i.test(nm) || path === 'scale' || (path === 'translation' && !/^(pelvis|root)$/i.test(nm))) { const sm = ch.getSampler(); ch.dispose(); if (sm) sm.dispose(); } }
await doc.transform(resample({ tolerance: 0.0008 }), prune({ keepLeaves: true }));
await io.write(out, doc);
console.log('anims', doc.getRoot().listAnimations().length, 'nodes', doc.getRoot().listNodes().length);
