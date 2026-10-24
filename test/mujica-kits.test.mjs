import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';
import { addFever, getFever, isFeverActive, FEVER_MAX } from '../server/sim/content/mujica.js';

const eid = 'enemy_mujica_test';
function scenario(code, skillIndex = 0, extra = {}) {
  const h = makeBattle({
    units: [{ chessId: `chess_zj_${code}_b`, row: 10, col: 7, skillIndex, uid: 1 }, ...(extra.units || [])],
    enemies: [{ key: eid, time: 0, route: { motion: 'WALK', start: [10,8], end: [10,8], checkpoints: [] } }],
    defs: { enemies: { [eid]: enemyRec({ key: eid, hp: 1e8, atk: 0, def: 0, res: 0, speed: 0 }) } },
    flags: { dpInit: 1000, startOpCooldown: 0 }, timeLimit: 120, seed: 728,
    autoFinish: false, captureNoisy: true, ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'units')),
  });
  h.step();
  for (const u of h.allies()) u.skill?.setTrigger('MANUAL');
  return h;
}
const clean = (h) => assert.deepEqual([...h.b._errKeys], [], 'simulation must not hide a content exception');
for (const [code, n] of [['oblvns',3],['mortis',2],['dolris',2],['amoris',2],['tmoris',2]]) {
  for (let i=0;i<n;i++) test(`${code} S${i+1} uses its authored kit and runs without fallback/errors`, () => {
    const h=scenario(code,i,{units:[{chessId:'chess_zj_oblvns_a',row:9,col:7,uid:2}]});
    const u=h.unit(`chess_zj_${code}_b`), ally=h.allies().find(a=>a!==u);
    assert.equal(u.skill.id,`skchr_${code}_${i+1}`);
    assert.equal(typeof u.kit.install,'function');
    ally.hp=ally.s.maxHp/2;
    const before=h.enemies()[0].hp;
    assert.equal(u.skill.activate('test',{free:true}),true);
    h.run(4);
    assert.ok(u.skill.activations>=1);
    if (code!=='dolris'||i===1) assert.ok(h.enemies()[0].hp<before);
    if(code==='dolris')assert.ok(ally.hp>ally.s.maxHp/2);
    clean(h);
  });
}

test('Fever caps at 450, isolates owners and suppresses all gain during its 20 seconds',()=>{
  const h=scenario('amoris',1),u=h.allies()[0];
  addFever(h.b,u,1000);assert.equal(getFever(h.b,u),FEVER_MAX);
  assert.equal(getFever(h.b,'p2'),0);
  const sp=u.skill.sp,charges=u.skill.charges;
  u.skill.activate('test',{free:true});
  assert.equal(isFeverActive(h.b,u),true);assert.equal(getFever(h.b,u),0);
  addFever(h.b,u,99);assert.equal(getFever(h.b,u),0);
  assert.equal(u.skill.sp,sp);assert.equal(u.skill.charges,charges);
  h.run(19);assert.equal(isFeverActive(h.b,u),true);
  h.run(1.1);assert.equal(isFeverActive(h.b,u),false);assert.equal(u.skill.active,false);
  assert.equal(u.mem.mujicaFever,false);clean(h);
});

test('Fever pauses a previously active skill, then restores its remaining duration',()=>{
  const h=scenario('amoris',1,{units:[{chessId:'chess_zj_mortis_b',row:9,col:7,skillIndex:1,uid:2}]});
  const a=h.unit('chess_zj_amoris_b'),m=h.unit('chess_zj_mortis_b');
  a.skill.activate('test',{free:true});h.run(2);const remaining=a.skill.timeLeft;
  addFever(h.b,a,450);m.skill.activate('test',{free:true});h.run(10);
  assert.ok(Math.abs(a.skill.timeLeft-remaining)<0.04);
  h.run(10.1);assert.equal(isFeverActive(h.b,a),false);
  assert.equal(a.skill.active,true);assert.ok(a.skill.timeLeft>remaining-0.2);
  assert.equal(m.skill.active,false);clean(h);
});

