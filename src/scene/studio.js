import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWaifu } from '../avatar/waifu.js';
import { createWeaponMesh } from '../avatar/viewmodel.js';

const PRESETS = {
  lobby: { key: '#fff0f8', fill: '#7af6ff', rim: '#ff4f9a', bg: '#1a0b2e', exp: 1.15, fog: '#2a1244' },
  sunset: { key: '#ffb067', fill: '#ff6ad5', rim: '#7a4bff', bg: '#2a1030', exp: 1.2, fog: '#4a2040' },
  neon: { key: '#39ffd2', fill: '#ff2bd6', rim: '#8aa0ff', bg: '#07121c', exp: 1.28, fog: '#102028' },
  victory: { key: '#fff6d0', fill: '#ffd0ea', rim: '#ffe566', bg: '#2a1048', exp: 1.35, fog: '#402050' },
};

export function createStudio(canvas, renderer, look) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2a1244, 8, 22);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(1.15, 1.32, -3.15);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0.15, 1.05, 0);
  controls.enableDamping = true;
  controls.minDistance = 0.7;
  controls.maxDistance = 7;
  controls.maxPolarAngle = Math.PI * 0.92;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.7;

  const hemi = new THREE.HemisphereLight(0xffc6ea, 0x2a1848, 0.7);
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

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 40),
    new THREE.MeshStandardMaterial({ color: 0x241033, metalness: 0.45, roughness: 0.25, emissive: 0x3a1458, emissiveIntensity: 0.35 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.15, 0.035, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0x7dfff0 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);
  const PEDESTAL_H = 0.28;
  const PEDESTAL_Y = 0.14;
  const PEDESTAL_TOP = PEDESTAL_Y + PEDESTAL_H / 2;
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.9, PEDESTAL_H, 8),
    new THREE.MeshToonMaterial({ color: 0xff4f9a, emissive: 0xff4f9a, emissiveIntensity: 0.15 }),
  );
  pedestal.position.y = PEDESTAL_Y;
  scene.add(pedestal);
  /**
   * Where the hero stands, relative to a waifu built at the origin.
   *
   * createWaifu puts the soles at y≈0.05 — correct on the studio floor, wrong on
   * a pedestal whose top is at y=0.28. Standing her on the origin buried the
   * feet, ankles and lower calves inside the opaque dais, so the legs appeared
   * to end in rounded stumps half way down the shin. Lift her onto the surface.
   */
  const HERO_Y = PEDESTAL_TOP - 0.05;
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.28, 0),
    new THREE.MeshBasicMaterial({ color: 0x7dfff0 }),
  );
  gem.position.y = 0.22;
  gem.scale.setScalar(0.55);
  scene.add(gem);

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

  const ufo = new THREE.Group();
  // The saucer used to be a 4-unit white dome parked ~3 units from the menu
  // camera, which is why it read as a flat grey slab clipped into the top-left
  // corner: it was simply too close and too big to look like an object.
  //
  // Moving it in *world* space does not help, though: the studio camera orbits
  // the hero, so any fixed point sweeps a full circle — one moment a hat sitting
  // on her head, the next a smudge behind the logo. It is therefore parked in
  // screen space in update(), where the open sky at upper-right is the one region
  // neither the character nor the copy column ever reaches.
  const hull = new THREE.MeshStandardMaterial({
    color: 0x3a2560, emissive: 0x6b3fbf, emissiveIntensity: 0.35,
    metalness: 0.75, roughness: 0.22,
  });
  const saucer = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 12), hull);
  saucer.scale.set(1.3, 0.28, 1.3);
  ufo.add(saucer);
  // Underside glow ring: the one shape that says "saucer" at any distance.
  // Named ufoRim, not rim — studio already has a DirectionalLight called rim.
  const ufoRim = new THREE.Mesh(
    new THREE.TorusGeometry(1.24, 0.06, 6, 40),
    new THREE.MeshBasicMaterial({ color: 0x7dfff0 }),
  );
  ufoRim.rotation.x = Math.PI / 2;
  ufo.add(ufoRim);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff8ad0, transparent: true, opacity: 0.75 }),
  );
  dome.position.y = 0.22;
  ufo.add(dome);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.6, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xb7f6ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide }));
  beam.position.y = -1.5;
  ufo.add(beam);
  scene.add(ufo);

  /*
   * Screen-space anchor for the drop-ship, in camera-local units.
   *
   * Sized off the frustum at UFO_D: half-width  = D*tan(31.5 ) ≈ 9.8 and
   * half-height = D*tan(19 )  ≈ 5.5 for a 16:9 viewport, so RIGHT 4.3 lands the
   * hull at ~72% across and UP 2.4 at ~28% down — clear of the copy column on the
   * left, the character in the middle and the wallet chips at the very top.
   */
  const UFO_D = 16;
  const UFO_RIGHT = 4.3;
  const UFO_UP = 2.4;
  const _ufoDir = new THREE.Vector3();
  const _ufoRight = new THREE.Vector3();
  const _ufoUp = new THREE.Vector3();
  /** Place the ship in front of the camera, offset to the open sky at upper-right. */
  function parkUfo(t) {
    camera.updateMatrixWorld();
    camera.getWorldDirection(_ufoDir);
    _ufoRight.crossVectors(_ufoDir, camera.up);
    // Degenerate when the view axis lines up with world up — OrbitControls lets
    // the polar angle reach 0, and a zero-length cross would normalize to NaN and
    // throw the ship (and every frame after it) out of the scene.
    if (_ufoRight.lengthSq() < 1e-8) _ufoRight.set(1, 0, 0);
    _ufoRight.normalize();
    _ufoUp.crossVectors(_ufoRight, _ufoDir).normalize();
    ufo.position.copy(camera.position)
      .addScaledVector(_ufoDir, UFO_D)
      .addScaledVector(_ufoRight, UFO_RIGHT)
      .addScaledVector(_ufoUp, UFO_UP + Math.sin(t / 700) * 0.15);
  }

  const sparkGeo = new THREE.BufferGeometry();
  const count = 80;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = (Math.random() - 0.5) * 6;
    arr[i * 3 + 1] = Math.random() * 3.2;
    arr[i * 3 + 2] = (Math.random() - 0.5) * 6;
  }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xffd6f2, size: 0.035, transparent: true, opacity: 0.8 }));
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
    parkUfo(performance.now());
    ufo.rotation.y += dt * 0.3;
    sparks.rotation.y += dt * 0.05;
    gem.rotation.y += dt;
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
