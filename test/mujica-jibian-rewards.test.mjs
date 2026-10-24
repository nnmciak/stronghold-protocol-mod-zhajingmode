import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getData } from '../server/data.js';
import { GameData } from '../server/match/gamedata.js';
import { Match } from '../server/match/Match.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { applyCard, generateDraft, jibianCard, jibianDraftCards } from '../server/match/choices.js';
import { createRng } from '../server/sim/rng.js';
import { activeBonds, bondHintsFor, jibianBonds, ownedJibianIdsOf } from '../server/sim/content/jibianBonds.js';

const GALAXY = 'jibian_yinhezhanjian';
const GODDESS = 'jibian_yiwangnvshen';
const BEAST = 'jibian_duoshouyeshou';
const CARDS = [GALAXY, GODDESS, BEAST];
const TRIO = ['chess_zj_tmoris_b', 'chess_zj_amoris_b', 'chess_zj_dolris_b'];
const BEAST_MORTIS = 'chess_zj_mortis_b';
const SAKIKO = 'chess_zj_oblvns_b';

function setup(t, multi = false) {
  const scheduler = new VirtualScheduler();
  const seats = (multi ? ['p1', 'p2'] : ['p1']).map((playerId, seat) => ({ seat, playerId, name: playerId, connected: true, isBot: false }));
  const m = new Match({ roomCode: 'AVEM', mode: multi ? 'coop' : 'solo', difficulty: 'ZHAJING',
    modeId: multi ? 'mode_multi_zhajing' : 'mode_single_zhajing', data: getData(), seed: 31,
    scheduler, seats, clientCombat: true, send: () => true, broadcast: () => {}, onEnd: () => {},
  });
  t.after(() => m.dispose());
  m.phase = 'PREP'; m.round = 1;
  const ps = m.players.get('p1');
  const pick = id => {
    const rec = m.gd.jibian().pool.find(c => c.effectId === id);
    assert.ok(rec, `pool contains ${id}`);
    applyCard(m, ps, { ...jibianCard(m.gd, rec), family: 'jibian' });
    assert.equal(m.dispatcher.errors, 0);
    assert.equal(m.errorCount, 0);
    assert.deepEqual(scheduler.errors, []);
  };
  return { m, ps, pick };
}

const pieces = ps => ps.allChess().map(p => p.id).sort();
const fillHand = ps => {
  for (let i = 0; i < ps.hand.length; i++) ps.hand[i] = ps.newPiece('item', 'chess_item_jibian_trophy');
  ps.recompute();
};

test('both 炸惊 pools draw the three cards with their real rarity; ordinary modes never include them', () => {
  for (const mid of ['mode_single_zhajing', 'mode_multi_zhajing']) {
    const gd = new GameData(getData(), mid);
    const exclude = new Set(gd.jibian().pool.filter(c => !CARDS.includes(c.effectId)).map(c => c.effectId));
    const draft = generateDraft(gd, createRng(21), 1, { exclude, owned: new Set() });
    assert.equal(draft.family, 'jibian');
    assert.deepEqual(draft.cards.map(c => c.id).sort(), CARDS.slice().sort());
    for (const c of draft.cards) {
      assert.equal(c.rarity, c.id === BEAST ? 'legend' : 'epic');
      assert.equal(c.flavor, { [GALAXY]: '“现在我们是一丘之貉了。”', [GODDESS]: '“你愿意将人生托付于我吗？”', [BEAST]: '你是多首的怪物。' }[c.id]);
      assert.equal(c.bonds[0].name, 'Ave Mujica');
      assert.deepEqual(c.bonds[0].tiers, [2, 3]);
      assert.equal(c.bonds[0].have, 0);
    }
    const withoutOwned = jibianDraftCards(gd, createRng(21), 3, new Set([...exclude, GALAXY]), { owned: new Set([GALAXY]) });
    assert.deepEqual(withoutOwned.map(c => c.id).sort(), [GODDESS, BEAST].sort());
    for (const card of withoutOwned) assert.equal(card.bonds[0].have, 1);
  }
  for (const mid of ['mode_single_normal', 'mode_multi_normal']) {
    const gd = new GameData(getData(), mid);
    assert.ok(!gd.jibian()?.pool?.some(c => CARDS.includes(c.effectId)));
  }
});

