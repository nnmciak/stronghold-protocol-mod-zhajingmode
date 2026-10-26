import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';
import { getData } from '../server/data.js';
import { GameData } from '../server/match/gamedata.js';
import { Match } from '../server/match/Match.js';
import { MetaRegistry, getDefaultRegistry } from '../server/match/effectsMeta.js';
import * as mujicaBond from '../server/sim/content/mujicaBond.js';
import { getFever, FEVER_MAX } from '../server/sim/content/mujica.js';

const CODES = ['oblvns', 'mortis', 'dolris', 'amoris', 'tmoris'];
const ID = code => `chess_zj_${code}_a`;
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`);
const state = (count, layers = 0) => ({ active: count >= 2, count, tier: Math.max(0, count - 1), layers });

// Exercise the real battle event/stat/damage systems with inert skills so the
// operators' independent original talents do not obscure custom-rule assertions.
function battle(codes, { count = codes.length, layers = 0, extraBonds = {}, modeId = 'mode_single_zhajing', enemy = false } = {}) {
  const h = makeBattle({
    modeId, content: 'generic', extraContent: [mujicaBond], autoFinish: false, timeLimit: 120,
    kits: Object.fromEntries(CODES.map(code => [ID(code), () => ({ skill: { kind: 'duration', duration: 1 } })])),
    units: codes.map((code, i) => ({ chessId: ID(code), row: 9, col: 3 + i })),
    bonds: { mujicaShip: state(count, layers), ...extraBonds },
    ...(enemy ? {
      enemies: [{ key: 'mujica_dummy', time: 0, route: { start: [1,1], end: [1,1], checkpoints: [], motion: 'WALK' } }],
      defs: { enemies: { mujica_dummy: enemyRec({ key: 'mujica_dummy', hp: 1e8, atk: 0, def: 0, res: 0, speed: 0 }) } },
    } : {}),
  });
  h.step(1);
  assert.deepEqual(h.b.errors, []);
  return h;
}

function match(t) {
  const registry = new MetaRegistry();
  mujicaBond.registerMeta(registry);
  const m = new Match({
    roomCode: 'MUJI', mode: 'solo', difficulty: 'ZHAJING', modeId: 'mode_single_zhajing', seed: 3,
    data: getData(), registry, seats: [{ seat: 0, playerId: 'p1', name: 'test', isBot: false, connected: true }],
    send: () => true, broadcast: () => {}, onEnd: () => {},
  });
  t.after(() => m.dispose());
  m.phase = 'PREP'; m.round = 1;
  const ps = m.players.get('p1');
  ps.funds = 200;
  const cells = [...ps.deployMap()].filter(([, cls]) => cls === 'melee').map(([key]) => key);
  let index = 0;
  const put = (code, where = 'board') => {
    const id = code.startsWith('chess_') ? code : ID(code);
    const piece = ps.newPiece('chess', id);
    if (where === 'hand') ps.hand[ps.hand.findIndex(p => !p)] = piece;
    else ps.board.set(cells[index++], piece);
    ps.recompute();
    return piece;
  };
  return { m, ps, put };
}

test('Mujica roster and core bond remain outside ordinary mode; counts use distinct deployed operators', t => {
  const normal = new GameData(getData(), 'mode_single_normal');
  const zj = new GameData(getData(), 'mode_single_zhajing');
  for (const code of CODES) {
    assert.ok(zj.visibleChess.includes(ID(code)));
    assert.ok(!normal.visibleChess.includes(ID(code)));
  }
  assert.ok(!normal.bondIds.includes('mujicaShip'));
  const { ps, put } = match(t);
  for (let i = 0; i < CODES.length; i++) {
    put(CODES[i]);
    assert.equal(ps.bonds.mujicaShip.count, i + 1);
    assert.equal(ps.bonds.mujicaShip.active, i >= 1);
    assert.equal(ps.bonds.mujicaShip.tier, Math.max(0, i));
  }
  put('tmoris');
  assert.equal(ps.bonds.mujicaShip.count, 5, 'duplicates must not advance a threshold');
});

test('2/3/4/5 thresholds apply speed, cast layers, attack and Fever; growth follows current layers', () => {
  for (const count of [1,2,3,4,5]) {
    const h = battle(['tmoris'], { count, layers: 10 });
    const u = h.unit(ID('tmoris'));
    near(u.s.aspd, u.base.aspd + (count >= 2 ? 26 : 0), `${count}-member ASPD`);
    near(u.s.atk, u.base.atk * (count >= 4 ? 1.32 : 1), `${count}-member attack`);
    // 2026-10-26：叠层改为「每开启两次技能 +1 层」——第一次不加，第二次 +1
    h.b.emit('skillStart', { unit: u });
    assert.equal(h.b.players[0].bonds.mujicaShip.layers, 10, `${count}: 第一次施法不加层`);
    h.b.emit('skillStart', { unit: u });
    const expectLayers = count >= 3 ? 11 : 10;
    assert.equal(h.b.players[0].bonds.mujicaShip.layers, expectLayers, `${count}: 两次施法后层数`);
    assert.equal(getFever(h.b, u), count >= 5 ? 20 : 0);
    h.step(1);
    near(u.s.aspd, u.base.aspd + (count >= 2 ? 25 + 0.1 * expectLayers : 0), 'dynamic speed');
    if (count >= 4) near(u.s.atk, u.base.atk * (1.23 + 0.009 * expectLayers), 'dynamic attack');
    assert.deepEqual(h.b.errors, []);
  }
  const normal = battle(['tmoris'], { count: 5, layers: 10, modeId: 'mode_single_normal' });
  const u = normal.unit(ID('tmoris'));
  near(u.s.aspd, u.base.aspd, 'custom battle effect outside ZHAJING');
});

test('Sakiko start Fever is capped and every full three stored layers adds 2% attack', () => {
  for (const layers of [2,3,6,999]) {
    const h = battle(['oblvns'], { count: 2, layers });
    const u = h.unit(ID('oblvns'));
    near(getFever(h.b, u), Math.min(FEVER_MAX, layers / 2), 'battle-start Fever');
    near(u.s.atk, u.base.atk * (1 + Math.floor(layers / 3) * 0.02), 'Sakiko own trait');
  }
  const inactive = battle(['oblvns'], { count: 1, layers: 6 });
  const u = inactive.unit(ID('oblvns'));
  near(getFever(inactive.b, u), 3, 'stored layers grant Fever even below core activation');
  near(u.s.atk, u.base.atk * 1.04, 'stored layers grant own attack even below core activation');
  near(u.s.aspd, u.base.aspd, 'inactive core still grants no core attack speed');
});

test('each tenth real shop refresh gives a member no higher than the shop; count persists between rounds', t => {
  for (const shopLevel of [1,2,3,4,5,6]) {
    const { m, ps, put } = match(t);
    put('oblvns'); put('mortis');
    ps.shop.level = shopLevel;
    for (let i=0;i<9;i++) assert.equal(ps.refresh().ok,true);
    assert.equal(ps.allChess().length,2);
    m.round = 2;
    ps.shop.freeRefreshes = 1;
    assert.equal(ps.refresh().ok,true);
    // 2026-10-23：首次获得若麦会附带「谜の假面」赠礼，这里只数干员卡
    const rewards=ps.hand.filter(Boolean).filter((p) => !!ps.gd.chess(p.id));
    // 2026-10-23：八幡海铃升到 3 阶后，1 级商店已经抽不到任何颂乐人偶成员了。
    if (shopLevel < 2) { assert.equal(rewards.length,0); continue; }
    assert.equal(rewards.length,1);
    if (shopLevel === 2) assert.equal(rewards[0].id,ID('amoris'));
    assert.ok(ps.gd.chess(rewards[0].id).bonds.includes('mujicaShip'));
    assert.ok(ps.gd.chess(rewards[0].id).tier <= ps.shop.level);
    assert.equal(ps.counters['bond:mujica:refreshes'],0);
    assert.equal(m.dispatcher.errors,0);
  }
});

test('production content registry installs the core bond and prep traits without test-only registration', () => {
  const registry = getDefaultRegistry();
  for (const key of ['bond:mujicaShip','garrison:MUJICA_AMORIS','garrison:MUJICA_TMORIS']) assert.ok(registry.has(key), key);
  const h = makeBattle({
    modeId: 'mode_single_zhajing', content: 'full', autoFinish: false,
    units: [{ chessId:ID('tmoris'),row:9,col:4 },{ chessId:ID('mortis'),row:9,col:5 }],
    bonds:{mujicaShip:state(2,10)},
  });
  h.step(1);
  assert.ok(h.unit(ID('tmoris')).findBuff('bond:mujica'));
  assert.deepEqual(h.b.errors,[]);
});

test('Umiri refresh trait stops after five, ignores synthetic refreshes, and resets next round', t => {
  const {m,ps,put}=match(t);
  put('tmoris'); put('oblvns');
  const swift=Object.values(getData().chess).find(c=>c.zhajing&&!c.isGolden&&!c.isHidden&&c.bonds?.includes('swiftShip')&&!c.charId?.includes('tmoris'));
  put(swift.chessId);
  assert.ok(ps.bonds.swiftShip.active);
  m.dispatch(ps,'onRefresh',{trigger:true});
  assert.equal(ps.layers.mujicaShip||0,0);
  for(let i=0;i<7;i++)assert.equal(ps.refresh().ok,true);
  assert.equal(ps.layers.mujicaShip,10);
  assert.equal(ps.layers.swiftShip,10);
  m.round=2;
  assert.equal(ps.refresh().ok,true);
  assert.equal(ps.layers.mujicaShip,12);
  assert.equal(ps.layers.swiftShip,12);
  assert.equal(m.dispatcher.errors,0);
});

test('Nyamu bench income needs an active bond, pays next round, while deployed income does not', t => {
  const {m,ps,put}=match(t);
  const nyamu=put('amoris','hand');
  m.dispatch(ps,'onPrepEnd',{});
  assert.equal(ps.pendingFunds,0);
  put('oblvns'); put('mortis');
  m.dispatch(ps,'onPrepEnd',{});
  assert.equal(ps.pendingFunds,2);
  ps.funds=0;m.round=2;ps.startRound(2);
  assert.equal(ps.funds,ps.gd.income(2)+2);
  assert.equal(ps.pendingFunds,0);
  ps.board.clear();ps.hand.fill(null);
  const cell=[...ps.deployMap()].find(([,cls])=>cls==='melee')[0];
  ps.board.set(cell,nyamu);ps.recompute();
  assert.equal(ps.bonds.mujicaShip.active,false);
  m.dispatch(ps,'onPrepEnd',{});
  assert.equal(ps.pendingFunds,2);
  assert.equal(m.dispatcher.errors,0);
});

test('Nyamu no longer adds layers on deployment (the bonus moved to the prep end)', () => {
  const h=battle(['amoris'],{count:2,layers:5});
  assert.equal(h.b.players[0].bonds.mujicaShip.layers,5);
  assert.equal(h.b.errors.length,0);
});

test('Nyamu prep end grants funds and layers only on board or with the bond active', t => {
  // 在棋盘 + 颂乐人偶已激活：普通 2 资金 / +5 层
  const a = match(t);
  const pa = a.put('amoris');
  a.put('tmoris');
  a.ps.layers.mujicaShip = 4;
  a.m.dispatcher.dispatch(a.ps, 'onPrepEnd', { piece: pa, where: 'board', kind: 'garrison' });
  assert.equal(a.ps.layers.mujicaShip, 9);
  assert.equal(a.ps.pendingFunds, 2);

  // 精锐：4 资金 / +10 层（另开一局，精锐本体放在棋盘上）
  const c = match(t);
  const pc = c.put('chess_zj_amoris_b');
  c.put('tmoris');
  c.ps.layers.mujicaShip = 0;
  c.m.dispatcher.dispatch(c.ps, 'onPrepEnd', { piece: pc, where: 'board', kind: 'garrison' });
  assert.equal(c.ps.layers.mujicaShip, 10);
  assert.equal(c.ps.pendingFunds, 4);

  // 在整备区且【颂乐人偶】未激活：既不发钱也不加层
  const b = match(t);
  const pb = b.put('amoris', 'hand');
  b.ps.layers.mujicaShip = 4;
  b.m.dispatcher.dispatch(b.ps, 'onPrepEnd', { piece: pb, where: 'hand', kind: 'garrison' });
  assert.equal(b.ps.layers.mujicaShip, 4);
  assert.equal(b.ps.pendingFunds, 0);
});

test('Mutsumi attack rider adds apoptosis gauge, and adds elemental HP damage during burst', () => {
  const h=battle(['mortis'],{count:2,layers:6,enemy:true});
  const u=h.unit(ID('mortis')),e=h.enemies()[0];
  const amount=u.s.atk*0.04;
  h.b.dealDamage(u,e,{amount:1,type:'phys',isAttack:true,canDodge:false});
  near(e.elem.apoptosis,amount,'six total layers rider');
  const before=e.elem.apoptosis;
  h.b.dealDamage(u,e,{amount:1,type:'phys',isAttack:false,canDodge:false});
  near(e.elem.apoptosis,before,'non-attack damage must not recurse');
  h.b.addBuff(e,{key:'apoptosisBurst',duration:10,flags:{burstLock:true}});
  const hp=e.hp;
  h.b.dealDamage(u,e,{amount:1,type:'phys',isAttack:true,canDodge:false});
  near(hp-e.hp,1+amount,'burst elemental rider bypasses physical mitigation');
  assert.deepEqual(h.b.errors,[]);
  const inactive = battle(['mortis'], { count: 1, layers: 6, enemy: true });
  const single = inactive.unit(ID('mortis')), victim = inactive.enemies()[0];
  inactive.b.dealDamage(single, victim, { amount: 1, type: 'phys', isAttack: true, canDodge: false });
  near(victim.elem.apoptosis, single.s.atk * 0.04, 'stored layers on inactive bonds still scale Mutsumi trait');
});

test('Uika gains layers for actual healing, excluding passive regeneration and full-health targets', () => {
  const h=battle(['dolris','mortis'],{count:2,layers:5,extraBonds:{skillfulShip:{active:false,count:1,tier:0,layers:0},deputShip:{active:true,count:2,tier:1,layers:7}}});
  const u=h.unit(ID('dolris')),target=h.unit(ID('mortis')),bonds=h.b.players[0].bonds;
  target.hp=target.s.maxHp;
  assert.equal(h.b.heal(u,target,10),0);
  assert.equal(bonds.mujicaShip.layers,5);
  h.b.loseHp(target,100,{silent:true});
  assert.equal(h.b.heal(u,target,10,{regen:true}),10);
  assert.equal(bonds.mujicaShip.layers,5);
  assert.equal(h.b.heal(u,target,10),10);
  // 2026-10-24：普通初华每次治疗给【颂乐人偶】【助力】各 +2（不再是"所有盟约 +1"）
  assert.equal(bonds.mujicaShip.layers,7);
  assert.equal(bonds.deputShip.layers,9);
  assert.equal(bonds.skillfulShip.layers,0);
  assert.deepEqual(h.b.errors,[]);
});
