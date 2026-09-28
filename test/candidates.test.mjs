/**
 * Royal candidate tests.
 *
 * A candidate is not a part, it is a sheet: one `CANDIDATES` entry decides a
 * whole look, a signature melee and a signature ability at once. Every hop in
 * that chain has a silent failure mode — a part id that is not in the catalog
 * just renders one card fewer, a melee id that is not in `MELEE` quietly falls
 * back to the katana, a palette that drifts from the look paints her decree a
 * colour she is not wearing. So every hop is asserted against the real catalogs
 * rather than a copy of them, for every candidate on the court.
 *
 * The abilities themselves are exercised through a live match on the graybox:
 * the cast, the cooldown, each kind's own bite and the shield. Two weakness
 * rules need the island — a closing ring and open water — so those halves live
 * in smoke.mjs; every other rule is player state and is driven here.
 */
import * as THREE from 'three';
import { installAssetFetch } from './asset-fetch.mjs';

installAssetFetch();

// The graybox paints its gate numbers onto a canvas; node has no DOM, so hand
// it a 2d context that swallows every call, exactly as smoke.mjs does.
const ctx2d = new Proxy({}, { get: () => () => {} });
globalThis.document = {
  createElement() {
    return { width: 128, height: 128, getContext: () => ctx2d };
  },
};

const {
  CANDIDATES, ABILITY_KINDS, WEAKNESS_IDS,
  candidateById, candidateLook, paletteColor, roleColor, abilityTint,
} = await import('../src/data/candidates.js');
const {
  DEFAULT_LOOK, DEFAULT_SETTINGS, BODIES, FACES, MAKEUP, HAIR, TOPS, BOTTOMS,
  PATTERNS, ACCESSORIES, WRAPS, CHARMS, EMOTES, VICTORIES, LOADINGS, BANNERS,
  MODELS, bindingLabel, keyLabel,
} = await import('../src/data/catalog.js');
const { MELEE, meleeById } = await import('../src/game/weapons.js');
const { createWeaponMesh, createViewmodel } = await import('../src/avatar/viewmodel.js');
const { createFx } = await import('../src/vfx/fx.js');
const { createMatch } = await import('../src/game/match.js');

const failures = [];
function check(cond, msg) {
  if (!cond) failures.push(msg);
}
const HEX = /^#[0-9a-f]{6}$/i;