test('银河战舰 grants one elite Umiri, Nyamu and Uika and no later card repays it', t => {
  const { ps, pick } = setup(t);
  const poolBefore = TRIO.map(id => ps.poolOf(id).left(id));
  pick(GALAXY);
  assert.deepEqual(pieces(ps), TRIO.slice().sort());
  assert.deepEqual(TRIO.map(id => ps.poolOf(id).left(id)), poolBefore, 'free reward consumes no shop stock');
  pick(BEAST);
  assert.deepEqual(pieces(ps), [...TRIO, BEAST_MORTIS].sort(), 'a later unrelated pick only adds its own reward');
  assert.equal(ps.effects.filter(e => e.key === `jibian:${GALAXY}`).length, 1);
});

test('遗忘女神 grants an elite Sakiko at shop level 1 even with no stock left', t => {
  const { ps, pick } = setup(t);
  assert.equal(ps.shop.level, 1);
  const base = ps.gd.baseIdOf(SAKIKO), pool = ps.poolOf(base);
  pool.take(base, pool.left(base));
  pick(GODDESS);
  assert.deepEqual(pieces(ps), [SAKIKO]);
  assert.equal(ps.gd.isGolden(ps.allChess()[0].id), true);
  assert.equal(pool.left(base), 0);
});

test('银河战舰 follows existing overflow storage when the normal hand is full', t => {
  const { ps, pick } = setup(t);
  fillHand(ps);
  pick(GALAXY);
  assert.deepEqual(ps.temp.filter(p => p?.kind === 'chess').map(p => p.id).sort(), TRIO.slice().sort());
  assert.equal(ps.hand.filter(Boolean).length, ps.hand.length);
});

test('rewards stay elite even when normal copies are already owned', t => {
  const { ps, pick } = setup(t);
  for (const id of TRIO) assert.ok(ps.acquireChess(ps.gd.baseIdOf(id), { fromPool: false }));
  pick(GALAXY);
  for (const id of TRIO) assert.equal(ps.allChess().filter(p => p.id === id).length, 1, id + ' granted once');
});

test('gift rewards belong only to the picker in a real multiplayer Match', t => {
  const { m, ps, pick } = setup(t, true);
  pick(GALAXY); pick(GODDESS);
  assert.deepEqual(pieces(ps), [...TRIO, SAKIKO].sort());
  assert.deepEqual(pieces(m.players.get('p2')), []);
  assert.equal(ownedJibianIdsOf(m.players.get('p2')).size, 0);
});

test('Ave Mujica activates for 2/3 distinct cards, never by duplicate references, and snapshot ownership is supported', t => {
  const { ps, pick } = setup(t);
  pick(GALAXY);
  assert.ok(!activeBonds(ownedJibianIdsOf(ps)).some(x => x.def.id === 'ave_mujica'));
  assert.ok(!activeBonds([GALAXY, GALAXY]).some(x => x.def.id === 'ave_mujica'));
  pick(GODDESS);
  const tier1 = activeBonds(ownedJibianIdsOf(ps)).find(x => x.def.id === 'ave_mujica');
  assert.equal(tier1.tier, 2); assert.equal(tier1.have, 2);
  assert.equal(bondHintsFor(BEAST, ownedJibianIdsOf(ps))[0].tier, 1);
  pick(BEAST);
  const snapshot = { playerEffects: ps.effects.map(e => ({ ...e })) };
  const tier2 = activeBonds(ownedJibianIdsOf(snapshot)).find(x => x.def.id === 'ave_mujica');
  assert.equal(tier2.tier, 3); assert.equal(tier2.have, 3);
  assert.equal(bondHintsFor(BEAST, ownedJibianIdsOf(ps))[0].tier, 2);
  assert.deepEqual(pieces(ps), [...TRIO, SAKIKO, BEAST_MORTIS].sort(), '多首野兽 grants an elite Mutsumi and changes her trait');
});

test('runtime Ave Mujica metadata matches the data mirror exactly', () => {
  const mirror = JSON.parse(fs.readFileSync(new URL('../data/jibianBonds.json', import.meta.url), 'utf8'));
  assert.deepEqual(mirror.bonds.find(b => b.id === 'ave_mujica'), jibianBonds().find(b => b.id === 'ave_mujica'));
});
