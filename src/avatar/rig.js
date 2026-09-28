import * as THREE from 'three';

/**
 * Generic procedural skeletal animation.
 *
 * The roster mixes Mixamo rigs, 3ds Max `Bip001` rigs and UE mannequin rigs,
 * and most of them ship no clips at all. Rather than retarget a fixed animation
 * set onto every rig, we drive the bones directly.
 *
 * The trick that makes this work on an unknown rest pose is *aiming* instead of
 * guessing Euler angles: a bone's rest direction is simply its offset from its
 * parent, so we can ask "point this bone along this direction" and solve for
 * the local quaternion that achieves it. That is stable whether the rig was
 * authored T-pose or A-pose, and it degrades gracefully â€” a bone we cannot
 * identify simply never moves.
 *
 * Spine and head bones are the exception: their child offset is tiny, so aiming
 * is noisy. Those get small Euler offsets from rest instead.
 */

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Bone name patterns, most specific first. A bone is claimed only once, so the
 * ordering matters: `leftupleg` must be tested before the generic `leg`.
 */
export const RIG_SLOTS = {
  hips: [/^mixamorighips$/i, /hips?$/i, /pelvis/i, /root/i, /bip001_?pelvis/i],
  spine: [/spine$/i, /bip001_?spine_?0?\d*$/i, /chest/i],
  chest: [/upperchest/i, /chest/i, /spine2/i, /spine1/i, /bip001_?spine/i],
  neck: [/neck/i],
  head: [/head$/i, /headtop/i, /bip001_?head/i],
  clavicleL: [/leftshoulder/i, /l_?clavicle/i, /shoulder_?l/i, /bip001_?l_?clavicle/i],
  armL: [/leftarm/i, /l_?upperarm/i, /upperarm_?l/i, /bip001_?l_?upperarm/i],
  foreL: [/leftforearm/i, /l_?forearm/i, /forearm_?l/i, /bip001_?l_?forearm/i],
  handL: [/lefthand/i, /l_?hand$/i, /hand_?l/i, /bip001_?l_?hand/i],
  clavicleR: [/rightshoulder/i, /r_?clavicle/i, /shoulder_?r/i, /bip001_?r_?clavicle/i],
  armR: [/rightarm/i, /r_?upperarm/i, /upperarm_?r/i, /bip001_?r_?upperarm/i],
  foreR: [/rightforearm/i, /r_?forearm/i, /forearm_?r/i, /bip001_?r_?forearm/i],
  handR: [/righthand/i, /r_?hand$/i, /hand_?r/i, /bip001_?r_?hand/i],
  thighL: [/leftupleg/i, /l_?thigh/i, /thigh_?l/i, /leftleg$/i, /bip001_?l_?thigh/i],
  shinL: [/leftleg/i, /l_?calf/i, /calf_?l/i, /leftshin/i, /bip001_?l_?calf/i],
  footL: [/leftfoot/i, /l_?foot/i, /foot_?l/i, /bip001_?l_?foot/i],
  thighR: [/rightupleg/i, /r_?thigh/i, /thigh_?r/i, /rightleg$/i, /bip001_?r_?thigh/i],
  shinR: [/rightleg/i, /r_?calf/i, /calf_?r/i, /rightshin/i, /bip001_?r_?calf/i],
  footR: [/rightfoot/i, /r_?foot/i, /foot_?r/i, /bip001_?r_?foot/i],
};

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();

/** Walk a bone hierarchy parents-first, so posing is order-safe. */
function flatten(bone, out = []) {
  out.push(bone);
  for (const child of bone.children) if (child.isBone) flatten(child, out);
  return out;
}

/** Point a bone along a direction given in skeleton-root space. */
export function aimBone(rig, bone, dx, dy, dz) {
  if (!bone) return;
  const r = rig.rest.get(bone);
  if (!r) return;
  const parent = bone.parent && bone.parent.isBone ? rig.rel.get(bone.parent) : null;
  _v.set(dx, dy, dz);
  if (parent) _v.applyQuaternion(_q2.copy(parent).invert());
  if (_v.lengthSq() < 1e-8) return;
  _v.normalize();
  // setFromUnitVectors is degenerate for exactly-opposed vectors.
  if (_v.dot(r.dir) < -0.9995) return;
  _q.setFromUnitVectors(r.dir, _v);
  bone.quaternion.copy(_q).multiply(r.quat);
}

