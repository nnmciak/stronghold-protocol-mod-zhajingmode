// 惊变「缩小引擎」改版：击杀 +1 层：体型 -4%、技力恢复 +0.05/s，无限叠加；阵亡损失 65% 层数。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const CARD = 'jibian_suoxiaoyinqing';

test('数据：两套池 + 新文案', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
  for (const mid of ['mode_single_zhajing', 'mode_multi_zhajing']) {
    const c = cfg.modes[mid].jibian.pool.find((x) => x.effectId === CARD);
    assert.ok(c, `${mid} 缺缩小引擎`);
    assert.match(c.desc, /4%/);
    assert.match(c.desc, /0\.05\/s/);
    assert.match(c.desc, /65%/);
    assert.match(c.desc, /无限叠加/);
  }
});

const setup = (effects = [CARD]) => {
  const h = makeBattle({
    modeId: 'mode_single_zhajing',
    units: [{ chessId: 'chess_char_5_02_a', row: 9, col: 4 }],
    enemies: [{ key: 'mob', time: 0, route: { start: [9, 5], end: [9, 5], checkpoints: [], motion: 'WALK' } }],
    defs: { enemies: { mob: enemyRec({ key: 'mob', hp: 1e9, atk: 0, def: 0, res: 0, speed: 0 }) } },
    playerEffects: effects.map((key) => ({ key: `jibian:${key}` })),
    autoFinish: false, timeLimit: 8,
  });
  h.step(1);
  const u = h.b.allyUnits.find((x) => x.kind === 'op');
  const victim = { side: 'enemy', alive: true, s: {}, def: { key: 'mob' }, mem: { ab: null }, id: 'v1', uid: 'v1' };
  return { h, u, victim };
};

test('击杀叠层：体型 -4% / 技力恢复 +0.05；阵亡损失 65%', () => {
  const { h, u, victim } = setup();
  const sp0 = u.s.spRecovery || 0;
  assert.equal(u.visualScale ?? 1, 1);
  h.b.emit('kill', { killer: u, victim });
  assert.ok(Math.abs(u.visualScale - 0.96) < 1e-9, `1 层体型应是 0.96，实际 ${u.visualScale}`);
  assert.ok(Math.abs((u.s.spRecovery || 0) - sp0 - 0.05) < 1e-6, '1 层技力恢复 +0.05');
  h.b.emit('kill', { killer: u, victim });
  assert.ok(Math.abs(u.visualScale - 0.92) < 1e-9, '2 层体型 0.92');
  assert.ok(Math.abs((u.s.spRecovery || 0) - sp0 - 0.10) < 1e-6, '2 层技力恢复 +0.10');
  console.log('2 层:', u.visualScale.toFixed(2), '| 技力恢复:', u.s.spRecovery.toFixed(3));

  h.b.emit('death', { unit: u });
  assert.ok(Math.abs((u.visualScale ?? 1) - 1) < 1e-9, '2 层阵亡 → 0 层，体型回 1');
  assert.ok(Math.abs((u.s.spRecovery || 0) - sp0) < 1e-6, '2 层阵亡 → 技力恢复回基础');

  for (let i = 0; i < 3; i++) h.b.emit('kill', { killer: u, victim });
  h.b.emit('death', { unit: u });
  assert.ok(Math.abs(u.visualScale - 0.96) < 1e-9, '3 层阵亡 → 留 1 层（0.96）');
  assert.equal(h.b.errors.length, 0);
});

test('体型下限 0.8：叠到第 6 层也不再变小', () => {
  const { h, u, victim } = setup();
  for (let i = 0; i < 10; i++) h.b.emit('kill', { killer: u, victim });
  console.log('10 层体型:', u.visualScale.toFixed(3));
  assert.equal(u.visualScale, 0.8, '最小体型应为 0.8');
  assert.ok(u.s.spRecovery > 1.4, '技力恢复仍继续叠加');
});

test('与坦克引擎共存：体型乘区相加（+5% −4% = +1%）', () => {
  const { h, u, victim } = setup([CARD, 'jibian_tankeyinqing']);
  h.b.emit('kill', { killer: u, victim });
  assert.ok(Math.abs(u.visualScale - 1.01) < 1e-9, `应为 1.01，实际 ${u.visualScale}`);
});