import fs from 'node:fs';
import { FxWiring } from '../public/js/render/vfx/wiring.js';
const idx = JSON.parse(fs.readFileSync(process.argv[2] + '/public/assets/local/fx/index.json', 'utf8'));
const ofx = { active: true, lib: { index: async () => idx, url: () => null } };
const w = new FxWiring(ofx, { unitKey: (i) => [i?.spine, i?.defId].filter(Boolean), record: () => null, view: () => null, speed: () => 1 });
w.idx = idx;
const v = { id: 'u1', info: { id: 'u1', spine: 'char_172_svrash', defId: 'char_172_svrash', skin: 'char_172_svrash@snow#1' } };
console.log('unit key:', w.unitKeyOf(v));
const u = w.unitOf(v);
console.log('modes[0].attack.projectileKey:', u?.modes?.[0]?.attack?.projectileKey);
console.log('modes[1].attack.hit[0].effects[0]:', u?.modes?.[1]?.attack?.hit?.[0]?.effects?.[0]);
const p = idx.projectiles['projectile_svrash_snow#1'];
console.log('变体 projectile 存在?', !!p);
if (p) {
  const j = JSON.stringify(p);
  console.log('变体 projectile 内含变体 prefab?', j.includes('_snow#1'));
  const keys = [...new Set([...j.matchAll(/"([A-Za-z0-9_]+_snow#1)"/g)].map((m) => m[1]))];
  console.log('变体 projectile 引用的变体 prefab:', keys.slice(0, 6).join(', '));
}
