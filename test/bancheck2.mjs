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
console.log('ps.bans?', !!ps.bans, '| deniedBonds:', JSON.stringify(ps.deniedBonds));
const gd = m.gd;
const visible = gd.visibleChess;
const aegir = visible.filter((id) => { const c = gd.chess(id); return c && Array.isArray(c.bonds) && c.bonds.includes('egirShip'); });
const bannedSet = new Set(ps.bannedChess || []);
console.log('阿戈尔干员 7 位:', aegir.map((id) => gd.chess(id).name).join(', '));
for (const id of aegir) {
  const c = gd.chess(id);
  console.log('  ', c.name.padEnd(6), '| bonds', (c.bonds || []).join('+'), '| 被移除?', bannedSet.has(id));
}
m.dispose();
