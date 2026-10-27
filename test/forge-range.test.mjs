// 锻造器：攻击距离 +1 应在战斗内生效（rangeExtend），攻击力 +100 折进白值。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const run = (forge) => {
  const h = makeBattle({
    modeId: 'mode_single_zhajing',
    units: [{ chessId: 'chess_char_5_02_a', row: 9, col: 4 }],
    enemies: [{ key: 'dummy', time: 0, route: { start: [9, 5], end: [9, 5], checkpoints: [], motion: 'WALK' } }],
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e9, atk: 0, def: 0, res: 0, speed: 0 }) } },
    forge, autoFinish: false, timeLimit: 8,
  });
  h.step(1);
  return h.b.allyUnits.find((u) => u.kind === 'op');
};

test('锻造器攻击距离 +1 在战斗中生效', () => {
  const plain = run(null);
  const forged = run({ atk: 100, range: 1 });
  console.log('rangeExtend', plain.s.rangeExtend, '->', forged.s.rangeExtend, '| atk', plain.s.atk, '->', forged.s.atk);
  assert.equal(plain.s.rangeExtend, 0);
  assert.equal(forged.s.rangeExtend, 1, '锻造器 +1 距离应生效');
  assert.ok(forged.s.atk >= plain.s.atk + 100 - 1e-6, '锻造器 +100 攻击应生效');
});