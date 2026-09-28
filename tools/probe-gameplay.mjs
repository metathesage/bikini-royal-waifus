/**
 * Gameplay probe: reach the island and confirm the pistol is in hand.
 *
 * Clicks [data-action] elements in the DOM rather than screen coordinates.
 * Coordinate clicking kept missing because the lobby button is CSS-transformed
 * and there is a hidden duplicate, so the hit test never lined up with the
 * painted button even though a human clicking there works.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  process.env.ProgramFiles && `${process.env.ProgramFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
  process.env['ProgramFiles(x86)'] && `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
].find((c) => c && fs.existsSync(c));
if (!CHROME) throw new Error('no chromium browser found (tried Chrome, Brave, Edge)');

const PORT = process.argv[2] || '5180';
const OUT = process.argv[3] || 'probe-gameplay.png';
// The island path has to sit through an 18s sim-second pre-drop lobby and a bus
// ride. Under SwiftShader (~3fps, dt clamped to 0.033) that is ~10 minutes of
// wall clock for the same evidence. ?map=graybox goes straight to the proving
// ground, which is where the first-person pistol is actually drawn.
const URL_ = `http://localhost:${PORT}/?map=graybox`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  protocolTimeout: 600000,
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

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));

const click = (a) => page.evaluate((x) => {
  const b = document.querySelector(`[data-action="${x}"]`);
  if (b) b.click();
  return !!b;
}, a);

const diag = () => page.evaluate(() => (window.__brDiag ? window.__brDiag() : null));

console.log('boot:', await click('boot'));
await new Promise((r) => setTimeout(r, 1200));
console.log('play:', await click('play'));

// The range opens straight into the play phase, so there is no bus to wait for.
let phase = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const d = await diag();
  if (d) { phase = d; if (d.phase === 'play') break; }
}
console.log('phase:', phase && phase.phase);

// Look around a little so the hand-held viewmodel is on screen.
await page.keyboard.down('KeyW');
await new Promise((r) => setTimeout(r, 1500));
await page.keyboard.up('KeyW');
await new Promise((r) => setTimeout(r, 1500));

const state = await page.evaluate(() => {
  const d = window.__brDiag() || {};
  return { viewmodel: window.__brViewmodel ? window.__brViewmodel() : 'no hook', assets: d.assets, player: d.player };
});

// __brViewmodel measures the whole arm rig, which legitimately spans the whole
// frustum. The question that matters is where the *pistol* itself lands, so walk
// the camera pivot and project the gun mesh's own bounding box.
const gun = await page.evaluate(() => {
  const THREE = window.__brTHREE;
  const cam = window.__brCamera();
  cam.updateMatrixWorld(true);
  const pivot = cam.parent;
  const vm = pivot.children.find((c) => !c.isPerspectiveCamera);
  if (!vm) return { error: 'no viewmodel group' };
  // The gun is the child carrying a weapon id; the arms are pivots/forearms.
  let gunNode = null;
  vm.traverse((n) => { if (!gunNode && n.userData && n.userData.id && /^(pistol|ar|smg|shot|snip|heart)/.test(n.userData.id)) gunNode = n; });
  if (!gunNode) return { error: 'no weapon node found', children: vm.children.map((c) => c.type) };
  const box = new THREE.Box3().setFromObject(gunNode);
  const size = box.getSize(new THREE.Vector3());
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) {
    const v = new THREE.Vector3(cx, cy, cz).project(cam);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  const onScreen = (a, b, c, d) => a <= 1 && b >= -1 && c <= 1 && d >= -1;
  const frac = (a, b) => Math.max(0, Math.min(1, (b - a) / 2));
  return {
    id: gunNode.userData.id,
    source: gunNode.userData.source || null,
    meshes: (() => { let n = 0; gunNode.traverse(() => n++); return n; })(),
    worldSize: [size.x, size.y, size.z].map((v) => +v.toFixed(3)),
    ndcX: [+minX.toFixed(2), +maxX.toFixed(2)],
    ndcY: [+minY.toFixed(2), +maxY.toFixed(2)],
    onScreenPct: [Math.round(frac(minX, maxX) * 100), Math.round(frac(minY, maxY) * 100)],
    intersectsViewport: onScreen(minX, maxX, minY, maxY),
    visible: gunNode.visible,
  };
});

// The graybox range arms the Heartbreaker, not the pistol, and match.update()
// re-arms the viewmodel every single frame, so a one-shot swap is undone before
// the next render. Do the swap inside a rAF callback -- those run after the
// match's own rAF, so the pistol is what actually gets drawn that frame -- and
// measure it in the same callback, before anything can overwrite it again.
// Pause first. match.update() re-arms the viewmodel from the player's equipped
// gun on every frame, and setWeapon() for the pistol is asynchronous (the GLB
// still has to load), so a swap made while the loop runs is overwritten before
// the pistol ever arrives -- 40 attempts never once caught it. Pausing stops the
// re-arming, so the pistol can load and stay mounted.
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 800));

// The graybox range arms the Heartbreaker, not the pistol, and match.update()
// re-arms the viewmodel from the player's equipped gun every frame *and*
// renders inside its own rAF. So a swap made from outside is both overwritten
// and never drawn. Arm the pistol and render it ourselves, in one shot.
//
// The GLB arrives asynchronously, so this retries: arm the pistol, render, and
// keep going until the mounted node is actually the pistol.
const pistol = await page.evaluate(async () => {
  if (!window.__brSetWeapon) return { error: 'no __brSetWeapon hook' };
  const THREE = window.__brTHREE;
  const renderer = window.__brRenderer();
  const scene = window.__brScene();
  const cam = window.__brCamera();
  const canvas = renderer.domElement;

  // Swap exactly once. Calling setWeapon again on every poll would throw away the
  // in-flight GLB load and start a new one, so the pistol could never finish
  // arriving -- the first version of this loop retried 60 times and never once
  // saw the gun it was waiting for.
  window.__brSetWeapon('pistol');

  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((r) => requestAnimationFrame(r));
    cam.updateMatrixWorld(true);
    const vm = cam.parent.children.find((c) => !c.isPerspectiveCamera);
    if (!vm) return { error: 'no viewmodel group' };
    let gunNode = null;
    vm.traverse((n) => { if (!gunNode && n.userData && n.userData.id) gunNode = n; });
    if (!gunNode) return { error: 'no weapon node', vmChildren: vm.children.map((c) => `${c.type}:${c.userData && c.userData.id}`) };
    if (gunNode.userData.id !== 'pistol') {
      if (attempt === 59) {
        const ids = [];
        vm.traverse((n) => { if (n.userData && n.userData.id) ids.push(n.userData.id); });
        return { error: 'pistol never became the mounted weapon', saw: ids };
      }
      continue;
    }

    // Draw it ourselves. The match's renderer is the live one, so this is the
    // same pipeline the player sees -- not an offscreen approximation.
    renderer.render(scene, cam);

    // Capture now, inside this callback. A screenshot taken afterwards races
    // the match's own rAF, which re-arms the Heartbreaker and repaints the
    // canvas before Puppeteer can grab it -- the first version of this probe
    // dutifully measured the pistol and then photographed the rifle.
    const shot = await new Promise((res) => res(canvas.toDataURL('image/png')));
    const box = new THREE.Box3().setFromObject(gunNode);
    const size = box.getSize(new THREE.Vector3());
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const cx of [box.min.x, box.max.x]) {
      for (const cy of [box.min.y, box.max.y]) {
        for (const cz of [box.min.z, box.max.z]) {
          const v = new THREE.Vector3(cx, cy, cz).project(cam);
          minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        }
      }
    }
    const frac = (a, b) => Math.max(0, Math.min(1, (b - a) / 2));
    let meshCount = 0;
    gunNode.traverse((n) => { if (n.isMesh) meshCount++; });
    return {
      id: gunNode.userData.id,
      childMeshes: meshCount,
      worldSize: [size.x, size.y, size.z].map((v) => +v.toFixed(3)),
      ndcX: [+minX.toFixed(2), +maxX.toFixed(2)],
      ndcY: [+minY.toFixed(2), +maxY.toFixed(2)],
      onScreenPct: [Math.round(frac(minX, maxX) * 100), Math.round(frac(minY, maxY) * 100)],
      intersectsViewport: minX <= 1 && maxX >= -1 && minY <= 1 && maxY >= -1,
      visible: gunNode.visible,
      attempts: attempt + 1,
      shot,
    };
  }
  return { error: 'pistol never became the mounted weapon' };
});
const { shot, ...pistolInfo } = pistol;
console.log('pistol:', JSON.stringify(pistolInfo));
if (typeof shot === 'string' && shot.startsWith('data:image/png')) {
  fs.writeFileSync(OUT, Buffer.from(shot.split(',')[1], 'base64'));
  console.log('shot:', OUT);
} else {
  await page.screenshot({ path: OUT });
  console.log('shot (fallback, may show the range weapon):', OUT);
}
console.log('gun:', JSON.stringify(gun));
console.log('viewmodel:', JSON.stringify(state.viewmodel));
console.log('assets:', JSON.stringify(state.assets));
console.log('player:', JSON.stringify(state.player));
console.log('errors:', errors.length ? errors : 'none');
console.log('failed:', failed.length ? failed : 'none');
await browser.close();
