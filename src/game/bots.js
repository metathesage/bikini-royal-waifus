import { BOT_NAMES, POIS, rollLook } from '../data/catalog.js';
import { PICK_GUNS, GUNS } from './weapons.js';
import { getPsxRoster } from '../data/assets.js';

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeBot(id, name, team, seed, rng) {
  const look = rollLook(mulberry(seed + 99));
  look.name = name;
  const gun = PICK_GUNS[Math.floor(rng() * PICK_GUNS.length)];
  return {
    id,
    name,
    team,
    ally: null,
    partner: team === 0,
    look,
    pos: { x: 0, y: -30, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    hp: 100,
    shield: Math.floor(rng() * 40),
    knocked: false,
    knockHp: 100,
    alive: true,
    state: 'bus',
    dropU: 0.1 + rng() * 0.8,
    poi: POIS[Math.floor(rng() * POIS.length)],
    gun,
    mag: GUNS[gun].mag,
    reload: 0,
    shootCd: 0,
    burst: 0,
    /**
     * Engagement state for the reaction/burst model. `targetId` is who they
     * are currently shooting at; changing it costs a fresh reaction delay.
     */
    targetId: null,
    reactionT: 0,
    burstLeft: 0,
    burstCd: 0,
    revive: 0,
    kills: 0,
    think: rng(),
    home: null,
  };
}

export function createRoster(playerName) {
  const rng = mulberry(Math.floor(Math.random() * 1e9));
  const names = BOT_NAMES.filter((n) => n !== playerName);
  const bots = [];
  const partner = makeBot(0, names[0] || 'Momo', 0, 1, rng);
  partner.partner = true;
  partner.dropU = 0.22;
  bots.push(partner);
  let ni = 1;
  // 10 duos + partner: enough to find fights on a 64m island without a wipe in minute one.
  for (let team = 1; team <= 10; team++) {
    const a = makeBot(bots.length, names[ni++] || `Waifu ${team}a`, team, team * 10 + 3, rng);
    const b = makeBot(bots.length + 1, names[ni++] || `Waifu ${team}b`, team, team * 10 + 9, rng);
    a.ally = b.id;
    b.ally = a.id;
    bots.push(a, b);
  }
  return bots;
}

/**
 * How a bot acquires and sustains fire.
 *
 * These are the numbers that decide whether the lobby is a fight or a
 * firing squad. Before them, a bot opened fire on the frame it gained line of
 * sight and held a flat nine-round burst forever, so walking into the open
 * was a 200ms death sentence no matter what you did.
 *
 *   reaction   - the beat between seeing you and shooting. Wobbled per bot so
 *                a group does not open in unison, which reads as terrifying
 *                rather than as fair.
 *   burst      - rounds before it stops to think. Short enough that cover
 *                works.
 *   burstGap   - the pause afterwards. This is the window you fight in.
 */
const BOT_REACTION = [0.45, 1.05];
const BOT_BURST = [3, 6];
const BOT_BURST_GAP = [0.4, 1.0];

/**
 * Character ids that ship real animation clips.
 *
 * These are dealt to a slice of the roster so an actual match contains walkers.
 * The PSX library the rest of the cast is drawn from is 45 distinct bodies, but
 * every one of them is a static FBX with no clips, so they are all animated by
 * the procedural rig - which slides rather than steps. A handful of properly
 * animated bodies is what makes the island read as a game with people in it
 * rather than a shooting range with mannequins.
 */
export const ANIMATED = ['sofia_anime'];

/**
 * Give the roster real bodies.
 *
 * The PSX library is 45 distinct rigged female characters at ~250 KB each, so
 * every bot could have had her own face and outfit for a fraction of what one
 * 117 MB locker download costs. That trade is currently reversed: the PSX
 * models are static FBX files with no animation clips, so they are all driven
 * by the procedural rig, which *slides* rather than steps, and they do not
 * interact convincingly with a weapon. On screen that reads as a crowd of
 * mannequins shuffling around a map.
 *
 * So the roster now draws only from `ANIMATED` -- the three models that ship
 * real clips -- and the PSX library is off by default. Passing
 * `usePsx: true` brings it back, which is the escape hatch if the duplicated
 * silhouettes turn out to read worse than the sliding, and it is the first
 * thing to try when more rigged models land.
 *
 * `animatedEvery` deals the three models round-robin. 1 gives every bot the
 * same model; 3 is a third each, which is what ships.
 */
export async function assignBotModels(bots, { usePsx = false, animatedEvery = 3 } = {}) {
  const roster = usePsx ? await getPsxRoster() : [];
  const bag = [];
  bots.forEach((b, i) => {
    if (animatedEvery > 0) {
      b.look.model = ANIMATED[i % ANIMATED.length | 0];
      return;
    }
    if (!roster.length) return;
    if (!bag.length) {
      const next = roster.slice();
      for (let k = next.length - 1; k > 0; k--) {
        const s = Math.floor(Math.random() * (k + 1));
        [next[k], next[s]] = [next[s], next[k]];
      }
      bag.push(...next);
    }
    const entry = bag.pop();
    if (entry) b.look.model = entry.id;
  });
  return bots;
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function steer(bot, tx, tz, speed) {
  const dx = tx - bot.pos.x;
  const dz = tz - bot.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  bot.intent.mx = (dx / len) * speed;
  bot.intent.mz = (dz / len) * speed;
  bot.intent.yaw = Math.atan2(-dx / len, -dz / len);
}

export function stepBot(bot, ctx) {
  const intent = { mx: 0, mz: 0, yaw: bot.yaw, fire: false, aim: null, revive: false, sprint: false };
  bot.intent = intent;
  if (!bot.alive || bot.state === 'bus' || bot.state === 'glide') return;

  const { player, bots, zone, los } = ctx;
  bot.think -= ctx.dt;
  const me = bot.pos;

  if (bot.knocked) {
    const away = bots.find((o) => o.alive && !o.knocked && o.team !== bot.team && dist2(o.pos, me) < 20 * 20);
    if (away) steer(bot, me.x * 2 - away.pos.x, me.z * 2 - away.pos.z, 1.7);
    return;
  }

  const ally = bot.partner
    ? (player.alive ? player : null)
    : bots.find((o) => o.id === bot.ally && o.alive);

  if (ally && ally.knocked && dist2(ally.pos || ally, me) < 18 * 18) {
    const ax = ally.pos ? ally.pos.x : ally.x;
    const az = ally.pos ? ally.pos.z : ally.z;
    steer(bot, ax, az, 6.4);
    intent.sprint = true;
    if (dist2({ x: ax, z: az }, me) < 2.3 * 2.3) intent.revive = true;
    return;
  }

  let threat = null;
  let best = 42 * 42;
  const pool = [player, ...bots];
  for (const o of pool) {
    if (!o || o === bot || !o.alive || o.team === bot.team) continue;
    if (o.state === 'bus') continue;
    const p = o.pos || o;
    const d = dist2(p, me);
    if (d < best) { best = d; threat = o; }
  }

  const outside = Math.hypot(me.x - zone.x, me.z - zone.z) > zone.r - 2;
  if (outside) {
    steer(bot, zone.x, zone.z, 7);
    intent.sprint = true;
    threat = best < 22 * 22 ? threat : null;
  }

  if (threat && best < 46 * 46) {
    const tp = threat.pos || threat;
    const sees = los(me.x, me.y + 1.45, me.z, tp.x, tp.y + 1.2, tp.z);
    const strafe = Math.sin(ctx.now * 1.7 + bot.id) * 4;
    const dx = tp.x - me.x;
    const dz = tp.z - me.z;
    const len = Math.hypot(dx, dz) || 1;
    const px = -dz / len;
    const pz = dx / len;
    const keep = len < 10 ? -1 : len > 22 ? 1 : 0;
    intent.mx = px * strafe + (dx / len) * keep * 4.5;
    intent.mz = pz * strafe + (dz / len) * keep * 4.5;
    intent.yaw = Math.atan2(-dx / len, -dz / len);
    if (sees && bot.reload <= 0) {
      intent.aim = { x: tp.x, y: (tp.y || 0) + (threat.knocked ? 0.4 : 1.35), z: tp.z };
      /**
       * Reaction time, then bursts.
       *
       * Previously `intent.fire` was true on the first frame line of sight was
       * clear, and stayed true for a flat 9-round burst -- so every bot in
       * range opened the instant it turned a corner and dumped a full mag.
       * There was no beat to read the situation, no break in the fire, and
       * no reason ever to break line of sight.
       *
       * Now a bot takes a per-bot reaction delay the first time it acquires a
       * target, fires a short burst, then pauses long enough to be punished.
       * The delay resets only when the target is actually lost, so ducking
       * behind cover genuinely buys the seconds it should.
       */
      if (bot.targetId !== threat.id) {
        bot.targetId = threat.id;
        bot.reactionT = BOT_REACTION[0] + Math.random() * (BOT_REACTION[1] - BOT_REACTION[0]);
        bot.burstLeft = 0;
      }
      if (bot.reactionT > 0) bot.reactionT -= ctx.dt;
      if (bot.burstCd > 0) {
        bot.burstCd -= ctx.dt;
      } else if (bot.burstLeft <= 0) {
        bot.burstLeft = BOT_BURST[0] + Math.floor(Math.random() * (BOT_BURST[1] - BOT_BURST[0] + 1));
      }
      if (bot.reactionT <= 0 && bot.burstLeft > 0) {
        intent.fire = true;
        bot.burstLeft--;
        if (bot.burstLeft <= 0) {
          bot.burstCd = BOT_BURST_GAP[0] + Math.random() * (BOT_BURST_GAP[1] - BOT_BURST_GAP[0]);
        }
      }
    } else {
      // Lost them. Forget the engagement so the next sighting costs a fresh
      // reaction delay rather than continuing the burst.
      bot.targetId = null;
      bot.burstLeft = 0;
    }
    return;
  }
  bot.targetId = null;

  const home = bot.poi;
  const dHome = Math.hypot(home.x - me.x, home.z - me.z);
  if (dHome > 8) steer(bot, home.x, home.z, 5.2);
  else {
    const ang = ctx.now * 0.4 + bot.id;
    steer(bot, home.x + Math.cos(ang) * 6, home.z + Math.sin(ang) * 6, 3.2);
  }
}
