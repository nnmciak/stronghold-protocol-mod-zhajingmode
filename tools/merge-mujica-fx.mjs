// Merge the isolated official-client export without replacing any existing effect.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stage=path.join(root,'.cache/mujica-fx-stage');
const target=path.join(root,'public/assets/local/fx');
const backup=path.join(root,'..','备份-颂乐人偶素材');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const write=async(p,a)=>{await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,JSON.stringify(a)+'\n');};
for(const [p,name] of [[path.join(target,'index.json'),'index.json'],[path.join(target,'textures.json'),'textures.json'],[path.join(root,'data/local-fx.json'),'local-fx.json']]) {
  await fs.mkdir(backup,{recursive:true});
  try { await fs.copyFile(p,path.join(backup,name),fs.constants.COPYFILE_EXCL); } catch(e){if(e.code!=='EEXIST')throw e;}
}
const [before,added,oldTextures,newTextures,oldManifest,newManifest]=await Promise.all([
  read(path.join(target,'index.json')),read(path.join(stage,'fx/index.json')),
  read(path.join(target,'textures.json')),read(path.join(stage,'fx/textures.json')),
  read(path.join(root,'data/local-fx.json')),read(path.join(stage,'local-fx.json')),
]);
const skinMaps=await read(path.join(stage,'skin-maps.json'));
const counts={};
for(const section of ['units','skills','projectiles','skins','prefabs']) {
  const previous=before[section]||{};
  counts[section]=Object.keys(added[section]||{}).filter(k=>!Object.hasOwn(previous,k)).length;
  before[section]={...(added[section]||{}),...previous};
}
before.units.char_4182_oblvns.mujicaNotes=true;
before.mujicaSkinMaps ||= {};
for(const [skinId,skin] of Object.entries(skinMaps)) {
  const short=skin.charId.replace(/^char_\d+_/,'');
  const projectiles=Object.fromEntries(Object.keys(added.projectiles).filter(k=>k.startsWith('projectile_chr_'+short)).map(k=>[k,k+'@avemujica#1']));
  const replacements={...skin.replacements,...projectiles};
  const rewrite=v=>{
    if(typeof v==='string')return replacements[v]||v;
    if(Array.isArray(v))return v.map(rewrite);
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[replacements[k]||k,rewrite(x)]));
    return v;
  };
  for(const [oldKey,newKey] of Object.entries(projectiles))before.projectiles[newKey]=rewrite(added.projectiles[oldKey]);
  before.units[skinId]={...rewrite(before.units[skin.charId]),skin:skinId,mujicaBase:skin.charId};
  before.skins[skinId]=skin.mounts;
  before.mujicaSkinMaps[skinId]={replacements:skin.replacements,projectiles};
}
oldTextures.textures={...newTextures.textures,...oldTextures.textures};
for(const [name,entries] of Object.entries(newManifest.groups)) oldManifest.groups[name]={...entries,...(oldManifest.groups[name]||{})};
oldManifest.groups.fx.index.prefabs=Object.keys(before.prefabs).length;
oldManifest.groups.fx.textures.count=Object.keys(oldTextures.textures).length;
oldManifest.count=Object.values(oldManifest.groups).reduce((n,g)=>n+Object.keys(g).length,0);
let copied=0;
for(const folder of ['prefabs','tex','mesh']) {
  const walk=async rel=>{for(const e of await fs.readdir(path.join(stage,'fx',rel),{withFileTypes:true})){const sub=path.join(rel,e.name);if(e.isDirectory())await walk(sub);else {const dest=path.join(target,sub);await fs.mkdir(path.dirname(dest),{recursive:true});try{await fs.copyFile(path.join(stage,'fx',sub),dest,fs.constants.COPYFILE_EXCL);copied++;}catch(error){if(error.code!=='EEXIST')throw error;}}}};
  await walk(folder);
}
await write(path.join(target,'index.json'),before);
await write(path.join(target,'textures.json'),oldTextures);
await write(path.join(root,'data/local-fx.json'),oldManifest);
await write(path.join(root,'docs/mujica-fx-import.json'),{source:'Official Android client CDN',client:'26-04-13-12-31-42_e9b560',counts,copied,backup,skinMaps,existingEffectDefinitionsPreserved:true});
console.log(JSON.stringify({counts,copied}));
