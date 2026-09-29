# GAMEDEV.md — Bikini Royal Waifus

Living notes for whoever (human or AI) touches this build next. Read this first.
Keep it short, keep it true, update it when you learn something.

## 0. What this is
A browser third-person battle royale (three.js r170 + Vite), anime / noir cherry-blossom / art-deco look, 50 players (you + 49 bots), one 400 m island ("Blossom City", six districts). Runs at `npm run dev` → http://localhost:5173.

- `src/world/blossomCity.js` — the default map. `sakuraIsle.js` (floating islands) and `map.js` (classic island) are older maps behind `?map=sakura` / `?map=island`.
- `src/game/match.js` — the whole match (phases, player, bots glue, zone, loot, camera). Big; read the section you need, not the file.
- `src/avatar/glbWaifu.js` — every GLB character: loading, clip picking, retargeting, jiggle, weapon attach.
- `src/avatar/retarget.js` — moves the shared animation set onto any humanoid skeleton.
- `src/ui/shell.js` + `src/style.css` — DOM HUD and menus. The noir/deco theme is the *last* block of `style.css`; later blocks override earlier ones.

## 1. Commands
| | |
|---|---|
| `npm run dev` | dev server (port 5173, `start.bat` also works) |
| `npm test` | headless suite: smoke, kit, rig, inventory, map probes. **Run before every commit.** |
| `node tools/tour.mjs 5173 tour` | real-GPU flythrough: bus shot, HD map, six district shots, six ground shots, fps per spot |
| `node tools/shot-realtime.mjs 5173 rt 60` | real-time run from splash to landing, one PNG per 4 s |
| `node tools/shot-menu.mjs 5173 out.png` | menu screenshot (`NOBOOT=1` for splash) |
| `node tools/shot-glb.mjs out.png a,b,c` | render `/assets/hf/<name>.glb` side by side (needs `public/viewer.html`) |
| `node tools/probe-city.mjs` | loot/collision validator for Blossom City |

Screenshot tools drive Brave/Edge through `puppeteer-core` with the real GPU (`--use-angle=d3d11`). The old SwiftShader probes are 3 fps and misleading for perf.

## 2. GLB pipeline (do it in this order, every time)
1. **Inspect** the file: `node tools/glb-bbox.mjs file.glb` (size), and read its JSON: meshes/prims, triangles, `skins`, `animations`, materials, whether `NORMAL` exists.
2. **Budget** (these are what kept us at 45–80 fps): static prop ≤ 6 k tris, building ≤ 12 k, hero/bot character ≤ 25 k, one material per object where possible, textures ≤ 1024 (512 for props). Anything imported wholesale (e.g. the 230 k-tri shrine, 1230-primitive town) must be reduced first.
3. **Decimate / join**: `node tools/lite-one.mjs in.glb out.glb <tris> [texSize]` (weld → simplify → resize textures to webp → recompute normals). For generated meshes the *weld tolerance* matters: generated meshes are triangle soup, so drop `NORMAL`/`TANGENT` first or nothing collapses (the script does).
4. **Put it in `public/assets/...`** (tracked by Git LFS: `*.glb` is an LFS pattern; the remote has ~1 GB quota, keep additions small).
5. **Register it**: props via `URLS` in `blossomCity.js`; characters via `CHARACTERS` in `src/data/assets.js` (+ `MODELS` in `catalog.js`) or, for VRoid, `public/assets/vrm/manifest.json`.
6. **Place repeated props as instances** (see `put()` in `blossomCity.js`): one `InstancedMesh` per sub-mesh per 70 m cell. Never `kit.put` a prop more than a handful of times. This alone took a district from 1900 draw calls to ~500.
7. **Verify with a picture**: `tools/tour.mjs`, look at the screenshot. Do not trust "no console errors".

