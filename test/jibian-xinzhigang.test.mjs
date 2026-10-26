// 惊变「心之钢」（jibian_xinzhigang，传说）：攻击附加 700(+3%最大生命) 物理伤害，并永久 +10% 该伤害的最大生命
//   （每目标 30s 冷却）；每 10000 最大生命 +3% 体型（最多 +30%，纯视觉）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';
import { heartsteelScale } from '../server/sim/content/jibian.js';

const CARD = 'jibian_xinzhigang';

test('数据：两套池 + 传说 + 文案 + 图标', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
  for (const mid of ['mode_single_zhajing', 'mode_multi_zhajing']) {
    const c = cfg.modes[mid].jibian.pool.find((x) => x.effectId === CARD);
    assert.ok(c, `${mid} 缺心之钢`);
    assert.equal(c.name, '心之钢');
    assert.equal(c.rarity, 'legend');
    assert.match(c.desc, /700/);
    assert.match(c.desc, /3%/);
    assert.match(c.desc, /30 秒/);
    assert.match(c.desc, /10000/);
    assert.equal(c.flavor, undefined);
  }
  const assets = JSON.parse(fs.readFileSync(new URL('../data/assets.json', import.meta.url), 'utf8'));
  assert.equal(assets.items[CARD], '/assets/local/items/jibian/jibian_xinzhigang.png');
  assert.ok(fs.existsSync(new URL('../public/assets/local/items/jibian/jibian_xinzhigang.png', import.meta.url)));
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
  const e = h.b.units.find((x) => x.side === 'enemy' && x.alive);
  return { h, u, e };
};

test('攻击附加 700+3%最大生命，并按 10% 增长永久最大生命；30s 内同目标只触发一次', () => {
  const { h, u, e } = setup([CARD]);
  assert.ok(u && e, '测试单位存在');
  const hp0 = h.b.allyUnits.find((x) => x.id === u.id).s.maxHp;
  const amount = 700 + hp0 * 0.03;
  const ehp0 = e.hp;
  h.b.emit('hit', { dmg: { tags: [] }, source: u, target: e });
  const dealt = ehp0 - e.hp;
  console.log('最大生命:', hp0, '| 附加伤害:', amount.toFixed(1), '| 实际掉血:', dealt.toFixed(1), '| 新最大生命:', u.s.maxHp.toFixed(1));
  assert.ok(dealt > amount * 0.9, `应造成约 ${amount.toFixed(0)} 伤害，实际 ${dealt.toFixed(1)}`);
  assert.ok(u.s.maxHp > hp0 + amount * 0.1 * 0.9, '最大生命应永久增长约 10% 伤害');
  const ehp1 = e.hp;
  h.b.emit('hit', { dmg: { tags: [] }, source: u, target: e });
  assert.equal(e.hp, ehp1, '30s 冷却内同目标不再触发');
  assert.equal(h.b.errors.length, 0);
});
test('体型：每 10000 最大生命 +3%，上限 +30%', () => {
  assert.equal(heartsteelScale(0), 1);
  assert.equal(heartsteelScale(9999), 1);
  assert.equal(heartsteelScale(10000), 1.03);
  assert.equal(heartsteelScale(25000), 1.06);
  assert.equal(heartsteelScale(330000), 1.3, '封顶 +30%');
});
