import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';   // Match.js 负责把各 mixin 装到 prototype 上（直接 import mixin 会循环依赖）
import { uniteSurvivors } from '../server/match/unite.js';

// 2026-10-25（玩家反馈）：
//  ①「第二次协防时第一次协防叠的层会消失」→ 阶段1+阶段2 的 perPlayer 原来按 pid 直接覆盖，层数/资金被冲掉；
//  ②「协防成功却还是扣血」→ 阶段2 结算时 plan.leakers 只含 relay 的接手方，阶段1 的漏怪玩家不在名单里，
//    settle() 于是回落到「自己那场的漏怪」再扣一次。
const A = { playerId: 'A', name: 'A' };
const B = { playerId: 'B', name: 'B' };
const H = { playerId: 'H', name: 'H' };
const R = { playerId: 'R', name: 'R' };
const leak = (src) => ({ sourcePlayerId: src, enemyKey: 'e', counted: true });
const pp = (leaked, layerGains, extra = {}) => ({ leaked, perfect: leaked.length === 0, layerGains, coins: 0, killed: 0, total: 0, damageDealt: 0, bossDamage: 0, healingDone: 0, deaths: 0, unitsEnd: [], unitStats: [], ...extra });

// 阶段1：A 漏 2、B 漏 3；其中 B 有 1 只「没能重新进场」、1 只「无法转交」，剩下 3 只（A2 + B1）交给阶段2
const p1Plan = { helpers: [H], leakers: [A, B], leaked: [leak('A'), leak('A'), leak('B'), leak('B'), leak('B')], notReentered: new Map([['B', 1]]) };
const p1Result = { perPlayer: {
  A: pp([leak('A'), leak('A')], { sargonShip: 10 }, { coins: 2, killed: 3 }),
  B: pp([leak('B'), leak('B'), leak('B')], { sargonShip: 4 }),
  H: pp([], { preciShip: 1 }),
} };
const relayPlan = { helpers: [R], leakers: [A, B], leaked: [leak('A'), leak('A'), leak('B')], notReentered: new Map() };
const relayResult = { perPlayer: {
  R: pp([], { sargonShip: 2 }),
  A: pp([], {}),            // 阶段2：A 的两只全被拦下
  B: pp([leak('B')], {}),   // B 有一只在阶段2 又漏过去
}, unspawned: [] };

let captured = null;
const fake = {
  _phase1Settle: { plan: p1Plan, result: p1Result, settledBy: new Map([['B', 1]]) },
  settle(plan, result) { captured = { plan, result }; },
};
Match.prototype._finishRelayBattlefield.call(fake, relayPlan, relayResult, [relayPlan], [relayResult]);

const leakerIds = captured.plan.leakers.map((p) => p.playerId).sort();
console.log('leakers:', leakerIds.join(','), '| notReentered:', JSON.stringify([...captured.plan.notReentered]));
console.log('A 层数:', JSON.stringify(captured.result.perPlayer.A.layerGains), '| B 层数:', JSON.stringify(captured.result.perPlayer.B.layerGains), '| R 层数:', JSON.stringify(captured.result.perPlayer.R.layerGains));

// ① 阶段1 叠的层必须保留（A:10 + 阶段2 0；H 的 preci 也在；R 的 2 也要在）
assert.equal(captured.result.perPlayer.A.layerGains.sargonShip, 10, 'A 阶段1 的 10 层不能丢');
assert.equal(captured.result.perPlayer.B.layerGains.sargonShip, 4, 'B 阶段1 的 4 层不能丢');
assert.equal(captured.result.perPlayer.R.layerGains.sargonShip, 2, '阶段2 的层也要记上');
assert.equal(captured.result.perPlayer.H.layerGains.preciShip, 1, 'H 的层也要在');
assert.equal(captured.result.perPlayer.A.coins, 2, '阶段1 的资金也保留');

// ② 结算口径：A 的怪全被阶段2 拦下 → 0；B = 1 没能再进场 + 1 无法转交 + 1 阶段2 漏过 = 3
const survivors = uniteSurvivors(captured.plan, captured.result);
console.log('结算幸存数:', JSON.stringify([...survivors]));
assert.equal(survivors.get('A') || 0, 0, 'A 的怪在阶段2 被全拦住 → 不该扣血');
assert.equal(survivors.get('B') || 0, 3, 'B：1 没能再进场 + 1 无法转交 + 1 阶段2 漏过');

// ③ 阶段1 的漏怪玩家必须都在 leakers 里（否则 settle 会按自己那场的漏怪再扣一次）
for (const id of ['A', 'B']) assert.ok(leakerIds.includes(id), `${id}（阶段1 的漏怪玩家）应在 leakers 中`);
console.log('PASS');