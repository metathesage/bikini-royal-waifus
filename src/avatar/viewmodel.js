import * as THREE from 'three';
import { GUNS, MELEE } from '../game/weapons.js';
import { wrapStats } from '../data/catalog.js';
import { WEAPON_GLB, MELEE_GLB, loadGltf, instanceOf } from '../data/assets.js';

const weaponCache = new Map();

function loadWeaponGlb(url) {
  if (!weaponCache.has(url)) {
    weaponCache.set(url, loadGltf(url).then((g) => g.scene).catch((e) => {
      console.error('weapon glb load failed', url, e);
      return null;
    }));
  }
  return weaponCache.get(url);
}

const GEO = new Map();
function geo(name, build) {
  let g = GEO.get(name);
  if (!g) { g = build(); GEO.set(name, g); }
  return g;
}

let GRAD = null;
function gradient() {
  if (GRAD) return GRAD;
  const data = new Uint8Array([40, 32, 58, 255, 120, 100, 150, 255, 210, 200, 230, 255, 255, 255, 255, 255]);
  GRAD = new THREE.DataTexture(data, 4, 1);
  GRAD.magFilter = THREE.NearestFilter;
  GRAD.minFilter = THREE.NearestFilter;
  GRAD.colorSpace = THREE.SRGBColorSpace;
  GRAD.needsUpdate = true;
  return GRAD;
}

function mat(color, emissive = null, intensity = 0) {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: gradient(),
    emissive: emissive || 0x000000,
    emissiveIntensity: intensity,
  });
}

function part(g, m, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

const box = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const cyl = () => geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 8));
const sph = () => geo('sph', () => new THREE.SphereGeometry(1, 10, 8));
const cone = () => geo('cone', () => new THREE.ConeGeometry(1, 1, 8));
const octa = () => geo('octa', () => new THREE.OctahedronGeometry(1, 0));
const torus = () => geo('torus', () => new THREE.TorusGeometry(0.08, 0.02, 6, 10));

/**
 * Build a weapon.
 *
 * The GLB replaces the procedural silhouette for *guns* only, and that is the
 * whole point of the split. Every gun used to build its chunky primitive barrel
 * AND then add the shipped model on top of it, so all five rendered as two
 * overlapping guns — a pink-and-cyan smear rather than a rifle, which on the
 * range (where the weapon in your hand is the thing you are looking at) was the
 * single most broken thing on screen.
 *
 * Melee is deliberately the other way round. Those silhouettes are hand-authored
 * and carry animation assemblies the models do not have — the tide spear's head
 * scissor and its hydro sidearm are groups with named parts, and the sunlance
 * test asserts a minimum part count. So melee keeps its authored build and the
 * shipped mesh is added alongside it, exactly as before.
 */