test('Mortis converts mitigated damage to apoptosis and gains Fever from each intake',()=>{
  const h=scenario('mortis',1),u=h.allies()[0],e=h.enemies()[0];
  const hp=u.hp;const gauge=u.elem.apoptosis;const f=getFever(h.b,u);
  h.b.dealDamage(e,u,{amount:100,type:'arts',canDodge:false});
  assert.ok(Math.abs((hp-u.hp)-70)<0.001);
  assert.ok(Math.abs((u.elem.apoptosis-gauge)-15)<0.001);
  assert.equal(getFever(h.b,u)-f,6);
  h.b.addBuff(u,{key:'test-invulnerable',flags:{invulnerable:true}});
  h.b.dealDamage(e,u,{amount:100,type:'arts'});
  assert.equal(getFever(h.b,u)-f,9);clean(h);
});

test('Mortis S1 substitute retains defense/blocking, and its module increases substitute HP',()=>{
  const h=scenario('mortis',0),u=h.allies()[0],e=h.enemies()[0];
  const originalMax=u.s.maxHp;
  u.skill.activate('test',{free:true});
  h.b.dealDamage(e,u,{amount:1e7,type:'true',canDodge:false});
  h.run(1.2);
  assert.equal(u.trait.doll,true);assert.equal(u.s.blockCnt,2);
  assert.ok(u.s.maxHp>originalMax*1.15);
  const attacks=u.stats.attacks;h.run(2);assert.equal(u.stats.attacks,attacks);clean(h);
});

test('Tmoris S1 responds to another member without spending SP and hits five times',()=>{
  const h=scenario('tmoris',0,{units:[{chessId:'chess_zj_mortis_b',row:9,col:7,skillIndex:0,uid:2}]});
  const u=h.unit('chess_zj_tmoris_b'),m=h.unit('chess_zj_mortis_b');
  const sp=u.skill.sp,charges=u.skill.charges;
  m.skill.activate('test',{free:true});
  assert.equal(u.skill.active,true);assert.equal(u.skill.sp,sp);assert.equal(u.skill.charges,charges);
  h.run(1.1);
  const hits=h.hooksOf('damaged').filter(c=>c.source===u&&c.target.side==='enemy'&&c.dmg.tags.includes('tmoris'));
  assert.equal(hits.length,5);clean(h);
});

test('Sakiko S2 retains instrument during Fever and changes it outside Fever',()=>{
  const h=scenario('oblvns',1),u=h.allies()[0];
  assert.equal(u.form,'oblvns_s2_a');
  u.skill.activate('test',{free:true});assert.equal(u.form,'oblvns_s2_b');
  addFever(h.b,u,450);u.skill.activate('test',{free:true});
  assert.equal(isFeverActive(h.b,u),true);assert.equal(u.form,'oblvns_s2_b');
  h.run(2);assert.ok(h.eventsOf('fx').some(e=>e[1]==='mujicaNote'));clean(h);
});

test('Sakiko S3 Fever prevents lethal retreat and releases that member at the end',()=>{
  const h=scenario('oblvns',2,{units:[{chessId:'chess_zj_amoris_a',row:9,col:7,uid:2}]});
  const u=h.unit('chess_zj_oblvns_b'),a=h.unit('chess_zj_amoris_a'),e=h.enemies()[0];
  addFever(h.b,u,450);u.skill.activate('test',{free:true});
  h.b.dealDamage(e,a,{amount:1e9,type:'true',canDodge:false});
  assert.equal(a.alive,true);assert.equal(a.hp,1);
  h.run(20.1);assert.equal(a.deployed,false);clean(h);
});

test('Mortis substitutes before the lower-priority S3 Fever death deferral',()=>{
  const h=scenario('oblvns',2,{units:[{chessId:'chess_zj_mortis_b',row:9,col:7,uid:2}]});
  const s=h.unit('chess_zj_oblvns_b'),m=h.unit('chess_zj_mortis_b'),e=h.enemies()[0];
  addFever(h.b,s,450);s.skill.activate('test',{free:true});
  h.b.dealDamage(e,m,{amount:1e9,type:'true',canDodge:false});
  assert.equal(m.trait.doll,true);
  assert.equal(h.b._mujica.get(m.ownerId).doomed.has(m.id),false);
  h.run(1.1);h.b.dealDamage(e,m,{amount:1e9,type:'true',canDodge:false});
  assert.equal(m.alive,true);assert.equal(m.hp,1);
  assert.equal(h.b._mujica.get(m.ownerId).doomed.has(m.id),true);clean(h);
});

