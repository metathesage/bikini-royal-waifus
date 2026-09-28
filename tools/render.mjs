/**
 * Headless render harness.
 *
 * Boots the real game in Chrome with SwiftShader, drives it to a chosen screen,
 * then reports what actually came up: console errors, WebGL renderer, draw
 * calls, triangle count, and screenshots. This is the only way to know whether
 * the rigs, the city and the loot props are genuinely on screen — every other
 * check in this repo is inference.
 *
 *   node tools/render.mjs [--url http://localhost:5173] [--shot out.png]
 *                        [--phase game] [--wait 6000] [--w 1280] [--h 720]
 */
global.browser = null;
process.on('exit', () => { if (global.browser) { try { global.browser.process().kill(); } catch { /* gone */ } } });
process.on('uncaughtException', (e) => { console.error('render failed:', e && e.message); process.exit(2); });
process.on('unhandledRejection', (e) => { console.error('render rejected:', (e && e.message) || e); process.exit(2); });

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const URL_ = arg('url', 'http://localhost:5173/');
const SHOT = arg('shot', 'render.png');
const PHASE = arg('phase', 'lobby');
const WAIT = Number(arg('wait', 7000));
const W = Number(arg('w', 1280));
const H = Number(arg('h', 720));
const CHROME = arg('chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');

function findChrome() {
  if (fs.existsSync(CHROME)) return CHROME;
  const candidates = [
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.ProgramFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ];
  const hit = candidates.find((c) => c && fs.existsSync(c));
  if (!hit) throw new Error('no chrome/edge found');
  return hit;
}

global.browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'shell',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    // SwiftShader gives a real WebGL2 context with no GPU: slow, but pixel
    // accurate enough to prove geometry and materials are drawing.
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    `--window-size=${W},${H}`,
  ],
});

const page = await global.browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