export function createWeaponMesh(id, wrapId, charmId) {
  const wrap = wrapStats(wrapId || 'sakura');
  const primary = mat(wrap.color);
  const accent = mat(wrap.accent, wrap.accent, 0.35);
  const dark = mat('#1a1024');
  const metal = mat('#2b2b38');
  const g = new THREE.Group();
  const add = (...args) => { const m = part(...args); g.add(m); return m; };

  // Guns and melee live in separate tables, so a melee id can never resolve to
  // a firearm and a gun id can never resolve to a blade.
  const glbUrl = WEAPON_GLB[id] || MELEE_GLB[id];
  /** True when the shipped model *is* the weapon, rather than dressing one. */
  const glbIsTheWeapon = !!WEAPON_GLB[id];

  if (glbIsTheWeapon) {
    // Real shipped model only — no procedural shapes underneath it. `pending`
    // lets the caller mount the weapon immediately so there is never a frame
    // with an empty hand while the fetch is still in flight.
    g.userData.pending = true;
    loadWeaponGlb(glbUrl).then((scene) => {
      if (!scene) { g.userData.pending = false; return; }
      const inst = instanceOf(scene);
      inst.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      const size = new THREE.Box3().setFromObject(inst).getSize(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z);
      // 0.62m is a real rifle's length. The old 0.5 made every gun read as a
      // toy held too close, and the viewmodel pass compensates for the rest.
      const s = longest > 0.001 ? 0.62 / longest : 1;
      inst.scale.setScalar(s);
      // The pack is authored barrel-along-X for some pieces and -Z for others.
      // Rotate only when the long axis is X, so a model already pointing down
      // -Z (the viewmodel's forward axis) is left alone.
      if (size.x >= size.y && size.x >= size.z) inst.rotation.y = Math.PI / 2;
      // Centre it on the bounding box rather than on its lower corner, so
      // swapping weapons does not make the muzzle jump around the screen.
      const box = new THREE.Box3().setFromObject(inst);
      inst.position.sub(box.getCenter(new THREE.Vector3()));
      inst.position.z -= 0.02;
      g.add(inst);
      g.userData.pending = false;
    });
  } else if (id === 'ar') {
    add(box(), primary, 0, 0, -0.05, 0.07, 0.09, 0.42);
    add(cyl(), metal, 0, 0.01, -0.38, 0.015, 0.32, 0.015, Math.PI / 2);
    add(box(), dark, 0, -0.08, 0.02, 0.04, 0.12, 0.06);
    add(box(), dark, 0, 0.02, 0.22, 0.05, 0.06, 0.16);
    add(box(), accent, 0, 0.06, -0.02, 0.03, 0.03, 0.16);
  } else if (id === 'smg') {
    add(box(), primary, 0, 0, -0.02, 0.07, 0.1, 0.28);
    add(cyl(), metal, 0, 0.01, -0.24, 0.016, 0.18, 0.016, Math.PI / 2);
    add(box(), dark, 0, -0.08, 0.02, 0.035, 0.12, 0.05);
    add(cone(), accent, -0.045, 0.07, -0.02, 0.03, 0.06, 0.03);
    add(cone(), accent, 0.045, 0.07, -0.02, 0.03, 0.06, 0.03);
  } else if (id === 'shot') {
    add(box(), primary, 0, 0, -0.02, 0.08, 0.09, 0.4);
    add(cyl(), metal, 0, 0.015, -0.32, 0.028, 0.28, 0.028, Math.PI / 2);
    add(cyl(), dark, 0, 0.015, -0.18, 0.02, 0.2, 0.02, Math.PI / 2);
    add(torus(), accent, 0.06, 0.02, 0.02, 0.7, 0.7, 0.7, 0, 0.4, 0.8);
    add(box(), dark, 0, -0.02, 0.2, 0.05, 0.05, 0.18);
  } else if (id === 'snip') {
    add(box(), primary, 0, 0, 0, 0.06, 0.07, 0.55);
    add(cyl(), metal, 0, 0.01, -0.48, 0.012, 0.42, 0.012, Math.PI / 2);
    add(cyl(), dark, 0, -0.06, -0.06, 0.014, 0.16, 0.014, Math.PI / 2);
    add(cyl(), accent, 0, 0.07, -0.1, 0.022, 0.1, 0.022, Math.PI / 2);
  } else if (id === 'pistol') {
    add(box(), primary, 0, 0, -0.02, 0.06, 0.09, 0.18);
    add(cyl(), metal, 0, 0.015, -0.16, 0.014, 0.12, 0.014, Math.PI / 2);
    add(box(), dark, 0, -0.08, 0.02, 0.04, 0.1, 0.05);
    add(sph(), accent, 0, 0.02, -0.02, 0.02, 0.02, 0.015);
  } else if (id === 'katana') {
    add(box(), mat('#f4f7ff'), 0, 0.02, -0.42, 0.014, 0.05, 0.78);
    add(box(), accent, 0, 0.02, -0.42, 0.006, 0.02, 0.78);
    add(box(), dark, 0, -0.02, 0.02, 0.04, 0.04, 0.16);
    add(torus(), primary, 0, 0.02, -0.08, 0.55, 0.55, 0.55, Math.PI / 2);
    g.rotation.x = 0.15;
  } else if (id === 'blade') {
    const glow = mat('#9af6ff', '#7af6ff', 0.8);
    add(box(), glow, 0, 0.02, -0.38, 0.012, 0.045, 0.7);
    add(box(), dark, 0, -0.02, 0.02, 0.035, 0.04, 0.14);
    add(sph(), glow, 0, 0.02, -0.74, 0.02, 0.02, 0.02);
  } else if (id === 'greatsword') {
    add(octa(), accent, 0, 0.04, -0.42, 0.12, 0.16, 0.42);
    add(box(), primary, 0, 0.04, -0.42, 0.04, 0.02, 0.5);
    add(box(), dark, 0, -0.06, 0.05, 0.05, 0.05, 0.2);
    add(torus(), primary, 0, 0.02, -0.05, 0.8, 0.8, 0.8, Math.PI / 2);
  } else if (id === 'spear') {
    // Candidate A's regalia. Navy shaft with a pearl inlay and gold collars,
    // finished with a wave-crest head that carries the hydro sidearm inside it.
    const gel = mat('#4fe3d0', '#4fe3d0', 0.75);
    const gold = mat('#d8b063', '#d8b063', 0.25);
    add(box(), primary, 0, 0, -0.3, 0.032, 0.032, 1.5);
    add(box(), mat('#f2ece4'), 0, 0, -0.3, 0.014, 0.014, 1.5);
    add(cyl(), gold, 0, 0, 0.42, 0.028, 0.06, 0.028, Math.PI / 2);
    add(cyl(), gold, 0, 0, -0.05, 0.03, 0.05, 0.03, Math.PI / 2);
    add(cone(), gold, 0, 0, 0.48, 0.028, 0.08, 0.028, Math.PI / 2);
    const head = new THREE.Group();
    head.position.set(0, 0.02, -1.02);
    g.add(head);
    head.add(part(cone(), gel, 0, 0, -0.16, 0.03, 0.36, 0.03, -Math.PI / 2));
    head.add(part(cone(), gold, -0.06, 0.01, -0.12, 0.018, 0.24, 0.018, -Math.PI / 2, 0, 0.7));
    head.add(part(cone(), gold, 0.06, 0.01, -0.12, 0.018, 0.24, 0.018, -Math.PI / 2, 0, -0.7));
    head.add(part(octa(), gold, 0, 0, -0.02, 0.05, 0.08, 0.05));
    const sidearm = new THREE.Group();
    sidearm.visible = false;
    sidearm.add(part(box(), dark, 0, 0, -0.06, 0.045, 0.075, 0.2));
    sidearm.add(part(cyl(), metal, 0, 0.014, -0.22, 0.013, 0.14, 0.013, Math.PI / 2));
    sidearm.add(part(box(), gel, 0, 0.03, -0.02, 0.02, 0.02, 0.1));
    sidearm.add(part(box(), dark, 0, -0.07, 0.02, 0.035, 0.09, 0.05));
    head.add(sidearm);
    // Everything the split animation moves, handed to `update` through the
    // group's userData so no module-level state is needed to run it.
    g.userData.split = {
      head,
      sidearm,
      home: head.position.clone(),
      tines: [head.children[0], head.children[1], head.children[2]],
    };
    g.rotation.x = 0.08;
  } else if (id === 'sunlance') {
    // Candidate B's lance. A long burnished shaft with a sun-disc head, kept
    // lit by an emissive core so the silhouette reads even against the sky.
    const gold = mat('#e0a94a', '#e0a94a', 0.3);
    const fire = mat('#ffb347', '#ff7a2b', 0.9);
    add(box(), primary, 0, 0, -0.34, 0.03, 0.03, 1.34);
    add(box(), mat('#fff2dc'), 0, 0, -0.34, 0.012, 0.012, 1.34);
    add(cyl(), gold, 0, 0, 0.3, 0.03, 0.07, 0.03, Math.PI / 2);
    add(cyl(), gold, 0, 0, 0.06, 0.034, 0.05, 0.034, Math.PI / 2);
    add(box(), gold, 0, 0, -0.06, 0.11, 0.022, 0.05);
    add(octa(), fire, 0, 0, -1.06, 0.07, 0.13, 0.07, 0, 0, Math.PI / 4);
    add(cone(), fire, 0, 0, -1.24, 0.05, 0.16, 0.05, -Math.PI / 2);
    add(cone(), gold, -0.05, 0.01, -1.0, 0.014, 0.1, 0.014, -Math.PI / 2, 0, 0.8);
    add(cone(), gold, 0.05, 0.01, -1.0, 0.014, 0.1, 0.014, -Math.PI / 2, 0, -0.8);
    g.rotation.x = 0.1;
  } else if (id === 'flail') {
    // Candidate C's flail. A short grip and a chain of links, so the head
    // visibly hangs off the end of the weapon rather than being part of it.
    const spark = mat('#a06bff', '#a06bff', 0.8);
    add(cyl(), dark, 0, -0.02, 0.06, 0.028, 0.2, 0.028, Math.PI / 2);
    add(cyl(), metal, 0, -0.02, -0.06, 0.034, 0.04, 0.034, Math.PI / 2);
    for (let c = 0; c < 5; c++) {
      const link = part(torus(), metal, 0, -0.02 - c * 0.008, -0.16 - c * 0.11, 1, 1, 1, c % 2 ? 0 : Math.PI / 2);
      g.add(link);
    }
    add(octa(), spark, 0, -0.06, -0.76, 0.075, 0.075, 0.075);
    add(octa(), metal, 0, -0.06, -0.76, 0.05, 0.11, 0.05, 0, 0, Math.PI / 4);
    add(cone(), spark, 0, -0.14, -0.76, 0.03, 0.08, 0.03, Math.PI);
    g.rotation.x = 0.2;
  } else if (id === 'trident') {
    // Candidate D's trident. Three prongs off a crossbar, with a rime drop
    // hung in the middle of them.
    const ice = mat('#9fe8ff', '#9fe8ff', 0.6);
    add(box(), primary, 0, 0, -0.32, 0.032, 0.032, 1.4);
    add(cyl(), metal, 0, 0, 0.34, 0.03, 0.06, 0.03, Math.PI / 2);
    add(box(), mat('#c3d4e6'), 0, 0, -0.06, 0.13, 0.02, 0.04);
    add(cone(), ice, -0.06, 0, -1.06, 0.026, 0.26, 0.026, -Math.PI / 2, 0, -0.16);
    add(cone(), ice, 0.06, 0, -1.06, 0.026, 0.26, 0.026, -Math.PI / 2, 0, 0.16);
    add(cone(), ice, 0, 0, -1.12, 0.03, 0.36, 0.03, -Math.PI / 2);
    add(octa(), mat('#eaf7ff', '#9fe8ff', 0.5), 0, 0, -0.9, 0.045, 0.07, 0.045);
    add(torus(), mat('#c3d4e6'), 0, 0, 0.12, 0.5, 0.5, 0.5, Math.PI / 2);
    g.rotation.x = 0.08;
  } else if (id === 'warfan') {
    // Candidate E's war-fan, carried folded: a pivot with a wedge of blades
    // fanned out from it, which is the shape the whole weapon swings on.
    const petal = mat('#ff5ea8', '#ff5ea8', 0.45);
    add(cyl(), primary, 0, -0.03, 0.1, 0.022, 0.16, 0.022, Math.PI / 2);
    add(octa(), mat('#3dffa6', '#3dffa6', 0.5), 0, -0.03, 0.0, 0.035, 0.035, 0.035);
    for (let f = 0; f < 6; f++) {
      const a = -0.55 + f * 0.22;
      add(box(), f % 2 ? petal : accent, Math.sin(a) * 0.28, -0.03 + Math.cos(a) * 0.28, -0.24,
        0.05, 0.008, 0.5, 0, 0, -a);
    }
    add(box(), mat('#f6e3b8'), 0, -0.03, -0.46, 0.09, 0.012, 0.05);
    g.rotation.x = 0.12;
  } else if (id === 'voidglaive') {
    // Candidate F's glaive. A long shaft with one deep curved blade, and an
    // amethyst set into the haft so the light it drinks has somewhere to go.
    const violet = mat('#b388ff', '#6f4fd8', 0.7);
    add(box(), primary, 0, 0, -0.2, 0.03, 0.03, 1.1);
    add(cyl(), dark, 0, 0, 0.38, 0.032, 0.22, 0.032, Math.PI / 2);
    add(box(), mat('#e8e2f2'), 0.06, 0, -0.46, 0.02, 0.05, 0.9, 0, 0.34, 0);
    add(box(), violet, 0.09, 0, -0.48, 0.014, 0.03, 0.84, 0, 0.34, 0);
    add(cone(), mat('#e8e2f2'), 0.13, 0, -0.9, 0.03, 0.2, 0.02, -Math.PI / 2, 0, 0.34);
    add(octa(), violet, 0, 0, -0.1, 0.05, 0.08, 0.05);
    add(torus(), primary, 0, 0, 0.16, 0.6, 0.6, 0.6, Math.PI / 2);
    g.rotation.x = 0.1;
  } else {
    add(box(), primary, 0, 0, -0.1, 0.06, 0.06, 0.2);
  }

  // Melee that ships a real model still gets it layered on the authored
  // silhouette, because those silhouettes carry animation assemblies (the
  // spear's splitting head) that a static mesh cannot provide. Guns took the
  // other branch above and never reach here.
  if (glbUrl && !glbIsTheWeapon) {
    loadWeaponGlb(glbUrl).then((scene) => {
      if (!scene || !g.parent) return;
      const inst = instanceOf(scene);
      inst.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      const size = new THREE.Box3().setFromObject(inst).getSize(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z);
      inst.scale.setScalar(longest > 0.001 ? 0.62 / longest : 1);
      if (size.x >= size.y && size.x >= size.z) inst.rotation.y = Math.PI / 2;
      g.add(inst);
    });
  }

  const charm = new THREE.Group();
  charm.position.set(0.04, -0.08, 0.04);
  g.add(charm);
  const cmat = mat('#ff4f9a', '#ff4f9a', 0.4);
  if (charmId === 'star') charm.add(part(octa(), cmat, 0, -0.06, 0, 0.03, 0.03, 0.03));
  else if (charmId === 'cat') {
    charm.add(part(sph(), cmat, 0, -0.06, 0, 0.03, 0.028, 0.03));
    charm.add(part(cone(), dark, -0.02, -0.02, 0, 0.012, 0.03, 0.012));
    charm.add(part(cone(), dark, 0.02, -0.02, 0, 0.012, 0.03, 0.012));
  } else if (charmId === 'moon') charm.add(part(torus(), cmat, 0, -0.06, 0, 0.35, 0.35, 0.35));
  else if (charmId === 'crystal') charm.add(part(octa(), mat('#7dfff0', '#7dfff0', 0.7), 0, -0.07, 0, 0.035, 0.05, 0.035));
  else if (charmId === 'bow') charm.add(part(torus(), accent, 0, -0.05, 0, 0.45, 0.45, 0.45, 0.4, 0, 0.8));
  else charm.add(part(sph(), cmat, 0, -0.06, 0, 0.028, 0.026, 0.02));
  const link = part(box(), dark, 0, -0.02, 0, 0.006, 0.05, 0.006);
  charm.add(link);
  g.userData.charm = charm;
  g.userData.id = id;
  return g;
}

