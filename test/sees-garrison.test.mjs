// 三人的卫戍特质（S.E.E.S.txt）行为回归。
// 运行（项目根）: node test/sees-garrison.test.mjs
//
//   结城理 5阶  <战斗中>【S.E.E.S】每叠加5层，此干员的攻击力+1%（精锐 +2%）
//               ↑ 行为回归见 test/zj60_5-atk-per-layer.test.mjs（本文件只验由加莉 / 埃癸斯）
//   由加莉 3阶  <战斗中>每对敌方施加一次浮空，使自身已激活盟约+1（精锐+2）\n//               并且使【S.E.E.S】层数+2（精锐+4）—— 她的盟约里本来就有 seesShip，\n//               两段都落在 S.E.E.S 上，所以合计 +3（精锐 +6）。
//   埃癸斯 4阶  <战斗中>陷入异常状态时，使自身已激活盟约+10（精锐+20）
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

let seq = 0;
function setup(chessId, baseLayers = 5, enemyHp = 1e9) {
  const E = 'sg' + (seq++);
  const h = makeBattle({
    units: [{ chessId, row: 9, col: 6 }],
    enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [9, 7], end: [9, 7], checkpoints: [] } }],
    defs: { enemies: { [E]: enemyRec({ key: E, hp: enemyHp, atk: 0, def: 0, speed: 0 }) } },
    seed: 7,
    flags: { startOpCooldown: 0, layerGainsEnabled: true },
    bonds: { seesShip: { active: true, count: 2, layers: baseLayers } },
    autoFinish: false, timeLimit: 600, captureNoisy: false,
  });
  const u = h.unit(chessId);
  // ★ 基准层数必须在**任何击杀之前**取：结城理是近战，1 血的敌人在部署后第一下就死了
  const beforeLayers = h.b.players[0].bonds.seesShip.layers;
  h.step(3);                     // 让部署/开战钩子跑完（击杀也在这段发生）
  return { h, u, ps: h.b.players[0], enemy: h.enemies()[0], beforeLayers };
}

console.log('=== ①／② 结城理：旧「击杀叠层」已被替换 ===');
{
  // 2026-10-18 改版：结城理的卫戍特质不再是「击杀 → +3/+6 层」，而是「每 5 层 S.E.E.S → 攻击力 +1%/+2%」。
  // 这里只确认旧行为确实消失（击杀不再加层），新行为由 test/zj60_5-atk-per-layer.test.mjs 覆盖。
  const { h, ps, beforeLayers } = setup('chess_zj_60_5_a', 5, 1);
  h.run(4);
  chk('★ 击杀后不再加层', ps.bonds.seesShip.layers === beforeLayers,
    `${beforeLayers} → ${ps.bonds.seesShip.layers}`);
}

console.log('\n=== ③ 由加莉：对敌人施加浮空 → 合计 +3 ===');
{
  const { h, u, ps, enemy } = setup('chess_zj_60_4_a', 5);
  const before = ps.bonds.seesShip.layers;
  h.b.applyStatus(enemy, 'levitate', { duration: 1.5, source: u });
  h.step(2);
  console.log('     %s → %s（敌人 levitate=%s）', before, ps.bonds.seesShip.layers,
    !!(enemy.buffs || []).some((b) => b && b.status === 'levitate'));
  // ① 自身已激活盟约 +1（她的盟约里就有 seesShip）+ ② S.E.E.S +2 ⇒ 合计 +3
  chk('★ 浮空后合计 +3 层（+1 自身盟约 +2 S.E.E.S）', ps.bonds.seesShip.layers === before + 3,
    `${before} → ${ps.bonds.seesShip.layers}`);
}

console.log('\n=== ④ 精锐由加莉（_b）：浮空 → 合计 +6 ===');
{
  const { h, u, ps, enemy } = setup('chess_zj_60_4_b', 5);
  const before = ps.bonds.seesShip.layers;
  h.b.applyStatus(enemy, 'levitate', { duration: 1.5, source: u });
  h.step(2);
  // 精锐：+2 自身盟约 + 4 S.E.E.S ⇒ 合计 +6
  chk('★ 浮空后合计 +6 层（+2 自身盟约 +4 S.E.E.S）', ps.bonds.seesShip.layers === before + 6,
    `${before} → ${ps.bonds.seesShip.layers}`);
}

console.log('\n=== ⑤ 埃癸斯：自己陷入异常状态 → +10 ===');
{
  const { h, u, ps } = setup('chess_zj_60_3_a', 5);
  const before = ps.bonds.seesShip.layers;
  h.b.applyStatus(u, 'stun', { duration: 2, source: u, force: true });
  h.step(2);
  console.log('     %s → %s', before, ps.bonds.seesShip.layers);
  chk('★ 中状态后 +10 层', ps.bonds.seesShip.layers === before + 10, `${before} → ${ps.bonds.seesShip.layers}`);
}

console.log('\n=== ⑥ 精锐埃癸斯（_b）：陷入异常 → +20 ===');
{
  const { h, u, ps } = setup('chess_zj_60_3_b', 5);
  const before = ps.bonds.seesShip.layers;
  h.b.applyStatus(u, 'stun', { duration: 2, source: u, force: true });
  h.step(2);
  chk('★ 中状态后 +20 层', ps.bonds.seesShip.layers === before + 20, `${before} → ${ps.bonds.seesShip.layers}`);
}

console.log('\n=== ⑦ 数据接线 ===');
{
  const { GameData } = await import('../server/match/gamedata.js');
  const { getData } = await import('../server/data.js');
  const gd = new GameData(getData(), 'mode_single_zhajing');
  const cases = [
    ['chess_zj_60_5_a', 'garrison_zj_60_5_c'], ['chess_zj_60_5_b', 'garrison_zj_60_5_d'],
    ['chess_zj_60_4_a', 'garrison_zj_60_4_c'], ['chess_zj_60_4_b', 'garrison_zj_60_4_d'],
    ['chess_zj_60_3_a', 'garrison_zj_60_3_c'], ['chess_zj_60_3_b', 'garrison_zj_60_3_d'],
  ];
  for (const [cid, gid] of cases) {
    const rec = gd.chess(cid);
    const g = gd.garrison(gid);
    chk(`${cid} → ${gid}`, (rec?.garrisonIds || []).includes(gid) && !!g, JSON.stringify(rec?.garrisonIds));
  }
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
