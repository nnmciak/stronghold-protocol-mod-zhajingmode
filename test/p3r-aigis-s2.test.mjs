// 埃癸斯（裂空炮手）行为回归：对地规避 / 开技降落 / 打完必回起飞态。
// 运行（项目根）: node test/p3r-aigis-s2.test.mjs
//
// 2026-10-17 加固：S2 原来在两条提前返回的路上不会重新起飞 ——
//   ① `if (!cands.length) return;`（范围内没有目标，空放）
//   ② 飞踢回调里 `if (!e) return;`（目标中途死了）
//   两条都会把她**永久留在地面**（S2 是 instant，没有 onEnd 兜底）。现在整段包在 try/finally 里。
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

let seq = 0;
function setup({ gnd = false, air = false, skillIndex = undefined, gndHp = 1e9 } = {}) {
  const enemies = [], defs = { enemies: {} };
  if (gnd) {
    const k = 'eg' + (seq++);
    enemies.push({ key: k, time: 0, route: { motion: 'WALK', start: [9, 7], end: [9, 7], checkpoints: [] } });
    defs.enemies[k] = enemyRec({ key: k, hp: gndHp, atk: 0, def: 0, speed: 0 });
  }
  if (air) {
    const k = 'ea' + (seq++);
    enemies.push({ key: k, time: 0, route: { motion: 'FLY', start: [9, 8], end: [9, 8], checkpoints: [] } });
    defs.enemies[k] = enemyRec({ key: k, hp: 1e9, atk: 0, def: 0, speed: 0, motion: 'FLY' });
  }
  if (!enemies.length) {
    const k = 'ef' + (seq++);
    enemies.push({ key: k, time: 0, route: { motion: 'WALK', start: [1, 1], end: [1, 1], checkpoints: [] } });
    defs.enemies[k] = enemyRec({ key: k, hp: 1e9, atk: 0, def: 0, speed: 0 });
  }
  const h = makeBattle({
    units: [{ chessId: 'chess_zj_60_3_a', skillIndex, row: 9, col: 6 }],
    enemies, defs, seed: 7, flags: { startOpCooldown: 0 }, autoFinish: false, timeLimit: 900, captureNoisy: false,
  });
  const u = h.unit('chess_zj_60_3_a');
  h.step(1);
  h.b.emit('deploy', { unit: u, initial: true });
  h.step(3);
  return { h, u, sk: u.skill };
}
/**
 * 在起飞态？判据用 **`aigis:air` buff**（`takeOff` 挂的，`land` 撤掉）——
 * 不要用 `u.s.flags?.liftoff`：`flags` 不在 `s`（结算后的属性对象）上，那个式子恒为 false，会误判。
 */
const airborne = (u) => !!u.findBuff('aigis:air') && u.mem?.aigisAir === true;

console.log('=== ① 起飞态：只打空中、不打地面（官方特性）===');
{
  const { h, u } = setup({ gnd: true });
  let n = 0;
  h.b.on('damaged', (d) => { if (d.source === u) n++; });
  h.run(8);
  chk('地面敌人在范围内时不出手（对地规避）', n === 0, `${n} 次`);
  chk('保持起飞态', airborne(u), `air=${u.mem?.aigisAir} buff=${!!u.findBuff('aigis:air')}`);
}

console.log('\n=== ② S1：开技降落 → 打地面 → 结束晕眩 → 重新起飞 ===');
{
  const { h, u, sk } = setup({ gnd: true, skillIndex: 0 });
  sk.sp = sk.spCost ?? 30;
  sk.activate('manual', { free: true });
  h.step(3);
  chk('开技后已降落（aigisAir=false）', u.mem?.aigisAir === false);
  // 跑到技能结束之后
  let stunSeen = false;
  for (let i = 0; i < 30 * 25; i++) { h.step(1); if (u.findBuff('stun')) stunSeen = true; }
  chk('技能结束后被晕眩', stunSeen);
  chk('晕眩结束后回到起飞态', airborne(u), `aigisAir=${u.mem?.aigisAir} liftoff=${!!u.s.flags?.liftoff}`);
}

console.log('\n=== ③ ★ S2 空放（范围内无目标）：必须回到起飞态 ===');
{
  const { h, u, sk } = setup({ skillIndex: 1 });     // 敌人放远处（S2）
  chk('开技前是起飞态', airborne(u));
  sk.sp = sk.spCost ?? 30;
  sk.activate('manual', { free: true });
  // S2 是瞬发：`onStart` 同步跑完，而「降落 → 打 → 起飞」整段都在 `try/finally` 里
  // ⇒ 空放这条路上 `finally` 立刻执行，所以**开技返回时就已经回到起飞态**
  //   （原来 `if (!cands.length) return;` 会跳过起飞，把她永久留在地面）
  chk('★ 空放后立刻回到起飞态（原来会永久卡在地面）', airborne(u),
    `aigisAir=${u.mem?.aigisAir} buff=${!!u.findBuff('aigis:air')}`);
  h.run(4);
  chk('★ 4 秒后仍在起飞态', airborne(u), `aigisAir=${u.mem?.aigisAir}`);
}