/**
 * The first-person body and the hand the weapon is mounted to.
 *
 * Scale note, because this is the single most-revised number in the file: every
 * offset below is in metres at *arm's length from the eye*, and a first-person
 * body is a genuinely tiny object in that space. The original chest was a
 * 0.44m-wide sphere 0.69m from the lens under a 78-degree FOV, which projected
 * to 416px of a 720px viewport — it filled the lower-right quadrant and read as
 * a pink smear rather than a person. Everything is scaled down and pushed out
 * to the right so the weapon, not the chest, is the subject.
 */
export function createViewmodel() {
  const root = new THREE.Group();
  const sway = new THREE.Group();
  root.add(sway);
  const skin = mat('#ffd0c2');
  const cloth = mat('#ff3d8a', '#ff4f9a', 0.15);
  const trim = mat('#7af6ff', '#7af6ff', 0.4);

  // Torso. Pushed well down and back so only the very top of the chest and the
  // collarbone clear the bottom of the frame. A first-person torso is not a
  // thing you look at — it is a thing that establishes scale at the edge of
  // vision — and every attempt to give it real estate turned the lower half of
  // the screen into a wall of skin.
  const chest = part(sph(), skin, 0.02, -0.52, 0.06, 0.15, 0.1, 0.1);
  sway.add(chest);
  const breastL = part(sph(), skin, -0.045, -0.5, -0.03, 0.05, 0.046, 0.042);
  const breastR = part(sph(), skin, 0.045, -0.5, -0.03, 0.05, 0.046, 0.042);
  sway.add(breastL, breastR);
  const topL = part(cone(), cloth, -0.045, -0.487, -0.055, 0.032, 0.032, 0.025, Math.PI / 2);
  const topR = part(cone(), cloth, 0.045, -0.487, -0.055, 0.032, 0.032, 0.025, Math.PI / 2);
  sway.add(topL, topR);
  const strapL = part(box(), cloth, -0.07, -0.4, 0.02, 0.008, 0.16, 0.008, 0.4, 0, 0.35);
  const strapR = part(box(), cloth, 0.07, -0.4, 0.02, 0.008, 0.16, 0.008, 0.4, 0, -0.35);
  sway.add(strapL, strapR);
  const choker = part(torus(), trim, 0.02, -0.365, 0.01, 0.55, 0.55, 0.55, Math.PI / 2);
  sway.add(choker);

  function arm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(0.115 * side, -0.4, 0.02);
    sway.add(pivot);
    const upper = part(geo('armcap', () => new THREE.CapsuleGeometry(0.026, 0.13, 3, 6)), skin, 0, -0.09, 0);
    pivot.add(upper);
    const fore = new THREE.Group();
    fore.position.set(0.03 * side, -0.16, -0.03);
    pivot.add(fore);
    fore.add(part(geo('farm', () => new THREE.CapsuleGeometry(0.021, 0.13, 3, 6)), skin, 0, -0.08, 0));
    const hand = part(sph(), skin, 0.014 * side, -0.19, -0.026, 0.032, 0.036, 0.03);
    fore.add(hand);
    return { pivot, fore, hand };
  }
  const left = arm(-1);
  const right = arm(1);

  /**
   * The weapon mount, deliberately NOT parented to the right forearm.
   *
   * It used to hang off `right.fore`, which chained four transforms deep
   * (sway -> pivot -> fore -> mount) and made the gun's screen position an
   * emergent property of the arm's geometry. That is why this file needed so
   * many passes to frame: every change to the body moved the weapon, and every
   * change to the weapon moved the body. Hanging the mount directly off `sway`
   * means the two are positioned independently — the body can sit where a body
   * belongs (low, mostly below the bezel, showing the top of the chest) while
   * the weapon sits where a weapon belongs (lower-right third, front sight
   * visible), and neither is hostage to the other.
   *
   * The arm is still drawn, and still overlaps the mount, so the weapon reads
   * as held rather than floating.
   */
  const mount = new THREE.Group();
  mount.position.set(0.007, -0.093, -0.05);
  sway.add(mount);

  let weapon = null;
  let kick = 0;
  let time = 0;
  let meleeT = 0;

  function setWeapon(id, wrapId, charmId) {
    if (weapon) mount.remove(weapon);
    weapon = createWeaponMesh(id, wrapId, charmId);
    weapon.rotation.x = id === 'greatsword' ? 0.2 : 0;
    mount.add(weapon);
  }

  function setLook(look) {
    skin.color.set(look.skin || '#ffd0c2');
    cloth.color.set(look.cloth || '#ff3d8a');
    trim.color.set(look.trim || '#7af6ff');
    trim.emissive.set(look.trim || '#7af6ff');
    choker.visible = (look.accessories || []).includes('choker') || (look.accessories || []).includes('jewelry');
    setWeapon(look._weapon || look.melee || 'katana', look.wrap, look.charm);
  }

  function update(dt, ctx) {
    time += dt;
    const speed = ctx.speed || 0;
    const ads = ctx.ads ? 1 : 0;
    const moving = speed > 0.4;
    const freq = ctx.sprint ? 14 : 9;
    // All sway/bob amplitudes are scaled to the new body. They were tuned against
    // a chest twice this size, so carrying them over verbatim made the weapon
    // swing through a third of the screen on every step.
    const bob = moving ? Math.sin(time * freq) * (ctx.sprint ? 0.012 : 0.007) : Math.sin(time * 1.6) * 0.0025;
    const j = (ctx.jiggle ?? 1);
    const swayX = Math.sin(time * (ads ? 1.3 : 1.6)) * (ads ? 0.0035 : 0.006) * j;
    sway.position.set(
      (ctx.strafe || 0) * 0.018 + swayX + (1 - ads) * 0.085,
      -0.012 + bob * j - ads * 0.022 + (ctx.crouch ? -0.03 : 0),
      -0.025 - ads * 0.045,
    );
    sway.rotation.z = -ctx.strafe * 0.022 + Math.sin(time * 1.4) * 0.006;
    kick = Math.max(0, kick - dt * 8);
    // Kick pushes the weapon *back* along its own axis, away from the target, so
    // a shot reads as recoil rather than as the gun lunging at the camera. Only
    // z is animated: x and y are the framing decision made once at build time,
    // and letting the recoil transient overwrite them would be a subtle way to
    // lose that framing every time the player fires.
    mount.position.z = -0.05 - kick * 0.05;
    mount.rotation.x = -kick * 0.35 + (meleeT > 0 ? Math.sin((1 - meleeT) * Math.PI) * -1.4 : 0);
    if (meleeT > 0) meleeT = Math.max(0, meleeT - dt * 3.2);
    const bounce = Math.sin(time * (moving ? 12 : 3)) * (moving ? 0.022 : 0.008) * j * (ctx.extra ? 1.6 : 1);
    breastL.position.y = -0.5 + bounce;
    breastR.position.y = -0.5 + bounce * 0.9;
    strapL.rotation.x = 0.4 + bounce * 2;
    strapR.rotation.x = 0.4 + bounce * 2;
    left.pivot.rotation.x = moving ? Math.sin(time * freq) * 0.15 : Math.sin(time * 1.5) * 0.04;
    right.pivot.rotation.x = kick * 0.2;
    // The tide spear's transformation. As a cut leaves, the regalia head slides
    // down the shaft, its crest tines scissor open and the hydro sidearm unfolds
    // out of it, then everything snaps home. Driven by the existing slash timer,
    // so the weapon is never in a state the animation system does not own.
    const split = weapon && weapon.userData.split;
    if (split) {
      const t = meleeT;
      split.head.position.z = split.home.z + t * 0.4;
      split.head.position.y = split.home.y - t * 0.05;
      split.sidearm.visible = t > 0.06;
      split.sidearm.position.z = -0.06 - t * 0.08;
      for (let i = 0; i < split.tines.length; i++) {
        const sc = 1 + t * (i === 0 ? 0.4 : -0.2);
        split.tines[i].scale.set(sc, sc, sc);
      }
    }
    const spec = (weapon && (GUNS[weapon.userData.id] || MELEE[weapon.userData.id])) || null;
    if (weapon && weapon.userData.charm) {
      weapon.userData.charm.rotation.z = Math.sin(time * 4) * 0.4 * j;
      weapon.userData.charm.position.y = -0.08 + Math.sin(time * 6) * 0.01 * j;
    }
    return spec;
  }

  function punch() { kick = 1; }
  function slash() { meleeT = 1; kick = 0.4; }

  setWeapon('katana', 'sakura', 'heart');

  return { group: root, setWeapon, setLook, update, punch, slash };
}
