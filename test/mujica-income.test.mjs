import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../server/data.js';
import { Match } from '../server/match/Match.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { PHASE } from '../shared/constants.js';

const NYAMU = 'chess_zj_amoris_a';
const SWIRE = 'chess_zj_33_a';

// Use the production registry and real phase / player lifecycle. Only the combat
// outcome is supplied by this test: no enemies need to be simulated to check income.
// This catches a forgotten pendingFunds reset or a duplicate endPrep dispatch that
// a single direct call to the trait handler cannot expose.
function setup(t) {
  const scheduler = new VirtualScheduler();
  const m = new Match({
    roomCode: 'COIN', mode: 'solo', difficulty: 'ZHAJING', modeId: 'mode_single_zhajing', seed: 3,
    data: getData(), scheduler, clientCombat: true,
    seats: [{ seat: 0, playerId: 'p1', name: 'income regression', isBot: false, connected: true }],
    send: () => true, broadcast: () => {}, onEnd: () => {},
  });
  t.after(() => m.dispose());
  const ps = m.players.get('p1');
  // Begin after the strategy draft, with its normal starting LP and no strategy
  // effect that could add an unrelated income modifier.
  ps.lp = ps.gd.startLp(null);
  m.startRound(1);
  m.enterPrep();

  function acquire(id, where = 'board', cell = null) {
    const piece = ps.acquireChess(id, { source: 'reward', fromPool: false });
    assert.ok(piece, `acquire ${id}`);
    if (where === 'board') {
      const key = cell || [...ps.deployMap()].find(([key]) => {
        const [r, c] = key.split(',').map(Number);
        return !ps.board.has(key) && ps._legal(piece, r, c);
      })?.[0];
      assert.ok(key, `legal deployment for ${id}`);
      const [row, col] = key.split(',').map(Number);
      assert.equal(ps.move(piece.uid, { area: 'board', row, col }).ok, true);
    }
    return piece;
  }

  function nextPrep(bonus, { spend = true } = {}) {
    const from = m.round;
    if (spend) assert.equal(ps.spend(ps.funds), true);
    const held = ps.funds;
    const it = ps.gd.interest;
    const interest = held >= it.capital ? Math.min(it.max, Math.floor(held / it.capital) * it.interest) : 0;
    const beforePending = ps.pendingFunds;
    m.endPrep();
    assert.equal(m.phase, PHASE.COMBAT, 'real prep end entered combat');
    assert.equal(ps.pendingFunds, beforePending + bonus, `R${from}: exactly this prep's trait grants`);
    const preview = ps.privateView().income;
    assert.equal(preview.pending, beforePending + bonus);
    assert.equal(preview.total, ps.gd.income(from + 1) + interest + beforePending + bonus);
    // Ready and the deadline can arrive together; the phase guard must prevent a
    // second regular payout. Explicit trait retriggers are tested separately.
    m.endPrep();
    m.prepDeadline();
    assert.equal(ps.pendingFunds, beforePending + bonus, 'duplicate end notifications do not repay traits');
    m.settle(null, null);
    m.afterSettle();
    m.enterPrep();
    assert.equal(m.round, from + 1);
    assert.equal(ps.funds - held, ps.gd.income(from + 1) + interest + beforePending + bonus);
    assert.equal(ps.pendingFunds, 0, 'one-time next-prep credit was consumed');
    assert.equal(ps.privateView().income.pending, 0, 'UI does not carry a paid credit into a future round');
    assert.equal(m.dispatcher.errors, 0);
    assert.equal(m.errorCount, 0);
    assert.deepEqual(scheduler.errors, []);
    return ps.funds - held;
  }
  return { m, ps, acquire, nextPrep };
}

test('one Nyamu pays a flat +2 for three consecutive round transitions, matching Swire', t => {
  const nyamu = setup(t);
  const swire = setup(t);
  nyamu.acquire(NYAMU);
  swire.acquire(SWIRE);
  const nyamuIncome = [], swireIncome = [];
  for (let i = 0; i < 3; i++) {
    nyamuIncome.push(nyamu.nextPrep(2));
    swireIncome.push(swire.nextPrep(2));
  }
  assert.deepEqual(nyamuIncome, swireIncome);
  assert.deepEqual(nyamuIncome, [2, 3, 4].map(r => nyamu.ps.gd.income(r) + 2));
  t.diagnostic(`R2–R4 income with one Nyamu: ${nyamuIncome.join(', ')}; bonus: 2, 2, 2`);
});

