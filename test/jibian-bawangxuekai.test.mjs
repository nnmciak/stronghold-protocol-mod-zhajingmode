// 惊变「霸王血铠」（jibian_bawangxuekai，稀有）：我方干员获得相当于自身生命值 20% 的额外攻击力。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const CARD = 'jibian_bawangxuekai';

test('数据：两套池 + 稀有度 + 文案 + 图标', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
  for (const mid of ['mode_single_zhajing', 'mode_multi_zhajing']) {
    const c = cfg.modes[mid].jibian.pool.find((x) => x.effectId === CARD);
    assert.ok(c, `${mid} 缺霸王血铠`);
    assert.equal(c.name, '霸王血铠');
    assert.equal(c.rarity, 'rare');
    assert.match(c.desc, /生命值 20%/);
    assert.equal(c.flavor, undefined, '不需要小字');
  }
  const assets = JSON.parse(fs.readFileSync(new URL('../data/assets.json', import.meta.url), 'utf8'));
  assert.equal(assets.items[CARD], '/assets/local/items/jibian/jibian_bawangxuekai.png');
  assert.ok(fs.existsSync(new URL('../public/assets/local/items/jibian/jibian_bawangxuekai.png', import.meta.url)));
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
  return { h, u: h.b.allyUnits.find((x) => x.kind === 'op') };
};

test('攻击力 = 原攻击力 + 20% 自身最大生命', () => {
  const plain = setup([]);
  const card = setup([CARD]);
  const expect = plain.u.s.atk + Math.floor(card.u.s.maxHp * 0.2);
  console.log('基础 atk:', plain.u.s.atk, '| maxHp:', card.u.s.maxHp, '| 有卡 atk:', card.u.s.atk, '| 期望:', expect);
  assert.equal(card.u.s.atk, expect, '应加 20% 最大生命的固定攻击力');
  assert.equal(card.h.b.errors.length, 0);
});