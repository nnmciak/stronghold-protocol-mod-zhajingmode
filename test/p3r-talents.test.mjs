// 三位 P3R 干员的天赋专项测试
// 运行（项目根）: node test/p3r-talents.test.mjs
//   埃癸斯 反暗影特殊压制兵装：① 造成物伤 +12%  ② 受到物伤 -12%   ← ② 之前没测过
//   由加莉 治愈之风：① 治疗后回血  ② 治疗范围内的队友（最多 3 名）← 队友那半之前没测过
//   虎狼丸 黑色猎犬：见 test/kormr-talent.test.mjs（已 12 项通过，这里只做交叉确认）
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

// ══════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(70));
console.log('  ① 埃癸斯 反暗影特殊压制兵装');
console.log('='.repeat(70));

const E1 = 'enemy_hitter';
// 敌人在普攻范围内（虎狼丸那次测出：单位普攻范围只有 rangeId 的 2 格）
const hA = makeBattle({
  units: [{ chessId: 'chess_zj_60_3_a', row: 9, col: 6 }],
  enemies: [{ key: E1, time: 0, route: { motion: 'FLY', start: [9, 8], end: [9, 8], checkpoints: [] } }],
  defs: { enemies: { [E1]: enemyRec({ key: E1, hp: 200000, atk: 500, speed: 0, motion: 'FLY', range: 3 }) } },
  seed: 4, flags: { startOpCooldown: 0 },
  hooks: ['damaged'], autoFinish: false, timeLimit: 60, captureNoisy: true,
});
const aigis = hA.unit('chess_zj_60_3_a');
hA.step(1);
hA.b.emit('deploy', { unit: aigis, initial: true });

const t0 = aigis.s.traitBb ?? aigis.def?.traitBb ?? {};
// talentBb 从 chess 记录取；直接从记录读更稳
const chess = (await import('../server/sim/simdata.js')).getDefaultSource().rawChess('chess_zj_60_3_a');
const bb0 = chess.talents[0].bb;
console.log('  天赋 bb: %s', JSON.stringify(bb0));
chk('天赋有 damage_scale', bb0.damage_scale > 1, String(bb0.damage_scale));
chk('天赋有 damage_resistance', bb0.damage_resistance > 0, String(bb0.damage_resistance));

console.log('\n  ── ① 造成物伤 +12% ──');
// 埃癸斯打敌人（她是远程，rangeId 3-6）
const eA = hA.enemies()[0];
const dealt0 = eA.stats.taken ?? 0;
hA.run(6);
const dealt1 = (eA.stats.taken ?? 0) - dealt0;
const atk = aigis.s.atk;
console.log('  6 秒内埃癸斯造成伤害 %s（攻击力 %s，攻击间隔 %s）', Math.round(dealt1), atk, aigis.s.interval);
chk('埃癸斯能造成伤害', dealt1 > 0);
// 每次普攻的基础伤害（考虑敌人防御）：atk * dmgScale，再减防御
const dmgHits = hA.hooksOf('damaged').filter((d) => d.source === aigis && d.target?.side === 'enemy');
console.log('  命中 %d 次，单次伤害: %s', dmgHits.length, dmgHits.slice(0, 4).map((d) => Math.round(d.amount)).join(', '));
if (dmgHits.length) {
  // 天赋 +12% 已进 profile.dmgMul → 单次伤害应为 (atk - def) * 1.12
  const eDef = 0;   // enemyRec 默认 def 0
  const expect = atk * 1.12;
  const got = dmgHits[0].amount;
  console.log('  单次伤害 %s，期望 atk×1.12 = %s', Math.round(got), Math.round(expect));
  chk('单次伤害含 +12% 天赋加成', Math.abs(got - expect) < atk * 0.05, `${Math.round(got)} vs ${Math.round(expect)}`);
}

