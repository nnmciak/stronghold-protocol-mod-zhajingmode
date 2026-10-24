import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

// 2026-10-25（玩家反馈「触发了伤害转伤害但不是真伤」）
const CARD_A = 'jibian_wulizhuanmofa';
const CARD_B = 'jibian_mofazhuanwuli';

const run = (effects) => {
  const dmg = [];
  const h = makeBattle({
    modeId: 'mode_single_zhajing',
    units: [{ chessId: 'chess_char_5_02_a', row: 9, col: 4 }],
    enemies: [{ key: 'dummy', time: 0, route: { start: [9, 5], end: [9, 5], checkpoints: [], motion: 'WALK' } }],
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e9, atk: 0, def: 5000, res: 90, speed: 0 }) } },
    playerEffects: effects.map((key) => ({ key: `jibian:${key}` })),
    autoFinish: false, timeLimit: 8,
    setup: (b) => { b.on('damaged', (ctx) => { if (ctx && ctx.target && ctx.target.side === 'enemy') dmg.push({ type: ctx.type, amount: Math.round(ctx.amount) }); }); },
  });
  h.step(3);
  return { dmg, errors: h.b.errors };
};

test('高级资深干员现在是史诗（两套池）', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
  for (const mid of ['mode_single_zhajing', 'mode_multi_zhajing']) {
    const c = cfg.modes[mid].jibian.pool.find((x) => x.effectId === 'jibian_gaojizishen');
    assert.ok(c);
    assert.equal(c.rarity, 'epic');
  }
});

test('伤害转伤害：伤害类型变成 true，且不再被 5000 防御 / 90 法抗减免', () => {
  const plain = run([]);
  const bonded = run([CARD_A, CARD_B]);
  console.log('普通:', JSON.stringify(plain.dmg.slice(0, 3)), '| 羁绊:', JSON.stringify(bonded.dmg.slice(0, 3)));
  assert.equal(bonded.errors.length, 0);
  assert.ok(plain.dmg.length && bonded.dmg.length);
  assert.ok(plain.dmg[0].type === 'phys' || plain.dmg[0].type === 'arts', '未触发羁绊时应是普通物理/法术伤害');
  assert.equal(bonded.dmg[0].type, 'true', '羁绊触发后应是真实伤害');
  assert.ok(bonded.dmg[0].amount > plain.dmg[0].amount, '真伤应高于被 5000 防御压到 5% 保底的普攻');
});