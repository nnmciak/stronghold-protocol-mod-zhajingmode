// 回归：结城理新卫戍特质
//   <战斗中>【S.E.E.S】每叠加5层，此干员的攻击力+1%（精锐 +2%）
// 注意：面板攻击力**同时**吃 S.E.E.S 盟约自身的 +10%+0.25L%，所以断言要用两者的合算式：
//   ATK(L) = 基础 × (1 + 盟约(L) + 卫戍(L))，其中 盟约(L) = (10 + 0.25L)/100，卫戍(L) = floor(L/5) × atk
// 0 层面板 = 基础 × 1.10（盟约的 base_atk 就写在 0 层）。
// 运行（项目根）: node test/zj60_5-atk-per-layer.test.mjs
import fs from 'node:fs';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const garrisons = JSON.parse(fs.readFileSync(new URL('../data/garrisons.json', import.meta.url), 'utf8'));
const chess = JSON.parse(fs.readFileSync(new URL('../data/chess.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

console.log('=== ① 数据接线 ===');
for (const [gid, atk, word] of [['garrison_zj_60_5_c', 0.01, '+1%'], ['garrison_zj_60_5_d', 0.02, '+2%']]) {
  const g = garrisons[gid];
  chk(`${gid} effectKey`, g.effectKey === 'act1autochess_gar_eff_attrByBond', g.effectKey);
  chk(`${gid} divide_num = 5（每 5 层）`, g.bb.divide_num === 5, String(g.bb.divide_num));
  chk(`${gid} atk = ${atk}（${word}）`, g.bb.atk === atk, String(g.bb.atk));
  chk(`${gid} bond_id = seesShip`, g.bbStr.bond_id === 'seesShip', g.bbStr.bond_id);
  chk(`${gid} 文案`, g.desc === `<战斗中>【S.E.E.S】每叠加5层，此干员的攻击力${word}`, g.desc);
}
chk('结城理挂的是 _c（普通）/ _d（精锐）',
  JSON.stringify(chess.chess_zj_60_5_a.garrisonIds) === '["garrison_zj_60_5_c"]'
  && JSON.stringify(chess.chess_zj_60_5_b.garrisonIds) === '["garrison_zj_60_5_d"]',
  `${chess.chess_zj_60_5_a.garrisonIds} / ${chess.chess_zj_60_5_b.garrisonIds}`);

console.log('\n=== ② 实战：卫戍 buff 的 atkPct 与面板 ===');
let seq = 0;
function probe(chessId, layers) {
  const E = 'zk' + (seq++);
  const h = makeBattle({
    units: [{ chessId, row: 9, col: 6 }],
    enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [3, 3], end: [3, 3], checkpoints: [] } }],
    defs: { enemies: { [E]: enemyRec({ key: E, hp: 1e9, atk: 0, def: 0, speed: 0 }) } },
    seed: 7,
    flags: { startOpCooldown: 0, layerGainsEnabled: true },
    bonds: { seesShip: { active: true, count: 2, layers } },
    autoFinish: false, timeLimit: 600, captureNoisy: false,
  });
  h.step(2);
  const u = h.unit(chessId);
  const buff = (u.buffs || []).find((b) => b && String(b.key).startsWith('gar:'));
  return { atk: u.s.atk, buffPct: buff?.mods?.atkPct ?? 0 };
}

const bondAt = (L) => (10 + 0.25 * L) / 100;

for (const [chessId, label, step] of [
  ['chess_zj_60_5_a', '普通', 0.01],
  ['chess_zj_60_5_b', '精锐', 0.02],
]) {
  const baseLine = probe(chessId, 0);
  const raw = baseLine.atk / 1.10;          // 去掉盟约 0 层的 +10%
  for (const L of [0, 4, 5, 50, 100, 200]) {
    const p = probe(chessId, L);
    const wantPct = Math.floor(L / 5) * step;
    const wantAtk = raw * (1 + bondAt(L) + wantPct);
    const okPct = Math.abs(p.buffPct - wantPct) < 1e-9;
    const okAtk = Math.abs(p.atk - wantAtk) < 1.5;   // 面板有取整
    chk(`${label} ${L} 层：卫戍 +${(wantPct * 100).toFixed(0)}%，面板 ${wantAtk.toFixed(0)}`,
      okPct && okAtk, `buff=${(p.buffPct * 100).toFixed(0)}% 面板=${p.atk.toFixed(0)}`);
  }
}

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
