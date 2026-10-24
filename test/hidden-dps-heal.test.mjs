import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { getDefaultRegistry } from '../server/match/effectsMeta.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const m = new Match({ roomCode:'DPS', mode:'solo', difficulty:'ZHAJING', modeId:'mode_single_zhajing', seed: 9,
  data: getData(), registry: getDefaultRegistry(),
  seats: [{ seat: 0, playerId: 'p1', name: 't', isBot: false, connected: true }], send: () => true, broadcast: () => {}, onEnd: () => {} });
m.phase='PREP'; m.round = m.gd.hiddenRound;
m.hiddenBossId = m.bossId; m.teamLp = 30; m.hiddenLayerSum = 1200;
m._hiddenJibianDone = true;                       // 跳过揭示
m.enemyJibianCards = ['ejibian_hidden_dps'];      // 只带 dps检测器
m.timerScale = 0.01;                              // 50 游戏秒 → 500ms，便于测试

m.startFinalAssault(true);
assert.equal(m.phase, 'HIDDEN_CORE');
const pool = m.bossPool;
console.log('战斗开始 | pool', Math.round(pool.hp), '/', Math.round(pool.maxHp), '| 计时器', !!m._dpsHealTimer);
pool.hp = pool.maxHp * 0.5;
const before = pool.hp;

await wait(650);
const after1 = pool.hp;
console.log('≈50 游戏秒后 pool:', Math.round(after1), '/', Math.round(pool.maxHp), `(+${((after1/before-1)*100).toFixed(1)}%)`);
assert.ok(after1 > before, 'boss 应当回血');
assert.ok(Math.abs(after1 - pool.maxHp * 0.6) < pool.maxHp * 0.02, '一次回 10% 最大生命');

await wait(600);
const after2 = pool.hp;
console.log('再过 50 游戏秒:', Math.round(after2), '/', Math.round(pool.maxHp), `(+${((after2/after1-1)*100).toFixed(1)}%)`);
assert.ok(after2 > after1, '会持续回血');

// 回满后不溢出
pool.hp = pool.maxHp * 0.95;
await wait(650);
console.log('接近满血再回一次:', Math.round(pool.hp), '<=', Math.round(pool.maxHp));
assert.ok(pool.hp <= pool.maxHp + 1e-6);

// 血池被打空后不能被回血「复活」（否则 SETTLE 期间可能把已判定的胜利翻掉）
pool.hp = 0;
m._finalEnding = null;
await wait(700);
console.log('血池归零后再等 50 游戏秒：', Math.round(pool.hp), '（应保持 0）');
assert.equal(pool.hp, 0, '死的 boss 不能被回血复活');

console.log('PASS');
m.dispose();