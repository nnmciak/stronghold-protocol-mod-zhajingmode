import assert from 'node:assert/strict';
import { makeBattle } from './helpers/battleHarness.js';

function run(unit, deputActive = true) {
  const h = makeBattle({
    modeId: 'mode_single_zhajing', autoFinish: false, timeLimit: 60,
    flags: { layerGainsEnabled: true },
    units: [
      { chessId: unit, row: 9, col: 3 },
      { chessId: 'chess_zj_03_a', row: 9, col: 4 },
      { chessId: 'chess_zj_09_a', row: 9, col: 5 },
    ],
    bonds: {
      mujicaShip: { active: true, count: 2, tier: 1, layers: 0 },
      deputShip: { active: deputActive, count: deputActive ? 2 : 0, tier: deputActive ? 1 : 0, layers: 0 },
    },
  });
  h.step(2);
  const src = h.unit(unit), tgt = h.unit('chess_zj_03_a');
  tgt.hp = tgt.s.maxHp * 0.4;                 // 目标掉血，治疗才会有实际治疗量
  const b = h.b.players[0].bonds;
  const before = { m: b.mujicaShip?.layers ?? 0, d: b.deputShip?.layers ?? 0 };
  h.b.heal(src, tgt, tgt.s.maxHp * 0.1);
  const after = { m: b.mujicaShip?.layers ?? 0, d: b.deputShip?.layers ?? 0 };
  return { before, after, healed: tgt.hp };
}

{
  const r = run('chess_zj_dolris_a');
  console.log('普通 初华 | 颂乐人偶', r.before.m, '→', r.after.m, '| 助力', r.before.d, '→', r.after.d);
  assert.equal(r.after.m - r.before.m, 2);
  assert.equal(r.after.d - r.before.d, 2);
}
{
  const r = run('chess_zj_dolris_b');
  console.log('精锐 初华 | 颂乐人偶', r.before.m, '→', r.after.m, '| 助力', r.before.d, '→', r.after.d);
  assert.equal(r.after.m - r.before.m, 4);
  assert.equal(r.after.d - r.before.d, 4);
}
{
  const r = run('chess_zj_dolris_a', false);
  console.log('普通 初华（助力未激活）| 颂乐人偶', r.before.m, '→', r.after.m, '| 助力', r.before.d, '→', r.after.d);
  assert.equal(r.after.m - r.before.m, 2);
  assert.equal(r.after.d - r.before.d, 0);
}
console.log('PASS');