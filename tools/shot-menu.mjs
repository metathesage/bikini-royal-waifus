// Screenshot the menu (and optional action screens): node tools/shot-menu.mjs <port> <out> [action...]
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const CHROME = ['C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((c) => fs.existsSync(c));
const [port = '5173', out = 'shot-menu.png', ...actions] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 900 });
p.on('console', (m) => { if (['error','warning'].includes(m.type())) console.log('console', m.text().slice(0,200)); });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (a) => p.evaluate((x) => { const e = document.querySelector(`[data-action="${x}"]`); if (e) e.click(); return !!e; }, a);
await wait(1500); if (process.env.NOBOOT) { await wait(3000); await p.screenshot({ path: out }); await b.close(); process.exit(0); } console.log('boot', await click('boot')); await wait(35000);
for (const a of actions) { console.log(a, await click(a)); await wait(15000); }
console.log(JSON.stringify(await p.evaluate(() => { const sc = window.__brScene(); const out = []; sc.children.forEach((c) => { const b = new window.__brTHREE.Box3().setFromObject(c); out.push([c.type, c.name, c.visible, b.min.toArray().map((v) => +v.toFixed(1)), b.max.toArray().map((v) => +v.toFixed(1))]); }); return out.filter((o) => o[0] === 'Group' || o[0] === 'Object3D'); })));
await p.screenshot({ path: out });
await b.close();
