// 追忆（jibian_zhuiji）：一次性、但**不销毁** —— 触发后卡留在手上的惊变列表里，只是失效。
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

function fakeCtx(consumed = new Set()) {
  const removed = [], marked = [], toasts = [];
  return {
    removed, marked, toasts,
    ctx: {
      effects: () => [{ id: 7, key: 'jibian:jibian_zhuiji' }],
      removeEffect: (id) => removed.push(id),
      jibianConsumed: () => new Set(consumed),
      markJibianConsumed: (id) => { marked.push(id); consumed.add(id); },
      toast: (t) => toasts.push(t),
    },
  };
}

test('追忆触发：回合 14 → 10、卡不销毁、记入本局已消耗', () => {
  const h = fakeCtx();
  const ev = { round: 14 };
  handlerOf()(h.ctx, ev);
  assert.equal(ev.round, 10, '第 14 回合改写成第 10 回合');
  assert.deepEqual(h.removed, [], '卡保留在惊变列表里，不销毁');
  assert.deepEqual(h.marked, ['jibian_zhuiji'], '记入本局已消耗');
  assert.equal(h.toasts.length, 1);
});

test('同一局第二次到第 14 回合：已消耗的追忆不再触发', () => {
  const h = fakeCtx(new Set(['jibian_zhuiji']));
  const ev = { round: 14 };
  handlerOf()(h.ctx, ev);
  assert.equal(ev.round, 14, '回合不再改写');
  assert.deepEqual(h.marked, [], '不重复消耗');
  assert.deepEqual(h.toasts, [], '不重复提示');
});

test('已消耗的追忆进 exclude 集合（_jibianOwned），本局不会再抽到', (t) => {
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