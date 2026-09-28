/**
 * Viewmodel tree dump.
 *
 * `probe-range.mjs` proves the viewmodel is on screen and covers 100% of the
 * frame, which is exactly the wrong answer: it should be a hand and a gun in
 * the lower right, not a pink wall. This prints the tree with world-space
 * bounding boxes so the offender is identifiable by name rather than by
 * squinting at a screenshot.
 *
 *   node tools/probe-vm-tree.mjs [--url ...]
 */
global.browser = null;
process.on('exit', () => { if (global.browser) { try { global.browser.process().kill(); } catch { /* gone */ } } });
process.on('uncaughtException', (e) => { console.error('probe failed:', e && e.message); process.exit(2); });
process.on('unhandledRejection', (e) => { console.error('probe rejected:', (e && e.message) || e); process.exit(2); });

import fs from 'node:fs';
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
page.on('pageerror', (e) => console.error('pageerror:', e.message));

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const click = async (action) => page.evaluate((a) => {
  const el = document.querySelector(`[data-action="${a}"]`);
  if (el) { el.click(); return true; }
  return false;
}, action);
await click('boot');
await new Promise((r) => setTimeout(r, 800));
await click('play');
await new Promise((r) => setTimeout(r, WAIT));

const report = await page.evaluate(() => (window.__brViewmodelTree ? window.__brViewmodelTree() : 'no hook'));
console.log(typeof report === 'string' ? report : JSON.stringify(report, null, 2));

await global.browser.close();
global.browser = null;
console.log('probe done');