/* --- Every sheet must describe parts that actually exist -------------- */
{
  const lists = {
    body: BODIES, face: FACES, makeup: MAKEUP, hair: HAIR, top: TOPS, bottom: BOTTOMS,
    pattern: PATTERNS, wrap: WRAPS, charm: CHARMS, emote: EMOTES, victory: VICTORIES,
    loading: LOADINGS, banner: BANNERS, model: MODELS,
  };
  const seenIds = new Set();
  const seenCodenames = new Set();
  const seenLetters = new Set();
  for (const c of CANDIDATES) {
    const who = c.codename || c.id;
    check(!seenIds.has(c.id), `duplicate candidate id ${c.id}`);
    check(!seenCodenames.has(c.codename), `duplicate codename ${c.codename}`);
    check(!seenLetters.has(c.candidate), `duplicate court letter ${c.candidate}`);
    seenIds.add(c.id);
    seenCodenames.add(c.codename);
    seenLetters.add(c.candidate);

    for (const field of ['candidate', 'codename', 'name', 'title', 'clearance', 'background', 'hair', 'outfit', 'combat']) {
      check(typeof c[field] === 'string' && c[field].length > 0, `${who} is missing ${field}`);
    }
    for (const field of ['ability', 'weakness', 'weapon']) {
      check(c[field] && typeof c[field] === 'object', `${who} is missing ${field}`);
    }

    // Palette: unique chips, real hexes, and a lookup that agrees with them.
    check(Array.isArray(c.palette) && c.palette.length >= 2, `${who} has no palette`);
    const chipIds = new Set();
    for (const p of c.palette || []) {
      check(!chipIds.has(p.id), `${who} has a duplicate palette chip ${p.id}`);
      chipIds.add(p.id);
      check(HEX.test(p.hex), `${who} palette chip ${p.id} is not a hex colour: ${p.hex}`);
      check(typeof p.name === 'string' && p.name.length > 0, `${who} palette chip ${p.id} has no name`);
      check(paletteColor(c, p.id) === p.hex, `${who} palette lookup disagrees for ${p.id}`);
    }
    check(paletteColor(c, 'no-such-chip', '#123456') === '#123456', `${who} palette fallback is broken`);

    // Ability numbers have to be usable, not merely present. The kind decides
    // which numbers the cast reads, so that is the list to check against.
    const ab = c.ability || {};
    const kind = ABILITY_KINDS[ab.kind];
    check(!!kind, `${who} casts "${ab.kind}", which no rule in the match implements`);
    check(typeof ab.id === 'string' && ab.id.length > 0, `${who} ability has no id`);
    check(typeof ab.name === 'string' && ab.name.length > 0, `${who} ability has no name`);
    check(typeof ab.blurb === 'string' && ab.blurb.length > 0, `${who} ability has no blurb`);
    check(ab.cooldown > 0, `${who} ability cooldown is ${ab.cooldown}`);
    check(ab.radius > 0, `${who} ability radius is ${ab.radius}`);
    check(ab.damage > 0, `${who} ability damage is ${ab.damage}`);
    check(ab.shield > 0, `${who} ability shield is ${ab.shield}`);
    for (const field of (kind ? kind.fields : [])) {
      check(ab[field] > 0, `${who} ${ab.kind} ability has no ${field} (${ab[field]})`);
    }
    check(!!c.weakness && typeof c.weakness.name === 'string' && c.weakness.name.length > 0, `${who} has no weakness`);
    check(WEAKNESS_IDS.includes(c.weakness && c.weakness.id), `${who} has a weakness the match cannot enforce: ${c.weakness && c.weakness.id}`);

    // Every look slot resolves, or the locker renders around the hole.
    for (const [field, list] of Object.entries(lists)) {
      check(list.some((x) => x.id === c.look[field]), `${who} look.${field}="${c.look[field]}" is not in the catalog`);
    }
    check(Object.values(MELEE).some((m) => m.id === c.look.melee), `${who} look.melee="${c.look.melee}" is not a melee`);
    for (const a of c.look.accessories || []) {
      check(ACCESSORIES.some((x) => x.id === a), `${who} accessory "${a}" is not in the catalog`);
    }

    // Sheet and look must agree: a candidate whose hair is not a chip on her
    // own palette is a candidate whose card lies about her. The role map is
    // what makes that check work for a court of six different palettes.
    check(c.look.candidate === c.id, `${who} look.candidate is ${c.look.candidate}, not ${c.id}`);
    check(c.look.name === c.name && c.look.title === c.title, `${who} look name/title drifted from the sheet`);
    for (const role of ['hair', 'eye', 'cloth', 'trim']) {
      const chip = (c.paletteRoles || {})[role];
      check(!!chip && chipIds.has(chip), `${who} paletteRoles.${role} is not one of her chips (${chip})`);
      const slot = role === 'hair' ? 'hairColor' : role;
      check(roleColor(c, role, null) === paletteColor(c, chip, null), `${who} roleColor(${role}) disagrees with her chip`);
      check(c.look[slot] === roleColor(c, role, null), `${who} look.${slot} is not her ${chip} chip`);
    }
    // The decree is tinted from her sheet too, so magic and costume cannot drift.
    check(chipIds.has(ab.tint), `${who} tints her decree with ${ab.tint}, which is not her chip`);
    check(abilityTint(c, null) === paletteColor(c, ab.tint, null), `${who} decree tint disagrees with the sheet`);
    check(c.look.melee === c.weapon.melee, `${who} look.melee is not her signature weapon`);
  }
  check(CANDIDATES.length >= 5, `the royal court only has ${CANDIDATES.length} on it`);
}

