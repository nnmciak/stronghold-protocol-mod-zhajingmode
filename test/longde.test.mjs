import assert from 'node:assert/strict';
import { makeBattle } from './helpers/battleHarness.js';
import * as jibian from '../server/sim/content/jibian.js';
import { TOKEN_IDS } from '../server/sim/content/tokens.js';

const YAN = ['chess_zj_03_a', 'chess_zj_09_a', 'chess_zj_18_a', 'chess_zj_32_a', 'chess_zj_33_a', 'chess_zj_58_a'];
const OTHER = 'chess_zj_36_a';

function run(layers) {
  const h = makeBattle({
    modeId: 'mode_single_zhajing', content: 'generic',
    units: [...YAN, OTHER].map((id, i) => ({ chessId: id, row: 9, col: 2 + i })),
    bonds: { yanShip: { active: true, count: 6, tier: 4, layers } },
    autoFinish: false, timeLimit: 60,
  });
  const b = h.b;
  h.step(1);
  b.players[0].playerEffects = [{ key: 'jibian:jibian_longdechuanren' }];
  jibian.install(b);
  b.emit('battleStart', {});
  const base = (b.data.rawToken && b.data.rawToken(TOKEN_IDS.yanyou)) || {};
  const baseStats = base.stats || {};
  const ops = b.allyUnits.filter((u) => u && u.alive && u.side === 'ally' && u.kind === 'op');
  const tokens = b.allyUnits.filter((u) => u && u.alive && u.mem && u.mem.bondYan);
  const sum = (list, key) => list.reduce((n, u) => n + (Number(u.s && u.s[key]) || 0), 0);
  return { tokens, atkSum: sum(ops, 'atk'), hpSum: sum(ops, 'maxHp'), baseStats, ops };
}

{
  const r = run(1200);
  const t0 = r.tokens[0];
  const baseAtk = Number(r.baseStats.atk) || 0, baseHp = Number(r.baseStats.maxHp) || 0;
  console.log('1200 层 | 干员', r.ops.length, '| 炎佑', r.tokens.length,
    '| atk', t0 && t0.s.atk.toFixed(1), '= 底', baseAtk, '+ 30%×', r.atkSum.toFixed(0),
    '| hp', t0 && t0.s.maxHp.toFixed(1), '= 底', baseHp, '+ 30%×', r.hpSum.toFixed(0));
  assert.equal(r.tokens.length, 1);
  assert.ok(Math.abs(t0.s.atk - (baseAtk + r.atkSum * 0.3)) < 1);
  assert.ok(Math.abs(t0.s.maxHp - (baseHp + r.hpSum * 0.3)) < 1);
}
{
  const r = run(400);
  console.log('400 层 | 炎佑', r.tokens.length);
  assert.equal(r.tokens.length, 0);
}
{
  const r = run(99000);
  console.log('99000 层 | 炎佑', r.tokens.length, '(上限 9)');
  assert.equal(r.tokens.length, 9);
}
console.log('PASS');