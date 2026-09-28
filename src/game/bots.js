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
  for (let team = 1; team <= 21; team++) {
    const a = makeBot(bots.length, names[ni++] || `Waifu ${team}a`, team, team * 10 + 3, rng);
    const b = makeBot(bots.length + 1, names[ni++] || `Waifu ${team}b`, team, team * 10 + 9, rng);
    a.ally = b.id;
    b.ally = a.id;
    bots.push(a, b);
  }
  return bots;
}

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
const ANIMATED = ['soldier_rigged', 'ual1_standard', 'miyazawa_fighter'];

/**
 * Give the roster real bodies.
 *
 * The PSX library is 45 distinct rigged female characters at ~250 KB each, so
 * every bot can have her own face and outfit for a fraction of what one
 * 117 MB locker download costs. Ids are dealt out round-robin (shuffled, so two
 * bots rarely open with the same model) and a slice of the roster stays on the
 * procedural body as visual variety.
 *
 * `animatedEvery` controls how often a bot is given a clip-driven model. Set it
 * high to make the island mostly static bodies again.
 *
 * Returns a promise so callers can await the manifest before building avatars.
 */
export async function assignBotModels(bots, { proceduralEvery = 7, animatedEvery = 3 } = {}) {
  const roster = await getPsxRoster();
  const bag = [];
  bots.forEach((b, i) => {
    // Every Nth bot keeps the procedural body.
    if (i % proceduralEvery === proceduralEvery - 1) return;
    // Every Nth of the rest gets a model with real animation clips.
    if (animatedEvery > 0 && i % animatedEvery === 0) {
      b.look.model = ANIMATED[(i / animatedEvery) % ANIMATED.length | 0];
      return;
    }
    if (!roster.length) return;
    if (!bag.length) {
      // Refill with a shuffled copy so a long match still varies.
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
      intent.fire = bot.burst > 0;
    }
    return;
  }

  const home = bot.poi;
  const dHome = Math.hypot(home.x - me.x, home.z - me.z);
  if (dHome > 8) steer(bot, home.x, home.z, 5.2);
  else {
    const ang = ctx.now * 0.4 + bot.id;
    steer(bot, home.x + Math.cos(ang) * 6, home.z + Math.sin(ang) * 6, 3.2);
  }
}
