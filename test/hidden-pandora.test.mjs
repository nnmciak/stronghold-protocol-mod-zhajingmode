import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { getDefaultRegistry } from '../server/match/effectsMeta.js';
import { PHASE } from '../shared/constants.js';

const mk = (seed) => new Match({
  roomCode: 'PAN', mode: 'solo', difficulty: 'ZHAJING', modeId: 'mode_single_zhajing', seed,
  data: getData(), registry: getDefaultRegistry(),
  seats: [{ seat: 0, playerId: 'p1', name: 't', isBot: false, connected: true }],
  send: () => true, broadcast: () => {}, onEnd: () => {},
});

// 隐秘池只有潘多拉 → 首抽必中；随后追加 3 张（普通池按权重 / 7.99% 走隐秘池）
const m = mk(21);
m.phase = 'PREP'; m.round = 1;
m.enterHiddenJibian({
  enabled: true, label: '隐秘惊变', flickerMs: 1, resultMs: 1,
  pool: [{ effectId: 'ejibian_hidden_pandora', name: '潘多拉·敌', desc: 'x', rarity: 'hidden' }],
});
const cards = m.hiddenJibian.cards;
console.log('抽到:', cards.length, '张 |', cards.map((c) => c.name + '/' + c.rarity).join('、'));
console.log('enemyJibianCards:', JSON.stringify(m.enemyJibianCards));
assert.equal(m.phase, PHASE.HIDDEN_JIBIAN);
assert.equal(cards[0].id, 'ejibian_hidden_pandora', '保底那张是潘多拉');
assert.equal(cards[0].rarity, 'hidden');
assert.equal(cards.length, 5, '初始 2 张 + 潘多拉追加 3 张');
assert.equal(m.enemyJibianCards.length, 5);
assert.ok(m.enemyJibianCards.every((x) => typeof x === 'string' && x));

// 空隐秘池：只抽普通 1 张
const m2 = mk(22);
m2.phase = 'PREP'; m2.round = 1;
m2.enterHiddenJibian({ enabled: true, label: '隐秘惊变', flickerMs: 1, resultMs: 1, pool: [] });
console.log('空隐秘池 → 张数:', m2.hiddenJibian.cards.length, '|', m2.hiddenJibian.cards.map((c) => c.name).join('、'));
assert.equal(m2.hiddenJibian.cards.length, 2, '隐秘池为空时退回普通池抽两张');

// 真实配置：10 张隐秘池里抽到潘多拉时，总张数 = 2 + 3（多开几局找一次）
let sawPandora = false;
for (let seed = 30; seed < 60 && !sawPandora; seed++) {
  const mm = mk(seed);
  mm.phase = 'PREP'; mm.round = 1;
  mm.startFinalAssault(true);
  const cs = mm.hiddenJibian.cards;
  if (cs[0].id === 'ejibian_hidden_pandora') {
    sawPandora = true;
    console.log('真实池 seed', seed, '抽到潘多拉 → 共', cs.length, '张:', cs.map((c) => c.name).join('、'));
    assert.equal(cs.length, 5);
  }
  mm.dispose();
}
console.log('真实池里见到潘多拉:', sawPandora);
console.log('PASS');
m.dispose(); m2.dispose();