/* --- Candidate A, as the sheet is written ---------------------------- */
{
  const a = candidateById('thalassa');
  check(!!a, 'Candidate A (thalassa) is missing from the roster');
  if (a) {
    check(a.candidate === 'A', `Candidate A is labelled ${a.candidate}`);
    check(a.codename === 'THALASSA', `Candidate A codename is ${a.codename}`);
    check(a.clearance === 'S', `Candidate A clearance is ${a.clearance}`);
    check(a.background === 'Deep-Sea Royal Guard', `Candidate A background is ${a.background}`);
    check(a.ability.name === 'ROYAL DECREE: UNDERTOW', `Candidate A ability is ${a.ability.name}`);
    check(a.ability.kind === 'undertow', `Candidate A ability kind is ${a.ability.kind}`);
    check(/electromagnetic storm/i.test(a.weakness.name), `Candidate A weakness is ${a.weakness.name}`);
    check(/ponytail/i.test(a.hair), 'Candidate A hair line lost the high ponytail');
    check(/one-piece/i.test(a.outfit), 'Candidate A outfit line lost the one-piece');
    check(/forearms/i.test(a.combat), 'Candidate A combat line lost the forearm blades');
    check(/spear/i.test(a.weapon.name), `Candidate A weapon is ${a.weapon.name}`);
    check(a.look.hair === 'pony', `Candidate A hair is ${a.look.hair}, not the high ponytail`);
    check(a.look.melee === 'spear', `Candidate A melee is ${a.look.melee}`);
    check(a.look.wet === true, 'Candidate A lost the wet look');
    check(a.look.glow === true, 'Candidate A lost the hard-light glow');
    // Pearl white, deep navy, champagne gold, aquamarine — in the sheet's order.
    const order = a.palette.map((p) => p.id).join(',');
    check(order === 'pearl,navy,gold,aqua', `Candidate A palette is ${order}`);
  }
}

/* --- Every court's letter, name and codename actually differ --------- */
{
  const names = new Set();
  const weapons = new Set();
  const abilities = new Set();
  for (const c of CANDIDATES) {
    names.add(c.name.toLowerCase());
    weapons.add(c.weapon.melee);
    abilities.add(c.ability.id);
  }
  check(names.size === CANDIDATES.length, 'two candidates share a name');
  check(weapons.size === CANDIDATES.length, 'two candidates share a signature weapon');
  check(abilities.size === CANDIDATES.length, 'two candidates share a signature ability');
}

/* --- candidateLook() has to be a complete, storable look -------------- */
{
  check(candidateLook('no-such-candidate') === null, 'an unknown candidate produced a look');
  for (const c of CANDIDATES) {
    const look = candidateLook(c.id);
    for (const key of Object.keys(DEFAULT_LOOK)) {
      check(key in look, `${c.codename} look is missing the "${key}" slot`);
    }
    // The locker persists looks through JSON in localStorage, so anything that
    // cannot round-trip is a slot that resets on reload.
    const json = JSON.stringify(look);
    check(JSON.stringify(JSON.parse(json)) === json, `${c.codename} look does not survive a JSON round trip`);
    check(look.candidate === c.id, `${c.codename} look lost its candidate id`);
  }
  // A hand-built waifu has no candidate, and therefore no ability.
  check(DEFAULT_LOOK.candidate === null, 'the default look carries a candidate');
  check(candidateById(DEFAULT_LOOK.candidate) === null, 'the default look resolves to a candidate');
}

/* --- The ability binding is reachable and its own --------------------- */
{
  const code = DEFAULT_SETTINGS.bindings.ability;
  check(typeof code === 'string' && code.startsWith('Key'), `ability binding is ${code}`);
  check(keyLabel(code) === 'Z', `ability key label is ${keyLabel(code)}`);
  check(bindingLabel('ability').length > 0, 'the ability binding has no label');
  const shared = Object.entries(DEFAULT_SETTINGS.bindings).filter(([, v]) => v === code);
  check(shared.length === 1, `ability binding ${code} is shared with ${shared.map(([k]) => k).join(', ')}`);
}

/* --- Every signature weapon is a real melee --------------------------- */
{
  for (const c of CANDIDATES) {
    const spec = MELEE[c.weapon.melee];
    const who = c.codename;
    check(!!spec, `${who} signs with "${c.weapon.melee}", which is not in MELEE`);
    if (!spec) continue;
    check(spec.kind === 'melee', `${who} melee ${spec.id} kind is ${spec.kind}`);
    check(Array.isArray(spec.combo) && spec.combo.length >= 3, `${who} melee ${spec.id} needs a combo, not a single hit`);
    check(spec.combo.every((d, i) => i === 0 || d > spec.combo[i - 1]), `${who} melee ${spec.id} combo does not escalate`);
    for (const field of ['range', 'step', 'gap', 'lunge']) {
      check(spec[field] > 0, `${who} melee ${spec.id} has no ${field}`);
    }
    check(typeof spec.blurb === 'string' && spec.blurb.length > 0, `${who} melee ${spec.id} has no blurb`);
    check(meleeById(spec.id).id === spec.id, `meleeById does not return ${spec.id}`);
  }
  check(meleeById('no-such-melee').id === 'katana', 'an unknown melee no longer falls back to the katana');
}

