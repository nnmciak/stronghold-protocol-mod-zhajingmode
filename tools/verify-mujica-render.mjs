// Temporary visual regression replay using production Battle + renderer.
import fs from 'node:fs';
import { makeBattle, enemyRec } from '../test/helpers/battleHarness.js';
import { addFever } from '../server/sim/content/mujica.js';
const units = [
  ['oblvns', 10, 5], ['mortis', 9, 7], ['dolris', 11, 5], ['amoris', 10, 7], ['tmoris', 11, 7],
].map(([code, row, col]) => ({ chessId: `chess_zj_${code}_b`, row, col }));
const h = makeBattle({ units, modeId: 'mode_single_zhajing', seed: 42, timeLimit: 45, autoFinish: false,
  enemies: [9, 10, 11, 12].map((row) => ({ key: 'enemy_1001_bigbo', time: 0,
    route: { motion: 'WALK', start: [row, 8], end: [row, 8], checkpoints: [] } })),
  defs: { enemies: { enemy_1001_bigbo: enemyRec({ key: 'enemy_1001_bigbo', hp: 1e8, atk: 100, def: 200, res: 20, speed: 0 }) } },
  bonds: { mujicaShip: { active: true, tier: 4, count: 5, layers: 100 } },
  flags: { startOpCooldown: 0, layerGainsEnabled: true }, captureNoisy: false,
});
h.step(2);
const replay = { stage: h.b.stage, meta: h.b.fieldMeta(), frames: [] };
for (let i = 0; i < 675; i++) {
  if (i === 70) { addFever(h.b, 'p1', 450); h.b.allyUnits.find((u) => u.def.charId === 'char_4182_oblvns').skill.activate('visual-check', { free: true }); }
  h.b.step();
  replay.frames.push({ gt: h.b.time, snap: h.b.snapshot(), ev: h.b.drainEvents() });
}
if (h.b.errors.length) throw new Error(JSON.stringify(h.b.errors));
fs.writeFileSync('public/__mujica-check.json', JSON.stringify(replay));
console.log(JSON.stringify({ frames: replay.frames.length, errors: h.b.errors, feverFrames: replay.frames.filter(f => f.ev.some(e=>e[0]==='fx'&&e[1]==='mujicaFever'&&e[4]?.active)).length }));
