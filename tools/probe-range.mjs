/**
 * Viewmodel probe.
 *
 * `window.__brDiag` ranks what is on screen but deliberately skips anything
 * within 1.5m of the lens, which is exactly where the gun in your hands lives.
 * So "I cannot see a weapon" and "the weapon mesh never loaded" look identical
 * in a screenshot. This walks the pitch pivot directly instead.
 *
 *   node tools/probe-range.mjs [--url ...] [--wait 12000]
 */
global.browser = null;
process.on('exit', () => { if (global.browser) { try { global.browser.process().kill(); } catch { /* gone */ } } });
process.on('uncaughtException', (e) => { console.error('probe failed:', e && e.message); process.exit(2); });
process.on('unhandledRejection', (e) => { console.error('probe rejected:', (e && e.message) || e); process.exit(2); });

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const URL_ = arg('url', 'http://localhost:5180/?map=graybox');
const WAIT = Number(arg('wait', 14000));
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
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,720',
  ],
});

const page = await global.browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const click = async (action) => {
  const ok = await page.evaluate((a) => {
    const el = document.querySelector(`[data-action="${a}"]`);
    if (!el) return false;
    el.click();
    return true;
  }, action);
  if (ok) console.log(`[probe] clicked ${action}`);
};

await click('boot');
await new Promise((r) => setTimeout(r, 800));
await click('play');
console.log(`[probe] waiting ${WAIT}ms for the range to settle`);
await new Promise((r) => setTimeout(r, WAIT));

/**
 * The range panel's actual markup.
 *
 * `paintRange` builds this from a snapshot every frame, so "which rows exist" is
 * a real question: a row can be absent because the snapshot never carried the
 * field, because a branch was taken, or because the element is there and merely
 * invisible. A textContent dump cannot tell those apart, and a screenshot
 * cannot either. This is the one probe that reads the DOM.
 */
const panel = await page.evaluate(() => {
  const el = document.getElementById('range');
  if (!el) return { error: 'no #range element' };
  return {
    hidden: el.hidden,
    html: el.innerHTML,
    text: el.innerText,
  };
});
console.log('\n--- #range panel ---');
console.log('hidden:', panel.hidden);
console.log(panel.html || panel.error);

// The measurement itself lives in main.js next to the other render-harness
// hooks, because it needs THREE and the live camera. Re-deriving the projection
// maths out here would be a second, silently-diverging copy of it.
const report = await page.evaluate(() => {
  const d = window.__brDiag ? window.__brDiag() : null;
  return {
    screen: d ? d.screen : null,
    phase: d ? d.phase : null,
    viewmodel: window.__brViewmodel ? window.__brViewmodel() : 'no hook',
    assets: d ? d.assets : null,
    player: d ? d.player : null,
    // The cast, per actor: which model it asked for, whether that model came
    // back as a rigged mesh, and whether it is on screen. The gap between these
    // three is exactly why a range full of "dummies" can show no characters.
    cast: window.__brCast ? window.__brCast() : null,
  };
});

console.log(JSON.stringify(report, null, 2));

// Two frames of the same instant, one with the first-person body hidden. If the
// range looks wrong with it on and right with it off, the range is not the
// problem and no amount of map work will fix it.
await page.evaluate(() => {
  const cam = window.__brCamera();
  const vm = cam.parent.children.find((c) => !c.isPerspectiveCamera);
  if (vm) window.__brVm = vm;
});
const withVm = await page.evaluate(() => {
  if (window.__brVm) window.__brVm.visible = true;
  return !!window.__brVm;
});
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: path.resolve('probe-range.png') });

await page.evaluate(() => { if (window.__brVm) window.__brVm.visible = false; });
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: path.resolve('probe-range-novm.png') });
await page.evaluate(() => { if (window.__brVm) window.__brVm.visible = true; });
console.log(`[probe] wrote probe-range.png (viewmodel ${withVm ? 'on' : 'missing'}) and probe-range-novm.png`);

await global.browser.close();
global.browser = null;

if (errors.length) {
  console.error(`\n${errors.length} page error(s):`);
  for (const e of [...new Set(errors)].slice(0, 15)) console.error(`  ${e}`);
}
console.log('\nprobe done');
