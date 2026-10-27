// 羁绊审计：重振荣光攻击距离、伟大封印处决。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const setup = ({ chessId, effects, enemyHp = 1000, enemyDef = 0, greatSealUsed = false }) => {
  const h = makeBattle({
    modeId: 'mode_single_zhajing',
    units: [{ chessId, row: 9, col: 4 }],
    enemies: [{ key: 'dummy', time: 0, route: { start: [9, 5], end: [9, 5], checkpoints: [], motion: 'WALK' } }],
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: enemyHp, atk: 0, def: enemyDef, res: 0, speed: 0 }) } },
    playerEffects: effects.map((key) => ({ key: `jibian:${key}` })),
    greatSealUsed,
    autoFinish: false, timeLimit: 8,
  });
  h.step(1);
  return h;
};

test('重振荣光：卡西米尔干员攻击距离 +1 生效', () => {
  const plain = setup({ chessId: 'chess_char_1_19_a', effects: [] });
  const glory = setup({ chessId: 'chess_char_1_19_a', effects: ['jibian_hongsongqishituan', 'jibian_qishijingji'] });
  const a = plain.b.allyUnits.find((u) => u.kind === 'op');
  const b = glory.b.allyUnits.find((u) => u.kind === 'op');
  console.log('rangeExtend', a.s.rangeExtend, '->', b.s.rangeExtend, '| atk', a.s.atk, '->', b.s.atk);
  assert.equal(a.s.rangeExtend, 0);
  assert.equal(b.s.rangeExtend, 1, '重振荣光应 +1 距离');
  assert.ok(b.s.atk > a.s.atk, '重振荣光应 +100% 攻击');
});

test('伟大封印：结城理死亡处决血量最高敌人，一局一次', () => {
  const h = setup({ chessId: 'chess_zj_60_5_a', effects: ['jibian_sanyuewuri', 'jibian_zonggongji'], enemyHp: 12345 });
  const u = h.b.allyUnits.find((x) => x.kind === 'op' && String(x.chessId || x.defId).startsWith('chess_zj_60_5'));
  assert.ok(u, '结城理应在场');
  const e = h.b.enemies.find((x) => x.alive !== false && x.s);
  assert.ok(e, '敌人应在场');
  h.b.kill(u, null);
  console.log('结城理死亡后敌人 hp:', e.hp, 'alive:', e.alive, 'greatSealUsed:', h.b.__greatSealUsed);
  assert.equal(h.b.__greatSealUsed, true);
  assert.ok(e.alive === false || e.hp <= 0, '血量最高的敌人应被处决');
  const res = h.b.result();
  assert.ok(res.greatSealBan && res.greatSealBan.playerId === 'p1', '战报应带伟大封印禁部署标记');
});

test('伟大封印：整局已触发过时不再触发', () => {
  const h = setup({ chessId: 'chess_zj_60_5_a', effects: ['jibian_sanyuewuri', 'jibian_zonggongji'], enemyHp: 12345, greatSealUsed: true });
  const u = h.b.allyUnits.find((x) => x.kind === 'op' && String(x.chessId || x.defId).startsWith('chess_zj_60_5'));
  const e = h.b.enemies.find((x) => x.alive !== false && x.s);
  h.b.kill(u, null);
  assert.equal(h.b.__greatSealUsed, undefined, '整局已用过不应再触发');
  assert.ok(e.alive !== false && e.hp > 0, '敌人不应被处决');
});