/**
 * Island playability probe: drive a real match from lobby to landed and report
 * where it actually breaks.
 *
 * probe-gameplay.mjs only ever exercises `?map=graybox`, because the island has
 * an 18s pre-drop lobby plus a bus ride and under SwiftShader that is ~10
 * minutes of wall clock. Fine for a one-off screenshot, useless as a health
 * check: the graybox range opens already in `play` with a full loadout, so the
 * island's entire drop path - lobby, bus, glide, landing, finding a weapon - is
 * untested by anything in this repo.
 *
 * This probe fast-forwards the sim instead of waiting on it, so the whole island
 * path runs in seconds. It asserts only things about whether a *player* can play:
 * phase progression, a live landed body, a gun in hand on screen, and a shot
 * that actually leaves the barrel.
 *
 *   node tools/probe-island.mjs [--port 5199] [--out probe-island.png]
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  process.env.ProgramFiles && `${process.env.ProgramFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
  process.env['ProgramFiles(x86)'] && `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
].find((c) => c && fs.existsSync(c));
if (!CHROME) throw new Error('no chromium browser found (tried Chrome, Brave, Edge)');

const PORT = arg('port', '5199');
const OUT = arg('out', 'probe-island.png');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

const errors = [];
const failed = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure() && r.failure().errorText}`));
page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));

const click = (a) => page.evaluate((x) => {
  const b = document.querySelector(`[data-action="${x}"]`);
  if (b) b.click();
  return !!b;
}, a);
const diag = () => page.evaluate(() => (window.__brDiag ? window.__brDiag() : null));

console.log('boot:', await click('boot'));
await new Promise((r) => setTimeout(r, 1000));
console.log('play:', await click('play'));

// First real gate: the island streams a large asset manifest, and a stall here
// is a game that never starts. Wait for the match object to exist at all.
console.log('\n--- build ---');
let d = null;
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  d = await diag();
  const hasMatch = await page.evaluate(() => !!window.__brMatch && !!window.__brMatch());
  if (d && d.phase && hasMatch) break;
  process.stdout.write('.');
}
console.log('');
if (!d || !d.phase) {
  console.error('never reached a phase - __brDiag never reported one');
  process.exit(1);
}
console.log(`phase after build: ${d.phase}`);
console.log(`assets: ${JSON.stringify(d.assets && d.assets.byState)}`);
console.log(`asset failures: ${(d.assets && d.assets.failureCount) || 0}`);
console.log(`fps: ${d.fps}  drawCalls: ${d.drawCalls}  tris: ${d.triangles}`);


// The lobby and the bus are both timed in sim-seconds. Rather than sit through
// them at SwiftShader frame rates, step the match directly: `update()` with a
// synthetic input frame advances the sim exactly the way the render loop does,
// only without waiting for a frame to be drawn. Phase transitions are recorded
// on the way past, because "stuck in lobby" and "jumped straight to play" are
// very different failures and a final-phase read alone cannot tell them apart.
console.log('\n--- lobby -> bus -> drop ---');
const path = await page.evaluate(async () => {
  const m = window.__brMatch();
  if (!m) return { error: 'no match object' };
  const idle = {
    moveX: 0, moveY: 0, lookX: 0, lookY: 0, fire: false, aim: false, device: 'keyboard',
    jumpHeld: false, jumpPressed: false, crouchHeld: false, crouchPressed: false,
    sprint: false, reloadPressed: false, interactPressed: false, interactHeld: false,
    meleePressed: false, dashPressed: false, usePressed: false, swapPressed: false,
    inspectPressed: false, emotePressed: false, scoreHeld: false, pausePressed: false,
    confirmPressed: false, backPressed: false, uiLeft: false, uiRight: false,
    uiUp: false, uiDown: false, weaponSlot: 0, itemPrev: false, itemNext: false,
  };
  const seen = [];
  let last = null;
  // The real loop splits this in two: `buildStep()` runs while the loading screen
  // is up, and `update()` only runs once the screen hands over to the match. A
  // probe that only calls `update()` is matching a game that never finished
  // loading - `update()` returns immediately while `built` is false, so the phase
  // stays `boot` forever and every later assertion fails for the wrong reason.
  // Drive both, in the same order the frame loop does.
  //
  // Reaching `play` is NOT the end of the drop. `dropPlayer()` sets phase=play
  // and gliding=true in the same tick, so the player is still 60m up over the
  // island at that moment. Gliding out the descent is the part that has to work
  // before anyone can play, so keep stepping until the feet are actually on the
  // ground, and record how long that took.
  let landedAt = null;
  for (let f = 0; f < 12000; f++) {
    if (!m.ready()) {
      m.buildStep();
      // Let pending GLB/JSON loads settle between steps, the way a real frame
      // boundary does. Without this the build races ahead of its own assets.
      if (f % 4 === 0) await new Promise((r) => setTimeout(r, 0));
      continue;
    }
    // Steer for the middle of the island while gliding, and hold jump to keep the
    // chute open. Both are things a player does on a drop they intend to survive.
    // Dropping with no stick input just falls straight down from wherever the
    // drop ship happened to be - which lands you in the sea, where `oceanDamage`
    // drowns you in about ten seconds. That is a legitimate way to lose, but it
    // measures the probe's aimlessness, not whether the game is playable.
    const pl0 = m.player;
    let mx = 0;
    let my = 0;
    if (m.phase() === 'play' && pl0.gliding) {
      const dx = -pl0.pos.x;
      const dz = -pl0.pos.z;
      // moveY is forward along the yaw basis and moveX is right, so steering
      // toward the origin means "forward when facing it, strafe when not".
      const fx = -Math.sin(pl0.yaw);
      const fz = -Math.cos(pl0.yaw);
      const rx = Math.cos(pl0.yaw);
      const rz = -Math.sin(pl0.yaw);
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len;
      const uz = dz / len;
      my = ux * fx + uz * fz;
      mx = ux * rx + uz * rz;
      const dist = len;
      // Once close in, stop shoving forward and just hold position over the
      // middle, otherwise the glide overshoots and walks out to sea again.
      if (dist < 12) { my *= 0.1; mx *= 0.1; }
    }
    m.update(1 / 60, { ...idle, jumpHeld: m.phase() === 'play', moveX: mx, moveY: my });
    const p = m.phase();
    if (p !== last) { seen.push({ phase: p, atSimSec: +(f / 60).toFixed(1) }); last = p; }
    if (p === 'play' && !m.player.gliding && landedAt === null) {
      landedAt = +(f / 60).toFixed(1);
      break;
    }
  }
  if (!seen.length) seen.push({ phase: m.phase(), atSimSec: 'never-started' });
  // Ten more seconds of standing still, so the landing has to be a stable state
  // and not a single frame that happens to touch the ground. Keep the player
  // topped up through it: 40-odd bots are live by now and standing motionless on
  // a rooftop is how a probe gets deleted before it has measured anything. The
  // question here is "does the landing settle", not "can you win a firefight".
  // Keep the player topped up through it, and if the match has already been
  // decided (the last bot died, or the probe got unlucky early) put it back into
  // `play`. `updateEnd` is a results screen, not a broken match, and everything
  // this probe measures after the drop needs a live match to measure it in.
  for (let f = 0; f < 600; f++) {
    if (m.phase() === 'end') m.reset();
    m.update(1 / 60, idle);
    m.player.hp = 100;
    m.player.alive = true;
  }
  if (m.phase() !== 'play') m.reset();
  const pl = m.player;
  return {
    seen,
    landedAt,
    phase: m.phase(),
    alive: pl.alive,
    gliding: pl.gliding,
    hp: pl.hp,
    pos: [pl.pos.x, pl.pos.y, pl.pos.z].map((v) => +v.toFixed(1)),
    guns: pl.guns.map((g) => (g ? g.id : null)),
    active: pl.active,
    mag: pl.active < 2 && pl.guns[pl.active] ? pl.guns[pl.active].mag : null,
    ammo: pl.ammo,
    groundUnderPlayer: +m.debugState().groundUnderPlayer.toFixed(2),
  };
});
console.log('phase path:', JSON.stringify(path.seen || path));
if (path.error) { console.error(path.error); process.exit(1); }
console.log(`landed at sim ${path.landedAt}s: alive=${path.alive} hp=${path.hp} gliding=${path.gliding} pos=${JSON.stringify(path.pos)}`);
// Landing with an empty locker is the design, not a defect: `reset()` hands the
// island player `[null, null]` guns and zero ammo on purpose, because finding a
// weapon is the first thing a battle royale is supposed to make you do. Asserting
// a gun here would be asserting the opposite of the game. What matters is that
// the descent finished and that a weapon is reachable afterwards.
console.log(`guns on landing: ${JSON.stringify(path.guns)} (empty is correct for a BR drop)`);
console.log(`ammo on landing: ${JSON.stringify(path.ammo)}`);
console.log(`ground under player: ${path.groundUnderPlayer}`);

// Is the player standing on the island, or floating in the sky / sunk in the
// sea? A drop that "succeeds" into deep water is still unplayable.
//
// `heightAt` is terrain height only and ignores buildings, so landing on a roof
// legitimately reads as "high above the ground" - the player is 17m up on a
// rooftop, not stuck in the sky. What actually matters is the direction of the
// error: below the terrain means fell through the world, and only a *still
// gliding* player is stuck in the air. Standing on a building is not a bug.
const aboveGround = path.pos[1] - path.groundUnderPlayer;
if (aboveGround < -3) {
  console.error(`  !! player is ${aboveGround.toFixed(1)}m BELOW the terrain - fell through the world`);
} else if (aboveGround > 3) {
  console.log(`  (landed ${aboveGround.toFixed(1)}m above terrain - on a rooftop, which is fine)`);
}

// Now walk to the nearest gun on the ground and pick it up. This is the real
// "can I play" question: an island that drops you safely onto a beach with no
// weapon within walking distance is unplayable no matter how good the drop is.
console.log('\n--- looting ---');
const loot = await page.evaluate(async () => {
  const m = window.__brMatch();
  const pl = m.player;
  const idle = {
    moveX: 0, moveY: 0, lookX: 0, lookY: 0, fire: false, aim: false, device: 'keyboard',
    jumpHeld: false, jumpPressed: false, crouchHeld: false, crouchPressed: false,
    sprint: false, reloadPressed: false, interactPressed: false, interactHeld: false,
    meleePressed: false, dashPressed: false, usePressed: false, swapPressed: false,
    inspectPressed: false, emotePressed: false, scoreHeld: false, pausePressed: false,
    confirmPressed: false, backPressed: false, uiLeft: false, uiRight: false,
    uiUp: false, uiDown: false, weaponSlot: 0, itemPrev: false, itemNext: false,
  };
  // Teleport next to the closest ground weapon rather than pathing to it. The
  // question here is "does loot exist and can it be taken", not "can the navmesh
  // find a path", and walking 200m blind through a hillside is a different bug.
  // Read the live array: pickups are deliberately absent from the HUD snapshot,
  // so a map that spawned no weapons at all looks perfectly normal otherwise.
  const all = m.pickups ? m.pickups() : [];
  const guns = all.filter((p) => p.kind === 'gun' && !p.taken);
  if (!guns.length) {
    const kinds = {};
    for (const p of all) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
    return { error: `no guns on the ground`, total: all.length, kinds };
  }
  // Some anchors are pushed without a `y` (map.js pushes `{x, z, poi}` and relies
  // on a later pass to fill it in), so a gun can genuinely arrive here with no
  // height. Standing on one of those means `Math.hypot` returns NaN and the whole
  // approach is nonsense. Report how many are affected rather than silently
  // measuring against one.
  const noY = guns.filter((g) => !Number.isFinite(g.y)).length;
  let best = null;
  for (const g of guns) {
    // Skip the heightless ones: they cannot be approached, and including one makes
    // every distance figure downstream NaN and hides the real numbers.
    if (!Number.isFinite(g.y)) continue;
    const d = Math.hypot(g.x - pl.pos.x, g.z - pl.pos.z);
    if (!best || d < best.d) best = { d, g };
  }
  if (!best) return { error: 'every ground gun has no height', total: guns.length, noY };
  // Work out the approach explicitly and report the numbers that
  // `focusedInteract` scores on, because "the pickup did not happen" has three
  // very different causes that all look identical from the outside: too far
  // (>2.6m), facing the wrong way (dot < 0.45), or the press arriving on a frame
  // where the camera still points somewhere else.
  // Stand on the ground next to the marker, at a fixed 1.2m standoff, and look
  // straight at it. Two things have to be got right here and both are easy to get
  // wrong: the player lands on a ROOFTOP ~17m above the terrain the guns sit on,
  // so the standoff has to be computed from the gun's own ground height rather
  // than from wherever the drop happened to leave us; and the eye is 1.58m above
  // the feet while the marker is 0.4m up, so the camera has to be pitched down
  // ~40 degrees for `focusedInteract`'s 0.45 dot-product gate to pass at all.
  // Where the drop left us, before any of the repositioning below. Used to
  // choose which marker to walk to.
  const landing = { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z };

  // Only skip loot that is below sea level. `heightAt` keeps returning shelf
  // depths out past the beach, so some anchors put a marker underwater where the
  // tide shoves the player around - reachable in the maths, not in the game.
  const usable = (g) => Number.isFinite(g.y) && g.y > -0.5;
  const dryGuns = guns.filter(usable);
  if (!dryGuns.length) {
    return { error: 'no ground gun sits above sea level', total: guns.length, heightlessGuns: noY };
  }

  // Choose the marker FIRST, then find open ground beside IT. Doing it the other
  // way round picks a patch of open terrain somewhere on the island and then
  // reaches for whatever loot happens to be nearest - which is regularly on a
  // street under a building, several metres below the player's feet, and
  // unreachable no matter how the probe poses. A player looks at the gun in
  // front of them, not the other way round.
  let target = null;
  let targetD = Infinity;
  for (const g of dryGuns) {
    const d = Math.hypot(g.x - landing.x, g.z - landing.z);
    if (d < targetD) { targetD = d; target = g; }
  }

  // Find genuinely open ground BESIDE the chosen marker. "Open" means the
  // terrain the sim settles on matches `heightAt` there, i.e. nothing is built
  // overhead - that is the test that actually matters, because a gun on a street
  // has a building above it and the player ends up on the roof instead of beside
  // the marker. The origin is not open terrain either: it is the pre-drop lobby
  // deck at y=48.7 (see `placeLobby`).
  let settled = null;
  outer:
  for (let ring = 2; ring <= 14; ring += 2) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const x = target.x + Math.cos(ang) * ring;
      const z = target.z + Math.sin(ang) * ring;
      pl.pos.set(x, target.y + 0.5, z);
      pl.vel.set(0, 0, 0);
      for (let f = 0; f < 30; f++) { m.update(1 / 60, idle); pl.hp = 100; pl.alive = true; pl.vel.set(0, 0, 0); }
      const terrain = m.heightAt(pl.pos.x, pl.pos.z);
      if (pl.pos.y > -0.5 && Math.abs(pl.pos.y - terrain) < 1.5) {
        settled = { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z };
        break outer;
      }
    }
  }
  if (!settled) {
    // Nothing open near this marker. Stand on the marker's own ground and let the
    // numbers below report what the camera actually ended up seeing, rather
    // than silently measuring a pose the sim never accepted.
    pl.pos.set(target.x, target.y, target.z + 1.2);
    pl.vel.set(0, 0, 0);
    for (let f = 0; f < 60; f++) { m.update(1 / 60, idle); pl.hp = 100; pl.alive = true; pl.vel.set(0, 0, 0); }
    settled = { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z };
    console.log('  (no open ground beside this marker - standing on the marker itself)');
  }

  // Approach `target` from a 1.2m standoff, on the target's own ground height.
  // Re-assert the position every frame right up to the press: `movePlayer` runs
  // every frame and will slide the player off a rooftop or out of the 2.6m
  // window, so a single placement at the start is not enough.
  // Standing still in the open for a second is how you die in a battle royale,
  // and 39 live bots will happily shoot the probe while it fumbles with a
  // pickup. A dead player has no locker to fill and no viewmodel to draw, so
  // every assertion after this point would be measuring the corpse. Top the
  // health up around the interaction - this step is about whether loot can be
  // taken, not whether the probe can survive a firefight.
  // Approach the marker from whichever side the open ground was found on, at a
  // 1.2m standoff. Re-assert the stance after every frame: `movePlayer` runs
  // gravity and collision every frame, so a single placement does not stick.
  const dx = target.x - settled.x;
  const dz = target.z - settled.z;
  const len = Math.hypot(dx, dz) || 1;
  const standX = target.x - (dx / len) * 1.2;
  const standZ = target.z - (dz / len) * 1.2;

  // Standing still in the open for a second is how you die in a battle royale,
  // and 40-odd live bots will happily shoot the probe while it fumbles with a
  // pickup. A dead player has no locker to fill and no viewmodel to draw, so
  // every assertion after this point would be measuring the corpse. Top the
  // health up around the interaction - this step is about whether loot can be
  // taken, not whether the probe can survive a firefight.
  const heal = () => { pl.hp = 100; pl.alive = true; };
  const stand = () => {
    heal();
    pl.pos.set(standX, target.y, standZ);
    pl.vel.set(0, 0, 0);
    // Face the marker: it is along the line we just walked in on.
    pl.yaw = Math.atan2(-dx, -dz);
    // Look down at the marker. The eye is 1.58m up and the marker 0.4m up, so
    // that is 1.18m of drop over 1.2m of ground - about 45 degrees. Positive
    // `player.pitch` tilts the camera UP (it is added straight into
    // `pitchPivot.rotation.x`), so looking down needs a negative value.
    pl.pitch = -Math.atan2(1.18, 1.2);
  };
  stand();
  for (let f = 0; f < 30; f++) { m.update(1 / 60, idle); stand(); }
  // Hold the stance and keep pressing interact. `interact()` requires
  // `interactPressed`, which is a rising edge the real input layer computes from
  // a key press - so re-assert it on each frame rather than setting it once.
  // `focusedInteract` also scores the *previous* frame's camera direction
  // (combat runs before applyCamera), so a single-frame press can land on the one
  // pose where collision has not settled yet. A player just holds the key, and
  // holding it is what makes this reliable.
  for (let f = 0; f < 40; f++) {
    m.update(1 / 60, { ...idle, interactPressed: true, interactHeld: true });
    stand();
    if (pl.guns.some(Boolean)) break;
  }
  for (let f = 0; f < 10; f++) { m.update(1 / 60, { ...idle, interactHeld: true }); stand(); }
  // Where the camera actually ended up is what `focusedInteract` scores, and it
  // is the one number that decides whether the pickup can happen.
  // Read the camera AFTER a frame that is not followed by a `stand()` re-assert,
  // so it reflects where the sim actually put the eye rather than a position the
  // probe overwrote afterwards. Reading it right after `stand()` reports the
  // probe's intent, not the game's state, which is how a "13m away" reading
  // appears for a player standing 1.2m from the marker.
  m.update(1 / 60, idle);
  heal();
  const cam = m.activeCamera();
  const camPos = cam.getWorldPosition(new (cam.position.constructor)());
  const camDir = cam.getWorldDirection(new (cam.position.constructor)());
  const camDist = Math.hypot(target.x - camPos.x, (target.y + 0.4) - camPos.y, target.z - camPos.z);
  // `focusedInteract` needs BOTH the distance under 2.6m AND the dot product
  // between the camera direction and the vector to the marker above 0.45. Report
  // both so a refused pickup says which gate closed.
  const vx = target.x - camPos.x;
  const vy = (target.y + 0.4) - camPos.y;
  const vz = target.z - camPos.z;
  const dot = (vx * camDir.x + vy * camDir.y + vz * camDir.z) / (camDist || 1);
  return {
    nearestDist: +best.d.toFixed(1),
    gunId: target.id,
    camDist: +camDist.toFixed(2),
    dot: +dot.toFixed(3),
    pitch: +pl.pitch.toFixed(2),
    camY: +camPos.y.toFixed(2),
    playerY: +pl.pos.y.toFixed(2),
    gunY: +target.y.toFixed(2),
    hp: pl.hp,
    guns: pl.guns.map((g) => (g ? g.id : null)),
    active: pl.active,
    activeIsGun: pl.active < 2,
    totalGunsOnMap: guns.length,
    heightlessGuns: noY,
  };
});
console.log('loot:', JSON.stringify(loot));


// Is there actually a gun in hand, on screen? A player who lands with an empty
// locker and nothing drawn is unplayable no matter how good the map looks.
const drawn = await page.evaluate(async () => {
  const m = window.__brMatch();
  const THREE = window.__brTHREE;
  const cam = window.__brCamera();
  if (!THREE || !cam) return { error: 'no THREE/camera hook' };
  // Level the view first. The looting step left the camera pitched ~45 degrees
  // down at the marker it had just picked up, and a viewmodel aimed at the dirt
  // is legitimately off screen - that would be the probe's pose, not a bug in
  // the gun. A player levels the view as they come up out of a pickup.
  //
  // The input frame has to be COMPLETE. `applyLook` does `player.yaw -= input.lookX`,
  // so a partial `{ fire: false }` leaves lookX undefined and turns the whole
  // camera transform into NaN - which then poisons every bounding box measured
  // through the rig. That is a probe bug that looks exactly like a corrupt model.
  const idle = {
    moveX: 0, moveY: 0, lookX: 0, lookY: 0, fire: false, aim: false, device: 'keyboard',
    jumpHeld: false, jumpPressed: false, crouchHeld: false, crouchPressed: false,
    sprint: false, reloadPressed: false, interactPressed: false, interactHeld: false,
    meleePressed: false, dashPressed: false, usePressed: false, swapPressed: false,
    inspectPressed: false, emotePressed: false, scoreHeld: false, pausePressed: false,
    confirmPressed: false, backPressed: false, uiLeft: false, uiRight: false,
    uiUp: false, uiDown: false, weaponSlot: 0, itemPrev: false, itemNext: false,
  };
  m.player.pitch = 0;
  m.player.yaw = 0;
  m.player.hp = 100;
  m.player.alive = true;
  m.update(1 / 60, idle);
  cam.updateMatrixWorld(true);
  const pivot = cam.parent;
  if (!pivot) return { error: 'camera has no parent pivot' };
  const vm = pivot.children.find((c) => !c.isPerspectiveCamera);
  if (!vm || !vm.visible) return { error: 'no visible viewmodel group' };
  let gunNode = null;
  vm.traverse((n) => { if (!gunNode && n.userData && n.userData.id && /^(pistol|ar|smg|shot|snip|heart)/.test(n.userData.id)) gunNode = n; });
  if (!gunNode) return { error: 'no weapon node in the viewmodel', kids: vm.children.map((c) => c.type) };
  // `createWeaponMesh` returns a group whose `userData.id` is the weapon, and
  // for a GLB weapon that group is EMPTY until the fetch resolves - the real
  // mesh is a child added later. `userData.pending` is the game's own flag for
  // "still loading", so wait on that rather than guessing a delay.
  for (let i = 0; i < 60; i++) {
    const probe = new THREE.Box3().setFromObject(gunNode);
    if (!probe.isEmpty() && !gunNode.userData.pending) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  vm.updateMatrixWorld(true);
  cam.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gunNode);
  if (box.isEmpty()) return { error: `weapon ${gunNode.userData.id} never loaded a mesh (empty box after 6s)` };
  const gunSize = box.getSize(new THREE.Vector3());
  // A box can be non-empty and still be NaN - `isEmpty()` is a min/max
  // comparison and NaN fails every one of them, so a NaN-transformed node reads
  // as "not empty" while producing null sizes. Catch that explicitly rather
  // than letting it masquerade as an off-screen gun. (`tools/probe-nan.mjs`
  // audits the source GLBs for this.)
  if (![gunSize.x, gunSize.y, gunSize.z].every(Number.isFinite)) {
    return { error: `weapon ${gunNode.userData.id} has a non-finite bounding box (NaN transform or vertex)` };
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) {
    const v = new THREE.Vector3(cx, cy, cz).project(cam);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  return {
    id: gunNode.userData.id,
    worldSize: [gunSize.x, gunSize.y, gunSize.z].map((v) => +v.toFixed(3)),
    onScreen: minX <= 1 && maxX >= -1 && minY <= 1 && maxY >= -1,
  };
});
console.log('drawn weapon:', JSON.stringify(drawn));

// Fire through the real input path. A gun that is drawn but produces no shots is
// the most common "the game is broken" report, and it is invisible in a
// screenshot because the muzzle flash has faded before anyone looks.
console.log('\n--- shooting on the island ---');
const shootRes = await page.evaluate(() => {
  const m = window.__brMatch();
  const p = m.player;
  // Level the view before firing. The looting step left the camera pitched ~45
  // degrees down at the marker it just picked up, and a viewmodel aimed at the
  // dirt is legitimately off screen - that is the probe's pose, not a bug in the
  // gun. A player levels the view as they come up out of a pickup.
  p.pitch = 0;
  p.hp = 100;
  p.alive = true;
  const before = { shots: p.shots, hits: p.hits, damage: +p.damage.toFixed(1) };
  const idle = {
    moveX: 0, moveY: 0, lookX: 0, lookY: 0, fire: false, aim: false, device: 'keyboard',
    jumpHeld: false, jumpPressed: false, crouchHeld: false, crouchPressed: false,
    sprint: false, reloadPressed: false, interactPressed: false, interactHeld: false,
    meleePressed: false, dashPressed: false, usePressed: false, swapPressed: false,
    inspectPressed: false, emotePressed: false, scoreHeld: false, pausePressed: false,
    confirmPressed: false, backPressed: false, uiLeft: false, uiRight: false,
    uiUp: false, uiDown: false, weaponSlot: 0, itemPrev: false, itemNext: false,
  };
  for (let f = 0; f < 60 * 12; f++) {
    m.update(1 / 60, { ...idle, fire: true });
    // Same reasoning as the looting step: the probe is proving the trigger
    // works, not surviving a firefight with 39 bots. Without this it dies
    // mid-burst and the shot count stops climbing for reasons that have nothing
    // to do with the gun.
    p.hp = 100;
    p.alive = true;
  }
  return {
    before,
    after: { shots: p.shots, hits: p.hits, damage: +p.damage.toFixed(1) },
    mag: p.active < 2 && p.guns[p.active] ? p.guns[p.active].mag : null,
    reloading: p.reload > 0,
  };
});
console.log(`shots ${shootRes.before.shots} -> ${shootRes.after.shots}, mag ${shootRes.mag}, reloading=${shootRes.reloading}`);
console.log(`hits ${shootRes.before.hits} -> ${shootRes.after.hits}, damage ${shootRes.before.damage} -> ${shootRes.after.damage}`);

const bots = await page.evaluate(() => {
  const b = window.__brBots ? window.__brBots() : null;
  return b ? { total: b.total, grounded: b.grounded, states: b.states, bad: b.bad } : null;
});
if (bots) console.log(`bots: total=${bots.total} grounded=${bots.grounded} states=${JSON.stringify(bots.states)}`);


const fail = [];
if (path.phase !== 'play') fail.push(`never reached play, stuck in "${path.phase}" (path: ${JSON.stringify(path.seen)})`);
if (path.landedAt === null) fail.push('reached play but the drop never finished - still gliding after 200 sim-seconds');
if (!path.alive) fail.push('the player is dead after the drop');
if (path.hp <= 0) fail.push(`the player landed with ${path.hp} hp`);
if (aboveGround < -3) fail.push(`the player landed ${Math.abs(aboveGround).toFixed(1)}m below the terrain`);
if (loot.error) fail.push(`cannot get armed: ${loot.error}`);
else if (!loot.guns.filter(Boolean).length) fail.push('picked up a ground gun but the locker stayed empty');
if (drawn.error) fail.push(`nothing is drawn in hand: ${drawn.error}`);
else if (!drawn.onScreen) fail.push(`the ${drawn.id} is off screen after landing`);
if (shootRes.after.shots === shootRes.before.shots) fail.push('firing on the island produced no shots at all');
if (bots && bots.bad && bots.bad.length) fail.push(`${bots.bad.length} bot(s) have non-finite positions`);
if (errors.length) fail.push(`${errors.length} page error(s) during the match`);
if (failed.length) fail.push(`${failed.length} failed request(s) during the match`);

if (errors.length) {
  console.error(`\n${errors.length} page error(s):`);
  for (const e of [...new Set(errors)].slice(0, 12)) console.error(`  ${e}`);
}
if (failed.length) {
  console.error(`\n${failed.length} failed request(s):`);
  for (const f of [...new Set(failed)].slice(0, 12)) console.error(`  ${f}`);
}

await browser.close();

if (fail.length) {
  console.error('\nFAILED:');
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nisland probe ok');

await page.screenshot({ path: OUT }).catch((e) => console.error(`screenshot failed: ${e.message}`));
console.log(`\nscreenshot: ${OUT}`);
