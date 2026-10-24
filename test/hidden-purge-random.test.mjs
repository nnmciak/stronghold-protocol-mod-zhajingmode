import assert from 'node:assert/strict';
import { applyHiddenMatchCards } from '../server/sim/content/ejibian.js';

const fake = (seed, layersList) => {
  const players = new Map(layersList.map((layers, i) => [`p${i + 1}`, {
    layers: { ...layers },
    setLayers(id, v) { this.layers[id] = v; },
  }]));
  return { seed, players };
};
const zeroed = (m) => {
  const out = new Set();
  for (const ps of m.players.values()) for (const [id, v] of Object.entries(ps.layers)) if (v === 0 && out.size < 1) out.add(id);
  return [...out];
};
const pickOf = (seed, layersList) => {
  const m = fake(seed, layersList);
  applyHiddenMatchCards(m, ['ejibian_hidden_purge']);
  for (const ps of m.players.values()) for (const [id, v] of Object.entries(ps.layers)) if (v === 0) return id;
  return null;
};

// 三个盟约：A 最高、B 中等、C 很低
const layers = [{ yanShip: 900, mujicaShip: 300, swiftShip: 10 }, { yanShip: 100, mujicaShip: 50, swiftShip: 5 }];

// 同一 seed 可复现
const a = pickOf(42, layers), b = pickOf(42, layers);
console.log('同 seed 复现:', a, b);
assert.equal(a, b);

// 随机分布：200 个 seed 里三个盟约都应被抽到，且不应永远是最高
const counts = {};
for (let seed = 1; seed <= 200; seed++) { const p = pickOf(seed, layers); counts[p] = (counts[p] || 0) + 1; }
console.log('200 次分布:', JSON.stringify(counts));
assert.ok(counts.yanShip > 20 && counts.mujicaShip > 20 && counts.swiftShip > 20, '三个盟约都要有机会');
assert.ok(counts.yanShip < 150, '不能永远抽最高的那个');

// 全场同一个盟约、且只清有层数的人
const m = fake(7, layers);
applyHiddenMatchCards(m, ['ejibian_hidden_purge']);
const ids = [...m.players.values()].map((ps) => Object.entries(ps.layers).filter(([, v]) => v === 0).map(([id]) => id));
console.log('各玩家被清空的盟约:', JSON.stringify(ids));
assert.equal(ids[0].length, 1, '每人只清一个');
assert.deepEqual(ids[0], ids[1], '全场同一个盟约');
console.log('PASS');