import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { getDefaultRegistry } from '../server/match/effectsMeta.js';
const m=new Match({roomCode:'T',mode:'solo',difficulty:'ZHAJING',modeId:'mode_single_zhajing',seed:3,data:getData(),registry:getDefaultRegistry(),seats:[{seat:0,playerId:'p1',name:'t',isBot:false,connected:true}],send:()=>true,broadcast:()=>{},onEnd:()=>{}});
m.phase='PREP'; m.round=1;
const ps=m.players.get('p1');
const cells=[...ps.deployMap()].filter(([,cls])=>cls==='melee').map(([k])=>k);
let i=0;
for (const cid of ['chess_zj_amoris_a','chess_zj_tmoris_a']) { const p=ps.newPiece('chess',cid); ps.board.set(cells[i++],p); ps.recompute(); }
console.log('bond active?', !!ps.bonds.mujicaShip?.active, '| layers', ps.layers.mujicaShip);
ps.layers.mujicaShip=0;
const added=ps.addLayers('mujicaShip', 10, { requireActive: true, reason:'test' });
console.log('addLayers(10) 返回', added, '| 现在层数', ps.layers.mujicaShip);
ps.layers.mujicaShip=0;
const added5=ps.addLayers('mujicaShip', 5, { requireActive: true, reason:'test' });
console.log('addLayers(5) 返回', added5, '| 现在层数', ps.layers.mujicaShip);
console.log('盟约最大层数?', JSON.stringify({ maxCount: m.gd.bond('mujicaShip').maxCount, thresholds: m.gd.bond('mujicaShip').thresholds }));
m.dispose();
