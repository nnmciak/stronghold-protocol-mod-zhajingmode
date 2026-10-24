import fs from 'node:fs';
import { FxWiring } from '../public/js/render/vfx/wiring.js';
const idx = JSON.parse(fs.readFileSync(process.argv[2] + '/public/assets/local/fx/index.json', 'utf8'));
const ofx = { active: true, lib: { index: async () => idx, url: () => null, has: () => true, def: () => ({}) } };
const w = new FxWiring(ofx, { unitKey: (i) => [i?.spine, i?.defId].filter(Boolean), record: () => null, view: () => null, speed: () => 1 });
w.idx = idx;
const src = { id: 'u1', x: 2, y: 2, flags: 0, isEnemy: false, info: { id: 'u1', spine: 'char_172_svrash', defId: 'char_172_svrash', skin: 'char_172_svrash@snow#1' } };
const tgt = { id: 'e1', x: 5, y: 2, flags: 0, isEnemy: true, info: { id: 'e1', spine: 'enemy_1043_zomsbr', defId: 'enemy_1043_zomsbr' } };
const u = w.unitOf(src);
console.log('unit key:', w.unitKeyOf(src), '| modes:', (u?.modes || []).map((m) => m.name).join(','));
console.log('mode() 解析:', w.mode(u, src, false)?.name);
for (let i = 0; i < (u?.modes || []).length; i++) {
  const set = w._attackSet(u, u.modes[i], src, tgt, 'ranged', 0);
  if (!set) { console.log('  mode', u.modes[i].name, '→ set=null'); continue; }
  console.log('  mode', u.modes[i].name, '| hit[0]:', JSON.stringify(set.hit[0]?.effects || null), '| cast[0]:', JSON.stringify(set.cast[0]?.effects || null), '| projectileKey:', set.projectileKey);
}
const proj = idx.projectiles[setProjectile()] || null;
function setProjectile() { const s = w._attackSet(u, u.modes[0], src, tgt, 'ranged', 0); return s?.projectileKey; }
console.log('projectile 记录含变体?', proj ? JSON.stringify(proj).includes('_snow#1') : 'n/a');
