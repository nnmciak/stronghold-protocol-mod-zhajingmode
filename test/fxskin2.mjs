import fs from 'node:fs';
import { FxWiring } from '../public/js/render/vfx/wiring.js';

const idx = JSON.parse(fs.readFileSync(process.argv[2] + '/public/assets/local/fx/index.json', 'utf8'));
const ofx = { active: true, lib: { index: async () => idx } };
const opts = { unitKey: (info) => [info?.spine, info?.defId].filter(Boolean), record: () => null, view: () => null, speed: () => 1 };
const mk = () => { const w = new FxWiring(ofx, opts); w.idx = idx; return w; };

// 实例 1（备战）：带皮肤
const w1 = mk();
const v1 = { id: 'u1', info: { id: 'u1', spine: 'char_172_svrash', defId: 'char_172_svrash', skin: 'char_172_svrash@snow#1' } };
console.log('实例1:', w1.unitKeyOf(v1));

// 实例 2（战斗）：全新实例，视图没有 skin
const w2 = mk();
const v2 = { id: 'u1', info: { id: 'u1', spine: 'char_172_svrash', defId: 'char_172_svrash' } };
console.log('实例2（无 skin）:', w2.unitKeyOf(v2));
const u2 = w2.unitOf(v2);
console.log('实例2 的 unit 含 snow#1?', JSON.stringify(u2 || {}).includes('_snow#1'));

// 实例 2 先缓存本体、再拿到标签的情况
const w3 = mk();
const v3 = { id: 'u9', info: { id: 'u9', spine: 'char_172_svrash', defId: 'char_172_svrash' } };
console.log('实例3 先:', w3.unitKeyOf(v3));
const v3b = { id: 'u9', info: { id: 'u9', spine: 'char_172_svrash', defId: 'char_172_svrash', skin: 'char_172_svrash@snow#1' } };
console.log('实例3 后带皮肤:', w3.unitKeyOf(v3b));
console.log('实例3 unit 含 snow#1?', JSON.stringify(w3.unitOf(v3b) || {}).includes('_snow#1'));
