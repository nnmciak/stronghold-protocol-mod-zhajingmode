// 埃癸斯：起飞态只打空中，但**没有空中敌人时也必须能开技**（否则死锁）。
// 运行（项目根）: node test/p3r-aigis-trigger.test.mjs
//
// 用户 2026-10-17：「埃癸斯不会攻击地面上的敌人正常吗」→「但是没有空中敌人他也不会主动开技能啊」
//
// 特性（官方数据）：部署后起飞，起飞后只攻击空中敌人；技能开启时降落且攻击造成群体物理伤害。
//   前半句让 kit 的 `trait.canAttack` 在起飞态收起攻击 ⇒ 默认的 `DEFAULT` 触发规则
//   （`onAboutToAttack`「**即将攻击时**才开技」）永远不满足 ⇒ **永远不降落** ⇒ 打不到地面。
//   实测（修复前）：只有地面敌人 30 秒 0 次开技 / 0 次命中；地面+空中同时存在**也是 0 次**
//   （她的攻击循环在"无可打目标"时不产生 onAboutToAttack）。
//
// 修法：两个技能都声明 `trigger: { rule: 'SEARCH' }` —— skills.js:24 的注释写明它正是
//   「an enemy inside the INITIAL range, checked every tick **without waiting for an attack**」，
//   判定用 `u.baseRangeKeys`（她自己的范围）+ `u.profile`（空中地面都算）。
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

let seq = 0;
/** 一局：埃癸斯 + 指定的敌人（air / gnd）。 */
function setup({ air = false, gnd = false, skillIndex = 0, seconds = 30 }) {
  const enemies = [], defs = { enemies: {} };
  if (air) {
    const k = 'ea' + (seq++);
    enemies.push({ key: k, time: 0, route: { motion: 'FLY', start: [9, 8], end: [9, 8], checkpoints: [] } });
    defs.enemies[k] = enemyRec({ key: k, hp: 1e9, atk: 0, def: 0, speed: 0, motion: 'FLY' });
  }
  if (gnd) {
    const k = 'eg' + (seq++);
    enemies.push({ key: k, time: 0, route: { motion: 'WALK', start: [9, 8], end: [9, 8], checkpoints: [] } });
    defs.enemies[k] = enemyRec({ key: k, hp: 1e9, atk: 0, def: 0, speed: 0, motion: 'WALK' });
  }
  const h = makeBattle({
    units: [{ chessId: 'chess_zj_60_3_a', skillIndex, row: 9, col: 6 }],
    enemies, defs, seed: 7, flags: { startOpCooldown: 0 }, autoFinish: false, timeLimit: 900, captureNoisy: false,
  });
  const u = h.unit('chess_zj_60_3_a');
  h.step(1);
  h.b.emit('deploy', { unit: u, initial: true });
  h.step(3);

  const casts = [];
  let hits = 0;
  h.b.on('skillStart', (c) => { if (c.unit === u) casts.push(+h.b.time.toFixed(2)); });
  h.b.on('damaged', (d) => { if (d.source === u) hits++; });
  // 灌满 SP（等价于"等条满"），再跑 seconds 秒
  u.skill.sp = u.skill.spCost ?? 30;
  h.run(seconds);
  return { h, u, casts, hits };
}

console.log('=== ① ★ 没有空中敌人时也会开技（本轮修的 bug）===');
for (const [label, opt] of [['只有地面敌人', { gnd: true }], ['地面 + 空中都有', { gnd: true, air: true }]]) {
  const { u, casts, hits } = setup(opt);
  chk(`${label} → 会开技`, casts.length > 0, `开技 ${casts.length} 次`);
  chk(`${label} → 开技后打到了敌人`, hits > 0, `命中 ${hits} 次`);
  chk(`${label} → 触发规则是 SEARCH`, u.skill.rule === 'SEARCH', String(u.skill.rule));
}

console.log('\n=== ② 只有空中敌人时照旧正常 ===');
{
  const { casts, hits } = setup({ air: true });
  chk('会开技', casts.length > 0, `${casts.length} 次`);
  chk('打到了空中敌人', hits > 0, `${hits} 次`);
}

console.log('\n=== ③ S2 也声明了 SEARCH ===');
{
  const { u } = setup({ gnd: true, skillIndex: 1, seconds: 2 });
  chk('S2 的触发规则 = SEARCH', u.skill.id === 'skchr_aigis_2' && u.skill.rule === 'SEARCH',
    `${u.skill.id} / ${u.skill.rule}`);
}

console.log('\n=== ④ 完整周期：降落 → 打地面 → 晕眩 10 秒 → 重新起飞 ===');
{
  const { h, u, hits } = setup({ gnd: true, seconds: 60 });
  const marks = [];
  // 重新跑一局并逐帧记录状态变化
  const r = setup({ gnd: true, seconds: 0 });
  let prevAir = !!r.u.mem?.aigisAir, prevStun = !!r.u.findBuff('stun');
  for (let i = 0; i < 60 * 26; i++) {
    r.h.step(1);
    const a = !!r.u.mem?.aigisAir, s = !!r.u.s.flags?.stun;
    if (a !== prevAir) { marks.push({ t: +r.h.b.time.toFixed(1), what: a ? 'takeoff' : 'land' }); prevAir = a; }
    if (s !== prevStun) { marks.push({ t: +r.h.b.time.toFixed(1), what: s ? 'stunOn' : 'stunOff' }); prevStun = s; }
  }
  console.log('     时间线: %s', marks.map((m) => `${m.t}:${m.what}`).join('  '));
  chk('开技时降落', marks.some((m) => m.what === 'land'));
  chk('落地后打到地面（第一局命中 %d 次）', hits > 0, `${hits} 次`);
  chk('技能结束晕眩', marks.some((m) => m.what === 'stunOn'));
  chk('晕眩结束后重新起飞', marks.filter((m) => m.what === 'takeoff').length > 0);
  chk('晕眩时长 = 10 秒', (() => {
    const on = marks.find((m) => m.what === 'stunOn'), off = marks.find((m) => m.what === 'stunOff');
    return on && off && Math.abs((off.t - on.t) - 10) <= 0.2;
  })(), (() => {
    const on = marks.find((m) => m.what === 'stunOn'), off = marks.find((m) => m.what === 'stunOff');
    return on && off ? `${(off.t - on.t).toFixed(1)} 秒` : '未捕获';
  })());
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
