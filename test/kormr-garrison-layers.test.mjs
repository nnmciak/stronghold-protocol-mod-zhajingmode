// 虎狼丸的卫戍特质：「<战斗中>部署后不占用可部署位置；<部署时>使自身已激活盟约+3（精锐+6）」
// 运行（项目根）: node test/kormr-garrison-layers.test.mjs
//
// 用户 2026-10-17：「哪个不是天赋是卫戍特质 虎狼丸的你修改一下」——
//   这条不是天赋，是卫戍特质（data/garrisons.json 的 garrison_zj_60_2_c）。
// 机制：effectKey = act2autochess_gar_event_onstart（每次部署触发层数增益）
//       → fireGain → S.gainLayers({ requireActive: true, bond_type: 'bond_self' })
//   「精锐+6」按数据里的既有写法另开一条 `_d` 记录（同 garrison_106_a/_b 的 4/8 对比），
//   再由 chess_zj_60_2_b.garrisonIds 指过去。
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

let seq = 0;
/** 虎狼丸 + 由加莉（凑满 S.E.E.S 阈值 2），S.E.E.S 预先给 5 层。 */
function setup(kormrId, baseLayers = 5) {
  const E = 'kg' + (seq++);
  const h = makeBattle({
    units: [
      { chessId: kormrId, row: 9, col: 6 },
      { chessId: 'chess_zj_60_4_a', row: 9, col: 8 },   // 由加莉，让 S.E.E.S 达到阈值 2
    ],
    enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [1, 1], end: [1, 1], checkpoints: [] } }],
    defs: { enemies: { [E]: enemyRec({ key: E, hp: 1e9, atk: 0, def: 0, speed: 0 }) } },
    seed: 7,
    flags: { startOpCooldown: 0, layerGainsEnabled: true },
    // 战斗里的 bonds 要的是 { active, count, layers } 这种对象（给裸数字不会被视为已激活）
    bonds: { seesShip: { active: true, count: 2, layers: baseLayers } },
    autoFinish: false, timeLimit: 600, captureNoisy: false,
  });
  return { h, ps: h.b.players[0] };
}

console.log('=== ① 普通虎狼丸：部署后 S.E.E.S +3 层 ===');
{
  const { h, ps } = setup('chess_zj_60_2_a', 5);
  const before = ps.bonds.seesShip.layers;
  h.step(6);
  const after = ps.bonds.seesShip.layers;
  console.log('     层数 %s → %s', before, after);
  chk('★ 部署时加了 3 层', after === before + 3, `${before} → ${after}`);
}

console.log('\n=== ② 精锐虎狼丸（_b）：部署后 +6 层 ===');
{
  const { h, ps } = setup('chess_zj_60_2_b', 5);
  const before = ps.bonds.seesShip.layers;
  h.step(6);
  const after = ps.bonds.seesShip.layers;
  console.log('     层数 %s → %s', before, after);
  chk('★ 部署时加了 6 层', after === before + 6, `${before} → ${after}`);
}

console.log('\n=== ③ 「不占用可部署位置」标记仍在（同一个 bb 里共存）===');
{
  const { h } = setup('chess_zj_60_2_a');
  void h;
  const { GameData } = await import('../server/match/gamedata.js');
  const { getData } = await import('../server/data.js');
  const gd = new GameData(getData(), 'mode_single_zhajing');
  const g = gd.garrison('garrison_zj_60_2_c');
  chk('bb.no_deploy_slot = 1 还在', Number(g?.bb?.no_deploy_slot) === 1, JSON.stringify(g?.bb));
  chk('bb.bond_add_count = 3', Number(g?.bb?.bond_add_count) === 3, JSON.stringify(g?.bb));
  chk('effectKey = act2autochess_gar_event_onstart', g?.effectKey === 'act2autochess_gar_event_onstart', String(g?.effectKey));
  const gb = gd.garrison('garrison_zj_60_2_d');
  chk('精锐记录 bb.bond_add_count = 6', Number(gb?.bb?.bond_add_count) === 6, JSON.stringify(gb?.bb));
  chk('精锐记录也有 no_deploy_slot = 1', Number(gb?.bb?.no_deploy_slot) === 1, JSON.stringify(gb?.bb));
  chk('没有 max_add_count_per_battle（= 无上限）', gb?.bb?.max_add_count_per_battle === undefined, JSON.stringify(gb?.bb));
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
