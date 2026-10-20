// 回归：惊变「迅捷」「精准」改版
//   +50 层 → +80 层；稀有度 rare → normal（普通）
// 运行（项目根）: node test/jibian-swift-preci.test.mjs
import fs from 'node:fs';
import { registerMeta } from '../server/sim/content/jibian.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
const bonds = JSON.parse(fs.readFileSync(new URL('../data/bonds.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

console.log('=== ① 卡面：+80 层 / 普通 ===');
const CASES = [
  ['jibian_xunjie', '迅捷', 'swiftShip', '你的【迅捷】盟约+80层（无需激活盟约）'],
  ['jibian_jingzhun', '精准', 'preciShip', '你的【精准】盟约+80层（无需激活盟约）'],
];
for (const mid of ['mode_single_zhajing', 'mode_multi_zhajing']) {
  for (const [eid, name, bond, desc] of CASES) {
    const card = cfg.modes[mid].jibian.pool.find((c) => c.effectId === eid);
    chk(`${mid} ${name}：文案 +80`, !!card && card.desc === desc, card?.desc);
    chk(`${mid} ${name}：稀有度 normal`, card?.rarity === 'normal', card?.rarity);
    chk(`${mid} ${name}：图标 ${bond}`, card?.bond === bond, card?.bond);
  }
}

console.log('\n=== ② 处理器：真的加 80 层 ===');
const reg = new Map();
registerMeta({ register: (k, h) => reg.set(k, h) });
for (const [eid, name, bond] of CASES) {
  const h = reg.get(`jibian:${eid}`);
  chk(`${eid} 已注册`, !!h);
  const calls = [];
  const ctx = {
    source: { kind: 'effect' },
    addLayers: (b, n, opts) => { calls.push({ b, n, reason: opts?.reason }); return n; },
    counter: () => 0, setCounter: () => {}, toast: () => {},
  };
  h.onChoicePick(ctx, { card: { id: eid } });
  chk(`${name}：给 ${bond} +80 层`, calls.length === 1 && calls[0].b === bond && calls[0].n === 80,
    JSON.stringify(calls));
}

console.log('\n=== ③ 两个盟约存在 ===');
chk('swiftShip', !!bonds.swiftShip, bonds.swiftShip?.name);
chk('preciShip', !!bonds.preciShip, bonds.preciShip?.name);

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
