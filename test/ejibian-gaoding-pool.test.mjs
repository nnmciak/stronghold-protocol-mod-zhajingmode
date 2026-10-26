// 敌方隐秘惊变「搞定他们的头儿」：Boss 共享血池必须 −50%，否则结算仍显示原血量。
import test from 'node:test';
import assert from 'node:assert/strict';
import { bossPoolHp } from '../server/match/finalAssault.js';

const gd = {
  difficulty: 'ZHAJING', isSolo: true, mode: {}, config: {},
  boss: () => ({ bloodPoint: { ZHAJING: 100000 } }),
  bossHpMul: () => 1,
  bossPoolHpMul: 1,
  bossPoolShare: () => 1,
};

test('搞定他们的头儿：共享血池 −50%（普通分支）', () => {
  assert.equal(bossPoolHp(gd, 'boss_x', 1), 100000);
  assert.equal(bossPoolHp(gd, 'boss_x', 1, { enemyJibian: ['ejibian_gaodingtouer'] }), 50000);
  assert.equal(bossPoolHp(gd, 'boss_x', 1, { enemyJibian: ['ejibian_other'] }), 100000);
});

test('搞定他们的头儿：共享血池 −50%（炸惊阶梯分支）', () => {
  const ladder = { ...gd, mode: { bossHpScale: { baseHp: 10000, ladder: { perExtra: 1, after4: 1, doubleAfter10: false } } } };
  const base = bossPoolHp(ladder, 'boss_x', 1);
  const half = bossPoolHp(ladder, 'boss_x', 1, { enemyJibian: ['ejibian_gaodingtouer'] });
  assert.ok(base > 0);
  assert.equal(half, Math.max(1, Math.round(base * 0.5)));
});