/* --- The tide spear -------------------------------------------------- */
{
  const spear = MELEE.spear;
  check(!!spear, 'the tide spear is missing from MELEE');
  if (spear) {
    check(spear.range > MELEE.katana.range, `spear reach ${spear.range} is not longer than the katana's ${MELEE.katana.range}`);
    check(/sidearm/i.test(spear.blurb), 'the spear blurb lost the hydro sidearm');
  }
}

/* --- Every signature weapon builds, and mounts in the viewmodel ------- */
{
  const vm = createViewmodel();
  // The same context the match hands it: a missing field is NaN, and the view
  // sway multiplies it straight into a quaternion.
  const ctx = { speed: 0, sprint: false, ads: false, jiggle: 1, crouch: false, strafe: 0 };
  for (const c of CANDIDATES) {
    const mesh = createWeaponMesh(c.weapon.melee, c.look.wrap, c.look.charm);
    let parts = 0;
    mesh.traverse((o) => { if (o.isMesh) parts++; });
    check(parts >= 6, `${c.codename}'s ${c.weapon.melee} built only ${parts} meshes`);
    check(mesh.userData.id === c.weapon.melee, `${c.codename}'s ${c.weapon.melee} mesh reports ${mesh.userData.id}`);

    vm.setWeapon(c.weapon.melee, c.look.wrap, c.look.charm);
    for (let i = 0; i < 5; i++) vm.update(1 / 60, ctx);
    vm.slash();
    for (let i = 0; i < 5; i++) vm.update(1 / 60, ctx);
    let offenders = 0;
    vm.group.traverse((o) => {
      o.updateMatrixWorld(true);
      for (const v of o.matrixWorld.elements) if (!Number.isFinite(v)) offenders++;
    });
    check(offenders === 0, `${c.codename}'s ${c.weapon.melee} put ${offenders} non-finite transform(s) on screen`);
  }
}

/* --- The spear mesh splits, and only while a cut is live -------------- */
{
  const mesh = createWeaponMesh('spear', 'void', 'moon');
  let parts = 0;
  mesh.traverse((o) => { if (o.isMesh) parts++; });
  check(parts >= 8, `the spear built ${parts} meshes`);
  const split = mesh.userData.split;
  check(!!split && !!split.head && !!split.sidearm, 'the spear mesh has no split assembly');
  if (split) {
    check(split.sidearm.visible === false, 'the hydro sidearm is showing on a sheathed spear');

    const vm = createViewmodel();
    vm.setWeapon('spear', 'void', 'moon');
    let live = null;
    vm.group.traverse((o) => { if (o.userData && o.userData.split) live = o.userData.split; });
    check(!!live, 'the viewmodel did not mount a split spear');
    if (live) {
      const ctx = { speed: 0, sprint: false, ads: false, jiggle: 1, crouch: false, strafe: 0 };
      for (let i = 0; i < 5; i++) vm.update(1 / 60, ctx);
      check(live.sidearm.visible === false, 'the sidearm unfolded while idle');
      check(Math.abs(live.head.position.z - live.home.z) < 1e-6, 'the head drifted off the shaft while idle');

      vm.slash();
      vm.update(1 / 60, ctx);
      check(live.sidearm.visible === true, 'a cut did not unfold the hydro sidearm');
      check(live.head.position.z > live.home.z + 0.1, `the head did not slide down the shaft (${live.head.position.z} vs ${live.home.z})`);

      // meleeT decays at 3.2/s, so a slash is over inside half a second.
      for (let i = 0; i < 40; i++) vm.update(1 / 60, ctx);
      check(live.sidearm.visible === false, 'the sidearm never folded back in');
      check(Math.abs(live.head.position.z - live.home.z) < 1e-6, 'the head never returned home');
    }
  }
}

