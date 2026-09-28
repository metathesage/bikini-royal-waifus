/**
 * Slab probe: what is the grey wedge in the corner of the menu?
 *
 * The render harness reports which materials are on screen, but "on screen" is
 * not "in that pixel" — it cannot tell a background plane from a foreground
 * prop. This raycasts the actual pixel the eye keeps tripping over and reports
 * the mesh that owns it, which is the only way to name a bug you can see but
 * not attribute.
 *
 *   node tools/probe-slab.mjs
 */
global.browser = null;
process.on('exit', () => { if (global.browser) { try { global.browser.process().kill(); } catch { /* gone */ } } });
process.on('uncaughtException', (e) => { console.error('probe failed:', e && e.message); process.exit(2); });
process.on('unhandledRejection', (e) => { console.error('probe rejected:', (e && e.message) || e); process.exit(2); });

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.argv.includes('--chrome') ? process.argv[process.argv.indexOf('--chrome') + 1] : null;
function findChrome() {
  const candidates = [
    CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.ProgramFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ].filter(Boolean);
  const hit = candidates.find((c) => fs.existsSync(c));
  if (!hit) throw new Error('no chrome/edge found');
  return hit;
}

global.browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'shell',
  args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720',
  ],
});

const page = await global.browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message || e)));

const log = (m) => console.error(`[slab] ${m}`);

// domcontentloaded, not networkidle2: the roster pulls very large GLBs and a
// quiet network can take longer than this whole probe is allowed to run.
log('launching');
await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded', timeout: 60000 });
log('loaded, waiting for hooks');
await page.waitForFunction(() => typeof window.__brScene === 'function', { timeout: 30000 });
log('hooks ready');
// Boot to the menu so the studio scene is the one on screen.
await page.evaluate(() => { const b = document.querySelector('[data-action="boot"]'); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 1500));
log('menu up, raycasting');

const hits = await page.evaluate(async () => {
  const THREE = window.__brTHREE;
  const scene = window.__brScene();
  const camera = window.__brCamera();
  if (!THREE || !scene || !camera) return { error: 'no THREE/scene/camera' };
  camera.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  const out = [];
  // Sample the wedge: a few points across the top-left quadrant.
  for (const [nx, ny] of [[-0.66, 0.70], [-0.50, 0.85], [-0.30, 0.78], [-0.66, 0.45], [-0.10, 0.90]]) {
    rc.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const all = rc.intersectObjects(scene.children, true).filter((h) => h.object.visible !== false);
    const h = all[0];
    out.push({
      ndc: [nx, ny],
      hit: h ? {
        type: h.object.type,
        name: h.object.name || '(unnamed)',
        mat: h.object.material && h.object.material.type,
        color: h.object.material && h.object.material.color && `#${h.object.material.color.getHexString()}`,
        side: h.object.material && h.object.material.side,
        dist: Number(h.distance.toFixed(2)),
        world: h.object.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(2))),
        parent: h.object.parent && (h.object.parent.name || h.object.parent.type),
      } : null,
    });
  }
  return { hits: out, camPos: camera.position.toArray().map((v) => Number(v.toFixed(2))) };
});

console.log(JSON.stringify({ errors, ...hits }, null, 2));
