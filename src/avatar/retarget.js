import * as THREE from 'three';

/**
 * Retarget animation clips from the UAL skeleton (Sofia / the Universal Animation
 * Library naming) onto any humanoid rigged with Mixamo-style names, such as the
 * Meshy auto-rigs.
 *
 * The two skeletons have different bone axes and rest poses, so local rotations
 * cannot be copied across. Instead, for every frame each source bone's rotation
 * *relative to its own rest pose* is measured in a shared skeleton frame and
 * applied on top of the target bone's rest pose in that same frame, then turned
 * back into a local rotation through the target's parent chain. The hips carry
 * the root translation, scaled by the ratio of the two hip heights so a short
 * body does not skate.
 */

/** target bone name -> source bone name. Order matters: parents before children. */
export const UAL_MAP = [
  ['Hips', 'pelvis'],
  ['Spine02', 'spine_01'], ['Spine01', 'spine_02'], ['Spine', 'spine_03'],
  ['neck', 'neck_01'], ['Head', 'head'],
  ['LeftShoulder', 'clavicle_l'], ['LeftArm', 'upperarm_l'], ['LeftForeArm', 'lowerarm_l'], ['LeftHand', 'hand_l'],
  ['RightShoulder', 'clavicle_r'], ['RightArm', 'upperarm_r'], ['RightForeArm', 'lowerarm_r'], ['RightHand', 'hand_r'],
  ['LeftUpLeg', 'thigh_l'], ['LeftLeg', 'calf_l'], ['LeftFoot', 'foot_l'], ['LeftToeBase', 'ball_l'],
  ['RightUpLeg', 'thigh_r'], ['RightLeg', 'calf_r'], ['RightFoot', 'foot_r'], ['RightToeBase', 'ball_r'],
];

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** World orientation of `o` expressed in the frame of `frameQ` (the inverse of the root's world rotation). */
function frameQuat(o, frameInv, out) {
  o.getWorldQuaternion(out);
  return out.premultiply(frameInv);
}

/**
 * @param {THREE.Object3D} targetRoot the rigged model, already placed and normalised
 * @param {THREE.Object3D} sourceRoot the animation skeleton (nodes only)
 * @param {THREE.AnimationClip[]} clips source clips
 * @param {Array<[string,string]>} map
 * @param {number} fps sampling rate
 */
export function retargetClips(targetRoot, sourceRoot, clips, map = UAL_MAP, fps = 24) {
  targetRoot.updateMatrixWorld(true);
  sourceRoot.updateMatrixWorld(true);

  const pairs = [];
  for (const [tn, sn] of map) {
    const t = targetRoot.getObjectByName(tn);
    const s = sourceRoot.getObjectByName(sn);
    if (t && s) pairs.push({ t, s });
  }
  if (!pairs.length || pairs[0].t.name !== 'Hips') return [];

  const tFrameInv = targetRoot.getWorldQuaternion(new THREE.Quaternion()).invert();
  // Source bones are measured relative to the animation's own root node, so the clip's
  // heading (root rotation / root motion) never leaks into the pose.
  const sRoot = sourceRoot.getObjectByName('root') || sourceRoot;
  const sRestQ = sRoot.getWorldQuaternion(new THREE.Quaternion());
  const sFrameInv = new THREE.Quaternion(); // identity: bind is measured in world axes

  // Rest poses.
  for (const p of pairs) {
    p.sBind = frameQuat(p.s, sFrameInv, new THREE.Quaternion());
    p.sBindInv = p.sBind.clone().invert();
    p.tBind = frameQuat(p.t, tFrameInv, new THREE.Quaternion());
  }
  const hips = pairs[0];
  const feetY = (root, names) => names.reduce((acc, n) => acc + root.getObjectByName(n).getWorldPosition(_v).y, 0) / names.length;
  const tHipsH = hips.t.getWorldPosition(_v).y - feetY(targetRoot, ['LeftFoot', 'RightFoot']);
  const sHipsH = hips.s.getWorldPosition(_v).y - feetY(sourceRoot, ['foot_l', 'foot_r']);
  const ratio = tHipsH / Math.max(0.01, sHipsH);
  const tRootQ = targetRoot.getWorldQuaternion(new THREE.Quaternion());
  const relPos = (o, out) => sRoot.worldToLocal(o.getWorldPosition(out)).applyQuaternion(sRestQ);
  const sHipsBindPos = relPos(hips.s, new THREE.Vector3());
  const tHipsBindWorld = hips.t.getWorldPosition(new THREE.Vector3());
  const tBindLocalPos = hips.t.position.clone();

  // Rest world orientation of every target bone in the chain (for unmapped ancestors).
  const tParentBind = new Map();
  for (const p of pairs) tParentBind.set(p.t, p.t.parent);

  const latRest = (() => {
    const l = targetRoot.getObjectByName('LeftArm'); const r = targetRoot.getObjectByName('RightArm');
    if (!l || !r) return null;
    return l.getWorldPosition(new THREE.Vector3()).sub(r.getWorldPosition(new THREE.Vector3())).applyQuaternion(tFrameInv).setY(0).normalize();
  })();
  const spinePair = pairs.find((p) => p.t.name === 'Spine');
  const restore = new Map();
  sourceRoot.traverse((o) => restore.set(o, [o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  const out = [];
  for (const clip of clips) {
    const mixer = new THREE.AnimationMixer(sourceRoot);
    const action = mixer.clipAction(clip);
    action.play();
    const frames = Math.max(2, Math.ceil(clip.duration * fps) + 1);
    const yawFix = new THREE.Quaternion();
    const times = new Float32Array(frames);
    const quatVals = pairs.map(() => new Float32Array(frames * 4));
    const posVals = new Float32Array(frames * 3);

    for (let f = 0; f < frames; f++) {
      const time = Math.min(clip.duration, f / fps);
      times[f] = time;
      mixer.setTime(time);
      sourceRoot.updateMatrixWorld(true);
      // World rotation of each mapped target bone this frame, in the target frame.
      const worldRel = new Map();
      pairs.forEach((p, i) => {
        // Undo the root's animated turn (its rotation away from rest), keeping world axes.
        sRoot.getWorldQuaternion(_q2).invert().premultiply(sRestQ);
        frameQuat(p.s, _q2, _q);
        _q.multiply(p.sBindInv);                    // ... minus its rest pose: pure delta (frame space)
        // Delta acts in the shared skeleton frame: pre-multiply onto the target rest orientation.
        const tw = _q2.copy(_q).multiply(p.tBind);
        worldRel.set(p.t, tw.clone());
      });
      // Calibrate heading: at the first frame make the posed chest face +Z in the skeleton frame,
      // whatever the two skeletons' rest orientations disagree about.
      if (f === 0) {
        yawFix.identity();
        if (latRest && spinePair && !/death|roll|slide|fall/i.test(clip.name)) {
          const dq = worldRel.get(spinePair.t).clone().multiply(spinePair.tBind.clone().invert());
          const lat = latRest.clone().applyQuaternion(dq).setY(0).normalize();
          const fwd = new THREE.Vector3().crossVectors(lat, new THREE.Vector3(0, 1, 0));
          yawFix.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(fwd.x, fwd.z));
        }
      }
      for (const [k, v] of worldRel) worldRel.set(k, v.premultiply(yawFix));
      // Convert to local rotations through the target's parent chain.
      pairs.forEach((p, i) => {
        // Parent world in frame: nearest ancestor that we drove this frame, else its rest world.
        let parentQ = null;
        let anc = p.t.parent;
        const chain = [];
        while (anc && anc !== targetRoot && !worldRel.has(anc)) { chain.unshift(anc); anc = anc.parent; }
        if (anc && worldRel.has(anc)) {
          parentQ = worldRel.get(anc).clone();
          for (const c of chain) parentQ.multiply(c.quaternion);
        } else {
          parentQ = new THREE.Quaternion();
          const cur = p.t.parent;
          if (cur) frameQuat(cur, tFrameInv, parentQ);
        }
        const local = parentQ.invert().multiply(worldRel.get(p.t));
        local.toArray(quatVals[i], f * 4);
      });
      // Hips translation: source displacement from rest, scaled, in the target's parent space.
      relPos(hips.s, _v).sub(sHipsBindPos).multiplyScalar(ratio);
      _v.applyQuaternion(yawFix);
      _v.applyQuaternion(tRootQ);
      _v2.copy(tHipsBindWorld).add(_v);
      const parent = hips.t.parent;
      parent.updateMatrixWorld(true);
      parent.worldToLocal(_v2);
      _v2.toArray(posVals, f * 3);
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(sourceRoot);

    const tracks = pairs.map((p, i) => new THREE.QuaternionKeyframeTrack(`${p.t.name}.quaternion`, times, quatVals[i]));
    tracks.push(new THREE.VectorKeyframeTrack(`${hips.t.name}.position`, times, posVals));
    out.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  void tBindLocalPos;
  // Put the skeleton back at rest so the caller's first frame is not mid-clip.
  for (const [o, [p, q, sc]] of restore) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(sc); }
  sourceRoot.updateMatrixWorld(true);
  return out;
}