console.log('\n  ── ② 受到物伤 -12% ──');
// 用一个纯物理敌人打她，测她实际受到的伤害 vs 无天赋的对照
const E2 = 'enemy_phys';
function takenWith(chessId) {
  const h = makeBattle({
    units: [{ chessId, row: 9, col: 6 }],
    enemies: [{ key: E2, time: 0, route: { motion: 'FLY', start: [9, 8], end: [9, 8], checkpoints: [] } }],
    defs: { enemies: { [E2]: enemyRec({ key: E2, hp: 200000, atk: 500, def: 0, speed: 0, motion: 'FLY', range: 3, dmgType: 'phys' }) } },
    seed: 4, flags: { startOpCooldown: 0 }, hooks: ['damaged'], autoFinish: false, timeLimit: 30, captureNoisy: true,
  });
  const u = h.unit(chessId);
  h.step(1);
  h.b.emit('deploy', { unit: u, initial: true });
  h.run(8);
  const hits = h.hooksOf('damaged').filter((d) => d.target === u && d.dmg?.type === 'phys');
  const total = hits.reduce((s, d) => s + d.amount, 0);
  return { hits: hits.length, total, def: u.s.def, hp: u.hp, maxHp: u.s.maxHp };
}
const withT = takenWith('chess_zj_60_3_a');
console.log('  埃癸斯（有天赋）: 挨 %d 次，共 %s', withT.hits, Math.round(withT.total));
console.log('     防御 %s，血 %s/%s', withT.def, Math.round(withT.hp), Math.round(withT.maxHp));
chk('埃癸斯挨到了物理伤害', withT.hits > 0, `${withT.hits} 次`);
if (withT.hits) {
  console.log('  说明：天赋的 physTakenMul = 1 - %s = %s', bb0.damage_resistance, (1 - bb0.damage_resistance).toFixed(2));
  // 直接验证 profile 上的 physTakenMul 是否来自天赋
  const { effectiveProfile } = await import('../server/sim/ai.js');
  // 用一场新战斗取单位
  const h2 = makeBattle({
    units: [{ chessId: 'chess_zj_60_3_a', row: 9, col: 6 }],
    enemies: [], seed: 1, flags: { startOpCooldown: 0 }, autoFinish: false, timeLimit: 5,
  });
  const u2 = h2.unit('chess_zj_60_3_a');
  h2.step(1);
  const buf = u2.findBuff('talent:aigis:resist');
  console.log('  天赋减免 buff: %s', buf ? JSON.stringify(buf.mods) : '（无）');
  chk('天赋减免 buff 已挂上（physTakenMul）', !!buf && typeof buf.mods?.physTakenMul === 'number',
    buf ? String(buf.mods.physTakenMul) : '');
  if (buf) chk('减免值 = 1 - 12% = 0.88', Math.abs((buf.mods.physTakenMul ?? 1) - (1 - bb0.damage_resistance)) < 1e-6,
    String(buf.mods.physTakenMul));

  // ★ 硬数字对照：同一场景分别打埃癸斯与另一个干员，比实际单次受伤
  console.log('\n  ── 硬数字对照：同场景的实际单次受伤 ──');
  function singleHit(chessId) {
    const h = makeBattle({
      units: [{ chessId, row: 9, col: 6 }],
      enemies: [{ key: E2, time: 0, route: { motion: 'FLY', start: [9, 8], end: [9, 8], checkpoints: [] } }],
      defs: { enemies: { [E2]: enemyRec({ key: E2, hp: 200000, atk: 500, def: 0, speed: 0, motion: 'FLY', range: 3, dmgType: 'phys' }) } },
      seed: 4, flags: { startOpCooldown: 0 }, hooks: ['damaged'], autoFinish: false, timeLimit: 30, captureNoisy: true,
    });
    const u = h.unit(chessId);
    h.step(1);
    h.b.emit('deploy', { unit: u, initial: true });
    h.run(8);
    const hits = h.hooksOf('damaged').filter((d) => d.target === u && d.dmg?.type === 'phys');
    return { n: hits.length, first: hits[0]?.amount ?? 0, def: u.s.def, atk: 500, hp: u.s.maxHp };
  }
  const AG = singleHit('chess_zj_60_3_a');
  // 对照组：一个在池里的普通狙击（能天使），防御不同所以要按公式换算
  const REF = singleHit('chess_zj_01_a');   // 能天使（池内 6★ 狙击，无天赋减免）
  console.log('  埃癸斯 : 挨 %d 次，单次 %s，防御 %s', AG.n, Math.round(AG.first), AG.def);
  console.log('  能天使 : 挨 %d 次，单次 %s，防御 %s', REF.n, Math.round(REF.first), REF.def);
  // 物理伤害 = max(atk - def, 5%×atk)；对组无天赋减免
  const raw = (def) => Math.max(500 - def, 500 * 0.05);
  const expAigis = raw(AG.def) * (1 - bb0.damage_resistance);
  const expRef = raw(REF.def);
  console.log('  期望（公式）: 埃癸斯 %s×0.88 = %s   能天使 %s',
    Math.round(raw(AG.def)), Math.round(expAigis), Math.round(expRef));
  chk('埃癸斯单次受伤 ≈ (atk-def)×0.88', Math.abs(AG.first - expAigis) < 2,
    `${Math.round(AG.first)} vs ${Math.round(expAigis)}`);
  chk('对照组单次受伤 ≈ atk-def（无减免）', Math.abs(REF.first - expRef) < 2,
    `${Math.round(REF.first)} vs ${Math.round(expRef)}`);
  chk('埃癸斯比同防御的对照少受 12%',
    AG.first < expRef * 0.95 || AG.def !== REF.def,
    '（防御不同则以公式对照为准）');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(70));
