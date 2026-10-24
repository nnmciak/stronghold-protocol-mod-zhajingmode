import assert from 'node:assert/strict';
import { normalizeSp } from '../public/js/ui/gameLogic/draft.js';

// 2026-10-25（owner：惊变阶段倒计时没显示）：服务端 private 帧带 sp.turnDeadline / sp.turnSeconds，
// 但 normalizeSp 原来没带出来 → ChoiceOverlay 的 turnDeadline 恒为 0，倒计时永远不出现。
const players = [{ playerId: 'p1' }, { playerId: 'p2' }];
const raw = {
  family: 'jibian', name: '惊变阶段', untimed: true,
  cards: [{ idx: 0, effectId: 'jibian_kuaishou', name: '快手' }],
  order: ['p1', 'p2'], turn: 'p1', picks: {}, taken: {},
  turnDeadline: 1792878000000, turnSeconds: 16,
};
const sp = normalizeSp(raw, players);
console.log('normalized:', JSON.stringify({ turnDeadline: sp.turnDeadline, turnSeconds: sp.turnSeconds, untimed: sp.untimed }));
assert.equal(sp.turnDeadline, 1792878000000, '截止时间要透传给客户端');
assert.equal(sp.turnSeconds, 16, '单手时长要透传');
// 没有该字段时不能变成 undefined/NaN
const bare = normalizeSp({ family: 'jibian', cards: [], picks: {} }, players);
assert.equal(bare.turnDeadline, 0);
assert.equal(bare.turnSeconds, null);
console.log('PASS');