test('Sakiko ordinary ranged notes retain 80 percent ATK and attack without a target',()=>{
  const h=scenario('oblvns',0,{units:[],enemies:[],defs:undefined});
  const u=h.allies()[0];h.run(0.5);
  assert.ok(u.mem.mujicaNotes.length>0);
  assert.ok(Math.abs(u.mem.mujicaNotes[0].atk-u.s.atk*u.s.atkScaleMul*0.8)<0.001);
  assert.ok(u.stats.attacks>0);clean(h);
});

test('Sakiko adds overlapping bandmate ranges without chaining another Sakiko composite range',()=>{
  const h=scenario('oblvns',2,{units:[{chessId:'chess_zj_tmoris_b',row:11,col:8,uid:2}]});
  const s=h.unit('chess_zj_oblvns_b'),t=h.unit('chess_zj_tmoris_b');h.run(0.3);
  const extra=t.rangeKeys.filter(k=>!s.baseRangeKeys.includes(k));
  assert.ok(extra.length>0);assert.ok(extra.every(k=>s.rangeKeys.includes(k)));
  clean(h);
});

test('Dolris BAR-X module scales ATK only when two other operators are inside her range',()=>{
  const solo=scenario('dolris',0),s=solo.allies()[0];solo.run(0.3);
  const group=scenario('dolris',0,{units:[{chessId:'chess_zj_amoris_a',row:9,col:7,uid:2},{chessId:'chess_zj_mortis_a',row:10,col:6,uid:3}]});
  const g=group.unit('chess_zj_dolris_b');group.run(0.3);
  // Amoris also grants its original +9% ATK aura, independent of the module's +8%.
  assert.ok(Math.abs(g.s.atk/s.s.atk-1.17)<0.001);clean(group);
});

test('Dolris actual heals grant Fever; bard regeneration and full-HP heals do not',()=>{
  const h=scenario('dolris',0,{units:[{chessId:'chess_zj_oblvns_a',row:9,col:7,uid:2}],enemies:[]});
  const d=h.unit('chess_zj_dolris_b'),s=h.unit('chess_zj_oblvns_a');
  h.b.heal(d,s,100);assert.equal(getFever(h.b,d),0);
  s.hp-=200;h.b.heal(d,s,100,{regen:true});assert.equal(getFever(h.b,d),0);
  h.b.heal(d,s,100);assert.equal(getFever(h.b,d),5);clean(h);
});

test('Dolris S2 removes existing bard regeneration immediately',()=>{
  const h=scenario('dolris',1),u=h.allies()[0];h.run(0.3);
  assert.ok(u.findBuff(`trait:bard:${u.id}`));
  u.skill.activate('test',{free:true});
  assert.equal(u.findBuff(`trait:bard:${u.id}`),null);clean(h);
});

test('Tmoris S2 attacks once per second even under a large attack-speed increase',()=>{
  const counts=[];
  for(const speed of [0,400]){
    const h=scenario('tmoris',1),u=h.allies()[0];
    h.b.addBuff(u,{key:'test:aspd',mods:{aspd:speed}});
    u.skill.activate('test',{free:true});const before=u.stats.attacks;
    h.run(2.95);counts.push(u.stats.attacks-before);clean(h);
  }
  assert.deepEqual(counts,[3,3]);
});

test('Amoris S2 resolves eight independently targeted strikes at the original animation timings',()=>{
  const h=scenario('amoris',1),u=h.allies()[0];
  // Let the already-started normal attack finish before starting the special attack sequence.
  h.run(0.8);u.skill.activate('test',{free:true});
  let strikes=0;h.b.on('mujicaStrike',({unit})=>{if(unit===u)strikes++;});
  h.run(2.8);assert.equal(strikes,8);clean(h);
});

test('battleEnd always publishes inactive Fever for the HUD and audio',()=>{
  const h=scenario('amoris',1),u=h.allies()[0];
  addFever(h.b,u,450);u.skill.activate('test',{free:true});
  h.b.forceEnd('test');h.step();
  assert.equal(isFeverActive(h.b,u),false);
  const events=h.events.filter(e=>e[0]==='fx'&&e[1]==='mujicaFever');
  assert.equal(events.at(-1)[4].active,false);clean(h);
});