/** Small Euler offset from rest â€” for spine/head bones and clavicles. */
export function twistBone(rig, bone, x, y, z) {
  if (!bone) return;
  const r = rig.rest.get(bone);
  if (!r) return;
  _e.set(x, y, z, 'XYZ');
  bone.quaternion.copy(r.quat).multiply(_q.setFromEuler(_e));
}

/** Reset every bone to rest and recompute skeleton-root-relative rotations. */
export function resetRig(rig) {
  for (const b of rig.order) b.quaternion.copy(rig.rest.get(b).quat);
  const seed = rig.rest.get(rig.bones.hips).quat;
  const walk = (b, parentRel) => {
    rig.rel.set(b, parentRel);
    const q = parentRel.clone().multiply(rig.rest.get(b).quat);
    for (const c of b.children) if (c.isBone) walk(c, q);
  };
  walk(rig.bones.hips, seed);
}

/**
 * Build an animator for a skinned character, or return null when the model has
 * no usable skeleton.
 */
export function createRig(root) {
  const all = [];
  root.traverse((o) => {
    if (o.isBone) all.push(o);
  });
  if (all.length < 8) return null;

  const bones = {};
  const taken = new Set();
  for (const [slot, patterns] of Object.entries(RIG_SLOTS)) {
    for (const re of patterns) {
      const hit = all.find((b) => !taken.has(b) && re.test(b.name || ''));
      if (hit) {
        bones[slot] = hit;
        taken.add(hit);
        break;
      }
    }
  }
  if (!bones.hips || !bones.head) return null;

  // Snapshot the rest pose: local rotation, the direction the bone points in
  // its parent's space, and its rest offset (for hip height changes).
  const rest = new Map();
  for (const b of all) {
    const dir = b.position.lengthSq() > 1e-8 ? b.position.clone().normalize() : new THREE.Vector3(0, -1, 0);
    rest.set(b, { quat: b.quaternion.clone(), dir, pos: b.position.clone() });
  }
  const order = flatten(bones.hips);

  const rig = {
    bones,
    rest,
    rel: new Map(),
    order,
    rigged: true,
    /** Where a held weapon's muzzle flash and tracers should originate. */
    muzzle: new THREE.Vector3(),
    handBone: bones.handR || bones.foreR || bones.armR || null,
    time: 0,
    phase: 0,
    recoil: 0,
    flinch: 0,
    emoteT: 0,
    update(dt, ctx) { return poseFrame(rig, dt, ctx); },
    settleMuzzle() {
      const h = rig.handBone;
      if (!h) return rig.muzzle;

      h.updateWorldMatrix(true, false);
      h.getWorldPosition(rig.muzzle);
      return rig.muzzle;
    },
    emote() { rig.emoteT = 1.6; },
  };
  resetRig(rig);
  return rig;
}
/**
 * Drive one frame of the skeleton.
 *
 * ctx: { speed, crouch, airborne, knocked, dead, firing, hit, aiming, emote,
 *        lookPitch }
 */
