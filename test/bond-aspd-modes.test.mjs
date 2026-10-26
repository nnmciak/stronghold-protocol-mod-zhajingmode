// 攻速平衡只改炸惊：基础记录保持原版，zj.bb 覆盖炸惊值。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { zjBondView } from '../shared/zjBonds.js';

const bonds = JSON.parse(fs.readFileSync(new URL('../data/bonds.json', import.meta.url), 'utf8'));
const zj = zjBondView(bonds, { merge: true });
const normal = zjBondView(bonds, { merge: false });

test('颂乐人偶 / 灵巧 / 叙拉古：普通模式保留原版系数', () => {
  assert.equal(normal.skillfulShip.bb.attack_speed_per_stack, 1);
  assert.equal(normal.siracusaShip.bb.attack_speed_per_stack, 0.8);
  assert.equal(normal.mujicaShip, undefined, '颂乐人偶是炸惊专属盟约（zjOnly）');
});

test('炸惊模式使用新系数', () => {
  assert.equal(zj.mujicaShip.bb.attack_speed_per_stack, 0.1);
  assert.equal(zj.skillfulShip.bb.attack_speed_per_stack, 0.5);
  assert.equal(zj.siracusaShip.bb.attack_speed_per_stack, 0.4);
});