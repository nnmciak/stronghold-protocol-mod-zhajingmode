// 结城理：「<【S.E.E.S】每叠加100层>傀儡状态持续时间-1s（最多降至2s）」（S.E.E.S.txt）
// 运行（项目根）: node test/makoto-doll-duration.test.mjs
//
// 机制：傀儡态时长在 server/sim/professions.js:253
//   const dur = DOLL_SWITCH + (unit.profile.dollDuration ?? 20);
// profile.dollDuration 由特性 bb 填一次 ⇒ 在进入替身前按层数重算即可。
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

let seq = 0;
function setup(layers) {
  const E = 'dd' + (seq++);
  const h = makeBattle({
    units: [{ chessId: 'chess_zj_60_5_a', row: 9, col: 6, skillIndex: 2 }],
    enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [9, 7], end: [9, 7], checkpoints: [] } }],
    defs: { enemies: { [E]: enemyRec({ key: E, hp: 1e9, atk: 0, def: 0, speed: 0 }) } },
    seed: 7,
    flags: { startOpCooldown: 0, layerGainsEnabled: true },
    bonds: { seesShip: { active: true, count: 2, layers } },
    autoFinish: false, timeLimit: 600, captureNoisy: false,
  });
  h.step(3);
  return { h, u: h.unit('chess_zj_60_5_a') };
}

function enterDoll(h, u) {
  // 走 kit 自己的入口：技能激活 → use() → dollSwitch
  u.skill.activate('manual', { free: true });
  h.step(3);
  return u.profile && u.profile.dollDuration;
}

console.log('=== 各层数下进入替身后的 dollDuration ===');
const rows = [];
for (const L of [0, 99, 100, 300, 5000]) {
  const { h, u } = setup(L);
  const base = u.profile && u.profile.dollDuration;
  const got = enterDoll(h, u);
  rows.push([L, base, got]);
  console.log('  %s 层: 进入前 %s → 进入后 %s', L, base, got);
}

const [r0, r99, r100, r300, r5000] = rows;
chk('★ 0 层不变（20）', r0[2] === 20, String(r0[2]));
chk('★ 99 层不变（20）', r99[2] === 20, String(r99[2]));
chk('★ 100 层 -1s（19）', r100[2] === 19, String(r100[2]));
chk('★ 300 层 -3s（17）', r300[2] === 17, String(r300[2]));
chk('★ 极高层数下限 2s', r5000[2] === 2, String(r5000[2]));

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
