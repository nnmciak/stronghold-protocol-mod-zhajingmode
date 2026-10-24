import { buildNormalWave } from '../server/match/waves.js';
import { createRng, deriveSeed } from '../server/sim/rng.js';
import { getData } from '../server/data.js';
import { GameData } from '../server/match/gamedata.js';

const gd = new GameData(getData(), 'mode_single_zhajing');
const mk = (seed) => createRng(deriveSeed(1234, `w:${seed}`));
const count = (w) => w.spawns.reduce((n, s) => n + (Number.isFinite(s.count) ? s.count : 0), 0);
for (const round of [3, 4, 5]) {
  const base = buildNormalWave(gd, mk(round), gd.factions ? gd.factions : null, round, { jibian: [] });
  const horde = buildNormalWave(gd, mk(round), gd.factions ? gd.factions : null, round, { jibian: ['ejibian_jiangshiweicheng'] });
  const groups = (w) => w.spawns.length;
  console.log(`R${round}`, '| 原:', count(base), '只 /', groups(base), '组  |  丧尸围城:', count(horde), '只 /', groups(horde), '组  | 倍数:', (count(horde)/Math.max(1,count(base))).toFixed(2));
}
