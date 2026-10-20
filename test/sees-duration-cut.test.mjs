// 回归：S.E.E.S「<每叠加200层>【S.E.E.S】成员持续类技能的持续时间-1s（最多减到1s）」
// 用埃癸斯（skchr_aigis_1，duration 20s）实测：层数 0/199/200/400 → 20/20/19/18 秒。
// 运行（项目根）: node test/sees-duration-cut.test.mjs
import { makeBattle, enemyRec } from './helpers/battleHarness.js';
import { seesDurationCut } from '../server/sim/bondtiming.js';

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

let seq = 0;
function setup(layers, chessId = 'chess_zj_60_3_a') {   // 埃癸斯：S1 duration 20s
  const E = 'sd' + (seq++);
  const h = makeBattle({
    units: [{ chessId, row: 9, col: 6, skillIndex: 0 }],
    enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [3, 3], end: [3, 3], checkpoints: [] } }],
    defs: { enemies: { [E]: enemyRec({ key: E, hp: 1e9, atk: 0, def: 0, speed: 0 }) } },
    seed: 7,
    flags: { startOpCooldown: 0, layerGainsEnabled: true },
    bonds: { seesShip: { active: true, count: 2, layers } },
    autoFinish: false, timeLimit: 600, captureNoisy: false,
  });
  const u = h.unit(chessId);
  h.step(2);
  return { h, u };
}

/** 直接开技能（跳过 SP 等待）：用 sim 的 public castSkill / useSkill if present, else force SP. */
function cast(h, u) {
  const sk = u.skill;
  if (!sk || typeof sk.activate !== 'function') throw new Error('没有 skill runtime');
  sk.sp = sk.baseSpCost;          // 直接灌满 SP
  const ok = sk.activate('test', { free: true });
  if (!ok) throw new Error('activate 返回 false（kind=' + sk.kind + '）');
}

console.log('=== ① 0 层：不减（20s） ===');
{
  const { h, u } = setup(0);
  console.log('     cut =', seesDurationCut(h.b, u));
  cast(h, u);
  chk('★ 0 层 duration = 20', Math.abs(u.skill.timeLeft - 20) < 1e-6, `timeLeft=${u.skill.timeLeft}`);
}

console.log('\n=== ② 199 层：还不够 200，不减（20s） ===');
{
  const { h, u } = setup(199);
  cast(h, u);
  chk('★ 199 层 duration = 20', Math.abs(u.skill.timeLeft - 20) < 1e-6, `timeLeft=${u.skill.timeLeft}`);
}

console.log('\n=== ③ 200 层：-1s（19s） ===');
{
  const { h, u } = setup(200);
  cast(h, u);
  chk('★ 200 层 duration = 19', Math.abs(u.skill.timeLeft - 19) < 1e-6, `timeLeft=${u.skill.timeLeft}`);
}

console.log('\n=== ④ 400 层：-2s（18s） ===');
{
  const { h, u } = setup(400);
  cast(h, u);
  chk('★ 400 层 duration = 18', Math.abs(u.skill.timeLeft - 18) < 1e-6, `timeLeft=${u.skill.timeLeft}`);
}

console.log('\n=== ⑤ 9999 层：最低 1s ===');
{
  const { h, u } = setup(9999);
  cast(h, u);
  chk('★ 9999 层 duration = 1（下限）', Math.abs(u.skill.timeLeft - 1) < 1e-6, `timeLeft=${u.skill.timeLeft}`);
}

console.log('\n=== ⑥ 非 S.E.E.S 干员：不受影响 ===');
{
  const E = 'sd' + (seq++);
  const h = makeBattle({
    units: [{ chessId: 'chess_char_1_01_a', row: 9, col: 6, skillIndex: 0 }],
    enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [3, 3], end: [3, 3], checkpoints: [] } }],
    defs: { enemies: { [E]: enemyRec({ key: E, hp: 1e9, atk: 0, def: 0, speed: 0 }) } },
    seed: 7, flags: { startOpCooldown: 0, layerGainsEnabled: true },
    bonds: { seesShip: { active: true, count: 2, layers: 2000 } },
    autoFinish: false, timeLimit: 600, captureNoisy: false,
  });
  const u = h.unit('chess_char_1_01_a');
  h.step(2);
  console.log('     cut =', seesDurationCut(h.b, u));
  chk('★ 非成员 cut = 0', seesDurationCut(h.b, u) === 0);
}

console.log('\n=== ⑦ 结城理傀儡/替身态：每 200 层 -1s，最低 1s ===');
{
  for (const [layers, want] of [[0, 20], [200, 19], [400, 18], [9999, 1]]) {
    const { h, u } = setup(layers, 'chess_zj_60_5_a');   // 结城理：技能都是瞬发，只有傀儡态有时长
    cast(h, u);                                          // 进替身
    const buff = (u.buffs || []).find((b) => b && b.key === 'trait:substitute');
    const left = buff ? (buff.timeLeft ?? buff.duration) : NaN;
    // 替身态的 buff 时长 = 1s 切换动画 + dollDuration；下限 1s 时总时长 = 1 + 1
    chk(`★ 傀儡态 ${layers} 层 → ${want}s`, Math.abs(left - (want + 1)) < 0.51,
      `substitute 剩余 ${typeof left === 'number' ? left.toFixed(2) : left}s（含 1s 切换动画）`);
    h.step(0.1);
  }
}

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