function poseFrame(rig, dt, ctx = {}) {
  const b = rig.bones;
  dt = Math.min(0.05, dt);
  rig.time += dt;

  const speed = ctx.speed || 0;
  const running = speed > 5;
  const walking = speed > 0.35;
  const moving = walking || running;
  // Stride frequency rises with speed, but never turns into a blur.
  const stride = running ? 2.0 + speed * 0.22 : walking ? 1.5 + speed * 0.5 : 0;
  rig.phase += dt * stride;
  const p = rig.phase;
  const swing = Math.sin(p * Math.PI * 2);
  const swing2 = Math.sin(p * Math.PI * 2 + Math.PI);
  const t = rig.time;

  // Impacts decay on their own clock so they read even while strafing.
  if (ctx.firing) rig.recoil = 1;
  if (ctx.hit) rig.flinch = 1;
  rig.recoil = Math.max(0, rig.recoil - dt * 6.5);
  rig.flinch = Math.max(0, rig.flinch - dt * 5.5);

  resetRig(rig);

  const H = b.hips;
  const breath = Math.sin(t * 1.6) * 0.02;
  const recoil = rig.recoil;
  const flinch = rig.flinch;
  const crouch = ctx.crouch && !ctx.airborne ? 1 : 0;

  /* --- collapsed ---------------------------------------------------- */
  if (ctx.dead) {
    // Limp: the body slumps at the hips and the limbs fall out of the way.
    twistBone(rig, H, -0.4, 0, 0);
    twistBone(rig, b.spine, 0.3, 0, 0);
    twistBone(rig, b.chest, 0.22, 0, 0);
    twistBone(rig, b.neck, 0.55, 0.2, 0);
    aimBone(rig, b.armL, -0.9, -0.3, 0.3);
    aimBone(rig, b.foreL, -0.7, -0.6, 0.4);
    aimBone(rig, b.armR, 0.9, -0.2, 0.3);
    aimBone(rig, b.foreR, 0.8, -0.5, 0.3);
    aimBone(rig, b.thighL, -0.2, -0.9, 0.35);
    aimBone(rig, b.shinL, -0.2, -0.8, 0.5);
    aimBone(rig, b.thighR, 0.15, -0.95, 0.2);
    aimBone(rig, b.shinR, 0.1, -0.9, 0.35);
    rig.settleMuzzle();
    return rig;
  }

  /* --- downed / crawling -------------------------------------------- */
  if (ctx.knocked) {
    twistBone(rig, H, 0.6, 0, 0);
    H.position.copy(rig.rest.get(H).pos).addScaledVector(UP, -0.34);
    aimBone(rig, b.armL, -0.7, 0.15, -0.6);
    aimBone(rig, b.foreL, -0.3, 0.1, -0.9);
    aimBone(rig, b.armR, 0.5, 0.2, -0.5);
    aimBone(rig, b.foreR, 0.3, 0.1, -0.85);
    aimBone(rig, b.thighL, -0.3, -0.7, 0.6);
    aimBone(rig, b.shinL, -0.1, -0.5, 0.85);
    aimBone(rig, b.thighR, 0.2, -0.85, -0.4);
    aimBone(rig, b.shinR, 0.15, -0.6, -0.75);
    twistBone(rig, b.head, -0.25, 0, 0);
    rig.settleMuzzle();
    return rig;
  }

  /* --- hips: height, bob, sway, crouch drop -------------------------- */
  const bob = moving ? Math.abs(Math.sin(p * Math.PI * 2)) * (running ? 0.07 : 0.035) : breath * 0.5;
  H.position.copy(rig.rest.get(H).pos).addScaledVector(UP, bob - crouch * 0.28);
  twistBone(rig, H,
    (running ? 0.18 : walking ? 0.05 : 0) + crouch * 0.3 - flinch * 0.28,
    moving ? swing2 * 0.09 : Math.sin(t * 0.7) * 0.02,
    moving ? swing * 0.05 : 0);

  /* --- spine / chest / neck / head ----------------------------------- */
  twistBone(rig, b.spine, crouch * 0.18 - flinch * 0.22, moving ? swing2 * 0.05 : 0, 0);
  twistBone(rig, b.chest,
    breath + crouch * 0.12 - recoil * 0.14 - flinch * 0.16,
    (ctx.aiming ? 0.32 : 0) + (moving ? swing2 * 0.04 : 0),
    0);
  twistBone(rig, b.neck, -breath * 1.5 + (ctx.aiming ? 0.16 : 0), 0, 0);
  twistBone(rig, b.head,
    -0.04 + recoil * 0.2 + (ctx.lookPitch || 0) * 0.4,
    (ctx.aiming ? -0.2 : 0) + Math.sin(t * 0.5) * 0.05,
    Math.sin(t * 0.9) * 0.03);


  /* --- legs ---------------------------------------------------------- */
  if (ctx.airborne) {
    aimBone(rig, b.thighL, 0.15, -0.75, -0.62);
    aimBone(rig, b.shinL, 0.1, -0.55, 0.82);
    aimBone(rig, b.footL, 0, -0.5, 0.86);
    aimBone(rig, b.thighR, -0.1, -0.7, -0.72);
    aimBone(rig, b.shinR, -0.05, -0.45, 0.88);
    aimBone(rig, b.footR, 0, -0.5, 0.86);
  } else if (crouch) {
    aimBone(rig, b.thighL, 0.18, -0.72, -0.66);
    aimBone(rig, b.shinL, 0.12, -0.5, 0.85);
    aimBone(rig, b.footL, 0, -0.55, 0.83);
    aimBone(rig, b.thighR, -0.18, -0.72, 0.66);
    aimBone(rig, b.shinR, -0.12, -0.5, -0.85);
    aimBone(rig, b.footR, 0, -0.55, -0.83);
  } else if (moving) {
    const amp = running ? 0.62 : 0.42;
    aimBone(rig, b.thighL, 0.06, -0.94, -swing * amp);
    aimBone(rig, b.shinL, 0, -0.86, Math.max(0, -swing2) * amp * 1.1 + 0.12);
    aimBone(rig, b.footL, 0, -0.8, swing * 0.24 + 0.18);
    aimBone(rig, b.thighR, -0.06, -0.94, -swing2 * amp);
    aimBone(rig, b.shinR, 0, -0.86, Math.max(0, -swing) * amp * 1.1 + 0.12);
    aimBone(rig, b.footR, 0, -0.8, swing2 * 0.24 + 0.18);
  } else {
    aimBone(rig, b.thighL, 0.04, -0.99, 0.02);
    aimBone(rig, b.shinL, 0, -0.98, 0.06);
    aimBone(rig, b.footL, 0, -0.85, 0.3);
    aimBone(rig, b.thighR, -0.04, -0.99, -0.02);
    aimBone(rig, b.shinR, 0, -0.98, -0.06);
    aimBone(rig, b.footR, 0, -0.85, -0.3);
  }

  /* --- arms ---------------------------------------------------------- */
  if (ctx.aiming || ctx.firing || recoil > 0.05) {
    // Rifle-ready: right arm forward, left hand crossing over to support, and
    // a fast kick on the recoil impulse so firing reads at a glance.
    const kick = recoil * 0.3;
    aimBone(rig, b.armR, 0.24 + kick, -0.12, -0.96);
    aimBone(rig, b.foreR, 0.1, -0.2, -0.97);
    aimBone(rig, b.armL, -0.34, -0.3, -0.89);
    aimBone(rig, b.foreL, -0.05, -0.35, -0.93);
  } else if (ctx.emote && rig.emoteT > 0) {
    const w = Math.sin(t * 7) * 0.3;
    aimBone(rig, b.armR, 0.5, 0.75, -0.3);
    aimBone(rig, b.foreR, 0.3, 0.4, -0.8);
    aimBone(rig, b.armL, -0.2, -0.95, 0.1);
    aimBone(rig, b.foreL, -0.1, -0.9, 0.3);
    twistBone(rig, b.head, 0, w * 0.2, 0);
    rig.emoteT = Math.max(0, rig.emoteT - dt);
  } else {
    // Natural carriage, arms swinging opposite the legs.
    const amp = moving ? (running ? 0.7 : 0.45) : 0;
    const sway = Math.sin(t * 1.3) * 0.05;
    twistBone(rig, b.clavicleL, 0, 0, 0.04 + crouch * 0.1);
    twistBone(rig, b.clavicleR, 0, 0, -0.04 - crouch * 0.1);
    aimBone(rig, b.armL, -0.3 - flinch * 0.3, -0.94 + sway, swing * amp);
    aimBone(rig, b.foreL, -0.22, -0.86, -0.3 + swing * amp * 0.5);
    aimBone(rig, b.armR, 0.3 - flinch * 0.3, -0.94 - sway, -swing * amp);
    aimBone(rig, b.foreR, 0.22, -0.86, 0.3 - swing * amp * 0.5);
  }

  rig.settleMuzzle();
  return rig;
}
