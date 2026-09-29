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
await wait(70000);
console.log(await p.evaluate(() => { const m = window.__brMatch(); return JSON.stringify({ phase: m.phase(), ready: m.ready() }); }));
await p.evaluate(() => { window.__brSkipBus && window.__brSkipBus(); });
await wait(12000);
await p.evaluate(() => window.__brFreeCam([0, 60, 70], [0, 0, 0]));
await wait(6000); await p.screenshot({ path: `${prefix}-overview.png` });
await p.evaluate(() => window.__brFreeCam([-6, 8, 14], [0, 3, 0]));
await wait(6000); await p.screenshot({ path: `${prefix}-street.png` });
let bot = null;
for (let i = 0; i < 40 && !bot; i++) { await wait(3000); bot = await p.evaluate(() => { const m = window.__brMatch(); const bs = m.bots().filter((x) => x.alive && x.state === 'live' && !x.partner); const x = bs[0]; return x ? { x: x.pos.x, y: x.pos.y, z: x.pos.z, yaw: x.yaw } : null; }); }
const _unused = await p.evaluate(() => { const m = window.__brMatch(); const bs = m.bots().filter((x) => x.alive && x.state === 'live' && !x.partner); const x = bs[0]; return x ? { x: x.pos.x, y: x.pos.y, z: x.pos.z, yaw: x.yaw } : null; });
console.log('bot', JSON.stringify(bot));
if (bot) { await p.evaluate((q) => window.__brFreeCam([q.x + 2.2, q.y + 1.5, q.z + 2.8], [q.x, q.y + 1.1, q.z]), bot); await wait(5000); await p.screenshot({ path: `${prefix}-bot.png` }); }
await p.evaluate(() => window.__brFreeCam(null));
await wait(4000); await p.screenshot({ path: `${prefix}-tps.png` });
await b.close();
