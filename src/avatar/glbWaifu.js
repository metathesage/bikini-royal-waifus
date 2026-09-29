import * as THREE from 'three';
import {
  CHARACTERS, PSX_BY_ID, loadGltf, loadPsxCharacter, normalizeScene, instanceOf, watchAsset,
} from '../data/assets.js';
import { createRig } from './rig.js';
import { addJiggle } from './jiggle.js';
import { retargetClips, vrmRetargetSetup } from './retarget.js';
import { loadVrmFull, vrmBoneNames } from './vrm.js';

const TOON_RAMP = (() => {
  const d = new Uint8Array([90, 160, 220, 255]);
  const t = new THREE.DataTexture(d, d.length, 1, THREE.RedFormat);
  t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
})();
function toToon(scene) {
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const conv = (m) => {
      const t = new THREE.MeshToonMaterial({ map: m.map || null, color: m.color ? m.color.clone() : new THREE.Color(0xffffff), gradientMap: TOON_RAMP, transparent: m.transparent, opacity: m.opacity, side: m.side, alphaTest: m.alphaTest || 0 });
      t.emissive.set(0x1a1216);
      return t;
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
}

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
  // Only the menu/viewer shows a stand-in while streaming; bots pop in instead of appearing as capsules.
  placeholder.visible = full;
  visual.add(placeholder);

  let model = null;
  let mixer = null;
  let rig = null;
  const clips = {};
  let currentAction = null;
  // True when this model has real animation clips driving it, in which case the
  // procedural rig is suppressed. Both write the same bone transforms, so they
  // cannot both run - see the load path for why clips win.
  let useClips = false;
  let pose = 'idle';
  let time = 0;
  let spin = 0;
  let heldWeapon = null;
  let shootT = 0;
  let jiggler = null;
  let vrmObj = null;
  let pendingWeapon = null;
  let handBone = null;
  /** Set for one frame by match.js when this actor pulls a trigger. */
  let fireFlag = false;
  /** Set for one frame when this actor is hit. */
  let hitFlag = false;
  /**
   * Group-level recoil and flinch timers.
   *
   * These are the fix for "the characters do not shoot". `firing` used to be
   * consumed only inside the `rig && !useClips` branch, so on every model
   * driven by real clips -- which is now all of them -- the fire flag was set
   * by match.js, never read, and (because the clearing line sat in that same
   * branch) never reset either. The character played an idle clip and did not
   * flinch while emptying a magazine.
   *
   * A bone-level reaction cannot be added on the clip path, because the mixer
   * owns the bones and fighting it would tear the skeleton apart. So the kick
   * is applied to `visual` -- the parent of the whole model -- which is free
   * no matter who is driving the joints, and reads as recoil at any distance.
   */
  let recoilT = 0;
  let flinchT = 0;

  /** Live download state, read by the studio to show progress / failure. */
  const load = { url: null, state: 'idle', progress: 0, error: null };

  const prevSpeed = { v: 0 };

  const facePt = new THREE.Vector3();
  const chestPt = new THREE.Vector3();
  const hipPt = new THREE.Vector3();
  const _hipWorld = new THREE.Vector3();

  // The PSX roster is FBX + external albedo; the locker heroes are plain GLB.
  const entry = PSX_BY_ID[look?.model];
  const spec = CHARACTERS[look?.model] || {};
  const url = (entry || spec).url;
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
      : spec.vrm && full
        // The player and the menu get the real VRM: spring bones for hair, skirt and bust.
        ? Promise.all([loadVrmFull(url), loadGltf('/assets/anims/ual.glb')]).then(([{ vrm }, anim]) => ({
          scene: vrm.scene, vrm, animations: [], animSrc: anim, nameOf: (b) => { const n = vrm.humanoid.getRawBoneNode(b); return n ? n.name : null; },
        }))
        : spec.vrm
          ? Promise.all([loadGltf(url), loadGltf('/assets/anims/ual.glb')]).then(([gltf, anim]) => ({ scene: gltf.scene, animations: [], animSrc: anim, nameOf: vrmBoneNames(gltf) }))
          : spec.retarget
            ? Promise.all([loadGltf(url), loadGltf('/assets/anims/ual.glb')]).then(([gltf, anim]) => ({ scene: gltf.scene, animations: [], animSrc: anim }))
            : loadGltf(url).then((gltf) => ({ scene: gltf.scene, animations: gltf.animations }));
    fetchModel.then((source) => {
      // Never add the cached scene itself: the registry hands the same node to
      // every subscriber, so a second actor on the same model would re-parent it
      // away and both characters would vanish.
      const scene = source.vrm ? source.scene : instanceOf(source.scene);
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
      // Auto-rigged models carry no clips: borrow the shared animation set through retargeting.
      if (source.animSrc) {
        scene.updateMatrixWorld(true);
        const setup = source.nameOf ? vrmRetargetSetup(source.nameOf) : null;
        source.animations = setup
          ? retargetClips(scene, source.animSrc.scene, source.animSrc.animations, setup.map, 24, setup.roles)
          : retargetClips(scene, source.animSrc.scene, source.animSrc.animations);
        if (source.nameOf) {
          const hn = source.nameOf('rightHand');
          const hb = hn && scene.getObjectByName(hn);
          if (hb) handBone = hb;
        }
      }
      vrmObj = source.vrm || null;
      if (spec.retarget && !source.vrm) toToon(scene);
      if (spec.jiggle && !source.vrm) jiggler = addJiggle(scene, { bust: spec.bust, amp: spec.jiggleAmp });
      visual.remove(placeholder);
      placeholder.geometry.dispose();
      placeholder.material.dispose();
      // Attach anything already requested while the model was in flight.
      if (pendingWeapon) attachWeapon(pendingWeapon);
      // Real clips, when the asset ships them, are the best animation available
      // and they take priority over the procedural rig - a hand-authored walk
      // cycle always looks better than bone rotations synthesised from a
      // velocity. See `useClips` below for how the two are arbitrated.
      if (source.animations && source.animations.length) {
        mixer = new THREE.AnimationMixer(scene);
        // Preferred clip per role, by exact name (UAL-style libraries first, then the
        // Kenney-style soldier). Anything still unresolved falls through to the regexes.
        const byName = new Map(source.animations.map((c) => [(c.name || '').toLowerCase(), c]));
        const PICK = {
          idle: ['idle_loop', 'idle_a', 'idle', 'standby', 'pistol_idle_loop'],
          idleArmed: ['pistol_idle_loop', 'pistol_idle'],
          aim: ['pistol_aim_neutral'],
          glide: ['glide', 'flying_forward'],
          consume: ['consume_item', 'consume', 'greeting'],
          emote: ['dance_simple', 'dance_charleston', 'cheering_two_hands', 'greeting'],
          victory: ['victory', 'victory_fist_pump', 'cheering_two_hands'],
          reload: ['pistol_reload'],
          walk: ['walk_loop', 'walk', 'walk_female'],
          run: ['jog_fwd_loop', 'jog', 'run_anime', 'run_female', 'sprint_loop', 'sprint'],
          sprint: ['sprint_loop', 'sprint', 'run_anime'],
          crouch: ['crouch_fwd_loop', 'crouch_walk', 'crouch'],
          crouchIdle: ['crouch_idle_loop', 'crouch_idle'],
          jump: ['jump_loop', 'jump_air', 'jump', 'fall'],
          die: ['death01', 'death_a', 'die'],
          shoot: ['pistol_shoot', 'holding-right-shoot'],
          hit: ['hit_chest'],
          pickup: ['pickup_table', 'pick-up'],
          back: ['walk_backwards'],
          strafeL: ['strafe_left'],
          strafeR: ['strafe_right'],
        };
        for (const [role, names] of Object.entries(PICK)) {
          for (const nm of names) if (byName.has(nm)) { clips[role] = byName.get(nm); break; }
        }
        for (const clip of source.animations) {
          const n = (clip.name || '').toLowerCase();
          if (!clips.idle && /(idle|stand|standby)/.test(n)) clips.idle = clip;
          else if (!clips.walk && /(walk|^step$)/.test(n)) clips.walk = clip;
          else if (!clips.run && /(run|sprint|jog)/.test(n)) clips.run = clip;
          else if (!clips.jump && /(jump|fall)/.test(n)) clips.jump = clip;
          else if (!clips.crouch && /crouch/.test(n)) clips.crouch = clip;
          else if (!clips.die && /(die|death|dead)/.test(n)) clips.die = clip;
          else if (!clips.pickup && /(pick.?up|pickup)/.test(n)) clips.pickup = clip;
          // Locomotion, kept for the reference doc but not driven: the speeds
          // here are authored for a different skeleton and stretch badly.
        }
        // The rig and the mixer both write bone transforms, so only one may
        // drive a frame. Real clips win whenever the asset actually has them;
        // the rig stays as the fallback for a rigged model with no clips, and
        // for every static one.
        useClips = !!(clips.idle || clips.walk || clips.run);
        if (useClips && clips.idle) playClip('idle');
        // Some game exports bake a root offset into their clips (Mai stands 3.8m off
        // the origin once Standby plays). Re-centre on the posed body, not the bind pose.
        mixer.update(0);
        scene.updateMatrixWorld(true);
        const posed = new THREE.Box3().setFromObject(scene, true);
        if (Number.isFinite(posed.min.x)) {
          const c = posed.getCenter(new THREE.Vector3());
          scene.position.x -= c.x;
          scene.position.z -= c.z;
          scene.position.y -= posed.min.y;
        }
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

  function playClip(name, crossfade = 0.25, once = false) {
    if (!mixer) return;
    const clip = clips[name];
    if (!clip) return;
    const next = mixer.clipAction(clip);
    if (currentAction === next) return;
    if (currentAction) currentAction.fadeOut(crossfade);
    next.reset();
    if (once) { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; } else next.setLoop(THREE.LoopRepeat, Infinity);
    next.fadeIn(crossfade).play();
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

    // A rigged model gets real skeletal animation, and the procedural rig and a
    // clip mixer both write the same bone transforms - they cannot both drive a
    // frame or they fight over every joint. A hand-authored clip is always the
    // better animation, so clips win whenever the asset ships them; the rig is
    // the fallback for a rigged model with no clips.
    //
    // This ordering used to be `if (rig)`, and `createRig` succeeds on any
    // skinned model - so the mixer was unreachable and real clips never played,
    // no matter what the GLB contained.
    if (rig && !useClips) {
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
      // `fireFlag`/`hitFlag` are cleared further down, after both the rig and the
      // mixer branches, so that a clip-driven model clears them too.
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
      if (shootT > 0) shootT -= dt;
      if (ctx.dead && clips.die) {
        playClip('die', 0.1, true);
      } else if (ctx.using && clips.consume) {
        playClip('consume', 0.15);
      } else if (posing && (clips.emote || clips.victory)) {
        // Emotes and the victory pose play a real clip; anything else falls back to idle.
        const win = /vict|spark|win/i.test(pose) && clips.victory;
        playClip(win ? 'victory' : (clips.emote ? 'emote' : 'idle'), 0.2);
      } else if (posing) {
        playClip('idle');
      } else if (ctx.gliding && clips.glide) {
        playClip('glide', 0.2);
      } else if (!posing) {
        const grounded = ctx.grounded !== false;
        if (!grounded && clips.jump) playClip('jump', 0.15);
        else if (ctx.crouch && clips.crouch) playClip(speed > 0.35 ? 'crouch' : (clips.crouchIdle ? 'crouchIdle' : 'crouch'));
        else if (ctx.mv && speed > 0.35 && ctx.mv.y < -0.5 && clips.back) playClip('back', 0.15);
        else if (ctx.mv && speed > 0.35 && Math.abs(ctx.mv.x) > 0.7 && Math.abs(ctx.mv.y) < 0.5 && clips.strafeL && clips.strafeR) playClip(ctx.mv.x < 0 ? 'strafeL' : 'strafeR', 0.15);
        else if (speed > 6.5 && (clips.sprint || clips.run)) playClip(clips.sprint ? 'sprint' : 'run', 0.15);
        else if (speed > 3.2 && clips.run) playClip('run', 0.15);
        else if (speed > 0.35 && (clips.walk || clips.run)) playClip(clips.walk ? 'walk' : 'run', 0.15);
        else if (ctx.reloading && clips.reload) playClip('reload', 0.1, true);
        else if (shootT > 0 && clips.shoot) playClip('shoot', 0.05);
        else if (ctx.aiming && clips.aim) playClip('aim', 0.12);
        else if (ctx.armed && clips.idleArmed) playClip('idleArmed', 0.2);
        else playClip('idle');
      }
      if (!currentAction && clips.idle) playClip('idle', 0);
      mixer.update(dt);
      if (jiggler) jiggler.update(dt, speed, ctx.vy || 0, ctx.jiggle ?? 1);
      if (vrmObj) vrmObj.update(dt);
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

    /**
     * Weapon recoil and hit flinch, applied to the whole model.
     *
     * Runs after the rig/mixer branch so it is additive: whoever is driving
     * the bones, the character still kicks. `fire()` and `flinch()` arm it.
     *
     * This block is also why the flags now clear unconditionally. They used to
     * be cleared inside the rig branch only, so on a clip-driven model the
     * first `fire()` latched `fireFlag` on forever and nothing read it anyway.
     */
    if (fireFlag) { recoilT = 1; shootT = 0.32; fireFlag = false; }
    if (hitFlag) { flinchT = 1; hitFlag = false; }
    if (recoilT > 0) recoilT = Math.max(0, recoilT - dt * 7);
    if (flinchT > 0) flinchT = Math.max(0, flinchT - dt * 5.5);
    if (recoilT > 0 || flinchT > 0) {
      const k = recoilT * recoilT;          // quadratic: snappy, then settles
      const f = flinchT * flinchT;
      visual.position.z = -0.075 * k;        // drives back into the shot
      visual.position.y = 0.012 * k - 0.02 * f;
      visual.rotation.x = 0.16 * k - 0.12 * f;
    } else if (visual.position.z !== 0) {
      // Snap back to neutral once the kick is over, otherwise the character
      // spends the rest of the match standing slightly behind where it should.
      visual.position.z = 0;
    }

    if (model) {
      if (ctx.knocked) {
        model.rotation.x = 1.05;
        model.position.y = 0.12;
      } else if (ctx.dead && !(useClips && clips.die)) {
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
    /**
     * What is actually animating this model right now.
     *
     * "clips" means an AnimationMixer is driving real authored animation;
     * "rig" means the procedural bone rig is; "none" is a static model with a
     * hand-authored bob. Worth exposing because the two are easy to confuse: a
     * model can be rigged and still be animating procedurally, and reading
     * `rigged` alone makes a GLB that ships 33 unused animation clips look
     * identical to one that is being played.
     */
    get animSource() {
      if (useClips && mixer) return 'clips';
      if (rig) return 'rig';
      return model ? 'none' : 'placeholder';
    },
    /** The clips this model resolved, by role. Empty when it ships none. */
    get clipNames() {
      return Object.fromEntries(Object.entries(clips).map(([k, v]) => [k, v && v.name]));
    },
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
