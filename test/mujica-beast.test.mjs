import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';
import { getData } from '../server/data.js';
import * as mujicaBond from '../server/sim/content/mujicaBond.js';
import * as S from '../server/sim/content/support/index.js';
import { MORTIS_BEAST_CARD, MORTIS_BEAST_TRAIT } from '../shared/mujicaJibian.js';
import { mujicaGarrisonsForMatch } from '../public/js/ui/gameLogic/mujicaTraits.js';

const NORMAL = 'chess_zj_mortis_a';
const ELITE = 'chess_zj_mortis_b';
const SHIFTER = 'chess_item_6_09_e_a';
const YAN_KNIFE = 'chess_item_3_04_e_a';
const ref = { key: `jibian:${MORTIS_BEAST_CARD}` };
const bond = (layers, active = true) => ({ active, layers, count: active ? 2 : 1, tier: active ? 1 : 0 });
const near = (got, expected, label) => assert.ok(Math.abs(got - expected) < 1e-5, `${label}: ${got} != ${expected}`);
const clean = (h) => assert.deepEqual(h.b.errors, []);

function scenario({ picked = true, elite = false, items = [], bonds = {}, ...opts } = {}) {
  const h = makeBattle({
    modeId: 'mode_single_zhajing', content: 'generic', extraContent: [mujicaBond], autoFinish: false,
    captureNoisy: true,
    kits: Object.fromEntries([NORMAL, ELITE].map(id => [id, () => ({ trait: { noAttack: true }, skill: { kind: 'duration', duration: 1 } })])),
    units: [{ chessId: elite ? ELITE : NORMAL, row: 9, col: 4, items }],
    bonds: { mujicaShip: bond(3), soloShip: bond(3), ...bonds },
    playerEffects: picked ? [ref] : [],
    enemies: [{ key: 'beast_dummy', route: { start: [1, 1], end: [1, 1], checkpoints: [], motion: 'WALK' } }],
    defs: { enemies: { beast_dummy: enemyRec({ key: 'beast_dummy', hp: 1e8, atk: 0, def: 0, res: 0, speed: 0 }) } },
    ...opts,
  });
  h.step();
  clean(h);
  return h;
}

function hit(h, u = h.allies()[0], e = h.enemies()[0], isAttack = true) {
  const gauge = e.elem.apoptosis, hp = e.hp, start = h.hooksOf('damaged').length;
  h.b.dealDamage(u, e, { amount: 1, type: 'phys', isAttack, canDodge: false });
  const riders = h.hooksOf('damaged').slice(start).filter(c => c.dmg.tags.includes('gar:mujica:mortis'));
  return { gauge: e.elem.apoptosis - gauge, hp: hp - e.hp, riders };
}

test('without Multiheaded Beast the original stored-layer trait remains unchanged, including inactive bonds', () => {
  const h = scenario({ picked: false, items: [SHIFTER, YAN_KNIFE], bonds: {
    mujicaShip: bond(3, false), soloShip: bond(6, false), yanShip: bond(300), swiftShip: bond(300),
  } });
  // 2026-10-24：基础特质只算【颂乐人偶】层数（3 层 → 1 档），不再叠加独行/不屈
  const u = h.allies()[0], e = h.enemies()[0], expected = u.s.atk * 0.02;
  assert.ok(S.unitBonds(u).includes('yanShip'), 'the equipment really grants an extra own bond');
  near(hit(h).gauge, expected, 'original trait counts only the two original stored-layer totals');
  h.b.addBuff(e, { key: 'apoptosisBurst', duration: 10, flags: { burstLock: true } });
  near(hit(h).hp, 1 + expected, 'the original burst rider still has the same coefficient');
  clean(h);
});

