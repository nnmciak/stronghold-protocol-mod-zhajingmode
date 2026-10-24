import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const BOSS = 'boss_pup';
const defs = { enemies: { [BOSS]: enemyRec({ key: BOSS, name: '傀儡测试BOSS', hp: 1e6, atk: 500, def: 100, res: 30, speed: 0, rank: 'BOSS' }) } };
const bossKeys = ['enemy_1001_bigbo', 'enemy_1050_lslime', 'enemy_1500_skulsr', 'enemy_1501_demonk'];

const h = makeBattle({
  modeId: 'mode_single_zhajing', autoFinish: false, timeLimit: 300,
  flags: { enemyJibian: ['ejibian_hidden_puppet'], bossKeys },
  units: [{ chessId: 'chess_char_1_01_a', row: 9, col: 6 }],
  enemies: [{ key: BOSS, time: 0, route: { motion: 'WALK', start: [9, 7], end: [9, 7], checkpoints: [] } }],
  defs,
});
h.step(2);
const u = h.unit('chess_char_1_01_a');
const old = h.enemies()[0];
console.log('原 boss:', old.defId, '| hp', old.hp.toFixed(0), '/', old.s.maxHp.toFixed(0), '| alive', old.alive);

old.hp = old.s.maxHp * 0.01;
h.b.dealDamage(u, old, h.b.makeDamage({ amount: 1, type: 'phys', canDodge: false }));
h.step(1);

const list = h.enemies();
const nb = list[0];
console.log('换 boss 后 | 场上敌人:', list.length, '| 新 boss:', nb && nb.defId, '| hp', nb && nb.hp.toFixed(0), '/', nb && nb.s.maxHp.toFixed(0));
console.log('旧 boss alive:', old.alive, '| 仍在列表:', list.includes(old), '| errors:', JSON.stringify(h.b.errors));
assert.equal(list.length, 1);
assert.ok(nb.defId !== BOSS, '应换成另一只 boss');
assert.ok(nb.hp >= nb.s.maxHp - 1, '新 boss 满血');
assert.equal(old.alive, false);

// 只发动一次
const cur = nb.defId;
nb.hp = nb.s.maxHp * 0.01;
h.b.dealDamage(u, nb, h.b.makeDamage({ amount: 1, type: 'phys', canDodge: false }));
h.step(1);
console.log('第二次触发后 | 敌人:', h.enemies().map((e) => e.defId).join(','));
assert.equal(h.enemies()[0].defId, cur, '只发动一次');
console.log('PASS');