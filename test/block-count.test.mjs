// 阻挡数语义回归：`blockCnt: -99` 是"置零"，之后的加成照加。
// 运行（项目根）: node test/block-count.test.mjs
//
// 背景（用户 2026-10-17：「替身状态并非永远是0 而是基于基础状态降到0」）：
//   引擎的 `MUL_KEYS` 里没有 `blockMul`，所以"把阻挡数压成 0"只能靠加法惯用法 `blockCnt: -99`
//   （professions.js 的替身/解放者/驭械术师等，共 6 处）。纯加法下 -99 会把**后来的加成一起吃掉**：
//   结城理 S3 的俄耳甫斯「阻挡数+2」⇒ 2 + 2 - 99 < 0 ⇒ 0，那个 +2 永远无效。
//   修好后（units.js）：置零器之前的一切归零，之后的加成照加 ⇒ 本体 2 / 塔纳托斯 0 / 俄耳甫斯 2。
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

let seq = 0;
function mk(cid) {
  const E = 'e_blk' + (seq++);
  const h = makeBattle({
    units: [{ chessId: cid, row: 9, col: 6 }],
    enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [1, 1], end: [1, 1], checkpoints: [] } }],
    defs: { enemies: { [E]: enemyRec({ key: E, hp: 1e6, atk: 0, def: 0, speed: 0 }) } },
    seed: 7, flags: { startOpCooldown: 0 }, autoFinish: false, timeLimit: 300, captureNoisy: false,
  });
  const u = h.unit(cid);
  h.step(1);
  h.b.emit('deploy', { unit: u, initial: true });
  h.step(3);
  return { h, u, sk: u.skill };
}

console.log('=== ① 结城理 S3：本体 2 → 塔纳托斯 0 → 俄耳甫斯 2 ===');
{
  const { h, u, sk } = mk('chess_zj_60_5_b');
  const base = u.base.blockCnt;
  chk('本体形态 = 基础阻挡数', u.s.blockCnt === base, `${u.s.blockCnt} / base ${base}`);
  chk('本体基础值是 2', base === 2, String(base));

  sk.sp = sk.spCost ?? 15;
  sk.activate('manual', { free: true });
  h.run(3);
  chk('塔纳托斯形态 = 0（替身置零）', u.s.blockCnt === 0, String(u.s.blockCnt));

  // 「受到致命伤时改为召唤俄耳甫斯」
  u.hp = 1;
  h.b.dealDamage(h.enemies()[0] ?? u, u, { amount: 999999, type: 'true', isSkill: false, tags: ['t'] });
  h.run(3);
  chk('切到俄耳甫斯', u.mem?.makotoMask === 'orpheus', String(u.mem?.makotoMask));
  chk('★ 俄耳甫斯阻挡数 = 2（置零 0 + 加成 2）', u.s.blockCnt === 2, String(u.s.blockCnt));
  chk('makoto:dollBlock 已挂上且 mods=2',
    Number(u.findBuff('makoto:dollBlock')?.mods?.blockCnt) === 2,
    JSON.stringify(u.findBuff('makoto:dollBlock')?.mods));
}

console.log('\n=== ② 结城理 S1：俄耳甫斯但无阻挡加成 → 0 ===');
{
  const { h, u, sk } = mk('chess_zj_60_5_b');
  sk.sp = sk.spCost ?? 8;
  sk.activate('manual', { free: true });
  h.run(3);
  chk('替身态阻挡数 = 0', u.s.blockCnt === 0, String(u.s.blockCnt));
  chk('未挂 makoto:dollBlock（+2 只属于 S3 的俄耳甫斯）', !u.findBuff('makoto:dollBlock'));
}

console.log('\n=== ③ 回归：没有 -99 的普通干员，阻挡数不受影响 ===');
{
  const { h, u } = mk('chess_zj_01_a');       // 能天使，blockCnt 1，不带任何 -99 置零器
  chk('阻挡数 = 基础值', u.s.blockCnt === u.base.blockCnt, `${u.s.blockCnt} / base ${u.base.blockCnt}`);
  chk('基础值是 1', u.base.blockCnt === 1, String(u.base.blockCnt));
  chk('身上没有 blockCnt 置零器', !u.buffs.some((b) => Number(b?.mods?.blockCnt) <= -99));
}

console.log('\n=== ④ 回归：替身态结束后阻挡数恢复 ===');
{
  const { h, u, sk } = mk('chess_zj_60_5_b');
  const base = u.base.blockCnt;
  sk.sp = sk.spCost ?? 15;
  sk.activate('manual', { free: true });
  h.run(3);
  chk('替身中 = 0', u.s.blockCnt === 0, String(u.s.blockCnt));
  // 等替身态自然结束（20 秒 + 1 秒切换）
  h.run(26);
  chk('替身结束后回到本体', !u.trait?.doll, `doll=${!!u.trait?.doll}`);
  chk('阻挡数恢复为基础值', u.s.blockCnt === base, `${u.s.blockCnt} / base ${base}`);
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
