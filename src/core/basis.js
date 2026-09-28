import * as THREE from 'three';

export const UP = new THREE.Vector3(0, 1, 0);

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

/**
 * Planar move frame read from an object whose -Z is forward.
 * right = forward × up. For fwd (0,0,-1) that is (1,0,0).
 * Returns the shared scratch vectors — copy them before the next call.
 */
export function planarBasis(object) {
  object.getWorldDirection(_fwd);
  // Camera.getWorldDirection already returns local -Z. Other objects return +Z.
  if (!object.isCamera) _fwd.negate();
  _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, -1);
  else _fwd.normalize();
  _right.set(-_fwd.z, 0, _fwd.x);
  return { forward: _fwd, right: _right };
}

/** Yaw that points an object's local -Z along a planar direction. */
export function yawForDirection(x, z) {
  return Math.atan2(-x, -z);
}

/**
 * Screen bearing of a planar direction, relative to a camera yaw.
 * 0 means dead ahead, +PI/2 means to the camera's right, wrapped to (-PI, PI].
 * Shared by the compass, the POI labels and the directional hit indicators so
 * all three agree on what "to the right" means.
 */
export function screenBearing(dirX, dirZ, yaw) {
  let a = Math.atan2(-dirX, -dirZ) - yaw;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  // atan2 hands back -PI for "directly behind" (signed zero in the x term);
  // fold it up so the range is always (-PI, PI].
  if (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/** Bearing from a world point to a target, relative to a camera yaw. */
export function bearingTo(px, pz, tx, tz, yaw) {
  return screenBearing(tx - px, tz - pz, yaw);
}

export function selfTestBasis() {
  const errors = [];
  const cam = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  cam.position.set(0, 1.6, 5);
  cam.lookAt(0, 1.6, 0);
  cam.updateMatrixWorld(true);
  const { forward, right } = planarBasis(cam);
  if (forward.distanceTo(new THREE.Vector3(0, 0, -1)) > 1e-3) {
    errors.push(`forward ${forward.toArray()} expected 0,0,-1`);
  }
  if (right.distanceTo(new THREE.Vector3(1, 0, 0)) > 1e-3) {
    errors.push(`right ${right.toArray()} expected 1,0,0`);
  }
  const expect = (x, z, yaw) => {
    const o = new THREE.Object3D();
    o.rotation.y = yawForDirection(x, z);
    o.updateMatrixWorld(true);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(o.quaternion);
    const want = new THREE.Vector3(x, 0, z).normalize();
    if (f.distanceTo(want) > 1e-3) errors.push(`yaw ${x},${z} faced ${f.toArray()}`);
    let yawDelta = yawForDirection(x, z) - yaw;
    while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    if (Math.abs(yawDelta) > 1e-4) errors.push(`yaw value ${x},${z}`);
  };
  expect(0, -1, 0);
  expect(1, 0, -Math.PI / 2);
  expect(-1, 0, Math.PI / 2);
  expect(0, 1, Math.PI);
  return errors;
}