### Things that will bite you
- **Generated (image-to-3D) meshes have no normals** → lit pure black. `map.js` `baseFor()` welds and computes normals; keep that.
- **Meshy/SAM textures + toon lighting blow out** to white: multiply colour by ~0.78 and drop emissive when a map is present (`toonify`).
- **`Box3.setFromObject(skinned)` uses the bind pose** unless you pass `true` (precise). `normalizeScene` does; a wrong box puts the model 7 m off the origin.
- **Some exports bake a root offset into their clips** (Mai stood 3.8 m away when "Standby" played). `glbWaifu` re-centres on the *posed* bounds after the first mixer tick.
- **Cloned skinned meshes share materials.** Anything per-instance (jiggle uniforms) must clone materials.
- **An `AnimationMixer` with no action running = T-pose.** Always have a fallback clip playing (`glbWaifu` does `playClip('idle')` if nothing is).
- A model that lists only a stand-still clip (`Standby`) will slide when it moves. Pick models with locomotion clips or retarget.
- `THREE.OutlineEffect` (cel outlines) roughly doubles draw calls; it is the single most expensive visual switch. `window.__brOutlines(false)` toggles it for profiling.
- Sky sphere must follow the camera and be < camera.far, or a black polygon appears when you stand near the map edge (this cost a long debugging session).

## 3. Animation pipeline
- **One shared animation set**: `public/assets/anims/ual.glb` (34 clips, 0.5 MB, skeleton + tracks only) built with `node tools/extract-anims.mjs <UAL-rigged glb> out.glb "ClipA,ClipB,…"`. Clip *names* matter: `glbWaifu` picks by exact name (`PICK` table): `Idle_A/Idle_Loop`, `Pistol_Idle`, `Pistol_Aim_Neutral`, `Pistol_Shoot`, `Pistol_Reload`, `Walk`, `Jog`, `Sprint`, `Crouch_*`, `Jump_*`, `Death_A`, `Hit_Chest`, `Consume_Item`, `Dance_*`, `Victory`, `Glide`, `Strafe_*`, `Walk_Backwards`.
- **Any humanoid can use them** through `retarget.js`: for every frame it measures each source bone's rotation *relative to its rest pose in world axes*, applies it on the target's rest pose, converts back to local rotations, scales hip translation by the hip-height ratio, and finally forces the chest to face +Z at frame 0 (fixes rest-pose disagreements). Mapping tables: `UAL_MAP` (Meshy/Mixamo-style names), `vrmRetargetSetup()` (VRM humanoid).
- Auto-rigs (Meshy `3d_rigging`, 5 credits) give a 24-bone Mixamo-like skeleton and *no* animation worth using — retarget instead of paying per clip.
- VRM (VRoid) characters: real VRM for the player/menu (spring bones = hair/skirt/bust physics, `vrm.update(dt)`, `autoUpdateHumanBones=false` because we drive raw bones), plain clone for bots.
- **Jiggle**: `src/avatar/jiggle.js` — springs on the CPU, displacement in the vertex shader from a bind-pose mask around chest and hips. Works on any skinned mesh; skip it for MToon (VRM) materials.
- **Facing**: the whole cast faces +Z in the model, `normalizeScene(..., {faceCamera:true})` turns them to the game's −Z forward.

## 4. Performance rules (measured on an RTX 4050 laptop)
- Target 60 fps at 1600×900 with outlines. Current worst spot (downtown) ≈ 45 fps.
- Cull far bots: past 135 m their avatars are hidden and not animated.
- Shadow casters: only buildings/towers (`SHADOW_KEYS`). Trees/props do not cast. Sun shadow follows the player (`world.followSun`).
- Terrain is one 236² vertex-coloured mesh sampling the same height function as collision. Do not add per-vertex work.
- Bots: 49 of them each raycast for line of sight against ~250 collision boxes. If you raise the bot count, throttle `think`.
- `renderer.setPixelRatio(min(dpr, 2))`.

## 5. Gameplay / camera lessons
- The game is **third-person over the shoulder**. Anything that used the *camera* as the player's eye (pickups, aim assist, grenades) must use `eye` — the boom camera is 3 m behind. (Pickups silently broke for a day; there is now a smoke test.)
- Camera boom shortens against collision boxes, min 0.4 of full length.
- Emote must never toggle `inspect` (it locked players permanently in the orbit camera).
- Loading, lobby and bus are also third person now; the first-person viewmodel is only for graybox/range.
- Match profile (`world.profile`) carries zone radius/center, bus route/time, ocean limit, minimap radius, bot district spread. A new map only needs to return one.
- Controls: keyboard legend and pad legend are always on screen (`#hints`); every weapon/item slot shows its button (`.keycap`). Pad: RT fire, LT aim, A jump, B crouch/slide, X reload/pick up, Y swap gun, LB melee, RB dash, L3 sprint, R3 ability, Back = map+bag, D-pad up/down items, D-pad right use item, D-pad left emote.

