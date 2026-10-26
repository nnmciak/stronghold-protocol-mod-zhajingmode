// 惊变「龙的传人」：多只炎佑分散生成 + 炎佑伤害进 DPS 统计。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const CARD = 'jibian_longdechuanren';

const setup = () => {
  const h = makeBattle({
    modeId: 'mode_single_zhajing',
    units: [{ chessId: 'chess_char_5_02_a', row: 9, col: 4 }],
    enemies: [{ key: 'mob', time: 0, route: { start: [9, 5], end: [9, 5], checkpoints: [], motion: 'WALK' } }],
    defs: { enemies: { mob: enemyRec({ key: 'mob', hp: 1e9, atk: 0, def: 0, res: 0, speed: 0 }) } },
    playerEffects: [{ key: `jibian:${CARD}` }],
    // 9000 层 → 9 只炎佑
    bonds: { yanShip: { active: true, count: 3, tier: 2, layers: 9000 } },
    autoFinish: false, timeLimit: 8,
  });
  h.step(1);
  const ys = h.b.allyUnits.filter((u) => u.kind === 'token' && u.mem && u.mem.bondYan);
  return { h, ys };
};

test('龙的传人：9 只炎佑分散生成（不再全部挤在一起）', () => {
  const { h, ys } = setup();
  console.log('炎佑数:', ys.length, '| 位置:', ys.map((u) => `(${Math.round(u.y)},${Math.round(u.x)})`).join(' '));
  assert.equal(ys.length, 9, '9000 层应召唤 9 只');
  let minD = Infinity;
  for (let i = 0; i < ys.length; i++) {
    for (let j = i + 1; j < ys.length; j++) {
      const d = Math.hypot(ys[i].x - ys[j].x, ys[i].y - ys[j].y);
      if (d < minD) minD = d;
    }
  }
  console.log('最近两只距离:', minD.toFixed(2));
  assert.ok(minD >= 1.5, `应分散（最近距离 ≥1.5 格），实际 ${minD.toFixed(2)}`);
  assert.equal(h.b.errors.length, 0);
});

test('炎佑的伤害进入 DPS 统计（合并成一行）', () => {
  const { h, ys } = setup();
  const e = h.b.units.find((u) => u.side === 'enemy' && u.alive);
  assert.ok(e, '测试敌人存在');
  const dmg = 1234;
  h.b.dealDamage(ys[0], e, { amount: dmg, type: 'phys' });
  const row = [...h.b.dmgByOp.values()].find((r) => r.id === 'enemy_9012_acloon');
  console.log('DPS 行:', row);
  assert.ok(row, 'DPS 面板应有炎佑一行');
  assert.ok(row.dmg >= dmg * 0.9, `炎佑伤害应计入（实际 ${row.dmg}）`);
  const snap = h.b.snapshot();
  assert.ok(Array.isArray(snap.dmg) && snap.dmg.some((r) => r[0] === 'enemy_9012_acloon' && r[1] > 0), 'snapshot.dmg 应携带炎佑');
});