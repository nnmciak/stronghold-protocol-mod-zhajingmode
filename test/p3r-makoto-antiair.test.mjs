// 结城理三个技能的**对空**验证（用户 2026-10-17：「他的三技能可以对空的 你改一下」）。
// 运行（项目根）: node test/p3r-makoto-antiair.test.mjs
//
// 面具（塔纳托斯 / 俄耳甫斯）按数据能打空中单位：两个 token 都是 `attackKind: 'melee'` + `canHitFly: true`；
// 本 fork 里面具是显示用的，token 的 canHitFly 不会自动带过来 ⇒ **每个技能都要显式声明 `targeting.canHitFly`**。
// 实测（修复前）：S1 ✓ 有、S3 ✓ 有、**S2 ✗ 没有** ⇒ `ai.js:315` 的 `if (!prof.canHitFly && e.isFlying) continue;`
// 把空中单位全挡掉，表现为「二技能打不到飞机」。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';
import { effectiveProfile } from '../server/sim/ai.js';
import { canTargetEnemy } from '../server/sim/targeting.js';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const AIR = 'enemy_p3r_air';
const GND = 'enemy_p3r_gnd';

/** 一局：结城理 + 一个敌人。`air` 决定它是否空中（`spawns.js:120` 用 `def.motion`）。 */
function run(cid, air = true) {
  const h = makeBattle({
    units: [{ chessId: cid, row: 9, col: 6 }],
    enemies: [
      { key: AIR, time: 0, route: { motion: air ? 'FLY' : 'WALK', start: [9, 7], end: [9, 7], checkpoints: [] } },
    ],
    defs: { enemies: { [AIR]: enemyRec({ key: AIR, hp: 5000000, atk: 0, def: 0, speed: 0, motion: air ? 'FLY' : 'WALK' }) } },
    seed: 7, flags: { startOpCooldown: 0 }, autoFinish: false, timeLimit: 300, captureNoisy: false,
  });
  const u = h.unit(cid);
  h.step(1);
  h.b.emit('deploy', { unit: u, initial: true });
  h.step(2);
  return { h, u };
}

/**
 * 开技 → 把敌人切成空中 → 验证能打到。
 * ★ 不能一开局就把敌人设成空中：本体（`canHitFly: false`）打不到它就没有攻击目标，
 *   结城理不攻击 ⇒ SP 不涨（本引擎要求有攻击目标），技能永远开不出来。
 *   实战也是先打地面攒技力、再面对飞机。这里正是复现那个顺序。
 */
function castAgainstAir(cid, maxSec = 40) {
  const { h, u } = run(cid, false);          // 先用地面敌人攒技力
  const e = h.enemies()[0];
  const sk = u.skill;
  if (sk.spMax) sk.sp = sk.spMax;            // 满技力（省时间）
  let on = false;
  for (let i = 0; i < maxSec * 25 && !on; i++) { h.step(1); on = sk.active; }
  if (on) e.motion = 'FLY';                  // ★ 开技后切空中
  return { h, u, e, started: on };
}

console.log('=== ① 数据层：三个技能的定义块里都要有 targeting.canHitFly ===');
{
  // 直接读 kit 源码按块检查 —— 运行时只能拿到"当前选中"那个技能的 spec，
  // 另两个（S1/S3 的 alt）要看各自的定义块，所以这里做静态检查（覆盖三个都到）。
  const src = readFileSync(join(ROOT, 'server/sim/content/kits/ops/op-makoto.js'), 'utf8');
  const starts = [...src.matchAll(/const (s[123]) = \(s\) =>/g)].map((m) => ({ name: m[1], at: m.index }));
  chk('找到 s1 / s2 / s3 三个定义块', starts.length === 3, starts.map((x) => x.name).join(', '));
  for (let i = 0; i < starts.length; i++) {
    const block = src.slice(starts[i].at, starts[i + 1]?.at ?? src.length);
    chk(`${starts[i].name} 的块里有 targeting 且 canHitFly: true`,
      /targeting:\s*\{[^}]*canHitFly:\s*true/.test(block),
      /targeting:/.test(block) ? '有 targeting 但无 canHitFly' : '★ 完全没有 targeting');
  }
}

console.log('\n=== ② 空中单位识别 ===');
{
  const { h, u } = run('chess_zj_60_5_a', 1);   // air = true
  const e = h.enemies()[0];
  chk('敌人 isFlying = true（FLY 运动）', !!e.isFlying, `motion=${e.motion}`);
  chk('激活前本体 canHitFly = false', u.profile?.canHitFly === false);
}

console.log('\n=== ③ ★ S2 / S3 开技后必须能对空（S2 是本次修的 bug）===');
for (const [label, cid] of [['S2（_a 塔纳托斯）', 'chess_zj_60_5_a'], ['S3（_b 塔纳托斯）', 'chess_zj_60_5_b']]) {
  const { h, u, e, started } = castAgainstAir(cid);
  chk(`${label} 技能开起来了`, started, `active=${u.skill?.active}`);
  chk(`${label} 敌人已切为空中`, !!e.isFlying, `motion=${e.motion}`);
  const p = effectiveProfile(u);
  chk(`${label} 运行期 profile.canHitFly = true`, p.canHitFly === true, `canHitFly=${p.canHitFly} maxTargets=${p.maxTargets}`);
  chk(`${label} canTargetEnemy(空中) = true`, canTargetEnemy(u, e, p) === true);
  const hp0 = e.hp;
  h.run(6);
  chk(`${label} 真的打到了空中单位`, e.hp < hp0, `6 秒掉血 ${Math.round(hp0 - e.hp)}`);
}

console.log('\n=== ④ 本体形态仍然打不到空中（保持原有口径）===');
{
  const { h, u } = run('chess_zj_60_5_a', true);   // 空中敌人 + 不开技
  const e = h.enemies()[0];
  chk('未开技 canHitFly = false', effectiveProfile(u).canHitFly === false);
  chk('未开技 canTargetEnemy(空中) = false', canTargetEnemy(u, e, effectiveProfile(u)) === false);
  const hp0 = e.hp;
  h.run(5);
  chk('未开技时空中单位没掉血', e.hp >= hp0, `掉血 ${Math.round(hp0 - e.hp)}`);
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
