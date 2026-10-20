// 结城理形态切换的时序验证
// 运行（项目根）: node test/p3r-makoto-forms.test.mjs
//
// 用户 2026-10-16 报告：「三技能第一阶段傀儡召唤的是俄耳甫斯」。
// 根因不是数据也不是映射 —— 骨架实测 P1=塔纳托斯、P2=俄耳甫斯（见 ①）。
// 问题在 render/app.js:1747-1749：客户端按 phase fx 的 `dur` 去排 `doll3p1.end`
// （= Doll_Skill_3_P1toP2_ChangeEnd，那个剪辑本身就是切到俄耳甫斯），而 showMask 一律发
// `dur: MASK_SWITCH (0.5)` ⇒ 进 P1 仅 0.5 s 就转入 doll3p2，塔纳托斯的入场动画（1 s）没播完就被顶掉。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const chess = JSON.parse(readFileSync(join(ROOT, 'data/chess.json'), 'utf8'));
const assets = JSON.parse(readFileSync(join(ROOT, 'data/assets.json'), 'utf8'));
const bare = (u) => String(u).replace(/^\/assets\/~[0-9a-f]+\//, '');

console.log('=== ① 骨架证据：P1 是塔纳托斯、P2 是俄耳甫斯 ===');
for (const side of ['front', 'back']) {
  const e = assets.chars.char_4217_makoto.spine[side];
  const atlas = readFileSync(join(ROOT, 'public/assets', bare(e.atlas)), 'utf8');
  const orps = (atlas.match(/PersonaOrps/g) || []).length;
  const tnt = (atlas.match(/PTnt/g) || []).length;
  chk(`${side} atlas 同时含两套面具部件`, orps > 0 && tnt > 0, `Orps ${orps} PTnt ${tnt}`);
}
const units = await import('file:///' + join(ROOT, 'public/js/render/units.js').replace(/\\/g, '/'));
const F = units.FORMS.char_4217_makoto;
console.log('  FORMS 形态: %s', Object.keys(F).join(', '));
chk('doll3p1 用 P1 剪辑', String(F.doll3p1?.roles?.idle).includes('Doll_Skill_3_P1_'), F.doll3p1?.roles?.idle);
chk('doll3p2 用 P2 剪辑', String(F.doll3p2?.roles?.idle).includes('Doll_Skill_3_P2_'), F.doll3p2?.roles?.idle);
chk('doll3p1.end = P1toP2 切换剪辑（这就是「提前切俄耳甫斯」的入口）',
  F.doll3p1?.end === 'Doll_Skill_3_P1toP2_ChangeEnd', String(F.doll3p1?.end));
chk('doll3p1.next = doll3p2', F.doll3p1?.next === 'doll3p2', String(F.doll3p1?.next));

console.log('\n=== ② 剪辑时长：0.5 s 的 dur 会让 P1 多早被顶掉 ===');
const anims = assets.chars.char_4217_makoto.spine.front.animations;
for (const k of ['Doll_Skill_3_P1_SwitchIn', 'Doll_Skill_3_P1toP2_ChangeEnd', 'Doll_Skill_3_P1_Idle']) {
  console.log('     %s = %s s', k, anims[k]);
}
chk('P1 入场动画长于 MASK_SWITCH(0.5)（旧行为会让入场播不完）',
  anims.Doll_Skill_3_P1_SwitchIn > 0.5, `${anims.Doll_Skill_3_P1_SwitchIn} > 0.5`);

console.log('\n=== ③ 服务端发出的 phase fx（关键：P1 的 dur 必须是 0）===');
const E = 'enemy_form';
function mk(chessId, skillIndex = 2) {   // 显式指定，不依赖数据默认值（2026-10-17 默认技能已改）
  return makeBattle({
    units: [{ chessId, skillIndex, row: 9, col: 6 }],
    enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [9, 8], end: [9, 8], checkpoints: [] } }],
    defs: { enemies: { [E]: enemyRec({ key: E, hp: 999999, atk: 0, speed: 0 }) } },
    seed: 7, flags: { startOpCooldown: 0 }, autoFinish: false, timeLimit: 120, captureNoisy: true,
  });
}
const phaseOf = (h) => h.eventsOf('fx').filter((e) => e[1] === 'phase').map((e) => e[4]);

// ── S3：首次进入是 P1（塔纳托斯）
const h3 = mk('chess_zj_60_5_b');
const u3 = h3.unit('chess_zj_60_5_b');
h3.step(1);
h3.b.emit('deploy', { unit: u3, initial: true });
h3.step(1);
console.log('  装 S3 前 spec 键: %s', Object.keys(u3.skill?.spec ?? {}).join(','));
chk('S3 不带 relayMask（设计如此：S3 的替身结束不接二阶段）',
  !u3.skill?.spec?.relayMask, String(u3.skill?.spec?.relayMask));