## 6. UI / look
- Theme: noir black `#08080b`, gold `#c9a45a`, blossom pink `#e58fa8`, Josefin Sans + Limelight. Stepped-corner "deco" clip-path, double gold hairline (inset box-shadows).
- The first attempts looked like generic "AI neon". What fixed it: one accent colour, no glow, no rounded corners, no scanlines, real key-art on splash/loading.
- HD map: canvas `#bigmap` drawn from a 2048² orthographic render of the world (`buildMapImage`), north-up, zone circle + districts + player arrow.

## 7. Higgsfield (asset generation) notes
- Cheap: images with `z_image` 0.15 cr, SAM-3D 1 cr, TTS line 0.1 cr. Expensive: Meshy textured+rigged 35 cr; rigging an existing mesh 5 cr.
- SAM 3D **needs `detection_threshold: 0.2` and a prompt** or it fails; submit ≤ 3–4 at a time (rate limits, 429).
- Prompt style that works for props: "stylized anime cel-shaded 3D game asset, single X, centered, plain pure white background, three-quarter view, clean flat colors, soft ink outlines, no ground shadow".
- SAM output quality: props good, **characters bad** (holes, mangled faces). Do not spend rig credits on them. Use VRoid/VRM characters instead.
- The image model's safety filter blocks some swimwear prompts ("nsfw"): keep prompts tasteful; the game is 18+ but assets here stay non-explicit.
- Voice lines: `seed_audio` with a preset voice; wav files live in `public/assets/audio/voice/pixie_<event>_<n>.wav`, mapped in `src/data/audioFiles.js` (`VOICE`) and rate-limited per event in `audio.js`.

## 8. Do / Don't
**Do**
- Run `npm test` and one `tools/tour.mjs` before committing; commit small, push to `master`.
- Look at a screenshot after every visual change. Sketch coordinates with the free-cam (`window.__brFreeCam(eye, target)`).
- Keep loot ≥ 8 chests + 16 floor items per district (probe enforces it).
- Prefer instancing, decimation, and culling over adding hardware-dependent effects.
- Put explanations of non-obvious bugs in code comments where they happened, and a line here.

**Don't**
- Don't add first-person-camera-based logic. Don't call `renderer.render` directly (use `outline.render`).
- Don't `git add -A` blindly: `hf-concepts/`, screenshots, `dist/`, logs are ignored on purpose; the raw 430 MB `environment assets/` folder is source art, never commit it.
- Don't load env GLBs from `public/assets/env` straight into the map when a `env-lite` version exists.
- Don't heredoc multi-line Python with quotes in a single bash call that also contains a second heredoc — the shell tool mis-parses it; write a script file instead.
- Don't trust a headless SwiftShader fps number.

## 9. Backlog (ranked)
1. Real VRoid/VRM characters for player + bots (pipeline is in; needs `.vrm` files + manifest entries). Current bots are all one chibi model.
2. Bot AI: loot before fighting, use cover, heal, rotate with the storm, third-party fights.
3. Walkable interiors from the "full room" GLBs (loft interior) with loot rooms.
4. Weapon feel: per-gun muzzle flash VFX, shell ejection, hit-flash on bots, kill-cam.
5. Restyle locker / armory / settings / pause in the noir-deco theme; loading screens à la Wuthering Waves (key art + tips + progress).
6. Gliding: parachute canopy model over the player (asset generated, not wired).
7. Sound: real music for lobby/match, footsteps by surface, positional gunfire.

## 10. Session log (newest first)
- Retargeting engine, VRM path, jet drop ship, voice lines, 50 players, HD map, compass heading.
- Blossom City map (400 m, six districts, instancing, decimated assets, outlines), Higgsfield props.
- Third-person camera, gun feel audio, noir/deco HUD, splash/loading art.
