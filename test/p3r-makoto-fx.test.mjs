// 结城理的面具形态切换 → 官方「形态切换特效」makoto_change_01（DESIGN §33）
// 运行（项目根）: node test/p3r-makoto-fx.test.mjs
//
// 用户 2026-10-17：「平a特效出来了 但是技能特效没有」。
// 根因：他的三个技能预制体（skchr_makoto_1/2/3）里 effects 全是空的 —— 切换特效挂在客户端的
//   `CommonAbilities` 节点 makoto[switch2stand_s1|s2|s3_1|s3_2] / makoto[switch2normal] 上，由 buff 模板
//   makoto_s1_trigger / makoto_s3_trigger / makoto_standin 在 ON_BUFF_START / ON_BUFF_FINISH 触发。
//   本作模拟不跑客户端 buff 系统 ⇒ 那些触发器不响 ⇒ makoto_change_01 一次都不播。
//   （平a特效走的是 modes[].attack.cast，是另一条通路，所以「平a有、技能没有」是自洽的。）
//
// 修法（server/sim/content/kits/ops/op-makoto.js 的 showMask / hideMask）：在形态切换时补发
//   render/vfx/talents.js `triggerKinds` 认得的那两个 fx kind：
//     进入面具 → 'substitute'（它把 ON_BEFORE_TRY_SET_HP_ZERO 映射过来；四个 switch2stand_* 节点都挂了
//                `makoto_tr` 的致命一击触发器，所以都落在这一组）
//     退出面具 → 'swap'（standin buff 的 ON_BUFF_FINISH；'dollEnd' 留给阵亡）
//   render/vfx/talentfx.js 的 fx() 随后把该节点的 plan 行（makoto_change_01）播在 unit 上，
//   并返回 true 让自制特效让位（render/app.js:1755）。
//
// 注意：harness 的 eventsOf() 会 drain 待处理事件再过滤 —— 跑模拟期间不要调用，否则会把事件提前抽干。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const idx = JSON.parse(readFileSync(join(ROOT, 'public/assets/local/fx/index.json'), 'utf8'));

// ─────────────────────────────────────────────── ① 客户端侧的映射（talents.js triggerKinds）
console.log('=== ① 客户端：这些 fx kind 是否真能触发 makoto_change_01 ===');
const { talentBindings, triggerKinds, bindable } = await import(
  'file:///' + join(ROOT, 'public/js/render/vfx/talents.js').replace(/\\/g, '/'));

chk('官方特效索引里有 char_4217_makoto', !!idx.units.char_4217_makoto);
const binds = talentBindings(idx, 'char_4217_makoto', {});
console.log('  解析出绑定 %d 条', binds.length);
const named = (n) => binds.find((b) => b.key === n);

for (const n of ['makoto[switch2stand_s1]', 'makoto[switch2stand_s2]',
  'makoto[switch2stand_s3_1]', 'makoto[switch2stand_s3_2]']) {
  const b = named(n);
  chk(`绑定 ${n} 存在`, !!b);
  if (!b) continue;
  const tk = triggerKinds(b);
  chk(`  ↑ 触发 kind 含 substitute`, tk.includes('substitute'), tk.join(','));
  chk(`  ↑ 可播（有特效行）`, bindable(b).ok, bindable(b).reason || '');
  const keys = [...b.plan.start, ...b.plan.loop, ...b.plan.range].map((e) => e.key);
  chk(`  ↑ 行里是 makoto_change_01`, keys.includes('makoto_change_01'), keys.join(','));
}
const back = named('makoto[switch2normal]');
chk('绑定 makoto[switch2normal] 存在（回本体）', !!back);
if (back) {
  const tk = triggerKinds(back);
  chk('  ↑ 触发 kind 含 swap（主动退出）', tk.includes('swap'), tk.join(','));
  chk('  ↑ 触发 kind 含 dollEnd（阵亡退出）', tk.includes('dollEnd'), tk.join(','));
  chk('  ↑ 可播', bindable(back).ok, bindable(back).reason || '');
}
// 切换特效预制体确实在库里（宁可这里失败，也不要对局里静默不播）
for (const k of ['makoto_change_01', 'makoto_talent_chance_01', 'makoto_skill_01_buff_01',
  'makoto_skill_02_buff_01', 'makoto_skill_03_p1_buff_01_l', 'makoto_skill_03_p2_buff_01']) {
  chk(`官方特效库有 ${k}`, !!idx.prefabs[k]);
}

