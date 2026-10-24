import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { getDefaultRegistry } from '../server/match/effectsMeta.js';

const m = new Match({
  roomCode: 'TRAIT', mode: 'solo', difficulty: 'ZHAJING', modeId: 'mode_single_zhajing', seed: 5,
  data: getData(), registry: getDefaultRegistry(),
  seats: [{ seat: 0, playerId: 'p1', name: 't', isBot: false, connected: true }],
  send: () => true, broadcast: () => {}, onEnd: () => {},
});
m.phase = 'PREP'; m.round = 1;
const ps = m.players.get('p1');
ps.funds = 100;
const cells = [...ps.deployMap()].filter(([, cls]) => cls === 'melee').map(([k]) => k);
const piece = ps.newPiece('chess', 'chess_zj_amoris_a');
ps.board.set(cells[0], piece);
ps.recompute();
console.log('盟约:', JSON.stringify([...ps.bondIds]));
console.log('层数(前):', JSON.stringify(ps.layers || {}));
const before = { funds: ps.pendingFunds || 0, layers: JSON.stringify(ps.layers || {}) };
try {
  m.meta.dispatch(ps, 'onPrepEnd', { piece, where: 'board', kind: 'garrison' });
  console.log('dispatch ok');
} catch (e) { console.log('dispatch 抛错:', e.message); }
console.log('层数(后):', JSON.stringify(ps.layers || {}));
console.log('待发资金:', JSON.stringify(ps.pendingFunds ?? null));
console.log('garrison 文本:', JSON.parse(JSON.stringify(m.gd.garrison ? (m.gd.garrison('garrison_mujica_amoris')?.desc ?? 'n/a') : 'n/a')));
m.dispose();
