import fs from 'node:fs';
import { FxWiring } from '../public/js/render/vfx/wiring.js';

const idx = JSON.parse(fs.readFileSync(process.argv[2] + '/public/assets/local/fx/index.json', 'utf8'));
const played = [];
const rec = (v) => { if (typeof v === 'string' && (idx.prefabs[v] || v.includes('#'))) played.push(v); else if (Array.isArray(v)) v.forEach(rec); };

const lib = {
  index: async () => idx,
  url: (group, key) => { rec(key); return '/x/' + key; },
  has: (group, key) => !!(idx.prefabs?.[key] || idx.projectiles?.[key] || idx.skills?.[key]),
  notePluginUnit: () => {},
  def: (key) => { rec(key); return { key, layers: [], emitters: [] }; },
  tex: () => null,
};
const ofx = {
  active: true,
  lib,
  play: (key, ...rest) => { rec(key); return { key, kill() {} }; },
  spawn: (key, ...rest) => { rec(key); return { key, kill() {} }; },
  spawnAt: (key, ...rest) => { rec(key); return { key }; },
  fx: (key, ...rest) => { rec(key); return { key }; },
};
const opts = { unitKey: (info) => [info?.spine, info?.defId].filter(Boolean), record: () => null, view: () => null, speed: () => 1 };
const w = new FxWiring(ofx, opts);
w.idx = idx;

const src = { id: 'u1', x: 3, y: 3, flags: 0, isEnemy: false, info: { id: 'u1', spine: 'char_172_svrash', defId: 'char_172_svrash', skin: 'char_172_svrash@snow#1' } };
const tgt = { id: 'e1', x: 5, y: 3, flags: 0, isEnemy: true, info: { id: 'e1', spine: 'enemy_1043_zomsbr', defId: 'enemy_1043_zomsbr' } };
console.log('解析 key:', w.unitKeyOf(src));
try {
  const r = w.castStart(src, tgt, 'ranged', {});
  console.log('castStart 返回:', r);
} catch (e) { console.log('castStart 抛错:', e.message); }
console.log('请求过的 key（前 20）:', played.slice(0, 20));
