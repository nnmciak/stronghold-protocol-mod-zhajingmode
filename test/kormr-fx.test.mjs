// 虎狼丸天赋「黑色猎犬」的**官方特效**接线回归。
// 运行（项目根）: node test/kormr-fx.test.mjs
//
// 背景（用户 2026-10-17：「他的特效呢」）：天赋的官方特效（`kormr_talent_hit_01…06`、
// `kormr_talent_start_01_l`）在官方客户端是由 buff 模板 `kormr_t[attack]` 的 `ON_BUFF_START`
// 触发 `CreateEffect` 播放的（index.json `talents.1.uses` 的 role 为 'hit' / 'loop'）。
// 本作的模拟不跑客户端 buff 系统 ⇒ 那些触发器永不响，于是天赋只有通用 `slash`。
//
// 接线方式（server/sim/content/kits/ops/op-kormr.js + public/js/render/vfx/talentfx.js）：
//   kit 每落一击发一次 `slash` fx，带 `n`（第几击，0 起）、`target`（目标 id）、`skill:'kormr:blackdog'`；
//   客户端 `talentfx.fx()` 认出这个签名后播：
//     · n=0 时额外播 `plan.attacks[].cast`（起手循环 kormr_talent_start_01_l）
//     · 每一击在目标身上播 `plan.each.hit[0][n]`（kormr_talent_hit_05 → 01；第 6 击复用最后一个）
//
// 这个测试钉住两侧的契约，以及 prefab 素材是否真的在磁盘上。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const idx = JSON.parse(readFileSync(join(ROOT, 'public/assets/local/fx/index.json'), 'utf8'));
const KEY = 'char_4220_kormr';

// ── ① 官方天赋节点确实声明了 MultiMeleeAttack（时序参数的来源）
console.log('=== ① 官方 ability（时序来源）===');
{
  const t = idx.units[KEY]?.talents?.['1'];
  const ab = (t?.abilities || [])[0] || {};
  console.log('     %s', JSON.stringify(ab));
  chk('天赋是 MultiMeleeAttack', ab.class === 'MultiMeleeAttack', String(ab.class));
  chk('additionalTimes = 5（1 + 5 = 6 击）', ab.additionalTimes === 5, String(ab.additionalTimes));
  chk('triggerDelta = 0.35', Math.abs(Number(ab.triggerDelta) - 0.35) < 1e-9, String(ab.triggerDelta));
  chk('damageType = 2（法术）', ab.damageType === 2, String(ab.damageType));
}

// ── ② kit 发的 fx：每轮 6 条，n = 0..5，且都带 target
console.log('\n=== ② kit 的 fx 载荷 ===');
{
  const E = 'kfxT';
  const h = makeBattle({
    units: [{ chessId: 'chess_zj_60_2_a', row: 9, col: 6 }],
    enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [9, 8], end: [9, 8], checkpoints: [] } }],
    defs: { enemies: { [E]: enemyRec({ key: E, hp: 1e9, atk: 0, def: 0, speed: 0 }) } },
    seed: 7, flags: { startOpCooldown: 0 }, autoFinish: false, timeLimit: 600, captureNoisy: false,
  });
  const u = h.unit('chess_zj_60_2_a');
  h.step(1);
  h.run(2);                                  // 敌人刷出
  h.eventsOf('fx');                          // 先把首次部署那轮的 fx 抽干
  h.events.length = 0;                       // 清空，只统计这一轮再部署
  u.deploySeq += 1;
  h.b.emit('deploy', { unit: u, initial: false });
  h.run(3);
  const ev = h.eventsOf('fx').filter((e) => e[4] && e[4].skill === 'kormr:blackdog');
  const ns = ev.map((e) => e[4].n);
  console.log('     收到 %d 条，n = %s', ev.length, JSON.stringify(ns));
  chk('一轮部署发 6 条', ev.length === 6, `${ev.length} 条`);
  chk('n 恰好是 0..5', JSON.stringify(ns) === JSON.stringify([0, 1, 2, 3, 4, 5]), JSON.stringify(ns));
  chk('每条都带 target', ev.every((e) => Number.isFinite(Number(e[4].target))), JSON.stringify(ev.map((e) => e[4].target)));
  const tgt = h.enemies()[0]?.id;
  chk('target 就是被斩的敌人', ev.every((e) => e[4].target === tgt), `期望 ${tgt}`);
}

// ── ③ 官方特效行能被解析出来，且 prefab 都在磁盘上
console.log('\n=== ③ 客户端要播的官方特效 ===');
{
  const { emptyPlan, planUses } = await import('../public/js/render/vfx/skills.js');
  const t = idx.units[KEY].talents['1'];
  const plan = planUses(idx, emptyPlan(KEY, 'talent1'), t.uses || [], { mode: null, abilities: t.abilities });
  const cast = (plan.attacks[0]?.cast || []).map((e) => e.key);
  const hits = (plan.each?.hit?.[0] || []).map((e) => e.key);
  console.log('     起手循环: %s', JSON.stringify(cast));
  console.log('     逐击特效: %s', JSON.stringify(hits));
  chk('起手循环 = kormr_talent_start_01_l', cast.includes('kormr_talent_start_01_l'), JSON.stringify(cast));
  chk('逐击特效 5 条（kormr_talent_hit_05…01）', hits.length === 5 && hits.every((k) => /^kormr_talent_hit_0[1-5]$/.test(k)), JSON.stringify(hits));

  const need = [...cast, ...hits];
  const missing = need.filter((k) => !existsSync(join(ROOT, 'public/assets/local/fx/prefabs', k + '.json')));
  chk('★ 这些 prefab 素材都在磁盘上', missing.length === 0, missing.join(', ') || `${need.length} 个都在`);

  // 客户端分支的映射（与 talentfx.js 一致）：n → hits[min(n, len-1)]
  const map = [];
  for (let n = 0; n < 6; n++) map.push(hits[Math.min(n, hits.length - 1)]);
  console.log('     映射 n=0..5 → %s', JSON.stringify(map));
  chk('6 击都能映射到一个真实 prefab', map.every((k) => !!k && existsSync(join(ROOT, 'public/assets/local/fx/prefabs', k + '.json'))), JSON.stringify(map));
}

// ── ④ 客户端分支确实存在（防止被后人删掉）
console.log('\n=== ④ talentfx 里的分支存在 ===');
{
  const src = readFileSync(join(ROOT, 'public/js/render/vfx/talentfx.js'), 'utf8');
  chk("认得 extra.skill === 'kormr:blackdog'", src.includes("'kormr:blackdog'"));
  chk('播 plan.attacks[].cast', /b\.plan\.attacks/.test(src));
  chk('播 plan.each.hit[0]', /plan\.each\?\.hit\?\.\[0\]/.test(src));
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
