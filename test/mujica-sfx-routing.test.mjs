import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AudioManager, mujicaBankForUnit } from '../public/js/audio.js';

const manifest=JSON.parse(fs.readFileSync(new URL('../data/assets.json',import.meta.url),'utf8'));
const ids={oblvns:'char_4182_oblvns',mortis:'char_4183_mortis',dolris:'char_4184_dolris',amoris:'char_4185_amoris',tmoris:'char_4186_tmoris'};
const allowed=bank=>(manifest.audio.mujicaBankDefs?.[bank]||[]).map(r=>r.url).filter(Boolean)
  .concat([manifest.audio.mujicaBanks?.[bank]].flat().filter(x=>typeof x==='string'));
function setup(code,index=0) {
  const calls=[];
  const manager=new AudioManager({getManifest:()=>manifest,win:null,random:()=>0});
  manager.ctx={currentTime:0};
  manager._play=(url,opts)=>{calls.push({url,opts});return true;};
  manager.voice=()=>false;
  manager._warn=(tag,error)=>{throw new Error(`${tag}: ${error}`);};
  manager.setFieldUnits([{id:1,spine:ids[code],kind:'op',side:'ally',skillIndex:index},{id:2,spine:'enemy_test',kind:'enemy',side:'enemy'}]);
  return {manager,calls};
}

test('each of the eleven skill-start routes resolves a shipped original sound bank',()=>{
  for(const [code,count]of [['oblvns',3],['mortis',2],['dolris',2],['amoris',2],['tmoris',2]])for(let index=0;index<count;index++) {
    const {manager,calls}=setup(code,index);
    manager.handleBattleEvents([['skill',1,1]]);
    assert.ok(calls.length>0,`${code} S${index+1}`);
    const bank=mujicaBankForUnit(ids[code],'skill',index,true,null);
    assert.ok(allowed(bank).includes(calls[0].url),bank);
    assert.ok(fs.existsSync(new URL(`../public${calls[0].url}`,import.meta.url)),calls[0].url);
  }
});

test('all eight Sakiko S1 note hits use the original custom impact sound',()=>{
  const {manager,calls}=setup('oblvns');
  const bank='battle.ON_CUSTOM_TRIGGER.projectile_chr_oblvns_s1_hit';
  for(let n=1;n<=8;n++)manager.handleBattleEvents([['fx','mujicaNote',0,0,{id:1,state:'hit',projectile:`projectile_chr_oblvns_s1_${n}`}]]);
  assert.equal(calls.length,8);
  assert.ok(calls.every(call=>allowed(bank).includes(call.url)));
  manager.handleBattleEvents([['fx','mujicaNote',0,0,{id:1,state:'move',projectile:'projectile_chr_oblvns_s1_1'}],['fx','mujicaNote',0,0,{id:1,state:'end',projectile:'projectile_chr_oblvns_s1_1'}]]);
  assert.equal(calls.length,8,'movement/end frames must not replay impact sounds');
});

test('Sakiko S3 physical and arts notes route their distinct spawn and impact banks',()=>{
  const {manager,calls}=setup('oblvns',2);
  for(const kind of ['phy','mag'])for(const state of ['spawn','hit']) {
    const projectile=`projectile_chr_oblvns_s3_${kind}`;
    const bank=`battle.ON_PROJECTILE_${state==='spawn'?'BORN':'HIT'}.${projectile}`;
    manager.handleBattleEvents([['fx','mujicaNote',0,0,{id:1,state,projectile}]]);
    assert.ok(allowed(bank).includes(calls.at(-1)?.url),bank);
  }
  assert.equal(calls.length,4);
});

test('ordinary and S2 notes use the attack action plus impact, without borrowing separate talent-spawn banks',()=>{
  for(const [index,projectile]of [[0,'projectile_chr_oblvns'],[1,'projectile_chr_oblvns_s2'],[1,'projectile_chr_oblvns_s2_slow']]) {
    const {manager,calls}=setup('oblvns',index);
    if(index===1)manager.handleBattleEvents([['skill',1,1]]);
    calls.length=0;
    manager.handleBattleEvents([['atk',1,2,'none']]);
    assert.equal(calls.length,1,'the firing action is audible');
    assert.ok(allowed('battle.ON_ABILITY_ON.char_4182_oblvns.attack.0.1').includes(calls[0].url));
    manager.handleBattleEvents([['fx','mujicaNote',0,0,{id:1,state:'spawn',projectile}]]);
    assert.equal(calls.length,1,'the original bank has no separate spawn sound for this projectile');
    manager.handleBattleEvents([['fx','mujicaNote',0,0,{id:1,state:'hit',projectile}]]);
    assert.equal(calls.length,2);
    assert.ok(allowed(`battle.ON_PROJECTILE_HIT.${projectile}`).includes(calls[1].url));
  }
});

