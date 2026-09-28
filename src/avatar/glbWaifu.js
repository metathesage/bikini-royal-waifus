import * as THREE from 'three';
import {
  CHARACTERS, PSX_BY_ID, loadGltf, loadPsxCharacter, normalizeScene, instanceOf, watchAsset,
} from '../data/assets.js';
import { createRig } from './rig.js';

/** Characters are normalized to this height so GLB and procedural bodies share one frame. */
const CHAR_HEIGHT = 1.7;

/**
 * Async GLB character wrapper. Duck-types the procedural createWaifu output:
 * { group, parts, setLook, setPose, attachWeapon, update, facePoint, chestPoint, hipPoint }.
 * Shows a skin-toned placeholder until the model streams in; keeps the full
 * signature so studio/match can treat it exactly like a procedural waifu.
 */
export function createGlbWaifu(look, detail = 'full') {
  const full = detail === 'full';
  const root = new THREE.Group();
  const visual = new THREE.Group();
  root.add(visual);
  const parts = { visual };

  const placeholder = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.3, 0.9, 4, 12),
    new THREE.MeshToonMaterial({ color: look?.skin || '#ffd0c2' }),
  );
  placeholder.position.y = 0.85;
  visual.add(placeholder);

  let model = null;
  let mixer = null;
  let rig = null;
  const clips = {};
  let currentAction = null;
  let pose = 'idle';
  let time = 0;
  let spin = 0;
  let heldWeapon = null;
  let pendingWeapon = null;
  let handBone = null;
  /** Set for one frame by match.js when this actor pulls a trigger. */
  let fireFlag = false;
  /** Set for one frame when this actor is hit. */
  let hitFlag = false;

  /** Live download state, read by the studio to show progress / failure. */
  const load = { url: null, state: 'idle', progress: 0, error: null };

  const prevSpeed = { v: 0 };

  const facePt = new THREE.Vector3();
  const chestPt = new THREE.Vector3();
  const hipPt = new THREE.Vector3();
  const _hipWorld = new THREE.Vector3();

  // The PSX roster is FBX + external albedo; the locker heroes are plain GLB.
  const entry = PSX_BY_ID[look?.model];
  const url = (entry || CHARACTERS[look?.model] || {}).url;
  if (url) {
    // Subscribe before kicking off the load so a cached-but-still-loading
    // 117 MB model reports progress instead of going quiet.
    watchAsset(entry ? `psx:${url}` : url, (state, progress) => {
      load.state = state;
      load.progress = progress;
    });
    load.url = url;
    // FBX roster entries resolve to a bare scene; GLB heroes resolve to the
    // whole gltf, because a few of them ship real animation clips we want.
    const fetchModel = entry
      ? loadPsxCharacter(entry).then((scene) => ({ scene, animations: null }))
      : loadGltf(url).then((gltf) => ({ scene: gltf.scene, animations: gltf.animations }));
    fetchModel.then((source) => {
      // Never add the cached scene itself: the registry hands the same node to
      // every subscriber, so a second actor on the same model would re-parent it
      // away and both characters would vanish.
      const scene = instanceOf(source.scene);
      normalizeScene(scene, CHAR_HEIGHT, { faceCamera: true });
      scene.traverse((o) => {
        if (o.isBone && !handBone && /hand.*r(ight)?|righthand|hand_r/i.test(o.name || '')) handBone = o;
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if ('envMapIntensity' in m) m.envMapIntensity = 0.5;
            if (m.map && m.map.colorSpace !== THREE.SRGBColorSpace) m.map.colorSpace = THREE.SRGBColorSpace;
            m.needsUpdate = true;
          }
        }
      });
      // A rig turns a static statue into something that walks, aims and shoots.
      rig = createRig(scene);
      if (!rig && !handBone) {
        // Static import with no skeleton: fall back to a fixed grip beside the
        // hip so a weapon can still be held.
        handBone = new THREE.Group();
        handBone.position.set(0.26, 1.02, -0.16);
        scene.add(handBone);
      }
      visual.add(scene);
      model = scene;
      visual.remove(placeholder);
      placeholder.geometry.dispose();
      placeholder.material.dispose();
      // Attach anything already requested while the model was in flight.
      if (pendingWeapon) attachWeapon(pendingWeapon);
      // Real clips, when the asset has them, take over for idle/emote; the
      // procedural rig keeps driving locomotion and gunfire either way.
      if (source.animations && source.animations.length) {
        mixer = new THREE.AnimationMixer(scene);
        for (const clip of source.animations) {
          const n = (clip.name || '').toLowerCase();
          if (!clips.idle && /idle|stand/.test(n)) clips.idle = clip;
          else if (!clips.walk && /walk/.test(n)) clips.walk = clip;
          else if (!clips.run && /run/.test(n)) clips.run = clip;
        }
        if (clips.idle) playClip('idle');
      }
      load.state = 'ready';
      load.progress = 1;
    }).catch((e) => {
      console.error('character load failed', url, e);
      load.state = 'error';
      load.error = e;
    });
  } else {
    load.state = 'error';
    load.error = new Error(`unknown character model: ${look?.model}`);
  }

  function playClip(name, crossfade = 0.25) {
    if (!mixer) return;
    const clip = clips[name];
    if (!clip) return;
    const next = mixer.clipAction(clip);
    if (currentAction === next) return;
    if (currentAction) currentAction.fadeOut(crossfade);
    next.reset().fadeIn(crossfade).play();
    currentAction = next;
  }

  function setLook(next) {
    look = next;
    if (full) placeholder.material.color.set(look.skin || '#ffd0c2');
    parts.look = next;
  }

  function setPose(name) {
    pose = name || 'idle';
  }

  /**
   * Put a weapon in the right hand. On a rigged model that means parenting to
   * the actual hand bone, so the gun swings with the aim pose; on a static model
   * we fall back to a fixed grip point beside the hip.
   */
  function attachWeapon(group) {
    if (heldWeapon) {
      heldWeapon.parent?.remove(heldWeapon);
      heldWeapon = null;
    }
    pendingWeapon = null;
    if (!group) return;
    const bone = (rig && rig.handBone) || handBone;
    if (!bone) {
      // Model still loading: remember it and attach on arrival.
      pendingWeapon = group;
      return;
    }
    group.scale.setScalar(1.35);
    // A Mixamo hand points down its local -Y; rotate so the barrel runs along
    // the bone's forward axis and sits just past the fist.
    group.position.set(0, -0.06, -0.12);
    group.rotation.set(Math.PI * 0.5, 0, 0);
    bone.add(group);
    heldWeapon = group;
  }

  function update(dt, ctx = {}) {
    dt = Math.min(0.05, dt);
    time += dt;
    const speed = ctx.speed || 0;
    const posing = pose && pose !== 'idle' && pose !== 'walk' && pose !== 'run';

    // A rigged model gets real skeletal animation. It owns the bones outright,
    // so any clip mixer is suppressed while a rig is present — otherwise the two
    // would fight over the same transforms every frame.
    if (rig) {
      rig.update(dt, {
        speed,
        crouch: !!ctx.crouch,
        airborne: !ctx.grounded,
        knocked: !!ctx.knocked,
        dead: !!ctx.dead,
        aiming: !!ctx.aiming,
        firing: fireFlag,
        hit: hitFlag,
        emote: pose !== 'idle' && pose !== 'walk' && pose !== 'run',
        lookPitch: ctx.lookPitch || 0,
      });
      fireFlag = false;
      hitFlag = false;
      // Whole-body orientation still lives on the outer visual group.
      if (!posing) {
        visual.rotation.z = Math.sin(rig.time * (speed > 0.35 ? 5 : 1.5)) * (speed > 0.35 ? 0.04 : 0.015);
      } else if (pose === 'spin') {
        spin += 0.08;
        visual.rotation.y = spin;
      } else {
        visual.rotation.z = 0;
        if (pose && pose !== 'idle') rig.emote();
      }
      if (ctx.knocked) {
        visual.position.y = -0.55;
        visual.rotation.x = 0.2;
      } else if (ctx.dead) {
        visual.position.y = 0.1;
        visual.rotation.x = 1.35;
      } else {
        visual.position.y = 0;
        visual.rotation.x = 0;
      }
      // The skeleton deforms the mesh; the group still supplies the facing.
      visual.getWorldPosition(_hipWorld);
      hipPt.copy(_hipWorld);
      facePt.copy(_hipWorld);
      facePt.y += 0.62;
      chestPt.copy(_hipWorld);
      chestPt.y += 0.3;
      return;
    }

    if (mixer) {
      if (!posing) {
        if (speed > 5 && clips.run) playClip('run');
        else if (speed > 0.35 && clips.walk) playClip('walk');
        else playClip('idle');
      }
      mixer.update(dt);
    } else if (model) {
      // Static imports (no clips) get a hand-authored idle: a slow breathing
      // bob plus a weight shift, amplitude driven by movement.
      const amp = speed > 5 ? 0.7 : speed > 0.35 ? 0.45 : 0;
      const rate = speed > 5 ? 12 : 7.5;
      const s = Math.sin(time * rate);
      const breath = Math.sin(time * 1.9) * 0.012;
      model.position.y = (Math.abs(s) * amp * 0.04) + breath;
      model.rotation.y = Math.sin(time * 0.7) * 0.05 + Math.sin(time * 1.2) * 0.04;
      model.rotation.z = Math.sin(time * 0.9) * 0.012;
    } else {
      placeholder.rotation.y = Math.sin(time * 1.2) * 0.08;
      placeholder.position.y = 0.85 + Math.sin(time * 2.2) * 0.02;
    }

    const jiggle = (ctx.jiggle ?? 1) * (ctx.extra ? 1.5 : 1);
    const drive = (speed - prevSpeed.v) * 0.015 * jiggle + Math.abs(ctx.vy || 0) * 0.003 * jiggle;
    prevSpeed.v = speed;

    if (!posing) {
      visual.rotation.z = Math.sin(time * (speed > 0.35 ? 5 : 1.5)) * (speed > 0.35 ? 0.04 : 0.02);
    } else if (pose === 'spin') {
      spin += 0.08;
      visual.rotation.y = spin;
    }

    if (model) {
      if (ctx.knocked) {
        model.rotation.x = 1.05;
        model.position.y = 0.12;
      } else if (ctx.dead) {
        model.rotation.x = 1.4;
        model.position.y = 0.04;
      } else {
        model.rotation.x = 0;
      }
      if (heldWeapon && heldWeapon.userData.charm) {
        heldWeapon.userData.charm.rotation.z = Math.sin(time * 4) * 0.3 * jiggle;
      }
    }

    model?.getWorldPosition(hipPt);
    if (hipPt.lengthSq() < 1e-8) hipPt.set(0, 0, 0);
    hipPt.y += 0.9;
    facePt.copy(hipPt);
    facePt.y += 0.72;
    chestPt.copy(hipPt);
    chestPt.y += 0.35;
  }

  return {
    group: root,
    parts,
    setLook,
    setPose,
    attachWeapon,
    update,
    load,
    isGlb: true,
    /** True when the model has a skeleton we drive procedurally. */
    get rigged() { return !!rig; },
    /** Fire the weapon on the next update — drives the aim + recoil pose. */
    fire() { fireFlag = true; },
    /** React to being hit on the next update. */
    flinch() { hitFlag = true; },
    /** World-space muzzle point, for flash and tracer origins. */
    get muzzle() { return rig ? rig.settleMuzzle() : chestPt; },
    facePoint: facePt,
    chestPoint: chestPt,
    hipPoint: hipPt,
  };
}
