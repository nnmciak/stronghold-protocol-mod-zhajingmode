import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { getDefaultRegistry } from '../server/match/effectsMeta.js';

const profile = { byDifficulty: { ZHAJING: { bonds: ['egirShip'], favorites: [] } } };
const m = new Match({
  roomCode: 'BAN', mode: 'solo', difficulty: 'ZHAJING', modeId: 'mode_single_zhajing', seed: 7,
  data: getData(), registry: getDefaultRegistry(),
  seats: [{ seat: 0, playerId: 'p1', name: 't', isBot: false, connected: true, bans: profile }],
  send: () => true, broadcast: () => {}, onEnd: () => {},
});
m.phase = 'PREP'; m.round = 1;
const ps = m.players.get('p1');
const pool = ps.pool();
const has = (id) => !!(pool.entries && pool.entries.has ? pool.entries.has(id) : false);
console.log('bannedChess 数:', (ps.bannedChess || []).length);
console.log('池子里还有 浊心斯卡蒂(chess_zj_81_a)?', has('chess_zj_81_a'));
console.log('池子里还有 幽灵鲨(chess_zj_20_a)?', has('chess_zj_20_a'));
console.log('池子里还有 乌尔比安(chess_zj_04_a)?', has('chess_zj_04_a'));
// 商店 roll 1000 次看会不会出她
const gd = m.gd;
let hits = 0;
for (let i = 0; i < 3000; i++) {
  const id = pool.roll(m.rngShop || m.rngMeta || { int: (n) => Math.floor(Math.random() * n) }, {});
  if (id === 'chess_zj_81_a') hits++;
}
console.log('3000 次随机里出现浊心斯卡蒂:', hits);
m.dispose();