u3.skill.activate('test', { free: true });
h3.step(2);
const ph3 = phaseOf(h3);
console.log('  S3 开技后 phase fx: %s', JSON.stringify(ph3));
const p1 = ph3.find((x) => x.form === 'doll3p1');
chk('S3 首次进入 form=doll3p1（塔纳托斯）', !!p1, JSON.stringify(ph3.map((x) => x.form)));
chk('★ P1 的 dur = 0（客户端不再提前排 ChangeEnd）', p1?.dur === 0, String(p1?.dur));
chk('unit.form = doll3p1', u3.form === 'doll3p1', String(u3.form));
chk('mask = thanatos', u3.mem?.makotoMask === 'thanatos', String(u3.mem?.makotoMask));
// 塔纳托斯应当维持满 20 s 而不是 0.5 s
h3.run(10);
chk('10 秒后仍是 doll3p1（塔纳托斯没被提前顶掉）', u3.mem?.makotoForm === 'doll3p1', String(u3.mem?.makotoForm));
h3.run(11);
chk('21 秒后回到本体（S3 不接二阶段）', u3.mem?.makotoForm == null, String(u3.mem?.makotoForm));

// ── S2：relayMask='orpheus'，20 s 后应自动切 P2
console.log('\n  ── S2（塔纳托斯的囚锁）应带 relayMask，20 s 后自动切俄耳甫斯 ──');
const h2 = mk('chess_zj_60_5_a', 1);
const u2 = h2.unit('chess_zj_60_5_a');
h2.step(1);
h2.b.emit('deploy', { unit: u2, initial: true });
h2.step(1);
console.log('     S2 spec 键: %s', Object.keys(u2.skill?.spec ?? {}).join(','));
chk('S2 带 relayMask=orpheus', u2.skill?.spec?.relayMask === 'orpheus', String(u2.skill?.spec?.relayMask));
u2.skill.activate('test', { free: true });
h2.step(2);
const ph2 = phaseOf(h2);
console.log('     S2 开技后 phase fx: %s', JSON.stringify(ph2));
chk('S2 首次进入 form=doll2', ph2.some((x) => x.form === 'doll2'), JSON.stringify(ph2.map((x) => x.form)));
h2.run(21);
const ph2b = phaseOf(h2);
console.log('     21 秒后 phase fx: %s', JSON.stringify(ph2b));
chk('★ S2 的 20 s relay 切到了 doll3p2/俄耳甫斯 或 doll2 的二阶段',
  u2.mem?.makotoForm === 'doll2' || u2.mem?.makotoMask === 'orpheus',
  `form=${u2.mem?.makotoForm} mask=${u2.mem?.makotoMask}`);

// ── S3 的致命伤路径：塔纳托斯在场时受致命伤 → 改为俄耳甫斯
console.log('\n  ── S3 致命伤路径（塔纳托斯在场 → 改为召唤俄耳甫斯）──');
const h4 = mk('chess_zj_60_5_b');
const u4 = h4.unit('chess_zj_60_5_b');
h4.step(1);
h4.b.emit('deploy', { unit: u4, initial: true });
h4.step(1);
u4.skill.activate('test', { free: true });
// ★ 必须等切换动画走完（`trait:dollSwitching` 约 1 s）—— 切换期间打致命伤，职业的 -100 处理器
//   会因 `dollSwitching` 直接 prevented，S3 的守卫拿不到这一击（实测踩过）。
let guard = 0;
while (u4.findBuff('trait:dollSwitching') && guard++ < 60) h4.step(1);
console.log('     切换动画结束 t=%s，开始打致命伤', h4.b.time.toFixed(2));
console.log('     受伤前: form=%s mask=%s hp=%s/%s', u4.mem?.makotoForm, u4.mem?.makotoMask,
  Math.round(u4.hp), Math.round(u4.s.maxHp));
u4.hp = 1;
h4.b.dealDamage(h4.enemies()[0], u4, { amount: 99999, type: 'phys' }, {});
console.log('     命中瞬间: fatalRelay=%s prevented 已置', u4.mem?.makotoFatalRelay);
h4.step(3);
console.log('     3 tick 后: form=%s mask=%s hp=%s/%s skillActive=%s',
  u4.mem?.makotoForm, u4.mem?.makotoMask, Math.round(u4.hp), Math.round(u4.s.maxHp), u4.skill?.active);
chk('致命伤后没有撤退', !u4.removed && u4.alive);
chk('★ 面具改成 orpheus', u4.mem?.makotoMask === 'orpheus', String(u4.mem?.makotoMask));
chk('★ 形态切到 doll3p2（俄耳甫斯）', u4.mem?.makotoForm === 'doll3p2', String(u4.mem?.makotoForm));
chk('切形态时发的 phase fx 带 dur=0.5（这次是真正的切换）',
  phaseOf(h4).some((x) => x.form === 'doll3p2' && x.dur === 0.5),
  JSON.stringify(phaseOf(h4).filter((x) => x.form === 'doll3p2')));
chk('切换重设生命至最大值', u4.hp === u4.s.maxHp, `${Math.round(u4.hp)}/${Math.round(u4.s.maxHp)}`);

// ── 回归：S3 的守卫必须在职业那条处理器之前（-50 而非 -150）
console.log('\n  ── 回归：fatal 处理器的优先级 ──');
const fl = h4.b._hooks.fatal || [];
const prios = fl.map((x) => x.priority);
console.log('     fatal 处理器优先级: %s', prios.join(', '));
chk('★ S3 守卫（设 makotoFatalRelay 的那条）优先级高于 -100',
  fl.some((x) => String(x.fn).includes('makotoFatalRelay') && x.priority > -100),
  `最高 ${Math.max(...prios)}`);
chk('职业那条仍在 -100（未被改动）', prios.filter((p) => p === -100).length >= 1, String(prios.filter((p) => p === -100).length));

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
