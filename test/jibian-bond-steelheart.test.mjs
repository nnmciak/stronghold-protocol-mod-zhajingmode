// 惊变羁绊「钢化你心」：阈值 2，我方所有干员生命值 +100%（最终乘算）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';
import { bondHintsFor, jibianBonds } from '../server/sim/content/jibianBonds.js';

const BOND = 'steel_heart';
const MEMBERS = ['jibian_xinzhigang', 'jibian_xingjieshenti', 'jibian_tankeyinqing', 'jibian_bawangxuekai'];

test('数据：羁绊存在、阈值 2、成员正确', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../data/jibianBonds.json', import.meta.url), 'utf8'));
  const d = data.bonds.find((b) => b.id === BOND);
  assert.ok(d, 'data/jibianBonds.json 缺钢化你心');
  assert.equal(d.name, '钢化你心');
  assert.deepEqual(d.tiers, [2]);
  for (const m of MEMBERS) assert.ok(d.members.includes(m), `缺成员 ${m}`);
  const mod = jibianBonds().find((b) => b.id === BOND);
  assert.ok(mod, '服务端羁绊表缺钢化你心');
  const hints = bondHintsFor('jibian_xinzhigang', new Set(['jibian_xinzhigang', 'jibian_xingjieshenti']));
  const h = hints.find((x) => x.name === '钢化你心');
  assert.ok(h, '应有钢化你心提示');
  assert.equal(h.have, 2);
});

const setup = (effects) => {
  const h = makeBattle({
    modeId: 'mode_single_zhajing',
    units: [{ chessId: 'chess_char_5_02_a', row: 9, col: 4 }],
    enemies: [{ key: 'mob', time: 0, route: { start: [9, 5], end: [9, 5], checkpoints: [], motion: 'WALK' } }],
    defs: { enemies: { mob: enemyRec({ key: 'mob', hp: 1e9, atk: 0, def: 0, res: 0, speed: 0 }) } },
    playerEffects: effects.map((key) => ({ key: `jibian:${key}` })),
    autoFinish: false, timeLimit: 8,
  });
  h.step(1);
  return h.b.allyUnits.find((x) => x.kind === 'op');
};

test('凑齐 2 张心之钢系列 → 生命值 ×2（最终乘算）', () => {
  const plain = setup([]);
  const one = setup(['jibian_bawangxuekai']);
  const two = setup(['jibian_bawangxuekai', 'jibian_tankeyinqing']);
  console.log('无羁绊:', plain.s.maxHp.toFixed(0), '| 1 张:', one.s.maxHp.toFixed(0), '| 2 张:', two.s.maxHp.toFixed(0));
  assert.ok(Math.abs(one.s.maxHp - plain.s.maxHp) < 1e-6, '只有 1 张不激活');
  assert.ok(Math.abs(two.s.maxHp - plain.s.maxHp * 2) < 1e-6, '2 张应 ×2');
});