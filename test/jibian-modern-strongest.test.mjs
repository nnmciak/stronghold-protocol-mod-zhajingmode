// 惊变羁绊「现代最强」：3 张（六眼/无瑕/轻拍背部）→ 技能免技力、攻击力 +1000%、攻速 +360、攻击距离 +2。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const CARDS = ['jibian_liuyan', 'jibian_wuxiaxian', 'jibian_qingpaibeibu'];

const setup = (effects) => {
  const h = makeBattle({
    modeId: 'mode_single_zhajing',
    units: [{ chessId: 'chess_char_5_02_a', row: 9, col: 4 }],
    enemies: [{ key: 'mob', time: 0, route: { start: [9, 5], end: [9, 5], checkpoints: [], motion: 'WALK' } }],
    defs: { enemies: { mob: enemyRec({ key: 'mob', hp: 1e9, atk: 0, def: 0, res: 0, speed: 0 }) } },
    playerEffects: effects.map((key) => ({ key: `jibian:${key}` })),
    autoFinish: false, timeLimit: 8,
  });
  h.step(1);
  return h.b.allyUnits.find((x) => x.kind === 'op');
};

test('现代最强：3 张触发，攻击/攻速/距离/技力全生效', () => {
  const plain = setup([]);
  const full = setup(CARDS);
  console.log('base atk', plain.s.atk, '->', full.s.atk, '| aspd', plain.s.aspd, '->', full.s.aspd, '| rangeExtend', full.s.rangeExtend, '| spCost', full.skill.spCost, '| spMul', full.skill.spCostMul);
  assert.ok(full.s.atk > plain.s.atk * 5, '攻击力应 +1000%');
  assert.ok(Math.abs((full.s.aspd - plain.s.aspd) - 360) < 1e-6, '攻速应 +360');
  assert.equal(full.s.rangeExtend, 2, '攻击距离应 +2');
  assert.equal(full.skill.spCostMul, 0, '技力消耗倍率应为 0');
  assert.ok(full.skill.spCost <= 1, '技力消耗应降到最低');
});

test('现代最强：技能结束返还 1 点技力', () => {
  const u = setup(CARDS);
  const sk = u.skill;
  sk.sp = 0;
  sk.charges = 0;
  sk.active = false;
  sk.battle.emit('skillEnd', { unit: u, skill: sk, reason: 'test' });
  console.log('返还后 sp', sk.sp, 'charges', sk.charges);
  assert.ok(sk.sp + sk.charges * sk.spCost >= 1, '技能结束应返还至少 1 点技力');
});