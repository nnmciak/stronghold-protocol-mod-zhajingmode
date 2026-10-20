// S2「塔纳托斯的囚锁」机制回归 —— 逐条对标官方 Lv4/Lv7 描述。
// 运行（项目根）: node test/p3r-makoto-s2.test.mjs
//
// 官方 Lv4 描述：被动：<替身>状态召唤塔纳托斯，攻击对至多 3 名敌人造成攻击力 160% 的法术伤害，
//              并有 35% 概率恐惧敌人 1.5 秒，**范围内恐惧中的敌人若生命值低于结城理攻击力的 230% 则立刻倒下**
//              主动：立即切换为<替身>状态作战
//
// 2026-10-17 修：斩杀的**判定范围**。旧实现把斩杀只挂在 `onEachHit`（每个被普攻命中的目标各判一次），
// 于是「站在范围内、被恐惧、血量远低于阈值，但不在 max_target=3 之内」的敌人**永远杀不掉**；
// 官方描述的主语是**范围内所有**恐惧中的敌人。现在每次出手额外扫一遍面具网。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';
import { effectiveProfile } from '../server/sim/ai.js';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const chess = JSON.parse(readFileSync(join(ROOT, 'data/chess.json'), 'utf8'));
const ATK_BASE = chess.chess_zj_60_5_a.stats.atk;      // 825
const ATK_MASK = Math.round(ATK_BASE * 1.8);           // 替身 +80% ⇒ 1485
const THR = Math.round(ATK_MASK * 2.3);                // 斩杀阈值 230%

const KEYS = ['e_a', 'e_b', 'e_c', 'e_d'];
const POS = [[9, 7], [9, 8], [10, 7], [8, 6]];

/** 一局：结城理(9,6) + 若干敌人（都在 1-1 网内）。 */
function battle(hps) {
  const enemies = hps.map((hp, i) => ({
    key: KEYS[i], time: 0, route: { motion: 'WALK', start: POS[i], end: POS[i], checkpoints: [] },
  }));
  const defs = { enemies: {} };
  hps.forEach((hp, i) => { defs.enemies[KEYS[i]] = enemyRec({ key: KEYS[i], hp, atk: 0, def: 0, speed: 0 }); });
  const h = makeBattle({
    units: [{ chessId: 'chess_zj_60_5_a', skillIndex: 1, row: 9, col: 6  }],
    enemies, defs, seed: 7, flags: { startOpCooldown: 0 }, autoFinish: false, timeLimit: 400, captureNoisy: false,
  });
  const u = h.unit('chess_zj_60_5_a');
  h.step(1);
  h.b.emit('deploy', { unit: u, initial: true });
  h.step(2);
  return { h, u, sk: u.skill };
}
const open = (h, u, sk) => { if (sk.spMax) sk.sp = sk.spMax; for (let i = 0; i < 40 * 25 && !sk.active; i++) h.step(1); return sk.active; };

console.log('=== ① 主动：立即切换为<替身> ===');
{
  const { h, u, sk } = battle([1e7]);
  chk('开技前不是替身', !u.trait?.doll);
  chk('技能开启', open(h, u, sk));
  chk('切为替身 + 塔纳托斯', !!u.trait?.doll && u.mem?.makotoMask === 'thanatos', `mask=${u.mem?.makotoMask}`);
}

console.log('\n=== ② 被动：倍率 160%（Lv4）与目标上限 3 ===');
{
  const { h, u, sk } = battle([1e7, 1e7, 1e7]);
  open(h, u, sk);
  const hits = [];
  h.b.on('damaged', (d) => { if ((d?.dmg?.tags || []).includes('makoto')) hits.push({ t: h.b.time, a: d.amount }); });
  h.run(6);
  const expect = u.s.atk * 1.6;
  chk('单体伤害 = 攻击力 × 160%', hits.length > 0 && Math.abs(hits[0].a - expect) <= 2,
    `实测 ${Math.round(hits[0]?.a ?? 0)}  期望 ${Math.round(expect)}`);
  const perTime = new Map();
  for (const x of hits) { const k = x.t.toFixed(2); perTime.set(k, (perTime.get(k) || 0) + 1); }
  chk('同一次出手命中数 ≤ 3', Math.max(0, ...perTime.values()) <= 3, `最多 ${Math.max(0, ...perTime.values())} 个`);
}

