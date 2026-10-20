// S3 / 二天赋「S.E.E.S.队长」总攻击的触发时机回归。
// 运行（项目根）: node test/p3r-makoto-sees.test.mjs
//
// 官方二天赋：「结城理**替身状态结束后**，带领S.E.E.S.小队发动总攻击，
//             对S.E.E.S.小队队员周围一定范围内的所有敌人造成相当于结城理攻击力430%的真实伤害（可叠加）」
//
// 2026-10-17 修（用户：「我为什么技能期间出现了多次真实伤害 不应该替身状态结束才有吗」）：
//   天赋 install 里的 `battle.on('death', ...)` **漏了"是不是结城理本人死了"的判断**。
//   `death` 是**全局**事件（battle/deploy.js:149 载荷 `{ unit, reason, killer, dying }`），
//   `{ owner: unit }` 只是注册标记、不过滤来源 ⇒ **替身形态下每打死一个敌人就触发一次总攻击**，
//   表现为"平A期间反复出现真实伤害"。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const chess = JSON.parse(readFileSync(join(ROOT, 'data/chess.json'), 'utf8'));
const SEES = chess.chess_zj_60_5_b.talents.find((t) => t.name === 'S.E.E.S.队长')?.bb?.atk_scale;
const KEYS = ['e_1', 'e_2', 'e_3', 'e_4'];
// 本体 (9,6)。总攻击半径 1.5 ⇒ 这 4 个位置的距离分别是 1.0 / 1.0 / 1.41 / 1.0，都在范围内。
const POS = [[9, 7], [8, 6], [10, 7], [8, 7]];

/** 一局：结城理 + 4 个敌人（都在攻击网内）。`hp` 决定它们会不会被打死。 */
function battle(hp, seconds) {
  const enemies = KEYS.map((key, i) => ({ key, time: 0, route: { motion: 'WALK', start: POS[i], end: POS[i], checkpoints: [] } }));
  const defs = { enemies: {} };
  for (const key of KEYS) defs.enemies[key] = enemyRec({ key, hp, atk: 0, def: 0, speed: 0 });
  const h = makeBattle({
    units: [{ chessId: 'chess_zj_60_5_b', row: 9, col: 6 }], enemies, defs,
    seed: 7, flags: { startOpCooldown: 0 }, autoFinish: false, timeLimit: 900, captureNoisy: false,
  });
  const u = h.unit('chess_zj_60_5_b');
  h.step(1);
  h.b.emit('deploy', { unit: u, initial: true });
  h.step(2);

  // 逐帧记录替身态区间 + 天赋真实伤害时刻
  const spans = [];
  const sees = [];
  let start = null;
  h.b.on('damaged', (d) => {
    if (d.dmg?.type !== 'true' || !/Sees/.test((d.dmg?.tags || []).join('+'))) return;
    sees.push({ t: h.b.time, amount: Math.round(d.amount), id: d.target?.id ?? d.tgt?.id });
  });
  const frames = Math.round(seconds / 0.0334);
  for (let i = 0; i < frames; i++) {
    const was = !!u.trait?.doll;
    h.step(1);
    const now = !!u.trait?.doll;
    if (!was && now) start = h.b.time;
    if (was && !now) { spans.push([start, h.b.time]); start = null; }
  }
  if (start != null) spans.push([start, h.b.time]);
  return { h, u, spans, sees };
}

/** 一次总攻击的时刻（同帧多个敌人算一次）。 */
const casts = (sees) => [...new Set(sees.map((x) => x.t.toFixed(2)))];

/** 总攻击是否发生在某个替身态的**结束时刻**（±0.15 秒内算结束那一刻）。 */
function atStateEnd(sees, spans) {
  return sees.every((x) => spans.some(([, end]) => Math.abs(x.t - end) <= 0.15));
}

console.log('=== ① 敌人打不死：总攻击只在替身态结束后 1 次 ===');
{
  const { u, spans, sees } = battle(900000, 70);
  const cs = casts(sees);
  console.log('  替身态 %d 段：%s', spans.length, spans.map(([a, b]) => `${a.toFixed(1)}→${b.toFixed(1)}`).join('  '));
  chk('每个替身态结束后各触发 1 次总攻击', cs.length === spans.length, `${cs.length} 次 / ${spans.length} 段`);
  chk('★ 全部发生在替身态的**结束时刻**（不是平A期间）', atStateEnd(sees, spans),
    sees.map((x) => x.t.toFixed(2)).join(','));
  const perCast = sees.length / Math.max(1, cs.length);
  chk('每次总攻击命中范围内所有敌人（4 个）', perCast === 4, `平均 ${perCast} 个`);
  // ★ 天赋吃的是**替身形态**的攻击力 = 本体 atk × 1.8（不羁之力「替身状态下攻击力+80%」）。
  //   `u.s.atk` 读到的是基础值 843，所以期望值要自己乘 1.8：843 × 1.8 × 4.3 = 6525。
  const MASK_ATK_MUL = 1.8;
  const expect = u.s.atk * MASK_ATK_MUL * SEES;
  chk('单次金额 = 替身攻击力 × 430%', Math.abs((sees[0]?.amount ?? 0) - expect) <= 3,
    `实测 ${sees[0]?.amount}  期望 ${Math.round(expect)}（本体 atk ${Math.round(u.s.atk)} × ${MASK_ATK_MUL} × ${SEES}）`);
}

console.log('\n=== ② ★ 敌人会被打死：平A期间**不得**触发总攻击（本轮修的 bug）===');
{
  const { spans, sees } = battle(12000, 60);      // 小怪血量，会被打死
  const cs = casts(sees);
  console.log('  替身态 %d 段：%s', spans.length, spans.map(([a, b]) => `${a.toFixed(1)}→${b.toFixed(1)}`).join('  '));
  console.log('  总攻击 %d 次：%s', cs.length, cs.join(', ') || '（无）');
  chk('打死小怪**不再**触发总攻击（回归）', atStateEnd(sees, spans),
    sees.map((x) => x.t.toFixed(2)).join(',') || '（无伤害）');
  chk('总攻击次数不超过替身态段数', cs.length <= spans.length, `${cs.length} ≤ ${spans.length}`);
}

console.log('\n=== ③ 无敌人时安全（不报错、不产生伤害）===');
{
  const h = makeBattle({
    units: [{ chessId: 'chess_zj_60_5_b', row: 9, col: 6 }],
    enemies: [{ key: 'e_far', time: 0, route: { motion: 'WALK', start: [1, 1], end: [1, 1], checkpoints: [] } }],
    defs: { enemies: { e_far: enemyRec({ key: 'e_far', hp: 1e6, atk: 0, def: 0, speed: 0 }) } },
    seed: 7, flags: { startOpCooldown: 0 }, autoFinish: false, timeLimit: 300, captureNoisy: false,
  });
  const u = h.unit('chess_zj_60_5_b');
  h.step(1);
  h.b.emit('deploy', { unit: u, initial: true });
  h.step(2);
  let n = 0;
  h.b.on('damaged', (d) => { if (/Sees/.test((d.dmg?.tags || []).join('+'))) n++; });
  chk('跑 30 秒不抛异常', (() => { try { h.run(30); return true; } catch { return false; } })());
  chk('远处敌人不受总攻击影响', n === 0, `${n} 次`);
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