// ─────────────────────────────────────────────── ② 服务器侧：形态切换发出的 fx
console.log('\n=== ② 服务器：每次形态切换是否补发了 substitute / swap ===');
const E = 'enemy_form_fx';
function mk(chessId) {
  return makeBattle({
    units: [{ chessId, row: 9, col: 6 }],
    enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [9, 8], end: [9, 8], checkpoints: [] } }],
    defs: { enemies: { [E]: enemyRec({ key: E, hp: 999999, atk: 0, speed: 0 }) } },
    seed: 7, flags: { startOpCooldown: 0 }, autoFinish: false, timeLimit: 120, captureNoisy: true,
  });
}

/** 开一局并按需跑完；返回 { u, fx }，fx 是一次性抽干的全部 fx 事件（{kind, extra}）。 */
function play(chessId, seconds) {
  const h = mk(chessId);
  const u = h.unit(chessId);
  h.step(1);
  h.b.emit('deploy', { unit: u, initial: true });
  h.step(1);
  u.skill.activate('test', { free: true });
  h.step(2);
  h.run(seconds);
  const fx = h.eventsOf('fx').map((e) => ({ kind: e[1], extra: e[4] || {} }));
  // ★ fx 的 `extra.id` 是单位的**数字** id（快照 id），不是 chessId 字符串 —— 用它过滤
  return { h, u, id: u.id, fx };
}
const pick = (fx, kind, id) => fx.filter((x) => x.kind === kind && x.extra.id === id);
// ★ 单位身上有两类 substitute/swap：职业 dollkeeper 的通用替身（substitute form 'doll'，swap form null），
//   以及本 kit 的面具切换（substitute 带面具名，swap 带 'base'）。测试只关心后者 ——
//   前者本来就由 professions.js 发。kit 退出用 'base' 而非 null 正是为了在这里能区分开。
const MASK_FORMS = new Set(['doll1', 'doll2', 'doll3p1', 'doll3p2', 'base']);
const maskFxs = (fx, kind, id) => pick(fx, kind, id).filter((x) => MASK_FORMS.has(x.extra.form));

// ── S3：进面具（doll3p1）→ 20 s 后回本体
console.log('  ── S3（_b，skillIndex 2）──');
const r3 = play('chess_zj_60_5_b', 24);
const id3 = r3.id;   // ★ fx 的 extra.id 是单位的数字 id，不是 chessId
const ph3 = pick(r3.fx, 'phase', id3);
const sb3 = maskFxs(r3.fx, 'substitute', id3);
const sw3 = maskFxs(r3.fx, 'swap', id3);
const in3 = ph3.filter((x) => typeof x.extra.form === 'string' && x.extra.form);
const out3 = ph3.filter((x) => x.extra.form === null || x.extra.form === undefined);
console.log('     形态序列: %s', JSON.stringify(ph3.map((x) => x.extra.form)));
console.log('     进入 %d / 退出 %d，面具 substitute %d，面具 swap %d', in3.length, out3.length, sb3.length, sw3.length);
console.log('     substitute 序列（含职业的 doll）: %s', JSON.stringify(pick(r3.fx, 'substitute', id3).map((x) => x.extra.form)));
chk('发生过进入面具', in3.length > 0, String(in3.length));
chk('★ 每次进入面具都配了一个 substitute', sb3.length === in3.length, `${sb3.length} / ${in3.length}`);
chk('★ substitute.form 与 phase.form 一一对应',
  in3.every((x, i) => sb3[i]?.extra.form === x.extra.form),
  JSON.stringify({ phase: in3.map((x) => x.extra.form), sub: sb3.map((x) => x.extra.form) }));