test('two separately acquired Nyamus stack to +4, without a growing per-round bonus', t => {
  const h = setup(t);
  const first = h.acquire(NYAMU), second = h.acquire(NYAMU);
  assert.notEqual(first.uid, second.uid);
  assert.equal(h.ps.allChess().filter(p => p.id === NYAMU).length, 2);
  for (let i = 0; i < 3; i++) h.nextPrep(4);
});

test('Nyamu and Swire bonuses stack across three rounds, including Swire elite values', t => {
  for (const [id, amount] of [[SWIRE, 2], ['chess_zj_33_b', 4]]) {
    const h = setup(t);
    h.acquire(NYAMU);
    h.acquire(id);
    for (let i = 0; i < 3; i++) h.nextPrep(2 + amount);
  }
});

test('one elite Nyamu pays +4 each prep', t => {
  const h = setup(t);
  h.acquire('chess_zj_amoris_b');
  for (let i = 0; i < 3; i++) h.nextPrep(4);
});

test('bench Nyamu pays only when Mujica is active; two bench copies stack', t => {
  const h = setup(t);
  h.acquire(NYAMU, 'hand');
  h.acquire(NYAMU, 'hand');
  for (let i = 0; i < 3; i++) h.nextPrep(0);
  const u = h.acquire('chess_zj_mortis_a');
  h.acquire('chess_zj_tmoris_a');
  assert.equal(h.ps.bonds.mujicaShip.active, true);
  for (let i = 0; i < 3; i++) h.nextPrep(4);
  assert.equal(h.ps.move(u.uid, { area: 'hand', idx: h.ps.hand.findIndex(p => !p) }).ok, true);
  assert.equal(h.ps.bonds.mujicaShip.active, false);
  h.nextPrep(0);
});

test('deployed plus bench Nyamu only pays for eligible copies', t => {
  const h = setup(t);
  h.acquire(NYAMU);
  h.acquire(NYAMU, 'hand');
  assert.equal(h.ps.bonds.mujicaShip.active, false, 'two copies are only one distinct core member');
  h.nextPrep(2);
  h.acquire('chess_zj_tmoris_a');
  assert.equal(h.ps.bonds.mujicaShip.active, true);
  h.nextPrep(4);
  h.nextPrep(4);
});

test('a legitimate extra trigger pays once more but does not become permanent income', t => {
  const h = setup(t);
  const nyamu = h.acquire(NYAMU);
  assert.equal(h.m.dispatcher.triggerGarrisons(h.ps, nyamu, 'SERVER_PREP_FIN'), 1);
  assert.equal(h.ps.pendingFunds, 2);
  h.nextPrep(2); // +2 retrigger and +2 normal prep end, only for this next prep.
  h.nextPrep(2);
  h.nextPrep(2);
});

test('Saria copying Nyamu at prep end stacks for three rounds and does not accrue permanently', t => {
  const h = setup(t);
  const cells = [...h.ps.deployMap()].filter(([, cls]) => cls === 'melee').map(([key]) => key);
  const left = cells.find(key => {
    const [r, c] = key.split(',').map(Number);
    return cells.includes(`${r},${c + 1}`);
  });
  assert.ok(left, 'adjacent legal ground cells exist');
  const [r, c] = left.split(',').map(Number);
  h.acquire('chess_zj_69_a', 'board', left);
  h.acquire(NYAMU, 'board', `${r},${c + 1}`);
  for (let i = 0; i < 3; i++) h.nextPrep(4);
});

test('saved funds and interest are distinct from the flat +2 Nyamu trait', t => {
  const h = setup(t);
  h.acquire(NYAMU);
  h.ps.funds = 10;
  for (let i = 0; i < 3; i++) h.nextPrep(2, { spend: false });
});
