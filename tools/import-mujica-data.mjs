// Import the five Ave Mujica operators from cached official game tables.
// Sources: PRTS operator pages and Kengxxiao/ArknightsGameData zh_CN/gamedata/excel.
// The cache is deliberately read-only here: rerunning never downloads or alters player settings.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeStats, composeTalents } from '../shared/loadoutRecord.js';
import { atPotential } from '../shared/potential.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, '.cache', 'mujica-source');
const read = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
const DATA = path.join(ROOT, 'data');
const chars = read(SOURCE, 'character_table');
const skills = read(SOURCE, 'skill_table');
const ranges = read(SOURCE, 'range_table');
const equips = read(SOURCE, 'uniequip_table').equipDict;
const battleEquips = read(SOURCE, 'battle_equip_table');
const chess = read(DATA, 'chess');
const backups = read(DATA, 'backups');
const members = [
  { code: 'oblvns', charId: 'char_4182_oblvns', tier: 6, bonds: ['mujicaShip', 'preciShip', 'arcaneShip'] },
  { code: 'mortis', charId: 'char_4183_mortis', tier: 5, bonds: ['mujicaShip', 'indomShip'] },
  { code: 'dolris', charId: 'char_4184_dolris', tier: 4, bonds: ['mujicaShip', 'skillfulShip', 'deputShip'] },
  { code: 'amoris', charId: 'char_4185_amoris', tier: 2, bonds: ['mujicaShip', 'raidShip'] },
  { code: 'tmoris', charId: 'char_4186_tmoris', tier: 1, bonds: ['mujicaShip', 'swiftShip'] },
];
const statFields = {
  maxHp: 'maxHp', atk: 'atk', def: 'def', magicResistance: 'res', cost: 'cost', blockCnt: 'blockCnt',
  baseAttackTime: 'bat', attackSpeed: 'aspd', respawnTime: 'respawnTime', spRecoveryPerSec: 'spRecovery',
  hpRecoveryPerSec: 'hpRecoveryPerSec', moveSpeed: 'moveSpeed', tauntLevel: 'tauntLevel', massLevel: 'massLevel',
  maxDeployCount: 'deployLimit', maxDeckStackCnt: 'deckStack',
};
const attrFields = { max_hp: 'maxHp', atk: 'atk', def: 'def', magic_resistance: 'res', cost: 'cost',
  block_cnt: 'blockCnt', base_attack_time: 'bat', attack_speed: 'aspd', respawn_time: 'respawnTime',
  sp_recovery_per_sec: 'spRecovery' };
