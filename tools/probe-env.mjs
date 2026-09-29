/**
 * Environment GLB auditor.
 *
 * Every environment pack that lands in this project arrives with no
 * documentation beyond its filename, and the filename lies often enough that it
 * cannot be the basis for a placement decision: `japanese_temple.glb` does not
 * say it is 22 meshes and 70 MB of embedded PNG, and
 * `2bc13d0056ae47f49d2f7f9e00c4dc12.glb` says nothing at all. The three things
 * that actually decide whether a piece can be used on the map are all invisible
 * until the file is opened:
 *
 *   1. Real-world size. `normalizeScene` fits a piece to a target height, so a
 *      landmark needs to know what it is scaling: a shrine authored at 40 m
 *      dropped in at `height: 9` is a 4.4x shrink and its UV detail is gone.
 *      The report prints the authored bounding box in metres, which is also the
 *      number a collision box has to be derived from.
 *
 *   2. Texture weight. A GLB that is 70 MB for 22 meshes is not 70 MB of
 *      geometry -- it is embedded uncompressed art. Loading five of those on a
 *      loading screen is a memory and decode problem, not a download problem,
 *      so the audit separates geometry bytes from image bytes and names the
 *      largest images.
 *
 *   3. Material health. This codebase has a documented, recurring failure where
 *      an imported material renders pure black: a `baseColorFactor` of zero, a
 *      missing image, or `metallicFactor: 1` with nothing to reflect. map.js
 *      rescues all three in `makeLit()`, but only when the asset goes through
 *      the kit loader, so the audit reports what a piece will need.
 *
 * Also checks the two things that are fatal rather than inconvenient: geometry
 * containing non-finite positions (a NaN vertex poisons the bounding sphere and
 * the mesh vanishes), and image URIs pointing outside the file (a `.gltf` that
 * references a sibling `.png` cannot be ingested as a single asset).
 *
 * Run: node tools/probe-env.mjs ["environment assets"] [--json] [--top 8] [--copy]
 *
 * `--copy` ingests every usable piece into public/assets/env/ under a stable
 * slug, which is the step between "assessed" and "referenced by a map".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const doCopy = args.includes('--copy');
/**
 * Ingest budget in MB.
 *
 * Twenty is not arbitrary: it is where a file stops being a prop and starts
 * being a load-time problem. Everything above it in this library is above it
 * for the same two reasons -- uncompressed embedded art (a 20 cm sake bottle
 * carrying 65 MB of PNG) or raw scan-scale geometry (a temple authored across
 * 1.8 km at 835k triangles) -- and both need the piece re-exported before the
 * map can afford it. Gating on the number rather than on a list keeps the
 * decision auditable when the library changes.
 */
const maxArg = args.find((a) => a.startsWith('--max='));
const MAX_MB = maxArg ? Number(maxArg.split('=')[1]) : 20;
const targets = args.filter((a) => !a.startsWith('--'));

/** Directories to audit; the loose GLBs in the project root ride along. */
const dirs = targets.length ? targets : ['environment assets'];
const roots = [
  ...dirs.map((d) => path.resolve(ROOT, d)),
  path.resolve(ROOT, 'destiny_pyramid_ship.glb'),
  path.resolve(ROOT, 'japanese_sake_bottle.glb'),
];

const SKIP = new Set(['node_modules', '.git', 'dist', 'public', 'character design', 'weapons']);

function walk(p, out = []) {
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return out;
  }
  if (st.isFile()) {
    if (/\.glb$/i.test(p)) out.push(p);
    return out;
  }
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.isDirectory() && SKIP.has(e.name)) continue;
    walk(path.join(p, e.name), out);
  }
  return out;
}

/**
 * Parse a .glb into its JSON chunk and its binary chunk.
 *
 * The header layout matters: bytes 0-11 are magic, version and total length,
 * then each chunk is [uint32 length][4-byte type][payload]. Reading the JSON
 * chunk by its declared length rather than scanning for a closing brace is what
 * makes this work on files that carry a BIN chunk, which is all of them.
 */
