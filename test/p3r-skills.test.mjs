// 埃癸斯 / 岳羽由加莉 的战斗实测（照虎狼丸那次的方式）
// 运行：从项目根执行  node test/p3r-skills.test.mjs
import { makeBattle, enemyRec } from './helpers/battleHarness.js';
import { absoluteRangeKeys } from '../server/sim/targeting.js';

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };
const flat = (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

// ══════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(72));
console.log('  ① 埃癸斯 chess_zj_60_3_a —— 起飞 / 只打空中 / 全弹发射');
console.log('='.repeat(72));

const AIR = 'enemy_air_test';
const ha = makeBattle({
  units: [{ chessId: 'chess_zj_60_3_a', skillIndex: 0, row: 9, col: 6 }],
  enemies: [{ key: AIR, time: 0, route: { motion: 'FLY', start: [9, 8], end: [9, 8], checkpoints: [] } }],
  defs: { enemies: { [AIR]: enemyRec({ key: AIR, hp: 50000, atk: 0, speed: 0, motion: 'FLY' }) } },
  seed: 3, flags: { startOpCooldown: 0 },
  hooks: ['deploy', 'statusApplied', 'damaged'], autoFinish: false, timeLimit: 40, captureNoisy: true,
});
const ua = ha.unit('chess_zj_60_3_a');
ha.step(1);

console.log('=== 起飞（特性）===');
ha.b.emit('deploy', { unit: ua, initial: true });
const airBuff = ua.findBuff('aigis:air');
chk('部署后挂上起飞 buff', !!airBuff, airBuff ? JSON.stringify(airBuff.flags) : '');
chk('liftoff flag 生效', ua.s.flags.liftoff === true);
chk('blockFly flag 生效', ua.s.flags.blockFly === true);
console.log('  s.flags: liftoff=%s blockFly=%s', ua.s.flags.liftoff, ua.s.flags.blockFly);

console.log('\n=== 「只攻击空中敌人」闸门（走引擎真实路径）===');
// 注意：闸门由 kit.trait.canAttack 提供（players.js:247 resolveProfile → professions.js:699 Object.assign），
// ai.js:92 读的是 **prof.canAttack** —— 所以测试必须通过 effectiveProfile 取，不能读 unit.trait
const { effectiveProfile } = await import('../server/sim/ai.js');
const profA = effectiveProfile(ua);
const canAtk = profA.canAttack;
chk('prof.canAttack 已装上（不是 unit.trait）', typeof canAtk === 'function');
console.log('  unit.trait.canAttack 类型: %s（应为 undefined —— 挂在 unit.trait 上是无效的）', typeof ua.trait?.canAttack);
chk('kit.trait.dmgMul 也进了 profile（天赋 +12% 物伤）',
  Math.abs(profA.dmgMul(ha.b, ua, { side: 'enemy' }) - 1.12) < 1e-6,
  String(profA.dmgMul?.(ha.b, ua, { side: 'enemy' })));
const enemyList = ha.enemies();
console.log('  场上敌人: %d 个，isFlying=%s', enemyList.length, enemyList.map((e) => e.isFlying).join(','));
const airOk = canAtk(ha.b, ua);
console.log('  空中目标在场 → canAttack = %s（应为 true）', airOk);
chk('有空中目标时允许攻击', airOk === true);
// 把空中敌人换成地面敌人，应被拒绝
const e0 = enemyList[0];
const wasFly = e0.motion;
e0.motion = 'WALK';
const groundOk = canAtk(ha.b, ua);
e0.motion = wasFly;
console.log('  仅地面目标 → canAttack = %s（应为 false）', groundOk);
chk('只有地面目标时收起攻击', groundOk === false);
// 降落之后应恢复正常攻击
ua.mem.aigisAir = false;
const landedOk = canAtk(ha.b, ua);
ua.mem.aigisAir = true;
console.log('  降落后（仅地面目标）→ canAttack = %s（应为 true）', landedOk);
chk('降落后恢复普通攻击', landedOk === true);

console.log('\n=== S2 全弹发射（6 枚导弹 + 飞踢）===');
const dmgBefore = ha.hooksOf('damaged').length;
const takenBefore = e0.stats.taken ?? 0;
// 手动开 S2
const sk2 = ua.skill;
console.log('  单位当前技能: %s（_a 装的是 S1，S2 需要 _b）', sk2?.id);
chk('_a 装 S1', sk2?.id === 'skchr_aigis_1', sk2?.id);

// 换成 _b（装 S2）另开一场
const hb = makeBattle({
  units: [{ chessId: 'chess_zj_60_3_b', skillIndex: 1, row: 9, col: 6 }],
  enemies: [{ key: AIR, time: 0, route: { motion: 'FLY', start: [9, 8], end: [9, 8], checkpoints: [] } }],
  defs: { enemies: { [AIR]: enemyRec({ key: AIR, hp: 50000, atk: 0, speed: 0, motion: 'FLY' }) } },
  seed: 3, flags: { startOpCooldown: 0 },
  hooks: ['deploy', 'statusApplied', 'damaged'], autoFinish: false, timeLimit: 40, captureNoisy: true,
});
const ub = hb.unit('chess_zj_60_3_b');
hb.step(1);
hb.b.emit('deploy', { unit: ub, initial: true });
console.log('  _b 装的技能: %s', ub.skill?.id);
chk('_b 装 S2', ub.skill?.id === 'skchr_aigis_2', ub.skill?.id);
const eb = hb.enemies()[0];
const takenB0 = eb.stats.taken ?? 0;
const atkPow = ub.s.atk;
console.log('  埃癸斯 atk=%s  敌人 hp=%s', atkPow, Math.round(eb.hp));
// 开技能（S2 是 instant，直接 activate）
const beforePos = { r: ub.tileR, c: ub.tileC };
const okAct = ub.skill.activate ? ub.skill.activate('test', { free: true }) : false;   // free 绕过 SP 检查
console.log('  activate() → %s', okAct);
hb.run(3);
const takenB1 = eb.stats.taken ?? 0;
const missiles = hb.hooksOf('damaged').filter((d) => (d.dmg?.tags ?? []).includes('missile'));
const kicks = hb.hooksOf('damaged').filter((d) => (d.dmg?.tags ?? []).includes('kick'));
console.log('  导弹命中 %d 次，飞踢命中 %d 次', missiles.length, kicks.length);
for (const m of missiles) console.log('     t=' + flat(m.t, 3) + '  dmg=' + Math.round(m.amount) + '  type=' + m.dmg?.type);
for (const k of kicks) console.log('     踢 t=' + flat(k.t, 3) + '  dmg=' + Math.round(k.amount));
chk('导弹命中 6 次', missiles.length === 6, `实际 ${missiles.length}`);
chk('飞踢命中', kicks.length >= 1);
if (missiles.length >= 6) {
  const ts = missiles.map((m) => flat(m.t, 3));
  const t0 = ts[0];
  console.log('  导弹时刻相对首枚: %s（骨架 hits.Skill_2_Begin = [0.667,0.8,0.933,1.067,1.2,1.333]）',
    JSON.stringify(ts.map((x) => flat(x - t0, 3))));
  const a = missiles[0].amount;
  // 这一段用的是 chess_zj_60_3_b（精锐）⇒ 官方 Lv7 的 bb.atk_scale = 1.3
  //（2026-10-17 修正：原断言 0.7 是技能 Lv1 的值，数据已按 mod 惯例改为 _b = Lv7）
  chk('每枚导弹 = 130% 攻击力', Math.abs(a - atkPow * 1.3) < 1, `${Math.round(a)} vs ${Math.round(atkPow * 1.3)}`);
  chk('全部为物理伤害', missiles.every((m) => m.dmg?.type === 'phys'));
  // 时序：骨架 hits.Skill_2_Begin = [0.667,0.8,0.933,1.067,1.2,1.333]，间隔 0.133 s ≈ 3.99 帧
  // → 30 FPS 下必有 ≤1 帧（0.033 s）的量化偏差，按每项 1.5 帧容差断言
  const want = [0, 0.133, 0.266, 0.4, 0.533, 0.667];
  const deltas = ts.map((x) => x - ts[0]);
  const worst = Math.max(...deltas.map((d, i) => Math.abs(d - want[i])));
  console.log('     与骨架的最大偏差 %s s（%s 帧）', flat(worst, 4), flat(worst / 0.0333, 2));
  chk('6 枚导弹时序吻合骨架（每项 ≤1.5 帧）', worst <= 0.05, '最大偏差 ' + flat(worst, 4) + 's');
}
if (kicks.length) {
  // 同为 _b（精锐）⇒ 官方 Lv7 的 bb.kick_atk_scale = 2.7（原 1.5 = Lv1）
  chk('飞踢 = 270% 攻击力', Math.abs(kicks[0].amount - atkPow * 2.7) < 1, `${Math.round(kicks[0].amount)} vs ${Math.round(atkPow * 2.7)}`);
}
console.log('  位移: 开技能前 (%s,%s) → 现在 (%s,%s)', beforePos.r, beforePos.c, ub.tileR, ub.tileC);
// ★ 2026-10-17 反转（用户：「怎么会飞踢后直接部署过去呢」）：官方 ability 里 `Kick` 是
//   {"class":"RangedAttack","projectileKey":"projectile_chr_aigis_s2_kick","mount":"MUZZLE"} —— 从枪口射出的
//   **抛射物**，`TakeOff` 只是 {"class":"EmptyAnimatedAbility"} 动画。所以她**不位移**。
//   原来这里断言"必须位移"，那条是把 `battle.moveRedeploy`（引擎的【移动】：deploySeq+1 / 广播 deploy 事件）
//   当成位移用，会导致飞踢后整个人"重新部署"到目标旁。
chk('★ 自身**不**位移（飞踢是抛射物，不是移动）',
  ub.tileR === beforePos.r && ub.tileC === beforePos.c,
  `(${beforePos.r},${beforePos.c}) → (${ub.tileR},${ub.tileC})`);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(72));
