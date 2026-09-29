// node tools/probe-weapons.mjs [port] -> bbox of every weapon mesh as built for the hero/viewmodel
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const CHROME = ['C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((c) => fs.existsSync(c));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto(`http://localhost:${process.argv[2] || 5173}/`, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 3000));
const out = await p.evaluate(async () => {
  const T = await import('/node_modules/.vite/deps/three.js').catch(() => null);
  const vm = await import('/src/avatar/viewmodel.js');
  const cat = await import('/src/game/weapons.js');
  const THREE = window.__brTHREE;
  const ids = [...Object.keys(cat.GUNS), ...Object.keys(cat.MELEE)];
  const ms = ids.map((id) => [id, vm.createWeaponMesh(id, 'sakura', 'heart')]);
  await new Promise((r) => setTimeout(r, 15000));
  return ms.map(([id, m]) => { m.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(m); const s = bx.getSize(new THREE.Vector3()); return [id, +s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2)].join(' '); });
});
console.log(out.join('\n'));
await b.close();
