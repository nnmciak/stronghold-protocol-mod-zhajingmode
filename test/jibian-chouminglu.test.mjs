import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';
import { bondHintsFor } from '../server/sim/content/jibianBonds.js';

// 2026-10-25（owner）：新惊变「仇名录」稀有：攻击力 +2%，每击倒一名敌人永久额外 +0.2%，属于「集成战略爱好者」
const CARD = 'jibian_chouminglu';

test('数据：两套池 + 稀有度 + 图标 + 羁绊成员', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
  for (const mid of ['mode_single_zhajing', 'mode_multi_zhajing']) {
    const c = cfg.modes[mid].jibian.pool.find((x) => x.effectId === CARD);
    assert.ok(c, `${mid} 缺仇名录`);
    assert.equal(c.name, '仇名录');
    assert.equal(c.rarity, 'rare');
    assert.match(c.desc, /攻击力\+2%/);
    assert.match(c.desc, /0\.2%/);
    assert.ok(c.flavor && c.flavor.includes('永远都差一个'));
  }
  const assets = JSON.parse(fs.readFileSync(new URL('../data/assets.json', import.meta.url), 'utf8'));
  assert.equal(assets.items[CARD], '/assets/local/items/jibian/jibian_chouminglu.png');
  assert.ok(fs.existsSync(new URL('../public/assets/local/items/jibian/jibian_chouminglu.png', import.meta.url)));
  const bonds = JSON.parse(fs.readFileSync(new URL('../data/jibianBonds.json', import.meta.url), 'utf8'));
  const fan = bonds.bonds.find((b) => b.id === 'roguelike_fan');
  assert.ok(fan.members.includes(CARD), '应属于集成战略爱好者');
  assert.ok(bondHintsFor(CARD, new Set([CARD, 'jibian_zhuiji', 'jibian_banteng'])).some((h) => h.name === '集成战略爱好者' && h.have === 3));
});

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
  const u = h.b.allyUnits.find((x) => x.kind === 'op');
  const victim = { side: 'enemy', alive: true, s: {}, def: { key: 'mob' } };
  return { h, u, victim };
};
const atkOf = (u) => u.s.atk;

test('攻击力 +2%；每击倒一名敌人再 +0.2%（永久）', () => {
  const plain = setup([]);
  const card = setup([CARD]);
  console.log('无卡:', atkOf(plain.u), '| 有卡:', atkOf(card.u));
  const base = atkOf(card.u) / atkOf(plain.u);
  assert.ok(Math.abs(base - 1.02) < 1e-9, `基础应是 ×1.02，实际 ×${base.toFixed(5)}`);
  assert.equal(card.h.b.errors.length, 0);

  for (let i = 0; i < 3; i++) card.h.b.emit('kill', { killer: card.u, victim: card.victim });
  const after = atkOf(card.u) / atkOf(plain.u);
  console.log('3 次击倒后:', atkOf(card.u), '| 相对无卡 ×' + after.toFixed(5));
  assert.ok(Math.abs(after - 1.026) < 1e-9, `+2% 基础 + 3×0.2% = ×1.026，实际 ×${after.toFixed(5)}`);
});