// node tools/shot-glb.mjs out.png a,b,c  -> renders /assets/hf/<name>.glb side by side
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const CHROME = ['C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((c) => fs.existsSync(c));
const [out, names] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 700 });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:5173/viewer.html?m=${names}`); await p.waitForFunction('window.__done', { timeout: 60000 }); await new Promise((r) => setTimeout(r, 1500));
await p.screenshot({ path: out }); await b.close();
