// 由加莉 S2「明镜止水」的触发型效果：「术法充盈」只加法术伤害。
// 运行（项目根）: node test/p3r-yukari-arcane.test.mjs
//
// 官方 S2：为范围内最多N名我方干员（优先选择结城理、术师干员）施加触发型效果：
//          干员施放技能后，自身在15秒内获得X%【术法充盈】
// 2026-10-17（用户口径「仅法术伤害 +15%」）：原来给的是 `dmgDealtMul`（**全部**伤害），
//   与「术法」二字不符；改为 `artsDealtMul` —— damage.js:272 的乘区链
//   `dmgDealtMul × (phys|arts)DealtMul`，`artsDealtMul` 只在 `type === 'arts'` 时参与。
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

let seq = 0;
/**
 * 一局：由加莉 + 一个友方。
 * ★ 由加莉 `_a` 的**默认技能是 S1**（`skillIndex` 0）——测 S2 必须显式选 `skillIndex: 1`，
 *   否则 `u.skill` 是 `skchr_yukari_1`，S2 的触发型效果根本不会跑。
 */
function setup(allyChess = 'chess_zj_60_3_a') {
  const E = 'e_ar' + (seq++);
  const h = makeBattle({
    units: [
      { chessId: 'chess_zj_60_4_a', skillIndex: 1, row: 9, col: 6 },   // 由加莉 → S2「明镜止水」
      { chessId: allyChess, row: 9, col: 7 },
    ],
    enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [5, 5], end: [5, 5], checkpoints: [] } }],
    defs: { enemies: { [E]: enemyRec({ key: E, hp: 1e6, atk: 0, def: 0, speed: 0 }) } },
    seed: 7, flags: { startOpCooldown: 0 }, autoFinish: false, timeLimit: 600, captureNoisy: false,
  });
  const y = h.unit('chess_zj_60_4_a');
  const a = h.unit(allyChess);
  h.step(1);
  h.b.emit('deploy', { unit: y, initial: true });
  h.b.emit('deploy', { unit: a, initial: true });
  h.step(3);
  return { h, y, a };
}

console.log('=== ① 确认测的是 S2（而不是默认的 S1）===');
{
  const { y } = setup();
  chk('由加莉当前技能 = skchr_yukari_2', y.skill?.id === 'skchr_yukari_2', String(y.skill?.id));
}

console.log('=== ① S2 给友方挂上触发标记，友方开技后获得 buff ===');
{
  const { h, y, a } = setup();
  y.skill.sp = y.skill.spCost ?? 45;
  const ok = y.skill.activate('manual', { free: true });
  h.run(2);
  chk('S2 开启', ok);
  const mark = a.findBuff('yukari:trigger');
  chk('友方被挂上 yukari:trigger', !!mark, JSON.stringify(mark?.data));
  // 友方开技 → 触发
  a.skill.sp = a.skill.spCost ?? 30;
  a.skill.activate('manual', { free: true });
  h.step(2);
  const boost = a.findBuff('yukari:boost');
  chk('友方开技后获得 yukari:boost', !!boost, JSON.stringify(boost?.mods));
  chk('★ 用的是 artsDealtMul（仅法术）', Number(boost?.mods?.artsDealtMul) > 1,
    JSON.stringify(boost?.mods));
  chk('★ 不再用 dmgDealtMul（全部伤害）', boost?.mods?.dmgDealtMul === undefined,
    JSON.stringify(boost?.mods));
}

console.log('\n=== ② 数值：_a(普通 Lv4) 15% / 持续 15 秒 ===');
{
  const { h, y, a } = setup();
  y.skill.sp = y.skill.spCost ?? 45;
  y.skill.activate('manual', { free: true });
  h.run(2);
  a.skill.sp = a.skill.spCost ?? 30;
  a.skill.activate('manual', { free: true });
  h.step(2);
  const b = a.findBuff('yukari:boost');
  // 官方 skchr_yukari_2 的 damage_up：Lv1 10% / Lv3 15% / Lv6 20% / Lv10 30%。
  // `_a` = Lv4 ⇒ 15%（`_b` = Lv7 ⇒ 20%）。乘区是 `artsDealtMul` = 1 + damage_up。
  chk('加成 = 1.15（_a Lv4 的 15%）', Math.abs(Number(b?.mods?.artsDealtMul ?? 0) - 1.15) < 1e-9,
    String(b?.mods?.artsDealtMul));
  chk('持续 15 秒', Math.abs(Number(b?.duration ?? 0) - 15) < 0.01, String(b?.duration));
}

console.log('\n=== ③ 优先选择：结城理优先于其他 ===');
{
  const E = 'e_ar' + (seq++);
  const h = makeBattle({
    units: [
      { chessId: 'chess_zj_60_4_a', skillIndex: 1, row: 9, col: 6 },   // 由加莉 → S2
      { chessId: 'chess_zj_60_3_a', row: 9, col: 7 },
      { chessId: 'chess_zj_60_5_a', row: 9, col: 8 },   // 结城理
    ],
    enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [5, 5], end: [5, 5], checkpoints: [] } }],
    defs: { enemies: { [E]: enemyRec({ key: E, hp: 1e6, atk: 0, def: 0, speed: 0 }) } },
    seed: 7, flags: { startOpCooldown: 0 }, autoFinish: false, timeLimit: 600, captureNoisy: false,
  });
  const y = h.unit('chess_zj_60_4_a');
  const m = h.unit('chess_zj_60_5_a');
  h.step(1);
  for (const u of [y, h.unit('chess_zj_60_3_a'), m]) h.b.emit('deploy', { unit: u, initial: true });
  h.step(3);
  y.skill.sp = y.skill.spCost ?? 45;
  y.skill.activate('manual', { free: true });
  h.run(2);
  chk('结城理被标记（优先级最高）', !!m.findBuff('yukari:trigger'));
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
