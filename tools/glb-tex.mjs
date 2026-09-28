/**
 * What is actually inside a .glb's textures and materials.
 *
 * A render can look wrong for two opposite reasons — an unlit black surface, or
 * a surface whose albedo is simply dark — and both look identical in a PNG. The
 * material's `color` is only a multiplier: when a mesh has a `map`, the texture
 * dominates completely. So lifting a near-black `color` does nothing if a dark
 * texture sits underneath it, and a pure-black base with no map is a hole no
 * light can save. This prints images + material factors so the call can be made.
 *
 *   node tools/glb-tex.mjs public/assets/maps/pvp_map.glb
 */
import fs from 'node:fs';
import { decodePng, meanOf } from './png-util.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/glb-tex.mjs <file.glb>');
  process.exit(2);
}

const buf = fs.readFileSync(file);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
if (dv.getUint32(0, true) !== 0x46546c67) {
  console.error('not a glb container');
  process.exit(2);
}
const jsonLen = dv.getUint32(12, true);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binOff = 20 + jsonLen;

function binSlice(view) {
  const off = binOff + 8 + (view.byteOffset || 0);
  return buf.subarray(off, off + view.byteLength);
}

const images = [];
(json.images || []).forEach((im, i) => {
  if (im.uri && !im.uri.startsWith('data:')) {
    images.push({ i, name: im.name || '?', note: `external ${im.uri}` });
    return;
  }
  let bytes = null;
  if (im.bufferView != null && json.bufferViews) {
    bytes = binSlice(json.bufferViews[im.bufferView]);
  } else if (im.uri && im.uri.startsWith('data:')) {
    const b64 = im.uri.slice(im.uri.indexOf(',') + 1);
    bytes = Buffer.from(b64, 'base64');
  }
  if (!bytes) {
    images.push({ i, name: im.name || '?', note: 'no bytes' });
    return;
  }
  const mime = im.mimeType || '';
  if (mime.includes('jpeg') || mime.includes('jpg')) {
    images.push({ i, name: im.name || '?', mime, note: 'jpeg — not decoded here' });
    return;
  }
  try {
    const px = decodePng(bytes);
    const stat = meanOf(px, 8);
    images.push({
      i,
      name: im.name || '?',
      mime: mime || 'image/png',
      size: `${px.w}x${px.h}`,
      mean: stat.mean,
      lum: stat.lum,
      darkFrac: stat.darkFrac,
    });
  } catch (e) {
    images.push({ i, name: im.name || '?', mime, note: e.message });
  }
});

console.log(`glb: ${file}`);
console.log(`materials: ${(json.materials || []).length}, images: ${(json.images || []).length}`);
for (const m of json.materials || []) {
  const pbr = m.pbrMetallicRoughness || {};
  const slot = (tex) => {
    if (tex == null || tex.index == null) return 'null';
    const t = (json.textures || [])[tex.index];
    return t ? `img${t.source}` : 'null';
  };
  const base = pbr.baseColorFactor ? `[${pbr.baseColorFactor.map((v) => +v.toFixed(3)).join(',')}]` : '[]';
  console.log(`  mat "${m.name || '?'}" base=${base} metal=${pbr.metallicFactor} ` +
    `rough=${pbr.roughnessFactor} map=${slot(pbr.baseColorTexture)} normalMap=${m.normalTexture ? slot(m.normalTexture) : 'null'}`);
}
for (const im of images) {
  const extra = im.mean
    ? ` {"size":"${im.size}","mean":"${im.mean}","lum":${im.lum},"darkFrac":${im.darkFrac}}`
    : ` {"note":"${im.note || ''}"}`;
  console.log(`  img "${im.name}" ${im.mime || ''}${extra}`);
}
