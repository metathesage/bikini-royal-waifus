import * as THREE from 'three';
import { buildWorld, busPosition, heightAt, ISLAND_R, SEA_Y } from '../world/map.js';
import { buildSakuraIsle } from '../world/sakuraIsle.js';
import { buildGraybox } from '../world/graybox.js';
import { createWaifu } from '../avatar/waifu.js';
import { createViewmodel, createWeaponMesh } from '../avatar/viewmodel.js';
import { createFx } from '../vfx/fx.js';
import { createRoster, stepBot, assignBotModels } from './bots.js';
import { planarBasis, yawForDirection, bearingTo } from '../core/basis.js';
import { raySphere, rayAABB, pushOut, floorAt } from './collision.js';
import {
  GUNS, MELEE, ITEMS, CRYSTALS, AMMO, PICK_HEALS,
  falloffDamage, meleeById,
} from './weapons.js';
import {
  createInventory, resetInventory, addItem, removeAt, removeId,
  swapSlots, sortInventory, mergeStacks, stepSelection, occupied,
} from './inventory.js';
import { POIS, rollLook } from '../data/catalog.js';
import { candidateById, abilityTint } from '../data/candidates.js';
import { WEAPON_GLB, MODULAR_FBX, ITEM_GLB, loadGltf, loadFbx, instanceOf, fitToFootprint } from '../data/assets.js';

/** How long a range target stays down before it stands back up. */
const RANGE_RESPAWN = 0.9;
/** How long the HUD holds a "target down" callout. */
const RANGE_CALLOUT = 1.1;
const ZONE_PLAN = [
  { wait: 25, shrink: 35, to: 42 },
  { wait: 30, shrink: 30, to: 28 },
  { wait: 25, shrink: 25, to: 17 },
  { wait: 20, shrink: 20, to: 8 },
  { wait: 15, shrink: 20, to: 0 },
];
const ZONE_DPS = [2, 4, 8, 12, 20];
const LOBBY_TIME = 5;
const BUS_TIME = 15;
/**
 * Hold on the ship, all together, while this counts down before the route runs.
 *
 * A separate clock from the flight rather than a lead-in to it, because the two
 * need different rules. During the hold the player is parked on the deck and
 * may not leave, and the ship has to sit still, so that "everyone is on the
 * ship" is a thing you can actually see. Folding the countdown into clock.bus
 * meant the ship began crawling before the number reached one, which read as a
 * stutter rather than as a launch.
 */
const INTRO_TIME = 10;
/** Minimum seconds between directional hit indicators, so sustained fire pulses. */
const HURT_FX_MIN_GAP = 0.13;
/** How long the loading bar waits on environment dressing before moving on. */
const WORLD_LOAD_GRACE_MS = 3500;

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _to = new THREE.Vector3();

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

