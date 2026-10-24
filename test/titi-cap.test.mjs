import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

// 2026-10-25（owner）：炸惊版缇缇补「每场战斗至多 240 / 480 层」上限（普通版本来就是 24 / 48）。
const run = (chessId, elite) => {
  const h = makeBattle({
    modeId: 'mode_single_zhajing', autoFinish: false, timeLimit: 60,
    units: [{ chessId, row: 9, col: 4 }],
    enemies: [{ key: 'dummy', time: 0, route: { motion: 'WALK', start: [9, 5], end: [9, 5], checkpoints: [] } }],
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, atk: 0, def: 0, res: 0, speed: 0 }) } },
  });
  h.step(1);
  const u = h.unit(chessId);
  assert.ok(u, '缇缇没上场');
  const ps = h.b.players[0];
  ps.bonds.sargonShip = { ...(ps.bonds.sargonShip || {}), active: true, count: 2, tier: 1, layers: 0 };
  ps.bonds.preciShip = { ...(ps.bonds.preciShip || {}), active: true, count: 2, tier: 1, layers: 0 };
  const e = h.enemies()[0];
  // 每次 +2 / +4；给足够多次触发（300 次）去撞上限
  for (let i = 0; i < 300; i++) h.b.emit('statusApplied', { target: e, status: 'stun', entered: true });
  const layerOf = (id) => Math.max(Number(ps.layouts ? 0 : 0), Number((ps.bonds[id] && ps.bonds[id].layers) || 0), Number((ps.layerGains && ps.layerGains[id]) || 0));
  return { sargon: layerOf('sargonShip'), preci: layerOf('preciShip'), errors: h.b.errors };
};
{
  const r = run('chess_zj_65_a', false);
  console.log('炸惊 普通 | 萨尔贡', r.sargon, '| 精准', r.preci, '| errors', JSON.stringify(r.errors));
  assert.equal(r.sargon, 240, '普通炸惊版应封顶 240');
  assert.equal(r.preci, 240, '精准同样封顶 240');
}
{
  const r = run('chess_zj_65_b', true);
  console.log('炸惊 精锐 | 萨尔贡', r.sargon, '| 精准', r.preci, '| errors', JSON.stringify(r.errors));
  assert.equal(r.sargon, 480, '精锐炸惊版应封顶 480');
  assert.equal(r.preci, 480, '精准同样封顶 480');
}
console.log('PASS');