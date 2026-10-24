import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

// 2026-10-24（反馈：mujica 的角色不会「敌人进入技能范围就开技能」）：
// 她们自带更大范围的技能在数据里 trigger 全是 DEFAULT，应该是 ACTIVE_RANGE
//（官方同款：深巡 / 野鬃 / 蒂比 —— 技能期间仍然普攻，只是按「开启后的范围」判定）。
// 初华 S1 的 kit 自己写了 SP_FULL（一满就开，比范围判定更早），保持 kit 优先。
const CASES = [
  ['chess_zj_oblvns_a', 2, 'skchr_oblvns_3', 'ACTIVE_RANGE'],
  ['chess_zj_mortis_a', 1, 'skchr_mortis_2', 'ACTIVE_RANGE'],
  ['chess_zj_dolris_a', 0, 'skchr_dolris_1', 'SP_FULL'],
  ['chess_zj_amoris_a', 1, 'skchr_amoris_2', 'ACTIVE_RANGE'],
];

const h = makeBattle({
  modeId: 'mode_single_zhajing', autoFinish: false, timeLimit: 60,
  units: CASES.map(([cid, idx], i) => ({ chessId: cid, row: 9 + (i % 2), col: 3 + i, skillIndex: idx, uid: i + 1 })),
  enemies: [{ key: 'dummy', time: 0, route: { motion: 'WALK', start: [4, 4], end: [4, 4], checkpoints: [] } }],
  defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, atk: 0, def: 0, res: 0, speed: 0 }) } },
});
h.step(1);

CASES.forEach(([cid, , sid, want], i) => {
  const u = h.unit(i + 1);
  assert.ok(u, `单位没上场: ${cid}`);
  console.log(cid.padEnd(18), '| 选中技能', u.skill.id, '| rule', u.skill.rule);
  assert.equal(u.skill.id, sid, `${cid} 选中的技能不对`);
  assert.equal(u.skill.rule, want, `${sid} 的触发规则应为 ${want}`);
});

// 数据层复核：chess.json 里 skills[] 与顶层 skill 都要是 ACTIVE_RANGE
const raw = JSON.parse(fs.readFileSync(new URL('../data/chess.json', import.meta.url), 'utf8'));
const list = Array.isArray(raw) ? raw : Object.values(raw);
for (const sid of ['skchr_oblvns_3', 'skchr_mortis_2', 'skchr_dolris_1', 'skchr_amoris_2']) {
  const rec = list.find((c) => (c.skills || []).some((s) => s.skillId === sid));
  const skill = rec.skills.find((s) => s.skillId === sid);
  assert.equal(skill.trigger.rule, 'ACTIVE_RANGE', `${sid} 的 skills[] 数据 trigger 不对`);
  if (rec.skill && rec.skill.skillId === sid) {
    assert.equal(rec.skill.trigger.rule, 'ACTIVE_RANGE', `${sid} 的顶层 skill 数据 trigger 不对`);
  }
}
console.log('PASS');