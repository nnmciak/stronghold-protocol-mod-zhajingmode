// 惊变「星界躯体」改版：我方每个干员生命值 +150%（不再只给生命最高的那一个）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const CARD = 'jibian_xingjieshenti';

test('数据：两套池 + 文案', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
  for (const mid of ['mode_single_zhajing', 'mode_multi_zhajing']) {
    const c = cfg.modes[mid].jibian.pool.find((x) => x.effectId === CARD);
    assert.ok(c, `${mid} 缺星界躯体`);
    assert.match(c.desc, /每个干员/);
    assert.match(c.desc, /150%/);
  }
});

const setup = (effects) => {
  const h = makeBattle({
    modeId: 'mode_single_zhajing',
    units: [
      { chessId: 'chess_char_5_02_a', row: 9, col: 4 },
      { chessId: 'chess_char_1_01_a', row: 9, col: 3 },
    ],
    enemies: [{ key: 'mob', time: 0, route: { start: [9, 5], end: [9, 5], checkpoints: [], motion: 'WALK' } }],
    defs: { enemies: { mob: enemyRec({ key: 'mob', hp: 1e9, atk: 0, def: 0, res: 0, speed: 0 }) } },
    playerEffects: effects.map((key) => ({ key: `jibian:${key}` })),
    autoFinish: false, timeLimit: 8,
  });
  h.step(1);
  return h.b.allyUnits.filter((x) => x.kind === 'op').sort((a, b) => String(a.defId).localeCompare(String(b.defId)));
};

test('我方每个干员都 +150% 生命', () => {
  const plain = setup([]);
  const card = setup([CARD]);
  assert.equal(card.length, plain.length, '场上干员数一致');
  for (let i = 0; i < card.length; i++) {
    const base = plain[i].s.maxHp;
    const got = card[i].s.maxHp;
    console.log(`${plain[i].defId}: ${base.toFixed(0)} → ${got.toFixed(0)}`);
    assert.ok(Math.abs(got - base * 2.5) < 1e-6, `${plain[i].defId} 应 ×2.5（+150%），实际 ${got} / 基础 ${base}`);
  }
});