for (const code of ['mortis','amoris','oblvns']) test(`${code} can attack an enemy it blocks behind its facing`,()=>{
  const h=scenario(code,code==='oblvns'?2:1,{enemies:[{key:eid,time:0,route:{motion:'WALK',start:[10,6.45],end:[10,6.45],checkpoints:[]}}]});
  const u=h.allies()[0],e=h.enemies()[0];assert.equal(e.blockedBy,u);
  u.skill.activate('test',{free:true});const hp=e.hp;h.run(3);
  assert.ok(e.hp<hp);assert.ok(u.stats.attacks>0);clean(h);
});

test('five-member notes, random strikes and Fever are deterministic for a replay seed',()=>{
  const play=()=>{
    const h=scenario('oblvns',2,{units:[
      {chessId:'chess_zj_mortis_b',row:9,col:7,skillIndex:1,uid:2},
      {chessId:'chess_zj_dolris_b',row:10,col:6,skillIndex:1,uid:3},
      {chessId:'chess_zj_amoris_b',row:11,col:7,skillIndex:1,uid:4},
      {chessId:'chess_zj_tmoris_b',row:11,col:8,skillIndex:0,uid:5},
    ]});
    addFever(h.b,h.allies()[0],450);h.allies()[0].skill.activate('test',{free:true});h.run(8);clean(h);
    return {snapshot:h.snapshot(),events:h.events};
  };
  assert.deepEqual(play(),play());
});

test('Sakiko instant S1 publishes a performing animation window without extending its skill',()=>{
  const h=scenario('oblvns',0),u=h.allies()[0];
  addFever(h.b,u,450);u.skill.activate('test',{free:true});
  assert.equal(u.skill.active,false,'instant effect still ends in its original tick');
  const until=u.mem.mujicaInstantUntil;
  assert.ok(until>h.b.time);
  h.run(0.3);
  const during=h.events.filter(e=>e[0]==='fx'&&e[1]==='mujicaFever').at(-1)[4];
  assert.equal(during.active,true);assert.equal(during.performing,true);assert.equal(during.vocal,false);
  // Stop further test casts, leaving the already emitted notes and effect untouched.
  u.skill.nextCastAt=Infinity;
  h.run(Math.max(0,until-h.b.time)+0.4);
  const after=h.events.filter(e=>e[0]==='fx'&&e[1]==='mujicaFever').at(-1)[4];
  assert.equal(after.active,true);assert.equal(after.performing,false);
  assert.equal(u.skill.active,false);clean(h);
});

test('S1 animation counts for five-person vocals only after an actual Fever cast',()=>{
  const h=scenario('oblvns',0,{units:[
    {chessId:'chess_zj_mortis_b',row:9,col:7,skillIndex:1,uid:2},
    {chessId:'chess_zj_dolris_b',row:10,col:6,skillIndex:1,uid:3},
    {chessId:'chess_zj_amoris_b',row:11,col:7,skillIndex:1,uid:4},
    {chessId:'chess_zj_tmoris_b',row:11,col:8,skillIndex:0,uid:5},
  ]});
  const u=h.unit('chess_zj_oblvns_b');addFever(h.b,u,450);u.skill.activate('test',{free:true});h.run(0.3);
  const music=h.events.filter(e=>e[0]==='fx'&&e[1]==='mujicaFever').at(-1)[4];
  assert.equal(music.performing,true);assert.equal(music.vocal,true);clean(h);
});

test('Sakiko S2 does not obtain a performing window from its persistent instrument',()=>{
  const h=scenario('oblvns',1),u=h.allies()[0];addFever(h.b,u,450);
  u.skill.activate('test',{free:true});h.run(0.3);
  const music=h.events.filter(e=>e[0]==='fx'&&e[1]==='mujicaFever').at(-1)[4];
  assert.equal(music.active,true);assert.equal(music.performing,false);assert.equal(music.vocal,false);
  assert.equal(u.mem.mujicaInstantUntil,undefined);clean(h);
});
