// 回归：多人炸惊 boss 血量 = 基础 7000 亿 × 人数阶梯（阶梯不变）
// 运行（项目根）: node test/multi-boss-hp.test.mjs
import fs from 'node:fs';
import { bossLadderHp, bossPoolHp } from '../server/match/finalAssault.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const multi = cfg.modes.mode_multi_zhajing.bossHpScale;
const single = cfg.modes.mode_single_zhajing.bossHpScale;

console.log('=== ① 配置 ===');
chk('多人 baseHp = 7000 亿', multi.baseHp === 700000000000, String(multi.baseHp));
chk('阶梯没变（perExtra 1 / after4 1 / doubleAfter10 false）',
  multi.ladder.perExtra === 1 && multi.ladder.after4 === 1 && multi.ladder.doubleAfter10 === false,
  JSON.stringify(multi.ladder));
chk('单人保持 1 万亿（未受影响）', single.baseHp === 1000000000000, String(single.baseHp));

console.log('\n=== ② 实际血量（base × (1 + 1×(n-1)) ，>10 人不翻倍） ===');
const fmt = (v) => (v >= 1e12 ? `${(v / 1e12).toFixed(2)} 万亿` : `${(v / 1e8).toFixed(0)} 亿`);
// 12 人 = 10 人（阶梯在 10 人封顶，doubleAfter10:false 之后不再涨）
const cases = [[1, 700000000000], [2, 1400000000000], [4, 2800000000000], [10, 7000000000000], [12, 7000000000000]];
for (const [n, want] of cases) {
  const got = bossLadderHp(multi.baseHp, multi.ladder, n);
  chk(`${n} 人 → ${fmt(got)}`, got === want, `${got}（期望 ${want}）`);
}

console.log('\n=== ③ 走真实入口 bossPoolHp（炸惊私有分支） ===');
const gd = { mode: { bossHpScale: multi }, isSolo: false, boss: () => null, difficulty: 'ABYSS' };
chk('4 人 = 2800 亿', bossPoolHp(gd, 'boss_1', 4) === 2800000000000, String(bossPoolHp(gd, 'boss_1', 4)));
chk('10 人 = 7 万亿', bossPoolHp(gd, 'boss_1', 10) === 7000000000000, String(bossPoolHp(gd, 'boss_1', 10)));

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
