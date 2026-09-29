/**
 * Bag probe: does the loadout screen actually come up and agree with the model?
 *
 * Every other check here is inference about the DOM. This drives the real game
 * in Chrome, grants items through the same path a ground pickup uses, opens the
 * bag, and then reads the rendered DOM back -- so a bag that is hidden, empty,
 * mislabelled or desynced from the match state fails here rather than in play.
 *
 *   node tools/probe-bag.mjs [--url http://localhost:5173] [--shot bag.png]
 */
global.browser = null;
process.on('exit', () => { if (global.browser) { try { global.browser.process().kill(); } catch { /* gone */ } } });
process.on('uncaughtException', (e) => { console.error('probe-bag failed:', e && e.message); process.exit(2); });
process.on('unhandledRejection', (e) => { console.error('probe-bag rejected:', (e && e.message) || e); process.exit(2); });

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const URL_ = arg('url', 'http://localhost:5173/');
const SHOT = arg('shot', 'bag.png');
const CHROME = arg('chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');

function findChrome() {
  if (fs.existsSync(CHROME)) return CHROME;
  const c = [
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.ProgramFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
  ];
  return c.find((p) => p && fs.existsSync(p));
}

const exe = findChrome();
if (!exe) { console.error('probe-bag: no Chrome found; pass --chrome <path>'); process.exit(2); }

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'],
});
global.browser = browser;
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e && e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${URL_}?map=sakura`, { waitUntil: 'domcontentloaded' });

// Boot -> play, the same clicks a person makes.
const click = (action) => page.evaluate((a) => {
  const b = document.querySelector(`[data-action="${a}"]`);
  if (b) { b.click(); return true; }
  return false;
}, action);

// Wait for a live match, then drive boot -> play.
//
// Both clicks are unconditional and the loop waits on `__brMatch()` rather
// than on a phase string. The earlier version branched on
// __brDiag().phase, but that returns null until a match object exists -- so
// the phase was never 'splash', the branch never fired, nothing was ever
// clicked, and the probe reported a broken bag that was in fact never asked
// to open one.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(2500);
await click('boot');
await wait(4000);
await click('play');

let live = false;
for (let i = 0; i < 40; i++) {
  live = await page.evaluate(() => !!(window.__brMatch && window.__brMatch()));
  if (live) break;
  if (i === 3) await click('play');
  await wait(600);
}
if (!live) { console.error('bag: never reached a live match'); await browser.close(); process.exit(1); }
await page.evaluate(() => { if (window.__brSkipBus) window.__brSkipBus(); });
await wait(1200);
// A bag worth looking at: a partial stack, a full stack, and a one-shot.
const granted = await page.evaluate(() => [
  window.__brGiveItem('bandage', 3),
  window.__brGiveItem('aegis', 1),
  window.__brGiveItem('star', 4),
  window.__brGiveItem('elixir', 1),
]);
console.log('granted:', JSON.stringify(granted));

const inv = await page.evaluate(() => window.__brInv());
console.log('model :', JSON.stringify(inv));

const opened = await page.evaluate(() => window.__brOpenBag());
await new Promise((r) => setTimeout(r, 600));
console.log('opened:', opened);

const dom = await page.evaluate(() => {
  const bag = document.getElementById('bag');
  const slots = [...document.querySelectorAll('.bag-slot')].map((s) => ({
    empty: s.classList.contains('empty'),
    on: s.classList.contains('on'),
    name: s.querySelector('.name')?.textContent || null,
    count: s.querySelector('.count')?.textContent || null,
    rarity: s.dataset.rarity || null,
  }));
  return {
    hidden: bag.hidden,
    count: document.getElementById('bag-count')?.textContent,
    detail: document.getElementById('bag-detail')?.textContent?.trim().slice(0, 60),
    useDisabled: document.getElementById('bag-use')?.disabled,
    dropDisabled: document.getElementById('bag-drop')?.disabled,
    sortDisabled: document.getElementById('bag-sort')?.disabled,
    slots,
  };
});
console.log('dom   :', JSON.stringify(dom, null, 1));

await page.screenshot({ path: SHOT });
console.log('shot  :', SHOT);

const problems = [];
if (!opened) problems.push('toggleBag(true) did not open the bag');
if (dom.hidden) problems.push('the bag element is still hidden after opening');
if (dom.slots.length !== 6) problems.push(`rendered ${dom.slots.length} slots, want 6`);
const filled = dom.slots.filter((s) => !s.empty);
if (filled.length !== 4) problems.push(`rendered ${filled.length} filled slots, want 4`);
if (!dom.slots.some((s) => s.on)) problems.push('no slot is marked as the selected one');
if (dom.count !== '3/6') problems.push(`header reads "${dom.count}", want 3/6`);
if (dom.useDisabled) problems.push('USE is disabled with an item selected');
if (dom.dropDisabled) problems.push('DROP is disabled with an item selected');
if (dom.sortDisabled) problems.push('SORT is disabled with a non-empty bag');
// colormap.png is a known broken texture reference inside a shipped character
// GLB, unrelated to the bag; it is reported by the character scan, not here.
for (const e of errors) if (!/createElementNS|Failed to parse URL|colormap\.png/.test(e)) problems.push(`page error: ${e}`);

await browser.close();

if (problems.length) {
  for (const p of problems) console.error(`bag: ${p}`);
  console.error(`${problems.length} bag problem(s)`);
  process.exit(1);
}
console.log('bag ok');
