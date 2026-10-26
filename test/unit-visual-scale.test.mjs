// 干员模型纯视觉缩放：服务端只透传 `scale`，不参与任何数值/判定。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';
import { unitInfo } from '../server/sim/snapshot.js';

const setup = () => makeBattle({
  modeId: 'mode_single_zhajing',
  units: [{ chessId: 'chess_char_5_02_a', row: 9, col: 4 }],
  enemies: [{ key: 'mob', time: 0, route: { start: [9, 5], end: [9, 5], checkpoints: [], motion: 'WALK' } }],
  defs: { enemies: { mob: enemyRec({ key: 'mob', hp: 1e9, atk: 0, def: 0, res: 0, speed: 0 }) } },
  autoFinish: false, timeLimit: 8,
});

test('默认不发 scale 键', () => {
  const h = setup(); h.step(1);
  const u = h.b.allyUnits.find((x) => x.kind === 'op');
  assert.equal(unitInfo(u).scale, undefined);
});

test('设置 visualScale 后透传（保留两位小数）', () => {
  const h = setup(); h.step(1);
  const u = h.b.allyUnits.find((x) => x.kind === 'op');
  const atk = u.s.atk, hp = u.s.maxHp;
  u.visualScale = 1.3;
  const info = unitInfo(u);
  assert.equal(info.scale, 1.3);
  assert.equal(u.s.atk, atk, '攻击力不变');
  assert.equal(u.s.maxHp, hp, '生命值不变');
  u.visualScale = 0.666;
  assert.equal(unitInfo(u).scale, 0.67);
  u.visualScale = 0;
  assert.equal(unitInfo(u).scale, undefined, '非法值不发送');
});