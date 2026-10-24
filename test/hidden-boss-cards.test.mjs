import assert from 'node:assert/strict';
import { makeBattle } from './helpers/battleHarness.js';

function boss(cards, { bonds = {} } = {}) {
  const h = makeBattle({
    modeId: 'mode_single_zhajing', autoFinish: false, timeLimit: 5,
    flags: { enemyJibian: cards }, bonds,
    enemies: [{ key: 'enemy_1001_bigbo', time: 0, route: 0 }],
  });
  h.runUntil(() => h.enemies().length > 0, 5);
  return { e: h.enemies()[0], h };
}

const B = boss([]).e;
console.log('基准 boss: atk', B.s.atk, '| hp', B.s.maxHp, '| def', B.s.def, '| res', B.s.res);

{
  const { e } = boss(['ejibian_hidden_absolute']);
  console.log('绝对数值: atk', e.s.atk, '(×2)', '| hp', e.s.maxHp, '(×11)');
  assert.ok(Math.abs(e.s.atk - B.s.atk * 2) < 1e-6);
  assert.ok(Math.abs(e.s.maxHp - B.s.maxHp * 11) < 1e-6);
}
{
  const { e } = boss(['ejibian_hidden_cannon']);
  console.log('钢铁大炮: atk', e.s.atk, '(×3)', '| def', e.s.def, '(×4)', '| res', e.s.res, '(=70)');
  assert.ok(Math.abs(e.s.atk - B.s.atk * 3) < 1e-6);
  assert.ok(Math.abs(e.s.def - B.s.def * 4) < 1e-6);
  assert.equal(e.s.res, 70);
}
{
  const { e } = boss(['ejibian_hidden_random']);
  const ratio = e.s.atk / B.s.atk;
  console.log('脚填数值: atk 比', ratio.toFixed(2), '(应在 0.5–9.99)');
  assert.ok(ratio >= 0.49 && ratio <= 10.0);
}
{
  const { e } = boss(['ejibian_hidden_sacrifice'], { bonds: { yanShip: { active: true, count: 6, tier: 4, layers: 5000 } } });
  console.log('献祭（5000 层 → +50%）: hp', e.s.maxHp, '期望', (B.s.maxHp * 1.5).toFixed(0));
  assert.ok(Math.abs(e.s.maxHp - B.s.maxHp * 1.5) < 1e-6);
}
console.log('PASS');