// 回归：新敌方惊变「萨卡兹巫术」（ejibian_sakaziwushu，史诗）
//   所有敌人造成伤害时，附带该次伤害 10% 的凋亡损伤
// 运行（项目根）: node test/ejibian-sakazi.test.mjs
import fs from 'node:fs';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

console.log('=== ① 卡面 ===');
for (const mid of ['mode_single_zhajing', 'mode_multi_zhajing']) {
  const pool = cfg.modes[mid].enemyJibian.pool;
  const card = pool.find((c) => c.effectId === 'ejibian_sakaziwushu');
  chk(`${mid} 有这张卡`, !!card);
  chk(`${mid} 稀有度 = epic（史诗）`, card?.rarity === 'epic', card?.rarity);
  chk(`${mid} 文案`, card?.desc === '所有敌人造成伤害时会携带此次伤害10%的凋亡损伤', card?.desc);
}

console.log('\n=== ② 战场：敌人打我方 → 目标吃到 10% 凋亡 ===');
let seq = 0;
function setup(cards) {
  const E = 'sk' + (seq++);
  const h = makeBattle({
    units: [{ chessId: 'chess_char_1_01_a', row: 9, col: 6 }],
    enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [9, 7], end: [9, 7], checkpoints: [] } }],
    defs: { enemies: { [E]: enemyRec({ key: E, hp: 1e9, atk: 1000, def: 0, speed: 0 }) } },
    seed: 7,
    flags: { startOpCooldown: 0, enemyJibian: cards },
    autoFinish: false, timeLimit: 600, captureNoisy: false,
  });
  h.step(2);
  const u = h.unit('chess_char_1_01_a');
  const e = h.enemies()[0];
  if (u && u.elem) u.elem.apoptosis = 0;
  return { h, u, e };
}

const off = setup([]);
const on = setup(['ejibian_sakaziwushu']);

const DMG = 5000;
for (const s of [off, on]) {
  s.h.b.dealDamage(s.e, s.u, { amount: DMG, type: 'phys' });
  s.h.step(0.1);
}
const gainOff = off.u.elem.apoptosis;
const gainOn = on.u.elem.apoptosis;
console.log('  不带卡：凋亡 +%s   带卡：凋亡 +%s（伤害 %s）', gainOff.toFixed(1), gainOn.toFixed(1), DMG);
chk('不带卡时不会自己涨', gainOff === 0, String(gainOff));
chk('带卡时确实涨了凋亡', gainOn > 0, String(gainOn));
chk('进条量约 = 伤害 × 10% × 元素吸收（≤ 10%）',
  gainOn <= DMG * 0.1 + 1e-6 && gainOn >= DMG * 0.1 * 0.05 - 1e-6, String(gainOn));

console.log('\n=== ③ 我方打敌人不会误触发 ===');
{
  const s = setup(['ejibian_sakaziwushu']);
  const before = s.e.elem ? s.e.elem.apoptosis : 0;
  s.h.b.dealDamage(s.u, s.e, { amount: DMG, type: 'phys' });
  s.h.step(0.1);
  const after = s.e.elem ? s.e.elem.apoptosis : 0;
  chk('敌人身上没有多出凋亡', after === before, `${before} → ${after}`);
}

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