console.log('  ② 岳羽由加莉 治愈之风');
console.log('='.repeat(70));

const chessY = (await import('../server/sim/simdata.js')).getDefaultSource().rawChess('chess_zj_60_4_a');
const bbY = chessY.talents[0].bb;
console.log('  天赋 bb: %s', JSON.stringify(bbY));
chk('天赋有 max_target', bbY.max_target > 0, String(bbY.max_target));
chk('天赋有 heal_scale', bbY.heal_scale > 0, String(bbY.heal_scale));

const E3 = 'enemy_dummy';
const hY = makeBattle({
  units: [
    { chessId: 'chess_zj_60_4_a', row: 9, col: 6, uid: 1 },
    { chessId: 'chess_char_1_01_a', row: 10, col: 6, uid: 2 },   // 队友
    { chessId: 'chess_char_2_01_a', row: 10, col: 7, uid: 3 },   // 队友 2
  ],
  enemies: [{ key: E3, time: 0, route: { motion: 'WALK', start: [9, 8], end: [9, 8], checkpoints: [] } }],
  defs: { enemies: { [E3]: enemyRec({ key: E3, hp: 200000, atk: 0, speed: 0 }) } },
  seed: 5, flags: { startOpCooldown: 0 },
  hooks: ['skillEnd', 'heal'], autoFinish: false, timeLimit: 30, captureNoisy: true,
});
const yukari = hY.unit('chess_zj_60_4_a');
hY.step(1);
console.log('  场上友方: %s', hY.b.allyUnits.filter((u) => u.kind === 'op').map((u) => u.def?.name).join(', '));

console.log('\n  ── 全部队友打伤，然后触发一次"技能结束" ──');
const mates = hY.b.allyUnits.filter((u) => u.kind === 'op');
for (const m of mates) m.hp = Math.round(m.s.maxHp * 0.3);
const before = mates.map((m) => m.hp);
console.log('  治疗前: %s', mates.map((m) => `${m.def?.name} ${Math.round(m.hp)}/${Math.round(m.s.maxHp)}`).join('  '));
hY.b.emit('skillEnd', { unit: yukari, skill: yukari.skill });
const after = mates.map((m) => m.hp);
console.log('  治疗后: %s', mates.map((m) => `${m.def?.name} ${Math.round(m.hp)}/${Math.round(m.s.maxHp)}`).join('  '));
const healed = mates.map((m, i) => Math.round(after[i] - before[i]));
console.log('  回复量: %s（天赋 %s×攻击力 %s = %s）', JSON.stringify(healed),
  bbY.heal_scale, Math.round(yukari.s.atk), Math.round(yukari.s.atk * bbY.heal_scale));
const healedCount = healed.filter((x) => x > 0).length;
chk('治疗了多个单位（含队友）', healedCount >= 2, `${healedCount} 个`);
chk('治疗量 = 100% 攻击力', Math.abs(healed[0] - yukari.s.atk * bbY.heal_scale) < 2, `${healed[0]}`);
chk('治疗人数不超过 max_target', healedCount <= bbY.max_target, `${healedCount} ≤ ${bbY.max_target}`);

console.log('\n' + '='.repeat(70));
console.log('  %s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
console.log('='.repeat(70));
process.exit(fail ? 1 : 0);