function readGlb(file) {
  const raw = fs.readFileSync(file);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  let off = 12;
  let json = null;
  let bin = null;
  while (off + 8 <= raw.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const body = raw.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error('no JSON chunk');
  return { json, bin, bytes: raw.byteLength };
}


const COMPONENT = {
  5120: { size: 1, read: (dv, o) => dv.getInt8(o) },
  5121: { size: 1, read: (dv, o) => dv.getUint8(o) },
  5122: { size: 2, read: (dv, o) => dv.getInt16(o, true) },
  5123: { size: 2, read: (dv, o) => dv.getUint16(o, true) },
  5125: { size: 4, read: (dv, o) => dv.getUint32(o, true) },
  5126: { size: 4, read: (dv, o) => dv.getFloat32(o, true) },
};

/**
 * Iterate every POSITION of one primitive in its own local space.
 *
 * Reads the buffer rather than trusting `accessor.min`/`max`. Those are
 * optional outside POSITION, absent on some exporters, and -- the case that
 * matters -- authored by the same tool that wrote the bad vertex, so a file
 * with NaN positions frequently also claims sane bounds. Reading the floats is
 * the only way to see a NaN, and a NaN is a mesh that disappears at runtime.
 */
function eachPosition(json, bin, prim, cb) {
  const acc = json.accessors?.[prim.attributes?.POSITION];
  if (!acc) return { count: 0, missing: true, bad: 0 };
  const view = json.bufferViews?.[acc.bufferView];
  if (!view || !bin) return { count: 0, missing: true, bad: 0 };
  const c = COMPONENT[acc.componentType];
  if (!c) return { count: 0, missing: true, bad: 0 };
  // Views are relative to the BIN chunk, and `bin` is a Buffer whose own
  // byteOffset into its ArrayBuffer is not zero (readGlb subarrays it), so both
  // offsets have to be added rather than one of them assumed to be zero.
  const dv = new DataView(bin.buffer, bin.byteOffset + (view.byteOffset || 0), view.byteLength);
  const stride = view.byteStride || c.size * 3;
  let bad = 0;
  for (let i = 0; i < acc.count; i++) {
    const o = (acc.byteOffset || 0) + i * stride;
    const x = c.read(dv, o);
    const y = c.read(dv, o + c.size);
    const z = c.read(dv, o + c.size * 2);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) bad++;
    else cb(x, y, z);
  }
  return { count: acc.count, bad, missing: false };
}

/* --- minimal 4x4 matrix maths (column-major, glTF order) -------------- */
function identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

