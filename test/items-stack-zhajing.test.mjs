// 装备叠加（同系列共格）只应存在于炸惊；普通模式必须回到「每格一件、最多 equipPerChess 件」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerItems } from '../server/match/player/items.js';

const fake = (zhajing, morphEquipSlot = false) => {
  const o = Object.create(PlayerItems.prototype);
  o.gd = { zhajing, morphEquipSlot, item: (id) => ({ id, stackMax: 20, stackGroup: 'vickiHammer' }) };
  return o;
};

test('普通模式：不叠加，3 把同系列锤算 3 格', () => {
  const it = fake(false);
  assert.equal(it._stackMaxOf(it.gd.item('h')), 0);
  const slots = it._normalSlots({ items: [{ id: 'h' }, { id: 'h' }, { id: 'h' }] });
  assert.equal(slots.length, 3, '普通模式不能把同系列锤压进一格');
});

test('炸惊模式：保持叠加，同系列只算一格', () => {
  const it = fake(true);
  assert.equal(it._stackMaxOf(it.gd.item('h')), 20);
  const slots = it._normalSlots({ items: [{ id: 'h' }, { id: 'h' }, { id: 'h' }] });
  assert.equal(slots.length, 1, '炸惊仍允许同系列压一格');
});