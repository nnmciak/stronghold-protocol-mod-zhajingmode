// 由加莉「治愈之风」触发源回归。
// 运行（项目根）: node test/p3r-yukari-talent.test.mjs
//
// 官方天赋「治愈之风」：技能结束后，治疗自身和攻击范围内最多3名干员相当于岳羽由加莉攻击力100%的生命值
//   ⇒ 「技能结束后」指**她自己的技能**。
//
// 2026-10-17 修（三人代码体检）：`battle.on('skillEnd', ...)` **没判断是谁的技能结束了**。
//   `skillEnd` 是**全局**事件（载荷含 `unit`），`{ owner: unit }` 只是注册标记、不过滤来源 ——
//   与结城理 kit 里那个 `death` 监听是同一类错误。
//   实测（修复前）：让**结城理**开技，skillEnd 全是 unit=2（非由加莉），却仍治疗了 4 次。
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

let seq = 0;
function setup(otherPos = [9, 8]) {
  const E = 'e_yt' + (seq++);
  const h = makeBattle({
    units: [
      { chessId: 'chess_zj_60_4_a', row: 9, col: 6 },              // 由加莉
      ...(otherPos ? [{ chessId: 'chess_zj_60_5_a', row: otherPos[0], col: otherPos[1] }] : []),   // 结城理（另一个干员）
    ],
    enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [5, 5], end: [5, 5], checkpoints: [] } }],
    defs: { enemies: { [E]: enemyRec({ key: E, hp: 1e6, atk: 0, def: 0, speed: 0 }) } },
    seed: 7, flags: { startOpCooldown: 0 }, autoFinish: false, timeLimit: 600, captureNoisy: false,
  });
  const y = h.unit('chess_zj_60_4_a');
  const m = otherPos ? h.unit('chess_zj_60_5_a') : null;
  h.step(1);
  h.b.emit('deploy', { unit: y, initial: true });
  if (m) h.b.emit('deploy', { unit: m, initial: true });
  h.step(3);
  return { h, y, m };
}

console.log('=== ① ★ 别人的技能结束**不该**触发她的天赋（本轮修的 bug）===');
{
  const { h, y, m } = setup();
  let heals = 0, yukariSkillEnds = 0, otherSkillEnds = 0;
  h.b.on('heal', (d) => { if (d?.source === y) heals++; });
  h.b.on('skillEnd', (c) => { if (c?.unit === y) yukariSkillEnds++; else otherSkillEnds++; });
  m.hp = 1;
  m.skill.sp = m.skill.spCost ?? 14;
  m.skill.activate('manual', { free: true });
  h.run(30);
  chk('确实有「别人的技能结束」事件发生', otherSkillEnds > 0, `${otherSkillEnds} 次`);
  chk('由加莉本人没有开技', yukariSkillEnds === 0, `${yukariSkillEnds} 次`);
  chk('★ 由加莉治疗次数 = 0', heals === 0, `${heals} 次`);
}

console.log('\n=== ② 她自己的技能结束仍然正常治疗 ===');
{
  const { h, y } = setup(null);
  let heals = 0, ownEnds = 0;
  h.b.on('heal', (d) => { if (d?.source === y) heals++; });
  h.b.on('skillEnd', (c) => { if (c?.unit === y) ownEnds++; });
  y.hp = Math.round(y.s.maxHp * 0.4);
  const hp0 = y.hp;
  y.skill.sp = y.skill.spCost ?? 32;
  y.skill.activate('manual', { free: true });
  h.run(30);
  chk('她自己的 skillEnd 发生了', ownEnds > 0, `${ownEnds} 次`);
  chk('治疗发生了', heals > 0, `${heals} 次`);
  chk('自身被治疗（天赋含"自身"）', y.hp > hp0, `${Math.round(hp0)} → ${Math.round(y.hp)}`);
}

console.log('\n=== ③ 范围：攻击范围内治疗、范围外不治疗 ===');
{
  for (const [label, pos, want] of [['紧邻 (9,7)', [9, 7], true], ['同排远 (9,14)', [9, 14], false], ['角落 (1,1)', [1, 1], false]]) {
    const { h, y, m } = setup(pos);
    m.hp = 1;
    const hp0 = m.hp;
    y.skill.sp = y.skill.spCost ?? 32;
    y.skill.activate('manual', { free: true });
    h.run(30);
    const healed = m.hp > hp0;
    chk(`${label} → ${want ? '应被治疗' : '不应被治疗'}`, healed === want, `hp ${Math.round(hp0)} → ${Math.round(m.hp)}`);
  }
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