console.log('  ② 岳羽由加莉 chess_zj_60_4_a —— 龙卷箭 / 浮空 / 治愈之风');
console.log('='.repeat(72));

const EY = 'enemy_yukari_test';
const hy = makeBattle({
  units: [{ chessId: 'chess_zj_60_4_a', skillIndex: 0, row: 9, col: 6 }],
  enemies: [{ key: EY, time: 0, route: { motion: 'WALK', start: [9, 8], end: [9, 8], checkpoints: [] } }],
  defs: { enemies: { [EY]: enemyRec({ key: EY, hp: 50000, atk: 0, speed: 0 }) } },
  seed: 5, flags: { startOpCooldown: 0 },
  hooks: ['deploy', 'statusApplied', 'damaged', 'skillEnd'], autoFinish: false, timeLimit: 40, captureNoisy: true,
});
const uy = hy.unit('chess_zj_60_4_a');
hy.step(1);
hy.b.emit('deploy', { unit: uy, initial: true });
const ey = hy.enemies()[0];
console.log('  由加莉 atk=%s  敌人 hp=%s  技能=%s', uy.s.atk, Math.round(ey.hp), uy.skill?.id);
chk('_a 装 S1 龙卷箭', uy.skill?.id === 'skchr_yukari_1', uy.skill?.id);
hy.b.emit('deploy', { unit: uy, initial: true });

