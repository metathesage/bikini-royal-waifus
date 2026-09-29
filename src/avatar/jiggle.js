import * as THREE from 'three';

/**
 * Soft-body jiggle for the chest and hips of any rigged character.
 *
 * The auto-rigs have no bust or hip bones, so instead of driving bones the
 * vertices themselves are nudged in the vertex shader. Two damped springs
 * (vertical bounce and forward/back sway) are simulated on the CPU from the
 * character's motion, and the shader applies them, weighted by a smooth mask
 * around the chest and the hips, on top of whatever the skeleton is doing.
 *
 * It works on the *bind-pose* position of each vertex to decide where the mask
 * is, so it is independent of the animation and of which model it is.
 */

function makeSpring(k, c) {
  return { x: 0, v: 0, k, c };
}
function step(sp, force, dt) {
  const a = force - sp.k * sp.x - sp.c * sp.v;
  sp.v += a * dt;
  sp.x += sp.v * dt;
  if (sp.x > 1.6) { sp.x = 1.6; sp.v = 0; }
  if (sp.x < -1.6) { sp.x = -1.6; sp.v = 0; }
}

/**
 * @param {THREE.Object3D} root model root (materials are cloned per instance)
 * @param {{bust?: number, amp?: number}} opts
 */
export function addJiggle(root, opts = {}) {
  const amp = opts.amp ?? 1;
  const inflate = opts.bust ?? 1;
  // Bind-pose bounds of the skinned meshes, in geometry units.
  const box = new THREE.Box3();
  const skinned = [];
  root.traverse((o) => {
    if (o.isSkinnedMesh && o.geometry) {
      o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox);
      skinned.push(o);
    }
  });
  if (!skinned.length) return null;
  const size = box.getSize(new THREE.Vector3());
  const H = size.y;
  const uniforms = {
    uJig: { value: new THREE.Vector4(0, 0, 0, 0) },        // chest y, chest z, hip y, hip z (fractions of H)
    uChest: { value: new THREE.Vector4(0, box.min.y + H * 0.7, box.min.z, box.max.z) },
    uScale: { value: new THREE.Vector4(H * 0.03, H * 0.055, H * 0.19, inflate) },
  };
  uniforms.uChest.value.x = (box.min.x + box.max.x) / 2;

  for (const mesh of skinned) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = mats.map((m) => {
      const c = m.clone();
      c.onBeforeCompile = (shader) => {
        shader.uniforms.uJig = uniforms.uJig;
        shader.uniforms.uChest = uniforms.uChest;
        shader.uniforms.uScale = uniforms.uScale;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
            uniform vec4 uJig; uniform vec4 uChest; uniform vec4 uScale;`)
          .replace('#include <skinning_vertex>', `#include <skinning_vertex>
            {
              // Bind-pose position decides where on the body this vertex sits.
              float H = uScale.y / 0.055;
              vec3 bp = position;
              float front = smoothstep(uChest.z, uChest.z + (uChest.w - uChest.z) * 0.55, bp.z);
              // Chest: two lobes either side of the sternum.
              float lx = abs(bp.x - uChest.x);
              float lobe = smoothstep(uScale.y * 2.6, uScale.y * 0.6, abs(lx - uScale.y));
              float cy = smoothstep(uScale.z, 0.0, abs(bp.y - uChest.y));
              float chest = lobe * cy * front;
              // Hips and backside.
              float hy = uChest.y - H * 0.24;
              float hipMask = smoothstep(H * 0.11, 0.0, abs(bp.y - hy)) * smoothstep(H * 0.2, H * 0.03, lx);
              float back = 1.0 - front;
              float hip = hipMask * (0.4 + 0.6 * back);
              transformed.y += (uJig.x * chest * uScale.x) + (uJig.z * hip * uScale.x * 0.8);
              transformed.z += (uJig.y * chest * uScale.x * 0.8) + (uJig.w * hip * uScale.x * 0.5);
              transformed += objectNormal * (chest * (uScale.w - 1.0) * uScale.x * 1.4);
            }`);
      };
      c.customProgramCacheKey = () => 'jiggle-v1';
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  }

  const chestY = makeSpring(140, 7);
  const chestZ = makeSpring(110, 6);
  const hipY = makeSpring(90, 7);
  const hipZ = makeSpring(80, 6);
  let prevVy = 0;
  let prevSpeed = 0;
  let t = 0;
  return {
    /** `ctx` needs speed and vy; `gain` is the player's jiggle slider (0..1.8). */
    update(dt, speed, vy, gain = 1, bounce = 0) {
      dt = Math.min(dt, 0.033);
      t += dt;
      const ay = (vy - prevVy) / Math.max(dt, 1e-3);
      const ax = (speed - prevSpeed) / Math.max(dt, 1e-3);
      prevVy = vy;
      prevSpeed = speed;
      // Stride bounce while running: the chest lags the body by a fraction of a step.
      const stride = speed > 0.5 ? Math.sin(t * (speed > 5 ? 15 : 9)) * Math.min(1, speed / 6) * 26 : 0;
      const g = gain * amp;
      step(chestY, (-ay * 0.05 + stride + bounce * 30) * g, dt);
      step(chestZ, (-ax * 0.9 + stride * 0.35) * g, dt);
      step(hipY, (-ay * 0.035 + stride * 0.7) * g, dt);
      step(hipZ, (-ax * 0.7) * g, dt);
      uniforms.uJig.value.set(chestY.x, chestZ.x, hipY.x, hipZ.x);
    },
    dispose() { for (const m of skinned) m.material = m.material; },
  };
}
