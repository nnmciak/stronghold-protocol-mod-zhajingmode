import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { getDefaultRegistry } from '../server/match/effectsMeta.js';

const profile = { byDifficulty: { ZHAJING: { bonds: ['egirShip'], favorites: [] } } };
const m = new Match({
  roomCode: 'DIY', mode: 'solo', difficulty: 'ZHAJING', modeId: 'mode_single_zhajing', seed: 11,
  data: getData(), registry: getDefaultRegistry(),
  seats: [{ seat: 0, playerId: 'p1', name: 't', isBot: false, connected: true, bans: profile }],
  send: () => true, broadcast: () => {}, onEnd: () => {},
});
const ps = m.players.get('p1');
console.log('buildDiyStock 是函数?', typeof ps.buildDiyStock);
const r = ps.buildDiyStock(new Set(['egirShip']));
console.log('返回 keys:', Object.keys(r).join(','), '| stock entries:', r.stock && r.stock.entries ? r.stock.entries.size : '?');
console.log('deniedBonds:', JSON.stringify(ps.deniedBonds));
// 直接调重抽（如果状态允许）
try {
  const ok = m.completeSetupReroll();
  console.log('completeSetupReroll 返回:', ok && ok.ok !== undefined ? JSON.stringify(ok).slice(0,120) : String(ok));
} catch (e) { console.log('reroll threw:', e.message); }
console.log('reroll 后 diyStock entries:', ps.diyStock && ps.diyStock.entries ? ps.diyStock.entries.size : '?');
m.dispose();
