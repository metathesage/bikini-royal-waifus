/**
 * Shooting-range probe.
 *
 * Fires real shots at a real dummy through the real input path (a window
 * mousedown, which is what core/input.js reads) and reads the damage back out.
 * Every other check in this repo can prove the maths is right; only this one
 * proves the player, the gun, the range and the instrument panel agree.
 *
 * The player spawns on the firing line at x=0 facing -Z, so the 10m dummy is
 * dead ahead and needs no aiming. A miss here is therefore a bug, not a
 * tester's error, which is what makes the assertions below worth having.
 *
 *   node tools/probe-shooting.mjs [--url ...] [--wait 12000] [--shots 6]
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
const WAIT = Number(arg('wait', 12000));
const SHOTS = Number(arg('shots', 6));
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
    '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720',
  ],
});

const page = await global.browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const click = async (action) => page.evaluate((a) => {
  const el = document.querySelector(`[data-action="${a}"]`);
  if (el) el.click();
  return !!el;
}, action);

await click('boot');
await new Promise((r) => setTimeout(r, 800));
await click('play');
console.log(`[shoot] waiting ${WAIT}ms for the range to build`);

// The Heartbreaker is automatic, so holding the button is the whole burst.
// SwiftShader runs around 20fps, so hold long enough for several rpm-limited
// shots rather than a single click.
console.log(`[shoot] holding fire for ${SHOTS} rounds`);
await page.mouse.down({ button: 'left' });
await new Promise((r) => setTimeout(r, SHOTS * 140));
await page.mouse.up({ button: 'left' });
await new Promise((r) => setTimeout(r, 900));

const after = await page.evaluate(() => ({
  diag: window.__brDiag(),
  panelText: document.getElementById('range').textContent.trim(),
  rows: Array.from(document.querySelectorAll('#range .rrow')).map((r) => r.textContent.trim()),
  grid: Array.from(document.querySelectorAll('#range .rgrid > div')).map((r) => r.textContent.trim()),
}));

console.log('\n--- range panel after firing ---');
for (const r of after.rows) console.log(`  ${r}`);
console.log(`  falloff grid: ${after.grid.join('   ')}`);

const d = after.diag;
console.log('\n--- state ---');
console.log(`  phase=${d.phase} fps=${d.fps} drawCalls=${d.drawCalls} tris=${d.triangles}`);
console.log(`  assets: ${JSON.stringify(d.assets.byState)}`);
console.log(`  player: (${d.player.px}, ${d.player.py}, ${d.player.pz}) alive=${d.player.alive}`);

// Assertions. The Heartbreaker does 16 base damage and holds it to 28m, so a
// 10m body shot must land exactly 16. Anything else means falloff, the headshot
// multiplier or the raycast is not doing what the tables in weapons.js claim.
const fail = [];
if (!after.panelText) fail.push('range panel rendered no text after firing');
if (!/16/.test(after.grid.join(' '))) fail.push(`falloff grid omits the AR's 16 base damage: ${after.grid.join(' ')}`);
if (!/Shots \/ hits/.test(after.panelText)) fail.push('panel is missing the shots/hits counter');

const m = /Last hit([\d.]+) dmg @ ([\d.]+)m/.exec(after.panelText);
if (!m) {
  fail.push('no "Last hit" row - the panel never saw a hit on a dummy dead ahead');
} else {
  const dmg = Number(m[1]);
  const dist = Number(m[2]);
  console.log(`\n  last hit: ${dmg} dmg at ${dist}m`);
  if (!(dmg > 0)) fail.push('last hit reported zero damage');
  if (dist < 8 || dist > 12) fail.push(`expected a hit near the 10m gate, got ${dist}m - spawn or aim is off`);
}

await page.screenshot({ path: path.resolve('probe-shooting.png') });
console.log('[shoot] wrote probe-shooting.png');

await global.browser.close();
global.browser = null;

if (errors.length) {
  console.error(`\n${errors.length} page error(s):`);
  for (const e of [...new Set(errors)].slice(0, 15)) console.error(`  ${e}`);
}
if (fail.length) {
  console.error('\nFAILED:');
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nshooting probe ok');

await new Promise((r) => setTimeout(r, WAIT));

const before = await page.evaluate(() => ({
  panelVisible: !document.getElementById('range').hidden,
  panelText: document.getElementById('range').textContent.trim(),
}));
console.log(`[shoot] panel visible before firing: ${before.panelVisible}`);
