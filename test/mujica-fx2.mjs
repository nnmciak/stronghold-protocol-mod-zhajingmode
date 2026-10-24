import fs from 'node:fs';
import { FxWiring } from '../public/js/render/vfx/wiring.js';
const idx = JSON.parse(fs.readFileSync(process.argv[2] + '/public/assets/local/fx/index.json', 'utf8'));
const ofx = { active: true, lib: { index: async () => idx, url: () => null, has: () => true, def: () => ({}) } };
const w = new FxWiring(ofx, { unitKey: (i) => [i?.spine, i?.defId].filter(Boolean), record: () => null, view: () => null, speed: () => 1 });
w.idx = idx;
const tgt = { id: 'e1', x: 5, y: 2, flags: 0, isEnemy: true, info: { id: 'e1', spine: 'enemy_1043_zomsbr', defId: 'enemy_1043_zomsbr' } };
let n = 0;
const cases = [
  ['若麦 无皮肤', 'char_4185_amoris', null],
  ['若麦 时装', 'char_4185_amoris', 'char_4185_amoris@avemujica#1'],
  ['祥子 时装', 'char_4182_oblvns', 'char_4182_oblvns@avemujica#1'],
  ['初华 时装', 'char_4184_dolris', 'char_4184_dolris@avemujica#1'],
];
for (const [name, spine, skin] of cases) {
  const id = 'u' + (++n);
  const v = { id, x: 2, y: 2, flags: 0, isEnemy: false, info: { id, spine, defId: spine, ...(skin ? { skin } : {}) } };
  const key = w.unitKeyOf(v);
  const u = w.unitOf(v);
  const set = u ? w._attackSet(u, w.mode(u, v, false), v, tgt, 'ranged', 0) : null;
  console.log(name.padEnd(10), '| unit', key, '| 模式', (u?.modes || []).map((m) => m.name).join('/'), '| proj', set?.projectileKey, '| hit0', JSON.stringify(set?.hit?.[0]?.effects || null));
}