const phaseOf = c => Number(String(c?.phase ?? 'PHASE_0').replace('PHASE_', ''));
const grid = id => id && ranges[id] ? ranges[id].grids.map(p => [p.row, p.col]) : null;
const clean = n => Math.round(n * 1e6) / 1e6;
function board(list) {
  const bb = {}, bbStr = {};
  for (const x of list || []) { if (x.valueStr != null) bbStr[x.key] = x.valueStr; if (x.value != null) bb[x.key] = x.value; }
  return { bb, bbStr };
}
function description(text, bb = {}, bbStr = {}) {
  return String(text ?? '').replace(/\\+n/g, '\n').replace(/\{([^}:]+)(?::([^}]+))?\}/g, (all, key, fmt) => {
    const lookup = Object.keys(bb).find(k => k.toLowerCase() === key.toLowerCase());
    const value = lookup == null ? bbStr[key] : bb[lookup];
    if (value == null) throw new Error(`Unresolved description value ${all}`);
    const pct = fmt?.includes('%');
    const decimals = fmt?.match(/0\.(0+)/)?.[1].length ?? 0;
    return typeof value === 'number' ? `${pct ? (value * 100).toFixed(decimals) : fmt ? value.toFixed(decimals) : clean(value)}${pct ? '%' : ''}` : value;
  });
}
const plain = text => text.replace(/<[@$][^>]*>|<\/>|<color[^>]*>|<\/color>/g, '');
function eligible(c, phase, level, rank) {
  const p = phaseOf(c.unlockCondition);
  return (p < phase || p === phase && Number(c.unlockCondition?.level || 1) <= level) && Number(c.requiredPotentialRank || 0) <= rank;
}
function chosen(candidates, phase, level, rank) {
  return (candidates || []).filter(c => eligible(c, phase, level, rank)).sort((a,b) =>
    phaseOf(a.unlockCondition)-phaseOf(b.unlockCondition) || Number(a.unlockCondition?.level||1)-Number(b.unlockCondition?.level||1) || Number(a.requiredPotentialRank||0)-Number(b.requiredPotentialRank||0)).at(-1);
}
function asTalent(c, index, fromModule = false) {
  const b = board(c.blackboard);
  const descRaw = description(c.upgradeDescription || c.description || '', b.bb, b.bbStr);
  return { ...(fromModule ? { talentIndex: c.talentIndex ?? index } : { index }), name: c.name, desc: plain(descRaw), descRaw,
    ...b, rangeGrid: grid(c.rangeId), tokenKey: c.tokenKey ?? null, hidden: !!c.isHideTalent, fromModule };
}
function talentChain(candidates, status, index, fromModule = false) {
  const candidatesByRank = Array.from({length:6}, (_,rank) => chosen(candidates, status.phase, status.level, rank));
  const build = rank => {
    const c = candidatesByRank[rank];
    if (!c) return null;
    const rec = asTalent(c, index, fromModule);
    let min = rank;
    while (min > 0 && candidatesByRank[min-1] === c) min--;
    if (min > 0 && candidatesByRank[min-1]) { rec.potMin = min; rec.potBelow = build(min-1); }
    return rec;
  };
  return build(5);
}
function trait(c, status) {
  const x = chosen(c.trait?.candidates, status.phase, status.level, 5);
  const b = board(x?.blackboard);
  const descRaw = description(x?.overrideDescripton || c.description, b.bb, b.bbStr);
  return { desc: plain(descRaw), descRaw, ...b, rangeGrid: grid(x?.rangeId) };
}
function stats(c, status, rank = 5) {
  const ph = c.phases[status.phase];
  const lo = ph.attributesKeyFrames[0], hi = ph.attributesKeyFrames.at(-1);
  const ratio = (status.level-lo.level)/(hi.level-lo.level || 1);
  const favor = c.favorKeyFrames?.at(-1)?.data || {};
  const result = {};
  for (const [raw,key] of Object.entries(statFields)) {
    let v = Number(lo.data[raw] || 0) + (Number(hi.data[raw] || 0)-Number(lo.data[raw] || 0))*ratio;
    if (['maxHp','atk','def'].includes(key)) v = Math.round(v);
    result[key] = clean(v + Number(favor[raw] || 0));
  }
  for (const step of (c.potentialRanks || []).slice(0,rank)) for (const modifier of step.buff?.attributes?.attributeModifiers || []) {
    const key = attrFields[String(modifier.attributeType).toLowerCase()];
    if (!key) throw new Error(`Unknown potential stat ${modifier.attributeType}`);
    if (modifier.formulaItem !== 'ADDITION') throw new Error(`Unknown potential formula ${modifier.formulaItem}`);
    result[key] = clean(result[key] + modifier.value);
  }
  return result;
}
function skill(c, source, index, level) {
  const s = skills[source.skillId].levels[level-1];
  const b = board(s.blackboard), descRaw = description(s.description,b.bb,b.bbStr);
  return { skillId: source.skillId, iconId: source.skillId, name:s.name, level, desc:plain(descRaw),descRaw,
    skillType:s.skillType,durationType:s.durationType,duration:s.duration,spType:s.spData.spType,
    spCost:s.spData.spCost,initSp:s.spData.initSp,maxChargeTime:s.spData.maxChargeTime,increment:s.spData.increment,
    ...b,rangeId:s.rangeId,rangeGrid:grid(s.rangeId),prefabId:s.prefabId,
    trigger:{rule:'DEFAULT',rawRule:'DEFAULT',customRangeGrid:null},index,overrideTokenKey:source.overrideTokenKey ?? null };
}
function moduleRecord(c, id, status) {
  const info = equips[id], ph = battleEquips[id]?.phases.find(x=>x.equipLevel===status.equipLevel);
  if (!info || !ph) return null;
  const attr = {};
  for (const x of ph.attributeBlackboard || []) {
    const key = attrFields[x.key];
    if (!key) throw new Error(`Unknown module stat ${x.key}`);
    attr[key] = x.value;
  }
  let traitOverride = null;
  const talentChanges = [];
  for (const part of ph.parts || []) {
    if (part.isToken) continue;
    const tr = chosen(part.overrideTraitDataBundle?.candidates,status.phase,status.level,5);
    if (tr) {
      const base = trait(c,status), b=board(tr.blackboard);
      const descRaw = description(tr.overrideDescripton || base.descRaw, b.bb, b.bbStr)
        + (tr.additionalDescription ? '\n' + description(tr.additionalDescription,b.bb,b.bbStr) : '');
      traitOverride={desc:plain(descRaw),descRaw,...b,rangeGrid:grid(tr.rangeId) || base.rangeGrid};
    }
    const t=talentChain(part.addOrOverrideTalentDataBundle?.candidates,status,-1,true);
    if(t && (t.name || t.desc || Object.keys(t.bb).length || t.tokenKey))talentChanges.push(t);
  }
  const typeName = `${info.typeName1}-${info.typeName2}`;
  return {uniEquipId:id,name:info.uniEquipName,typeName,typeIcon:typeName.toLowerCase(),icon:id,
    isDefault:true,level:status.equipLevel,attr,traitOverride,talentChanges};
}
function form(c, id, status) {
  const proto=Object.values(chess).find(x=>x.subProfessionId===c.subProfessionId && !x.isGolden);
  if(!proto)throw new Error(`No profession template ${c.subProfessionId}`);
  const ph=c.phases[status.phase];
  const baseStats=stats(c,status);
  const potential={};
  for(let rank=4;rank>=0;rank--) {
    const a=stats(c,status,rank), b=stats(c,status,rank+1), delta={};
    for(const k of Object.keys(a))if(a[k]!==b[k])delta[`stats.${k}`]=a[k];
    if(Object.keys(delta).length)potential[rank]=delta;
  }
  const out={status:{...status},stats:baseStats,
    immunities:Object.fromEntries(['stun','silence','sleep','frozen','levitate'].map(k=>[k,!!ph.attributesKeyFrames[0].data[`${k}Immune`]])),
    rangeId:ph.rangeId,rangeGrid:grid(ph.rangeId),dmgType:proto.dmgType,attackKind:proto.attackKind,
    projectile:proto.projectile,canHitFly:proto.canHitFly,targetPriority:proto.targetPriority,
    trait:trait(c,status),skills:c.skills.map((s,i)=>skill(c,s,i,status.skillLevel)),
    talents:(c.talents||[]).map((t,i)=>talentChain(t.candidates,status,i)).filter(Boolean),
    displayTokens:[],tokens:[],potDown:potential};
  if(status.equipLevel>0)out.modules=[moduleRecord(c,`uniequip_002_${id.split('_').at(-1)}`,status)].filter(Boolean);
  return out;
}

