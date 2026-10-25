import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../server/data.js';
import { Match } from '../server/match/Match.js';
import { PHASE } from '../shared/constants.js';

// 追忆（jibian_zhuiji）把第 14 回合改写成第 10 回合；若第 10 回合此前已经打过联防，
// 按回合号去重的 `_phase1Driven` 必须清掉，否则新一轮第一段联防打完会直接 return（18/18 卡在 UNITE）。
function setup(t) {
  const seats = [
    { seat: 0, playerId: 'p1', name: 'p1', isBot: false, connected: true },
    { seat: 1, playerId: 'p2', name: 'p2', isBot: false, connected: true },
  ];
  const m = new Match({
    roomCode: 'ZHYI', mode: 'coop', difficulty: 'ZHAJING', modeId: 'mode_multi_zhajing',
    data: getData(), seed: 71, seats, send: () => true, broadcast: () => {}, onEnd: () => {},
  });
  t.after(() => m.dispose());
  return m;
}

test('追忆回到已打过的回合：startRound 重置联防的按回合去重状态', (t) => {
  const m = setup(t);
  m.startRound(10);
  // 第一次经过第 10 回合，第一段联防结束写上的标记
  m._phase1Driven = 10;
  m.uniteRound = 2;
  m._phase1Settle = { plan: {}, result: {} };
  m._uniteHandoff = [{ squad: 0 }];
  m._relayToken = 3;
  // 追忆把 14 改写成 10 后重新进入同一个回合
  m.startRound(10);
  assert.equal(m._phase1Driven, null, '按回合去重的标记必须清空，否则新一轮联防不结算');
  assert.equal(m.uniteRound, 1);
  assert.equal(m._phase1Settle, null);
  assert.equal(m._uniteHandoff, null);
  assert.equal(m._relayToken, 0);
});

test('同一回合重复触发 _afterUniteRound 仍只结算一次（去重没有失效）', (t) => {
  const m = setup(t);
  m.startRound(10);
  m.phase = PHASE.UNITE;
  m.uniteRound = 2;                 // 阶段 2：直接结算，不需要 relay 计划
  let settled = 0;
  m.settle = () => { settled++; };
  const plan = { helpers: [], leakers: [], leaked: [], notReentered: new Map() };
  const result = { perPlayer: {} };
  m._afterUniteRound(plan, result, [plan], [result]);
  m._afterUniteRound(plan, result, [plan], [result]);
  assert.equal(settled, 2, 'uniteRound=2 每次都应结算（去重只针对阶段 1 的规划）');
});
