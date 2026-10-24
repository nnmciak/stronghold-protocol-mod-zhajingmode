import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { getDefaultRegistry } from '../server/match/effectsMeta.js';
import { jibianCard } from '../server/match/choices.js';

// 2026-10-25（owner）：惊变「快手」（隐秘）—— 选中后把同一批的另外两张也一并拿走。
const m = new Match({
  roomCode: 'KS', mode: 'solo', difficulty: 'ZHAJING', modeId: 'mode_single_zhajing', seed: 7,
  data: getData(), registry: getDefaultRegistry(),
  seats: [{ seat: 0, playerId: 'p1', name: 't', isBot: false, connected: true }],
  send: () => true, broadcast: () => {}, onEnd: () => {},
});
m.round = 1;
m.enterSpDraft();
const ps = m.players.get('p1');
const s = m.spOf(ps);
assert.ok(s && Array.isArray(s.cards), '应该有每人一副的惊变牌库');

const pool = m.gd.jibian().pool;
const card = (id) => { const spec = pool.find((c) => c.effectId === id); assert.ok(spec, `池里没有 ${id}`); return jibianCard(m.gd, spec, spec.rarity); };
s.cards = [card('jibian_kuaishou'), card('jibian_qiangqiang'), card('jibian_zhebeiwuqing')];
s.taken = [null, null, null];
s.picks = {};
s.rerolled = [];

const owned = () => new Set((ps.effects || []).map((e) => String(e.key || '')).filter((k) => k.startsWith('jibian:')).map((k) => k.slice(7)));
console.log('选之前:', JSON.stringify([...owned()]));
m._applyCard(ps, s, 0);
const got = owned();
console.log('选之后:', JSON.stringify([...got]), '| taken:', JSON.stringify(s.taken));

assert.ok(got.has('jibian_kuaishou'), '快手本身要进列表');
assert.ok(got.has('jibian_qiangqiang'), '另外两张也要进列表（强强）');
assert.ok(got.has('jibian_zhebeiwuqing'), '另外两张也要进列表（这杯我请）');
assert.deepEqual(s.taken, ['p1', 'p1', 'p1'], '三个槽位都标记为本人取走');
console.log('PASS');
m.dispose();