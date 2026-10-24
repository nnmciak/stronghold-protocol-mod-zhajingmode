import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle } from './helpers/battleHarness.js';
import { GameData } from '../server/match/gamedata.js';
import { getData } from '../server/data.js';

// 2026-10-25（owner）：炸惊专属策略「山岸风花 · 神通法」
//   【神通法】战斗中【S.E.E.S】干员部署时，获得 2×调度中心等级 的【S.E.E.S】层数。血量 22。
const BAND = 'band_zj_fuuka';
const cfg = JSON.parse(fs.readFileSync(new URL('../data/bands.json', import.meta.url), 'utf8'));
const rec = cfg[BAND];
assert.ok(rec, 'bands.json 里应有山岸风花');
assert.equal(rec.name, '山岸风花');
assert.equal(rec.effectName, '神通法');
assert.equal(rec.zjOnly, true, '仅限炸惊');
assert.equal(rec.totalHp, 22, '血量应为 22');
assert.equal(rec.sortId, 0, '与祀同档（按 bandId 排在祀前）');
assert.deepEqual(rec.modeTypeList, ['SINGLE', 'MULTI']);
assert.equal(rec.buffs[0].bbStr.key, 'zj_fuuka_sees_deploy');
assert.equal(rec.buffs[0].bb.mult, 2);

// 图标：assets 映射 + 文件存在
const assets = JSON.parse(fs.readFileSync(new URL('../data/assets.json', import.meta.url), 'utf8'));
assert.equal(assets.bands[BAND], '/assets/band/band_zj_fuuka.png?v=5');
assert.ok(fs.existsSync(new URL('../public/assets/band/band_zj_fuuka.png', import.meta.url)), '图标文件应存在');

// 只出现在炸惊；且排在祀前面
const zj = new GameData(getData(), 'mode_single_zhajing').bandIds();
const normal = new GameData(getData(), 'mode_single_normal').bandIds();
assert.ok(zj.includes(BAND), '炸惊要能选到');
assert.ok(!normal.includes(BAND), '普通模式不能出现');
assert.ok(zj.indexOf(BAND) < zj.indexOf('band_zj_si'), '应排在祀前面');

const units = [{ chessId: 'chess_zj_60_2_a', row: 9, col: 3 }, { chessId: 'chess_zj_60_4_a', row: 9, col: 4 }, { chessId: 'chess_char_5_02_a', row: 9, col: 5 }];
const bonds = { seesShip: { active: true, count: 2, tier: 1, layers: 0 } };
const run = (bandId) => {
  const h = makeBattle({ modeId: 'mode_single_zhajing', bandId, shopLevel: 3, bonds: { ...bonds }, units: units.map((u) => ({ ...u })), autoFinish: false });
  h.step(1);
  return { layers: h.b.players[0].bonds.seesShip.layers, errors: h.b.errors };
};
const base = run(null);
const withBand = run(BAND);
console.log('无策略:', base.layers, '| 山岸风花:', withBand.layers, '| errors:', JSON.stringify(withBand.errors));
assert.equal(withBand.errors.length, 0);
// 2 名 S.E.E.S 干员（虎狼丸、由加莉）各 +2×3=6 层，非 S.E.E.S 的缇缇不加
assert.equal(withBand.layers - base.layers, 12, '每人 +6 层，两名共 +12');
console.log('PASS');