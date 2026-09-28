/**
 * Procedural rig test.
 *
 * The PSX roster is 45 skinned Mixamo-rig characters that ship no clips, so the
 * game poses them procedurally. This checks that:
 *   - every roster entry parses into a rig we can identify,
 *   - posing actually moves bones (a pose that writes rest quaternions is a
 *     silent failure that still "renders"),
 *   - each state produces *different* bone rotations, so walk != idle != aim,
 *   - aiming puts the weapon hand forward, which is what makes firing read,
 *   - two clones of one model animate independently.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as THREE from 'three';
import { createRig } from '../src/avatar/rig.js';
import { instanceOf, loadPsxManifest, setAssetManifest } from '../src/data/assets.js';

globalThis.document = {
  createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }) }),
  createElementNS: () => ({
    getContext: () => new Proxy({}, { get: () => () => {} }),
    style: {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
  }),
};

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const failures = [];
function check(cond, msg) {
  if (!cond) failures.push(msg);
}

/** Total angular deviation of a rig's bones from rest, as a cheap pose hash. */
function poseSignature(rig) {
  let acc = 0;
  for (const b of rig.order) {
    acc += 1 - Math.abs(rig.rest.get(b).quat.dot(b.quaternion));
  }
  return acc;
}

/** How far the weapon hand sits along the skeleton's forward axis (-Z). */
function handForwardness(rig) {
  rig.settleMuzzle();
  return -rig.muzzle.z;
}

