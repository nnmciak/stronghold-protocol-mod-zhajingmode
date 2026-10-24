import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { getDefaultRegistry } from '../server/match/effectsMeta.js';

const m = new Match({
  roomCode: 'BAN', mode: 'solo', difficulty: 'ZHAJING', modeId: 'mode_single_zhajing', seed: 7,
  data: getData(), registry: getDefaultRegistry(),
  seats: [{ seat: 0, playerId: 'p1', name: 't', isBot: false, connected: true, bans: { ZHAJING: { bonds: ['egirShip'], favorites: [] } } }],
  send: () => true, broadcast: () => {}, onEnd: () => {},
});
m.phase = 'PREP'; m.round = 1;
const ps = m.players.get('p1');
console.log('ps.bans:', JSON.stringify(ps.bans && ps.bans.ZHAJING));
console.log('玩家禁用盟约:', JSON.stringify([...(ps.disabledBonds || [])]));
const gd = m.gd;
const visible = gd.visibleChess;
const aegir = visible.filter((id) => { const c = gd.chess(id); return c && Array.isArray(c.bonds) && c.bonds.includes('egirShip'); });
console.log('本局可见的阿戈尔干员:', aegir.map((id) => id + '/' + gd.chess(id).name).join(', '));
// 用与池子相同的规则算「被移除」
const off = new Set([...(ps.disabledBonds || []), ...(gd.modeInactiveBonds || [])]);
const removed = aegir.filter((id) => { const c = gd.chess(id); const bs = c.bonds || []; return bs.length && bs.every((b) => off.has(b)); });
const kept = aegir.filter((id) => !removed.includes(id));
console.log('移除:', removed.map((id) => gd.chess(id).name).join(', ') || '(无)');
console.log('保留:', kept.map((id) => gd.chess(id).name + '(' + (gd.chess(id).bonds || []).join('+') + ')').join(', ') || '(无)');
m.dispose();
