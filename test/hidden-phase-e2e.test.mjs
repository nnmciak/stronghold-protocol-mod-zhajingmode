import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { getDefaultRegistry } from '../server/match/effectsMeta.js';
import { PHASE } from '../shared/constants.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (seed) => new Match({
  roomCode: 'HPE', mode: 'solo', difficulty: 'ZHAJING', modeId: 'mode_single_zhajing', seed,
  data: getData(), registry: getDefaultRegistry(),
  seats: [{ seat: 0, playerId: 'p1', name: 't', isBot: false, connected: true }],
  send: () => true, broadcast: () => {}, onEnd: () => {},
});

const m = mk(13);
m.phase = PHASE.PREP; m.round = 13;
m.hiddenBossId = m.bossId;
m.teamLp = 30; m.hiddenLayerSum = 1200;
const ps = m.players.get('p1');

// 走真实流程：从第 13 回合进第 15 回合（startRound → ROUND_START → 整备开始）
m.startRound(m.gd.hiddenRound);
await wait(2400);
console.log('startRound 后 phase:', m.phase, '| round', m.round);
assert.equal(m.round, m.gd.hiddenRound);
assert.equal(m.phase, PHASE.HIDDEN_JIBIAN, '第 15 回合整备开始时应先播隐秘惊变');
const cards = m.hiddenJibian?.cards || [];
console.log('抽到', cards.length, '张 |', cards.map((c) => c.name + '/' + c.rarity).join('、'));

// 揭示期间不应该能进整备
await wait(1200);
console.log('揭示中 phase:', m.phase);
assert.equal(m.phase, PHASE.HIDDEN_JIBIAN, '揭示还没播完');

// 播完 → 整备
await wait(3200);
console.log('揭示结束后 phase:', m.phase, '| 商店', (ps.shop?.slots || []).length, '格');
assert.equal(m.phase, PHASE.PREP, '播完应进入整备');
assert.ok((ps.shop?.slots || []).length > 0, '整备要正常开商店');

// 整备结束 → 直接隐秘核心（不再播第二次）
m.endPrep();
console.log('endPrep 后 phase:', m.phase, '| fields', (m.fields || []).length, '| bossPool', !!m.bossPool);
assert.equal(m.phase, PHASE.HIDDEN_CORE, '整备结束直接进隐秘核心');
assert.ok((m.fields || []).length > 0);
assert.ok(m.bossPool);
const flags = m.fields[0] && m.fields[0].spec && m.fields[0].spec.flags;
console.log('战场 flags.enemyJibian:', flags ? JSON.stringify(flags.enemyJibian) : '（延迟建）');
assert.ok(cards.length >= 2 && m.enemyJibianCards.length >= 2);
console.log('PASS');
m.dispose();