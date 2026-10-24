import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { getDefaultRegistry } from '../server/match/effectsMeta.js';
import * as mujicaBond from '../server/sim/content/mujicaBond.js';

const registry = getDefaultRegistry();
const m = new Match({ roomCode:'SHOP', mode:'solo', difficulty:'ZHAJING', modeId:'mode_single_zhajing', seed:3, data:getData(), registry, seats:[{seat:0,playerId:'p1',name:'t',isBot:false,connected:true}], send:()=>true, broadcast:()=>{}, onEnd:()=>{} });
m.phase='PREP'; m.round=1;
const ps=m.players.get('p1');
ps.funds=500;
const cells=[...ps.deployMap()].filter(([,cls])=>cls==='melee').map(([k])=>k);
let i=0;
for (const code of ['oblvns','mortis']) { const p=ps.newPiece('chess','chess_zj_'+code+'_a'); ps.board.set(cells[i++],p); ps.recompute(); }
ps.shop.level=2;
for (let k=0;k<5;k++) ps.refresh();
console.log('手牌1:', ps.hand.filter(Boolean).map(p=>p.id).join(',') || '-');
m.round=2; ps.shop.freeRefreshes=1;
ps.refresh();
console.log('手牌2:', ps.hand.filter(Boolean).map(p=>p.id).join(',') || '-');
console.log('counters:', JSON.stringify(ps.counters||{}));
console.log('errors:', m.dispatcher.errors);
m.dispose();