chk('substitute 带 dur（与 phase 同形）', sb3.every((x) => Number.isFinite(Number(x.extra.dur))),
  JSON.stringify(sb3.map((x) => x.extra.dur)));
chk('doll3p1 的 dur = 0（2026-10-16 的 P1 修复不能被破坏）',
  sb3.filter((x) => x.extra.form === 'doll3p1').every((x) => Number(x.extra.dur) === 0),
  JSON.stringify(sb3.filter((x) => x.extra.form === 'doll3p1').map((x) => x.extra.dur)));
chk('发生过退出面具', out3.length > 0, String(out3.length));
chk('★ 每次退出面具都配了一个 swap', sw3.length === out3.length, `${sw3.length} / ${out3.length}`);
chk('回本体后 unit.form 为 null', r3.u.form == null, String(r3.u.form));

// ── S2：进面具（doll2）→ relay 到二阶段
console.log('\n  ── S2（_a，skillIndex 1，带 relayMask）──');
const r2 = play('chess_zj_60_5_a', 24);
const id2 = r2.id;
const ph2 = pick(r2.fx, 'phase', id2);
const sb2 = maskFxs(r2.fx, 'substitute', id2);
const in2 = ph2.filter((x) => typeof x.extra.form === 'string' && x.extra.form);
console.log('     形态序列: %s', JSON.stringify(ph2.map((x) => x.extra.form)));
console.log('     substitute 序列（含职业的 doll）: %s', JSON.stringify(pick(r2.fx, 'substitute', id2).map((x) => x.extra.form)));
chk('S2 进入面具有 substitute', sb2.length === in2.length && sb2.length > 0, `${sb2.length} / ${in2.length}`);
chk('★ S2 的 substitute.form 与 phase.form 一一对应',
  in2.every((x, i) => sb2[i]?.extra.form === x.extra.form),
  JSON.stringify({ phase: in2.map((x) => x.extra.form), sub: sb2.map((x) => x.extra.form) }));

// ── 未开技：一次都不该发（避免开场闪特效）
console.log('\n  ── 未开技时不该发 ──');
const h0 = mk('chess_zj_60_5_a');
const u0 = h0.unit('chess_zj_60_5_a');
h0.step(1);
h0.b.emit('deploy', { unit: u0, initial: true });
h0.step(40);
const fx0 = h0.eventsOf('fx').map((e) => ({ kind: e[1], extra: e[4] || {} }));
chk('未开技：没有 substitute', pick(fx0, 'substitute', u0.id).length === 0,
  String(pick(fx0, 'substitute', u0.id).length));
chk('未开技：没有 swap', pick(fx0, 'swap', u0.id).length === 0,
  String(pick(fx0, 'swap', u0.id).length));

// ── 别的干员不受影响（substitute 是通用 kind，不能顺手给别人多加特效）
console.log('\n  ── 回归：别的干员不该被波及 ──');
const hx = mk('chess_zj_01_a');
const ux = hx.unit('chess_zj_01_a');
hx.step(1);
hx.b.emit('deploy', { unit: ux, initial: true });
hx.step(2);
ux.skill?.activate?.('test', { free: true });
hx.run(6);
const fxx = hx.eventsOf('fx').map((e) => ({ kind: e[1], extra: e[4] || {} }));
console.log('     能天使(炸惊) fx: %s', JSON.stringify([...new Set(fxx.map((x) => x.kind))]));
chk('非结城理干员没有多出 substitute（除了职业自己的）',
  pick(fxx, 'substitute', ux.id).length === 0,
  String(pick(fxx, 'substitute', ux.id).length));

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