test('Multiheaded Beast counts every active bond of the player, for both normal and elite Mortis', () => {
  for (const elite of [false, true]) {
    const h = scenario({ elite, items: [SHIFTER, YAN_KNIFE], bonds: {
      mujicaShip: bond(3), soloShip: bond(300, false), yanShip: bond(6), swiftShip: bond(30),
    } });
    const u = h.allies()[0], e = h.enemies()[0];
    // 2026-10-23：层数口径改为「玩家所有已激活盟约」= mujica 3 + yan 6 + swift 300 = 309 层
    const expected = u.s.atk * (Math.floor((3 + 6 + 30) / 3) * 0.02);   // mujica 3 + yan 6 + swift 30
    assert.ok(S.unitBonds(u).includes('yanShip'));
    assert.ok(!S.unitBonds(u).includes('swiftShip'));
    const beforeBurst = hit(h);
    near(beforeBurst.gauge, expected, '3 active Mujica + 6 equipment-granted Yan layers');
    near(beforeBurst.hp, 1, 'before a burst only the ordinary hit removes HP');
    assert.equal(beforeBurst.riders.length, 1, 'one gauge rider, without recursively treating it as an attack');
    h.b.addBuff(e, { key: 'apoptosisBurst', duration: 10, flags: { burstLock: true } });
    const duringBurst = hit(h);
    near(duringBurst.hp, 1 + expected, 'burst HP rider uses the same active own-layer total');
    near(duringBurst.gauge, 0, 'an active elemental burst locks further gauge accumulation');
    assert.deepEqual(duringBurst.riders.map(c => c.dmg.type), ['elemental']);
    const nonAttack = hit(h, u, e, false);
    near(nonAttack.hp, 1, 'skill or other non-attack damage does not trigger the trait');
    assert.equal(nonAttack.riders.length, 0);
    clean(h);
  }
});

test('current layer gains, active state changes and equipment removal are reflected on the next attack', () => {
  const h = scenario({ items: [SHIFTER, YAN_KNIFE], bonds: {
    mujicaShip: bond(3), soloShip: bond(300, false), yanShip: bond(3),
  } });
  const u = h.allies()[0], ps = h.b.players[0];
  const expect = (multiplier, label) => near(hit(h).gauge, u.s.atk * multiplier, label);
  expect(0.04, 'initial two active own bonds');
  S.gainLayers(h.b, { playerId: u.ownerId, bonds: 'mujicaShip', n: 3, source: u, reason: 'test' });
  expect(0.06, 'a real in-battle layer gain is visible immediately');
  ps.bonds.yanShip.active = false;
  expect(0.04, 'inactive equipment-granted bond stops contributing');
  ps.bonds.mujicaShip.active = false;
  expect(0, 'all owned bonds inactive gives no rider');
  ps.bonds.yanShip.active = true;
  expect(0.02, 'reactivated own bond begins contributing');
  u.items = [];
  expect(0.02, 'player-level bonds keep counting after the item is removed');
  clean(h);
});

test('the attack that starts a necrosis burst does not retroactively receive the burst-only HP rider', () => {
  const h = scenario(), u = h.allies()[0], e = h.enemies()[0];
  const expected = u.s.atk * 0.04;
  e.elem.apoptosis = e.gaugeMax - expected / 2;
  const triggering = hit(h);
  assert.ok(e.findBuff('apoptosisBurst'), 'the actual gauge system starts the burst');
  near(triggering.hp, 1, 'no bonus HP damage on the burst-triggering hit');
  assert.deepEqual(triggering.riders.map(c => c.dmg.type), ['element']);
  const subsequent = hit(h);
  near(subsequent.hp, 1 + expected, 'the next hit receives the bonus HP damage');
  assert.deepEqual(subsequent.riders.map(c => c.dmg.type), ['elemental']);
  clean(h);
});

test('Multiheaded Beast is owner-scoped and does not install the custom trait outside ZHAJING', () => {
  const h = scenario({ modeId: 'mode_multi_zhajing', players: [0, 1].map(i => ({
    playerId: `p${i + 1}`, seat: i, side: 'L', playerEffects: i === 0 ? [ref] : [],
    units: [{ uid: i + 1, chessId: NORMAL, row: 9, col: 4 + i, items: [SHIFTER, YAN_KNIFE] }],
    bonds: { mujicaShip: bond(3), soloShip: bond(6, false), yanShip: bond(9) },
  })) });
  const first = h.unit(1), second = h.unit(2);
  near(hit(h, first).gauge, first.s.atk * 0.08, 'card owner gets only active own bonds');
  near(hit(h, second).gauge, second.s.atk * 0.02, 'other player keeps the original stored-layer trait（只算颂乐人偶 3 层）');
  clean(h);
  const ordinary = scenario({ modeId: 'mode_single_normal' });
  near(hit(ordinary).gauge, 0, 'ordinary mode does not install this ZHAJING custom trait');
  clean(ordinary);
});

