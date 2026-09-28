import fs from 'node:fs';
const buf = fs.readFileSync('public/assets/items/BR_Supply_Chest_Legendary.glb');
const jl = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jl).toString('utf8'));
console.log('has skins?', !!json.skins, (json.skins||[]).length);
console.log('materials:', (json.materials||[]).map(m=>m.name).join(', '));
console.log('images:', (json.images||[]).length, 'textures:', (json.textures||[]).length);
