import { GameData } from '../server/match/gamedata.js';
import { getData } from '../server/data.js';
const find=(gd)=>Object.entries(gd.shopItemsByTier).flatMap(([t,ids])=>ids).filter(id=>/sees_armband|mujica_mask/.test(id));
for (const modeId of ['mode_multi_abyss','mode_multi_hard','mode_single_normal','mode_single_zhajing','mode_multi_zhajing']) {
  const gd=new GameData(getData(), modeId);
  console.log(modeId.padEnd(20), '| zj?', gd.zhajing, '| 袖章/面具在商店池:', find(gd).join(',') || '(无)');
}
