import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWaifu } from '../avatar/waifu.js';
import { createWeaponMesh } from '../avatar/viewmodel.js';
import { loadGltf, instanceOf, normalizeScene } from '../data/assets.js';

const PRESETS = {
  lobby: { key: '#fff0e0', fill: '#ffb3d9', rim: '#ff7ab0', bg: '#ffb08a', exp: 1.1, fog: '#ffb89a' },
  sunset: { key: '#ffb067', fill: '#ff6ad5', rim: '#7a4bff', bg: '#2a1030', exp: 1.2, fog: '#4a2040' },
  neon: { key: '#39ffd2', fill: '#ff2bd6', rim: '#8aa0ff', bg: '#07121c', exp: 1.28, fog: '#102028' },
  victory: { key: '#fff6d0', fill: '#ffd0ea', rim: '#ffe566', bg: '#2a1048', exp: 1.35, fog: '#402050' },
};

export function createStudio(canvas, renderer, look) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffc9a8, 12, 34);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
  camera.position.set(1.15, 1.32, -3.15);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0.15, 1.05, 0);
  controls.enableDamping = true;
  controls.minDistance = 0.7;
  controls.maxDistance = 7;
  controls.maxPolarAngle = Math.PI * 0.92;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.7;

  const hemi = new THREE.HemisphereLight(0xffd8e8, 0x6a8f5a, 0.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0f8, 1.3);
  key.position.set(2.5, 4, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x7af6ff, 0.6);
  fill.position.set(-3, 2, -1);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xff4f9a, 0.9);
  rim.position.set(-1, 2.2, -3);
  scene.add(rim);

  // Ground: a soft grass disc; the trees and shrine come from the shipped env pack.
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(9, 48),
    new THREE.MeshToonMaterial({ color: 0x7fbf6a }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const HERO_Y = 0;
  const petals = [];

  // Diorama backdrop from real GLBs, ringed around the hero so it reads from any orbit angle.
  const DIORAMA = [
    ['/assets/env/japanese_shrine.glb', 5.5, [0.6, 7.2]],
  ];
  for (const [url, height, [x, z]] of DIORAMA) {
    loadGltf(url).then((g) => {
      const o = instanceOf(g.scene);
      normalizeScene(o, height);
      const holder = new THREE.Group();
      holder.add(o);
      holder.position.set(x, 0, z);
      holder.rotation.y = Math.atan2(-x, -z);
      scene.add(holder);
    }).catch(() => {});
  }

  // Download readout for imported characters. A 117 MB model is not instant, so
  // the ring sweeps as bytes arrive and turns pink if the asset fails. Drawn in
  // the scene rather than the DOM so the menu layout is untouched.
  const ARC_SPAN = Math.PI * 1.7;
  const ARC_SEGS = 72;
  const loadArc = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.022, 6, ARC_SEGS, ARC_SPAN),
    new THREE.MeshBasicMaterial({ color: 0x7dfff0, transparent: true, opacity: 0.95 }),
  );
  const ARC_INDICES = 6 * ARC_SEGS * 6; // radial x tubular x 2 triangles x 3
  loadArc.geometry.setDrawRange(0, 0);
  loadArc.rotation.x = Math.PI / 2;
  loadArc.position.set(0.15, 0.06, 0);
  loadArc.visible = false;
  scene.add(loadArc);
  const loadDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0x7dfff0 }),
  );
  loadDot.visible = false;
  scene.add(loadDot);
  let loadSpin = 0;

  // Drifting sakura petals.
  const count = 90;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = (Math.random() - 0.5) * 9;
    arr[i * 3 + 1] = Math.random() * 4;
    arr[i * 3 + 2] = (Math.random() - 0.5) * 9;
  }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xffc2dc, size: 0.06, transparent: true, opacity: 0.9 }));
  scene.add(sparks);

  let waifu = createWaifu(look, 'full');
  let currentModel = look.model || 'procedural';
  waifu.group.position.y = HERO_Y;
  scene.add(waifu.group);
  let pose = 'idle';
  let extra = false;
  let lightName = 'lobby';
  let pulse = 0;

  function buildWeapon(next) {
    waifu.attachWeapon(createWeaponMesh(next.melee || 'katana', next.wrap, next.charm));
  }

  /** Reflect the current character's download state on the progress ring. */
  function syncLoadIndicator(dt) {
    const l = waifu.load;
    if (!l) {
      loadArc.visible = false;
      loadDot.visible = false;
      return;
    }
    loadSpin += dt * 1.5;
    if (l.state === 'ready') {
      loadArc.visible = false;
      loadDot.visible = false;
      return;
    }
    if (l.state === 'error') {
      loadArc.geometry.setDrawRange(0, ARC_INDICES);
      loadArc.material.color.set(0xff4f6a);
      loadArc.material.opacity = 0.45 + Math.sin(performance.now() / 160) * 0.25;
      loadArc.rotation.z = -loadSpin;
      loadArc.visible = true;
      loadDot.visible = false;
      return;
    }
    const p = Math.max(0.03, Math.min(1, l.progress || 0));
    loadArc.geometry.setDrawRange(0, Math.round(ARC_INDICES * p));
    loadArc.material.color.set(0x7dfff0);
    loadArc.material.opacity = 0.35 + p * 0.6;
    loadArc.rotation.z = -loadSpin;
    loadArc.visible = true;
    const a = loadSpin;
    loadDot.position.set(0.15 + Math.cos(a) * 0.5, 0.06, Math.sin(a) * 0.5);
    loadDot.material.color.set(0x7dfff0);
    loadDot.visible = true;
  }

  function dress(next) {
    const m = next.model || 'procedural';
    if (m !== currentModel) {
      currentModel = m;
      rebuild(next);
      return;
    }
    waifu.setLook(next);
    buildWeapon(next);
  }

  function rebuild(next) {
    scene.remove(waifu.group);
    waifu = createWaifu(next, 'full');
    // A rebuilt hero starts back at the origin, so it needs the pedestal lift
    // reapplied — otherwise the first model swap sinks her into the dais again.
    waifu.group.position.y = HERO_Y;
    scene.add(waifu.group);
    dress(next);
  }
  dress(look);

  function setLighting(name) {
    lightName = PRESETS[name] ? name : 'lobby';
    const p = PRESETS[lightName];
    key.color.set(p.key);
    fill.color.set(p.fill);
    rim.color.set(p.rim);
    scene.fog.color.set(p.fog);
    scene.background = new THREE.Color(p.bg);
    renderer.toneMappingExposure = p.exp;
  }
  setLighting('lobby');

  function focus(part) {
    const map = { face: 1.55, body: 1.05, bikini: 1.15, jewelry: 1.35, full: 1.05 };
    controls.target.y = map[part] ?? 1.05;
    const dist = part === 'face' ? 1.15 : part === 'bikini' ? 2.1 : part === 'jewelry' ? 1.7 : 3.4;
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 0.001) dir.set(0, 0.2, 1);
    dir.setLength(dist);
    camera.position.copy(controls.target).add(dir);
  }

  function update(dt, input, flags) {
    controls.autoRotate = !!flags.autoRotate && !flags.gamepadOrbit;
    controls.enabled = flags.orbit !== false;
    if (flags.gamepadOrbit && input) {
      const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      sph.theta -= input.lookX * 1.4;
      sph.phi -= input.lookY * 1.4;
      sph.phi = Math.max(0.25, Math.min(Math.PI - 0.2, sph.phi));
      sph.radius = Math.max(0.8, Math.min(7, sph.radius - input.moveY * dt * 2));
      camera.position.setFromSpherical(sph).add(controls.target);
    }
    controls.update();
    // Reposition after the controls have moved the camera — parking it first
    // would anchor the ship to last frame's pose and make it visibly lag.
    const pos = sparkGeo.attributes.position;
    for (let i = 0; i < count; i++) {
      let y = pos.getY(i) - dt * 0.25;
      if (y < 0) y = 4;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(performance.now() / 900 + i) * dt * 0.15);
    }
    pos.needsUpdate = true;
    pulse = flags.extra ? Math.sin(performance.now() / 180) * 1.4 : 0;
    waifu.setPose(pose);
    waifu.update(dt, { speed: flags.walk ? 3 : 0, sprint: !!flags.run, jiggle: flags.jiggle ?? 1, extra: !!flags.extra, pose, pulse, vy: pulse });
    syncLoadIndicator(dt);
  }

  return {
    scene, camera, controls, waifu,
    dress, setLighting, focus, rebuild,
    setPose(name) { pose = name || 'idle'; },
    update,
  };
}
