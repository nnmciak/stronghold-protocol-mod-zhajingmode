import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { getDefaultRegistry } from '../server/match/effectsMeta.js';
import { PHASE } from '../shared/constants.js';

const mk = (seed) => new Match({
  roomCode: 'HJB', mode: 'solo', difficulty: 'ZHAJING', modeId: 'mode_single_zhajing', seed,
  data: getData(), registry: getDefaultRegistry(),
  seats: [{ seat: 0, playerId: 'p1', name: 't', isBot: false, connected: true }],
  send: () => true, broadcast: () => {}, onEnd: () => {},
});

const m = mk(11);
m.phase = 'PREP'; m.round = 1;
const ps = m.players.get('p1');
ps.layers.mujicaShip = 1200;
m.startFinalAssault(true);
const cards = m.hiddenJibian?.cards || [];
console.log('触发 phase:', m.phase, '| 张数:', cards.length, '|', cards.map((c) => c.name + '/' + c.rarity).join(', '));
console.log('层数（响指抽到就会减半）:', JSON.stringify(ps.layers));
assert.equal(m.phase, PHASE.HIDDEN_JIBIAN);
assert.ok(cards.length >= 2 && cards.length <= 5, '两张隐秘（抽到潘多拉会追加 3 张）');
assert.ok(cards.slice(0, 2).every((c) => c.rarity === 'hidden'), '前两张都应是隐秘卡');
assert.equal(m.enemyJibianCards.length, cards.length);

// 阶段进行中：视图要带揭露池子（滚动展示用）
const v = m.publicView();
console.log('public.hiddenJibian:', v.hiddenJibian ? JSON.stringify({ label: v.hiddenJibian.label, n: v.hiddenJibian.cards.length, pool: (v.hiddenJibian.pool || []).length, flickerMs: v.hiddenJibian.flickerMs }) : '缺失');
assert.ok(v.hiddenJibian && v.hiddenJibian.hidden === true);
assert.ok((v.hiddenJibian.pool || []).length > 0, '揭露池子要带上隐秘卡');

// 响指：如果抽到了，层数应减半
const snap = cards.some((c) => c.id === 'ejibian_hidden_snap');
console.log('是否抽到响指:', snap, '| 当前层数:', JSON.stringify(ps.layers));

// 揭示结束后回到隐秘核心开局
m.startFinalAssault(true);
console.log('揭示后 phase:', m.phase);
assert.notEqual(m.phase, PHASE.HIDDEN_JIBIAN);

console.log('PASS');
m.dispose();