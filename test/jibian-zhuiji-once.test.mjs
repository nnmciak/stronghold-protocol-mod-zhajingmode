// 追忆（jibian_zhuiji）一次性：触发后本局不再回到惊变卡池。
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerMeta } from '../server/sim/content/jibian.js';
import { getData } from '../server/data.js';
import { Match } from '../server/match/Match.js';

function handlerOf() {
  const reg = { seen: {}, register(name, defs) { this.seen[name] = defs; }, has: () => false };
  registerMeta(reg);
  return reg.seen['jibian:jibian_zhuiji']?.onRoundWouldStart || null;
}

test('追忆触发：回合改为 10、卡被移除，并记入「本局已消耗」', () => {
  const removed = [], consumed = [];
  const ctx = {
    effects: () => [{ id: 7, key: 'jibian:jibian_zhuiji' }],
    removeEffect: (id) => removed.push(id),
    markJibianConsumed: (id) => consumed.push(id),
    toast: () => {},
  };
  const ev = { round: 14 };
  handlerOf()(ctx, ev);
  assert.equal(ev.round, 10, '第 14 回合改写成第 10 回合');
  assert.deepEqual(removed, [7], '卡从身上移除');
  assert.deepEqual(consumed, ['jibian_zhuiji'], '标记本局已消耗');
});

test('已消耗的追忆进 exclude 集合（_jibianOwned）', (t) => {
  const seats = [{ seat: 0, playerId: 'p1', name: 'p1', isBot: false, connected: true }];
  const m = new Match({
    roomCode: 'ZJON', mode: 'solo', difficulty: 'ZHAJING', modeId: 'mode_single_zhajing',
    data: getData(), seed: 11, seats, send: () => true, broadcast: () => {}, onEnd: () => {},
  });
  t.after(() => m.dispose());
  const ps = m.players.get('p1');
  ps.jibianConsumed = new Set(['jibian_zhuiji']);
  const owned = m._jibianOwned(ps);
  assert.ok(owned.has('jibian_zhuiji'), '一次性惊变要进 exclude 集合，避免再抽到');
});