import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../server/data.js';
import { Match } from '../server/match/Match.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { applyCard, jibianCard } from '../server/match/choices.js';
import { checkLoadout } from '../shared/protocol.js';

// 2026-10-25（玩家反馈「火陈局内换不了技能」）：火陈是 isDiy 的永久记录（charId 非空），
// 以前 checkLoadout 把一切 isDiy 都拒了 → setPrepLoadout 整体 BAD_TARGET，换技能无效。
const CHEN_BASE = 'chess_chen3_a';
const CHEN_GOLD = 'chess_chen3_b';
const SLOT = 'chess_char_5_diy1_a';

function setup(t) {
  const scheduler = new VirtualScheduler();
  const seats = [{ seat: 0, playerId: 'p1', name: 'p1', connected: true, isBot: false }];
  const m = new Match({ roomCode: 'CHEN', mode: 'solo', difficulty: 'ZHAJING', modeId: 'mode_single_zhajing',
    data: getData(), seed: 5, scheduler, seats, clientCombat: true, send: () => true, broadcast: () => {}, onEnd: () => {} });
  t.after(() => m.dispose());
  m.phase = 'PREP'; m.round = 1;
  return { m, ps: m.players.get('p1') };
}

test('checkLoadout: 火陈（永久 DIY 记录）可配技能，普通 DIY 槽位仍然不可', () => {
  const gd = new Match({ roomCode: 'X', mode: 'solo', difficulty: 'ZHAJING', modeId: 'mode_single_zhajing',
    data: getData(), seed: 1, seats: [{ seat: 0, playerId: 'p1', name: 'p1', connected: true }],
    send: () => true, broadcast: () => {}, onEnd: () => {} }).gd;
  const ok = checkLoadout({ [CHEN_BASE]: { skill: 1 } }, (id) => gd.chess(id));
  console.log('火陈 loadout:', JSON.stringify(ok));
  assert.equal(ok.ok, true);
  assert.equal(ok.loadout[CHEN_BASE].skill, 1);
  const slot = checkLoadout({ [SLOT]: { skill: 1 } }, (id) => gd.chess(id));
  assert.ok(!slot.ok, '自选槽位仍应拒绝');
});

test('局内换技能：setPrepLoadout 接受火陈的技能切换并让战斗输入读到', (t) => {
  const { m, ps } = setup(t);
  const rec = m.gd.jibian().pool.find((c) => c.effectId === 'jibian_chixiaojianfa');
  assert.ok(rec);
  applyCard(m, ps, { ...jibianCard(m.gd, rec), family: 'jibian' });
  assert.ok(ps.allChess().some((p) => p.id === CHEN_GOLD), '手里应有精锐火陈');

  const res = m.setPrepLoadout('p1', { [CHEN_BASE]: { skill: 1 } });
  console.log('setPrepLoadout:', JSON.stringify(res));
  assert.equal(res.ok, true, '换技能应被接受');
  const lo = ps.loadoutFor(m.gd.chess(CHEN_GOLD));
  assert.equal(lo.skillIndex, 1, '战斗输入应按新技能');
  // 换回 0（S1）也要生效
  assert.equal(m.setPrepLoadout('p1', { [CHEN_BASE]: { skill: 0 } }).ok, true);
  assert.equal(ps.loadoutFor(m.gd.chess(CHEN_GOLD)).skillIndex, 0);
});