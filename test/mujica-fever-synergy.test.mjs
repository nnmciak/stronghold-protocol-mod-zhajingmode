import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from './helpers/battleHarness.js';
import * as mujicaBond from '../server/sim/content/mujicaBond.js';
import { ensureMujica, addFever, getFever, getFeverMax, feverState, isFeverActive, FEVER_DURATION } from '../server/sim/content/mujica.js';

const CARDS = ['jibian_yinhezhanjian', 'jibian_yiwangnvshen', 'jibian_duoshouyeshou'];
const MORTIS = 'chess_zj_mortis_a';
const SAKIKO = 'chess_zj_oblvns_a';
const effects = (ids) => ids.map((id) => ({ key: `jibian:${id}` }));
const clean = (h) => assert.deepEqual(h.b.errors, []);

// Use the real Battle/SkillRuntime with inert kits: the original talent gains
// would otherwise obscure the exact threshold that the new card bond changes.
function scenario(ids = [], opts = {}) {
  const h = makeBattle({
    modeId: 'mode_single_zhajing', content: 'generic', autoFinish: false, timeLimit: 90,
    units: [{ chessId: MORTIS, row: 9, col: 4 }], playerEffects: effects(ids),
    kits: {
      [MORTIS]: () => ({ skill: { kind: 'duration', duration: 5 } }),
      [SAKIKO]: () => ({ skill: { kind: 'duration', duration: 5 } }),
    },
    extraContent: [{ install: ensureMujica }, mujicaBond],
    setup(b) { for (const u of b.allyUnits) u.skill?.setTrigger('MANUAL'); },
    ...opts,
  });
  h.step();
  clean(h);
  return h;
}

test('Ave Mujica requires distinct owned cards: every pair grants 225 and all three grant 50', () => {
  const cases = [
    [[], 450], [[CARDS[0]], 450], [[CARDS[0], CARDS[0], CARDS[0]], 450],
    [[CARDS[0], CARDS[1]], 225], [[CARDS[0], CARDS[2]], 225], [[CARDS[1], CARDS[2]], 225],
    [[CARDS[0], CARDS[0], CARDS[1]], 225], [CARDS, 50], [[...CARDS, ...CARDS], 50],
  ];
  for (const [ids, expected] of cases) {
    const h = scenario(ids), u = h.unit(MORTIS);
    assert.equal(getFeverMax(h.b, u), expected, ids.join(','));
    addFever(h.b, u, 1000);
    assert.equal(getFever(h.b, u), expected);
    assert.equal(feverState(h.b, u).max, expected);
    clean(h);
  }
});

for (const [ids, max] of [[CARDS.slice(0, 2), 225], [CARDS, 50]]) {
  test(`${ids.length}-card synergy triggers exactly at ${max}, keeps Fever for 20 seconds and blocks gain during Fever`, () => {
    const below = scenario(ids), before = below.unit(MORTIS);
    addFever(below.b, before, max - 1);
    assert.equal(before.skill.activate('test', { free: true }), true);
    assert.equal(isFeverActive(below.b, before), false, 'one point below the threshold must not trigger');

    const h = scenario(ids), u = h.unit(MORTIS);
    addFever(h.b, u, max);
    assert.equal(isFeverActive(h.b, u), false, 'full meter still waits for a skill activation');
    assert.equal(u.skill.activate('test', { free: true }), true);
    assert.equal(isFeverActive(h.b, u), true);
    assert.equal(feverState(h.b, u).remaining, FEVER_DURATION);
    assert.equal(getFever(h.b, u), 0);
    addFever(h.b, u, 1000);
    assert.equal(getFever(h.b, u), 0);
    h.run(19);
    assert.equal(isFeverActive(h.b, u), true);
    h.run(1.1);
    assert.equal(isFeverActive(h.b, u), false);
    assert.equal(getFever(h.b, u), 0);
    addFever(h.b, u, 1000);
    assert.equal(getFever(h.b, u), max, 'the same cap applies to later cycles');
    clean(below); clean(h);
  });
}

test('Sakiko battle-start Fever uses the current card-bond cap, including below and above each boundary', () => {
  for (const [ids, max] of [[[], 450], [CARDS.slice(0, 2), 225], [CARDS, 50]]) {
    for (const layers of [max * 2 - 2, max * 2, max * 2 + 200]) {
      const h = scenario(ids, {
        units: [{ chessId: SAKIKO, row: 9, col: 4 }],
        bonds: { mujicaShip: { active: false, count: 1, tier: 0, layers } },
      });
      const u = h.unit(SAKIKO);
      assert.equal(getFever(h.b, u), Math.min(layers / 2, max));
      assert.equal(isFeverActive(h.b, u), false, 'battle-start gain does not cast a skill itself');
      clean(h);
    }
  }
});

