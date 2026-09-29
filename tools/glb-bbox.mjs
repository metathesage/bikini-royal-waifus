// node tools/glb-bbox.mjs file.glb ... -> world bbox size in the file's own units
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
globalThis.self = globalThis;
for (const f of process.argv.slice(2)) {
  const buf = fs.readFileSync(f);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  await new Promise((res) => new GLTFLoader().parse(ab, '', (g) => {
    const b = new THREE.Box3().setFromObject(g.scene); const s = b.getSize(new THREE.Vector3());
    console.log(f.split('/').pop(), s.x.toFixed(1), s.y.toFixed(1), s.z.toFixed(1)); res();
  }, (e) => { console.log(f, 'ERR', e.message); res(); }));
}
