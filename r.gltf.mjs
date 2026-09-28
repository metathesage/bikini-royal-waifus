import fs from 'node:fs';
const buf = fs.readFileSync('public/assets/items/BR_Supply_Chest_Legendary.glb');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
console.log('nodes:', (json.nodes||[]).length);
console.log('meshes:', (json.meshes||[]).length);
console.log('scenes:', JSON.stringify(json.scenes||[]));
console.log('scene nodes:', JSON.stringify((json.scenes?.[0]?.nodes||[]).slice(0,10)));
console.log('node names:', (json.nodes||[]).slice(0,12).map(n=>n.name).join(' | '));