/** Small deterministic PRNG, so a dummy's look is stable across reloads. */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d6d79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createMatch({ getSettings, audio, getLook, renderer = null, map = 'sakura' }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(78, 1, 0.08, 480);
  const cine = new THREE.PerspectiveCamera(42, 1, 0.1, 480);

  const rig = new THREE.Group();
  const yawPivot = new THREE.Group();
  const eye = new THREE.Group();
  const pitchPivot = new THREE.Group();
  rig.add(yawPivot);
  yawPivot.add(eye);
  eye.add(pitchPivot);
  pitchPivot.add(camera);
  scene.add(rig);

  const viewmodel = createViewmodel();
  /**
   * Where the first-person body sits, in metres from the eye.
   *
   * The weapon's screen framing is decided by the mount inside viewmodel.js;
   * this offset is about the *body*, and the two are deliberately independent
   * (see the comment on `mount` there). The body belongs low and back, showing
   * only the top of the chest, so the aim picture is never blocked by skin.
   */
  viewmodel.group.position.set(0.06, -0.12, -0.3);
  pitchPivot.add(viewmodel.group);

  let world = null;
  let fx = null;
  let hero = null;
  let heroModel = null;
  let bots = [];
  let pickups = [];
  let chests = [];
  let grenades = [];
  /** Falling decrees waiting on their fuse, e.g. Candidate D's RIMEFALL. */
  let falling = [];
  let supply = [];
  let built = false;
  let buildIndex = 0;
  const events = [];
  let abstractT = 2;
  let dropT = 40;
  let prevFire = false;
  let prevSlot = 0;

  /**
   * Per-shot telemetry and score for the range.
   *
   * On the island a hit is a number that scrolls past in a kill feed and is
   * gone. On a proving ground the number *is* the question: "did that Heartbreaker
   * round do 16, or 12.8 because the dummy was 52m out" cannot be answered by
   * squinting at a target, and falloff is the thing most often tuned by feel and
   * got wrong.
   *
   * The score is the other half of that. A range you only shoot once on is a
   * measurement rig, which is what this used to be, and it is miserable to
 * play: nothing rewards a follow-up shot, so there is no reason to keep the
 * trigger down. Streak, per-lane bookkeeping and a respawn quick enough to
 * stay in a rhythm turn the same numbers into a drill you want to re-run.
   * Only the graybox writes here; the island leaves it untouched.
   */
  const rangeLog = {
    last: null,
    headshots: 0,
    furthest: 0,
    score: 0,
    streak: 0,
    bestStreak: 0,
    /** Hits per lane, keyed by the label the world authored. */
    lanes: {},
    /** Populated on a down-target, so the HUD can call out the drop. */
    downed: null,
  };

  /** Lane multiplier: a far target is worth more, and a headshot more again. */
  function rangeScore(bot, dmg, head) {
    const metres = Math.hypot(bot.pos.x - player.pos.x, bot.pos.z - player.pos.z);
    // 1.0x at the line, 2.0x at 100m — the same weighting as the lane itself, so
    // the number on the panel means "harder shot, more points".
    let pts = Math.round(dmg * (1 + metres / 100));
    if (head) pts = Math.round(pts * 1.5);
    return Math.max(1, pts);
  }

  /** Seconds the range session has been live. Drives every moving target. */
  let rangeTime = 0;
  /** Previous state of the score key, for the drill-reset rising edge. */
  let rangeScoreWasHeld = false;

  /**
   * Wipe the drill: score, streak, per-lane counts and the clock.
   *
   * Deliberately does *not* re-arm the player or stand the targets back up. A
   * reset that also moved you back to the firing line would punish the exact
   * thing the player is iterating on — re-running the same drill a few metres
   * further up the lane — so it clears the numbers and leaves everything else
   * exactly where it is.
   */
  function restartDrill() {
    rangeTime = 0;
    rangeLog.last = null;
    rangeLog.score = 0;
    rangeLog.streak = 0;
    rangeLog.bestStreak = 0;
    rangeLog.headshots = 0;
    rangeLog.furthest = 0;
    rangeLog.lanes = {};
    rangeLog.downed = null;
    emit({ type: 'toast', text: 'Drill reset.' });
  }

  /**
   * Break a run of consecutive hits.
   *
   * A streak has to be breakable or it is not a streak. A miss, a death and a
   * weapon swap all clear it — a swap clears it because a fresh gun has not
   * proven anything yet, and carrying a streak across an A/B of two weapons
   * would make the second weapon look better than it is.
   */
  function breakStreak() {
    if (rangeLog.streak) rangeLog.bestStreak = Math.max(rangeLog.bestStreak, rangeLog.streak);
    rangeLog.streak = 0;
  }

  /**
   * Advance the world's moving targets.
   *
   * The world authors each dummy's base position and an optional `motion`
   * descriptor; this walks the clock and hands the world the resulting position
   * so the hit spheres and the mesh can never disagree. When the world declined
   * to provide `setDummyPos` the dummy still moves logically — the raycast
   * follows `b.pos` — so the feature degrades to "moving but invisible" rather
   * than breaking.
   *
   * A moving dummy's hit spheres follow it because `raycast` reads `b.pos`
   * directly, which is the same reason `syncRigTransform` exists for the player:
   * the position gameplay reads has to be the position the world drew.
   */
  function moveRangeDummies(dt) {
    if (!bots.length) return;
    const setter = typeof world.setDummyPos === 'function' ? world.setDummyPos : null;
    for (const b of bots) {
      if (!b.dummy || !b.motion) continue;
      const m = b.motion;
      const period = m.period > 0.05 ? m.period : 3;
      // A sine, not a sawtooth: a linear sweep makes a target that spends its
      // whole life accelerating then snapping back, which reads as a glitch.
      const t = (rangeTime / period + (m.phase || 0)) * Math.PI * 2;
      const off = Math.sin(t) * m.span;
      if (m.axis === 'y') {
        b.pos.x = b.home.x;
        b.pos.y = b.home.y + off;
        b.pos.z = b.home.z;
      } else {
        b.pos.x = b.home.x + off;
        b.pos.y = b.home.y;
        b.pos.z = b.home.z;
      }
      if (setter) setter(b.dummyIndex, b.pos.x, b.pos.y, b.pos.z);
    }
  }

  const player = {
    pos: new THREE.Vector3(0, 50, 0),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    hp: 100,
    shield: 0,
    knockHp: 100,
    knocked: false,
    alive: true,
    team: 0,
    kills: 0,
    grounded: false,
    coyote: 0,
    buffer: 0,
    airJumps: 0,
    crouch: false,
    slide: 0,
    slideDir: new THREE.Vector3(),
    dashCd: 0,
    /** Signature ability, from the equipped royal candidate (null = none). */
    abilityCd: 0,
    abilityLockSay: 0,
    mantle: null,
    gliding: false,
    // Matches reset(): land with a sidearm and two mags.
    guns: [{ id: 'pistol', mag: GUNS.pistol.mag }, null],
    gunIndex: 0,
    active: 0,
    meleeId: 'katana',
    ammo: { light: GUNS.pistol.mag * 2, medium: 0, heavy: 0, shells: 0 },
    inv: createInventory(),
    itemIndex: 0,
    channel: null,
    reload: 0,
    nextShot: 0,
    bloom: 0,
    recoilP: 0,
    recoilY: 0,
    recoilStep: 0,
    combo: 0,
    comboT: 0,
    meleeBusy: 0,
    buffs: {},
    time: 0,
    local: new THREE.Vector3(0, 0, 1.2),
    shots: 0,
    hits: 0,
    damage: 0,
    revived: 0,
  };

  /**
   * Zone circle. These literals must match what `reset()` restores: the first
   * match of a session is built without a reset, so any drift here means the
   * opening circle is a different size from every later one.
   */
  const zone = { x: 6, z: -4, r: 62, from: 62, phase: 0, mode: 'wait', left: ZONE_PLAN[0].wait, dps: 0 };
  const clock = { phase: 'boot', lobby: LOBBY_TIME, intro: 0, lastCount: 0, bus: 0, match: 0, end: null };
/** Seconds since the drop ship started leaving; negative while it is still docked. */
let ufoDepart = -1;
  const orbit = { theta: 0.6, phi: 1.15, radius: 3.4 };
  let inspect = false;
  let emoteT = 0;
  let trauma = 0;
  let result = null;
  let hurtFxAt = -99;
  let worldProgress = 0;
  let worldReady = false;
  let buildStart = 0;
  let rosterReady = null;
  let rosterDone = false;

  const snap = {
    phase: 'boot', hp: 100, shield: 0, aliveCount: 44, kills: 0,
    prompt: null, items: [], buffs: [], dots: [], compass: [], labels: [],
    invUsed: 0, invCap: 6,
    weaponName: 'Ribbon Katana', weaponKind: 'melee', mag: 0, reserve: 0, spread: 0,
    ads: false, knocked: false, gliding: false, low: false, scope: false,
    zoneText: '', zoneDanger: false, channel: 0, match: 0, lobby: LOBBY_TIME, countdown: 0,
    partner: null, stats: null, result: null, bus: 0, ability: null,
  };

  function emit(e) { events.push(e); }
  function pull() { return events.splice(0, events.length); }

  function look() { return getLook(); }

  function bootRoster() {
    // On the range the roster is replaced by dummies: bots that never think,
    // never move and never shoot back. They share the bot data shape so the
    // raycast, damage and hitmarker paths are the real ones.
    if (world.isGraybox) {
      bots = world.dummies.map(makeDummyBot);
      rosterReady = true;
      rosterDone = true;
      player.meleeId = look().melee || 'katana';
      return;
    }
    bots = createRoster(look().name || 'Yuna');
    // Deal every bot her own rigged body from the PSX roster, and start the
    // manifest fetch. Bots that miss the cut fall back to the procedural body,
    // so a manifest failure degrades rather than breaks the match.
    assignBotModels(bots).then(() => { rosterDone = true; });
    rosterReady = true;
    player.meleeId = look().melee || 'katana';
  }

  /**
   * Turn a graybox dummy into something the combat code accepts.
   *
   * The fields that matter are `pos` and the height: `raycast` builds its body
   * and head spheres from `b.pos` plus a height of 1.7 (or 0.75 when knocked),
   * so a dummy whose height differs needs its own hit geometry. A dummy is
   * marked `dummy: true`, which the bot update skips, and `avatar: null`,
   * which the hurt path already tolerates.
   */
  function makeDummyBot(d, i) {
    return {
      id: 1000 + i,
      name: d.label ? `Target ${d.label}` : `Target ${i + 1}`,
      // Kept as its own field because the range panel groups its per-lane
      // bookkeeping by lane name, and the bot's display name has a "Target "
      // prefix the lanes key does not.
      dummyLabel: d.label || null,
      team: 99 + i,
      ally: null,
      partner: false,
      // rollLook takes a seeded rng, not a seed. Dummies have no avatar, so
      // this look is only ever read for a hair colour in the kill feed, but it
      // has to be a valid look all the same.
      look: rollLook(mulberry(i * 7919 + 13)),
      pos: new THREE.Vector3(d.x, d.y, d.z),
      vel: new THREE.Vector3(),
      yaw: Math.PI,          // facing back up the range, toward the player
      hp: d.hp,
      shield: d.shield,
      knocked: false,
      knockHp: 100,
      alive: true,
      state: 'live',
      dropU: 0,
      poi: { x: d.x, z: d.z },
      gun: 'pistol',
      mag: 0,
      reload: 0,
      shootCd: 0,
      burst: 0,
      revive: 0,
      kills: 0,
      think: 0,
      home: null,
      avatar: null,
      // Read by the bot update to pin the dummy and by nothing else.
      dummy: true,
      dummyHeight: d.h,
      dummyShield: d.shield,
      spawnHp: d.hp,
      spawnShield: d.shield,
      /**
       * Moving-target state. `home` is the authored position the world built the
       * dummy mesh at; `motion` is the world's optional descriptor. Both are read
       * only by the range loop below — the island never sets them, so nothing
       * about the match path changes.
       */
      home: new THREE.Vector3(d.x, d.y, d.z),
      motion: d.motion || null,
      /** Index into world.dummies, for the world's setDummyPos hook. */
      dummyIndex: i,
    };
  }

  /**
   * Put the player on the firing line, full kit, facing downrange.
   *
   * Loaded with every gun and a deep reserve so that reload timing, mag sizes
   * and falloff are all testable without a single trip back to a plinth. The
   * island's two-slot carry rules do not apply here on purpose: swapping
   * weapons mid-range is the fastest possible A/B of two guns.
   */
  function armForRange() {
    player.guns = [{ id: 'ar', mag: GUNS.ar.mag }, { id: 'smg', mag: GUNS.smg.mag }];
    player.gunIndex = 0;
    player.active = 0;
    player.ammo = { light: 999, medium: 999, heavy: 999, shells: 999 };
    player.hp = 100;
    player.shield = 0;
    player.alive = true;
    player.knocked = false;
    player.gliding = false;
    player.bloom = 0;
    player.yaw = 0;           // -Z, straight down the range
    player.pitch = 0;
    player.pos.set(world.spawn.x, world.spawn.y, world.spawn.z);
    player.vel.set(0, 0, 0);
    player.nextShot = 0;
    player.reload = 0;
    // A fresh session is a fresh drill. Carrying the previous run's score and
    // streak across a re-arm would mean the panel opens with a number nobody in
    // this session earned.
    rangeTime = 0;
    rangeLog.last = null;
    rangeLog.score = 0;
    rangeLog.streak = 0;
    rangeLog.bestStreak = 0;
    rangeLog.headshots = 0;
    rangeLog.furthest = 0;
    rangeLog.lanes = {};
    rangeLog.downed = null;
    rangeScoreWasHeld = false;
    syncWeapon();
  }

  function buildStep() {
    if (built) return 1;
    if (buildIndex === 0) {
      buildStart = performance.now();
      world = map === 'graybox' ? buildGraybox(scene, 11, renderer)
        : map === 'sakura' ? buildSakuraIsle(scene, 11, renderer)
          : buildWorld(scene, 11, renderer);
      // The island has a lobby deck that needs a floor to stand on; the graybox
      // is all ground level and has no lobby at all.
      if (world.lobby && world.lobby.userData.box) world.boxes.push(world.lobby.userData.box);
      fx = createFx(scene);
      bootRoster();
      buildHero();
      viewmodel.setLook({ ...look(), _weapon: player.meleeId });
      // The storm ring is a match-mode visual. The range has no zone, so drawing
      // a circle nobody can be caught in would only confuse a read of the HUD.
      if (!world.noZone) makeZoneVisuals();
      buildIndex = 1;
      return 0.05;
    }
    // Environment assets stream in over the network, so report their real
    // progress rather than pretending the island is already dressed. The
    // island is fully playable on its procedural geometry alone, so we only
    // wait briefly — after that the kit keeps landing during the match and a
    // slow or failed download can never trap the player on the loading screen.
    if (buildIndex === 1) {
      worldProgress = world.progress();
      if (worldProgress >= 1 || performance.now() - buildStart > WORLD_LOAD_GRACE_MS) {
        worldReady = true;
        buildIndex = 2;
      } else {
        return 0.05 + 0.4 * worldProgress;
      }
    }
    const botStart = 2;
    // Every bot needs its assigned body before we build avatars, or half the
    // roster would come up on the fallback.
    if (buildIndex === botStart && rosterReady && !rosterDone) return 0.44;
    if (buildIndex < botStart + bots.length) {
      const b = bots[buildIndex - botStart];
      b.avatar = createWaifu(b.look, 'lite');
      b.avatar.attachWeapon(createWeaponMesh(b.gun, b.look.wrap, b.look.charm));
      b.avatar.group.visible = false;
      scene.add(b.avatar.group);
      buildIndex++;
      return 0.45 + 0.5 * ((buildIndex - botStart) / (bots.length + 1));
    }
    if (buildIndex === botStart + bots.length) {
      spawnLoot();
      built = true;
      if (world.isGraybox) {
        // Straight into the range. No lobby to wait out and no bus to ride:
        // both are dead time when the only question is how the gun feels.
        clock.phase = 'play';
        clock.match = 0;
        armForRange();
        emit({ type: 'toast', text: 'Graybox range - dummies are live.' });
        return 1;
      }
      clock.phase = 'lobby';
      placeLobby();
      emit({ type: 'toast', text: 'Sky platform — the drop ship is inbound.' });
      return 1;
    }
    return 1;
  }

  let zoneMesh = null;
  let zoneRing = null;
  /**
   * The storm wall and its ground ring.
   *
   * The wall is `BackSide`, not `DoubleSide`, and that is the whole trick. This
   * is a 250-unit cylinder standing on the island, so every camera ray that
   * looks at the map crosses the wall twice — once entering, once leaving.
   * `DoubleSide` drew both of those faces, so the intended 0.13 tint actually
   * composited to ~0.24 over the entire screen and the island rendered as a
   * dark slab with the city floating in it. Drawing only the far face gives a
   * single layer of tint at the authored strength, which is what the storm is
   * supposed to look like: a purple wall you can see through, not a filter over
   * the whole match.
   */
  function makeZoneVisuals() {
    zoneMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 36, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xc45bff, transparent: true, opacity: 0.13, side: THREE.BackSide, depthWrite: false }),
    );
    scene.add(zoneMesh);
    zoneRing = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1.015, 64),
      new THREE.MeshBasicMaterial({ color: 0xff4fd8, side: THREE.DoubleSide, depthWrite: false }),
    );
    zoneRing.rotation.x = -Math.PI / 2;
    scene.add(zoneRing);
  }

  function spawnLoot() {
    const rng = Math.random;
    for (const a of world.anchors.chests) {
      // Kit chest: crate body + hinged lid, with a glow plate that turns cyan
      // once looted. The glow is immediate; the crate streams in behind it.
      const mesh = world.makeChest();
      mesh.position.set(a.x, a.y, a.z);
      mesh.rotation.y = Math.abs(Math.sin(a.x * 0.7 + a.z * 1.3)) * Math.PI;
      scene.add(mesh);
      chests.push({ ...a, mesh, open: false, setOpen: mesh.userData.setOpen });
    }
    for (const a of world.anchors.floors) {
      // The graybox anchors say what they are. An island anchor says only
      // "something is here", so it rolls for a random pickup instead.
      if (a.gun) addPickup('gun', a.gun, a.x, a.y, a.z);
      else if (a.ammo) addPickup('ammo', a.ammo, a.x, a.y, a.z);
      else {
        const roll = rng();
        if (roll < 0.65) addPickup('gun', rollGun(rng), a.x, a.y, a.z);
        else if (roll < 0.85) addPickup('ammo', rollAmmoType(rng), a.x, a.y, a.z);
        else addPickup('item', PICK_HEALS[Math.floor(rng() * PICK_HEALS.length)], a.x, a.y, a.z);
      }
    }
    for (const a of world.anchors.crystals) addPickup('crystal', a.kind || 'speed', a.x, a.y, a.z);
  }

  function rollGun(rng) {
    const r = rng();
    if (r < 0.24) return 'pistol';
    if (r < 0.5) return 'smg';
    if (r < 0.74) return 'ar';
    if (r < 0.9) return 'shot';
    return 'snip';
  }
  function rollAmmoType(rng) {
    return ['light', 'medium', 'heavy', 'shells'][Math.floor(rng() * 4)];
  }

  /**
   * Library item models, chosen to match what each thing actually is: the
   * thruster pack for speed, the power core for shield regen, the deployable
   * puck for the extra hop, the prism for the loot magnet.
   */
  const CRYSTAL_MODEL = {
    speed: ITEM_GLB.speedPack,
    regen: ITEM_GLB.powerCore,
    jump: ITEM_GLB.shieldPuck,
    magnet: ITEM_GLB.camoPrism,
  };

  /**
   * A ground pickup is a group: a glowing marker (so the spawn is readable the
   * instant it appears) plus the library's own item model once it streams in, at
   * which point the marker retires. `p.mesh` therefore behaves exactly as before
   * for every existing caller.
   */
  function pickupModelUrl(kind, id) {
    if (kind === 'gun') return WEAPON_GLB[id] || null;
    if (kind === 'ammo') return ITEM_GLB.ammoCrate;
    if (kind === 'crystal') return CRYSTAL_MODEL[id] || null;
    if (kind === 'item') {
      if (ITEMS[id]?.kind === 'grenade') return ITEM_GLB.grenade;
      if (ITEMS[id]?.kind === 'shield') return ITEM_GLB.shieldCell;
      return ITEM_GLB.medkit;
    }
    return null;
  }

  function addPickup(kind, id, x, y, z) {
    // An anchor is allowed to omit `y`, meaning "on the ground here" -- and
    // most of the island's floor anchors do exactly that. Reading it as
    // `y + 0.55` without this fallback put those pickups at NaN: the marker
    // was positioned somewhere no camera can see, and the distance test
    // against it was NaN, so the pickup could never be collected. A gun that
    // renders nowhere and cannot be picked up is worse than no gun, because
    // the map looks like it has loot in it.
    const groundY = y == null ? heightAt(x, z) : y;
    const color = kind === 'gun' ? 0xff4f9a : kind === 'crystal' ? new THREE.Color(CRYSTALS[id]?.color || '#fff').getHex() : kind === 'ammo' ? 0xffe566 : 0xb7f6ff;
    const mesh = new THREE.Group();
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(kind === 'gun' ? 0.32 : 0.22, 0), new THREE.MeshBasicMaterial({ color }));
    mesh.add(marker);
    mesh.position.set(x, groundY + 0.55, z);
    scene.add(mesh);
    const url = pickupModelUrl(kind, id);
    if (url) {
      loadGltf(url).then((gltf) => {
        const inst = instanceOf(gltf.scene);
        fitToFootprint(inst, kind === 'gun' ? 0.8 : 0.55);
        inst.position.y = kind === 'gun' ? -0.4 : -0.32;
        inst.rotation.y = Math.random() * Math.PI;
        inst.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = false;
            o.receiveShadow = false;
            if (o.material && 'envMapIntensity' in o.material) o.material.envMapIntensity = 0.5;
          }
        });
        mesh.add(inst);
        marker.visible = false;
      }).catch((e) => console.error('pickup model failed', url, e));
    }
    pickups.push({ kind, id, x, y: groundY, z, mesh, taken: false, spin: Math.random() * 6 });
  }

  function placeLobby() {
    player.pos.set(0, 48.7, 0);
    player.vel.set(0, 0, 0);
    player.yaw = 0;
    player.alive = true;
    player.hp = 100;
    player.shield = 0;
    player.knocked = false;
    player.gliding = false;
    clock.phase = 'lobby';
    clock.lobby = LOBBY_TIME;
    clock.intro = 0;
    clock.lastCount = 0;
    clock.bus = 0;
    clock.match = 0;
    result = null;
    inspect = false;
  }

  function reset() {
    if (!built) return;
    // Land armed: a sidearm and two mags, so the first fight can start at once.
    player.guns = [{ id: 'pistol', mag: GUNS.pistol.mag }, null];
    player.gunIndex = 0;
    player.active = 0;
    player.meleeId = look().melee || 'katana';
    player.ammo = { light: 0, medium: 0, heavy: 0, shells: 0 };
    player.ammo[GUNS.pistol.ammo] += GUNS.pistol.mag * 2;
    resetInventory(player.inv);
    player.channel = null;
    player.kills = 0;
    player.shots = 0;
    player.hits = 0;
    player.damage = 0;
    player.revived = 0;
    player.buffs = {};
    player.abilityCd = 0;
    player.abilityLockSay = 0;
    player.hp = 100;
    player.shield = 0;
    player.knocked = false;
    player.alive = true;
    player.bloom = 0;
    grenades = [];
    falling = [];
    for (const s of supply) { scene.remove(s.mesh); if (s.beam) scene.remove(s.beam); }
    supply = [];
    for (const p of pickups) {
      if (p.fromChest || p.fromDrop) {
        scene.remove(p.mesh);
      }
    }
    pickups = pickups.filter((p) => !p.fromChest && !p.fromDrop);
    for (const p of pickups) { p.taken = false; p.mesh.visible = true; }
    for (const c of chests) {
      c.open = false;
      c.setOpen?.(false);
    }
    for (const b of bots) {
      b.hp = 100;
      b.shield = 20;
      b.knocked = false;
      b.knockHp = 100;
      b.alive = true;
      b.state = 'bus';
      b.kills = 0;
      b.mag = GUNS[b.gun].mag;
      b.reload = 0;
      b.pull = null;
      b.avatar.group.visible = false;
      if (b.avatar.group.parent !== scene) scene.attach(b.avatar.group);
    }
    zone.x = 6; zone.z = -4; zone.r = 62; zone.from = 62;
    zone.phase = 0; zone.mode = 'wait'; zone.left = ZONE_PLAN[0].wait; zone.dps = 0;
    dropT = 40;
    abstractT = 2;
    // Restarting a range session means re-arming and standing the dummies back
    // up, not a new drop. placeLobby would put the player on a lobby deck at
    // y=48 that the graybox does not have.
    if (world.isGraybox) {
      clock.phase = 'play';
      clock.match = 0;
      for (const b of bots) {
        if (!b.dummy) continue;
        b.alive = true;
        b.knocked = false;
        b.state = 'live';
        b.hp = b.spawnHp;
        b.shield = b.spawnShield;
        b.knockHp = 100;
        b.respawnIn = null;
      }
      armForRange();
      viewmodel.setLook({ ...look(), _weapon: player.meleeId });
      emit({ type: 'toast', text: 'Graybox range - dummies are live.' });
      return;
    }
    placeLobby();
    viewmodel.setLook({ ...look(), _weapon: player.meleeId });
    emit({ type: 'toast', text: 'New drop. Same cute disaster.' });
  }

  /**
   * Refresh just the bag's fields on the shared snapshot.
   *
   * Split out of the update loop and called from `snapshot()` as well, because
   * `snapshot()` hands back one long-lived object that the update loop
   * refreshes in place. The bag pauses the match -- correctly, so a bot cannot
   * execute you while you read a blurb -- and with the refresh living only
   * inside update(), pausing froze the bag's data too. The screen then showed
   * the *last pre-pause* contents: open the bag, drop a stack, and the slot you
   * just emptied is still drawn full, because the snapshot it is rendering is
   * from before the drop. Cost is six objects, and only when something reads it.
   */
  function syncInvSnapshot() {
    snap.items = player.inv.slots.map((s, i) => (s ? {
      index: i,
      id: s.id,
      count: s.count,
      name: ITEMS[s.id]?.name || s.id,
      kind: ITEMS[s.id]?.kind || 'item',
      rarity: ITEMS[s.id]?.rarity || 'common',
      blurb: ITEMS[s.id]?.blurb || '',
      on: i === player.itemIndex,
    } : { index: i, empty: true, on: i === player.itemIndex }));
    snap.invUsed = occupied(player.inv);
    snap.invCap = player.inv.capacity;
    // The whole loadout, so the HUD can show what is equipped and not just
    // what is carried. Reading the live `player` object from the shell would
    // work and would also mean the UI's idea of the loadout could drift from
    // the match's, with nothing to compare them.
    snap.loadout = [
      ...player.guns.map((g, i) => (g ? {
        kind: 'gun', slot: i, on: player.active === i, id: g.id,
        name: GUNS[g.id]?.name || g.id,
        rarity: GUNS[g.id]?.rarity || 'common',
        mag: g.mag, magSize: GUNS[g.id]?.mag || 0,
        ammo: GUNS[g.id]?.ammo,
        reserve: player.ammo[GUNS[g.id]?.ammo] || 0,
      } : { kind: 'gun', slot: i, empty: true })),
      {
        kind: 'melee', slot: 2, on: player.active === 2,
        id: player.meleeId,
        name: MELEE[player.meleeId]?.name || 'Ribbon Katana',
        rarity: MELEE[player.meleeId]?.rarity || 'common',
      },
    ];
  }

  function update(dt, input) {
    if (!built) return;
    const settings = getSettings();
    dt = Math.min(0.033, dt);
    if (trauma > 0 && settings.shake === false) trauma = 0;
    let sim = dt;
    if (player.hitstop > 0 && settings.shake !== false) {
      player.hitstop -= dt;
      sim *= 0.2;
    }
    player.time += sim;
    clock.match += clock.phase === 'lobby' ? 0 : sim;

    if (clock.phase === 'lobby') updateLobby(sim, input, settings);
    else if (clock.phase === 'bus') updateBus(sim, input, settings);
    else if (clock.phase === 'play') updatePlay(sim, input, settings);
    else if (clock.phase === 'end') updateEnd(sim, settings);

    /*
     * The world floor, applied once per frame after the phase has run, so it
     * holds no matter which branch moved the player.
     *
     * Every individual mover -- the glide, the walk, the bus, the drop -- does
     * its own ground query, and each one has its own idea of where the feet
     * were. That is how a player ends up at y = -20 with the island under them:
     * a path that integrates position and only then asks "is there ground",
     * on a frame long enough that the answer is already no. Chasing that per
     * branch means the next mover repeats it.
     *
     * Terrain is unconditionally a legal floor -- you cannot be legitimately
     * under the ground -- so this can only ever return a player who has sunk
     * through the world. One comparison when it does not fire, and the match
     * cannot be lost to a single bad frame.
     */
    if (clock.phase === 'play' || clock.phase === 'bus' || clock.phase === 'end') {
      const floor = heightAt(player.pos.x, player.pos.z);
      if (Number.isFinite(floor) && player.pos.y < floor) {
        player.pos.y = floor;
        if (player.vel.y < 0) player.vel.y = 0;
        player.gliding = false;
        player.grounded = true;
      }
    }

    fx.update(dt);
    applyCamera(dt, input, settings);
    animateActors(dt, settings);
    fillSnap(settings);
  }


  /**
   * The map image: the real island, seen from directly above, drawn once.
   *
   * The HUD used to plot a handful of POI dots on a blank disc. That is a
   * radar for a game that has an island in it -- it cannot tell you that a
   * building is between you and the one you cannot see, which is the only
   * question a map is asked during a fight. Fortnite's minimap is a real
   * top-down render of the level, and that is what this is: one orthographic
   * pass over the finished world, cached to a canvas, then cropped around the
   * player each frame.
   *
   * Once, not per frame. Re-rendering the scene at 60fps to feed a 160px
   * minimap would be the most expensive thing in the game by a wide margin,
   * and the island does not move.
   *
   * Returns null when there is no renderer, so the HUD keeps working in the
   * headless harness rather than throwing on a canvas it cannot fill.
   */
  let mapImage = null;
  function buildMapImage(size = 1024) {
    if (!renderer || !world || !scene) return null;
    if (mapImage) return mapImage;
    const R = ISLAND_R * 1.12;
    const cam = new THREE.OrthographicCamera(-R, R, R, -R, 0.1, 400);
    cam.position.set(0, 260, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();

    // Hide what is not the island, and hide the *sky* only.
    //
    // The previous version also hid `o.isLight`, on the reasoning that lights
    // are not geometry. They are exactly what geometry needs: every surface here
    // is a toon or Lambert material, so with the sun and the hemisphere switched
    // off the entire overhead pass renders unlit -- a near-black disc with a few
    // grey slabs floating in it. That is the "dark and flat" minimap, and it
    // survived a build because an unlit render still draws geometry, so it looks
    // like a successful pass rather than a failure.
    //
    // The sky dome *is* hidden, because it is a 400-unit sphere the ortho camera
    // sits inside: left visible it fills the frame and no island is ever seen.
    //
    // Enumerated as direct children of the scene rather than a traverse over a
    // deny-list. The deny-list had to name every transient thing that must not be
    // baked in -- the ship, the lobby deck, the bots -- and it had already missed
    // one, which is how a grey slab ended up sitting in the middle of the map.
    // Anything that is not explicitly the island is now excluded by default, so
    // the next thing added to the scene cannot silently join the artwork.
    const hidden = [];
    const hide = (o) => {
      if (o && o.visible) { hidden.push(o); o.visible = false; }
    };
    for (const child of scene.children) {
      if (child === world.group) continue;   // the island itself
      if (child.isLight) continue;          // lights stay ON
      hide(child);
    }
    for (const b of bots) if (b.avatar && b.avatar.group) hide(b.avatar.group);
    // The storm wall is a 36m translucent cylinder standing over the island.
    // Viewed from directly above it is a disc of pink over the entire map.
    hide(zoneMesh);

    /*
     * No fog for this pass.
     *
     * The camera is 260m up, which is far beyond every fog distance in the
     * scene, so a fogged render comes back as a single flat disc of fog colour
     * -- a pink circle with no island in it. That is exactly what the first
     * version produced, and it is indistinguishable from a deliberate grey
     * plate, which is how it survived a build without anyone noticing.
     *
     * Distance fog exists to hide the horizon of a first-person view. From
     * straight above there is no horizon to hide.
     */
    const prevFog = scene.fog;
    scene.fog = null;
    const prevBg = scene.background;
    // Deep sea, not deep night. This is the colour of everything outside the
    // island, so it is what tells the player where the coast is.
    scene.background = new THREE.Color('#123a63');

    /*
     * Bright, shadowless, flat-ish light for the overhead pass.
     *
     * The scene's own sun sits at (70,120,40) and casts 2048px shadows across a
     * 200-unit box. That is right for a first-person view and wrong for a map:
     * from straight above, every building lies in its own long shadow, so half
     * the island renders as unlit toon -- the black plateau. Shadows off, and
     * the hemisphere lifted, gives the even top light a map wants.
     *
     * Both restored below, so the game view is untouched.
     */
    const prevShadow = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;
    const lit = [];
    scene.traverse((o) => {
      if (!o.isHemisphereLight && !o.isAmbientLight) return;
      lit.push([o, o.intensity]);
      o.intensity = Math.max(o.intensity, 1.6);
    });

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(null);
    const oldSize = renderer.getSize(new THREE.Vector2());
    const oldPR = renderer.getPixelRatio();
    try {
      renderer.setPixelRatio(1);
      renderer.setSize(size, size, false);
      cam.aspect = 1;
      renderer.render(scene, cam);

      mapImage = document.createElement('canvas');
      mapImage.width = size;
      mapImage.height = size;
      mapImage.getContext('2d').drawImage(renderer.domElement, 0, 0);
    } finally {
      /*
       * Restored in a `finally`, not on the happy path.
       *
       * Every one of these is global renderer/scene state that the *game* reads
       * on the next frame. If the render or the canvas copy throws -- and a
       * headless context that cannot allocate a 1024px buffer genuinely can --
       * then a plain trailing restore never runs, and the match is left running
       * with no shadows, a lifted ambient and a 1024px viewport. The minimap is
       * a nice-to-have; silently corrupting the game to produce one is not a
       * trade worth making.
       */
      renderer.setPixelRatio(oldPR);
      renderer.setSize(oldSize.x, oldSize.y, false);
      renderer.setRenderTarget(prevTarget);
      renderer.shadowMap.enabled = prevShadow;
      scene.fog = prevFog;
      scene.background = prevBg;
      for (const [l, i] of lit) l.intensity = i;
      for (const o of hidden) o.visible = true;
    }
    return mapImage;
  }
  function applyLook(input, settings, assist) {
    let lx = input.lookX;
    let ly = input.lookY;
    if (input.aim) { lx *= 0.62; ly *= 0.62; }
    if (assist && settings.assist && input.device === 'gamepad' && clock.phase === 'play' && !inspect) {
      const pull = aimPull();
      if (pull) {
        const slow = pull.ang < 0.07 ? 0.4 : 0.68;
        lx = lx * slow + clamp(pull.yaw, -1, 1) * 0.016 * 3.2;
        ly = ly * slow - clamp(pull.pitch, -1, 1) * 0.016 * 2.4;
      }
    }
    player.yaw -= lx;
    player.pitch = clamp(player.pitch - ly, -1.25, 1.25);
    syncAim();
  }

  function syncAim() {
    yawPivot.rotation.y = player.yaw;
    pitchPivot.rotation.x = player.pitch + player.recoilP;
    pitchPivot.rotation.y = player.recoilY;
    rig.updateMatrixWorld(true);
  }

  function aimPull() {
    camera.getWorldDirection(_dir);
    const basis = planarBasis(yawPivot);
    _fwd.copy(basis.forward);
    _right.copy(basis.right);
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    let best = null;
    const bestDir = new THREE.Vector3();
    for (const b of bots) {
      if (!b.alive || b.team === 0 || b.state === 'bus') continue;
      _to.set(b.pos.x, b.pos.y + 1.3, b.pos.z).sub(origin);
      const dist = _to.length();
      if (dist > 60 || dist < 0.5) continue;
      _to.multiplyScalar(1 / dist);
      const ang = Math.acos(clamp(_to.dot(_dir), -1, 1));
      if (ang < 0.16 && (!best || ang < best.ang)) {
        best = { ang, pitch: _to.y - _dir.y };
        bestDir.copy(_to);
      }
    }
    if (!best) return null;
    best.yaw = Math.atan2(bestDir.dot(_right), bestDir.dot(_fwd));
    return best;
  }

  function updateLobby(dt, input, settings) {
    clock.lobby -= dt;
    applyLook(input, settings, false);
    if (input.inspectPressed) {
      inspect = !inspect;
      emit({ type: 'toast', text: inspect ? 'Inspecting your waifu' : 'Back to first person' });
    }
    if (!inspect) moveOnPlatform(dt, input);
    if (input.emotePressed) startEmote();
    if (clock.lobby <= 0) beginBus();
  }


/**
 * Skip the drop and land the squad on the island immediately.
 *
 * The bus ride is a long wait for a human and a much longer one for a headless
 * render harness, so expose a way past it. Returns the phase it produced.
 */
function skipBus() {
  if (clock.phase !== 'bus') return clock.phase;
  // Park the ship over the middle of the island and drop everyone properly.
  // Deliberately does not go through updateBus(): that needs a full input
  // object with look deltas, and a partial one produces NaN player positions
  // that look like a physics bug.
  const p = busPosition(0.5);
  world.ufo.group.position.set(p.x, p.y, p.z);
  player.local.set(0, 0, 0);
  // dropPlayer() owns the exit point and reads the ship's own hull radius, so
  // the probe path and the played path cannot disagree about where "outside the
  // ship" is. Setting the position here as well used to duplicate that rule and
  // is exactly how the two drifted into putting the camera inside the hull.
  dropPlayer();
  for (const b of bots) {
    if (b.state === 'bus') dropBot(b);
  }
  return clock.phase;
}

function beginBus() {
    clock.phase = 'bus';
    clock.bus = 0;
    clock.intro = INTRO_TIME;
    clock.lastCount = 0;
    ufoDepart = -1;
    world.ufo.group.visible = true;
    setRoof(false);
    inspect = false;
    zone.left = ZONE_PLAN[0].wait;
    emit({ type: 'toast', text: 'Aboard the pyramid. Hold for launch.' });
    audio.sfx('crystal');
  }

  /**
   * Lift or restore the ship's canopy.
   *
   * The canopy is correct as art and wrong as a play space. Aboard, the
   * first-person camera sits on the deck with a 10m slab directly overhead: it
   * is *inside* the canopy, the deck beneath it is in that slab's full shadow,
   * and the player sees nothing but two shades of black for the whole ride. So
   * the roof comes off while the ship is occupied and goes back on once it
   * leaves.
   *
   * Applied per-piece rather than behind one flag, because the pieces arrive
   * asynchronously as the kit streams in: a roof list captured at build time is
   * empty for every piece that landed after it.
   */
  function setRoof(hidden) {
    for (const o of world.ufo.roof || []) o.visible = !hidden;
  }

  function updateBus(dt, input, settings) {
    // Two beats, one phase. The hold runs the countdown with the ship parked,
    // then the route runs. `clock.bus` only advances after the hold, so u stays
    // pinned at 0 and the ship genuinely does not move until the number hits 0.
    if (clock.intro > 0) {
      clock.intro = Math.max(0, clock.intro - dt);
      const held = Math.ceil(clock.intro);
      if (held !== clock.lastCount && held > 0) {
        clock.lastCount = held;
        audio.sfx('tick');
        emit({ type: 'countdown', n: held });
      }
      if (clock.intro <= 0) {
        audio.sfx('launch');
        emit({ type: 'toast', text: 'Route open — hold on.' });
        emit({ type: 'cutscene', on: true });
      }
    }
    // Jump is only a drop once the route is running. During the hold it is
    // ignored entirely, so nobody can leave before the drop is live.
    if (clock.intro <= 0) clock.bus += dt;
    const u = clamp(clock.bus / BUS_TIME, 0, 1);
    const p = busPosition(u);
    world.ufo.group.position.set(p.x, p.y, p.z);
    world.ufo.group.rotation.y = Math.atan2(-(busPosition(Math.min(1, u + 0.01)).x - p.x), -(busPosition(Math.min(1, u + 0.01)).z - p.z));
    applyLook(input, settings, false);
    const basis = planarBasis(yawPivot);
    player.local.x += basis.right.x * input.moveX * dt * 3 + basis.forward.x * input.moveY * dt * 3;
    player.local.z += basis.right.z * input.moveX * dt * 3 + basis.forward.z * input.moveY * dt * 3;
    const lr = Math.hypot(player.local.x, player.local.z);
    if (lr > 4) { player.local.x *= 4 / lr; player.local.z *= 4 / lr; }
    player.pos.set(p.x + player.local.x, p.y + 0.2, p.z + player.local.z);
    updateZone(dt);
    for (const b of bots) if (b.state === 'bus' && u >= b.dropU) dropBot(b);
    if ((input.jumpPressed || u > 0.98) && clock.bus > 2 && clock.intro <= 0) dropPlayer();
    if (input.emotePressed) startEmote();
  }

  /**
   * Leave the ship.
   *
   * The player leaves from *outside* the hull, not from the deck it is standing
   * on. Dropping straight down put the camera 0.6m above a 10x10 deck plating
   * slab, in that slab's own shadow, and it filled the entire view with one
   * black shape -- the drop opened on a black screen and nobody could tell a
   * ship from a wall.
   *
   * Stepping out sideways past `hullR` and then sinking is both the fix and the
   * better read: you see the ship above you as you leave it, which is the shot
   * the whole launch sequence is for.
   *
   * The offset is perpendicular to the ship's heading so the player always
   * steps off the same side, and it is floored at a metre of clearance so a
   * small hull still cannot be dropped through.
   */
  function dropPlayer() {
    const g = world.ufo.group;
    const clear = Math.max(1, (world.ufo.hullR || 5) + 1.5);
    // The ship's local +X, flattened: stepping off the starboard rail.
    const yaw = g.rotation.y || 0;
    player.pos.set(
      g.position.x + Math.cos(yaw) * clear,
      g.position.y - 1,
      g.position.z - Math.sin(yaw) * clear,
    );
    player.vel.set(0, -2, 0);
    player.gliding = true;
    player.local.set(0, 0, 0);
    clock.phase = 'play';
    ufoDepart = 0;
    // Off with it the moment the player is clear. Keeping a 10m deck hanging in
    // the sky for six seconds while it flies away puts a huge untextured slab
    // across the sky of every match that follows.
    setRoof(true);
    inspect = false;
    audio.sfx('jump');
    emit({ type: 'toast', text: 'Hold jump to glide. Release to dive.' });
  }

  /**
   * Fly the drop ship out of the match.
   *
   * updateBus parks it on the drop line, and nothing used to move it after that
   *    so a 60-unit modular ship hung in the sky over the whole island for the
   * rest of the match, silhouetted black against the sunset and looking for all
   * the world like floating broken geometry. It now flies on past the island
   * and is hidden once it is out of sight.
   */
  function updateUfoDeparture(dt) {
    if (clock.phase !== 'play' || !world.ufo.group.visible) return;
    ufoDepart += dt;
    const g = world.ufo.group;
    g.position.x += 26 * dt;
    g.position.y += 7 * dt;
    g.position.z -= 9 * dt;
    if (ufoDepart > 6) g.visible = false;
  }

  function dropBot(b) {
    const p = world.ufo.group.position;
    // Same rule as the player: outside the hull, not under the deck. Bots that
    // spawn inside the ship spend their first second of the fight inside a
    // shadowed slab with no line of sight, which reads as the bot being stuck.
    const clear = Math.max(1, (world.ufo.hullR || 5) + 1.5);
    b.state = 'glide';
    b.pos.x = p.x + clear + (Math.random() - 0.5) * 6;
    b.pos.y = p.y - 1;
    b.pos.z = p.z + (Math.random() - 0.5) * 6;
    b.vel.x = 0; b.vel.y = -2; b.vel.z = 0;
    if (b.avatar.group.parent !== scene) scene.attach(b.avatar.group);
    b.avatar.group.visible = true;
    b.avatar.group.position.set(b.pos.x, b.pos.y, b.pos.z);
  }

  function updatePlay(dt, input, settings) {
    // The range has no storm, no tide, no supply drops and no kill feed, so
    // those systems are skipped wholesale rather than individually guarded.
    // A single `if` here is harder to get wrong than a dozen scattered checks,
    // and it keeps the match path below completely unmodified.
    if (world.isGraybox) { updateRange(dt, input, settings); return; }
    updateZone(dt);
    updateUfoDeparture(dt);
    if (input.inspectPressed && player.alive && !player.gliding) {
      inspect = !inspect;
    }
    if (input.itemNext) cycleItem(1);
    if (input.itemPrev) cycleItem(-1);
    aimHeld = !!input.aim && !player.knocked;
    if (!player.alive) { spectate(dt); checkEnd(); return; }
    if (inspect && !player.gliding) {
      applyLook(input, settings, false);
    } else {
      applyLook(input, settings, true);
      if (player.gliding) glide(dt, input);
      else movePlayer(dt, input, settings);
      combat(dt, input, settings);
    }
    if (input.emotePressed && !player.knocked && !player.gliding) startEmote();
    if (emoteT > 0) emoteT -= dt;
    updateBots(dt);
    updateGrenades(dt);
    updateDecrees(dt);
    updateSupply(dt);
    updatePickups(dt);
    zoneDamage(dt);
    oceanDamage(dt);
    buffs(dt);
    updateAbility(dt, input);
    abstractT -= dt;
    if (abstractT <= 0) { abstractT = 2.4; abstractFight(); }
    dropT -= dt;
    if (dropT <= 0) { dropT = 60; callSupply(); }
    checkEnd();
  }

  /**
   * The range play loop.
   *
   * Deliberately the same shape as `updatePlay`, minus the storm, the tide,
   * supply drops, grenade cooldowns and the win check. Everything that decides
   * where a bullet goes and how much damage it does is still the shared code:
   * movePlayer, combat, shoot, raycast, hurtBot, buffs. The only things removed
   * are the ones that would interrupt a measurement.
   */
  function updateRange(dt, input, settings) {
    if (input.inspectPressed && player.alive && !player.gliding) inspect = !inspect;
    if (input.itemNext) cycleItem(1);
    if (input.itemPrev) cycleItem(-1);
    aimHeld = !!input.aim && !player.knocked;
    rangeTime += dt;
    moveRangeDummies(dt);
    if (rangeLog.downed) {
      rangeLog.downed.t -= dt;
      if (rangeLog.downed.t <= 0) rangeLog.downed = null;
    }
    // The score key clears the board. A drill you cannot restart is a leaderboard
    // you can only leave, and "leave and come back" costs a full world reload on
    // this map — the score has to be resettable in place or the only way to chase
    // a better run is to quit, which is exactly the friction that stops people.
    // Rising edge only, so holding the key does not wipe the board every frame.
    if (input.scoreHeld && !rangeScoreWasHeld) restartDrill();
    rangeScoreWasHeld = !!input.scoreHeld;
    // Death on the range puts you back on the firing line immediately rather
    // than ending the session. Being knocked off the roof during a movement
    // test should cost you two seconds, not the whole test run. This is checked
    // before the spectate branch below, because a dead player is not alive and
    // would otherwise never reach the reset.
    if (!player.alive || player.hp <= 0) {
      player.alive = true;
      player.knocked = false;
      player.hp = 100;
      player.shield = 0;
      player.pos.set(world.spawn.x, world.spawn.y, world.spawn.z);
      player.vel.set(0, 0, 0);
      // A death breaks the streak, the same way a miss does. Otherwise walking
      // off the roof once would leave a streak running that nothing earned.
      breakStreak();
      emit({ type: 'toast', text: 'Back to the line.' });
    }
    if (inspect && !player.gliding) {
      applyLook(input, settings, false);
    } else {
      applyLook(input, settings, true);
      if (player.gliding) glide(dt, input);
      else movePlayer(dt, input, settings);
      combat(dt, input, settings);
    }
    if (input.emotePressed && !player.knocked && !player.gliding) startEmote();
    if (emoteT > 0) emoteT -= dt;
    updateBots(dt);
    updateGrenades(dt);
    updateDecrees(dt);
    updatePickups(dt);
    buffs(dt);
    updateAbility(dt, input);
  }

  function glide(dt, input) {
    const basis = planarBasis(yawPivot);
    const fwd = basis.forward.clone();
    const right = basis.right.clone();
    const speed = 11;
    player.vel.x = lerp(player.vel.x, (fwd.x * input.moveY + right.x * input.moveX) * speed, 0.08);
    player.vel.z = lerp(player.vel.z, (fwd.z * input.moveY + right.z * input.moveX) * speed, 0.08);
    const hold = input.jumpHeld;
    player.vel.y -= (hold ? 8 : 28) * dt;
    const minVy = hold ? -6.5 : -26;
    if (player.vel.y < minVy) player.vel.y = minVy;
    // Feet height before the step, for the same reason as in movePlayer(): a
    // terminal dive covers 0.87 m in a 1/30 s frame, which is more than a
    // step-up, so measuring reachability from the post-integration position
    // classifies every landing surface as a ceiling. The glide then never finds
    // ground, never clears `gliding`, and the player free-falls past the entire
    // island into the sea shelf -- this is the "falling through the map" bug,
    // and it is only reachable on the drop, which is why it read as random.
    const feetY = player.pos.y;
    player.pos.addScaledVector(player.vel, dt);
    const bed = heightAt(player.pos.x, player.pos.z);
    const ground = floorAt(player.pos.x, player.pos.z, 0.35, world.boxes, bed, feetY);
    if (player.pos.y <= ground + 0.02) {
      player.pos.y = ground;
      player.vel.y = 0;
      player.gliding = false;
      player.grounded = true;
      audio.sfx('land');
      fx.burst(player.pos, '#ffd1ea', 8, 3);
      return;
    }
    /*
     * The sea is a floor too, and forgetting that is what let a player sink
     * forever. Over water the only solid thing below is the seabed, which on
     * this island shelves to about -28: the glide was asking "am I at -28?"
     * while descending through -6, so the check never passed, `gliding` stayed
     * true, and movePlayer -- which owns buoyancy, and which gliding skips
     * entirely -- never got the chance to hold the player at the surface. The
     * player ended up parked at y = -20.7 under an ocean they should have been
     * floating on, which is what "falling through the map" actually looked
     * like.
     */
    if (bed < SEA_Y && player.pos.y <= SEA_Y + 0.05) {
      player.pos.y = SEA_Y;
      player.vel.y = 0;
      player.gliding = false;
      player.grounded = true;
      audio.sfx('splash');
    }
  }

  function moveOnPlatform(dt, input) {
    const basis = planarBasis(yawPivot);
    const fwd = basis.forward.clone();
    const right = basis.right.clone();
    const speed = input.sprint ? 6 : 4;
    player.vel.x = lerp(player.vel.x, (fwd.x * input.moveY + right.x * input.moveX) * speed, 0.2);
    player.vel.z = lerp(player.vel.z, (fwd.z * input.moveY + right.z * input.moveX) * speed, 0.2);
    player.pos.x += player.vel.x * dt;
    player.pos.z += player.vel.z * dt;
    const flat = Math.hypot(player.pos.x, player.pos.z);
    if (flat > 6.5) { player.pos.x *= 6.5 / flat; player.pos.z *= 6.5 / flat; }
    player.pos.y = 48.7;
  }

  function movePlayer(dt, input, settings) {
    if (player.mantle) {
      player.mantle.t += dt;
      const u = clamp(player.mantle.t / 0.32, 0, 1);
      player.pos.x = lerp(player.mantle.x0, player.mantle.x1, u);
      player.pos.z = lerp(player.mantle.z0, player.mantle.z1, u);
      player.pos.y = lerp(player.mantle.y0, player.mantle.y1, u);
      if (u >= 1) player.mantle = null;
      return;
    }
    const basis = planarBasis(yawPivot);
    const fwd = basis.forward.clone();
    const right = basis.right.clone();
    player.dashCd = Math.max(0, player.dashCd - dt);
    player.coyote = player.grounded ? 0.12 : player.coyote - dt;
    if (input.jumpPressed) player.buffer = 0.12;
    else player.buffer = Math.max(0, player.buffer - dt);

    const speedMul = (player.buffs.speed || 0) > 0 ? 1.4 : 1;
    const slowItem = player.channel ? 0.4 : 1;
    let speed = (player.knocked ? 1.8 : player.crouch ? 3.0 : input.sprint ? 8.2 : 5.0) * speedMul * slowItem;
    if (world.slowAt(player.pos.x, player.pos.z) && !player.knocked) speed *= 0.72;

    if (input.crouchPressed && player.grounded && !player.knocked) {
      const horiz = Math.hypot(player.vel.x, player.vel.z);
      if (horiz > 5.5 && input.sprint) {
        player.slide = 0.72;
        player.slideDir.set(player.vel.x, 0, player.vel.z).normalize();
        audio.sfx('dash');
        trauma = Math.min(1, trauma + 0.08);
      }
    }
    player.crouch = player.knocked || input.crouchHeld || player.slide > 0;
    if (player.slide > 0) {
      player.slide -= dt;
      speed = 9 + player.slide * 6;
      fwd.copy(player.slideDir);
      right.set(0, 0, 0);
    }

    if (input.dashPressed && player.dashCd <= 0 && !player.knocked && !player.channel) {
      player.dashCd = 1.05;
      const dx = fwd.x * (input.moveY || 1) + right.x * input.moveX;
      const dz = fwd.z * (input.moveY || 1) + right.z * input.moveX;
      const l = Math.hypot(dx, dz) || 1;
      player.vel.x += (dx / l) * 16;
      player.vel.z += (dz / l) * 16;
      audio.sfx('dash');
      trauma = Math.min(1, trauma + 0.12);
      fx.burst(player.pos.clone().setY(player.pos.y + 0.3), '#3ee0ff', 6, 4);
    }

    const wishX = fwd.x * input.moveY + right.x * input.moveX;
    const wishZ = fwd.z * input.moveY + right.z * input.moveX;
    const accel = player.grounded ? 28 : 10;
    if (player.slide > 0) {
      player.vel.x = player.slideDir.x * speed;
      player.vel.z = player.slideDir.z * speed;
    } else if (Math.hypot(wishX, wishZ) > 0.05) {
      player.vel.x = lerp(player.vel.x, wishX * speed, 1 - Math.exp(-accel * dt));
      player.vel.z = lerp(player.vel.z, wishZ * speed, 1 - Math.exp(-accel * dt));
    } else if (player.grounded) {
      player.vel.x *= Math.exp(-14 * dt);
      player.vel.z *= Math.exp(-14 * dt);
    }

    player.pos.x += player.vel.x * dt;
    player.pos.z += player.vel.z * dt;
    const pushed = pushOut(player.pos.x, player.pos.z, 0.36, player.pos.y, player.pos.y + (player.crouch ? 1.05 : 1.7), world.boxes);
    const blocked = Math.hypot(pushed.x - player.pos.x, pushed.z - player.pos.z) > 0.02;
    player.pos.x = pushed.x;
    player.pos.z = pushed.z;

    if (input.jumpPressed && blocked && !player.grounded) tryMantle(fwd);

    /*
     * Buoyancy. Without it the player sinks to the seabed and stands on it,
     * fully submerged, taking tide damage with no way out    the old sea floor
     * sat at -4.5 so this never showed, but the island now shelves down to -28.
     * Floating at the surface makes the water something you cross under
     * pressure rather than a pit you fall into.
     */
    const bed = heightAt(player.pos.x, player.pos.z);
    const inWater = bed < SEA_Y && player.pos.y < SEA_Y + 0.6;
    if (inWater) {
      // Strong drag and a gentle righting force: swimming, not falling.
      player.vel.x *= Math.exp(-5.5 * dt);
      player.vel.z *= Math.exp(-5.5 * dt);
      player.vel.y += 26 * dt;
      player.vel.y *= Math.exp(-6 * dt);
      if (input.jumpHeld) player.vel.y += 14 * dt;
      player.pos.y = Math.min(player.pos.y, SEA_Y + 0.35);
      if (player.vel.y > 0) player.vel.y = Math.min(player.vel.y, 2.2);
    } else {
      player.vel.y -= 20 * dt;
    }
    if (!input.jumpHeld && player.vel.y > 0) player.vel.y *= Math.exp(-6 * dt);
    // Capture the feet height *before* gravity moves them. floorAt decides
    // whether a surface is reachable from the feet, and by the time this line
    // has run the player may already be a metre below the very surface they
    // were about to land on -- a terminal-velocity dive covers more ground per
    // frame than a step-up is tall, so every surface reads as a ceiling and the
    // player falls straight through the island. Measured against the position
    // at the top of the step, the same query is correct in both directions:
    // rising, you are still below the roof and it stays a ceiling; falling, you
    // are still above the floor and it stays a floor.
    const feetY = player.pos.y;
    player.pos.y += player.vel.y * dt;
    const ground = floorAt(player.pos.x, player.pos.z, 0.34, world.boxes, heightAt(player.pos.x, player.pos.z), feetY);
    // Last-resort floor. Everything above can be defeated by geometry we did not
    // model -- a box whose top sits above the feet on the frame you arrive at
    // it, a terrain sampler that returns a value the rest of the world does not
    // share, a drop out of bounds. The cost of this line when it never fires is
    // one comparison; the cost of not having it is a match that a single bad
    // frame can delete the player from, which is unrecoverable and is exactly
    // the "falling through the map" report. Terrain is always a legal floor --
    // you cannot be legitimately under it -- so this can only ever put a
    // falling player back on the ground they were already heading for.
    const terrain = heightAt(player.pos.x, player.pos.z);
    if (Number.isFinite(terrain) && player.pos.y < terrain) {
      player.pos.y = terrain;
      player.vel.y = 0;
    }
    if (player.pos.y <= ground) {
      const impactVel = player.vel.y;
      player.pos.y = ground;
      if (player.vel.y < 0) player.vel.y = 0;
      if (!player.grounded && impactVel < -4) {
        audio.sfx('land');
        const impactForce = Math.min(1, Math.abs(impactVel) / 18);
        trauma = Math.min(1, trauma + impactForce * 0.25);
        fx.burst(player.pos.clone(), '#ffd1ea', Math.floor(impactForce * 8), 2 + impactForce * 3);
      }
      player.grounded = true;
      player.airJumps = 0;
    } else player.grounded = false;

    if (player.buffer > 0 && (player.grounded || player.coyote > 0 || ((player.buffs.jump || 0) > 0 && player.airJumps < 1 && !player.grounded))) {
      const extra = !player.grounded && player.coyote <= 0;
      if (!player.knocked) {
        player.vel.y = 8.0;
        player.buffer = 0;
        player.coyote = 0;
        player.grounded = false;
        if (extra) player.airJumps++;
        audio.sfx('jump');
      }
    }
  }

  function tryMantle(fwd) {
    const x = player.pos.x + fwd.x * 0.75;
    const z = player.pos.z + fwd.z * 0.75;
    const top = floorAt(x, z, 0.2, world.boxes, heightAt(x, z));
    const dy = top - player.pos.y;
    if (dy > 0.4 && dy < 1.3) {
      player.mantle = { t: 0, x0: player.pos.x, z0: player.pos.z, y0: player.pos.y, x1: x, z1: z, y1: top };
      player.vel.y = 0;
    }
  }

  function combat(dt, input, settings) {
    // Re-anchor the camera before anything traces a ray out of it. Both
    // updatePlay and updateRange call movePlayer (or glide) immediately before
    // this, so by here player.pos is this frame's position rather than the last
    // one - which is the whole point on a map that teleports you.
    syncRigTransform();
    const fireEdge = input.fire && !prevFire;
    prevFire = input.fire;
    if (input.weaponSlot && input.weaponSlot !== prevSlot) {
      prevSlot = input.weaponSlot;
      if (input.weaponSlot === 1 && player.guns[0]) player.active = 0;
      else if (input.weaponSlot === 2 && player.guns[1]) player.active = 1;
      else if (input.weaponSlot === 3) player.active = 2;
      syncWeapon();
    } else if (!input.weaponSlot) prevSlot = 0;

    if (input.swapPressed) {
      if (player.active === 2) player.active = player.guns[0] ? 0 : player.guns[1] ? 1 : 2;
      else {
        const other = player.gunIndex === 0 ? 1 : 0;
        if (player.guns[other]) { player.gunIndex = other; player.active = other; }
        else player.active = 2;
      }
      syncWeapon();
    }

    if (player.meleeBusy > 0) player.meleeBusy -= dt;
    if (player.reload > 0) {
      player.reload -= dt;
      if (player.reload <= 0) finishReload();
    }

    if (input.reloadPressed && player.active < 2 && !focusedInteract()) startReload();
    if (input.meleePressed && !player.knocked) doMelee();
    if (input.usePressed) useItem();
    if (input.interactPressed || input.interactHeld) interact(input);

    const spec = currentGun();
    const wantFire = spec && spec.kind === 'gun' && (spec.auto ? input.fire : fireEdge);
    if (wantFire && !player.knocked && !player.channel && player.meleeBusy <= 0) shoot(spec, settings);

    if (player.channel) {
      if (input.fire || input.dashPressed) player.channel = null;
      else {
        player.channel.t -= dt;
        if (player.channel.t <= 0) {
          if (player.channel.revive) finishRevive(player.channel.revive);
          else resolveChannel();
        }
      }
    }

    player.bloom = Math.max(0, player.bloom - dt * (input.aim ? 0.15 : 0.08));
    if (player.comboT > 0) player.comboT -= dt;
    else player.combo = 0;
  }

  function currentGun() {
    if (player.active === 2) return null;
    const g = player.guns[player.active];
    return g ? GUNS[g.id] : null;
  }

  function syncWeapon() {
    const spec = player.active === 2 ? meleeById(player.meleeId) : (currentGun() || meleeById(player.meleeId));
    viewmodel.setWeapon(spec.id, look().wrap, look().charm);
    if (!currentGun()) player.active = 2;
    // A swap clears the streak. The plinths are a walk away, so an A/B of two
    // guns is the single most common thing a tester does on this range, and a
    // streak carried across it would credit the second gun for hits the first
    // one earned.
    if (world.isGraybox) breakStreak();
    audio.sfx('equip');
  }

  function shoot(spec, settings) {
    const gun = player.guns[player.active];
    if (!gun) return;
    if (player.time < player.nextShot) return;
    if (gun.mag <= 0) {
      audio.sfx('dry');
      player.nextShot = player.time + 0.25;
      startReload();
      return;
    }
    gun.mag--;
    player.shots++;
    const rpm = spec.rpm;
    player.nextShot = player.time + 60 / rpm + (spec.bolt || 0);
    player.reload = 0;
    const kick = spec.recoil[player.recoilStep % spec.recoil.length];
    player.recoilStep++;
    player.recoilP += kick;
    player.recoilY += (player.recoilStep % 2 ? 1 : -1) * spec.yaw;
    player.bloom += spec.spreadAdd;
    viewmodel.punch();
    audio.sfx(spec.id === 'shot' ? 'shot' : spec.id === 'smg' ? 'smg' : spec.id === 'snip' ? 'snip' : spec.id === 'pistol' ? 'pistol' : 'ar');
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    camera.getWorldDirection(_dir);
    const pellets = spec.pellets;
    let any = false;
    let head = false;
    /**
     * Impact effects are emitted ONCE per shot, not once per pellet.
     *
     * This used to draw a tracer, a ring and a spark burst inside the pellet
     * loop, so a single Blossom blast - 8 pellets - asked for 8 tracers, 8
     * rings and 48 sparks in one frame, before the muzzle flash. Nine
     * characters with automatics did the same and the screen turned to soup.
     * Damage and hit registration still run per pellet, because that is the
     * simulation; only the *drawing* is per shot. One tracer and one impact
     * reads as one shot, which is also what it is.
     */
    let firstHit = null;
    let firstWorld = null;
    for (let i = 0; i < pellets; i++) {
      const dir = _dir.clone();
      const sp = (spec.spread + player.bloom) * (inputAim() ? 0.4 : 1);
      dir.x += (Math.random() - 0.5) * sp * 2;
      dir.y += (Math.random() - 0.5) * sp * 2;
      dir.z += (Math.random() - 0.5) * sp * 2;
      dir.normalize();
      const hit = raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 180, (b) => b.team === 0);
      const end = origin.clone().addScaledVector(dir, hit ? hit.t : 80);
      if (hit && hit.bot) {
        const dmg = falloffDamage(spec, hit.t) * (hit.head ? spec.head : 1);
        hurtBot(hit.bot, dmg, { name: look().name, byPlayer: true, head: hit.head });
        any = true;
        head = head || hit.head;
        player.hits++;
        player.damage += dmg;
        // The first body pellet decides where the impact is drawn, so a blast
        // does not spray eight impacts across the target.
        if (!firstHit) firstHit = { end, head: hit.head };
        // Report the damage that was actually applied *after* range falloff and
        // the headshot multiplier, not the gun's headline number. A tester
        // comparing this against the arms table is comparing the right things.
        if (world.isGraybox) {
          rangeLog.last = {
            dmg: +dmg.toFixed(1),
            dist: +hit.t.toFixed(1),
            head: !!hit.head,
            // Share of the shot's theoretical maximum, so falloff and headshot
            // bonus are both legible without doing the division by hand.
            pct: Math.round((dmg / spec.dmg) * 100),
            score: 0,
            streak: 0,
          };
          if (hit.t > rangeLog.furthest) rangeLog.furthest = +hit.t.toFixed(1);
          if (hit.head) rangeLog.headshots++;
          // Score, streak and per-lane bookkeeping. A streak multiplier is what
          // turns "shoot the same dummy again" into a thing worth doing, and it
          // decays on a miss so it cannot be parked and cashed in later.
          rangeLog.streak += 1;
          if (rangeLog.streak > rangeLog.bestStreak) rangeLog.bestStreak = rangeLog.streak;
          const mult = 1 + Math.min(9, Math.floor((rangeLog.streak - 1) / 3)) * 0.25;
          const pts = Math.round(rangeScore(hit.bot, dmg, hit.head) * mult);
          rangeLog.score += pts;
          rangeLog.last.score = pts;
          rangeLog.last.streak = rangeLog.streak;
          const lane = hit.bot.dummyLabel || 'x';
          rangeLog.lanes[lane] = (rangeLog.lanes[lane] || 0) + 1;
          // Read the number off the target itself. The panel has the same figure
          // but it is in the corner of the screen, and looking at the corner is
          // exactly what breaks the rhythm of a run — the number has to be where
          // the eye already is.
          fx.number(end, String(Math.round(dmg)), hit.head ? '#ffe566' : '#ffffff');
        }
      } else if (hit) {
        if (!firstWorld) firstWorld = end;
      }
    }
    // One tracer, one impact, per shot. The tracer follows whichever pellet
    // actually connected - a body hit if there was one, otherwise the first
    // pellet to reach the world - so the line always agrees with the impact
    // it ends at.
    const fxEnd = firstHit ? firstHit.end : (firstWorld || origin.clone().addScaledVector(_dir, 60));
    fx.tracer(origin, fxEnd, '#ffd6ea');
    if (firstHit) {
      // An upright ring on a body, a flat one on the world. Same shot, two
      // very different events, and the difference is what makes "hit or miss"
      // readable without reading text.
      fx.ring(fxEnd, firstHit.head ? '#ffe566' : '#ff4f9a', false);
      fx.burst(fxEnd, firstHit.head ? '#ffe566' : '#ff4f9a', 6, 3);
    } else if (firstWorld) {
      fx.burst(fxEnd, '#efe6ff', 4, 2);
      fx.ring(fxEnd, '#efe6ff', true);
    }
    fx.muzzle(origin.clone().addScaledVector(_dir, 0.6));
    if (any) {
      emit({ type: 'hit', head });
      trauma = Math.min(1, trauma + 0.04);
      player.hitstop = 0.015;
      rumble(head ? 90 : 50, head ? 0.35 : 0.1, 0.4);
      audio.sfx(head ? 'head' : 'hit');
      if (settings.shake !== false) trauma = Math.min(1, trauma + 0.12);
    } else if (world.isGraybox) {
      // A miss costs the streak. Breaking it here rather than on a timer is what
      // makes it a streak: you can only keep it by putting the next one on the
      // target before you break rhythm, which is the actual skill the range
      // should be drilling.
      breakStreak();
    }
    if (gun.mag <= 0) startReload();
  }

  let aimHeld = false;
  function inputAim() { return aimHeld; }

  function doMelee() {
    if (player.meleeBusy > 0) return;
    const spec = meleeById(player.meleeId);
    if (player.comboT <= 0) player.combo = 0;
    const dmg = spec.combo[player.combo % spec.combo.length];
    const finisher = player.combo % spec.combo.length === spec.combo.length - 1;
    player.combo++;
    player.comboT = spec.gap;
    player.meleeBusy = spec.step;
    player.active = 2;
    syncWeapon();
    viewmodel.slash();
    audio.sfx('melee');
    const basis = planarBasis(yawPivot);
    player.vel.x += basis.forward.x * spec.lunge * 6;
    player.vel.z += basis.forward.z * spec.lunge * 6;
    const origin = player.pos.clone();
    origin.y += 1.2;
    for (const b of bots) {
      if (!b.alive || b.team === 0 || b.state === 'bus') continue;
      const dx = b.pos.x - player.pos.x;
      const dz = b.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > spec.range) continue;
      const flat = basis.forward.clone();
      if ((dx * flat.x + dz * flat.z) / (d || 1) < 0.35) continue;
      hurtBot(b, dmg * (finisher ? 1.15 : 1), { name: look().name, byPlayer: true, melee: true });
      fx.burst(new THREE.Vector3(b.pos.x, b.pos.y + 1, b.pos.z), finisher ? '#7dfff0' : '#ffd1ea', finisher ? 16 : 8, 5);
      emit({ type: 'hit', head: false });
      if (finisher && !b.alive) player.hitstop = 0.06;
    }
  }

  function startReload() {
    const spec = currentGun();
    const gun = player.guns[player.active];
    if (!spec || !gun || player.reload > 0) return;
    if (gun.mag >= spec.mag) return;
    if ((player.ammo[spec.ammo] || 0) <= 0) return;
    player.reload = spec.reload;
    audio.sfx('reload');
  }

  function finishReload() {
    const spec = currentGun();
    const gun = player.guns[player.active];
    if (!spec || !gun) return;
    const need = spec.mag - gun.mag;
    const take = Math.min(need, player.ammo[spec.ammo] || 0);
    gun.mag += take;
    player.ammo[spec.ammo] -= take;
  }

  function useItem() {
    if (player.channel || player.gliding) return;
    const stack = player.inv.slots[player.itemIndex];
    if (!stack || stack.count <= 0) return;
    const spec = ITEMS[stack.id];
    if (!spec) return;
    if (player.knocked && spec.kind !== 'revive') return;
    if (spec.kind === 'grenade') { throwGrenade(); consumeStack(); return; }
    if (spec.kind === 'revive') {
      if (!player.knocked && player.hp > 0) return;
      player.knocked = false;
      player.alive = true;
      player.hp = 50;
      player.shield = 25;
      player.knockHp = 100;
      consumeStack();
      audio.sfx('revive');
      emit({ type: 'toast', text: 'Second Heart — you are up.' });
      return;
    }
    player.channel = { id: stack.id, t: spec.time, max: spec.time };
  }

  function finishRevive(id) {
    const b = bots.find((x) => x.id === id);
    player.channel = null;
    if (!b || !b.alive || !b.knocked) return;
    if (Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z) > 3) return;
    b.knocked = false;
    b.hp = 45;
    b.knockHp = 100;
    player.revived++;
    audio.sfx('revive');
    emit({ type: 'toast', text: `Revived ${b.name}` });
  }

  function resolveChannel() {
    const spec = ITEMS[player.channel.id];
    player.channel = null;
    if (!spec) return;
    const stack = player.inv.slots.find((s) => s && s.id === spec.id);
    if (!stack) return;
    if (spec.hp) player.hp = Math.min(100, player.hp + spec.hp);
    if (spec.shield) player.shield = Math.min(100, player.shield + spec.shield);
    removeId(player.inv, spec.id, 1);
    audio.sfx(spec.kind === 'shield' ? 'shield' : 'heal');
    fx.hearts(player.pos.clone().setY(player.pos.y + 1.4));
  }

  function consumeStack() {
    removeAt(player.inv, player.itemIndex, 1);
  }

  /**
   * Drop the selected stack on the ground as a real, re-collectable pickup.
   *
   * Before this, the only way to free a slot was to consume the item, so a full
   * bag of the wrong heals was a dead end -- there was no way to make room for
   * the medkit you were actually standing on. Dropping spawns a pickup with the
   * item's own model, so it reads on the floor as that item rather than as a
   * generic blue crate.
   */
  function dropItem() {
    if (player.channel || player.gliding) return;
    const stack = player.inv.slots[player.itemIndex];
    if (!stack) return;
    const spec = ITEMS[stack.id];
    const dx = Math.sin(player.yaw) * 1.5;
    const dz = Math.cos(player.yaw) * 1.5;
    addPickup('item', stack.id, player.pos.x + dx, heightAt(player.pos.x + dx, player.pos.z + dz), player.pos.z + dz);
    removeAt(player.inv, player.itemIndex, stack.count);
    audio.sfx('drop');
    emit({ type: 'toast', text: `Dropped ${spec?.name || stack.id}` });
  }

  function throwGrenade() {
    camera.getWorldDirection(_dir);
    const o = new THREE.Vector3();
    camera.getWorldPosition(o);
    grenades.push({
      x: o.x, y: o.y, z: o.z,
      vx: _dir.x * 16, vy: _dir.y * 10 + 4, vz: _dir.z * 16,
      fuse: 1.35,
      team: 0,
    });
    audio.sfx('dash');
  }

  function interact(input) {
    if (!input.interactPressed && !(input.interactHeld && player.channel && player.channel.revive)) {
      /* press edge handled below for chests; hold for revive via channel */
    }
    const target = focusedInteract();
    if (!target) return;
    if (target.type === 'revive') {
      if (!player.channel || player.channel.revive !== target.bot.id) {
        if (input.interactPressed || input.interactHeld) {
          player.channel = { revive: target.bot.id, t: 3.2, max: 3.2, id: 'revive' };
        }
      }
      return;
    }
    if (!input.interactPressed) return;
    if (target.type === 'chest') openChest(target.chest);
    else if (target.type === 'supply') openSupply(target.drop);
    else if (target.type === 'gun') takeGun(target.pickup);
    else if (target.type === 'item' || target.type === 'ammo' || target.type === 'crystal') takePickup(target.pickup);
  }

  function focusedInteract() {
    let best = null;
    let bestD = 3;
    camera.getWorldDirection(_dir);
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    function consider(pos, type, obj, maxD) {
      const dx = pos.x - origin.x;
      const dy = (pos.y + 0.4) - origin.y;
      const dz = pos.z - origin.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > maxD) return;
      const dot = (dx * _dir.x + dy * _dir.y + dz * _dir.z) / d;
      if (dot < 0.45) return;
      if (d < bestD) { bestD = d; best = { type, ...obj, d }; }
    }
    for (const c of chests) if (!c.open) consider(c, 'chest', { chest: c }, 2.8);
    for (const s of supply) if (s.landed && !s.opened) consider(s, 'supply', { drop: s }, 3);
    for (const p of pickups) if (!p.taken && p.kind === 'gun') consider(p, 'gun', { pickup: p }, 2.6);
    const ally = partnerBot();
    if (ally && ally.alive && ally.knocked) consider({ x: ally.pos.x, y: ally.pos.y, z: ally.pos.z }, 'revive', { bot: ally }, 2.6);
    if (player.channel && player.channel.revive) {
      const b = bots.find((x) => x.id === player.channel.revive);
      if (b && b.alive && b.knocked) return { type: 'revive', bot: b };
      player.channel = null;
    }
    return best;
  }

  function openChest(c) {
    if (c.open) return;
    c.open = true;
    c.setOpen?.(true);
    audio.sfx('chest');
    const gun = Math.random() < 0.55 ? 'ar' : Math.random() < 0.5 ? 'shot' : Math.random() < 0.6 ? 'smg' : 'snip';
    const item = PICK_HEALS[Math.floor(Math.random() * PICK_HEALS.length)];
    const ammo = GUNS[gun].ammo;
    addMarked('gun', gun, c.x, c.y, c.z + 0.4);
    addMarked('item', item, c.x + 0.5, c.y, c.z);
    addMarked('ammo', ammo, c.x - 0.5, c.y, c.z);
    fx.burst(c.mesh.position, '#7dfff0', 12, 4);
  }

  function addMarked(kind, id, x, y, z) {
    addPickup(kind, id, x, y, z);
    pickups[pickups.length - 1].fromChest = true;
  }

  function takeGun(p) {
    const spec = GUNS[p.id];
    if (!spec) return;
    const inst = { id: p.id, mag: spec.mag };
    if (!player.guns[0]) { player.guns[0] = inst; player.active = 0; player.gunIndex = 0; }
    else if (!player.guns[1]) { player.guns[1] = inst; player.active = 1; player.gunIndex = 1; }
    else {
      player.guns[player.active === 2 ? player.gunIndex : player.active] = inst;
      if (player.active === 2) player.active = player.gunIndex;
    }
    player.ammo[spec.ammo] = (player.ammo[spec.ammo] || 0) + spec.mag * 2;
    p.taken = true;
    p.mesh.visible = false;
    syncWeapon();
    audio.sfx('pickup');
    emit({ type: 'toast', text: spec.name });
  }

  function takePickup(p) {
    if (p.kind === 'ammo') {
      const n = p.id === 'heavy' ? 12 : p.id === 'shells' ? 10 : 36;
      player.ammo[p.id] = (player.ammo[p.id] || 0) + n;
      emit({ type: 'toast', text: AMMO[p.id].name });
    } else if (p.kind === 'crystal') {
      const c = CRYSTALS[p.id];
      if (c) {
        player.buffs[p.id] = c.time;
        emit({ type: 'toast', text: c.name });
        audio.sfx('crystal');
      }
    } else if (p.kind === 'item') {
      const spec = ITEMS[p.id];
      if (!spec) return;
      const res = addItem(player.inv, p.id, 1, spec);
      if (!res.ok) { emit({ type: 'toast', text: 'Inventory full' }); return; }
      emit({ type: 'toast', text: spec.name });
    }
    p.taken = true;
    p.mesh.visible = false;
    audio.sfx('pickup');
  }

  function updatePickups(dt) {
    const magnet = (player.buffs.magnet || 0) > 0;
    for (const p of pickups) {
      if (p.taken) continue;
      p.spin += dt;
      p.mesh.position.y = p.y + 0.55 + Math.sin(p.spin * 3) * 0.08;
      p.mesh.rotation.y += dt * 2;
      const dx = player.pos.x - p.x;
      const dz = player.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (magnet && d < 9 && d > 0.2 && p.kind !== 'gun') {
        p.x += dx / d * dt * 10;
        p.z += dz / d * dt * 10;
        p.mesh.position.x = p.x;
        p.mesh.position.z = p.z;
      }
      if (!player.alive || player.gliding) continue;
      if (d < 1.55 && p.kind !== 'gun') takePickup(p);
    }
  }

  function raycast(ox, oy, oz, dx, dy, dz, maxDist, skip) {
    let bestT = maxDist;
    let best = null;
    for (const b of bots) {
      if (!b.alive || b.state === 'bus') continue;
      if (skip && skip(b)) continue;
      // A dummy's hit spheres are built from its authored height, so a crouch
      // or tall target is really hittable at the height it is drawn at rather
      // than at a standing body's.
      const h = b.dummy ? b.dummyHeight : (b.knocked ? 0.75 : 1.7);
      const body = raySphere(ox, oy, oz, dx, dy, dz, b.pos.x, b.pos.y + h * 0.5, b.pos.z, b.knocked ? 0.45 : 0.42);
      const head = raySphere(ox, oy, oz, dx, dy, dz, b.pos.x, b.pos.y + h * 0.9, b.pos.z, 0.22);
      const t = head != null && (body == null || head <= body) ? head : body;
      const isHead = head != null && (body == null || head <= body + 0.02);
      if (t != null && t < bestT && t > 0) {
        bestT = t;
        best = { t, bot: b, head: !!isHead && head < (body ?? 1e9) + 0.05 };
      }
    }
    if (player.alive && !(skip && skip(player))) {
      const h = player.knocked ? 0.75 : (player.crouch ? 1.15 : 1.7);
      const body = raySphere(ox, oy, oz, dx, dy, dz, player.pos.x, player.pos.y + h * 0.48, player.pos.z, 0.4);
      const head = raySphere(ox, oy, oz, dx, dy, dz, player.pos.x, player.pos.y + h * 0.88, player.pos.z, 0.2);
      const t = head != null && (body == null || head < body) ? head : body;
      if (t != null && t < bestT && t > 0) {
        bestT = t;
        best = { t, player: true, head: head != null && head <= (body ?? 1e9) };
      }
    }
    for (const box of world.boxes) {
      const t = rayAABB(ox, oy, oz, dx, dy, dz, box, bestT);
      if (t != null && t < bestT && t > 0) {
        bestT = t;
        best = { t, world: true };
      }
    }
    const steps = Math.ceil(bestT / 2);
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * bestT;
      const y = oy + dy * t;
      const h = heightAt(ox + dx * t, oz + dz * t);
      if (y < h) {
        if (t < bestT) { bestT = t; best = { t, world: true }; }
        break;
      }
    }
    return best;
  }

  function hurtBot(bot, amount, info) {
    if (!bot.alive) return;
    // A flinch on the skeleton sells the hit far better than a particle alone.
    bot.avatar?.flinch?.();
    let left = amount;
    if (bot.shield > 0) {
      const s = Math.min(bot.shield, left);
      bot.shield -= s;
      left -= s;
      if (bot.shield <= 0) fx.burst(new THREE.Vector3(bot.pos.x, bot.pos.y + 1, bot.pos.z), '#7af6ff', 8, 3);
    }
    if (left > 0) {
      if (bot.knocked) bot.knockHp -= left;
      else bot.hp -= left;
    }
    if (!bot.knocked && bot.hp <= 0) {
      bot.knocked = true;
      bot.hp = 0;
      bot.knockHp = 100;
      if (bot.dummy) {
        // A downed range target is a beat, not a kill. The match path below emits
        // a kill feed line and the range has no feed, so without this a target
        // dropping is completely silent — the tester sees the number stop
        // changing and has no idea whether the gun broke or the dummy did.
        rangeLog.downed = { name: bot.name, t: RANGE_CALLOUT };
        audio.sfx('knock');
        fx.burst(new THREE.Vector3(bot.pos.x, bot.pos.y + 1, bot.pos.z), '#ffe566', 14, 4);
      }
      emit({ type: 'feed', killer: info.name, victim: bot.name, weapon: info.melee ? 'melee' : 'gun', knock: true, kc: '#ffd1ea', vc: bot.look.hairColor });
    }
    if (bot.knocked && bot.knockHp <= 0) eliminateBot(bot, info);
  }

  function eliminateBot(bot, info) {
    if (!bot.alive) return;
    bot.alive = false;
    bot.knocked = false;
    bot.state = 'dead';
    if (info && info.byPlayer) {
      player.kills++;
      player.hitstop = 0.05;
      rumble(220, 0.8, 0.6);
      trauma = Math.min(1, trauma + (getSettings().shake === false ? 0 : 0.45));
      audio.sfx('elim');
    }
    emit({ type: 'feed', killer: info ? info.name : 'Storm', victim: bot.name, weapon: info && info.melee ? meleeById(player.meleeId).name : 'eliminated', knock: false, kc: '#fff', vc: bot.look.hairColor });
    fx.burst(new THREE.Vector3(bot.pos.x, bot.pos.y + 1, bot.pos.z), '#ff4f9a', 14, 4);
  }

  /**
   * Single entry point for everything that damages the player — gunfire,
   * grenades, the storm and the tide.
   *
   * Alongside the health/shield maths it resolves *where* the damage came from
   * into a screen-relative angle, so the HUD can point the player at the
   * attacker instead of just flashing. Rate-limited so sustained fire produces
   * a readable pulse rather than a strobe.
   */
  function hurtPlayer(amount, info = {}) {
    if (!player.alive || clock.phase === 'end') return;
    /**
     * God mode.
     *
     * Read fresh from settings every hit rather than latched at match start, so
     * the toggle works mid-fight without a restart. It deliberately still
     * fires the hurt *feedback* -- flash, indicator, sound -- because a cheat
     * that also removes all feedback teaches you the wrong timing; you want
     * to know you were hit, you just do not die. Only the health numbers and
     * the death are suppressed.
     */
    const god = getSettings().god === true;
    if (god) {
      const gFrom = info.from;
      if (gFrom && amount > 0.01 && player.time - hurtFxAt > HURT_FX_MIN_GAP) {
        hurtFxAt = player.time;
        const dx = gFrom.x - player.pos.x;
        const dz = gFrom.z - player.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        emit({ type: 'hurt', bearing: Math.atan2(dx / len, dz / len), amount: 0, god: true });
      }
      if (!info.quiet) audio.sfx('hurt');
      return;
    }
    let left = amount;
    if (player.shield > 0) {
      const s = Math.min(player.shield, left);
      player.shield -= s;
      left -= s;
      if (player.shield <= 0) audio.sfx('shield');
    }
    if (left > 0) {
      if (player.knocked) player.knockHp -= left;
      else player.hp -= left;
      if (!info.quiet) { audio.sfx('hurt'); rumble(140, 0.6, 0.3); }
    }
    if (!info.quiet) trauma = Math.min(1, trauma + (getSettings().shake === false ? 0 : 0.28));

    const from = info.from;
    if (from && amount > 0.01 && player.time - hurtFxAt > HURT_FX_MIN_GAP) {
      hurtFxAt = player.time;
      // Emit a normalized world bearing rather than a screen angle: the HUD
      // re-derives the screen angle from the *live* camera yaw every frame, so
      // turning to face the shooter walks the indicator onto the crosshair.
      const dx = from.x - player.pos.x;
      const dz = from.z - player.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      emit({
        type: 'hurt',
        dirX: dx / len,
        dirZ: dz / len,
        angle: angleTo(from.x, from.z),
        amount,
        source: info.name || '',
        head: !!info.head,
        melee: !!info.melee,
      });
    }
    if (!player.knocked && player.hp <= 0) {
      player.hp = 0;
      player.knocked = true;
      player.knockHp = 100;
      audio.sfx('knock');
      emit({ type: 'toast', text: 'Knocked — crawl, or wait for your duo.' });
    }
    if (player.knocked && player.knockHp <= 0) killPlayer(info);
  }

  function killPlayer(info) {
    if (!player.alive) return;
    player.alive = false;
    player.knocked = false;
    player.hp = 0;
    audio.sfx('defeat');
    const aliveOthers = bots.filter((b) => b.alive).length;
    result = {
      win: false,
      placement: aliveOthers + 1,
      killer: info ? info.name : 'The storm',
    };
    clock.phase = 'end';
    inspect = false;
    emit({ type: 'toast', text: `Eliminated by ${result.killer}` });
  }

  /**
   * Turn a dummy to face whoever is shooting it.
   *
   * Cosmetic only, but it removes a real source of confusion: a target that
   * appears to be looking away can read as a facing or team bug when the thing
   * being checked is damage output.
   */
  function faceShooter(b) {
    b.yaw = Math.atan2(-(player.pos.x - b.pos.x), -(player.pos.z - b.pos.z));
  }

  function updateBots(dt) {
    const now = player.time;
    for (const b of bots) {
      if (b.state === 'bus') continue;
      if (b.state === 'glide') { glideBot(b, dt); continue; }
      // Dummies are handled before the alive checks below: a dropped dummy is
      // legitimately not alive, and those checks would skip it forever, so the
      // respawn timer would never run. The real knock-to-eliminate timer is 25s
      // of bleed, which is right for a fight and useless for a range, so the
      // range brings a target back after two.
      if (b.dummy) {
        faceShooter(b);
        if (b.knocked || !b.alive) {
          // 0.9s, not 2s. The gap is the difference between a drill you can keep
          // a rhythm through and one where you spend the time waiting. A dropped
          // target also pops back with a burst so the reset is visible even when
          // the target is behind something.
          b.respawnIn = (b.respawnIn ?? RANGE_RESPAWN) - dt;
          if (b.respawnIn <= 0) {
            b.respawnIn = null;
            b.alive = true;
            b.knocked = false;
            b.state = 'live';
            b.hp = b.spawnHp;
            b.shield = b.spawnShield;
            b.knockHp = 100;
            b.pos.copy(b.home);
            if (b.motion) {
              const setter = typeof world.setDummyPos === 'function' ? world.setDummyPos : null;
              if (setter) setter(b.dummyIndex, b.pos.x, b.pos.y, b.pos.z);
            }
            fx.burst(new THREE.Vector3(b.pos.x, b.pos.y + 1, b.pos.z), '#7dfff0', 10, 3);
          }
        }
        continue;
      }
      if (!b.alive && b.state !== 'dead') continue;
      if (!b.alive) continue;
      b.shootCd = Math.max(0, b.shootCd - dt);
      if (b.reload > 0) {
        b.reload -= dt;
        if (b.reload <= 0) b.mag = GUNS[b.gun].mag;
      }
      if (b.burst > 0) b.burst -= dt;
      else {
        b.burstWait = (b.burstWait || 0) - dt;
        if (b.burstWait <= 0) b.burst = 0.35 + Math.random() * 0.55;
      }
      stepBot(b, {
        dt, now, player, bots, zone: { x: zone.x, z: zone.z, r: zone.r },
        los: (x, y, z, x2, y2, z2) => {
          const dx = x2 - x, dy = y2 - y, dz = z2 - z;
          const len = Math.hypot(dx, dy, dz) || 1;
          const hit = raycast(x, y, z, dx / len, dy / len, dz / len, len, (o) => o === b || o === player);
          return !hit || !!hit.player || hit.bot;
        },
      });
      const intent = b.intent;
      b.yaw = intent.yaw;
      // A bot inside a royal decree is dragged and slowed: `sp` is the intent
      // speed the steering is about to rebuild its velocity from, so a slow has
      // to be applied here rather than to b.vel.
      const sp = b.knocked ? 1.6 : b.pull ? 2.1 : intent.sprint ? 6.6 : 4.6;
      const mx = intent.mx;
      const mz = intent.mz;
      const ml = Math.hypot(mx, mz) || 1;
      b.vel.x = (mx / ml) * Math.min(sp, ml);
      b.vel.z = (mz / ml) * Math.min(sp, ml);
      b.pos.x += b.vel.x * dt;
      b.pos.z += b.vel.z * dt;
      // The undertow drag. Applied after the steering step, because a bot
      // rebuilds its velocity from intent every frame and would otherwise shake
      // a velocity impulse off in a single tick. Left before pushOut so the
      // drag can never pull anyone into a wall.
      if (b.pull) {
        b.pull.t -= dt;
        if (b.pull.t <= 0) b.pull = null;
        else {
          b.pos.x += b.pull.x * b.pull.speed * dt;
          b.pos.z += b.pull.z * b.pull.speed * dt;
        }
      }
      const pushed = pushOut(b.pos.x, b.pos.z, 0.34, b.pos.y, b.pos.y + 1.6, world.boxes);
      b.pos.x = pushed.x;
      b.pos.z = pushed.z;
      // Same buoyancy as the player: a bot that ends up in the water should
      // paddle back to shore, not stand on the seabed shot-blocking forever.
      const bed = heightAt(b.pos.x, b.pos.z);
      if (bed < SEA_Y && b.pos.y < SEA_Y + 0.6) {
        b.vel.x *= Math.exp(-5.5 * dt);
        b.vel.z *= Math.exp(-5.5 * dt);
        b.vel.y += 26 * dt;
        b.vel.y *= Math.exp(-6 * dt);
        b.pos.y = Math.min(b.pos.y, SEA_Y + 0.35);
        if (b.vel.y > 0) b.vel.y = Math.min(b.vel.y, 2.2);
      } else {
        b.vel.y -= 20 * dt;
      }
      b.pos.y += b.vel.y * dt;
      const g = floorAt(b.pos.x, b.pos.z, 0.3, world.boxes, heightAt(b.pos.x, b.pos.z), b.pos.y);
      if (b.pos.y < g) { b.pos.y = g; b.vel.y = 0; }
      if (intent.revive) {
        b.revive += dt;
        const ally = b.partner ? player : bots.find((o) => o.id === b.ally);
        if (b.revive > 3.2 && ally && ally.knocked && ally.alive !== false) {
          if (ally === player) {
            player.knocked = false;
            player.hp = 45;
            player.knockHp = 100;
            audio.sfx('revive');
            emit({ type: 'toast', text: `${b.name} revived you.` });
          } else {
            ally.knocked = false;
            ally.hp = 40;
            ally.knockHp = 100;
          }
          b.revive = 0;
        }
      } else b.revive = 0;
      if (intent.fire && intent.aim && b.shootCd <= 0 && b.reload <= 0 && b.mag > 0 && !b.knocked) botShoot(b, intent.aim);
      if (b.knocked) {
        b.knockHp -= dt * 4;
        if (b.knockHp <= 0) eliminateBot(b, { name: 'Bleed' });
      }
      // soft separate
      if (Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z) < 0.7 && !player.gliding) {
        const dx = b.pos.x - player.pos.x;
        const dz = b.pos.z - player.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        b.pos.x += (dx / l) * dt;
        b.pos.z += (dz / l) * dt;
      }
    }
    }

  function glideBot(b, dt) {
    const tx = b.poi.x - b.pos.x;
    const tz = b.poi.z - b.pos.z;
    const l = Math.hypot(tx, tz) || 1;
    b.vel.x = (tx / l) * 10;
    b.vel.z = (tz / l) * 10;
    b.vel.y -= 10 * dt;
    if (b.vel.y < -7) b.vel.y = -7;
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;
    b.pos.z += b.vel.z * dt;
    const g = heightAt(b.pos.x, b.pos.z);
    if (b.pos.y <= g) {
      b.pos.y = g;
      b.vel.y = 0;
      b.state = 'live';
    }
  }

  /**
   * How hard the bots push back, as a single multiplier on their damage.
   *
   * They used to deal `falloff * 0.85` -- 85% of the player's own damage, from
   * 43 of them, with no reaction time and no miss floor. The player has 100hp
   * and a Heartbreaker lands for 16, so a single bot that acquired you held
   * its trigger for a 9-round burst and took a third of your health before you
   * finished turning. Combined with a burst that started the instant line of
   * sight was clear, a lobby of them was not a fight.
   *
   * This is the one knob for the whole roster. The rest of the nerf is
   * behavioural (see BOT_AIM below) because a damage multiplier alone still
   * leaves them snapping to you like turrets.
   */
  const BOT_DAMAGE = 0.42;

  /**
   * Bots acquire a target, then wait before the first shot.
   *
   * The single biggest reason they felt superhuman: `stepBot` set `intent.fire`
   * on the very first frame line of sight was clear, so reaction time was
   * literally zero. A human needs a beat to read "someone is there, where are
   * they, what do I shoot" -- bots skipped all three. Wobbling per bot keeps
   * the delay unpredictable, so breaking line of sight for a moment actually
   * buys something.
   */
  const BOT_AIM = {
    /** Seconds before the first shot after acquiring a target. */
    reaction: [0.42, 0.95],
    /** Rounds per burst. Then a pause, so fire is not a flat stream. */
    burst: [3, 7],
    /** Seconds between bursts. */
    cooldown: [0.35, 0.9],
    /**
     * Extra spread on top of the gun's own, as a fraction of one radian at
     * the muzzle. Distance-scaled, so a bot is dangerous in your face and
     * genuinely unreliable at 40m. The old spread was `0.03 + dist*0.0009`,
     * which at 40m is about 2 degrees -- a marksman.
     */
    jitter: 0.055,
    /** Beyond this range their fire is heavily degraded. */
    maxRange: 52,
  };

  function randRange(rng, [lo, hi]) { return lo + rng() * (hi - lo); }

  function botShoot(b, aim) {
    const spec = GUNS[b.gun];
    b.mag--;
    b.shootCd = 60 / spec.rpm;
    if (b.mag <= 0) b.reload = 1.5 + Math.random() * 0.8;
    const ox = b.pos.x;
    const oy = b.pos.y + (b.knocked ? 0.4 : 1.45);
    const oz = b.pos.z;
    let dx = aim.x - ox;
    let dy = aim.y - oy;
    let dz = aim.z - oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    // Distance error, then per-shot jitter. Both grow with range, and past
    // maxRange the jitter dominates so a bot across the map is mostly
    // shooting at where you were.
    const far = Math.max(0, len - BOT_AIM.maxRange);
    const spread = spec.spread * 1.5 + BOT_AIM.jitter * Math.min(3, 0.4 + len / 26) + far * 0.05;
    dx = dx / len + (Math.random() - 0.5) * spread;
    dy = dy / len + (Math.random() - 0.5) * spread * 0.6;
    dz = dz / len + (Math.random() - 0.5) * spread;
    const n = Math.hypot(dx, dy, dz) || 1;
    dx /= n; dy /= n; dz /= n;
    const hit = raycast(ox, oy, oz, dx, dy, dz, 90, (o) => o === b || o.team === b.team);
    const end = new THREE.Vector3(ox + dx * (hit ? hit.t : 40), oy + dy * (hit ? hit.t : 40), oz + dz * (hit ? hit.t : 40));
    // Muzzle flash comes out of the character's actual gun hand, so the shot
    // reads as coming from the weapon rather than from her chest. Procedural
    // bodies have no skeleton to pose, but they still have a chest to flash at.
    if (b.avatar) {
      b.avatar.fire?.();
      const m = b.avatar.muzzle || b.avatar.chestPoint;
      if (m) fx.muzzle(m);
    }
    if (Math.hypot(ox - player.pos.x, oz - player.pos.z) < 70) fx.tracer(new THREE.Vector3(ox, oy, oz), end, '#ff9ad2');
    if (hit && hit.player) {
      const dmg = falloffDamage(spec, hit.t) * (hit.head ? spec.head : 1) * BOT_DAMAGE;
      hurtPlayer(dmg, { name: b.name, from: { x: ox, z: oz }, head: hit.head });
    } else if (hit && hit.bot) hurtBot(hit.bot, falloffDamage(spec, hit.t) * BOT_DAMAGE, { name: b.name });
  }

  function abstractFight() {
    const far = bots.filter((b) => b.alive && !b.partner && b.state === 'live' && Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z) > 68);
    for (const b of far) {
      if (Math.random() > 0.4) continue;
      const foe = far.find((o) => o !== b && o.team !== b.team && Math.hypot(o.pos.x - b.pos.x, o.pos.z - b.pos.z) < 55);
      if (!foe) continue;
      hurtBot(foe, 12 + Math.random() * 10, { name: b.name });
    }
  }

  function updateZone(dt) {
    if (clock.phase === 'lobby' || clock.phase === 'end') return;
    const plan = ZONE_PLAN[zone.phase];
    zone.left -= dt;
    if (zone.mode === 'shrink' && plan) {
      const u = 1 - zone.left / plan.shrink;
      zone.r = Math.max(plan.to, zone.from + (plan.to - zone.from) * clamp(u, 0, 1));
    }
    if (zone.left > 0) return;
    if (!plan) { zone.r = 0; zone.dps = 22; return; }
    if (zone.mode === 'wait') {
      zone.mode = 'shrink';
      zone.from = zone.r;
      zone.left = plan.shrink;
      zone.dps = ZONE_DPS[zone.phase] || 16;
      audio.sfx('zone');
      emit({ type: 'toast', text: 'Storm closing' });
    } else {
      zone.r = plan.to;
      zone.phase++;
      const next = ZONE_PLAN[zone.phase];
      if (!next) { zone.mode = 'done'; zone.left = 9999; zone.dps = 22; zone.r = 0; return; }
      zone.mode = 'wait';
      zone.left = next.wait;
    }
  }

  function zoneDamage(dt) {
    const dps = zone.dps || (zone.mode === 'shrink' ? (ZONE_DPS[zone.phase] || 1) : 0);
    const apply = (pos, isPlayer, ref) => {
      const d = Math.hypot(pos.x - zone.x, pos.z - zone.z);
      if (d <= zone.r) return;
      const amt = (dps || 1) * dt * (ref && ref.knocked ? 1.4 : 1);
      if (isPlayer) hurtPlayer(amt, { name: 'The storm', from: { x: zone.x, z: zone.z }, quiet: true });
      else hurtBot(ref, amt, { name: 'Storm' });
    };
    if (player.alive && clock.phase === 'play' && !player.gliding) apply(player.pos, true, player);
    for (const b of bots) if (b.alive && b.state === 'live') apply(b.pos, false, b);
    if (zoneMesh) {
      zoneMesh.position.set(zone.x, 16, zone.z);
      zoneMesh.scale.set(Math.max(0.5, zone.r), 1, Math.max(0.5, zone.r));
      zoneRing.position.set(zone.x, heightAt(zone.x, zone.z) + 0.4, zone.z);
      zoneRing.scale.set(Math.max(0.5, zone.r), Math.max(0.5, zone.r), 1);
    }
  }

  function oceanDamage(dt) {
    if (!player.alive || player.gliding || clock.phase !== 'play') return;
    if (player.pos.y < -1.2 || Math.hypot(player.pos.x, player.pos.z) > 106) {
      hurtPlayer(10 * dt, { name: 'The tide', quiet: true });
      const l = Math.hypot(player.pos.x, player.pos.z) || 1;
      player.pos.x -= (player.pos.x / l) * dt * 4;
      player.pos.z -= (player.pos.z / l) * dt * 4;
    }
  }

  function buffs(dt) {
    if ((player.buffs.regen || 0) > 0) player.shield = Math.min(100, player.shield + 18 * dt);
    for (const k of Object.keys(player.buffs)) {
      player.buffs[k] -= dt;
      if (player.buffs[k] <= 0) delete player.buffs[k];
    }
    if (player.knocked && player.alive) {
      player.knockHp -= dt * (4 + ((zone.dps || 0) > 0 && Math.hypot(player.pos.x - zone.x, player.pos.z - zone.z) > zone.r ? 4 : 0));
      if (player.knockHp <= 0) killPlayer({ name: 'Bleed out' });
    }
  }

  /**
   * Signature abilities.
   *
   * An ability rides on the *candidate*, not on the player: equip a procedural
   * cutie and the decree goes away with her. That keeps the royal-court sheet
   * the single source of truth for what she can do, and stops a random locker
   * roll from handing out somebody else's magic.
   *
   * Every candidate's weakness is a rule rather than flavour text. A storm wall
   * smears the sigils, open water douses the sun court, a cascade needs a ward
   * to ground itself in, a meteor needs a planted stance, a gale needs open
   * ground, and a hungry court has nothing left to take when she is spent. The
   * HUD names the rule, so a locked decree always says why.
   */
  function activeCandidate() {
    return candidateById(look().candidate);
  }

  function candidateAbility() {
    const c = activeCandidate();
    return c && c.ability ? c.ability : null;
  }

  function inStormWall() {
    if (world.isGraybox || clock.phase !== 'play') return false;
    return zone.mode === 'shrink' && Math.hypot(player.pos.x - zone.x, player.pos.z - zone.z) > zone.r;
  }

  /** The same test the movement step uses, named so it can be read on its own. */
  function underwater() {
    return heightAt(player.pos.x, player.pos.z) < SEA_Y && player.pos.y < SEA_Y + 0.6;
  }

  function enemiesWithin(r) {
    let n = 0;
    for (const b of bots) {
      if (!b.alive || b.team === 0 || b.state === 'bus') continue;
      if (Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z) <= r) n++;
    }
    return n;
  }

  /** One predicate per id in `WEAKNESS_IDS`; an unclaimed id never locks. */
  const WEAKNESS_RULES = {
    'em-storm': () => inStormWall(),
    doused: () => underwater(),
    unshielded: () => player.shield <= 0,
    airborne: () => !player.grounded,
    surrounded: () => enemiesWithin(8) >= 3,
    exhausted: () => player.hp < 50,
  };

  function abilityLocked() {
    const c = activeCandidate();
    if (!c || !c.weakness) return false;
    const rule = WEAKNESS_RULES[c.weakness.id];
    return !!(rule && rule());
  }

  /** Everything the HUD needs, and nothing it does not. Null = no candidate. */
  function abilityState() {
    const c = activeCandidate();
    const ab = candidateAbility();
    if (!c || !ab) return null;
    const locked = abilityLocked();
    return {
      id: ab.id,
      name: ab.name,
      candidate: c.codename,
      cd: +Math.max(0, player.abilityCd).toFixed(1),
      cdMax: ab.cooldown,
      ready: player.abilityCd <= 0 && !locked,
      locked,
      lockReason: locked ? c.weakness.name : null,
    };
  }

  function updateAbility(dt, input) {
    if (player.abilityCd > 0) player.abilityCd = Math.max(0, player.abilityCd - dt);
    if (player.abilityLockSay > 0) player.abilityLockSay -= dt;
    const ab = candidateAbility();
    if (!ab || !input.abilityPressed) return;
    if (player.abilityCd > 0) { audio.sfx('dry'); return; }
    if (!player.alive || player.knocked || player.gliding) return;
    if (abilityLocked()) {
      // Once every couple of seconds is enough: a toast per keypress would be
      // punishment rather than feedback, and the wall lasts a while.
      if (player.abilityLockSay <= 0) {
        audio.sfx('dry');
        emit({ type: 'toast', text: `${ab.name} suppressed - ${activeCandidate().weakness.name}` });
        player.abilityLockSay = 2.5;
      }
      return;
    }
    castDecree(ab);
  }

  /**
   * ROYAL DECREE — the cast every candidate shares, shaped by her sheet.
   *
   * One code path, six shapes. The kind decides what the numbers mean rather
   * than which numbers exist, so a new candidate is a data change: `undertow`
   * drags victims to the eye of the sigil, `gale` blows them out of it, `burst`
   * trades the drag for a heal, `chain` arcs to the nearest few, `meteor` lands
   * a beat late on a mark in front of her, and `drain` pays back what it cuts.
   */
  function castDecree(ab) {
    const c = activeCandidate();
    const tint = abilityTint(c);
    const kind = ab.kind || 'undertow';
    player.abilityCd = ab.cooldown;
    player.abilityLockSay = 0;
    audio.sfx('decree');
    emit({ type: 'toast', text: ab.name });
    if (getSettings().shake !== false) trauma = Math.min(1, trauma + 0.3);
    // The sigil opens behind her, so nothing the camera catches sits in front
    // of the player's own face.
    const basis = planarBasis(yawPivot);
    const behind = basis.forward.clone().multiplyScalar(-1.6);
    fx.decree(new THREE.Vector3(player.pos.x + behind.x, player.pos.y, player.pos.z + behind.z), player.yaw, tint, kind);
    let drained = 0;
    if (kind === 'meteor') {
      // It falls on a mark in front of her, so she can put it where the fight
      // is going instead of on top of herself.
      const mark = new THREE.Vector3(
        player.pos.x + basis.forward.x * 5,
        player.pos.y,
        player.pos.z + basis.forward.z * 5,
      );
      fx.meteor(mark, tint, ab.fuse, ab.radius);
      falling.push({ x: mark.x, z: mark.z, t: ab.fuse, spec: ab, tint });
    } else {
      const hits = decreeVictims(ab, kind);
      let from = new THREE.Vector3(player.pos.x, player.pos.y + 1.2, player.pos.z);
      for (let i = 0; i < hits.length; i++) {
        const v = hits[i];
        // A cascade weakens with every hop; the rest bite hardest at the centre.
        const dealt = kind === 'chain' ? ab.damage * Math.pow(0.75, i) : ab.damage * (0.6 + v.u * 0.4);
        hurtBot(v.b, dealt, { name: ab.name, byPlayer: true, melee: true });
        if (kind === 'drain') drained += dealt;
        if (kind === 'chain') {
          const to = new THREE.Vector3(v.b.pos.x, v.b.pos.y + 1, v.b.pos.z);
          fx.tracer(from, to, tint);
          from = to;
        }
        // A gale blows outward, an undertow drags inward. Range targets are
        // stationary by design and never run the movement step, so arming a
        // drag on one would only leave dead state behind.
        if (!v.b.dummy && (kind === 'undertow' || kind === 'gale')) {
          const dir = kind === 'gale' ? 1 : -1;
          v.b.pull = { x: v.nx * dir, z: v.nz * dir, speed: ab.pull, t: ab.duration };
        }
        fx.burst(new THREE.Vector3(v.b.pos.x, v.b.pos.y + 1, v.b.pos.z), tint, 10, 4);
        emit({ type: 'hit', head: false });
      }
      if (kind === 'burst') player.hp = Math.min(100, player.hp + ab.heal);
    }
    const leech = kind === 'drain' ? Math.min(ab.shield, drained * ab.leech) : 0;
    player.shield = Math.min(100, player.shield + ab.shield + leech);
  }

  /** Everyone the sigil reaches, nearest first, with their falloff weight. */
  function decreeVictims(ab, kind) {
    const hits = [];
    for (const b of bots) {
      if (!b.alive || b.team === 0 || b.state === 'bus') continue;
      const dx = b.pos.x - player.pos.x;
      const dz = b.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > ab.radius) continue;
      hits.push({ b, d, nx: dx / (d || 1), nz: dz / (d || 1), u: 1 - d / ab.radius });
    }
    hits.sort((p, q) => p.d - q.d);
    // Only a cascade has a budget: the rest of the decrees take the whole ring.
    return kind === 'chain' ? hits.slice(0, Math.max(1, ab.targets)) : hits;
  }

  /** The landing beat of a RIMEFALL, kept apart from the cast that armed it. */
  function updateDecrees(dt) {
    for (let i = falling.length - 1; i >= 0; i--) {
      const f = falling[i];
      f.t -= dt;
      if (f.t > 0) continue;
      falling.splice(i, 1);
      const ab = f.spec;
      for (const b of bots) {
        if (!b.alive || b.team === 0 || b.state === 'bus') continue;
        const dx = b.pos.x - f.x;
        const dz = b.pos.z - f.z;
        const d = Math.hypot(dx, dz);
        if (d > ab.radius) continue;
        const u = 1 - d / ab.radius;
        hurtBot(b, ab.damage * (0.5 + u * 0.5), { name: ab.name, byPlayer: true, melee: true });
        // The splash drags victims back into the impact, not out of it.
        if (!b.dummy) {
          const inv = d > 0.001 ? 1 / d : 0;
          b.pull = { x: -dx * inv, z: -dz * inv, speed: ab.pull, t: ab.duration };
        }
        fx.burst(new THREE.Vector3(b.pos.x, b.pos.y + 1, b.pos.z), f.tint, 12, 5);
        emit({ type: 'hit', head: false });
      }
      if (getSettings().shake !== false) trauma = Math.min(1, trauma + 0.25);
    }
  }

  function updateGrenades(dt) {
    for (let i = grenades.length - 1; i >= 0; i--) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vy -= 12 * dt;
      g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
      const ground = heightAt(g.x, g.z);
      if (g.y < ground) { g.y = ground; g.vy *= -0.35; g.vx *= 0.7; g.vz *= 0.7; }
      if (g.fuse <= 0) {
        explode(g);
        grenades.splice(i, 1);
      }
    }
  }

  function explode(g) {
    audio.sfx('explode');
    fx.burst(new THREE.Vector3(g.x, g.y + 0.5, g.z), '#ffe566', 20, 7);
    const rad = 6.4;
    for (const b of bots) {
      if (!b.alive || b.state === 'bus') continue;
      const d = Math.hypot(b.pos.x - g.x, b.pos.z - g.z);
      if (d < rad) hurtBot(b, 100 * (1 - d / rad), { name: look().name, byPlayer: g.team === 0 });
    }
    const d = Math.hypot(player.pos.x - g.x, player.pos.z - g.z);
    if (player.alive && d < rad) hurtPlayer(90 * (1 - d / rad), { name: 'Star Grenade', from: { x: g.x, z: g.z } });
    trauma = Math.min(1, trauma + 0.5);
  }

  /** Controller rumble; silently does nothing without a pad or actuator. */
  function rumble(duration, strong, weak) {
    try {
      const gp = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(Boolean);
      const act = gp && gp.vibrationActuator;
      if (act && act.playEffect) act.playEffect('dual-rumble', { duration, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
    } catch { /* no pad, no rumble */ }
  }

  function callSupply() {
    let spot = world.anchors.drops[Math.floor(Math.random() * world.anchors.drops.length)];
    // Maps that ship no fixed drop points get one on dry ground inside the storm circle.
    for (let i = 0; !spot && i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * zone.r * 0.85;
      const x = zone.x + Math.cos(a) * r, z = zone.z + Math.sin(a) * r;
      if (heightAt(x, z) > SEA_Y + 0.6) spot = { x, z };
    }
    if (!spot) return;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.7, 1.1),
      new THREE.MeshStandardMaterial({ color: 0xffe566, emissive: 0xffb020, emissiveIntensity: 0.6 }),
    );
    mesh.position.set(spot.x, 75, spot.z);
    scene.add(mesh);
    // Wrap the beacon in a real cargo crate once the kit piece arrives.
    loadFbx(MODULAR_FBX.crate).then((fbx) => {
      const shell = instanceOf(fbx);
      fitToFootprint(shell, 1.3);
      shell.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      mesh.add(shell);
    }).catch((e) => console.error('supply crate failed', e));
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 90, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd35a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    beam.position.set(spot.x, heightAt(spot.x, spot.z) + 45, spot.z);
    scene.add(beam);
    supply.push({ x: spot.x, y: 75, z: spot.z, mesh, beam, landed: false, opened: false });
    emit({ type: 'toast', text: 'Supply drop inbound' });
  }

  function updateSupply(dt) {
    for (const s of supply) {
      if (!s.landed) {
        s.y -= 16 * dt;
        const g = heightAt(s.x, s.z) + 0.4;
        if (s.y <= g) { s.y = g; s.landed = true; audio.sfx('land'); }
        s.mesh.position.y = s.y;
        s.mesh.rotation.y += dt;
      }
      if (s.beam && !s.opened) s.beam.material.opacity = 0.28 + Math.sin(performance.now() * 0.004) * 0.1;
    }
  }

  function openSupply(s) {
    if (s.opened) return;
    s.opened = true;
    if (s.beam) { scene.remove(s.beam); s.beam.geometry.dispose(); s.beam.material.dispose(); s.beam = null; }
    rumble(180, 0.3, 0.5);
    s.mesh.material.color.set(0x7dfff0);
    addMarked('gun', Math.random() < 0.5 ? 'snip' : 'ar', s.x + 0.4, s.y, s.z);
    addMarked('item', 'aegis', s.x - 0.4, s.y, s.z);
    if (Math.random() < 0.55) addMarked('item', 'second', s.x, s.y, s.z + 0.5);
    addMarked('ammo', 'heavy', s.x, s.y, s.z - 0.5);
    audio.sfx('chest');
  }

  function checkEnd() {
    if (clock.phase === 'end') return;
    // Dummies are not opponents, so the range has no win condition. Without
    // this the first frame would declare a Victory Royale, because no dummy
    // belongs to a rival team yet nothing is standing there.
    if (world.isGraybox) return;
    const enemies = bots.some((b) => b.alive && b.team !== 0);
    if (!enemies && player.alive) {
      result = { win: true, placement: 1, killer: null };
      clock.phase = 'end';
      inspect = false;
      player.gliding = false;
      audio.sfx('victory');
      audio.setMusicDuck(true);
      emit({ type: 'toast', text: 'Victory Royale' });
    }
  }

  function spectate(dt) {
    const live = bots.find((b) => b.alive && b.partner) || bots.find((b) => b.alive);
    if (!live) return;
    orbit.theta += dt * 0.15;
  }

  function updateEnd(dt, settings) {
    emoteT = 0;
    if (result && result.win) {
      orbit.theta += dt * 0.35;
      if (Math.random() < dt * 6) fx.confetti(player.pos.clone().setY(player.pos.y + 1.5));
    }
  }

  function startEmote() {
    emoteT = 2.4;
    inspect = true;
    audio.sfx('emote');
  }

  function animateActors(dt, settings) {
    const jiggle = settings.jiggle ?? 1;
    const moving = Math.hypot(player.vel.x, player.vel.z);
    const pose = clock.phase === 'end' && result && result.win ? (look().victory || 'sparkle') : emoteT > 0 ? (look().emote || 'blowkiss') : 'idle';
    if (hero) {
      hero.group.visible = inspect || emoteT > 0 || clock.phase === 'end' || clock.phase === 'lobby' && inspect;
      const show = hero.group.visible;
      hero.group.visible = show;
      hero.setPose(pose);
      hero.update(dt, {
        speed: show ? moving : 0,
        sprint: false,
        jiggle,
        extra: clock.phase === 'end' || emoteT > 0 || inspect,
        pose,
        knocked: player.knocked && !inspect,
        dead: !player.alive && clock.phase === 'end' && result && !result.win,
        vy: player.vel.y,
      });
    }
    viewmodel.group.visible = !hero.group.visible && player.alive && clock.phase !== 'end';
    let seat = 0;
    for (const b of bots) {
      if (!b.avatar) continue;
      if (b.state === 'bus' && clock.phase === 'bus' && seat < world.ufo.seats.length) {
        const s = world.ufo.seats[seat++];
        b.avatar.group.visible = true;
        if (b.avatar.group.parent !== world.ufo.group) world.ufo.group.add(b.avatar.group);
        b.avatar.group.position.set(s.x, s.y, s.z);
        b.avatar.group.rotation.set(0, s.yaw, 0);
        b.avatar.update(dt, { jiggle: 1.2, extra: true, pose: 'idle' });
        continue;
      }
      if (b.state === 'bus') { b.avatar.group.visible = false; continue; }
      if (b.avatar.group.parent !== scene) scene.attach(b.avatar.group);
      b.avatar.group.visible = b.state !== 'dead' || player.time < 4 ? true : b.alive;
      b.avatar.group.visible = b.alive || b.state === 'dead';
      b.avatar.group.position.set(b.pos.x, b.pos.y, b.pos.z);
      if (b.state !== 'bus') b.avatar.group.rotation.y = b.yaw;
      const d = Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z);
      b.avatar.update(dt, {
        speed: Math.hypot(b.vel.x, b.vel.z),
        sprint: Math.hypot(b.vel.x, b.vel.z) > 6,
        jiggle: d < 24 ? jiggle : 0.6,
        extra: d < 12,
        knocked: b.knocked,
        dead: !b.alive,
        pose: 'idle',
        // Rig context: she shoulders the gun whenever she is engaging, so the
        // player can read whether a bot has spotted them.
        grounded: b.pos.y <= heightAt(b.pos.x, b.pos.z) + 0.3,
        aiming: !!(b.intent && b.intent.aim) && !b.knocked && b.alive,
        lookPitch: b.intent && b.intent.aim
          ? Math.atan2(
            b.intent.aim.y - (b.pos.y + 1.45),
            Math.hypot(b.intent.aim.x - b.pos.x, b.intent.aim.z - b.pos.z) || 1,
          )
          : 0,
      });
    }
  }

  /**
   * Push the authoritative player pose into the camera rig.
   *
   * The rig was otherwise only synced by applyCamera, which runs *after* the
   * gameplay update. Anything that traced a ray out of the camera during
   * updatePlay was therefore aiming from where the player stood on the previous
   * frame. At 60fps that is a 16ms lag and invisible.
   *
   * After a teleport it is not a lag, it is a different place. On the range the
   * rig is still at the world origin on the frame the player spawns, so the
   * first shot leaves (0,0,0) travelling flat along the ground, passes under
   * every dummy - whose hit spheres start at 0.43m - and reports a clean miss
   * on a target dead ahead. armForRange and the range's respawn-on-death both
   * teleport, so the very first shot after either was guaranteed to miss.
   *
   * Called from combat() so the basis is current for anything that casts this
   * frame, and again from applyCamera so the rendered pose is the one after
   * movement. eye height is smoothed in both, which makes a crouch transition
   * settle in a few frames rather than a couple of dozen - imperceptible, and
   * not worth splitting the function to avoid.
   */
  function syncRigTransform() {
    const eyeH = player.knocked ? 0.45 : player.crouch || player.slide > 0 ? 1.05 : 1.58;
    eye.position.y = lerp(eye.position.y || eyeH, eyeH, 0.2);
    yawPivot.rotation.y = player.yaw;
    pitchPivot.rotation.x = player.pitch + player.recoilP;
    pitchPivot.rotation.y = player.recoilY;
    rig.position.copy(player.pos);
  }

  function applyCamera(dt, input, settings) {
    syncRigTransform();
    const ads = aimHeld && viewmodel.group.visible && player.active < 2 && currentGun();
    if (viewmodel.group.visible) {
      const ctxSpeed = Math.hypot(player.vel.x, player.vel.z);
      viewmodel.update(dt, {
        speed: ctxSpeed,
        sprint: ctxSpeed > 6,
        ads: !!ads,
        jiggle: settings.jiggle ?? 1,
        crouch: player.crouch,
        strafe: input.moveX,
      });
    }
    trauma = Math.max(0, trauma - dt * 2.0);
    player.recoilP *= Math.exp(-12 * dt);
    player.recoilY *= Math.exp(-14 * dt);
    const sh = (settings.shake === false ? 0 : trauma * trauma);
    const t = player.time;
    const shakeX = (Math.sin(t * 37.3) * 0.5 + Math.sin(t * 71.7) * 0.3 + Math.sin(t * 113.1) * 0.2) * 0.04 * sh;
    const shakeY = (Math.sin(t * 43.1) * 0.5 + Math.sin(t * 67.3) * 0.3 + Math.sin(t * 97.7) * 0.2) * 0.03 * sh;
    const shakeR = (Math.sin(t * 53.7) * 0.5 + Math.sin(t * 89.1) * 0.5) * 0.025 * sh;
    pitchPivot.rotation.set(player.pitch + player.recoilP, player.recoilY, shakeR);
    pitchPivot.position.set(shakeX, shakeY, 0);
    rig.position.copy(player.pos);
    const hip = settings.fov || 78;
    const sprintFov = (Math.hypot(player.vel.x, player.vel.z) > 6.5) ? hip + 4 : hip;
    const targetFov = ads ? 48 : player.dashCd > 0.85 ? hip + 10 : sprintFov;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = lerp(camera.fov, targetFov, 0.15);
      camera.updateProjectionMatrix();
    }
    const third = inspect || emoteT > 0 || clock.phase === 'end' || (!player.alive && clock.phase === 'end');
    if (third || (!player.alive && clock.phase === 'play')) {
      if (input && (inspect || clock.phase === 'end')) {
        orbit.theta -= input.lookX * 1.2;
        orbit.phi = clamp(orbit.phi - input.lookY * 1.2, 0.35, 1.45);
        orbit.radius = clamp(orbit.radius - input.moveY * dt * 4, 1.4, 7);
      }
      const focusY = player.pos.y + 1.05;
      cine.position.set(
        player.pos.x + Math.sin(orbit.theta) * Math.sin(orbit.phi) * orbit.radius,
        focusY + Math.cos(orbit.phi) * orbit.radius * 0.85,
        player.pos.z + Math.cos(orbit.theta) * Math.sin(orbit.phi) * orbit.radius,
      );
      cine.lookAt(player.pos.x, focusY, player.pos.z);
    }
    // The storm tint is a match-mode affordance: it tells you the sky is
    // closing in. The range has no storm, and its neutral fog is what makes a
    // 100m target readable, so it is left exactly as the map built it.
    if (scene.fog && !world.isGraybox) {
      const outside = Math.hypot(player.pos.x - zone.x, player.pos.z - zone.z) > zone.r && clock.phase === 'play';
      scene.fog.color.set(outside ? 0x8a4fe0 : 0xf7c6e4);
      scene.fog.near = outside ? 12 : 40;
      scene.fog.far = outside ? 110 : 155;
    }
  }

  function partnerBot() { return bots.find((b) => b.partner); }

  function fillSnap(settings) {
    const spec = player.active === 2 ? meleeById(player.meleeId) : (currentGun() || meleeById(player.meleeId));
    const gun = player.active < 2 ? player.guns[player.active] : null;
    const alive =  (player.alive ? 1 : 0) + bots.filter((b) => b.alive).length;
    const ptn = partnerBot();
    snap.phase = clock.phase;
    snap.hp = Math.max(0, player.hp);
    snap.shield = Math.max(0, player.shield);
    snap.knockHp = player.knockHp;
    snap.knocked = player.knocked;
    // Dummies are not survivors, so the alive count on the range is always the
    // player. A "37 remaining" readout while shooting a training target is
    // exactly the kind of wrong-looking number that erodes trust in the HUD.
    snap.aliveCount = world.isGraybox ? (player.alive ? 1 : 0) : alive;
    snap.kills = player.kills;
    snap.weaponName = spec.name;
    snap.weaponKind = spec.kind || 'gun';
    snap.mag = gun ? gun.mag : 0;
    snap.reserve = gun ? (player.ammo[GUNS[gun.id].ammo] || 0) : 0;
    snap.ads = !!aimHeld;
    snap.scope = !!(aimHeld && gun && gun.id === 'snip');
    snap.spread = spec.kind === 'gun' ? spec.spread + player.bloom : 0;
    snap.gliding = player.gliding;
    snap.low = player.hp > 0 && player.hp <= 30;
    snap.lobby = Math.max(0, clock.lobby);
    snap.bus = clock.bus / BUS_TIME;
    snap.countdown = clock.phase === 'bus' && clock.intro > 0 ? Math.ceil(clock.intro) : 0;
    snap.match = clock.match;
    snap.result = result;
    if (world.isGraybox) {
      // No storm on the range, so the HUD shows nothing about one. Leaving the
      // island's countdown up would imply a circle that does not exist.
      snap.zoneDanger = false;
      snap.zoneText = '';

      // The range instrument panel. Without these numbers "does the gun feel
      // right" is a vibe, and falloff in particular cannot be judged by eye at
      // 100m - so publish the actual curve at the measured gates instead of
      // making the tester walk out to each one and count body shots.
      const gunSpec = currentGun();
      const curve = (world.gates || []).map((m) => ({
        m,
        dmg: gunSpec ? +falloffDamage(gunSpec, m).toFixed(1) : 0,
      }));
      snap.range = {
        gun: gunSpec ? gunSpec.id : null,
        gunName: gunSpec ? gunSpec.name : spec.name,
        base: gunSpec ? gunSpec.dmg : 0,
        rpm: gunSpec ? gunSpec.rpm : 0,
        pellets: gunSpec ? gunSpec.pellets : 1,
        // Live cone, base plus accumulated bloom. The crosshair scales off this
        // same number, so seeing it move explains why the crosshair opened up.
        spread: +(snap.spread || 0).toFixed(4),
        curve,
        last: rangeLog.last,
        shots: player.shots,
        hits: player.hits,
        accuracy: player.shots ? Math.round((player.hits / player.shots) * 100) : 0,
        damage: Math.round(player.damage),
        headshots: rangeLog.headshots,
        furthest: rangeLog.furthest,
        // The drill half of the panel. These are what turn the range from a
        // measurement rig into something you want to re-run: a score to beat, a
        // streak to protect, and a per-lane breakdown that answers "which
        // distance is this gun actually good at".
        score: rangeLog.score,
        streak: rangeLog.streak,
        bestStreak: rangeLog.bestStreak,
        lanes: Object.keys(rangeLog.lanes).map((k) => ({ name: k, hits: rangeLog.lanes[k] })),
        downed: rangeLog.downed ? rangeLog.downed.name : null,
        /** How long the session has been live, for a live drill timer. */
        elapsed: rangeTime,
      };
    } else {
      snap.zoneDanger = Math.hypot(player.pos.x - zone.x, player.pos.z - zone.z) > zone.r;
      const plan = ZONE_PLAN[zone.phase];
      snap.zoneText = zone.mode === 'shrink' ? `Storm ${zone.left.toFixed(0)}s` : plan ? `Calm ${Math.max(0, zone.left).toFixed(0)}s` : 'Final circle';
    }
    snap.channel = player.channel ? 1 - player.channel.t / player.channel.max : 0;
    syncInvSnapshot();
    snap.buffs = Object.keys(player.buffs).map((id) => ({ id, name: CRYSTALS[id]?.name || id, t: player.buffs[id], color: CRYSTALS[id]?.color || '#fff' }));
    snap.partner = ptn ? { name: ptn.name, hp: ptn.hp, shield: ptn.shield, knocked: ptn.knocked, alive: ptn.alive, dist: Math.hypot(ptn.pos.x - player.pos.x, ptn.pos.z - player.pos.z) } : null;
    const interact = built ? focusedInteract() : null;
    if (player.channel && player.channel.id && player.channel.id !== 'revive') {
      snap.prompt = { text: ITEMS[player.channel.id]?.name || 'Using', action: null };
    } else if (interact && interact.type === 'chest') snap.prompt = { text: 'Open chest', action: 'interact' };
    else if (interact && interact.type === 'supply') snap.prompt = { text: 'Open supply drop', action: 'interact' };
    else if (interact && interact.type === 'gun') snap.prompt = { text: `Take ${GUNS[interact.pickup.id].name}`, action: 'interact' };
    else if (interact && interact.type === 'revive') snap.prompt = { text: `Revive ${interact.bot.name}`, action: 'interact' };
    else if (clock.phase === 'bus') snap.prompt = { text: 'Drop', action: 'jump' };
    else if (clock.phase === 'lobby') snap.prompt = { text: inspect ? 'Back to FPS' : 'Inspect waifu', action: 'inspect' };
    else snap.prompt = null;
    snap.dots = [{ x: player.pos.x, z: player.pos.z, kind: 'you' }];
    if (ptn && ptn.alive && ptn.state !== 'bus') snap.dots.push({ x: ptn.pos.x, z: ptn.pos.z, kind: 'ally' });
    for (const b of bots) {
      if (!b.alive || b.partner || b.state === 'bus') continue;
      if (Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z) < 85) snap.dots.push({ x: b.pos.x, z: b.pos.z, kind: 'enemy' });
    }
    for (const s of supply) if (!s.opened) snap.dots.push({ x: s.x, z: s.z, kind: 'drop' });
    // The range has no storm, so the minimap must not draw one. It was drawing
    // the island's opening circle centred 38m off the firing line, which is a
    // thing that does not exist here — and a player who trusts the minimap to
    // mean something stops trusting the numbers on the range panel too.
    snap.zone = world.isGraybox ? null : { x: zone.x, z: zone.z, r: zone.r };
    // The minimap's POI layer is a list of island landmarks. On the range it
    // plotted four places that are not on this map. The lanes take their place.
    snap.isRange = !!world.isGraybox;
    // God mode is on the snapshot so the HUD can say so. A cheat that gives no
    // indication is a cheat that gets left on and quietly invalidates a whole
    // playtest.
    snap.god = getSettings().god === true;
    snap.lanes = world.isGraybox
      ? (world.gates || []).map((m) => ({ z: world.spawn.z - m }))
      : [];
    snap.yaw = player.yaw;
    snap.px = player.pos.x;
    snap.pz = player.pos.z;
    // The compass is the one HUD element that is unconditionally about the
    // island. On the range it was still drawing Neon Grove, Skyline, Downtown
    // and Lagoon — four landmarks that do not exist on this map, pointing at
    // four places you can never go. The range has its own bearings worth
    // showing: the measured lanes, which are the only landmarks it has.
    if (world.isGraybox) {
      snap.compass = (world.gates || []).map((m) => ({
        name: `${m}m`,
        color: '#7dfff0',
        ang: bearingTo(player.pos.x, player.pos.z, 0, world.spawn.z - m, player.yaw),
      }));
    } else {
      // Landmarks come from the map that was actually built, not from the
      // module-level POIS list. Reading the global here is what made the
      // compass lie on the range, and adding a second island map would have
      // quietly repeated it: the HUD would have pointed at "Downtown" and
      // "Neon Grove" on a map that has neither.
      snap.compass = (world.pois || POIS).map((p) => ({
        name: p.name, color: p.color, ang: angleTo(p.x, p.z),
      }));
      // The minimap plots the same list, so hand it over rather than letting
      // the shell reach for its own copy.
      snap.pois = world.pois || POIS;
    }
    /*
     * No floating name tags.
     *
     * There were up to 28 of them at once -- every bot inside 28m printed its
     * name over its head -- and that is the single loudest thing on the screen
     * in a fight. It obscured the targets the player is shooting at, and it
     * gave away exactly where every enemy was without the player having to
     * look for them.
     *
     * Fortnite shows no name over an enemy either. The information that was
     * actually being carried here is not lost: the compass still gives bearing,
     * the hit direction indicators still show where damage came from, and the
     * kill feed still names who died. What is gone is the free wallhack.
     *
     * The loop that filled this array is deleted rather than gated on a
     * setting, so a half-disabled nametag system cannot come back through a
     * stale reference.
     */
    snap.labels = [];
    snap.stats = {
      kills: player.kills,
      damage: Math.round(player.damage),
      accuracy: player.shots ? Math.round((player.hits / player.shots) * 100) : 0,
      revived: player.revived,
      time: clock.match,
    };
    snap.inspect = inspect || emoteT > 0 || clock.phase === 'end';
    snap.melee = player.active === 2;
    snap.ability = abilityState();
    if (inputItemCycle.pending) {
      /* placeholder to keep lints calm */
    }
  }

  const inputItemCycle = { pending: false };

  function labelFor(name, pos, y, kind, cam) {
    _to.set(pos.x, pos.y + y, pos.z).project(cam);
    return { name, kind, x: _to.x * 0.5 + 0.5, y: -_to.y * 0.5 + 0.5, on: _to.z < 1 };
  }

  function angleTo(x, z) {
    return bearingTo(player.pos.x, player.pos.z, x, z, player.yaw);
  }

  function resize(w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    cine.aspect = w / h;
    cine.updateProjectionMatrix();
  }

  function activeCamera() {
    if (!built) return camera;
    if (inspect || emoteT > 0 || clock.phase === 'end' || (!player.alive && clock.phase !== 'lobby' && clock.phase !== 'bus')) return cine;
    return camera;
  }

  function setCaptureWanted() {
    return inspect || emoteT > 0 || clock.phase === 'end';
  }

  function buildHero() {
    if (hero && hero.group.parent) yawPivot.remove(hero.group);
    hero = createWaifu(look(), 'full');
    yawPivot.add(hero.group);
    hero.group.visible = false;
    heroModel = look().model || 'procedural';
  }

  function applyProfile() {
    player.meleeId = look().melee || player.meleeId;
    if (hero && heroModel !== (look().model || 'procedural')) buildHero();
    if (hero) {
      hero.setLook(look());
      hero.attachWeapon(null);
    }
    viewmodel.setLook({ ...look(), _weapon: player.active === 2 ? player.meleeId : (currentGun()?.id || player.meleeId) });
  }

  // D-pad item cycle happens from UI via this hook.
  function cycleItem(dir) {
    if (!player.inv.slots.some(Boolean)) return;
    stepSelection(player.inv, dir);
    player.itemIndex = player.inv.selected;
  }

  function selectItem(i) {
    if (player.inv.slots[i]) {
      player.itemIndex = i;
      player.inv.selected = i;
    }
  }

  /** Sort + merge the bag, from the inventory screen's SORT button. */
  function sortItems() {
    const specOf = (id) => ITEMS[id] || null;
    sortInventory(player.inv, specOf);
    mergeStacks(player.inv, specOf);
    player.itemIndex = player.inv.selected;
    audio.sfx('pickup');
    emit({ type: 'toast', text: 'Inventory sorted' });
  }

  function moveItem(from, to) {
    const ok = swapSlots(player.inv, from, to);
    if (ok) player.itemIndex = player.inv.selected;
    return ok;
  }

  /**
   * Arm a specific weapon in the first-person viewmodel.
   *
   * Only exists for the render harness. The pistol is the one weapon here backed
   * by a real GLB, and the graybox range arms the Heartbreaker, so without this
   * the pistol's in-hand appearance is never exercised by anything. It has to
   * hang off the match rather than be reached by importing viewmodel.js from a
   * probe: that yields a second module instance, and a second instance has its
   * own viewmodel, not the one on screen.
   *
   * Note this is a *view* override: update() re-arms from the equipped gun every
   * frame, so a caller that wants the pistol to persist must pause the match.
   */
  function setViewmodelWeapon(id) {
    viewmodel.setWeapon(id, look().wrap, look().charm);
    return true;
  }

  return {
    scene, camera, cine, buildStep, update, pull, reset, resize, activeCamera,
    setCaptureWanted, applyProfile, cycleItem, selectItem, skipBus, setViewmodelWeapon,
    sortItems, moveItem, dropItem,
    // Guarded: `world.cityBounds` is optional, and a map that omits it made
    // this throw a TypeError the first time the render harness asked for the
    // city extent to frame its inspection cameras.
    cityBounds: () => (world && typeof world.cityBounds === 'function' ? world.cityBounds() : null),
    /**
     * Bot health. A single NaN position turns a bot's muzzle flashes, tracers
     * and loot beams into NaN-transformed meshes, which rasterise as large black
     * rectangles floating in the sky    so count them rather than chase ghosts.
     */
    /**
     * Grant items directly, for the render harness and for testing the bag
     * without walking the whole island to find a chest. Same code path the
     * ground pickup uses, so what renders here is what a real pickup renders.
     */
    debugGiveItem: (id, n = 1) => {
      const spec = ITEMS[id];
      if (!spec) return { ok: false, reason: `no such item: ${id}` };
      const res = addItem(player.inv, id, n, spec);
      return { ...res, used: occupied(player.inv), cap: player.inv.capacity };
    },
    /** Live bag contents, for the harness to assert against the DOM. */
    debugInventory: () => player.inv.slots.map((s, i) => (s ? { i, id: s.id, count: s.count } : { i, empty: true })),
    /** The top-down island image for the HUD minimap. Built on first ask. */
    mapImage: () => (built ? buildMapImage() : null),
    mapRadius: () => ISLAND_R * 1.12,
    debugBots: () => {
      const bad = [];
      let grounded = 0;
      for (const b of bots) {
        if (!Number.isFinite(b.pos.x) || !Number.isFinite(b.pos.y) || !Number.isFinite(b.pos.z)) {
          if (bad.length < 5) bad.push({ name: b.name, pos: [b.pos.x, b.pos.y, b.pos.z], state: b.state, team: b.team });
          continue;
        }
        if (b.state !== 'bus' && b.state !== 'glide') grounded++;
      }
      const states = {};
      for (const b of bots) states[b.state] = (states[b.state] || 0) + 1;
      return { total: bots.length, nonFinite: bots.length - bad.length === 0 ? 0 : undefined, bad, grounded, states };
    },
    /**
     * Per-bot rig truth, for the "is the cast actually animated" question.
     *
     * A count of avatars proves nothing on its own: an actor can have an avatar
     * object, be marked visible, and still be a static procedural mesh with a
     * skin attached rather than a loaded GLB rig. This reports what each actor
     * actually *is* — which model, whether that model resolved to a real mesh,
     * and whether the rig has a skeleton to animate — so "the cast is not
     * showing up" can be separated into "never created", "created but never
     * told to load", and "loaded but not rigged", which look identical in a
     * screenshot and need completely different fixes.
     */
    debugCast: () => bots.map((b) => {
      const v = b.avatar;
      let meshes = 0;
      let skinned = 0;
      let bones = 0;
      if (v && v.group) {
        v.group.traverse((o) => {
          if (!o.isMesh) return;
          meshes += 1;
          if (o.isSkinnedMesh) {
            skinned += 1;
            bones += o.skeleton ? o.skeleton.bones.length : 0;
          }
        });
      }
      return {
        name: b.name,
        dummy: !!b.dummy,
        model: (b.look && b.look.model) || null,
        hasAvatar: !!v,
        visible: !!(v && v.group && v.group.visible),
        meshes,
        skinned,
        bones,
        // What is actually driving the pose right now. `rig` and `clips` are
        // different: a GLB can be rigged and still be animated procedurally, and
        // before this existed a model shipping 33 unused clips looked identical
        // to one playing them.
        animSource: v ? (v.animSource || 'unknown') : 'none',
        clips: v && v.clipNames ? v.clipNames : null,
        // Whether a load is still in flight. A permanent 1 here is a model that
        // silently 404'd or a manifest that never arrived.
        loading: !!(v && v.load && (v.load.state === 'loading' || v.load.state === 'idle')),
        loadState: (v && v.load && v.load.state) || (v ? 'no-load-field' : null),
      };
    }),
    /** Where the player is and what the zone is doing — for map QA. */
    debugState: () => ({
      px: +player.pos.x.toFixed(1),
      py: +player.pos.y.toFixed(1),
      pz: +player.pos.z.toFixed(1),
      gliding: !!player.gliding,
      alive: !!player.alive,
      zone: { x: +zone.x.toFixed(1), z: +zone.z.toFixed(1), r: +zone.r.toFixed(1), left: Math.round(zone.left) },
      distFromZoneCentre: +Math.hypot(player.pos.x - zone.x, player.pos.z - zone.z).toFixed(1),
      outside: Math.hypot(player.pos.x - zone.x, player.pos.z - zone.z) > zone.r && clock.phase === 'play',
      fog: { color: `#${scene.fog.color.getHexString()}`, near: scene.fog.near, far: scene.fog.far },
      islandR: ISLAND_R,
      groundUnderPlayer: +heightAt(player.pos.x, player.pos.z).toFixed(2),
    }),
    ready: () => built, phase: () => clock.phase,
    // Refresh the bag fields on read, so the loadout screen is correct even
    // while the simulation is paused and update() is not running.
    snapshot: () => { syncInvSnapshot(); return snap; },
    /**
     * The live bots, not a copy.
     *
     * `debugBots` answers "is anything broken"; integration tests need to stand
     * a target somewhere and read back what a hit did to it, and the real bot
     * objects are the only ones `hurtBot` will ever touch. `player` is already
     * handed out raw for the same reason.
     */
    bots: () => bots,
    player, getResult: () => result,

    /**
     * The live ground loot, not a copy.
     *
     * A battle royale is unplayable if the weapons are not where the player can
     * reach them, and neither `snapshot()` nor the HUD reports a single pickup -
     * they are deliberately invisible to the player, so a map that spawned no
     * guns at all would look completely normal from the outside. The smoke
     * tests seed their own bots and guns, so nothing else in the repo can catch
     * it. This hands out the raw array for the same reason `bots()` does.
     */
    pickups: () => pickups,

    /**
     * Terrain height at a point, ignoring buildings.
     *
     * Probes need this to tell open ground from a rooftop: `player.pos.y` is the
     * real surface the player is standing on, while `heightAt` is the ground
     * beneath it, and the gap between the two is exactly what tells you whether
     * a loot marker is reachable or is sitting under a building.
     */
    heightAt: (x, z) => heightAt(x, z),

    /**
     * The live collision boxes, for map QA.
     *
     * `heightAt` deliberately ignores buildings, so it cannot answer "how tall is
     * this map" - only the box list can, since the boxes are what actually stop a
     * bullet and block a sight line. The island was reported as a maze of floors
     * and sky buildings, and the difference between the terrain profile and the
     * top of the tallest box is exactly that complaint made measurable.
     */
    worldBoxes: () => (world ? world.boxes : []),

    /**
     * Re-point the viewmodel at whatever is equipped.
     *
     * `syncWeapon` is internal, but every measurement that swaps guns needs it:
     * the viewmodel caches the weapon it was last told to build, so swapping
     * `player.guns[active]` behind its back leaves the punch/kick decay running
     * on the previous gun's viewmodel. Exposing it is cheaper and far less
     * error-prone than the alternative of a weapon-switch input the test would
     * have to discover.
     */
    syncWeapon,
  };
}
