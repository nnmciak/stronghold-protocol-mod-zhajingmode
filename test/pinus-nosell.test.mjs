import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { getDefaultRegistry } from '../server/match/effectsMeta.js';

const m = new Match({ roomCode:'PIN', mode:'solo', difficulty:'ZHAJING', modeId:'mode_single_zhajing', seed: 9, data:getData(), registry:getDefaultRegistry(), seats:[{seat:0,playerId:'p1',name:'t',isBot:false,connected:true}], send:()=>true, broadcast:()=>{}, onEnd:()=>{} });
m.phase='PREP'; m.round=3;
const ps=m.players.get('p1');
ps.funds=100;
const piece=ps.newPiece('chess','chess_zj_amoris_a');
const cells=[...ps.deployMap()].filter(([,cls])=>cls==='melee').map(([k])=>k);
ps.board.set(cells[0], piece); ps.recompute();
const key='jibian:hongsongqishituan:nosell';
// 模拟抽到卡：计数器写下当前回合号（与 jibian.js 的 ON_PICK 一致）
ps.counters[key]=m.round;
const blocked=ps.sell(piece.uid);
console.log('第3回合出售:', JSON.stringify(blocked));
assert.ok(blocked && blocked.error, '本回合应当禁止出售');
// 下一回合应当解禁
m.round=4;
const ok=ps.sell(piece.uid);
console.log('第4回合出售:', JSON.stringify(ok));
assert.ok(!ok || !ok.error, '下一回合应当可以出售');
console.log('PASS');
m.dispose();
