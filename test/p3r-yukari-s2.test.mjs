// 由加莉 S2 明镜止水 + 触发型效果（自制机制）的专项测试
// 运行：从项目根执行  node test/p3r-yukari-s2.test.mjs
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const EY = 'enemy_s2_test';
const h = makeBattle({
  // 由加莉 (_b 装 S2) + 一个友方当触发目标
  units: [
    { chessId: 'chess_zj_60_4_b', skillIndex: 1, row: 9, col: 6, uid: 1 },
    { chessId: 'chess_char_1_01_a', row: 10, col: 6, uid: 2 },
  ],
  enemies: [{ key: EY, time: 0, route: { motion: 'WALK', start: [9, 8], end: [9, 8], checkpoints: [] } }],
  defs: { enemies: { [EY]: enemyRec({ key: EY, hp: 90000, atk: 0, speed: 0 }) } },
  seed: 11, flags: { startOpCooldown: 0 },
  hooks: ['skillStart', 'skillEnd', 'damaged'], autoFinish: false, timeLimit: 60, captureNoisy: true,
});

const y = h.unit('chess_zj_60_4_b');
const mate = h.unit('chess_char_1_01_a');
h.step(1);
console.log('=== 场上单位 ===');
console.log('  由加莉: %s (%s) 技能=%s', y?.def?.name, y?.defId, y?.skill?.id);
console.log('  友方  : %s (%s) 技能=%s', mate?.def?.name, mate?.defId, mate?.skill?.id);
chk('由加莉装 S2', y?.skill?.id === 'skchr_yukari_2', y?.skill?.id);
chk('友方在场', !!mate && mate.deployed);
if (!y || !mate) process.exit(1);

// 让两人有交集：由加莉与友方相邻（3-1 范围含 [0,0] 所以自己格也算，但友方在旁更稳）
const dist = Math.max(Math.abs(y.tileR - mate.tileR), Math.abs(y.tileC - mate.tileC));
console.log('  两人切比雪夫距离: %d 格', dist);

console.log('\n=== 开 S2（明镜止水）===');
const t0 = h.b.time;
const ok = y.skill.activate('test', { free: true });
console.log('  activate() → %s', ok);
h.step(1);

const marks = [];
for (const u of h.b.allyUnits) {
  const m = u.findBuff ? u.findBuff('yukari:trigger') : null;
  if (m) marks.push({ u, m });
}
console.log('  挂了标记的单位: %d 个', marks.length);
for (const { u, m } of marks) {
  console.log('     %s (%s)  data=%s', u.def?.name, u.defId, JSON.stringify(m.data));
}
chk('S2 给友方挂了触发标记', marks.length >= 1, `${marks.length} 个`);
chk('标记带 source/dur/up 数据', !!marks[0]?.m?.data, JSON.stringify(marks[0]?.m?.data));

// 由加莉给自己也会挂标记（范围内含自己），但她是辅助 —— 触发只作用于**友方**。
// 所以测试要选一个非她自己的被标记单位。
const selfMarked = marks.find(({ u }) => u === y);
const allyMarked = marks.find(({ u }) => u !== y);
console.log('  她自己被标记: %s    友方被标记: %s', !!selfMarked, !!allyMarked);
chk('范围内含自己，故她自己也有标记', !!selfMarked);
chk('友方也被标记', !!allyMarked);

if (selfMarked) {
  h.b.emit('skillStart', { unit: y, skill: y.skill, reason: 'self' });
  chk('辅助不给自己加伤（自己触发无 boost）', !y.findBuff('yukari:boost'));
}

const marked = allyMarked?.u;
if (marked) {
  console.log('\n=== 让被标记的友方（%s）开技能 → 应触发伤害提升 ===', marked.def?.name);
  const before = marked.findBuff('yukari:boost');
  console.log('  开技能前 boost buff: %s', before ? '有' : '无');
  chk('触发前没有 boost（干净状态）', !before);
  // 触发：直接 emit skillStart（真实对局由引擎在技能开始时发出）
  h.b.emit('skillStart', { unit: marked, skill: marked.skill, reason: 'test' });
  const boost = marked.findBuff('yukari:boost');
  console.log('  开技能后 boost buff: %s', boost ? JSON.stringify({ mods: boost.mods, dur: boost.duration }) : '无');
  chk('触发型效果生效（友方开技能→获得伤害提升）', !!boost);
  if (boost) {
    // Lv4 bb.damage_up = 0.15 ⇒ dmgDealtMul 1.15（原断言 1.1 是技能 Lv1 的 0.10）\n  chk('伤害提升 15%', Math.abs((boost.mods?.dmgDealtMul ?? 1) - 1.15) < 1e-6, JSON.stringify(boost.mods));
    chk('持续 15 秒', Math.abs((boost.duration ?? 0) - 15) < 1e-6, `${boost.duration}`);
  }
  // 幂等：再触发一次不应叠加
  h.b.emit('skillStart', { unit: marked, skill: marked.skill, reason: 'test2' });
  const nBoost = (marked.buffs || []).filter((b) => b.key === 'yukari:boost').length;
  chk('重复触发不叠加', nBoost <= 1, `${nBoost} 个`);
}

console.log('\n=== 未标记的友方不应触发 ===');
// 找一个没被标记的单位（若由加莉自己没被标记）
const unmarked = h.b.allyUnits.find((u) => u !== marked && !(u.findBuff && u.findBuff('yukari:trigger')));
if (unmarked) {
  const b0 = unmarked.findBuff('yukari:boost');
  h.b.emit('skillStart', { unit: unmarked, skill: unmarked.skill, reason: 'test' });
  const b1 = unmarked.findBuff('yukari:boost');
  console.log('  %s 开技能前/后 boost: %s / %s', unmarked.def?.name, !!b0, !!b1);
  chk('未标记单位不获得提升', !b0 && !b1);
} else {
  console.log('  （场上没有未标记的友方可测）');
}

console.log('\n' + '='.repeat(60));
console.log('%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
console.log('='.repeat(60));
process.exit(fail ? 1 : 0);
