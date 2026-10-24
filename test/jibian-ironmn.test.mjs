import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getData } from '../server/data.js';
import { Match } from '../server/match/Match.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { applyCard, jibianCard } from '../server/match/choices.js';
import { activeBonds, bondHintsFor } from '../server/sim/content/jibianBonds.js';
import { makeBattle } from './helpers/battleHarness.js';

// 2026-10-25（owner）：炸惊专属、仅由惊变获得的「白铁」（和火陈同一类），
//   惊变「谁还有梦想」（史诗）+ 惊变羁绊「工匠精神」
const CARD = 'jibian_shuihaiyoumengxiang';
const SECRET = 'jibian_weiduoliyademimi';
const CHESS = 'chess_zj_ironmn_b';

function setup(t) {
  const scheduler = new VirtualScheduler();
  const seats = [{ seat: 0, playerId: 'p1', name: 'p1', connected: true, isBot: false }];
  const m = new Match({ roomCode: 'IRON', mode: 'solo', difficulty: 'ZHAJING', modeId: 'mode_single_zhajing',
    data: getData(), seed: 77, scheduler, seats, clientCombat: true, send: () => true, broadcast: () => {}, onEnd: () => {} });
  t.after(() => m.dispose());
  m.phase = 'PREP'; m.round = 1;
  return { m, ps: m.players.get('p1') };
}

test('data: the epic card exists in both zhajing pools and the chess/token records are present', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
  for (const mid of ['mode_single_zhajing', 'mode_multi_zhajing']) {
    const card = cfg.modes[mid].jibian.pool.find((c) => c.effectId === CARD);
    assert.ok(card, `${mid} 缺少谁还有梦想`);
    assert.equal(card.name, '谁还有梦想');
    assert.equal(card.rarity, 'epic');
    assert.equal(card.bond, 'victoriaShip');
    assert.equal(card.flavor, '大铁老师还在升值。');
  }
  const chess = JSON.parse(fs.readFileSync(new URL('../data/chess.json', import.meta.url), 'utf8'));
  const rec = chess[CHESS];
  assert.ok(rec, '缺少精锐白铁记录');
  assert.equal(rec.charId, 'char_4072_ironmn');
  assert.deepEqual(rec.bonds, ['victoriaShip']);
  assert.equal(rec.zhajing, true);
  assert.equal(rec.visible, false);
  assert.equal(rec.isGolden, true);
  assert.equal(rec.grantOnly, true, '只能由惊变发放，不能进卡池');
  const tokens = JSON.parse(fs.readFileSync(new URL('../data/tokens.json', import.meta.url), 'utf8'));
  for (const tid of rec.tokens) assert.ok(tokens[tid], `缺少 token ${tid}`);
  assert.deepEqual(tokens[rec.tokens[0]].owners, ['chess_zj_ironmn_a', 'chess_zj_ironmn_b']);
  const bonds = JSON.parse(fs.readFileSync(new URL('../data/jibianBonds.json', import.meta.url), 'utf8'));
  const craft = bonds.bonds.find((b) => b.id === 'craftsman');
  assert.ok(craft, '缺少工匠精神');
  assert.deepEqual(craft.members, [SECRET, CARD]);
});

test('picking 谁还有梦想 grants the elite 白铁 (维多利亚)', (t) => {
  const { m, ps } = setup(t);
  const roster = m.gd.visibleChess || [];
  assert.ok(!roster.includes(CHESS), '白铁不应出现在炸惊卡池/商店里');
  const rec = m.gd.jibian().pool.find((c) => c.effectId === CARD);
  assert.ok(rec);
  applyCard(m, ps, { ...jibianCard(m.gd, rec), family: 'jibian' });
  assert.equal(m.dispatcher.errors, 0);
  const ids = ps.allChess().map((p) => p.id);
  assert.ok(ids.includes(CHESS), `手里应有精锐白铁，实际 ${ids.join(', ')}`);
  const piece = ps.allChess().find((p) => p.id === CHESS);
  const chess = m.gd.chess(CHESS);
  assert.ok(chess.bonds.includes('victoriaShip'));
  assert.equal(piece && chess.name, '白铁');
});

test('工匠精神: 2 张卡激活，每把维式战锤 +5% 最终攻击力', () => {
  const owned = new Set([SECRET, CARD]);
  const act = activeBonds(owned);
  assert.ok(act.some((a) => a.def.id === 'craftsman'), '两张卡应激活工匠精神');
  const hint = bondHintsFor(CARD, owned).find((h) => h.name === '工匠精神');
  assert.ok(hint && hint.have === 2, '卡面应显示 2/2');

  const units = [{ chessId: 'chess_char_5_02_a', row: 9, col: 4, items: ['chess_item_1_01_e_a', 'chess_item_2_03_e_a'] }];
  const run = (effects) => {
    const h = makeBattle({ modeId: 'mode_single_zhajing', units: units.map((u) => ({ ...u })), playerEffects: effects, autoFinish: false, timeLimit: 3 });
    h.step(1);
    const u = h.b.allyUnits.find((x) => x.kind === 'op');
    return { atk: u && u.s.atk, errors: h.b.errors };
  };
  const plain = run([]);
  const bonded = run([{ key: `jibian:${SECRET}` }, { key: `jibian:${CARD}` }]);
  console.log('atk:', plain.atk, '→', bonded.atk, '| errors:', JSON.stringify(bonded.errors));
  assert.equal(bonded.errors.length, 0);
  const ratio = bonded.atk / plain.atk;
  assert.ok(Math.abs(ratio - 1.10) < 1e-6, `两把战锤应为 ×1.10，实际 ×${ratio.toFixed(4)}`);
});