const errors = [];
const warnings = [];
page.on('console', async (m) => {
  // Console args arrive as JSHandles; jsonValue() is the only way to see them.
  let parts;
  try {
    parts = await Promise.all(m.args().map((a) => a.jsonValue().catch(() => '<obj>')));
  } catch {
    parts = [m.text()];
  }
  const t = parts.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ');
  if (m.type() === 'error') errors.push(t);
  else if (m.type() === 'warning') warnings.push(t);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(1, 8).join('\n')}`));
page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));

/** Click a button by its data-action. */
const click = (action) => page.evaluate((a) => {
  const b = document.querySelector(`[data-action="${a}"]`);
  if (!b) return false;
  b.click();
  return true;
}, action);

const trace = [];
let lastRecord = null;
const step = (msg) => process.stderr.write(`[render] ${msg}\n`);
/** Record a step, but collapse the long unchanged runs the poll loop produces. */
const record = async (label) => {
  const d = await page.evaluate(() => (typeof window.__brDiag === 'function' ? window.__brDiag() : null));
  const sig = d && `${d.screen}/${d.phase}/${d.drawCalls}`;
  if (lastRecord && lastRecord.sig === sig) {
    lastRecord.n += 1;
    return d;
  }
  if (lastRecord) trace.push(lastRecord);
  lastRecord = { label, screen: d && d.screen, phase: d && d.phase, fps: d && d.fps, calls: d && d.drawCalls, tris: d && d.triangles, sig, n: 1 };
  return d;
};
const flushTrace = () => { if (lastRecord) trace.push(lastRecord); };


if (PHASE === 'game') {
  // splash -> menu -> match. The match builds while the kit streams in, and
  // under SwiftShader the dt clamp makes game time run ~10x slower than real
  // time, so poll rather than guess a fixed wait.
  step('clicking boot');
  await click('boot');
  await new Promise((r) => setTimeout(r, 800));
  await record('menu');
  step('clicking play');
  await click('play');
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const d = await record('loading');
    if (i % 5 === 0) step(`loading ${i}s -> ${d && d.screen}/${d && d.phase}`);
    // 'bus' is the island's next phase, but the graybox range skips the lobby
    // and the drop entirely and arrives at 'play' directly. Waiting only for
    // 'bus' made the range burn the whole 120s poll before moving on.
    if (d && (d.phase === 'bus' || d.phase === 'play')) break;
  }
  if (await page.evaluate(() => (window.__brDiag() || {}).phase) === 'play') {
    step('range is already in play, no drop to skip');
    await record('play');
    step('in play');
  } else {
    step('in bus, waiting');
    await new Promise((r) => setTimeout(r, 4000));
    await record('bus');
    step('skipping the drop');
    await page.evaluate(() => { if (window.__brSkipBus) window.__brSkipBus(); });
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const d = await record('play');
      if (i % 5 === 0) step(`play ${i}s -> ${d && d.screen}/${d && d.phase}`);
      if (d && d.phase === 'play' && i > 2) break;
    }
    step('in play');
  }
} else if (PHASE === 'menu') {
  // splash -> menu, then stop. The menu is HTML laid over the studio scene, so
  // there is no world to build — the only thing between the two screens is the
  // boot click a player makes, and without it this phase would photograph the
  // splash and report the redesign as untested.
  step('clicking boot');
  await click('boot');
  await new Promise((r) => setTimeout(r, 1500));
  await record('menu');
} else {
  await new Promise((r) => setTimeout(r, WAIT));
}

const stats = await page.evaluate(() => {
  const w = window;
  let diag = null;
  let diagError = null;
  if (typeof w.__brDiag === 'function') {
    try { diag = w.__brDiag(); } catch (e) { diagError = e.message; }
  }
  const canvas = document.querySelector('canvas');
  return {
    diag,
    diagError,
    hasCanvas: !!canvas,
    canvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
  };
});

await record('final');
flushTrace();
for (const t of trace) t.repeats = t.n;

/*
 * Inspection shots. A single player-camera frame answers almost nothing about a
 * battle-royale map: you never see the whole island, and the one bot you happen
 * to be near may be mid-stride. These fixed viewpoints are what make the map
 * reviewable — overhead for layout, skyline for verticality, street level for
 * density and material quality.
 *
 * Framed off the measured city bounds so they stay useful if the city is
 * rescaled, and so "street level" actually lands among the buildings.
 */
const shots = [];
/** onScreen rankings captured from each inspection camera. */
const shotDiag = {};
if (PHASE === 'game') {
  // Headless software compositing renders `backdrop-filter` as opaque black
  // rectangles, which look exactly like broken 3D geometry. Hide every element
  // except the canvas — not just #ui — so the two causes can be told apart.
  await page.evaluate(() => {
    for (const el of document.body.children) {
      if (el.tagName === 'CANVAS' || el.tagName === 'SCRIPT') continue;
      el.dataset.brWas = el.style.display || '';
      el.style.display = 'none';
    }
  });
  await new Promise((r) => setTimeout(r, 2000));
  const clean = SHOT.replace(/\.png$/, '-noui.png');
  await page.screenshot({ path: path.resolve(clean) });
  shots.push(clean);
  // Same view with shadows off: if the silhouettes light up, the shadow map is
  // the cause; if not, the materials genuinely receive no light.
  const casters = await page.evaluate(() => window.__brNoShadows());
  await new Promise((r) => setTimeout(r, 2000));
  const noShadow = SHOT.replace(/\.png$/, '-noshadow.png');
  await page.screenshot({ path: path.resolve(noShadow) });
  shots.push(noShadow);
  step(`shadow casters disabled: ${casters}`);
  await page.evaluate(() => {
    for (const el of document.body.children) {
      if (el.dataset.brWas === undefined) continue;
      el.style.display = el.dataset.brWas;
      delete el.dataset.brWas;
    }
  });

  const c = stats.diag && stats.diag.city;
  const half = c ? Math.max(c.size[0], c.size[2]) / 2 : 27;
  const top = c ? c.max[1] : 22;
  const VIEWS = [
    { name: 'overview', eye: [0, half * 1.9, half * 2.2], target: [0, 1, 0] },
    { name: 'skyline', eye: [0, top + half * 0.4, half * 1.5], target: [0, top * 0.4, 0] },
    { name: 'street', eye: [half * 0.8, 4.5, half * 0.8], target: [0, 5, 0] },
    { name: 'plaza', eye: [0, 10, half * 0.85], target: [0, 2.5, 0] },
  ];
  for (const v of VIEWS) {
    step(`shot ${v.name}`);
    await page.evaluate((s) => window.__brFreeCam(s.eye, s.target), v);
    // The override is sticky, so wait for real frames to be drawn from it.
    await new Promise((r) => setTimeout(r, 3000));
    const file = SHOT.replace(/\.png$/, `-${v.name}.png`);
    await page.screenshot({ path: path.resolve(file) });
    shots.push(file);
    // Diagnose *from this camera*, not the player's: "what is covering the
    // screen" is only meaningful relative to the view that shows the problem.
    const d = await page.evaluate(() => window.__brDiag());
    (shotDiag[v.name] = d.onScreen);
  }
  await page.evaluate(() => window.__brFreeCam(null));
}

await page.screenshot({ path: path.resolve(SHOT) });
await global.browser.close();
global.browser = null;

console.log(JSON.stringify({
  url: URL_,
  phase: PHASE,
  screenshot: SHOT,
  shots,
  shotDiag,
  canvas: stats.hasCanvas ? stats.canvasSize : 'NONE',
  diagError: stats.diagError,
  ...(stats.diag || {}),
  trace,
}, null, 2));

if (errors.length) {
  console.error(`\n${errors.length} page error(s):`);
  for (const e of [...new Set(errors)].slice(0, 25)) console.error(`  ${e}`);
  process.exit(1);
}
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s), first few:`);
  for (const w of [...new Set(warnings)].slice(0, 8)) console.log(`  ${w}`);
}
console.log('\nrender ok');
