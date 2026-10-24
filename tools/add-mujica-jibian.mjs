// Project-owner rules for three 炸惊 cards. Keep both mode pools and the readable
// bond mirror in sync; runtime bond definitions live in content/jibianBonds.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jibianBonds } from '../server/sim/content/jibianBonds.js';
import { MORTIS_BEAST_CARD, MORTIS_BEAST_TRAIT } from '../shared/mujicaJibian.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const write = (p, v) => fs.writeFileSync(path.join(root, p), JSON.stringify(v, null, 2) + '\n');
const cards = [
  {
    effectId: 'jibian_yinhezhanjian', name: '银河战舰', rarity: 'epic',
    desc: '分别获得一名八幡海铃、祐天寺若麦、三角初华。',
    flavor: '“现在我们是一丘之貉了。”', iconBond: 'mujicaShip',
  },
  {
    effectId: 'jibian_yiwangnvshen', name: '遗忘女神', rarity: 'epic',
    desc: '获得一名精锐丰川祥子。',
    flavor: '“你愿意将人生托付于我吗？”',
  },
  {
    effectId: MORTIS_BEAST_CARD, name: '多首野兽', rarity: 'legend',
    desc: `将若叶睦的特质改变为“${MORTIS_BEAST_TRAIT}”`,
    flavor: '你是多首的怪物',
  },
];
const config = read('data/config.json');
for (const modeId of ['mode_single_zhajing', 'mode_multi_zhajing']) {
  const pool = config.modes[modeId].jibian.pool;
  for (const card of cards) {
    const index = pool.findIndex(c => c.effectId === card.effectId);
    if (index < 0) pool.push({ ...card });
    else pool[index] = { ...card };
  }
}
write('data/config.json', config);
const mirror = read('data/jibianBonds.json');
const ave = jibianBonds().find(b => b.id === 'ave_mujica');
if (!ave) throw new Error('Missing runtime ave_mujica bond');
const index = mirror.bonds.findIndex(b => b.id === ave.id);
if (index < 0) mirror.bonds.push(ave);
else mirror.bonds[index] = ave;
write('data/jibianBonds.json', mirror);
console.log('Wrote three Mujica cards to both 炸惊 pools and the Ave Mujica bond mirror.');
