// 联防默认观战：漏怪的人（不在 players 里，只在 leakers 里）必须看到自己的战场，而不是别人的。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';
import { homeFieldId } from '../public/js/ui/gameLogic/watch.js';

const FIELDS = [
  { fieldId: 'u0', kind: 'unite', players: ['h1', 'h2'], leakers: ['leakerA'], live: true },
  { fieldId: 'u1', kind: 'unite', players: ['h2', 'h3'], leakers: ['leakerB'], live: true },
];

test('_defaultWatch：漏怪者优先自己的战场', () => {
  const m = {
    fields: FIELDS,
    watchers: new Map(),
    _viewers: () => [
      { playerId: 'leakerA', connected: true },
      { playerId: 'leakerB', connected: true },
      { playerId: 'h2', connected: true },
    ],
    _sendField: () => {},
  };
  Match.prototype._defaultWatch.call(m);
  assert.equal(m.watchers.get('leakerA'), 'u0');
  assert.equal(m.watchers.get('leakerB'), 'u1');
  assert.equal(m.watchers.get('h2'), 'u0', '兜底干员维持原逻辑（第一个包含自己的战场）');
});

test('fieldOf：漏怪者也能解析到自己的战场', () => {
  const v = { fields: FIELDS };
  assert.equal(Match.prototype.fieldOf.call(v, { playerId: 'leakerB' }), 'u1');
  assert.equal(Match.prototype.fieldOf.call(v, { playerId: 'nobody' }), null);
});

test('客户端 homeFieldId：leakers 也算自己的战场', () => {
  const pub = { fields: FIELDS, players: [{ playerId: 'leakerB', name: 'B' }] };
  assert.equal(homeFieldId(pub, 'leakerB'), 'u1');
  assert.equal(homeFieldId(pub, 'h3'), 'u1');
});
test('既漏怪又兜底：优先自己的（leaker）战场', () => {
  const ordered = [
    { fieldId: 'u1', kind: 'unite', players: ['leakerA', 'h3'], leakers: ['leakerB'], live: true },
    { fieldId: 'u0', kind: 'unite', players: ['h1'], leakers: ['leakerA'], live: true },
  ];
  const m = { fields: ordered, watchers: new Map(), _viewers: () => [{ playerId: 'leakerA', connected: true }], _sendField: () => {} };
  Match.prototype._defaultWatch.call(m);
  assert.equal(m.watchers.get('leakerA'), 'u0', '即使兜底场排在前面，也先看自己的协防场');
  assert.equal(Match.prototype.fieldOf.call({ fields: ordered }, { playerId: 'leakerA' }), 'u0');
  assert.equal(homeFieldId({ fields: ordered, players: [] }, 'leakerA'), 'u0');
});