console.log('\n=== ③ 被动：恐惧会触发（35%）===');
{
  const { h, u, sk } = battle([1e7, 1e7, 1e7]);
  open(h, u, sk);
  let applied = 0, hits = 0;
  const orig = h.b.applyStatus.bind(h.b);
  h.b.applyStatus = (t, key, o) => { if (key === 'fear') applied++; return orig(t, key, o); };
  h.b.on('damaged', (d) => { if ((d?.dmg?.tags || []).includes('makoto')) hits++; });
  h.run(15);
  chk('多次命中后确实施加了恐惧', applied > 0, `命中 ${hits} 次 → 恐惧 ${applied} 次（理论约 ${Math.round(hits * 0.35)}）`);
}

console.log('\n=== ④ ★ 被动：斩杀扫"范围内所有恐惧中的敌人"（本轮修的 bug）===');
{
  // 4 个敌人都站在网内、都预先恐惧；maxTargets=3 ⇒ 第 4 个不会被普攻命中。
  // 第 4 个血量远低于阈值 —— 按描述应当被斩杀。
  const hps = [1e7, 1e7, 1e7, Math.round(THR * 0.25)];
  const { h, u, sk } = battle(hps);
  const all = h.enemies();
  for (const e of all) h.b.applyStatus(e, 'fear', { duration: 120, source: u });
  h.step(1);
  chk('开技前 4 个敌人都处于恐惧', all.every((e) => !!e.findBuff('fear')));
  open(h, u, sk);

  const hit = new Set(), exec = new Set();
  h.b.on('damaged', (d) => {
    const id = d.target?.id ?? d.tgt?.id;
    const tags = d?.dmg?.tags || [];
    if (tags.includes('makoto')) hit.add(id);
    if (tags.includes('makotoExecute')) exec.add(id);
  });
  h.run(25);

  const thin = all[3];
  chk('薄血敌人确实**没被普攻命中**（落在目标上限之外）', !hit.has(thin.id), `命中集合 ${[...hit].join(',')}`);
  chk('★ 薄血敌人仍被斩杀（范围内恐惧 + 低于阈值）', !thin.alive || exec.has(thin.id),
    `alive=${thin.alive} exec=${exec.has(thin.id)}`);
}

console.log('\n=== ⑤ 阈值口径：高于阈值的不该被斩杀 ===');
{
  const hps = [1e7, 1e7, 1e7, Math.round(THR * 8)];   // 远超阈值
  const { h, u, sk } = battle(hps);
  const all = h.enemies();
  for (const e of all) h.b.applyStatus(e, 'fear', { duration: 120, source: u });
  h.step(1);
  open(h, u, sk);
  const exec = new Set();
  h.b.on('damaged', (d) => { if ((d?.dmg?.tags || []).includes('makotoExecute')) exec.add(d.target?.id ?? d.tgt?.id); });
  h.run(20);
  const thick = all[3];
  chk('高血量恐惧敌人没有被斩杀', !exec.has(thick.id) && thick.alive, `exec=${exec.has(thick.id)} alive=${thick.alive}`);
}

console.log('\n=== ⑥ 对空：S2 运行期 canHitFly = true（此前漏声明）===');
{
  const { h, u, sk } = battle([1e7]);
  open(h, u, sk);
  chk('运行期 profile.canHitFly = true', effectiveProfile(u).canHitFly === true, String(effectiveProfile(u).canHitFly));
  chk('本体形态 canHitFly = false（口径不变）', (() => {
    const b2 = battle([1e7]);
    return effectiveProfile(b2.u).canHitFly === false;
  })());
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
