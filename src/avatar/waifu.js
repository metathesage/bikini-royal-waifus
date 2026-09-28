import * as THREE from 'three';
import { bodyStats, faceStats, wrapStats } from '../data/catalog.js';
import { createGlbWaifu } from './glbWaifu.js';

const GEO = new Map();
function geo(name, build) {
  let g = GEO.get(name);
  if (!g) {
    g = build();
    GEO.set(name, g);
  }
  return g;
}

let GRAD = null;
function gradient() {
  if (GRAD) return GRAD;
  const data = new Uint8Array([
    62, 54, 82, 255,
    148, 126, 176, 255,
    226, 214, 238, 255,
    255, 255, 255, 255,
  ]);
  GRAD = new THREE.DataTexture(data, 4, 1);
  GRAD.magFilter = THREE.NearestFilter;
  GRAD.minFilter = THREE.NearestFilter;
  GRAD.colorSpace = THREE.SRGBColorSpace;
  GRAD.needsUpdate = true;
  return GRAD;
}

const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x241028, side: THREE.BackSide });

function toon(color, opts = {}) {
  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: gradient(),
    emissive: opts.emissive || 0x000000,
    emissiveIntensity: opts.emissiveIntensity || 0,
    map: opts.map || null,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    depthWrite: opts.depthWrite !== false,
    side: opts.side || THREE.FrontSide,
  });
  if (opts.unique) m.userData.unique = true;
  return m;
}

