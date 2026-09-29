import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

/**
 * VRM (VRoid) characters.
 *
 * VRoid Studio exports anime-style humanoids with MToon shading and spring
 * bones (hair, skirt and bust physics). Two ways in are supported:
 *   - `loadVrmFull`: the real thing, with spring bones, for the player and the menu.
 *   - `vrmBoneNames`: read the humanoid table out of any loaded VRM so a plain,
 *     clonable copy (used for the crowd of bots) can be animated too.
 */

/** humanoid bone -> node name, for VRM 0.x and 1.0 files loaded by a plain GLTFLoader. */
export function vrmBoneNames(gltf) {
  const json = gltf.parser.json;
  const nodes = json.nodes || [];
  const sanitize = (n) => THREE.PropertyBinding.sanitizeNodeName(n || '');
  const out = {};
  const v1 = json.extensions && json.extensions.VRMC_vrm && json.extensions.VRMC_vrm.humanoid;
  const v0 = json.extensions && json.extensions.VRM && json.extensions.VRM.humanoid;
  if (v1 && v1.humanBones) {
    for (const [bone, v] of Object.entries(v1.humanBones)) out[bone] = sanitize(nodes[v.node] && nodes[v.node].name);
  } else if (v0 && v0.humanBones) {
    for (const hb of v0.humanBones) out[hb.bone] = sanitize(nodes[hb.node] && nodes[hb.node].name);
    // VRM 0.x calls toes "leftToes"; some exporters use "leftToe".
  }
  return (bone) => out[bone] || null;
}

/** True when the file carries a VRM humanoid table. */
export function isVrm(gltf) {
  const e = gltf.parser.json.extensions || {};
  return !!(e.VRMC_vrm || e.VRM);
}

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

/** Load with the VRM plugin (spring bones + MToon). Faces +Z afterwards, like the rest of the cast. */
export async function loadVrmFull(url) {
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  VRMUtils.rotateVRM0(vrm);
  // The clips drive the raw bones directly; normalized bones must not overwrite them.
  vrm.humanoid.autoUpdateHumanBones = false;
  vrm.scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  return { gltf, vrm };
}
