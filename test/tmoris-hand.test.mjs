import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { getDefaultRegistry } from '../server/match/effectsMeta.js';

function run(where, elite = false) {
  const m = new Match({ roomCode:'HAN', mode:'solo', difficulty:'ZHAJING', modeId:'mode_single_zhajing', seed: 7,
    data: getData(), registry: getDefaultRegistry(),
    seats: [{ seat: 0, playerId: 'p1', name: 't', isBot: false, connected: true }], send: () => true, broadcast: () => {}, onEnd: () => {} });
  m.phase='PREP'; m.round=1;
  const ps=m.players.get('p1'); ps.funds=400;
  const cells=[...ps.deployMap()].filter(([,c])=>c==='melee').map(([k])=>k);
  let i=0;
  const add=(id)=>{ const p=ps.newPiece('chess',id); ps.board.set(cells[i++],p); return p; };
  add('chess_zj_oblvns_a'); add('chess_zj_mortis_a');
  const han=ps.newPiece('chess', elite ? 'chess_zj_tmoris_b' : 'chess_zj_tmoris_a');
  if (where==='hand') ps.hand[ps.hand.findIndex((x)=>!x)]=han; else ps.board.set(cells[i++],han);
  ps.recompute();
  ps.layers.mujicaShip = 10;
  const before = ps.layers.mujicaShip;
  const r = ps.refresh();
  const after = ps.layers.mujicaShip;
  console.log(where.padEnd(5), elite ? '精锐' : '普通', '| ok', r && r.ok, '| 颂乐人偶', before, '→', after, '| errors', m.dispatcher.errors);
  m.dispose();
  return { before, after };
}

const h1 = run('hand');
assert.equal(h1.after - h1.before, 2, '整备区也应当 +2');
const h2 = run('board');
assert.equal(h2.after - h2.before, 2, '在场照旧 +2');
const h3 = run('hand', true);
assert.equal(h3.after - h3.before, 2, '精锐在整备区也 +2');
console.log('PASS');