function fromTRS(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function apply(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function audit(file) {
  const out = { file: path.relative(ROOT, file).split(path.sep).join('/'), name: path.basename(file) };
  out.mb = +(fs.statSync(file).size / 1048576).toFixed(2);
  let glb;
  try {
    glb = readGlb(file);
  } catch (e) {
    out.fatal = e.message;
    return out;
  }
  const { json, bin } = glb;

  const bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let tris = 0;
  let verts = 0;
  let nanPrims = 0;
  let noUv = 0;
  let texturedNoUv = 0;
  let prims = 0;

  /*
   * Walk the node graph once, carrying the world matrix down, and accumulate
   * every primitive's bounds through it. The transform matters: several of these
   * packs park the art under a parent that carries a 0.01 unit scale, and
   * reporting local bounds would describe a piece 100x too large for the map.
   */
  const nodes = json.nodes || [];
  const visit = (idx, parent) => {
    const node = nodes[idx];
    if (!node) return;
    const world = mul(parent, fromTRS(node));
    if (node.mesh != null) {
      for (const prim of json.meshes?.[node.mesh]?.primitives || []) {
        prims++;
        const uv = prim.attributes?.UV0 ?? prim.attributes?.TEXCOORD_0;
        if (uv == null) noUv++;
        const r = eachPosition(json, bin, prim, (x, y, z) => {
          const [wx, wy, wz] = apply(world, x, y, z);
          if (wx < bbox.min[0]) bbox.min[0] = wx;
          if (wy < bbox.min[1]) bbox.min[1] = wy;
          if (wz < bbox.min[2]) bbox.min[2] = wz;
          if (wx > bbox.max[0]) bbox.max[0] = wx;
          if (wy > bbox.max[1]) bbox.max[1] = wy;
          if (wz > bbox.max[2]) bbox.max[2] = wz;
        });
        if (r.missing) out.fatal = out.fatal || 'primitive with no POSITION accessor';
        if (r.bad) nanPrims++;
        verts += r.count;
        const ia = json.accessors?.[prim.indices];
        tris += (ia ? ia.count : r.count) / 3;
        const mat = json.materials?.[prim.material];
        if (mat?.pbrMetallicRoughness?.baseColorTexture != null && uv == null) texturedNoUv++;
      }
    }
    for (const child of node.children || []) visit(child, world);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  for (const root of scene?.nodes || []) visit(root, identity());

  out.meshes = (json.meshes || []).length;
  out.prims = prims;
  out.tris = Math.round(tris);
  out.verts = verts;
  out.nodes = nodes.length;
  out.skins = (json.skins || []).length;
  out.joints = (json.skins || []).reduce((n, s) => n + (s.joints || []).length, 0);
  out.anims = (json.animations || []).length;
  if (Number.isFinite(bbox.min[0])) {
    // Sorted largest-first: a reader asking "how big is this" wants the two
    // numbers that matter before the third, and every consumer of this report
    // (a normalize height, a collision box) is written against that order.
    out.span = [
      +(bbox.max[0] - bbox.min[0]).toFixed(2),
      +(bbox.max[1] - bbox.min[1]).toFixed(2),
      +(bbox.max[2] - bbox.min[2]).toFixed(2),
    ].sort((a, b) => b - a);
    out.min = bbox.min.map((v) => +v.toFixed(2));
    out.max = bbox.max.map((v) => +v.toFixed(2));
  } else {
    out.fatal = out.fatal || 'geometry has no finite bounds';
  }
  out.nanPrims = nanPrims;
  out.noUv = noUv;
  out.texturedNoUv = texturedNoUv;


  /* --- textures ------------------------------------------------------ */
  // Embedded image bytes are what makes a "22 mesh" file weigh 70 MB, and they
  // are the part that costs VRAM rather than disk, so they are reported apart
  // from geometry instead of folded into a single size.
  const images = (json.images || []).map((img, i) => {
    const bytes = img.bufferView != null ? (json.bufferViews?.[img.bufferView]?.byteLength || 0) : 0;
    return { name: img.name || `image_${i}`, mime: img.mimeType || null, uri: img.uri || null, bytes };
  });
  out.images = images.length;
  out.externalImages = images.filter((i) => i.uri).length;
  out.imageMB = +(images.reduce((n, i) => n + i.bytes, 0) / 1048576).toFixed(2);
  out.textures = (json.textures || []).length;
  out.bigImages = images
    .filter((i) => i.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 3)
    .map((i) => `${i.name} ${(i.bytes / 1048576).toFixed(1)}MB${i.mime ? ` ${i.mime.replace('image/', '')}` : ''}`);

  /* --- materials ----------------------------------------------------- */
  let blackout = 0;
  let metallic = 0;
  let emissive = 0;
  let doubleSided = 0;
  for (const m of json.materials || []) {
    const pbr = m.pbrMetallicRoughness || {};
    const base = pbr.baseColorFactor;
    const dark = !base || (base[0] < 0.02 && base[1] < 0.02 && base[2] < 0.02);
    const lit = pbr.baseColorTexture != null || (m.emissiveFactor || []).some((v) => v > 0.05);
    if (dark && !lit) blackout++;
    if ((pbr.metallicFactor ?? 1) >= 0.99) metallic++;
    if ((m.emissiveFactor || []).some((v) => v > 0.05)) emissive++;
    if (m.doubleSided) doubleSided++;
  }
  out.materials = (json.materials || []).length;
  out.blackout = blackout;
  out.metallic = metallic;
  out.emissive = emissive;
  out.doubleSided = doubleSided;

  // Top-level node names. The unnamed hash file is the reason this exists: a
  // UUID filename tells a placement author nothing, and the roots usually do.
  out.roots = (scene?.nodes || []).map((i) => nodes[i]?.name).filter(Boolean).slice(0, 8);

  /* --- verdict ------------------------------------------------------- */
  const notes = [];
  if (out.fatal) notes.push('UNUSABLE');
  if (out.externalImages) notes.push(`${out.externalImages} external image(s), not self-contained`);
  if (out.nanPrims) notes.push(`${out.nanPrims} primitive(s) contain NaN positions`);
  if (out.texturedNoUv) notes.push(`${out.texturedNoUv} textured primitive(s) with no UV0`);
  if (out.blackout) notes.push(`${out.blackout}/${out.materials} materials render black (makeLit rescues)`);
  if (out.metallic) notes.push(`${out.metallic} metal-only material(s) (makeLit clamps)`);
  if (out.mb > 25) notes.push(`heavy at ${out.mb}MB`);
  if (out.imageMB > 20) notes.push(`${out.imageMB}MB of that is textures`);
  if (out.prims > 400) notes.push(`${out.prims} primitives, draw-call cost`);
  out.notes = notes;
  out.usable = !out.fatal && !out.externalImages;
  return out;
}


const files = roots.flatMap((r) => walk(r));
const rows = files.map(audit);

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log('--- environment GLB audit --------------------------------------------');
  console.log('file'.padEnd(46) + 'MB'.padStart(8) + 'meshes'.padStart(8) + 'tris'.padStart(11) + '  size (m, large first)');
  for (const r of [...rows].sort((a, b) => b.mb - a.mb)) {
    const span = r.span ? r.span.map((v) => v.toFixed(1)).join(' x ') : '-';
    console.log(`${r.file.padEnd(46)}${String(r.mb).padStart(8)}${String(r.meshes ?? 0).padStart(8)}${String(r.tris ?? 0).padStart(11)}  ${span}`);
  }

  console.log('\n--- detail ----------------------------------------------------------');
  for (const r of [...rows].sort((a, b) => a.file.localeCompare(b.file))) {
    console.log(`\n${r.file}  (${r.mb} MB)`);
    if (r.fatal) {
      console.log(`  FATAL      ${r.fatal}`);
      continue;
    }
    console.log(`  geometry   ${r.meshes} meshes / ${r.prims} prims / ${r.tris.toLocaleString()} tris / ${r.verts.toLocaleString()} verts`);
    console.log(`  size       ${r.span.join(' x ')} m   (y ${r.min[1]} .. ${r.max[1]})`);
    console.log(`  textures   ${r.images} images (${r.imageMB} MB embedded, ${r.externalImages} external), ${r.textures} textures`);
    if (r.bigImages.length) console.log(`  largest    ${r.bigImages.join(' | ')}`);
    console.log(`  materials  ${r.materials} (${r.blackout} black, ${r.metallic} metallic, ${r.emissive} emissive, ${r.doubleSided} double-sided)`);
    if (r.skins || r.anims) console.log(`  rig        ${r.skins} skin(s), ${r.joints} joints, ${r.anims} animation(s)`);
    if (r.roots.length) console.log(`  roots      ${r.roots.join(', ')}`);
    console.log(`  verdict    ${r.usable ? 'usable' : 'DO NOT SHIP'}${r.notes.length ? ` -- ${r.notes.join('; ')}` : ''}`);
  }

  const usable = rows.filter((r) => r.usable);
  console.log('\n--- summary ---------------------------------------------------------');
  console.log(`${rows.length} files, ${rows.reduce((n, r) => n + r.mb, 0).toFixed(1)} MB on disk, ${usable.length} usable`);
  console.log(`geometry    ${rows.reduce((n, r) => n + (r.tris || 0), 0).toLocaleString()} tris`);
  console.log(`textures    ${rows.reduce((n, r) => n + (r.imageMB || 0), 0).toFixed(1)} MB embedded`);
  const noted = rows.filter((r) => r.notes.length);
  if (noted.length) {
    console.log('\nnotes:');
    for (const r of noted) console.log(`  ${r.name}: ${r.notes.join('; ')}`);
  }
}

/**
 * Ingest. Copies to public/assets/env/<slug>.glb, which is the directory the
 * catalogue in src/data/assets.js refers to, and prints each slug so the
 * ENVIRONMENT_GLB entry can be written from the same run rather than by
 * re-reading filenames by hand -- the names contain spaces, commas, mixed case
 * and one bare UUID, and a hand-typed path that only differs by a space is a
 * 404 nobody notices until the piece is missing from the skyline.
 */
if (doCopy) {
  const DEST = path.resolve(ROOT, 'public/assets/env');
  fs.mkdirSync(DEST, { recursive: true });
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const slug = (n) => {
    const stem = n.replace(/\.glb$/i, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
    return uuid.test(n.replace(/\.glb$/i, '')) ? `unnamed_${stem.slice(0, 8)}` : stem;
  };
  console.log('\n--- ingest -> public/assets/env -------------------------------------');
  let copied = 0;
  let bytes = 0;
  const held = [];
  for (const r of rows) {
    if (!r.usable) {
      console.log(`  skip   ${r.name} (${r.fatal || 'unusable'})`);
      continue;
    }
    if (r.mb > MAX_MB) {
      held.push(r);
      continue;
    }
    const to = `${slug(r.name)}.glb`;
    fs.copyFileSync(path.resolve(ROOT, r.file), path.join(DEST, to));
    bytes += r.mb;
    copied++;
    console.log(`  copy   ${r.name} -> env/${to}  (${r.mb} MB, ${r.span ? r.span.map((v) => v.toFixed(0)).join('x') : '?'} m)`);
  }
  console.log(`${copied} file(s), ${bytes.toFixed(1)} MB into public/assets/env/`);
  if (held.length) {
    console.log(`\nheld back (over --max=${MAX_MB}MB, needs re-export before it can ship):`);
    for (const r of held.sort((a, b) => b.mb - a.mb)) {
      console.log(`  ${r.name.padEnd(46)} ${String(r.mb).padStart(7)} MB  ${r.imageMB} MB textures, ${r.tris.toLocaleString()} tris, ${r.span ? r.span.map((v) => v.toFixed(0)).join('x') : '?'} m`);
    }
    console.log(`  ${held.length} file(s), ${held.reduce((n, r) => n + r.mb, 0).toFixed(1)} MB -- re-run with --max to include any of these deliberately`);
  }
}

