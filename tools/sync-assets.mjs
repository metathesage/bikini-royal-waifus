/**
 * Copy the game-relevant assets out of the shared `GAME D3V` library and into
 * this project's `public/`, writing a generated manifest the game imports.
 *
 * The library holds far more than the game needs (2.6 GB of glTF, 226 FBX), so
 * this is an explicit allow-list: everything it copies is something the game
 * actually loads, and the manifest is the single source of truth for the
 * roster/pool sizes the code cares about.
 *
 *   node tools/sync-assets.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PUB = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const DRY = process.argv.includes('--dry');

/** Url-safe, unique asset id derived from a source file name. */
function idFrom(name) {
  return name
    .replace(/\.(glb|gltf|fbx|png)$/i, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

const copied = [];
function copy(from, toRel) {
  if (!fs.existsSync(from)) {
    console.warn(`  skip (missing) ${path.relative(LIB, from)}`);
    return null;
  }
  if (!DRY) {
    fs.mkdirSync(path.dirname(path.join(PUB, toRel)), { recursive: true });
    fs.copyFileSync(from, path.join(PUB, toRel));
  }
  copied.push({ kb: Math.round(fs.statSync(from).size / 1024) });
  return toRel.split(path.sep).join('/');
}

const manifest = {};

/* 1. PSX rigged female roster: skinned Mixamo-rig characters, ~250 KB each,
      already human-scaled, each with a matching albedo texture. */
{
  const base = path.join(LIB, 'Characters_psx_1.1', 'Characters_psx_01');
  const modelDir = path.join(base, 'Models', 'Rig', 'Female');
  const texDir = path.join(base, 'Textures');
  const roster = [];
  const files = fs.existsSync(modelDir) ? fs.readdirSync(modelDir).filter((f) => /\.fbx$/i.test(f)) : [];
  for (const f of files) {
    const stem = f.replace(/\.fbx$/i, '');
    const tex = path.join(texDir, `${stem}.png`);
    if (!fs.existsSync(tex)) {
      console.warn(`  skip ${stem}: no matching texture`);
      continue;
    }
    const id = idFrom(stem);
    const url = copy(path.join(modelDir, f), path.join('assets', 'characters', 'psx', f));
    const texUrl = copy(tex, path.join('assets', 'characters', 'psx', `${id}.png`));
    roster.push({ id, name: stem.replace(/_/g, ' '), url, tex: texUrl });
  }
  manifest.psxFemale = roster;
  console.log(`psx female roster: ${roster.length}`);
}

/* 2. Item props: a real supply chest, ammo crate, grenade, shields, medkit and
      the buff crystals — all with named sub-meshes we can animate. */
{
  const dir = path.join(LIB, 'Items');
  const items = {};
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((f) => /\.glb$/i.test(f))) {
      const url = copy(path.join(dir, f), path.join('assets', 'items', f));
      if (url) items[idFrom(f)] = url;
    }
  }
  manifest.items = items;
  console.log(`items: ${Object.keys(items).length}`);
}

/* 3. Extra rigged heroes, some carrying real animation clips. */
{
  const picks = [
    { file: 'Kasumi_Tactical_Sailor.glb', id: 'kasumi_sailor', name: 'Kasumi Sailor' },
    { file: 'Kasumi_Tactical_Sailor_AAA_100k.glb', id: 'kasumi_sailor_hd', name: 'Kasumi HD' },
    { file: 'SciFi_Waifu_Soldier.glb', id: 'scifi_soldier', name: 'Scifi Soldier' },
    { file: 'mai_maid_-bourin.glb', id: 'mai_maid', name: 'Mai Maid' },
  ];
  const heroes = {};
  for (const p of picks) {
    const url = copy(path.join(LIB, 'Characters', p.file), path.join('assets', 'characters', p.file));
    if (url) heroes[p.id] = { id: p.id, name: p.name, url };
  }
  manifest.heroes = heroes;
  console.log(`extra heroes: ${Object.keys(heroes).length}`);
}

if (!DRY) {
  fs.writeFileSync(path.join(PUB, 'assets', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

const totalMb = (copied.reduce((n, c) => n + c.kb, 0) / 1024).toFixed(1);
console.log(`\n${copied.length} files, ${totalMb} MB${DRY ? ' (dry run)' : ''}`);
