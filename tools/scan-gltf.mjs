/**
 * Scan an asset library for rigged, animatable models.
 *
 * Prints a CSV-ish table of every glTF/GLB: size, mesh count, skin count and
 * animation names, so we can tell a rigged character from a static prop without
 * opening a single file by hand.
 *
 *   node tools/scan-gltf.mjs <rootDir> [--min-anim] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || '.';
const wantAnim = process.argv.includes('--min-anim');
const asJson = process.argv.includes('--json');
const SKIP = new Set(['node_modules', '.git', 'dist', '.vite', 'UnrealEditor']);

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      walk(full, out);
    } else if (/\.(glb|gltf)$/i.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Pull the JSON chunk out of a .glb container, or parse a .gltf directly. */
function readJson(file) {
  const raw = fs.readFileSync(file);
  if (/\.glb$/i.test(file)) {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const len = dv.getUint32(12, true);
    return JSON.parse(raw.subarray(20, 20 + len).toString('utf8'));
  }
  return JSON.parse(raw.toString('utf8'));
}

function matDiagnosis(json) {
  // One-line read on whether every material will render near-black:
  // base unusable + no usable light path = blackout.
  let unlit = 0;
  let ok = 0;
  for (const m of json.materials || []) {
    const pbr = m.pbrMetallicRoughness || {};
    const base = pbr.baseColorFactor;
    const baseDark = !base || (base[0] < 0.02 && base[1] < 0.02 && base[2] < 0.02);
    const hasMap = pbr.baseColorTexture != null || m.emissiveTexture != null;
    const emissiveLit = (m.emissiveFactor || []).some((v) => v > 0.05);
    if (baseDark && !hasMap && !emissiveLit) unlit++;
    else ok++;
  }
  return { unlit, ok };
}

const rows = [];
for (const file of walk(root)) {
  let json;
  try {
    json = readJson(file);
  } catch (err) {
    rows.push({ file, error: err.message });
    continue;
  }
  const skins = json.skins || [];
  const anims = json.animations || [];
  const animNames = anims.map((a) => a.name).filter(Boolean);
  const joints = skins.reduce((n, s) => n + (s.joints || []).length, 0);
  rows.push({
    file,
    mb: +(fs.statSync(file).size / 1048576).toFixed(2),
    meshes: (json.meshes || []).length,
    skins: skins.length,
    joints,
    anims: anims.length,
    animNames: animNames.slice(0, 14),
    mats: matDiagnosis(json),
  });
}

const interesting = rows.filter((r) => !r.error && (r.skins > 0 || r.anims > 0 || (!wantAnim && r.meshes > 0)));

if (asJson) {
  console.log(JSON.stringify(interesting, null, 2));
} else {
  for (const r of interesting) {
    if (r.error) continue;
    const rigged = r.skins > 0 ? `RIG(skins=${r.skins},joints=${r.joints})` : 'static';
    const anim = r.anims > 0 ? `ANIM(${r.anims}) ${r.animNames.join(',')}` : '';
    const mat = r.mats.unlit > 0 ? `BLACKOUT(${r.mats.unlit}/${r.mats.unlit + r.mats.ok})` : 'lit-ok';
    console.log(`${rigged.padEnd(26)} ${anim.padEnd(52)} ${mat.padEnd(14)} meshes=${String(r.meshes).padEnd(4)} ${String(r.mb).padStart(8)}MB  ${r.file}`);
  }
  console.log(`${interesting.length} of ${rows.length} files`);
}
