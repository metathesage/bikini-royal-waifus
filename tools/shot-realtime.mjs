// Real-GPU, real-time run: node tools/shot-realtime.mjs <port> <prefix> [seconds]
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const CHROME = ['C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((c) => fs.existsSync(c));
const [port = '5173', prefix = 'rt', secs = '75'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 600000, args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const p = await b.newPage();
await p.setViewport({ width: 1907, height: 1008 });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (a) => p.evaluate((x) => { const e = document.querySelector(`[data-action="${x}"]`); if (e) e.click(); return !!e; }, a);
await wait(2000); await click('boot'); await wait(3000); await click('play');
const t0 = Date.now();
for (let i = 0; Date.now() - t0 < Number(secs) * 1000; i++) {
  await wait(4000);
  const info = await p.evaluate(() => { const m = window.__brMatch && window.__brMatch(); return m ? { phase: m.phase(), ready: m.ready() } : null; });
  console.log(i, info && info.phase, info && info.ready);
  await p.screenshot({ path: `${prefix}-${String(i).padStart(2, '0')}.png` });
}
await b.close();