/* --- The sigil, in every shape a decree can open ---------------------- */
{
  const scene = new THREE.Scene();
  const f = createFx(scene);
  const pos = new THREE.Vector3(2, 0, -3);

  // The sigil pool is the only effect made of groups full of rings: two rings,
  // six rune shards and six blades apiece.
  const pool = [];
  scene.traverse((o) => {
    if (!o.isGroup) return;
    let meshes = 0;
    let rings = 0;
    o.traverse((k) => {
      if (!k.isMesh) return;
      meshes++;
      if (k.geometry.type === 'TorusGeometry') rings++;
    });
    if (meshes >= 14 && rings >= 8) pool.push(o);
  });
  check(pool.length > 0, 'the decree sigil is not in the fx scene');
  check(pool.every((g) => g.visible === false), 'the sigil pool is visible before any cast');

  if (pool.length) {
    // Every kind paints from its own sheet and opens exactly one sigil.
    for (const kind of Object.keys(ABILITY_KINDS)) {
      f.decree(pos, Math.PI / 2, '#4fe3d0', kind);
      const open = pool.filter((g) => g.visible);
      check(open.length === 1, `${open.length} sigils opened for one ${kind} decree`);
      const sigil = open[0] || pool[0];
      const meshes = [];
      sigil.traverse((k) => { if (k.isMesh) meshes.push(k); });
      const before = meshes.map((m) => m.position.clone());

      check(Math.abs(sigil.position.x - pos.x) < 1e-6 && Math.abs(sigil.position.y - (pos.y + 1.15)) < 1e-6, `the ${kind} sigil did not open on the caster`);
      check(Math.abs(sigil.rotation.y - Math.PI / 2) < 1e-6, `the ${kind} sigil ignored the caster yaw`);
      check(meshes.some((m) => m.material.color.getHexString() === '4fe3d0'), `the ${kind} sigil did not take the palette colour`);

      for (let i = 0; i < 30; i++) f.update(1 / 60);
      check(meshes.some((m, i) => m.position.distanceTo(before[i]) > 1e-3), `the ${kind} blades never moved`);
      let offenders = 0;
      scene.traverse((o) => {
        if (!o.isMesh && !o.isLight) return;
        o.updateMatrixWorld(true);
        for (const v of o.matrixWorld.elements) if (!Number.isFinite(v)) offenders++;
      });
      check(offenders === 0, `${offenders} ${kind} sigil transform(s) went non-finite`);

      // Run the whole life out so the next kind starts from a clean pool.
      for (let i = 0; i < 240; i++) f.update(1 / 60);
      check(pool.every((g) => g.visible === false), `a ${kind} sigil outlived its life`);
    }

    // A cast with a broken position must be refused, not parked at NaN.
    f.decree({ x: NaN, y: 0, z: 0 });
    for (let i = 0; i < 240; i++) f.update(1 / 60);
    check(pool.every((g) => g.visible === false), 'the sigil never closed after its life ran out');
  }

  /* The falling shard behind Candidate D's RIMEFALL. */
  {
    // A shard and its mark travel together, so the pool is the parent group:
    // the group owns the visibility, exactly as it does for the sigils.
    const pool = [];
    scene.traverse((o) => {
      if (!o.isGroup) return;
      let cones = 0;
      let rings = 0;
      o.traverse((k) => {
        if (!k.isMesh) return;
        if (k.geometry.type === 'ConeGeometry') cones++;
        if (k.geometry.type === 'TorusGeometry') rings++;
      });
      if (cones === 1 && rings === 1) pool.push(o);
    });
    check(pool.length === 2, `the meteor pool is ${pool.length} groups, not 2`);
    check(pool.every((g) => g.visible === false), 'a meteor is falling before any cast');

    f.meteor(new THREE.Vector3(4, 0, 4), '#9fe8ff', 0.5, 8);
    const open = pool.filter((g) => g.visible);
    check(open.length === 1, `${open.length} meteors were released for one RIMEFALL`);
    if (open.length) {
      const shard = open[0].children.find((k) => k.geometry.type === 'ConeGeometry');
      const start = shard.position.y;
      f.update(1 / 30);
      check(shard.position.y < start, 'the meteor shard did not fall');
      for (let i = 0; i < 60; i++) f.update(1 / 60);
      check(pool.every((g) => g.visible === false), 'the meteor never landed and cleared');
    }
    f.meteor({ x: NaN, y: 0, z: 0 }, '#9fe8ff', 0.5, 8);
    for (let i = 0; i < 60; i++) f.update(1 / 60);
    check(pool.every((g) => g.visible === false), 'a meteor with no position was cast anyway');
  }
}

