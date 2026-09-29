// node tools/shot-game.mjs <port> <prefix>  -> <prefix>-overview.png, <prefix>-street.png
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const CHROME = ['C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((c) => fs.existsSync(c));
const [port = '5173', prefix = 'shot-game'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', protocolTimeout: 600000, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (a) => p.evaluate((x) => { const e = document.querySelector(`[data-action="${x}"]`); if (e) e.click(); return !!e; }, a);
await wait(1500); await click('boot'); await wait(3000); await click('play');
for (let i = 0; i < 120; i++) { await wait(1000); if (await p.evaluate(() => !!(window.__brMatch && window.__brMatch()))) break; }
await wait(45000);
console.log(await p.evaluate(() => { const m = window.__brMatch(); return JSON.stringify({ phase: m.phase(), ready: m.ready() }); }));
await p.evaluate(() => { window.__brSkipBus && window.__brSkipBus(); });
await wait(20000);
await p.evaluate(() => window.__brFreeCam([0, 60, 70], [0, 0, 0]));
await wait(6000); await p.screenshot({ path: `${prefix}-overview.png` });
await p.evaluate(() => window.__brFreeCam([-6, 8, 14], [0, 3, 0]));
await wait(6000); await p.screenshot({ path: `${prefix}-street.png` });
await b.close();
