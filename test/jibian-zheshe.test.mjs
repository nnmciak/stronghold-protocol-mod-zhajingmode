import assert from 'node:assert/strict';
import { makeBattle } from './helpers/battleHarness.js';

// 折射（jibian_zheshe）：你的所有干员法术抗性 +70 —— 旧代码在 install() 里误用 allies()（未定义），
// battleStart 直接抛 ReferenceError（线上日志：jibian.js:1065 allies is not defined），这张卡等于没生效。
const run = (effects) => makeBattle({
  modeId: 'mode_single_zhajing', autoFinish: false, timeLimit: 30,
  units: [{ chessId: 'chess_char_1_01_a', row: 9, col: 4 }],
  playerEffects: effects,
});
{
  const h = run([{ key: 'jibian:jibian_zheshe' }]);
  h.step(2);
  const u = h.unit('chess_char_1_01_a');
  console.log('带折射 | errors:', JSON.stringify(h.b.errors), '| res:', u.s.res);
  assert.deepEqual(h.b.errors, [], 'battleStart 不应再抛 allies is not defined');
  assert.ok(u.s.res >= 70, '法术抗性应 +70，实际 ' + u.s.res);
}
{
  const h = run([]);
  h.step(2);
  console.log('不带折射 | errors:', JSON.stringify(h.b.errors));
  assert.deepEqual(h.b.errors, []);
}
console.log('PASS');