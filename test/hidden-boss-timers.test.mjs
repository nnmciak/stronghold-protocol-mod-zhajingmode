import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';
import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { getDefaultRegistry } from '../server/match/effectsMeta.js';
import { applyHiddenMatchCards } from '../server/sim/content/ejibian.js';

const BOSS = 'boss_test';
const defs = { enemies: { [BOSS]: enemyRec({ key: BOSS, name: '测试BOSS', hp: 5e6, atk: 2000, def: 0, res: 30, speed: 0, rank: 'BOSS' }) } };

{
  const h = makeBattle({
    modeId: 'mode_single_zhajing', autoFinish: false, timeLimit: 200,
    flags: { enemyJibian: ['ejibian_hidden_song'] },
    units: [{ chessId: 'chess_char_1_01_a', row: 9, col: 6 }],
    enemies: [{ key: BOSS, time: 0, route: { motion: 'WALK', start: [9, 7], end: [9, 7], checkpoints: [] } }],
    defs,
  });
  h.step(2);
  const u = h.unit('chess_char_1_01_a');
  const before = (u.elem && u.elem.neural) || 0;
  h.runUntil(() => h.b.time > 16, 40);
  const after = (u.elem && u.elem.neural) || 0;
  console.log('甜美歌喉 | boss 在场', h.enemies().length, '| 15s 前', before, '→ 之后', after);
  assert.ok(after > before, '应造成神经损伤');
}
{
  const h = makeBattle({
    modeId: 'mode_single_zhajing', autoFinish: false, timeLimit: 220,
    flags: { enemyJibian: ['ejibian_hidden_dps'] },
    enemies: [{ key: BOSS, time: 0, route: { motion: 'WALK', start: [9, 7], end: [9, 7], checkpoints: [] } }],
    defs,
  });
  h.step(2);
  const e = h.enemies()[0];
  e.hp = e.s.maxHp * 0.5;
  const before = e.hp;
  h.runUntil(() => h.b.time > 51, 90);
  console.log('dps 检测器 | 血量', before.toFixed(0), '→', e.hp.toFixed(0));
  assert.ok(e.hp > before, '50s 应回复 10%');
}
{
  const m = new Match({ roomCode: 'PUR', mode: 'solo', difficulty: 'ZHAJING', modeId: 'mode_single_zhajing', seed: 3,
    data: getData(), registry: getDefaultRegistry(),
    seats: [{ seat: 0, playerId: 'p1', name: 't', isBot: false, connected: true }], send: () => true, broadcast: () => {}, onEnd: () => {} });
  m.phase = 'PREP'; m.round = 1;
  const ps = m.players.get('p1');
  ps.layers = { yanShip: 12, mujicaShip: 800, swiftShip: 5 };
  applyHiddenMatchCards(m, ['ejibian_hidden_purge', 'ejibian_hidden_snap']);
  console.log('诛伏赐死+响指 | 层数:', JSON.stringify(ps.layers));
  // ★ 2026-10-24：诛伏赐死改为「随机抽一个盟约清零」（不再固定清全场最高的那个）；响指仍把其余盟约减半。
  const ids = ['yanShip', 'mujicaShip', 'swiftShip'];
  const zeroed = ids.filter((id) => ps.layers[id] === 0);
  assert.equal(zeroed.length, 1, '恰好一个盟约被清零');
  const half = { yanShip: 6, mujicaShip: 400, swiftShip: 2 };
  for (const id of ids) {
    if (id === zeroed[0]) continue;
    assert.equal(ps.layers[id], half[id], `${id} 应只减半`);
  }
  m.dispose();
}
console.log('PASS');