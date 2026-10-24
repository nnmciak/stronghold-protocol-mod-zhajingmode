import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkillFx } from '../public/js/render/vfx/skillfx.js';
import { FxWiring } from '../public/js/render/vfx/wiring.js';
import { parseAtlas } from '../tools/assets/atlas.mjs';
import { parseSkel } from '../tools/assets/skel.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets=JSON.parse(fs.readFileSync(path.join(root,'data/assets.json')));
const index=JSON.parse(fs.readFileSync(path.join(root,'public/assets/local/fx/index.json')));
const ids=['char_4182_oblvns','char_4183_mortis','char_4184_dolris','char_4185_amoris','char_4186_tmoris'];
const local=url=>path.join(root,'public',decodeURIComponent(url));

test('all five operators have decodable original models, full art, skins and complete voice files',()=>{
  for(const id of ids) {
    const c=assets.chars[id];
    assert.ok(c?.illustration && c.illustrationE2);
    assert.equal(Object.keys(c.skins).length,1);
    assert.equal(Object.keys(assets.audio.voiceArchive[id]).length,38);
    for(const costume of [c,...Object.values(c.skins)]) {
      const models=Object.values(costume.spine);
      assert.equal(models.length,id==='char_4184_dolris'?1:2);
      for(const model of models) {
        const atlas=parseAtlas(fs.readFileSync(local(model.atlas),'utf8'));
        const meta=parseSkel(fs.readFileSync(local(model.skel)),new Set(atlas.pages.flatMap(p=>p.regions)));
        assert.deepEqual(meta.missingRegions,[]);
        assert.ok(meta.animations.includes('Idle'));
        for(const file of model.textures) assert.equal(fs.readFileSync(local(file)).subarray(1,4).toString(),'PNG');
      }
    }
    for(const url of Object.values(assets.audio.voiceArchive[id])) assert.ok(fs.statSync(local(url)).size>1000);
  }
  for(const url of Object.values(assets.audio.mujicaFever)) assert.ok(fs.statSync(local(url)).size>100000);
});

test('original costume replacement pairs all resolve to installed effects',()=>{
  for(const id of ids) {
    const skin=id+'@avemujica#1';
    const map=index.mujicaSkinMaps[skin];
    assert.ok(index.units[id]);assert.ok(index.units[skin]);assert.ok(index.skins[skin]);
    assert.ok(Object.keys(map.replacements).length>0);
    for(const replacement of Object.values(map.replacements)) {
      assert.ok(index.prefabs[replacement],replacement);
      assert.ok(fs.statSync(path.join(root,'public/assets/local/fx',index.prefabs[replacement].file)).size>10);
    }
    const wiring=new FxWiring({active:true,lib:{},time:0},{record:()=>({charId:id})});
    wiring.idx=index;
    assert.equal(wiring.unitKeyOf({id,info:{id,spine:id,skin}}),skin);
  }
});

test('a tracked note keeps one original effect through movement and piercing, and clears at end',()=>{
  const skin='char_4182_oblvns@avemujica#1';
  const source={id:1,x:10,y:10,info:{id:1,skin,spine:'char_4182_oblvns'}};
  const plays=[];
  const wiring={idx:index,ofx:{active:true,time:0,lib:{has:key=>!!index.prefabs[key]}},view:id=>id===1?source:null,
    playOn(key,point,options){const handle={alive:true,stop(){this.alive=false;}};plays.push({key,point,options,handle});return handle;}};
  const fx=new SkillFx(wiring);
  const note={id:1,noteId:'1:7',projectile:'projectile_chr_oblvns_s2',tx:12,ty:11,state:'spawn'};
  assert.equal(fx.simFx('mujicaNote',10,10,note),true);
  assert.equal(plays[0].key,'oblvns_skill_02_trail_02_avemujica#1');
  assert.equal(fx.simFx('mujicaNote',11,10,{...note,state:'move'}),true);
  assert.equal(plays.length,1);
  const effect={anchor:[0,0,0]};plays[0].options.track(effect);
  assert.deepEqual(effect.anchor,[1,1,-0.25]);
  assert.equal(fx.simFx('mujicaNote',11,10,{...note,state:'hit'}),true);
  assert.equal(plays[1].key,'oblvns_skill_02_hit_02_avemujica#1');
  assert.equal(plays[0].handle.alive,true);
  assert.equal(fx.simFx('mujicaNote',11.5,10,{...note,state:'end'}),true);
  assert.equal(plays[0].handle.alive,false);
  assert.equal(fx.mujicaNotes.size,0);
  fx.simFx('mujicaNote',10,10,{...note,noteId:'1:8'});
  fx.clear();
  assert.equal(fx.mujicaNotes.size,0);
});

test('Sakiko toggle instruments keep their original attack modes outside a skill window',()=>{
  const wiring=new FxWiring({active:true,lib:{},time:0},{});
  wiring.idx=index;
  const view={id:5,info:{id:5,ownerId:'p1',spine:'char_4182_oblvns'}};
  const unit=index.units.char_4182_oblvns;
  wiring.forms.set(5,'oblvns_s2_a');
  assert.equal(wiring.mode(unit,view).name,'S2_Atk');
  wiring.forms.set(5,'oblvns_s2_b');
  assert.equal(wiring.mode(unit,view).name,'S2_AttackSpeed');
  wiring.skills.simFx('mujicaFever',0,0,{playerId:'p1',active:true});
  assert.equal(wiring.mode(unit,view).name,'S2_Fever_Mag');
  wiring.forms.set(5,'oblvns_s2_a');
  assert.equal(wiring.mode(unit,view).name,'S2_Fever');
  wiring.skills.clear();
  assert.equal(wiring.mode(unit,view).name,'S2_Atk');
});
