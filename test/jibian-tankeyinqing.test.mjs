// 惊变「坦克引擎」改版：我方干员获得特质「击杀 +1 层：体型 +5%、最大生命 +5%，无限叠加；阵亡损失 65% 层数」。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const CARD = 'jibian_tankeyinqing';

test('数据：两套池 + 新文案', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
  for (const mid of ['mode_single_zhajing', 'mode_multi_zhajing']) {
    const c = cfg.modes[mid].jibian.pool.find((x) => x.effectId === CARD);
    assert.ok(c, `${mid} 缺坦克引擎`);
    assert.match(c.desc, /5%/);
    assert.match(c.desc, /65%/);
    assert.match(c.desc, /无限叠加/);
    assert.equal(c.flavor, undefined, '不需要小字');
  }
});

const setup = () => {
  const h = makeBattle({
    modeId: 'mode_single_zhajing',
    units: [{ chessId: 'chess_char_5_02_a', row: 9, col: 4 }],
    enemies: [{ key: 'mob', time: 0, route: { start: [9, 5], end: [9, 5], checkpoints: [], motion: 'WALK' } }],
    defs: { enemies: { mob: enemyRec({ key: 'mob', hp: 1e9, atk: 0, def: 0, res: 0, speed: 0 }) } },
    playerEffects: [{ key: `jibian:${CARD}` }],
    autoFinish: false, timeLimit: 8,
  });
  h.step(1);
  const u = h.b.allyUnits.find((x) => x.kind === 'op');
  return { h, u, victim: { side: 'enemy', alive: true, s: {}, def: { key: 'mob' }, mem: { ab: null }, id: 'v1', uid: 'v1' } };
};

test('击杀 +1 层：+5% 最大生命 / +5% 体型；阵亡损失 65% 层数', () => {
  const { h, u, victim } = setup();
  const base = u.s.maxHp;
  assert.equal(u.visualScale ?? 1, 1);
  h.b.emit('kill', { killer: u, victim });
  assert.ok(Math.abs(u.s.maxHp - base * 1.05) < 1e-6, `1 层应 ×1.05（实际 ${u.s.maxHp}，基础 ${base}）`);
  assert.ok(Math.abs(u.visualScale - 1.05) < 1e-9, '体型 +5%');
  h.b.emit('kill', { killer: u, victim });
  assert.ok(Math.abs(u.s.maxHp - base * 1.10) < 1e-6, '2 层应 ×1.10');
  assert.ok(Math.abs(u.visualScale - 1.10) < 1e-9, '体型 +10%');
  console.log('2 层:', u.s.maxHp.toFixed(1), '| 体型:', u.visualScale.toFixed(2));

  h.b.emit('death', { unit: u });
  assert.ok(Math.abs(u.s.maxHp - base) < 1e-6, `2 层阵亡 → floor(2×0.35)=0 层（实际 ${u.s.maxHp}，基础 ${base}）`);
  assert.ok(Math.abs((u.visualScale ?? 1) - 1) < 1e-9, '体型回到 1');

  for (let i = 0; i < 3; i++) h.b.emit('kill', { killer: u, victim });
  assert.ok(Math.abs(u.s.maxHp - base * 1.15) < 1e-6, '3 层应 ×1.15');
  h.b.emit('death', { unit: u });
  assert.ok(Math.abs(u.s.maxHp - base * 1.05) < 1e-6, '3 层阵亡 → 留 1 层（×1.05）');
  assert.equal(h.b.errors.length, 0);
});

test('体型上限 3.25', () => {
  const { h, u, victim } = setup();
  for (let i = 0; i < 100; i++) h.b.emit('kill', { killer: u, victim });
  console.log('100 层体型:', u.visualScale);
  assert.equal(u.visualScale, 3.25, '最大体型应为 3.25');
});