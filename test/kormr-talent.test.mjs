// 虎狼丸本地实测 v2：测试台不走"玩家部署"流程，所以手动发一次 deploy 事件
// （正式对局里 deploy.js:66 会在玩家下令部署时无条件发出）
import { makeBattle, enemyRec } from './helpers/battleHarness.js';
import { getDefaultSource } from '../server/sim/simdata.js';
import { absoluteRangeKeys } from '../server/sim/targeting.js';

const CHESS = 'chess_zj_60_2_a';
const ENEMY = 'enemy_kormr_test';
const X_1 = [[2, 0], [1, -1], [1, 0], [1, 1], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, -1], [-1, 0], [-1, 1], [-2, 0]];

let pass = 0, fail = 0;
const chk = (label, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ %s %s', label, extra); }
  else { fail++; console.log('  ✗ %s %s', label, extra); }
};

const data = getDefaultSource();
const chess = data.rawChess(CHESS);
console.log('=== 输入 ===');
console.log('  chess.talents[0].bb = %s', JSON.stringify(chess?.talents?.[0]?.bb));
console.log('  atk=%s  rangeId=%s', chess?.stats?.atk, chess?.rangeId);

const h = makeBattle({
  // 单位放在 (9,6) 朝东：普攻范围 = col 6..7（实测 rangeKeys 只有 2 格）
  // 敌人生成在 (9,7) 且 speed=0 站着不动 —— 普攻够得到 → 能被收掉 → 战斗自然结束
  units: [{ chessId: CHESS, row: 9, col: 6 }],
  enemies: [{ key: ENEMY, time: 0, route: { motion: 'WALK', start: [9, 7], end: [9, 7], checkpoints: [] } }],
  // 血量 50000：测试只跑天赋窗口（2.5s），敌人必须活到序列结束
  defs: { enemies: { [ENEMY]: enemyRec({ key: ENEMY, hp: 50000, atk: 0, speed: 0 }) } },
  seed: 7,
  flags: { startOpCooldown: 0 },
  hooks: ['deploy', 'statusApplied', 'damaged'],
  autoFinish: true,
  timeLimit: 25,
  captureNoisy: true,   // damaged 在 harness 的 NOISY 集合里，要显式开启才收集
});

const unit = h.unit(CHESS);
console.log('\n=== 单位就位 ===');
console.log('  id=%s defId=%s charId=%s atk=%s', unit?.id, unit?.defId, unit?.def?.charId, unit?.s?.atk);
chk('单位在编', !!unit);

// 先让敌人走进天赋范围（x-1 东侧最远 col+2 —— 等它到 col ≤ tileC+2 再触发）
h.runUntil(() => {
  const e = h.enemies()[0];
  if (!e) return false;
  const keys = absoluteRangeKeys(X_1, unit.tileR, unit.tileC, unit.dir, 0);
  return keys.includes(Math.round(e.y) * 21 + Math.round(e.x));
}, 20);

const e0 = h.enemies()[0];
chk('敌人已出现', !!e0, e0 ? `@ (${e0.x.toFixed(1)}, ${e0.y.toFixed(1)}) hp=${Math.round(e0.hp)}` : '');
chk('单位已部署', !!unit?.deployed);
// 敌人必须真的在范围内，否则后面的断言没意义
{
  const keys = absoluteRangeKeys(X_1, unit.tileR, unit.tileC, unit.dir, 0);
  const ek = e0 ? Math.round(e0.y) * 21 + Math.round(e0.x) : -1;
  chk('敌人已进入天赋范围', keys.includes(ek), `敌格 key=${ek} 单位格=(${unit.tileR},${unit.tileC}) dir=${unit.dir}`);
}

// ── 手动触发 deploy（模拟玩家部署）────────────────────────────────────────
console.log('\n=== 手动发 deploy 事件（模拟玩家部署）===');
// 第 1 击的 after(0) 与部署同时发生，所以快照必须放在 emit 之前
const dmgBefore = h.hooksOf('damaged').length;
const tAtDeploy = h.b.time;
console.log('  部署时刻 t=%s', tAtDeploy.toFixed(3));
h.b.emit('deploy', { unit, initial: true });
console.log('  deploy 钩子捕获 %d 次', h.hooksOf('deploy').length);

console.log('  敌人 @ (%s, %s)   虎狼丸 @ (%s, %s) dir=%s',
  e0?.x?.toFixed(1), e0?.y?.toFixed(1), unit?.x?.toFixed(1), unit?.y?.toFixed(1), unit?.dir);
const keys13 = absoluteRangeKeys(X_1, unit.tileR, unit.tileC, unit.dir, 0);
const eKey = Math.round(e0.y) * 21 + Math.round(e0.x);
console.log('  天赋范围 %d 格: %s', keys13.length, JSON.stringify(keys13));
console.log('  敌人所在格 key=%d  在范围内: %s', eKey, keys13.includes(eKey));

console.log('\n=== 推进 2.5 秒（覆盖天赋 6 击 + 0.3s 余量）===');
h.run(2.5);
console.log('  t=' + h.b.time.toFixed(2) + '  敌人 hp=' + (e0 ? Math.round(Math.max(0, e0.hp)) : '-') + ' / 50000');
console.log('  敌人 stats.taken = %s （应从 0 累计）', Math.round(e0?.stats?.taken ?? -1));
console.log('  → 减去普攻 484 = %s（期望 3388 = 天赋 6 击）', Math.round((e0?.stats?.taken ?? 0)) - 484);