const dmgY0 = hy.hooksOf('damaged').length;
const actY = uy.skill.activate ? uy.skill.activate('test', { free: true }) : false;   // free 绕过 SP 检查
console.log('  activate() → %s', actY);
hy.run(4);

const arrows = hy.hooksOf('damaged').filter((d) => (d.dmg?.tags ?? []).includes('arrow'));
const bursts = hy.hooksOf('damaged').filter((d) => (d.dmg?.tags ?? []).includes('burst'));
console.log('  箭矢命中 %d 次，追加范围伤害 %d 次', arrows.length, bursts.length);
for (const a of arrows) console.log('     箭 t=' + flat(a.t, 3) + '  dmg=' + Math.round(a.amount) + '  type=' + a.dmg?.type);
for (const b of bursts) console.log('     爆 t=' + flat(b.t, 3) + '  dmg=' + Math.round(b.amount) + '  type=' + b.dmg?.type);
chk('三发箭矢', arrows.length === 3, `实际 ${arrows.length}`);
chk('追加范围伤害 1 次', bursts.length === 1, `实际 ${bursts.length}`);
if (arrows.length === 3) {
  const ts = arrows.map((a) => flat(a.t, 3));
  const t0 = ts[0];
  console.log('  箭矢时刻相对首发: %s（骨架 hits.Skill_1 = [1.533,1.833,2.133,3.367]）',
    JSON.stringify(ts.map((x) => flat(x - t0, 3))));
  // 由加莉 S1 的 Lv4 bb.multi_atk_scale = 0.55（原 0.5 = Lv1）
    chk('箭矢 = 55% 攻击力', Math.abs(arrows[0].amount - uy.s.atk * 0.55) < 1, `${Math.round(arrows[0].amount)}`);
  chk('箭矢为法术伤害', arrows.every((a) => a.dmg?.type === 'arts'));
  // 骨架 hits.Skill_1 = [1.533,1.833,2.133,3.367]：三箭间隔 0.3 s = 9 帧整
  const dY = ts.map((x) => x - ts[0]);
  chk('三箭间隔 = 0.3 s（9 帧整，应完全吻合）',
    Math.abs(dY[1] - 0.3) < 0.02 && Math.abs(dY[2] - 0.6) < 0.02, JSON.stringify(dY.map((x) => flat(x, 3))));
  if (bursts.length) {
    const burstAt = flat(bursts[0].t - ts[0], 3);
    console.log('     追加伤害相对首箭 %s s（骨架 3.367-1.533 = 1.834）', burstAt);
    chk('追加伤害时刻吻合骨架（≤1.5 帧）', Math.abs(burstAt - 1.834) < 0.05, burstAt + ' vs 1.834');
  }
}
if (bursts.length) {
  // Lv4 bb.final_atk_scale = 2.5（原 2.0 = Lv1）
    chk('追加 = 250% 攻击力', Math.abs(bursts[0].amount - uy.s.atk * 2.5) < 1, `${Math.round(bursts[0].amount)}`);
  chk('追加为法术伤害', bursts[0].dmg?.type === 'arts');
}
const lev = hy.hooksOf('statusApplied').filter((s) => s.status === 'levitate');
chk('浮空已施加', lev.length >= 1, `${lev.length} 次`);
if (lev.length) chk('浮空时长 1.5 秒', Math.abs((lev[0].duration ?? 0) - 1.5) < 1e-6, `${lev[0].duration}`);

console.log('\n=== 治愈之风（技能结束后治疗）===');
// 先把由加莉打伤，再看技能结束是否回血
uy.hp = Math.round(uy.s.maxHp * 0.3);
const hpBefore = uy.hp;
hy.b.emit('skillEnd', { unit: uy, skill: uy.skill });
const healed = uy.hp - hpBefore;
console.log('  血 %s → %s（+%s，期望 +%s = 100%% 攻击力）', hpBefore, uy.hp, healed, Math.round(uy.s.atk));
chk('技能结束后自己回血', healed > 0);
chk('回血量 = 100% 攻击力', Math.abs(healed - uy.s.atk) < 2, `${Math.round(healed)} vs ${Math.round(uy.s.atk)}`);

console.log('\n' + '='.repeat(72));
console.log('%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
console.log('='.repeat(72));
process.exit(fail ? 1 : 0);
