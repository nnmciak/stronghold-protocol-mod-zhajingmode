import fs from 'node:fs';
import { FxWiring } from '../public/js/render/vfx/wiring.js';

const idx = JSON.parse(fs.readFileSync(process.argv[2] + '/public/assets/local/fx/index.json', 'utf8'));
const ofx = { active: true, lib: { index: async () => idx } };
const opts = {
  unitKey: (info) => [info?.spine, info?.defId].filter(Boolean),
  record: () => null,
  view: () => null,
  speed: () => 1,
};
const w = new FxWiring(ofx, opts);
w.idx = idx;

const info = (id, skin) => ({ id, spine: 'char_172_svrash', defId: 'char_172_svrash', skin });
// A：一开始就带皮肤
const va = { id: 'a1', info: info('a1', 'char_172_svrash@snow#1') };
console.log('A unitKeyOf:', w.unitKeyOf(va));
const ua = w.unitOf(va);
console.log('A unitOf 存在?', !!ua, '| 含 snow#1?', JSON.stringify(ua || {}).includes('_snow#1'));
// B：先本体（无 skin），再带皮肤（模拟战斗中视图先到）
const vb = { id: 'b1', info: info('b1', null) };
console.log('B 第一次:', w.unitKeyOf(vb));
vb.info.skin = 'char_172_svrash@snow#1';
console.log('B 第二次:', w.unitKeyOf(vb));
const ub = w.unitOf(vb);
console.log('B unitOf 含 snow#1?', JSON.stringify(ub || {}).includes('_snow#1'));
// C：先带皮肤，然后一个新视图没有 skin（模拟攻击时的视图）
const vc = { id: 'c1', info: info('c1', 'char_172_svrash@snow#1') };
console.log('C 预加载:', w.unitKeyOf(vc));
const vc2 = { id: 'c1', info: info('c1', null) };
console.log('C 攻击视图:', w.unitKeyOf(vc2));
const uc = w.unitOf(vc2);
console.log('C unitOf 含 snow#1?', JSON.stringify(uc || {}).includes('_snow#1'));