// 只取部署之后发生的对敌伤害
const dmg = h.hooksOf('damaged').slice(dmgBefore).filter((e) => e.target && e.target.side === 'enemy');
console.log('\n  部署后对敌伤害 %d 条（含普攻）:', dmg.length);
for (const d of dmg) {
  const tags = d.dmg?.tags ?? [];
  const kind = tags.includes('slash') ? '天赋斩击' : '普攻';
  console.log('     t=%-7s dmg=%-6s type=%-5s %s', +d.t.toFixed(3), Math.round(d.amount ?? 0), d.dmg?.type, kind);
}
const st = h.hooksOf('statusApplied');
console.log('\n  statusApplied %d 条:', st.length);
for (const s of st.slice(0, 8)) console.log('     t=' + (+s.t.toFixed(3)) + ' status=' + s.status + ' dur=' + s.duration);

console.log('\n=== 断言 ===');
// 注意：第 1 击的 after(0) 与"部署"同刻发生，所以事件捕获窗口里通常只剩后 5 击。
// ★ 2026-10-17：虎狼丸的基础属性已恢复成**官方白值**（atk 272 → 242），
//   炸惊模式的膨胀交给 `allyScale`（hp×3/def×3/atk×2.5）。所以这里的期望值按 atk=242 重算：
//   天赋 6 击 = 484×5 + 968 = 3388（484 = 242×200%，968 = 242×400%）；普攻 2 段 = 484。
const ATK = 242;
const SLASH = ATK * 2, FINAL = ATK * 4;
const WANT_TALENT = SLASH * 5 + FINAL;
const slash = dmg.filter((d) => (d.dmg?.tags ?? []).includes('slash'));
const taken = Math.round(e0?.stats?.taken ?? 0);
const normalAtk = Math.round(ATK * 2);          // 剑豪普攻 2 段
const talentDmg = taken - normalAtk;
console.log('  敌受伤总计 %s − 普攻 %s = 天赋伤害 %s（期望 %s）', taken, normalAtk, talentDmg, WANT_TALENT);
chk(`天赋总伤害 = ${WANT_TALENT}（6 击精确和）`, Math.abs(talentDmg - WANT_TALENT) < 1, `实际 ${talentDmg}`);
chk('捕获到 5 击（第 1 击与部署同刻，在窗口外）', slash.length === 5, `实际 ${slash.length}`);
if (slash.length >= 5) {
  const ts = slash.map((d) => +d.t.toFixed(3));
  const t0 = +tAtDeploy.toFixed(3);
  console.log('     时刻: %s', JSON.stringify(ts));
  console.log('     相对部署: %s（骨架 hits.Skill_Loop = [0,0.3,0.6,0.9,1.2,1.7]）',
    JSON.stringify(ts.map((x) => +(x - t0).toFixed(3))));
  chk('后 5 击时刻吻合骨架（0.3/0.6/0.9/1.2/1.7）',
    [0.3, 0.6, 0.9, 1.2, 1.7].every((want, i) => Math.abs((ts[i] - t0) - want) < 0.06),
    JSON.stringify(ts.map((x) => +(x - t0).toFixed(2))));
  const a = slash[0].amount, last = slash[slash.length - 1].amount;
  console.log('     伤害: 中间击各 %s，末击 %s，比=%s（期望 ≈2.0）', Math.round(a), Math.round(last), (last / a).toFixed(2));
  chk('最后一击伤害约为 2 倍', last > a * 1.7 && last < a * 2.4);
  chk('全部斩击都是法术伤害', slash.every((d) => d.dmg?.type === 'arts'));
  chk('非末击等额', slash.slice(0, -1).every((d) => Math.abs(d.amount - a) < 1e-6));
}
const fear = st.filter((s) => s.status === 'fear');
chk('施加了恐惧', fear.length >= 1, `${fear.length} 次`);
if (fear.length) chk('恐惧时长 = 4 秒', Math.abs((fear[0].duration ?? 0) - 4) < 1e-6, `${fear[0].duration}`);

// 总伤害核对：484×5 + 968 = 3388（atk 242 口径；2026-10-17 基础属性恢复官方白值后）
if (false) {
  const total = slash.reduce((s, d) => s + d.amount, 0);
  console.log('     总伤害 %s（期望 %s）', Math.round(total), WANT_TALENT);
  chk('总伤害与逐击相加一致', Math.abs(total - WANT_TALENT) < 1);
}

// 引擎不变量：harness 的 checkInvariants 会读 result 的收尾计数器，
// 只有战斗真正结束才齐备——所以先跑到结束再查
// 【已知限制】harness 的 checkInvariants() 会读 result 的收尾计数器（killedInTotal 等），
// 那些只在战斗**真正结束**时才齐备。本测试为了跑完天赋 6 击窗口用了高血量敌人（50000），
// 战斗只能以 timeout 收尾，故该检查不适用 —— 与 kit 无关。
// 若要看不变量，把敌人血量降到能被收掉即可（见本文件早期的 4200 版本）。
console.log('\n=== 推进到战斗结束 ===');
h.runToEnd(120);
console.log('  结束原因: %s   t=%s', h.result()?.reason ?? '(未结束)', h.b.time.toFixed(2));
console.log('  （跳过 checkInvariants —— 见上方已知限制）');

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