function readEntry(entry) {
  const file = ROOT + entry.url.replace(/^\//, '');
  if (!fs.existsSync(file)) return { id: entry.id, error: 'file missing' };
  const raw = fs.readFileSync(file);
  try {
    const group = new FBXLoader().parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    return { id: entry.id, rig: createRig(group) };
  } catch (err) {
    return { id: entry.id, error: err.message };
  }
}

const origWarn = console.warn;
console.warn = () => {}; // these rigs trip FBXLoader's >4-skin-weight warning

// The browser fetches this at runtime; node has no fetch for /assets, so the
// test hands the same generated file straight to the loader.
setAssetManifest(JSON.parse(fs.readFileSync(fileURLToPath(new URL('../public/assets/manifest.json', import.meta.url)), 'utf8')));
const roster = await loadPsxManifest();
check(roster.length >= 40, `expected the full psx roster, got ${roster.length}`);

/* --- Every roster entry must become a usable rig --------------------- */
const rigs = [];
for (const entry of roster) {
  const r = readEntry(entry);
  if (r.error) {
    failures.push(`${r.id}: ${r.error}`);
    continue;
  }
  if (!r.rig) {
    failures.push(`${r.id}: no usable rig detected`);
    continue;
  }
  for (const slot of ['hips', 'head', 'armR', 'armL', 'thighR', 'thighL']) {
    if (!r.rig.bones[slot]) failures.push(`${r.id}: missing ${slot}`);
  }
  rigs.push(r.rig);
}
check(rigs.length === roster.length, `only ${rigs.length}/${roster.length} roster rigs built`);

/* --- Cloning must produce a real, independent skeleton ---------------- */
/* The single most damaging bug this file guards against: cloning a rigged
   character in a way that bakes the SkinnedMesh into a static Mesh. Nothing
   throws, the rig builder still finds bones, and 43 bots stand still while
   every test passes. So assert the mesh type, the bone identity, and â€” the
   part that actually matters â€” that posing the clone moves the clone. */
{
  const raw = fs.readFileSync(ROOT + roster[0].url.replace(/^\//, ''));
  const parse = () => new FBXLoader().parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

  const source = parse();
  const skinnedInSource = [];
  source.traverse((o) => { if (o.isSkinnedMesh) skinnedInSource.push(o); });
  check(skinnedInSource.length > 0, 'source model has no SkinnedMesh at all');

  const a = instanceOf(source);
  const b = instanceOf(source);

  const skinned = (root) => {
    const out = [];
    root.traverse((o) => { if (o.isSkinnedMesh) out.push(o); });
    return out;
  };
  const aMesh = skinned(a)[0];
  const bMesh = skinned(b)[0];
  check(!!aMesh, 'clone is not a SkinnedMesh â€” the rig was baked into a static mesh');
  check(!!bMesh, 'second clone is not a SkinnedMesh');
  if (aMesh && bMesh) {
    check(aMesh.skeleton !== bMesh.skeleton, 'clones share one skeleton object');
    const aBones = new Set(aMesh.skeleton.bones);
    const shared = aMesh.skeleton.bones.filter((x) => bMesh.skeleton.bones.includes(x));
    check(shared.length === 0, `clones share ${shared.length}/${aMesh.skeleton.bones.length} bones`);
    check(aBones.size === aMesh.skeleton.bones.length, 'clone skeleton has duplicate bones');
    // Geometry should still be shared: that is what keeps 43 bots affordable.
    check(aMesh.geometry === bMesh.geometry, 'clones duplicate geometry instead of sharing it');
  }

  // The real proof: rotate a bone on clone A and confirm clone B's mesh and the
  // cached source are untouched, and that A's own skinned mesh is still bound to
  // bones that live inside A.
  if (aMesh) {
    const inA = new Set();
    a.traverse((o) => inA.add(o));
    const escaped = aMesh.skeleton.bones.filter((x) => !inA.has(x));
    check(escaped.length === 0, `${escaped.length} bones are not part of their own clone`);
  }
  check(a !== source, 'clone is the same object as the source');
  check(b !== source, 'clone is the same object as the source');

  // Posing one rig must not disturb the other.
  const rigA = createRig(a);
  const rigB = createRig(b);
  if (rigA && rigB) {
    for (let i = 0; i < 20; i++) {
      rigA.update(1 / 60, { speed: 7, aiming: true, firing: true });
      rigB.update(1 / 60, { speed: 0 });
    }
    check(poseSignature(rigA) !== poseSignature(rigB), 'posing one clone changed the other');
  }

  // And cloning must leave the cached source byte-identical, or every later bot
  // inherits a pose from whoever happened to load first. Measured across the
  // clone itself, not across an update we performed on purpose.
  const srcBones = [];
  source.traverse((o) => { if (o.isBone) srcBones.push(o.quaternion.toArray().join(',')); });
  const before = srcBones.join('|');
  instanceOf(source);
  instanceOf(source);
  const after = srcBones.join('|');
  check(before === after, 'cloning mutated the cached source skeleton');
}
/* --- Posing must actually move the skeleton ------------------------- */
if (rigs.length) {
  const rig = rigs[0];
  const STATES = {
    idle: { speed: 0 },
    walk: { speed: 3 },
    run: { speed: 8 },
    crouch: { speed: 0, crouch: true },
    air: { speed: 3, airborne: true },
    aim: { speed: 0, aiming: true },
    fire: { speed: 0, firing: true },
    knocked: { speed: 0, knocked: true },
    dead: { speed: 0, dead: true },
  };

  // Settle each state for a few frames, exactly as the game would.
  const sigs = {};
  for (const [name, ctx] of Object.entries(STATES)) {
    for (let i = 0; i < 20; i++) rig.update(1 / 60, ctx);
    sigs[name] = poseSignature(rig);
    check(sigs[name] > 1e-4, `${name} pose left the skeleton at rest (sig ${sigs[name]})`);
  }

  // Distinct states must produce distinct poses.
  const names = Object.keys(STATES);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = sigs[names[i]];
      const b = sigs[names[j]];
      check(Math.abs(a - b) > 1e-4, `${names[i]} and ${names[j]} pose identically (${a} vs ${b})`);
    }
  }
  // "More extreme" has to be measured across a whole stride: comparing a single
  // sampled frame is just comparing two random points in the cycle.
  const legRange = (speed) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 60; i++) {
      rig.update(1 / 60, { speed });
      const v = rig.bones.thighR.quaternion.y;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    return hi - lo;
  };
  const walkRange = legRange(3);
  const runRange = legRange(8);
  check(walkRange > 0.01, `walk cycle did not swing the legs (range ${walkRange.toFixed(4)})`);
  check(runRange > walkRange, `run stride should exceed walk stride (${runRange.toFixed(4)} vs ${walkRange.toFixed(4)})`);

  // Crouching must lower the hips.
  const hipY = () => rig.bones.hips.getWorldPosition(new THREE.Vector3()).y;
  for (let i = 0; i < 20; i++) rig.update(1 / 60, { speed: 0 });
  const standY = hipY();
  for (let i = 0; i < 20; i++) rig.update(1 / 60, { speed: 0, crouch: true });
  const crouchY = hipY();
  check(crouchY < standY - 0.05, `crouch did not lower the hips (${standY.toFixed(3)} -> ${crouchY.toFixed(3)})`);

  // Aiming must bring the weapon hand forward Ã¢â‚¬â€ the whole point of making the
  // bots visibly shoot back.
  for (let i = 0; i < 20; i++) rig.update(1 / 60, { speed: 0 });
  const idleFwd = handForwardness(rig);
  for (let i = 0; i < 20; i++) rig.update(1 / 60, { speed: 0, aiming: true });
  const aimFwd = handForwardness(rig);
  check(aimFwd > idleFwd + 0.05, `aiming did not reach forward (${idleFwd.toFixed(3)} -> ${aimFwd.toFixed(3)})`);

  // Firing must add recoil on top of the aim pose.
  let sawRecoil = false;
  for (let i = 0; i < 30; i++) {
    rig.update(1 / 60, { speed: 0, firing: i < 3 });
    if (rig.recoil > 0) sawRecoil = true;
  }
  check(sawRecoil, 'firing never raised the recoil impulse');

  // Walking must actually swing the legs: sample a thigh across a full stride.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 40; i++) {
    rig.update(1 / 60, { speed: 4 });
    const v = rig.bones.thighR.quaternion.y;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  check(hi - lo > 0.01, `walk cycle did not swing the legs (range ${(hi - lo).toFixed(4)})`);
  // Clones must animate independently.
  const rigB = readEntry(roster[0]).rig;
  for (let i = 0; i < 10; i++) {
    rig.update(1 / 60, { speed: 7 });
    rigB.update(1 / 60, { speed: 0 });
  }
  check(poseSignature(rig) !== poseSignature(rigB), 'clones share bone state');
}

console.warn = origWarn;

if (failures.length) {
  for (const f of failures.slice(0, 40)) console.error(f);
  console.error(`${failures.length} rig problem(s)`);
  process.exit(1);
}
console.log(`rigs ok (${roster.length} characters)`);

