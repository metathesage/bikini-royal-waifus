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
await wait(50000);
console.log(await p.evaluate(() => { const m = window.__brMatch(); return JSON.stringify({ phase: m.phase(), ready: m.ready() }); }));
await p.evaluate(async () => {
  const m = window.__brMatch();
  const idle = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, fire: false, aim: false, device: 'keyboard', jumpHeld: false, jumpPressed: false, crouchHeld: false, crouchPressed: false, sprint: false, reloadPressed: false, interactPressed: false, interactHeld: false, meleePressed: false, dashPressed: false, usePressed: false, swapPressed: false, inspectPressed: false, emotePressed: false, scoreHeld: false, pausePressed: false, confirmPressed: false, backPressed: false, uiLeft: false, uiRight: false, uiUp: false, uiDown: false, weaponSlot: 0, itemPrev: false, itemNext: false };
  for (let i = 0; i < 4000 && m.phase() !== 'bus'; i++) m.update(1 / 30, idle);
  for (let i = 0; i < 150; i++) m.update(1 / 30, idle);
  window.__busPhase = m.phase();
});
await wait(6000);
console.log(JSON.stringify(await p.evaluate(() => { const m = window.__brMatch(); const T = window.__brTHREE; const cam = window.__brCamera(); const u = m.scene.getObjectByName('') ; const out = { cam: cam.position.toArray().map((v) => +v.toFixed(1)), camW: cam.getWorldPosition(new T.Vector3()).toArray().map((v) => +v.toFixed(1)), player: [m.player.pos.x, m.player.pos.y, m.player.pos.z].map((v) => +v.toFixed(1)) }; const big = []; m.scene.traverse((o) => { if (o.isMesh && o.visible) { const b = new T.Box3().setFromObject(o); const s = b.getSize(new T.Vector3()); const c = b.getCenter(new T.Vector3()); if (b.containsPoint(cam.getWorldPosition(new T.Vector3())) && s.x > 3) big.push([o.geometry.type, s.toArray().map((v) => +v.toFixed(1)), c.toArray().map((v) => +v.toFixed(1))]); } }); out.containing = big.slice(0, 8); return out; })));
console.log('BIG', JSON.stringify(await p.evaluate(() => { const m = window.__brMatch(); const T = window.__brTHREE; const vis = (o) => { let q = o; while (q) { if (!q.visible) return false; q = q.parent; } return true; }; const out = []; m.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && vis(o)) { const b = new T.Box3().setFromObject(o); const s = b.getSize(new T.Vector3()); if (s.x > 20 || s.y > 20 || s.z > 20) { let n = o; const chain = []; while (n && chain.length < 4) { chain.push(n.name || n.type); n = n.parent; } out.push([o.geometry && o.geometry.type, s.toArray().map((v) => +v.toFixed(0)), b.getCenter(new T.Vector3()).toArray().map((v) => +v.toFixed(0)), chain.join('<'), o.material && o.material.color ? o.material.color.getHexString() : '']); } } }); return out; })));
await p.screenshot({ path: `${prefix}-bus.png` });
await p.evaluate(() => { document.getElementById('ui').style.display = 'none'; window.__brFreeCam([-70, 90, 130], [-70, 54, 41]); });
await wait(5000); await p.screenshot({ path: `${prefix}-out1.png` });
await p.evaluate(() => window.__brFreeCam([-70, 55.8, 41], [-55, 35, 30]));
await wait(5000); await p.screenshot({ path: `${prefix}-out2.png` });
await p.evaluate(() => { document.getElementById('ui').style.display = ''; window.__brFreeCam(null); });
await p.evaluate(() => { document.getElementById('ui').style.display = 'none'; const m = window.__brMatch(); m.scene.traverse((o) => { if (o.geometry && o.geometry.type === 'CylinderGeometry' && o.material && o.material.color && o.material.color.getHexString() === '0d0a12') o.visible = false; }); });
await wait(4000); await p.screenshot({ path: `${prefix}-nohull.png` });
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