test('Sakiko S3 action and the two note colors retain their independently authored sounds',()=>{
  const {manager,calls}=setup('oblvns',2);
  manager.handleBattleEvents([['skill',1,1]]);calls.length=0;
  manager.handleBattleEvents([['atk',1,2,'none'],
    ['fx','mujicaNote',0,0,{id:1,state:'spawn',projectile:'projectile_chr_oblvns_s3_phy'}],
    ['fx','mujicaNote',0,0,{id:1,state:'spawn',projectile:'projectile_chr_oblvns_s3_mag'}]]);
  assert.equal(calls.length,3);
  assert.ok(allowed('battle.ON_ABILITY_START.char_4182_oblvns.attack.4.1').includes(calls[0].url));
  assert.ok(allowed('battle.ON_PROJECTILE_BORN.projectile_chr_oblvns_s3_phy').includes(calls[1].url));
  assert.ok(allowed('battle.ON_PROJECTILE_BORN.projectile_chr_oblvns_s3_mag').includes(calls[2].url));
});

test('Nyamu drum, Mutsumi shot and Uika pulse audio follow explicit timed events, not generic damage numbers',()=>{
  const cases=[
    ['amoris',1,'battle.ON_PROJECTILE_BORN.projectile_chr_amoris_s2_1'],
    ['mortis',1,'battle.ON_BUFF_START.mortis_s2_spell_on_audio'],
    ['dolris',1,'battle.ON_BUFF_START.dolris_s2_attack_audio'],
  ];
  for(const [code,index,bank]of cases) {
    const {manager,calls}=setup(code,index);
    manager.handleBattleEvents([['skill',1,1]]);calls.length=0;
    manager.handleBattleEvents([['atk',1,2,'none'],['dmg',2,100,'phys']]);
    const before=calls.length;
    manager.handleBattleEvents([['fx','mujicaSound',0,0,{id:1,bank}]]);
    assert.equal(calls.length,before+1,bank);
    assert.ok(allowed(bank).includes(calls.at(-1).url),bank);
    manager.handleBattleEvents([['dmg',2,100,'arts'],['dmg',2,100,'phys']]);
    assert.equal(calls.length,before+1,'later damage ticks must not replay the timed event');
  }
});

test('Umiri returns to normal attack sound after S2 ends',()=>{
  const {manager,calls}=setup('tmoris',1);
  manager.handleBattleEvents([['skill',1,1]]);calls.length=0;
  manager.handleBattleEvents([['atk',1,2,'none']]);
  assert.ok(allowed('battle.ON_ABILITY_ON.char_4186_tmoris.attack.1').includes(calls.at(-1)?.url));
  manager.handleBattleEvents([['skill',1,0],['atk',1,2,'none']]);
  assert.ok(allowed('battle.ON_ABILITY_ON.char_4186_tmoris.attack.0').includes(calls.at(-1)?.url));
});

test('the original 40/30/30 S1 sound weights and per-entry pitch/volume are honored',()=>{
  const bank='battle.ON_ABILITY_START.skchr_oblvns_1';
  const rows=manifest.audio.mujicaBankDefs[bank];
  assert.deepEqual(rows.map(r=>r.weight),[40,30,30]);
  for(const [roll,index]of [[0.1,0],[0.5,1],[0.9,2]]) {
    const {manager,calls}=setup('oblvns');
    manager.random=()=>roll;
    manager._playMujicaBank(bank,'test',0.8);
    assert.equal(calls[0].url,rows[index].url);
    assert.equal(calls[0].opts.rate,rows[index].minPitch+(rows[index].maxPitch-rows[index].minPitch)*roll);
    assert.equal(calls[0].opts.volume,0.8*(rows[index].minVolume+(rows[index].maxVolume-rows[index].minVolume)*roll));
  }
});
