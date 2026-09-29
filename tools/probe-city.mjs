/** Blossom City validator: loot per district, nothing sealed or wet, districts apart. Run: node tools/probe-city.mjs */
import * as THREE from 'three';
import { buildBlossomCity, cityHeightAt, CITY_POIS } from '../src/world/blossomCity.js';
import { SEA_Y } from '../src/world/map.js';

const world = buildBlossomCity(new THREE.Scene(), 5);
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
const inBox = (x, y, z) => world.boxes.find((b) => x > b.minX - 0.4 && x < b.maxX + 0.4 && z > b.minZ - 0.4 && z < b.maxZ + 0.4 && b.maxY > y + 0.4 && b.minY < y + 1.6);

for (const p of CITY_POIS) {
  const chests = world.anchors.chests.filter((a) => a.poi === p.id).length;
  const floors = world.anchors.floors.filter((a) => a.poi === p.id).length;
  check(chests >= 6, `${p.name}: only ${chests} chests`);
  check(floors >= 12, `${p.name}: only ${floors} floor loot`);
  console.log(`${p.name.padEnd(18)} chests ${chests}  floor ${floors}  ground ${cityHeightAt(p.x, p.z).toFixed(1)}`);
}
for (const [kind, list] of Object.entries(world.anchors)) {
  for (const a of list) {
    check(cityHeightAt(a.x, a.z) > SEA_Y + 0.1, `${kind} at ${a.x.toFixed(0)},${a.z.toFixed(0)} is wet`);
    check(!inBox(a.x, a.y, a.z), `${kind} at ${a.x.toFixed(0)},${a.z.toFixed(0)} is inside geometry`);
  }
}
for (let i = 0; i < CITY_POIS.length; i++) for (let j = i + 1; j < CITY_POIS.length; j++) {
  const a = CITY_POIS[i], b = CITY_POIS[j];
  check(Math.hypot(a.x - b.x, a.z - b.z) > a.r + b.r, `${a.name} overlaps ${b.name}`);
}
console.log(`collision boxes: ${world.boxes.length}, drops: ${world.anchors.drops.length}`);
if (fail.length) { console.error('FAILED:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log('city ok');
