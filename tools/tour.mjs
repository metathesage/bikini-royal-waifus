// Real-GPU tour of the map: node tools/tour.mjs <port> <prefix>
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const CHROME = ['C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((c) => fs.existsSync(c));
const [port = '5173', prefix = 'tour'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 600000, args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 900 });
p.on('pageerror', (e) => console.log('pageerror', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 160)); });
await p.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (a) => p.evaluate((x) => { const e = document.querySelector(`[data-action="${x}"]`); if (e) e.click(); return !!e; }, a);
await wait(2000); await click('boot'); await wait(3000); await click('play');
for (let i = 0; i < 90; i++) { await wait(1000); const ph = await p.evaluate(() => { const m = window.__brMatch && window.__brMatch(); return m && m.ready() ? m.phase() : null; }); if (ph === 'bus') break; }
console.log('GL', await p.evaluate(() => { const r = window.__brRenderer().getContext(); const e = r.getExtension('WEBGL_debug_renderer_info'); return e ? r.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; }));
await wait(25000);
await p.evaluate(() => window.__brSkipBus());
await wait(1000);
await wait(9000);
await p.keyboard.press('KeyM'); await wait(3000); await p.screenshot({ path: prefix + '-map.png' }); await p.keyboard.press('KeyM'); await wait(1500);
await p.evaluate(() => { window.__brFreeCam(null); const m = window.__brMatch(); m.player.pos.set(20, 3, 20); m.player.gliding = false; m.player.channel = { id: 'veil', t: 60, max: 60 }; });
await wait(6000); await p.screenshot({ path: `${prefix}-drink.png` });
await p.evaluate(() => { document.getElementById('ui').style.display = 'none'; });
const shots = { overview: [[0, 230, 300], [0, 0, 0]], downtown: [[0, 22, 62], [0, 8, 0]], village: [[-118, 20, -30], [-118, 4, -78]], temple: [[12, 34, -100], [12, 14, -150]], harbor: [[128, 20, 0], [128, 4, -52]], gardens: [[-108, 20, 140], [-108, 3, 88]], station: [[118, 24, 150], [118, 6, 92]] };
for (const [name, [eye, tgt]] of Object.entries(shots)) {
  await p.evaluate((e, t) => window.__brFreeCam(e, t), eye, tgt);
  await wait(6000); await p.screenshot({ path: `${prefix}-${name}.png` });
  console.log(name);
}
await p.evaluate(() => { document.getElementById('ui').style.display = ''; });
const ground = { downtown: [8, 3, 34], village: [-100, 3, -70], temple: [12, 12, -118], harbor: [110, 3, -40], gardens: [-100, 3, 68], station: [100, 3, 80] };
for (const [name, [x, y, z]] of Object.entries(ground)) {
  await p.evaluate((x, y, z) => { window.__brFreeCam(null); const m = window.__brMatch(); m.player.pos.set(x, y + 1, z); m.player.gliding = false; m.player.vel.set(0, 0, 0); }, x, y, z);
  await wait(7000); await p.screenshot({ path: `${prefix}-g-${name}.png` });
  if (name === 'downtown') { await p.evaluate(() => window.__brOutlines(false)); await wait(4000); console.log('nooutline', JSON.stringify(await p.evaluate(() => { const d = window.__brDiag(); return { fps: d.fps, calls: d.drawCalls }; }))); await p.evaluate(() => window.__brOutlines(true)); await wait(3000); }
  console.log('g', name, JSON.stringify(await p.evaluate(() => { const d = window.__brDiag && window.__brDiag(); return d && { fps: d.fps, calls: d.drawCalls, tris: d.triangles }; })));
}
await b.close();