function patternTex(look) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = look.cloth;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = look.trim;
  g.strokeStyle = look.trim;
  if (look.pattern === 'stripes') {
    g.lineWidth = 10;
    for (let i = -128; i < 256; i += 22) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 64, 128);
      g.stroke();
    }
  } else if (look.pattern === 'hearts') {
    for (let y = 16; y < 128; y += 36) {
      for (let x = 16; x < 128; x += 36) {
        g.beginPath();
        g.arc(x - 5, y, 6, 0, Math.PI * 2);
        g.arc(x + 5, y, 6, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.moveTo(x - 11, y + 2);
        g.lineTo(x, y + 16);
        g.lineTo(x + 11, y + 2);
        g.fill();
      }
    }
  } else if (look.pattern === 'stars') {
    for (let y = 18; y < 128; y += 40) {
      for (let x = 18; x < 128; x += 40) {
        g.save();
        g.translate(x, y);
        g.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
          const r = i % 2 === 0 ? 10 : 4;
          g.lineTo(Math.cos(a) * (i % 2 ? 4 : 10), Math.sin(a) * (i % 2 ? 4 : 10));
        }
        g.closePath();
        g.fill();
        g.restore();
      }
    }
  } else if (look.pattern === 'scales') {
    g.strokeStyle = look.trim;
    g.lineWidth = 2;
    for (let y = 0; y < 128; y += 16) {
      for (let x = (y / 16) % 2 ? 8 : 0; x < 128; x += 16) {
        g.beginPath();
        g.arc(x, y, 8, 0, Math.PI);
        g.stroke();
      }
    }
  } else if (look.pattern === 'lattice') {
    g.strokeStyle = look.trim;
    g.lineWidth = 2;
    for (let i = 0; i < 128; i += 16) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function mesh(g, material, full, cloth) {
  const m = new THREE.Mesh(g, material);
  if (full) {
    const o = new THREE.Mesh(g, OUTLINE);
    o.scale.setScalar(1.055);
    o.raycast = () => {};
    m.add(o);
  }
  m.castShadow = false;
  m.receiveShadow = false;
  if (cloth) m.userData.cloth = true;
  return m;
}

function spring(stiff, damp) {
  let p = 0;
  let v = 0;
  return {
    step(target, dt, drive) {
      v += (target - p) * stiff * dt + drive;
      v *= Math.exp(-damp * dt);
      p += v * dt;
      p = Math.max(-0.9, Math.min(0.9, p));
      return p;
    },
  };
}

export function createWaifu(look, detail = 'full') {
  // Any explicit model choice wins, whatever the detail level. This used to be
  // gated on 'full', which meant bots — always built at 'lite' — silently fell
  // back to the procedural body and the entire rigged roster was dead weight.
  // An import is also the cheaper option here: one skinned mesh instead of the
  // sixty-odd primitives the procedural body is built from.
  if (look && look.model && look.model !== 'procedural') {
    return createGlbWaifu(look, detail);
  }
  const full = detail === 'full';
  const root = new THREE.Group();
  const visual = new THREE.Group();
  root.add(visual);

  const skin = toon(look.skin || '#ffd0c2');
  const blushMat = toon('#ff6d93', { transparent: true, opacity: 0.85, depthWrite: false });
  const eyeWhite = toon('#fff8fb');
  const irisMat = toon(look.eye || '#3ee0ff', { emissive: look.eye || '#3ee0ff', emissiveIntensity: 0.25 });
  const dark = toon('#1a1022');
  const gloss = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    specular: new THREE.Color('#ffd6ea'),
    shininess: 90,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const parts = { visual };
  const wardrobe = new THREE.Group();
  visual.add(wardrobe);

  const hips = new THREE.Group();
  hips.position.y = 0.9;
  visual.add(hips);
  parts.hips = hips;

  const pelvis = mesh(geo('pelvis', () => new THREE.SphereGeometry(0.16, 16, 12)), skin, full);
  pelvis.scale.set(1.15, 0.85, 1.05);
  hips.add(pelvis);
  if (full) {
    const gshell = new THREE.Mesh(pelvis.geometry, gloss);
    gshell.scale.copy(pelvis.scale).multiplyScalar(1.01);
    hips.add(gshell);
    parts.gloss = gshell;
  }

  function leg(side) {
    const thigh = new THREE.Group();
    thigh.position.set(0.1 * side, -0.02, 0);
    hips.add(thigh);
    const tmesh = mesh(geo('thigh', () => new THREE.CapsuleGeometry(0.075, 0.26, 4, 8)), skin, full);
    tmesh.position.y = -0.2;
    thigh.add(tmesh);
    const shin = new THREE.Group();
    shin.position.y = -0.4;
    thigh.add(shin);
    const smesh = mesh(geo('shin', () => new THREE.CapsuleGeometry(0.05, 0.28, 3, 8)), skin, full);
    smesh.position.y = -0.2;
    shin.add(smesh);
    const foot = mesh(geo('foot', () => new THREE.SphereGeometry(0.055, 10, 8)), skin, full);
    foot.scale.set(0.9, 0.55, 1.45);
    foot.position.set(0, -0.4, -0.03);
    shin.add(foot);
    return { thigh, shin };
  }
  const L = leg(-1);
  const R = leg(1);
  parts.thighL = L.thigh;
  parts.thighR = R.thigh;
  parts.shinL = L.shin;
  parts.shinR = R.shin;

  const waist = new THREE.Group();
  waist.position.y = 0.16;
  hips.add(waist);
  const waistMesh = mesh(geo('waist', () => new THREE.CylinderGeometry(0.09, 0.12, 0.16, 12)), skin, full);
  waist.add(waistMesh);

  const chest = new THREE.Group();
  chest.position.y = 0.2;
  waist.add(chest);
  parts.chest = chest;
  const rib = mesh(geo('rib', () => new THREE.SphereGeometry(0.15, 16, 12)), skin, full);
  rib.scale.set(0.95, 0.85, 0.78);
  chest.add(rib);
  parts.rib = rib;

  function breast(side) {
    const g = new THREE.Group();
    g.position.set(0.07 * side, 0.02, -0.08);
    chest.add(g);
    const b = mesh(geo('breast', () => new THREE.SphereGeometry(0.085, 14, 12)), skin, full);
    b.scale.set(1, 0.95, 0.9);
    g.add(b);
    return g;
  }
  parts.breastL = breast(-1);
  parts.breastR = breast(1);

  const neck = mesh(geo('neck', () => new THREE.CylinderGeometry(0.045, 0.05, 0.1, 10)), skin, full);
  neck.position.y = 0.18;
  chest.add(neck);

  const head = new THREE.Group();
  head.position.y = 0.3;
  chest.add(head);
  parts.head = head;
  const skull = mesh(geo('skull', () => new THREE.SphereGeometry(0.15, 18, 14)), skin, full);
  skull.scale.set(0.92, 1.05, 0.9);
  head.add(skull);
  parts.skull = skull;

  function eye(side) {
    const e = new THREE.Group();
    e.position.set(0.05 * side, 0.02, -0.12);
    head.add(e);
    const w = mesh(geo('eyew', () => new THREE.SphereGeometry(0.045, 12, 10)), eyeWhite, false);
    w.scale.set(1.15, 1.25, 0.45);
    e.add(w);
    const iris = mesh(geo('iris', () => new THREE.SphereGeometry(0.026, 10, 8)), irisMat, false);
    iris.position.z = -0.018;
    e.add(iris);
    const pupil = mesh(geo('pupil', () => new THREE.SphereGeometry(0.012, 8, 6)), dark, false);
    pupil.position.z = -0.028;
    e.add(pupil);
    const glint = mesh(geo('glint', () => new THREE.SphereGeometry(0.008, 6, 6)), toon('#ffffff'), false);
    glint.position.set(0.012 * side, 0.012, -0.03);
    e.add(glint);
    if (full) {
      const lash = mesh(geo('lash', () => new THREE.TorusGeometry(0.04, 0.006, 6, 10, Math.PI)), dark, false);
      lash.rotation.x = Math.PI / 2;
      lash.rotation.z = Math.PI;
      lash.position.y = 0.02;
      e.add(lash);
    }
    return e;
  }
  parts.eyeL = eye(-1);
  parts.eyeR = eye(1);

  const mouth = mesh(geo('mouth', () => new THREE.TorusGeometry(0.028, 0.006, 6, 10, Math.PI)), toon('#c4486a'), false);
  mouth.rotation.x = Math.PI / 2.2;
  mouth.rotation.z = Math.PI;
  mouth.position.set(0, -0.055, -0.12);
  head.add(mouth);

  const blushL = mesh(geo('blush', () => new THREE.SphereGeometry(0.03, 8, 6)), blushMat, false);
  blushL.position.set(-0.07, -0.02, -0.11);
  blushL.scale.set(1.3, 0.7, 0.4);
  head.add(blushL);
  const blushR = blushL.clone();
  blushR.position.x = 0.07;
  head.add(blushR);
  parts.blushL = blushL;
  parts.blushR = blushR;

  function arm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.18 * side, 0.06, 0);
    chest.add(shoulder);
    // Deltoid. The rib sphere only reaches x≈0.14 and the upper-arm capsule
    // starts at x=0.18, so the joint used to be a hole between the torso and
    // the arm — most obvious whenever the pose abducted the arm. Overlapping
    // both sides by ~0.06 closes it for every pose rather than one.
    const delt = mesh(geo('delt', () => new THREE.SphereGeometry(0.058, 10, 8)), skin, full);
    delt.position.y = 0.012;
    delt.scale.set(1.12, 1, 1);
    shoulder.add(delt);
    const upper = mesh(geo('upper', () => new THREE.CapsuleGeometry(0.035, 0.2, 3, 8)), skin, full);
    upper.position.y = -0.14;
    shoulder.add(upper);
    const fore = new THREE.Group();
    fore.position.y = -0.28;
    shoulder.add(fore);
    const fmesh = mesh(geo('fore', () => new THREE.CapsuleGeometry(0.028, 0.18, 3, 8)), skin, full);
    fmesh.position.y = -0.12;
    fore.add(fmesh);
    const hand = mesh(geo('hand', () => new THREE.SphereGeometry(0.04, 8, 8)), skin, full);
    hand.scale.set(0.8, 1, 0.55);
    hand.position.y = -0.26;
    fore.add(hand);
    return { shoulder, fore, hand };
  }
  const aL = arm(-1);
  const aR = arm(1);
  parts.armL = aL.shoulder;
  parts.armR = aR.shoulder;
  parts.foreL = aL.fore;
  parts.foreR = aR.fore;
  parts.handR = aR.hand;

  const weaponMount = new THREE.Group();
  weaponMount.position.set(0, -0.28, -0.02);
  aR.fore.add(weaponMount);
  parts.weaponMount = weaponMount;

  const tailAnchor = new THREE.Group();
  tailAnchor.position.set(0, 0.02, 0.12);
  hips.add(tailAnchor);
  parts.tailAnchor = tailAnchor;

  const hairAnchor = new THREE.Group();
  head.add(hairAnchor);
  parts.hairAnchor = hairAnchor;

  const bustS = spring(46, 7);
  const bustS2 = spring(38, 6);
  const hairS = spring(28, 5);
  const tailS = spring(22, 4.5);
  const thighS = spring(30, 6);
  let prevSpeed = 0;
  let time = 0;
  let pose = 'idle';
  let spin = 0;

  function addM(parent, g, material, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    const m = mesh(g, material, full, true);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  }

  function clearWardrobe() {
    const drop = [];
    visual.traverse((o) => { if (o.userData && o.userData.cloth) drop.push(o); });
    for (const o of drop) {
      o.traverse((c) => {
        if (c.material && c.material.userData && c.material.userData.unique) {
          if (c.material.map) c.material.map.dispose();
          c.material.dispose();
        }
      });
      if (o.parent) o.parent.remove(o);
    }
    for (const c of [...hairAnchor.children]) hairAnchor.remove(c);
    for (const c of [...tailAnchor.children]) tailAnchor.remove(c);
    parts.hairLock = null;
    parts.tailSeg = null;
    const old = parts.heldWeapon;
    if (old) {
      parts.weaponMount.remove(old);
      parts.heldWeapon = null;
    }
  }

  function setLook(next) {
    look = next;
    const b = bodyStats(next.body);
    const f = faceStats(next.face);
    skin.color.set(next.skin);
    irisMat.color.set(next.eye);
    irisMat.emissive.set(next.eye);
    hips.scale.set(b.hip, 1, b.hip);
    chest.scale.set(b.chest, 1, b.chest);
    parts.breastL.scale.setScalar(b.bust);
    parts.breastR.scale.setScalar(b.bust);
    parts.thighL.scale.set(b.thigh, 1, b.thigh);
    parts.thighR.scale.set(b.thigh, 1, b.thigh);
    root.scale.set(1, b.height, 1);
    parts.eyeL.scale.setScalar(f.eye);
    parts.eyeR.scale.setScalar(f.eye);
    skull.scale.set(0.92 * f.cheek, 1.05, 0.9);
    const mk = next.makeup;
    blushL.visible = mk === 'blush' || mk === 'freckle' || mk === 'heart';
    blushR.visible = blushL.visible;
    blushMat.opacity = mk === 'none' ? 0 : 0.8;
    if (parts.gloss) parts.gloss.material.opacity = next.wet ? 0.22 : 0.05;

    clearWardrobe();
    const cloth = toon(next.pattern === 'solid' ? next.cloth : '#ffffff', {
      map: next.pattern === 'solid' ? null : patternTex(next),
      unique: true,
      emissive: next.glow ? next.trim : 0x000000,
      emissiveIntensity: next.glow ? 0.22 : 0,
      transparent: !!next.sheer,
      opacity: next.sheer ? 0.58 : 1,
      depthWrite: !next.sheer,
    });
    // setLook is called with partial looks (the studio dresses a partial look),
    // so fall back rather than handing three an undefined colour, which renders
    // as a black surface and only produces a console warning.
    const trimColor = next.trim || next.cloth || '#ffd0c2';
    const hairColor = next.hairColor || '#ffd0ea';
    const trim = toon(trimColor, { emissive: trimColor, emissiveIntensity: next.glow ? 0.65 : 0.15 });
    const hairMat = toon(hairColor, { emissive: hairColor, emissiveIntensity: 0.08 });
    const darkAcc = toon('#241428');

    const topAnchor = new THREE.Group();
    topAnchor.userData.cloth = true;
    topAnchor.position.set(0, 0.02, -0.1);
    chest.add(topAnchor);
    const cup = (side) => {
      if (next.top === 'crystal') {
        addM(topAnchor, geo('octa', () => new THREE.OctahedronGeometry(0.07, 0)), trim, 0.07 * side, 0.01, 0, 1, 0.8, 0.7);
      } else if (next.top === 'ribbon') {
        addM(topAnchor, geo('torus', () => new THREE.TorusGeometry(0.05, 0.012, 6, 10)), cloth, 0.07 * side, 0.01, 0, 1, 1, 1, Math.PI / 2, 0, 0.4 * side);
      } else if (next.top === 'band' || next.top === 'micro') {
        addM(topAnchor, geo('box', () => new THREE.BoxGeometry(0.08, 0.045, 0.04)), cloth, 0.065 * side, 0.01, 0, next.top === 'micro' ? 0.7 : 1.1, 1, 1);
      } else if (next.top === 'sling') {
        addM(topAnchor, geo('box', () => new THREE.BoxGeometry(0.1, 0.02, 0.02)), cloth, 0.02 * side, 0.04, 0.02, 1, 1, 1, 0, 0, 0.9 * side);
      } else if (next.top === 'heart') {
        addM(topAnchor, geo('breast', () => new THREE.SphereGeometry(0.085, 14, 12)), cloth, 0.07 * side, 0, 0, 0.55, 0.5, 0.35);
      } else if (next.top === 'strappy') {
        addM(topAnchor, geo('box', () => new THREE.BoxGeometry(0.09, 0.012, 0.012)), cloth, 0.05 * side, 0.03, 0, 1, 1, 1, 0.2, 0, 0.5 * side);
        addM(topAnchor, geo('box', () => new THREE.BoxGeometry(0.09, 0.012, 0.012)), cloth, 0.05 * side, -0.02, 0, 1, 1, 1, -0.2, 0, 0.5 * side);
      } else {
        addM(topAnchor, geo('cone', () => new THREE.ConeGeometry(0.055, 0.07, 8)), cloth, 0.068 * side, 0, 0, 1, 1, 0.7, Math.PI / 2, 0, 0);
      }
    };
    cup(-1);
    cup(1);
    if (next.top !== 'band') {
      addM(topAnchor, geo('strap', () => new THREE.BoxGeometry(0.012, 0.16, 0.012)), cloth, -0.1, 0.1, 0.08, 1, 1, 1, 0.3, 0, 0.4);
      addM(topAnchor, geo('strap', () => new THREE.BoxGeometry(0.012, 0.16, 0.012)), cloth, 0.1, 0.1, 0.08, 1, 1, 1, 0.3, 0, -0.4);
    }
    if (next.glow) {
      addM(topAnchor, geo('trimbox', () => new THREE.BoxGeometry(0.22, 0.012, 0.012)), trim, 0, 0.16, 0.04, 1, 1, 1);
    }

    const bot = new THREE.Group();
    bot.userData.cloth = true;
    bot.position.set(0, 0.02, -0.08);
    hips.add(bot);
    if (next.bottom === 'shorts') addM(bot, geo('box', () => new THREE.BoxGeometry(0.08, 0.045, 0.04)), cloth, 0, 0, 0, 2.3, 1.3, 2.2);
    else if (next.bottom === 'crystal') addM(bot, geo('octa', () => new THREE.OctahedronGeometry(0.07, 0)), trim, 0, 0, 0, 1.4, 0.5, 1);
    else if (next.bottom === 'ribbon') {
      addM(bot, geo('torus', () => new THREE.TorusGeometry(0.05, 0.01, 6, 8)), cloth, -0.1, 0, 0, 1, 1, 1, Math.PI / 2);
      addM(bot, geo('torus', () => new THREE.TorusGeometry(0.05, 0.01, 6, 8)), cloth, 0.1, 0, 0, 1, 1, 1, Math.PI / 2);
    } else if (next.bottom === 'skirt') addM(bot, geo('cone', () => new THREE.ConeGeometry(0.16, 0.08, 10)), cloth, 0, -0.02, 0, 1, 1, 1, Math.PI);
    else if (next.bottom === 'sling') addM(bot, geo('box', () => new THREE.BoxGeometry(0.08, 0.02, 0.02)), cloth, 0, 0, 0, 0.7, 1, 1.2);
    else addM(bot, geo('box', () => new THREE.BoxGeometry(0.08, 0.045, 0.04)), cloth, 0, 0, 0, 1.5, 0.7, 1.1);

    const acc = new Set(next.accessories || []);
    if (acc.has('cat-ears') || acc.has('fox-ears')) {
      const tall = acc.has('fox-ears') ? 1.4 : 1;
      addM(hairAnchor, geo('cone', () => new THREE.ConeGeometry(0.055, 0.07, 8)), hairMat, -0.07, 0.12, 0, 1, tall, 1);
      addM(hairAnchor, geo('cone', () => new THREE.ConeGeometry(0.055, 0.07, 8)), hairMat, 0.07, 0.12, 0, 1, tall, 1);
      addM(hairAnchor, geo('cone', () => new THREE.ConeGeometry(0.055, 0.07, 8)), toon('#ffd0ea'), -0.07, 0.1, 0.01, 0.55, tall * 0.6, 0.4);
      addM(hairAnchor, geo('cone', () => new THREE.ConeGeometry(0.055, 0.07, 8)), toon('#ffd0ea'), 0.07, 0.1, 0.01, 0.55, tall * 0.6, 0.4);
    }
    if (acc.has('horns')) {
      addM(hairAnchor, geo('cone', () => new THREE.ConeGeometry(0.055, 0.07, 8)), trim, -0.08, 0.1, 0.04, 0.7, 1.6, 0.7, 0, 0, 0.5);
      addM(hairAnchor, geo('cone', () => new THREE.ConeGeometry(0.055, 0.07, 8)), trim, 0.08, 0.1, 0.04, 0.7, 1.6, 0.7, 0, 0, -0.5);
    }
    if (acc.has('halo')) addM(hairAnchor, geo('halo', () => new THREE.TorusGeometry(0.16, 0.012, 6, 20)), trim, 0, 0.24, 0, 1, 1, 1, Math.PI / 2);
    if (acc.has('flower')) addM(hairAnchor, geo('flower', () => new THREE.SphereGeometry(0.04, 8, 6)), toon('#ff4f9a', { emissive: '#ff4f9a', emissiveIntensity: 0.3 }), -0.1, 0.08, -0.06, 1, 0.4, 1);
    if (acc.has('headphones')) {
      addM(hairAnchor, geo('torus', () => new THREE.TorusGeometry(0.13, 0.012, 6, 12)), darkAcc, 0, 0.02, 0, 1, 1, 1, 0, Math.PI / 2);
      addM(hairAnchor, geo('cyl', () => new THREE.CylinderGeometry(0.045, 0.045, 0.04, 8)), darkAcc, -0.13, 0.02, 0, 1, 1, 1, 0, 0, Math.PI / 2);
      addM(hairAnchor, geo('cyl', () => new THREE.CylinderGeometry(0.045, 0.045, 0.04, 8)), darkAcc, 0.13, 0.02, 0, 1, 1, 1, 0, 0, Math.PI / 2);
    }
    if (acc.has('glasses')) addM(head, geo('glasses', () => new THREE.TorusGeometry(0.05, 0.006, 6, 10)), trim, 0, 0.02, -0.12, 1.6, 0.7, 1);
    if (acc.has('choker')) addM(chest, geo('choker', () => new THREE.TorusGeometry(0.055, 0.012, 6, 12)), cloth, 0, 0.16, 0, 1, 1, 1, Math.PI / 2);
    if (acc.has('earrings')) {
      addM(head, geo('gem', () => new THREE.OctahedronGeometry(0.02, 0)), trim, -0.13, -0.02, 0, 1, 1.4, 1);
      addM(head, geo('gem', () => new THREE.OctahedronGeometry(0.02, 0)), trim, 0.13, -0.02, 0, 1, 1.4, 1);
    }
    if (acc.has('thigh')) {
      addM(parts.thighL, geo('torus', () => new THREE.TorusGeometry(0.05, 0.01, 6, 8)), cloth, 0, -0.12, 0, 1.5, 1.5, 1.5, Math.PI / 2);
      addM(parts.thighR, geo('torus', () => new THREE.TorusGeometry(0.05, 0.01, 6, 8)), cloth, 0, -0.12, 0, 1.5, 1.5, 1.5, Math.PI / 2);
    }
    if (acc.has('armlets')) {
      addM(parts.armL, geo('torus', () => new THREE.TorusGeometry(0.05, 0.01, 6, 8)), trim, 0, -0.12, 0, 1, 1, 1, Math.PI / 2);
      addM(parts.armR, geo('torus', () => new THREE.TorusGeometry(0.05, 0.01, 6, 8)), trim, 0, -0.12, 0, 1, 1, 1, Math.PI / 2);
    }
    if (acc.has('ribbons')) {
      addM(parts.foreL, geo('box', () => new THREE.BoxGeometry(0.08, 0.02, 0.02)), cloth, 0, -0.08, 0, 1, 1, 1, 0, 0, 0.6);
      addM(parts.foreR, geo('box', () => new THREE.BoxGeometry(0.08, 0.02, 0.02)), cloth, 0, -0.08, 0, 1, 1, 1, 0, 0, -0.6);
    }
    if (acc.has('jewelry')) {
      addM(chest, geo('gem', () => new THREE.OctahedronGeometry(0.02, 0)), trim, 0, -0.02, -0.16, 1.3, 1.6, 1);
      addM(hips, geo('gem', () => new THREE.OctahedronGeometry(0.02, 0)), trim, 0.12, 0.05, -0.08, 1, 1, 1);
    }
    if (acc.has('navel')) addM(waist, geo('gem', () => new THREE.OctahedronGeometry(0.02, 0)), trim, 0, 0, -0.1, 0.7, 0.7, 0.7);
    if (acc.has('anklets')) {
      addM(parts.shinL, geo('torus', () => new THREE.TorusGeometry(0.05, 0.008, 6, 8)), trim, 0, -0.34, 0, 1.1, 1.1, 1.1, Math.PI / 2);
      addM(parts.shinR, geo('torus', () => new THREE.TorusGeometry(0.05, 0.008, 6, 8)), trim, 0, -0.34, 0, 1.1, 1.1, 1.1, Math.PI / 2);
    }
    if (acc.has('wings')) {
      const wingMat = toon('#ffe6f6', { transparent: true, opacity: 0.78, emissive: '#ffd0ea', emissiveIntensity: 0.3, side: THREE.DoubleSide });
      addM(chest, geo('wing', () => new THREE.PlaneGeometry(0.34, 0.22)), wingMat, -0.22, 0.08, 0.1, 1, 1, 1, 0.2, 0.5, 0.4);
      addM(chest, geo('wing', () => new THREE.PlaneGeometry(0.34, 0.22)), wingMat, 0.22, 0.08, 0.1, 1, 1, 1, 0.2, -0.5, -0.4);
    }
    if (acc.has('tail') || acc.has('fox-tail')) {
      const fat = acc.has('fox-tail') ? 1.35 : 1;
      let parent = tailAnchor;
      for (let i = 0; i < 4; i++) {
        const seg = new THREE.Group();
        parent.add(seg);
        const cap = mesh(geo('tailseg', () => new THREE.CapsuleGeometry(0.03, 0.1, 2, 6)), hairMat, false);
        cap.rotation.x = Math.PI / 2.4;
        cap.position.z = 0.08;
        cap.scale.setScalar(fat * (1 + i * 0.05));
        seg.add(cap);
        seg.position.z = i === 0 ? 0 : 0.1;
        parent = seg;
        if (i === 0) parts.tailSeg = seg;
      }
    }

    buildHair(next.hair, hairMat, full);

    parts.look = next;
  }

  function buildHair(style, hairMat, fullDetail) {
    const bang = addM(hairAnchor, geo('bangs', () => new THREE.SphereGeometry(0.12, 12, 8)), hairMat, 0, 0.04, -0.06, 1.15, 0.55, 0.7);
    bang.position.y = 0.06;
    if (style === 'bob' || style === 'wolf') {
      addM(hairAnchor, geo('bob', () => new THREE.SphereGeometry(0.16, 14, 10)), hairMat, 0, -0.02, 0.02, 1.05, 0.85, 1.05);
    }
    if (style === 'long' || style === 'hime' || style === 'side' || style === 'pony' || style === 'wolf') {
      const lock = new THREE.Group();
      hairAnchor.add(lock);
      parts.hairLock = lock;
      addM(lock, geo('lock', () => new THREE.CapsuleGeometry(0.06, 0.34, 3, 6)), hairMat, 0, -0.28, 0.08, 1.1, 1, 0.7);
      if (style === 'long' || style === 'hime') {
        addM(lock, geo('lock2', () => new THREE.CapsuleGeometry(0.045, 0.42, 3, 6)), hairMat, -0.1, -0.32, 0.02, 0.8, 1.15, 0.7);
        addM(lock, geo('lock2', () => new THREE.CapsuleGeometry(0.045, 0.42, 3, 6)), hairMat, 0.1, -0.32, 0.02, 0.8, 1.15, 0.7);
      }
      if (style === 'pony') addM(hairAnchor, geo('cone', () => new THREE.ConeGeometry(0.06, 0.1, 6)), hairMat, 0, 0.16, 0.06, 1, 1, 1, Math.PI);
    }
    if (style === 'twintail' || style === 'drills') {
      for (const side of [-1, 1]) {
        const tw = new THREE.Group();
        tw.position.set(0.12 * side, -0.02, 0);
        hairAnchor.add(tw);
        if (side < 0) parts.hairLock = tw;
        if (style === 'drills') {
          addM(tw, geo('drill', () => new THREE.TorusGeometry(0.05, 0.028, 6, 8)), hairMat, 0, -0.08, 0, 1, 1, 1, Math.PI / 2);
          addM(tw, geo('drill', () => new THREE.TorusGeometry(0.05, 0.028, 6, 8)), hairMat, 0, -0.18, 0, 0.85, 0.85, 0.85, Math.PI / 2);
          addM(tw, geo('drill', () => new THREE.TorusGeometry(0.05, 0.028, 6, 8)), hairMat, 0, -0.27, 0, 0.65, 0.65, 0.65, Math.PI / 2);
        } else {
          addM(tw, geo('twin', () => new THREE.CapsuleGeometry(0.045, 0.32, 3, 6)), hairMat, 0, -0.22, 0, 1, 1, 1);
        }
      }
    }
    if (style === 'side') addM(hairAnchor, geo('sidehair', () => new THREE.CapsuleGeometry(0.04, 0.2, 2, 6)), hairMat, -0.12, -0.08, -0.04, 1, 1, 1, 0, 0, 0.4);
    if (!fullDetail && style === 'long') {
      /* lite already has the main lock */
    }
  }

  function attachWeapon(group) {
    if (parts.heldWeapon) parts.weaponMount.remove(parts.heldWeapon);
    parts.heldWeapon = group;
    if (group) parts.weaponMount.add(group);
  }

  function setPose(name) { pose = name || 'idle'; }

  const facePt = new THREE.Vector3();
  const chestPt = new THREE.Vector3();
  const hipPt = new THREE.Vector3();

  function update(dt, ctx = {}) {
    dt = Math.min(0.05, dt);
    time += dt;
    const speed = ctx.speed || 0;
    const sprint = !!ctx.sprint && speed > 1;
    const moving = speed > 0.35 && !ctx.airborne;
    const amp = sprint ? 0.75 : moving ? 0.48 : 0;
    const freq = sprint ? 12 : 7.5;
    const s = Math.sin(time * freq);
    const jiggle = (ctx.jiggle ?? 1) * (ctx.extra ? 1.75 : 1);
    const drive = (speed - prevSpeed) * 0.02 * jiggle + Math.abs(ctx.vy || 0) * 0.004 * jiggle + (ctx.pulse || 0);
    prevSpeed = speed;

    parts.thighL.rotation.x = s * amp;
    parts.thighR.rotation.x = -s * amp;
    parts.shinL.rotation.x = Math.max(0, -s) * amp * 1.1;
    parts.shinR.rotation.x = Math.max(0, s) * amp * 1.1;

    const usePose = ctx.pose || pose;
    const posing = usePose && usePose !== 'idle' && usePose !== 'walk' && usePose !== 'run';
    if (!posing) {
      parts.armL.rotation.x = -s * amp * 0.65;
      parts.armR.rotation.x = s * amp * 0.65 + 0.15;
      parts.armL.rotation.z = 0.15;
      parts.armR.rotation.z = -0.25;
      parts.foreL.rotation.x = 0.1;
      parts.foreR.rotation.x = 0.35;
      spin = 0;
      visual.rotation.y = 0;
    } else {
      applyPose(usePose, time, jiggle);
    }

    visual.rotation.z = Math.sin(time * (moving ? freq * 0.5 : 1.5)) * (posing ? 0.05 : moving ? 0.045 : 0.03);
    hips.position.y = 0.9 + Math.abs(s) * amp * 0.04;
    chest.rotation.x = Math.sin(time * 2.2) * 0.03 + (posing ? 0.08 : 0);
    head.rotation.y = Math.sin(time * 0.8) * 0.12;
    head.rotation.x = ctx.lookPitch ? ctx.lookPitch * 0.3 : Math.sin(time * 0.6) * 0.04;

    const b1 = bustS.step(Math.sin(time * 2.4) * 0.08, dt, drive);
    const b2 = bustS2.step(Math.sin(time * 2.4 + 0.4) * 0.06, dt, drive * 0.8);
    parts.breastL.rotation.x = b1;
    parts.breastR.rotation.x = b2;
    parts.breastL.position.z = -0.08 - Math.max(0, b1) * 0.04;
    parts.breastR.position.z = -0.08 - Math.max(0, b2) * 0.04;
    const hs = hairS.step(0, dt, drive * 1.4 + Math.sin(time * 3) * 0.01 * jiggle);
    if (parts.hairLock) parts.hairLock.rotation.x = -0.1 + hs;
    const ts = tailS.step(Math.sin(time * 3) * 0.2, dt, drive);
    if (parts.tailSeg) parts.tailSeg.rotation.x = ts;
    const th = thighS.step(0, dt, drive * 0.5);
    parts.thighL.rotation.z = 0.04 + th;
    parts.thighR.rotation.z = -0.04 - th;

    if (ctx.knocked) {
      visual.rotation.x = 1.05;
      visual.position.y = 0.15;
    } else if (ctx.dead) {
      visual.rotation.x = 1.4;
      visual.position.y = 0.05;
    } else {
      visual.rotation.x = 0;
      visual.position.y = 0;
    }

    head.getWorldPosition(facePt);
    chest.getWorldPosition(chestPt);
    hips.getWorldPosition(hipPt);
  }

  function applyPose(name, t, jiggle) {
    const bounce = Math.sin(t * 6) * 0.12 * jiggle;
    if (name === 'blowkiss') {
      parts.armR.rotation.x = -1.3 + bounce;
      parts.armR.rotation.z = -0.3;
      parts.foreR.rotation.x = -1.1;
      parts.armL.rotation.x = 0.2;
      parts.armL.rotation.z = 0.4;
      head.rotation.x = 0.15;
      chest.rotation.x = 0.15 + bounce;
    } else if (name === 'stretch') {
      parts.armL.rotation.x = -2.7;
      parts.armR.rotation.x = -2.7;
      parts.armL.rotation.z = 0.3;
      parts.armR.rotation.z = -0.3;
      parts.foreL.rotation.x = 0;
      parts.foreR.rotation.x = 0;
      chest.rotation.x = -0.15 + bounce;
    } else if (name === 'spin') {
      spin += 0.08;
      visual.rotation.y = spin;
      parts.armL.rotation.z = 1.1;
      parts.armR.rotation.z = -1.1;
      parts.armL.rotation.x = 0.2;
      parts.armR.rotation.x = 0.2;
    } else if (name === 'wave') {
      parts.armR.rotation.x = -1.6;
      parts.armR.rotation.z = -0.2 + Math.sin(t * 8) * 0.4;
      parts.foreR.rotation.x = -0.4;
      parts.armL.rotation.x = 0.3;
      parts.armL.rotation.z = 0.2;
    } else if (name === 'cheer') {
      const c = Math.abs(Math.sin(t * 8));
      parts.armL.rotation.x = -2.2 + c * 0.4;
      parts.armR.rotation.x = -2.2 + c * 0.4;
      parts.armL.rotation.z = 0.4;
      parts.armR.rotation.z = -0.4;
      hips.position.y = 0.9 + c * 0.08;
    } else if (name === 'shy') {
      parts.armL.rotation.x = 0.5;
      parts.armR.rotation.x = 0.6;
      parts.armL.rotation.z = 0.6;
      parts.armR.rotation.z = -0.5;
      parts.thighL.rotation.z = 0.25;
      parts.thighR.rotation.z = -0.25;
      head.rotation.y = 0.4;
      head.rotation.x = 0.3;
    } else if (name === 'sparkle') {
      parts.armR.rotation.x = -2.4;
      parts.armR.rotation.z = -0.2;
      parts.armL.rotation.x = 0.4;
      parts.armL.rotation.z = 0.5;
      hips.rotation.z = 0.18 + bounce;
      chest.rotation.x = 0.1;
    } else if (name === 'heart') {
      parts.armL.rotation.x = -2.5;
      parts.armR.rotation.x = -2.5;
      parts.armL.rotation.z = 0.9;
      parts.armR.rotation.z = -0.9;
      parts.foreL.rotation.z = -0.8;
      parts.foreR.rotation.z = 0.8;
    } else if (name === 'queen') {
      parts.armL.rotation.x = 0.6;
      parts.armR.rotation.x = 0.6;
      parts.armL.rotation.z = 0.9;
      parts.armR.rotation.z = -0.9;
      parts.foreL.rotation.x = -1.2;
      parts.foreR.rotation.x = -1.2;
      head.rotation.x = -0.12;
    } else if (name === 'idol') {
      parts.armR.rotation.x = -1.5;
      parts.armR.rotation.z = -0.4;
      parts.foreR.rotation.x = -0.6;
      parts.eyeR.scale.setScalar(0.25 + Math.abs(Math.sin(t * 3)) * 0.05);
      parts.armL.rotation.z = 0.3;
    } else if (name === 'curtsey') {
      hips.position.y = 0.72;
      parts.thighL.rotation.x = 0.8;
      parts.thighR.rotation.x = 0.5;
      parts.armL.rotation.z = 0.4;
      parts.armR.rotation.x = 0.8;
      visual.rotation.x = 0.25;
    } else if (name === 'adjust') {
      parts.armL.rotation.x = -0.8;
      parts.armR.rotation.x = -0.7;
      parts.foreL.rotation.x = -1.2;
      parts.foreR.rotation.x = -1.1;
      head.rotation.x = 0.45;
      chest.rotation.x = 0.2 + bounce;
    } else if (name === 'beam') {
      parts.armL.rotation.z = 0.5;
      parts.armR.rotation.z = -0.5;
      parts.armL.rotation.x = -0.4;
      parts.armR.rotation.x = -0.4;
      visual.position.y = Math.sin(t * 2) * 0.06;
      head.rotation.x = -0.25;
    }
  }

  setLook(look || {});

  return {
    group: root,
    parts,
    setLook,
    setPose,
    attachWeapon,
    update,
    facePoint: facePt,
    chestPoint: chestPt,
    hipPoint: hipPt,
  };
}

export { wrapStats };