console.log('\n=== ④ ★ S2 正常发射：打完回到起飞态 ===');
{
  const { h, u, sk } = setup({ gnd: true, skillIndex: 1 });   // ★ 必须显式装 S2（skillIndex 1）
  const hits = [];
  h.b.on('damaged', (d) => { if (d.source === u) hits.push((d.dmg?.tags || []).join('+')); });
  sk.sp = sk.spCost ?? 30;
  sk.activate('manual', { free: true });
  h.run(3);
  chk('打出了导弹', hits.some((t) => t.includes('missile')), `${hits.length} 次伤害`);
  chk('打出了飞踢', hits.some((t) => t.includes('kick')));
  chk('★ 打完后回到起飞态', airborne(u), `aigisAir=${u.mem?.aigisAir} liftoff=${!!u.s.flags?.liftoff}`);
}

console.log('\n=== ⑤ S2 目标中途死亡：也要回到起飞态 ===');
{
  const { h, u, sk } = setup({ gnd: true, gndHp: 1, skillIndex: 1 });   // 一击必死（S2）
  sk.sp = sk.spCost ?? 30;
  sk.activate('manual', { free: true });
  h.run(4);
  chk('目标已死亡', !h.enemies()[0]?.alive);
  chk('★ 目标死后仍回到起飞态', airborne(u), `aigisAir=${u.mem?.aigisAir} liftoff=${!!u.s.flags?.liftoff}`);
}

console.log('\n=== ⑥ 数值：导弹 / 飞踢按数据倍率 ===');
{
  const { h, u, sk } = setup({ gnd: true, skillIndex: 1 });   // ★ 必须显式装 S2
  const got = [];
  h.b.on('damaged', (d) => { if (d.source === u) got.push({ tags: (d.dmg?.tags || []).join('+'), a: Math.round(d.amount) }); });
  sk.sp = sk.spCost ?? 30;
  sk.activate('manual', { free: true });
  h.run(3);
  const atk = 882;                                    // 官方白值（_a）
  const missile = got.find((x) => x.tags.includes('missile'));
  const kick = got.find((x) => x.tags.includes('kick'));
  chk('导弹 = 攻击力 × 1.0（_a 数据 atk_scale）', Math.abs((missile?.a ?? 0) - atk * 1.0) <= 2,
    `${missile?.a} vs ${Math.round(atk * 1.0)}`);
  chk('飞踢 = 攻击力 × 2.1（_a 数据 kick_atk_scale）', Math.abs((kick?.a ?? 0) - atk * 2.1) <= 2,
    `${kick?.a} vs ${Math.round(atk * 2.1)}`);
}

console.log('\n=== ⑦ ★ 飞踢**不会**把她重新部署过去 ===');
{
  // 用户 2026-10-17：「怎么会飞踢后直接部署过去呢」
  // 官方 ability: {"node":"Kick","class":"RangedAttack","animKey":"Skill_2_Loop",
  //               "projectileKey":"projectile_chr_aigis_s2_kick","mount":"MUZZLE","attackType":1,"damageType":1}
  //   ⇒ 飞踢是**从枪口射出的抛射物**；同组 {"node":"TakeOff","class":"EmptyAnimatedAbility"} 只是动画。
  // 原来用 `battle.moveRedeploy` 把她搬走 —— 那是引擎的【移动】：deploySeq+1 / deployedAt / 广播 deploy 事件。
  const { h, u, sk } = setup({ gnd: true, skillIndex: 1 });
  const before = { r: u.tileR, c: u.tileC, seq: u.deploySeq, x: u.x, y: u.y };
  sk.sp = sk.spCost ?? 30;
  sk.activate('manual', { free: true });
  h.run(3);
  chk('★ 位置不变（没被搬走）',
    u.tileR === before.r && u.tileC === before.c && u.x === before.x && u.y === before.y,
    `(${before.r},${before.c}) → (${u.tileR},${u.tileC})`);
  chk('★ deploySeq 不变（没有被当成一次再部署）', u.deploySeq === before.seq,
    `${before.seq} → ${u.deploySeq}`);
  // 【移动】会 emit deploy；整场只应有最初那一次部署
  const dep = h.eventsOf('deploy');
  chk('★ 技能期间没有额外的 deploy 事件', dep.length <= 1, `${dep.length} 条`);
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
