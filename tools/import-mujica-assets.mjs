// Install the original Ave Mujica art, skins, animation and voice assets.
// Run after tools/import-mujica-data.mjs has cached the official tables.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { RAW, joinUrl, safeName } from './assets/sources.mjs';
import { parseAtlas, normalizeAtlas } from './assets/atlas.mjs';
import { parseSkel } from './assets/skel.mjs';
import { resolveRoles } from './assets/anim-roles.mjs';
import { indexVoice, indexAudio, pickUnitSfx, pickModeAttacks, pickModeHits, skillModeLetter, SLOT_MODE_LETTER } from './assets/audio.mjs';
import { contentHash } from './assets/manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache/mujica-source');
const PUBLIC = path.join(ROOT, 'public');
const IDS = ['char_4182_oblvns','char_4183_mortis','char_4184_dolris','char_4185_amoris','char_4186_tmoris'];
const report = { sources: [], warnings: [], chars: {}, generatedAt: new Date().toISOString() };
const read = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const write = async (p, value) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, JSON.stringify(value, null, 2) + '\n'); };
const pending = new Map();

async function download(url, dest) {
  if (pending.has(dest)) return pending.get(dest);
  const work = (async () => {
    let data;
    try { data = await fs.readFile(dest); if (!data.length) data = null; } catch {}
    let transport = 'existing';
    if (!data) {
      const urls = url.startsWith('https://raw.githubusercontent.com/')
        ? ['https://gh-proxy.com/' + url, url] : [url];
      let failure;
      for (let attempt = 0; attempt < urls.length + 1; attempt++) {
        const target = urls[attempt % urls.length];
        try {
          const res = await fetch(target, { signal: AbortSignal.timeout(60000) });
          if (!res.ok) throw new Error(`${res.status}: ${target}`);
          data = Buffer.from(await res.arrayBuffer());
          if (data.length < 20 || data.subarray(0, 60).toString().includes('<!DOCTYPE html')) throw new Error(`Invalid asset: ${target}`);
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.writeFile(dest, data);
          transport = target;
          break;
        } catch (error) { failure = error; }
      }
      if (!data) throw failure;
    }
    report.sources.push({ path: path.relative(ROOT, dest).replaceAll('\\','/'), url, transport, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    return data;
  })();
  pending.set(dest, work);
  return work;
}

async function asset(url, rel) { await download(url, path.join(PUBLIC, 'assets', rel)); return '/assets/' + rel; }
async function table(name) { const dest = path.join(CACHE,name+'.json'); await download(RAW.gamedata+'excel/'+name+'.json',dest); return read(dest); }
async function mapLimit(values, limit, fn) { let cursor=0; return Promise.all(Array.from({length: Math.min(limit, values.length)}, async()=>{ while(cursor<values.length) { const i=cursor++; await fn(values[i],i); } })); }

async function model(charId, modelId, side, skillCount) {
  const rel = `spine/op/${charId}/${modelId === charId ? '' : modelId + '/'}${side.toLowerCase()}/`;
  const source = `${RAW.fexli}spine/${charId}/${modelId}/${side}/`;
  const skel = await download(source + modelId + '.skel', path.join(PUBLIC,'assets',rel,modelId+'.skel'));
  const atlasFile = path.join(PUBLIC,'assets',rel,modelId+'.atlas');
  const atlas = await download(source + modelId + '.atlas',atlasFile);
  const parsed = parseAtlas(atlas.toString('utf8'));
  const dimensions = new Map();
  for (const page of parsed.pages) {
    const png = await download(joinUrl(source,page.name),path.join(PUBLIC,'assets',rel,page.name));
    dimensions.set(page.name,{width:png.readUInt32BE(16),height:png.readUInt32BE(20)});
  }
  const normalized = normalizeAtlas(atlas.toString('utf8'),{pageSize:n=>dimensions.get(n),pma:false});
  if (normalized.changed) await fs.writeFile(atlasFile,normalized.text);
  const meta = parseSkel(skel,new Set(parsed.pages.flatMap(p=>p.regions)));
  if(meta.missingRegions.length) throw new Error(`${modelId}/${side}: ${meta.missingRegions.length} missing atlas regions`);
  const anims = resolveRoles(meta.animations,{skillIndices:Array.from({length:skillCount},(_,i)=>i),durations:meta.durations});
  if(charId==='char_4182_oblvns' && anims.skills?.['1']) {
    anims.skills['1'].loop='Skill_2_Loop_A';
    anims.skills['1'].idle='Skill_2_Idle_A';
  }
  return { skel:'/assets/'+rel+modelId+'.skel', atlas:'/assets/'+rel+modelId+'.atlas', textures:parsed.pages.map(p=>'/assets/'+rel+p.name), pma:false, anims, animations:meta.durations, events:meta.events, hits:meta.hits, bounds:meta.bounds };
}

async function main() {
  const chars = await read(path.join(CACHE,'character_table.json'));
  const skinsTable = await read(path.join(CACHE,'skin_table.json'));
  const [charword,audioTable] = await Promise.all([table('charword_table'),table('audio_data')]);
  const voiceIndex = indexVoice(charword, 'CN');
  const audioIndex = indexAudio(audioTable);
  const assets = await read(path.join(ROOT,'data/assets.json'));
  const skins = await read(path.join(ROOT,'data/skins.json'));
  const installed = new Set(await read(path.join(ROOT,'data/skins-installed.json')));
  assets.audio.voice.jp ||= {};
  assets.audio.sfx.units ||= {};
  assets.audio.voiceArchive ||= {};
  await mapLimit(IDS, 3, async id => {
    const character=chars[id];
    const c={};
    for(const [key,remote,rel] of [
      ['avatar',`avatar/${id}.png`,`char/avatar/${id}.png`],
      ['avatarE2',`avatar/${id}_2.png`,`char/avatar/${id}_2.png`],
      ['portrait',`portrait/${id}_1.png`,`char/portrait/${id}_1.png`],
      ['portraitE2',`portrait/${id}_2.png`,`char/portrait/${id}_2.png`],
    ]) c[key]=await asset(joinUrl(RAW.yuanyan,remote),rel);
    c.spine={front:await model(id,id,'Front',character.skills.length)};
    // The official bard model is front-only (it does not turn towards attack targets).
    if(id!=='char_4184_dolris') c.spine.back=await model(id,id,'Back',character.skills.length);
    c.skins={};
    skins.chars[id]=[];
    for(const [skinId,skin] of Object.entries(skinsTable.charSkins).filter(([k,v])=>v.charId===id && k.includes('@'))) {
      const display=skin.displaySkin;
      const modelId=safeName(skin.battleSkin.skinOrPrefabId);
      const skinRecord={ name:display.skinName,group:display.skinGroupName,
        avatar:await asset(joinUrl(RAW.yuanyan,`avatar/${skin.avatarId}.png`),`char/skin_avatar/${safeName(skin.avatarId)}.png`),
        portrait:await asset(joinUrl(RAW.yuanyan,`portrait/${skin.portraitId}.png`),`char/skin_portrait/${safeName(skin.portraitId)}.png`),
        portraitLayout:'half-body',
        spine:{front:await model(id,modelId,'Front',character.skills.length)} };
      if(id!=='char_4184_dolris') skinRecord.spine.back=await model(id,modelId,'Back',character.skills.length);
      c.skins[skinId]=skinRecord;
      skins.chars[id].push({id:skinId,name:display.skinName,group:display.skinGroupName});
      installed.add(skinId);
    }
    // Download complete original illustrations separately from the official shop crops.
    const query='https://prts.wiki/api.php?'+new URLSearchParams({action:'query',list:'allimages',aiprefix:'立绘_'+character.name,ailimit:'50',format:'json'});
    const images=await (await fetch(query)).json();
    for(const img of images.query?.allimages||[]) {
      const suffix=img.name.match(/_(1|2|skin1)\.png$/)?.[1];
      if(!suffix) continue;
      const value=await asset(img.url,`char/illustration/${id}_${suffix}.png`);
      if(suffix==='1') c.illustration=value;
      if(suffix==='2') c.illustrationE2=value;
      if(suffix==='skin1') for(const s of Object.values(c.skins)) s.illustration=value;
    }
    for(const skill of character.skills) {
      const skillId=skill.skillId;
      assets.skills[skillId]=await asset(joinUrl(RAW.yuanyan,`skill/skill_icon_${skillId}.png`),`skill/${skillId}.png`);
      assets.skillsById[skillId]=skillId;
    }
    // Collaboration operators have their original Japanese performances, without invented alternate dubs.
    const voices={};
    for(const [slot,lines] of Object.entries(voiceIndex.get(id)||{})) {
      const files=[];
      for(const line of lines) files.push(await asset(joinUrl(RAW.aa2voice,`voice/${line.toLowerCase()}.mp3`),`audio/voice/jp/${line.toLowerCase()}.mp3`));
      voices[slot]=files.length===1?files[0]:files;
    }
    assets.audio.voice.jp[id]=voices;
    // The default CN selector falls back to the same original Japanese dub for these collaboration operators.
    assets.audio.voice.cn[id]=voices;
    const allVoices={};
    const words=Object.values(charword.charWords).filter(w=>w.charId===id && w.wordKey===id && /^CN_/.test(w.voiceId));
    for(const word of words) {
      if(!word.voiceAsset) continue;
      const line=word.voiceAsset.toLowerCase();
      allVoices[word.voiceId.toLowerCase()]=await asset(joinUrl(RAW.aa2voice,`voice/${line}.mp3`),`audio/voice/jp/${line}.mp3`);
    }
    assets.audio.voiceArchive[id]=allVoices;
    const sound = async paths => {
      if(!paths?.length) return null;
      const values=[];
      for(const p of paths) values.push(await asset(joinUrl(RAW.aa2voice,p),'audio/sfx/'+p));
      return values.length===1?values[0]:values;
    };
    const short=id.replace(/^char_\d+_/,'');
    const banks=audioIndex.unitBanks.get(id);
    const picked=pickUnitSfx(banks,{operator:true,projectile:{born:audioIndex.bank(`battle.ON_PROJECTILE_BORN.projectile_chr_${short}`),hit:audioIndex.bank(`battle.ON_PROJECTILE_HIT.projectile_chr_${short}`)}});
    const unitSounds={};
    for(const [role,paths] of Object.entries(picked)) {const value=await sound(paths);if(value)unitSounds[role]=value;}
    unitSounds.skills={};unitSounds.attacks={};unitSounds.hits={};
    const attacks=pickModeAttacks(banks),hits=pickModeHits(banks);
    for(const [i,skill] of character.skills.entries()) {
      const activation=audioIndex.skillBanks.get(skill.skillId)?.get('ON_SKILL_START');
      const mode=skillModeLetter(activation?.[0])??SLOT_MODE_LETTER[i];
      for(const [group,paths] of [['skills',activation],['attacks',attacks[mode]],['hits',hits[mode]]]) {const value=await sound(paths);if(value)unitSounds[group][String(i)]=value;}
    }
    if(unitSounds.skills['0']) unitSounds.skill=unitSounds.skills['0'];
    assets.audio.sfx.units[id]=unitSounds;
    assets.chars[id]=c;
    report.chars[id]={name:character.name,skins:Object.keys(c.skins),voiceSlots:Object.keys(voices),animations:c.spine.front.animations};
    console.log(`Installed ${character.name}: base + ${Object.keys(c.skins).length} skin, ${Object.keys(voices).length} voice slots`);
  });
  assets.audio.mujicaFever={
    instrumental:await asset(joinUrl(RAW.aa2voice,'music/character/m_bat_avemujica_mid.mp3'),'audio/bgm/mujica/fever_mid.mp3'),
    vocal:await asset(joinUrl(RAW.aa2voice,'music/character/m_bat_avemujica_full.mp3'),'audio/bgm/mujica/fever_full.mp3'),
  };
  assets.audio.mujicaBanks={};
  assets.audio.mujicaBankDefs={};
  const eventBanks=audioTable.soundFXBanks.filter(b=>/oblvns|mortis|dolris|amoris|tmoris/.test(b.name));
  await mapLimit(eventBanks,5,async bank=>{
    const values=[];
    const definitions=[];
    for(const sound of bank.sounds||[]) {
      if(!sound.asset) { definitions.push({...sound,url:null}); continue; }
      const p=sound.asset.replace(/^Audio\/Sound_Beta_2\//i,'').toLowerCase()+'.mp3';
      const local=await asset(joinUrl(RAW.aa2voice,p),'audio/sfx/'+p);
      definitions.push({...sound,url:local});
      if(!values.includes(local)) values.push(local);
    }
    if(values.length) assets.audio.mujicaBanks[bank.name]=values.length===1?values[0]:values;
    assets.audio.mujicaBankDefs[bank.name]=definitions;
  });
  skins.counts={chars:Object.keys(skins.chars).length,skins:Object.values(skins.chars).reduce((n,list)=>n+list.length,0)};
  const {version,hash,generator,stats,...body}=assets;
  const assetFiles=new Set();
  const collect=v=>{ if(typeof v==='string' && v.startsWith('/assets/'))assetFiles.add(v); else if(v && typeof v==='object')Object.values(v).forEach(collect); };
  collect(body);
  let assetBytes=0;
  for(const url of assetFiles) assetBytes+=(await fs.stat(path.join(PUBLIC,decodeURIComponent(url)))).size;
  assets.stats={...stats,chars:Object.keys(assets.chars).length,charsWithBack:Object.values(assets.chars).filter(c=>c.spine?.back).length,files:assetFiles.size,bytes:assetBytes};
  assets.hash=contentHash(body);
  await write(path.join(ROOT,'data/assets.json'),assets);
  await write(path.join(ROOT,'data/skins.json'),skins);
  await write(path.join(ROOT,'data/skins-installed.json'),[...installed].sort());
  await write(path.join(ROOT,'docs/mujica-assets-sources.json'),report);
  console.log(JSON.stringify({files:report.sources.length,bytes:report.sources.reduce((n,x)=>n+x.bytes,0),hash:assets.hash}));
}
main().catch(async error=>{report.warnings.push(error.stack);await write(path.join(CACHE,'assets-download-error.json'),report);console.error(error);process.exitCode=1;});
