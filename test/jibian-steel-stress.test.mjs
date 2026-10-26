// 压力自检：心之钢 + 星界躯体 + 坦克引擎 + 缩小引擎 + 钢化你心 同场，反复击杀/受击/阵亡，
// 检查：无错误、无递归爆栈、体型始终在 [0.8, 2] 内、生命值有限。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const CARDS = ['jibian_xinzhigang', 'jibian_xingjieshenti', 'jibian_tankeyinqing', 'jibian_suoxiaoyinqing', 'jibian_bawangxuekai'];

const setup = () => {
  const h = makeBattle({
    modeId: 'mode_single_zhajing',
    units: [
      { chessId: 'chess_char_5_02_a', row: 9, col: 4 },
      { chessId: 'chess_char_1_01_a', row: 9, col: 3 },
    ],
    enemies: [
      { key: 'mob', time: 0, route: { start: [9, 5], end: [9, 5], checkpoints: [], motion: 'WALK' } },
      { key: 'mob2', time: 0, route: { start: [8, 5], end: [8, 5], checkpoints: [], motion: 'WALK' } },
    ],
    defs: { enemies: {
      mob: enemyRec({ key: 'mob', hp: 1e9, atk: 0, def: 0, res: 0, speed: 0 }),
      mob2: enemyRec({ key: 'mob2', hp: 1e9, atk: 0, def: 0, res: 0, speed: 0 }),
    } },
    playerEffects: CARDS.map((key) => ({ key: `jibian:${key}` })),
    autoFinish: false, timeLimit: 600,
  });
  h.step(1);
  const ops = h.b.allyUnits.filter((x) => x.kind === 'op');
  const foes = h.b.units.filter((x) => x.side === 'enemy' && x.alive);
  return { h, ops, foes };
};

test('五卡同场：反复触发不报错、不递归、体型/生命值健康', () => {
  const { h, ops, foes } = setup();
  const [u1, u2] = ops;
  assert.ok(u1 && u2 && foes.length === 2, '测试单位齐全');
  const victim = { side: 'enemy', alive: true, s: {}, def: { key: 'mob' }, mem: { ab: null }, id: 'v1', uid: 'v1' };

  for (let i = 0; i < 30; i++) {
    h.b.emit('kill', { killer: i % 2 ? u1 : u2, victim });
    if (i % 3 === 0) h.b.emit('death', { unit: i % 2 ? u1 : u2 });
    if (i % 2 === 0) {
      h.b.time = (Number(h.b.time) || 0) + 31;          // 跨过心之钢的 30s 同目标冷却
      h.b.emit('hit', { dmg: { tags: [] }, source: u1, target: foes[i % 2] });
    }
  }
  for (const u of h.b.allyUnits) {
    if (u.kind !== 'op') continue;
    assert.ok(Number.isFinite(u.s.maxHp) && u.s.maxHp > 0, `${u.defId} 最大生命值异常`);
    const k = Number(u.visualScale) || 1;
    assert.ok(k >= 0.8 - 1e-9 && k <= 2 + 1e-9, `${u.defId} 体型越界：${k}`);
  }
  console.log('生命值:', h.b.allyUnits.filter((u) => u.kind === 'op').map((u) => Math.round(u.s.maxHp)).join(' / '));
  console.log('体型:', h.b.allyUnits.filter((u) => u.kind === 'op').map((u) => (Number(u.visualScale) || 1).toFixed(2)).join(' / '));
  assert.equal(h.b.errors.length, 0, '不应有战斗错误：' + JSON.stringify(h.b.errors.map((e) => String(e && e.message || e))));
});