const summary=[];
let identifier=Math.max(...Object.values(chess).map(c=>Number(c.identifier)||0))+1;
for(const member of members) {
  const {charId,code,tier,bonds}=member,c=chars[charId];
  if(!c)throw new Error(`Missing ${charId}`);
  const baseId=`chess_zj_${code}_a`,goldenId=`chess_zj_${code}_b`,moduleId=`uniequip_002_${code}`;
  const normalStatus={phase:2,level:1,skillLevel:4,equipLevel:0};
  const goldenStatus={phase:2,level:60,skillLevel:7,equipLevel:3};
  const statuses=[normalStatus,{...goldenStatus,equipLevel:0},{...goldenStatus,equipLevel:1},{...goldenStatus,equipLevel:2},goldenStatus,
    {phase:2,level:c.phases[2].maxLevel,skillLevel:10,equipLevel:3}];
  const forms=Object.fromEntries(statuses.map(s=>[[s.phase,s.level,s.skillLevel,s.equipLevel].join('/'),form(c,charId,s)]));
  const proto=Object.values(chess).find(x=>x.subProfessionId===c.subProfessionId&&!x.isGolden);
  const unit={charId,name:c.name,appellation:c.appellation,rarity:Number(c.rarity.replace('TIER_','')),
    profession:c.profession,subProfessionId:c.subProfessionId,subProfessionName:proto.subProfessionName,position:c.position,nationId:c.nationId,
    teamId:'mujica',zhajing:true,isNotObtainable:c.isNotObtainable,
    assets:{avatar:charId,avatarGolden:charId,portrait:`${charId}_1`,portraitGolden:`${charId}_2`,spine:charId,subProfIcon:`sub_${c.subProfessionId}_icon`},
    moduleNames:{[moduleId]:{name:equips[moduleId].uniEquipName,typeName:`${equips[moduleId].typeName1}-${equips[moduleId].typeName2}`}},standsIn:[],forms};
  backups.units[charId]=unit;
  backups.diy.operators[charId]={name:c.name,rarity:unit.rarity,profession:c.profession,subProfessionId:c.subProfessionId,
    obtainable:true,powers:['mujica'],bonds:[...bonds],zhajing:true,zjOnly:true};
  // Do not add these ZHAJING-only characters to the ordinary DIY ownedPool.
  for(const golden of [false,true]) {
    const status=golden?goldenStatus:normalStatus;
    const f=forms[[status.phase,status.level,status.skillLevel,status.equipLevel].join('/')];
    const mod=f.modules?.[0]||null;
    const defaultIndex=c.skills.length-1;
    const selected=f.skills[defaultIndex];
    const id=golden?goldenId:baseId;
    const record={chessId:id,baseId,goldenId,isGolden:golden,tier,identifier:chess[id]?.identifier ?? identifier++,
      isHidden:false,isDiy:false,visible:false,chessType:'NORMAL',
      backup:{charId,tmplId:null,skillIndex:defaultIndex,uniEquipId:golden?moduleId:null,potRank:0},
      shopSortId:1000+members.indexOf(member),charId,name:c.name,appellation:c.appellation,rarity:unit.rarity,
      profession:c.profession,subProfessionId:c.subProfessionId,subProfessionName:unit.subProfessionName,position:c.position,nationId:c.nationId,teamId:'mujica',
      bonds:[...bonds],garrisonIds:[`garrison_mujica_${code}`],price:tier<=2?2:tier<=4?3:4,sellPrice:1,upgradeNum:3,
      upgradeChessId:golden?null:goldenId,status:{...status},stats:mod?composeStats(f.stats,mod.attr):f.stats,
      immunities:f.immunities,rangeId:f.rangeId,rangeGrid:f.rangeGrid,dmgType:f.dmgType,attackKind:f.attackKind,
      projectile:f.projectile,canHitFly:f.canHitFly,targetPriority:f.targetPriority,trait:mod?.traitOverride||f.trait,
      skill:{...selected},skills:f.skills.map((s,i)=>({...s,isDefault:i===defaultIndex})),
      talents:mod?composeTalents(f.talents,mod.talentChanges):f.talents,tokens:[],
      module:mod?{id:moduleId,name:mod.name,type:mod.typeName,level:mod.level,active:true}:null,
      assets:{avatar:charId,portrait:`${charId}_${golden?2:1}`,spine:charId,skillIcon:selected.iconId,subProfIcon:unit.assets.subProfIcon},
      potDown:{},zhajing:true};
    if(golden)Object.assign(record,{statsBase:f.stats,traitBase:f.trait,talentsBase:f.talents,modules:f.modules});
    for(let rank=4;rank>=0;rank--) {
      const a=stats(c,status,rank),b=stats(c,status,rank+1),delta={};
      for(const k of Object.keys(a))if(a[k]!==b[k]) {delta[`stats.${k}`]=clean(a[k]+(mod?.attr[k]||0));if(golden)delta[`statsBase.${k}`]=a[k];}
      if(Object.keys(delta).length)record.potDown[rank]=delta;
    }
    // Source-table consistency for every selectable potential, including module stat composition.
    for(let potential=1;potential<=6;potential++) {
      const got=atPotential(record,potential).stats,want=composeStats(stats(c,status,potential-1),mod?.attr);
      if(JSON.stringify(got)!==JSON.stringify(want))throw new Error(`Potential mismatch ${id}/${potential}`);
    }
    chess[id]=record;
  }
  summary.push({name:c.name,charId,baseId,goldenId,tier,bonds,moduleId,forms:Object.keys(forms)});
}
for(const [name,value]of [['chess',chess],['backups',backups]])fs.writeFileSync(path.join(DATA,`${name}.json`),JSON.stringify(value)+'\n');
fs.writeFileSync(path.join(SOURCE,'import-summary.json'),JSON.stringify({sources:['https://prts.wiki/','https://github.com/Kengxxiao/ArknightsGameData/tree/master/zh_CN/gamedata/excel'],members:summary},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