const baseGarrisons = Object.freeze(['garrison_mujica_mortis', 'garrison_mujica_oblvns'].map(id => Object.freeze(getData().garrisons[id])));
const beforeGarrisons = JSON.stringify(baseGarrisons);
const changed = (garrisons) => garrisons[0].desc === MORTIS_BEAST_TRAIT && garrisons[0].descRaw === MORTIS_BEAST_TRAIT;

test('private trait UI overrides only the card owner and never mutates the base trait data', () => {
  const match = { public: { modeId: 'mode_single_zhajing' }, private: { playerId: 'p1', effects: [{ id: `${MORTIS_BEAST_CARD}#2` }] } };
  const view = mujicaGarrisonsForMatch(baseGarrisons, match);
  assert.equal(changed(view), true);
  assert.notEqual(view[0], baseGarrisons[0]);
  assert.equal(view[1], baseGarrisons[1], 'unrelated traits retain their original record');
  assert.equal(mujicaGarrisonsForMatch(baseGarrisons, match, 'p2'), baseGarrisons);
  assert.equal(mujicaGarrisonsForMatch(baseGarrisons, { ...match, public: { modeId: 'mode_single_normal' } }), baseGarrisons);
  assert.equal(JSON.stringify(baseGarrisons), beforeGarrisons);
  assert.notEqual(getData().garrisons.garrison_mujica_mortis.desc, MORTIS_BEAST_TRAIT);
});

test('scout trait UI uses the watched player card view and does not borrow the viewer card', () => {
  const match = {
    public: { difficulty: 'ZHAJING' }, private: { playerId: 'viewer', effects: [] },
    field: { fieldId: 'n:p2', effects: [{ data: { effectId: MORTIS_BEAST_CARD } }] },
  };
  assert.equal(changed(mujicaGarrisonsForMatch(baseGarrisons, match, 'p2')), true);
  assert.equal(mujicaGarrisonsForMatch(baseGarrisons, match, 'viewer'), baseGarrisons);
  assert.equal(mujicaGarrisonsForMatch(baseGarrisons, match, 'p3'), baseGarrisons);
  const inverse = { ...match, private: { playerId: 'viewer', effects: [ref] }, field: { fieldId: 'n:p2', effects: [] } };
  assert.equal(mujicaGarrisonsForMatch(baseGarrisons, inverse, 'p2'), baseGarrisons);
  assert.equal(changed(mujicaGarrisonsForMatch(baseGarrisons, inverse, 'viewer')), true);
});

test('shared-field trait UI reads each owner effects separately, even when the merged field view includes the card', () => {
  const match = {
    public: { modeId: 'mode_multi_zhajing' }, private: { playerId: 'viewer', effects: [] },
    field: {
      fieldId: 'u:1', players: ['p1', 'p2'], effects: [ref],
      effectsByPlayer: { p1: [ref], p2: [] },
    },
  };
  assert.equal(changed(mujicaGarrisonsForMatch(baseGarrisons, match, 'p1')), true);
  assert.equal(mujicaGarrisonsForMatch(baseGarrisons, match, 'p2'), baseGarrisons);
  assert.equal(mujicaGarrisonsForMatch(baseGarrisons, match, 'viewer'), baseGarrisons);
  const legacyMerged = { ...match, field: { fieldId: 'u:1', players: ['p1', 'p2'], effects: [ref] } };
  assert.equal(mujicaGarrisonsForMatch(baseGarrisons, legacyMerged, 'p2'), baseGarrisons, 'a merged view cannot identify the owner');
  assert.equal(JSON.stringify(baseGarrisons), beforeGarrisons);
});
