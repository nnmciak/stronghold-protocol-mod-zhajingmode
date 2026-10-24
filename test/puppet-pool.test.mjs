import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const BOSS = 'boss_pup';
const defs = { enemies: { [BOSS]: enemyRec({ key: BOSS, name: 'P', hp: 1e6, atk: 0, def: 100, res: 30, speed: 0, rank: 'BOSS' }) } };
const pool = { maxHp: 1e6, hp: 1e6, byPlayer: new Map() };
const h = makeBattle({
  modeId: 'mode_single_zhajing', autoFinish: false, timeLimit: 300, sharedBoss: pool,
  flags: { enemyJibian: ['ejibian_hidden_puppet'], bossKeys: ['enemy_1001_bigbo', 'enemy_1500_skulsr'] },
  units: [{ chessId: 'chess_char_1_01_a', row: 1, col: 1 }],
  enemies: [{ key: BOSS, time: 0, route: { motion: 'WALK', start: [9, 7], end: [9, 7], checkpoints: [] } }],
  defs,
});
h.step(2);
const old = h.enemies()[0];
// 真局里 boss 是 tag:'boss' 出来的（带血池）；harness 的 wave 不会，手动补上
old.tag = 'boss';
old.isBoss = true;
old.bossPool = pool;
old.base.maxHp = pool.maxHp;
old.markDirty();
old.hp = old.s.maxHp;

pool.hp = pool.maxHp * 0.01;
old.hp = old.s.maxHp * 0.01;
h.b.dealDamage(h.b.allyUnits[0], old, h.b.makeDamage({ amount: 1, type: 'phys', canDodge: false }));
h.step(30);
const nb = h.enemies()[0];
console.log('换后 | 新 boss:', nb && nb.defId, '| hp', nb && nb.hp.toFixed(0), '/', nb && nb.s.maxHp.toFixed(0),
  '| pool:', pool.hp.toFixed(0), '/', pool.maxHp, '| 继承血池?', !!(nb && nb.bossPool === pool));
assert.ok(nb && nb.defId !== BOSS);
assert.ok(pool.hp >= pool.maxHp * 0.99, '血池回满');
assert.ok(nb.hp >= nb.s.maxHp * 0.99, '新 boss 满血');
console.log('PASS');