test('shared fields isolate card counts, Fever caps and skill-triggered Fever by owner', () => {
  const cardSets = [CARDS, CARDS.slice(0, 2), [CARDS[2]]];
  const h = scenario([], {
    modeId: 'mode_multi_zhajing',
    players: cardSets.map((ids, i) => ({
      playerId: `p${i + 1}`, seat: i, side: 'L', playerEffects: effects(ids),
      units: [{ uid: i + 1, chessId: MORTIS, row: 9, col: 4 + i }],
    })),
  });
  const units = [1, 2, 3].map((uid) => h.unit(uid));
  for (const [i, u] of units.entries()) {
    const max = [50, 225, 450][i];
    assert.equal(getFeverMax(h.b, u), max);
    addFever(h.b, u, 1000);
    assert.equal(getFever(h.b, u), max);
  }
  units[0].skill.activate('test', { free: true });
  assert.deepEqual(units.map((u) => isFeverActive(h.b, u)), [true, false, false]);
  assert.deepEqual(units.map((u) => getFever(h.b, u)), [0, 225, 450]);
  clean(h);

  const split = scenario([], {
    modeId: 'mode_multi_zhajing',
    players: [0, 1].map((i) => ({
      playerId: `p${i + 1}`, seat: i, side: 'L', playerEffects: effects([CARDS[i]]),
      units: [{ uid: i + 1, chessId: MORTIS, row: 9, col: 4 + i }],
    })),
  });
  assert.equal(getFeverMax(split.b, 'p1'), 450, 'teammate cards cannot complete a pair');
  assert.equal(getFeverMax(split.b, 'p2'), 450);
  clean(split);
});

test('ordinary modes retain 450 even if a snapshot contains all three new cards', () => {
  for (const modeId of ['mode_single_normal', 'mode_multi_normal']) {
    const h = scenario(CARDS, { modeId }), u = h.unit(MORTIS);
    assert.equal(getFeverMax(h.b, u), 450);
    addFever(h.b, u, 50);
    u.skill.activate('test', { free: true });
    assert.equal(isFeverActive(h.b, u), false);
    clean(h);
  }
});

test('Fever HUD events publish the owner-specific cap before, during and after Fever', () => {
  for (const [ids, max] of [[[], 450], [CARDS.slice(0, 2), 225], [CARDS, 50]]) {
    const h = scenario(ids), u = h.unit(MORTIS);
    addFever(h.b, u, max);
    h.run(0.3);
    const payloads = () => h.eventsOf('fx').filter((e) => e[1] === 'mujicaFever').map((e) => e[4]);
    assert.ok(payloads().some((s) => !s.active && s.value === max && s.max === max));
    u.skill.activate('test', { free: true });
    assert.ok(payloads().some((s) => s.active && s.value === 0 && s.max === max && s.remaining === 20));
    h.run(20.1);
    assert.equal(payloads().at(-1).active, false);
    assert.ok(payloads().every((s) => s.playerId === u.ownerId && s.max === max));
    clean(h);
  }
});

test('production content honors the serialized battle snapshot used by the local client simulator', () => {
  const player = {
    playerId: 'p1', seat: 0, side: 'L', playerEffects: effects(CARDS),
    units: [{ uid: 1, chessId: SAKIKO, row: 9, col: 4 }],
    bonds: { mujicaShip: { active: false, count: 1, tier: 0, layers: 1500 } },
  };
  const server = scenario([], { content: 'full', kits: {}, extraContent: [], players: [player] });
  const local = scenario([], { content: 'full', kits: {}, extraContent: [], players: JSON.parse(JSON.stringify([player])) });
  for (const h of [server, local]) {
    const u = h.unit(SAKIKO);
    assert.equal(getFever(h.b, u), 50);
    assert.equal(u.skill.activate('test', { free: true }), true);
    assert.equal(isFeverActive(h.b, u), true);
    h.run(1);
    clean(h);
  }
  const payloads = (h) => h.eventsOf('fx').filter((e) => e[1] === 'mujicaFever');
  assert.deepEqual(payloads(local), payloads(server));
});