/* --- The decrees, through a live match on the graybox ---------------- */
{
  const settings = {
    mouse: 0.002, gamepad: 2, fov: 78, invert: false, volume: 0, music: 0, jiggle: 1,
    assist: true, shake: false, text: 1, touch: false, bindings: { ...DEFAULT_SETTINGS.bindings },
  };
  const audio = { sfx() {}, setMusicDuck() {}, apply() {} };
  let look = candidateLook('thalassa');
  const match = createMatch({ getSettings: () => settings, audio, getLook: () => look, map: 'graybox' });

  const yieldTick = () => new Promise((r) => setTimeout(r, 0));
  let p = 0;
  for (let i = 0; i < 200 && p < 1; i++) {
    p = match.buildStep();
    await yieldTick();
  }
  check(p >= 1, `the graybox never finished building (${p})`);
  match.reset();
  check(match.phase() === 'play', `the range did not reach the play phase (${match.phase()})`);

  const input = {
    moveX: 0, moveY: 0, lookX: 0, lookY: 0, fire: false, aim: false,
    jumpHeld: false, jumpPressed: false, crouchHeld: false, crouchPressed: false,
    sprint: false, reloadPressed: false, interactPressed: false, interactHeld: false,
    meleePressed: false, abilityPressed: false, dashPressed: false, usePressed: false,
    swapPressed: false, inspectPressed: false, emotePressed: false, scoreHeld: false,
    pausePressed: false, confirmPressed: false, backPressed: false,
    uiLeft: false, uiRight: false, uiUp: false, uiDown: false,
    weaponSlot: 0, itemPrev: false, itemNext: false, device: 'keyboard',
  };

  const target = match.bots().find((b) => b.dummy && b.alive);
  check(!!target, 'the range has no live target to cast at');
  /** A gate dummy takes damage like anything else, so put it back between runs. */
  const revive = (b) => {
    b.alive = true;
    b.knocked = false;
    b.state = 'live';
    b.hp = b.spawnHp;
    b.shield = b.spawnShield;
    b.knockHp = 100;
    b.pull = null;
  };

  if (target) {
    for (const c of CANDIDATES) {
      const ab = c.ability;
      look = candidateLook(c.id);
      match.applyProfile();
      // Clear the rest of the range so a rule about crowds cannot fire while
      // this candidate's own cast is being measured, and give her the state
      // her own rule needs to stay open.
      for (const b of match.bots()) if (b !== target) b.pos.set(0, 0, 90);
      revive(target);
      match.player.abilityCd = 0;
      match.player.hp = 100;
      match.player.shield = 60;
      match.player.pos.set(target.pos.x, target.pos.y, target.pos.z + 3);
      match.player.yaw = 0;   // the dummy sits dead ahead, at -Z
      match.update(1 / 60, input);

      const snap = match.snapshot();
      check(!!snap.ability, `${c.codename} published no ability to the HUD`);
      check(snap.ability && snap.ability.name === ab.name, `${c.codename} HUD reads ${snap.ability && snap.ability.name}`);
      check(snap.ability && snap.ability.candidate === c.codename, `${c.codename} HUD credits ${snap.ability && snap.ability.candidate}`);
      check(snap.ability && snap.ability.locked === false, `${c.codename} was locked on a calm range with a shield up`);
      check(snap.ability && snap.ability.ready === true, `${c.codename} was not ready on a fresh range`);

      const full = target.hp + target.shield;
      const before = full;
      match.pull(); // drain the boot events so the cast can be read on its own
      input.abilityPressed = true;
      match.update(1 / 60, input);
      input.abilityPressed = false;

      check(Math.abs(match.player.abilityCd - ab.cooldown) < 1e-6, `${c.codename} left the cooldown at ${match.player.abilityCd}, not ${ab.cooldown}`);
      check(match.player.shield >= Math.min(100, ab.shield), `${c.codename}'s decree did not shield her (${match.player.shield})`);
      const toasts = match.pull().filter((e) => e.type === 'toast').map((e) => e.text);
      check(toasts.includes(ab.name), `${c.codename} announced "${toasts.join(' / ')}" instead of the decree`);

      // A meteor lands a beat late, so the hit is only due after the fuse.
      if (ab.kind === 'meteor') {
        check(target.hp + target.shield === before, `${c.codename}'s meteor hit before it fell`);
      }

      // Run the fuse out, then the rest of the effect, with the target kept up.
      const frames = Math.ceil((ab.kind === 'meteor' ? ab.fuse : 0.1) * 60) + 6;
      for (let i = 0; i < frames; i++) {
        match.player.hp = 100;
        target.pos.set(match.player.pos.x, target.pos.y, match.player.pos.z - 3);
        match.update(1 / 60, input);
      }
      check(target.hp + target.shield < before, `${c.codename}'s decree did nothing to a target inside it`);
      check(target.pull === undefined || target.pull === null, 'a stationary range target was armed with a drag');

      // A refused cast must not hand the ability back.
      const cdAfterCast = match.player.abilityCd;
      const shieldAfterCast = match.player.shield;
      input.abilityPressed = true;
      match.update(1 / 60, input);
      input.abilityPressed = false;
      check(match.player.abilityCd <= cdAfterCast, `${c.codename} cast again while cooling`);
      check(Math.abs(match.player.shield - shieldAfterCast) < 1e-6, `${c.codename} paid out a second time on cooldown`);
      check(match.snapshot().ability.ready === false, `${c.codename}'s HUD still calls the decree ready while it cools`);

      // And it has to come back.
      for (let i = 0; i < 60; i++) match.update(1 / 60, input);
      check(match.player.abilityCd < cdAfterCast - 0.9, `${c.codename}'s cooldown barely moved (${cdAfterCast} -> ${match.player.abilityCd})`);
    }
  }

  /* --- Weaknesses are rules, and the range can prove half of them ---- */
  {
    for (const c of CANDIDATES) {
      const id = c.weakness.id;
      look = candidateLook(c.id);
      match.applyProfile();
      match.player.abilityCd = 0;
      match.player.hp = 100;
      match.player.shield = 60;
      match.player.grounded = true;
      for (const b of match.bots()) if (b !== target) b.pos.set(0, 0, 90);
      if (target) {
        revive(target);
        target.pos.set(40, 0, 40);
      }
      match.player.pos.set(0, 0, 0);
      match.update(1 / 60, input);
      const open = match.snapshot().ability;
      check(open && open.locked === false, `${c.codename} started locked on a calm range (${id})`);

      // Drive the rule, then read the HUD back.
      if (id === 'unshielded') match.player.shield = 0;
      else if (id === 'airborne') match.player.pos.y = 6;   // genuinely off the floor
      else if (id === 'exhausted') match.player.hp = 20;
      else if (id === 'surrounded') {
        for (const b of match.bots()) b.pos.set(2, 0, 2);
      } else if (id === 'em-storm' || id === 'doused') {
        // A closing ring and open water are island features; smoke.mjs drives
        // these two, and the range cannot honestly fake either of them.
        continue;
      }
      match.update(1 / 60, input);
      const locked = match.snapshot().ability;
      check(!!locked && locked.locked === true, `${c.codename}'s ${id} weakness never suppressed her decree`);
      check(!!locked && locked.lockReason === c.weakness.name, `${c.codename} is locked but says "${locked && locked.lockReason}"`);

      // A suppressed cast is a refusal, not a punishment.
      input.abilityPressed = true;
      match.update(1 / 60, input);
      input.abilityPressed = false;
      check(match.player.abilityCd === 0, `${c.codename} burned ${match.player.abilityCd}s on a suppressed cast`);
    }
  }

  // No candidate, no decree: the ability belongs to the sheet, not the player.
  look = { ...DEFAULT_LOOK };
  match.applyProfile();
  match.player.abilityCd = 0;
  match.player.shield = 0;
  input.abilityPressed = true;
  match.update(1 / 60, input);
  input.abilityPressed = false;
  check(match.snapshot().ability === null, 'a hand-built waifu got a royal decree');
  check(match.player.shield === 0, 'an ability fired for a waifu who has none');
}

if (failures.length) {
  for (const f of failures) console.error(f);
  console.error(`${failures.length} candidate problem(s)`);
  process.exit(1);
}
console.log(`candidates ok (${CANDIDATES.length} on the royal roster)`);
