import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GameData } from '../server/match/gamedata.js';
import { getData } from '../server/data.js';
import { jibianDraftCards } from '../server/match/choices.js';
import { createRng } from '../server/sim/rng.js';

// 2026-10-25（owner）：我方惊变新增「隐秘」档（配色与敌方一致：青 #22e0d0 + 红 #ff4d6d）。
const HIDDEN = ['jibian_jibangzhili', 'jibian_heishan', 'jibian_liuyan', 'jibian_duoshouyeshou', 'jibian_zhuiji', 'jibian_cengshudaluan', 'jibian_emoxieyue'];
const WEIGHTS = { normal: 35, rare: 30, epic: 20, legend: 10, hidden: 5 };

// ① 数据：7 张卡都是 hidden，权重写对，两套炸惊模式一致
const cfg = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
for (const mid of ['mode_single_zhajing', 'mode_multi_zhajing']) {
  const j = cfg.modes[mid].jibian;
  assert.deepEqual(j.rarityWeights, WEIGHTS, `${mid} 权重不对`);
  for (const id of HIDDEN) {
    const card = j.pool.find((c) => c.effectId === id);
    assert.ok(card, `${mid} 缺卡 ${id}`);
    assert.equal(card.rarity, 'hidden', `${card.name} 应为 hidden`);
  }
  const hidden = j.pool.filter((c) => c.rarity === 'hidden');
  assert.equal(hidden.length, 7, `${mid} 隐秘卡应为 7 张，实际 ${hidden.length}`);
}

// ② gd.jibian() 必须把 hidden 放行（否则权重被丢掉、抽卡回落整池）
const gd = new GameData(getData(), 'mode_single_zhajing');
const weights = gd.jibian().rarityWeights;
const asObj = Object.fromEntries(weights);
assert.equal(asObj.hidden, 5, 'gd.jibian() 丢了 hidden 权重');
console.log('gd.jibian 权重:', JSON.stringify(asObj));

// ③ 实际抽卡分布：3000 批 × 3 张 = 9000 张，各档接近权重
const rng = createRng(20261025);
const counts = { normal: 0, rare: 0, epic: 0, legend: 0, hidden: 0 };
const draws = 3000;
for (let i = 0; i < draws; i++) {
  const cards = jibianDraftCards(gd, rng, 3);
  assert.ok(Array.isArray(cards) && cards.length === 3, '每批应给 3 张');
  for (const c of cards) {
    assert.ok(c.rarity in counts, `未知品质 ${c.rarity}`);
    counts[c.rarity]++;
  }
}
const total = draws * 3;
const pct = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, +((v / total) * 100).toFixed(2)]));
console.log('9000 张分布:', JSON.stringify(pct));
for (const [k, want] of Object.entries(WEIGHTS)) {
  assert.ok(Math.abs(pct[k] - want) <= 2.5, `${k} 分布 ${pct[k]}% 偏离目标 ${want}% 太多`);
}
assert.ok(pct.hidden > 2 && pct.hidden < 9, `隐秘档应约 5%，实际 ${pct.hidden}%`);

// ④ 抽到的隐秘卡，卡面品质标签也必须是隐秘（不会出现「普通标签的隐秘卡」）
const hiddenCards = [];
for (let i = 0; i < 400 && hiddenCards.length < 12; i++) {
  const cards = jibianDraftCards(gd, rng, 3);
  for (const c of cards) if (c.rarity === 'hidden') hiddenCards.push(c);
}
assert.ok(hiddenCards.length > 0, '400 批里应至少抽到一张隐秘');
console.log('隐秘样例:', hiddenCards.slice(0, 6).map((c) => c.name).join('、'));
console.log('PASS');