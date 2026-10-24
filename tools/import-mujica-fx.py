"""Fetch and extract the five operators' official client effects into an isolated staging folder.

Uses the project's existing Unity effect converter; never writes the installed FX tree.
Dependencies may be installed to .cache/mujica-python (UnityPy/lz4/Pillow).
"""
import concurrent.futures
import hashlib
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.cache/mujica-python'))
sys.path.insert(0, str(ROOT / 'tools/local-extract'))
import fx

VERSION = '26-04-13-12-31-42_e9b560'
BASE = f'https://ak.hycdn.cn/assetbundle/official/Android/assets/{VERSION}/'
SOURCE = ROOT / '.cache/mujica-source'
AB = ROOT / '.cache/mujica-client' / VERSION
STAGE = ROOT / '.cache/mujica-fx-stage'
IDS = ['char_4182_oblvns','char_4183_mortis','char_4184_dolris','char_4185_amoris','char_4186_tmoris']

def get(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()

def main():
    hot = json.loads((SOURCE / 'hot_update_list.json').read_text('utf-8'))
    exact = {f'{folder}/{char}.ab' for char in IDS for folder in ('charpack','chararts','skinpack')}
    exact |= {f'battle/prefabs/effects/{char.split("_")[-1]}.ab' for char in IDS}
    exact |= {'[uc]shaders.ab','battle/prefabs/[uc]skills.ab','battle/prefabs/[uc]projectiles.ab',
              'config/buff_template_holder.ab','battle/prefabs/effects/common.ab','battle/prefabs/effects/buff.ab'}
    needed = [row for row in hot['abInfos'] if row['name'] in exact or row['name'].startswith(('refs/fx/','shaders/','anon/'))]
    print(f'Downloading {len(needed)} verified official bundles ({sum(x["totalSize"] for x in needed)/1e6:.1f} MB)',flush=True)
    def fetch(row):
        name=row['name']; dest=AB/name
        def valid(blob):
            # Anonymous metadata entries use a short revision tag in the md5
            # field; ZIP CRC and exact uncompressed size validate those entries.
            if len(blob)!=row['abSize']:
                return False
            return len(row['md5'])!=32 or hashlib.md5(blob).hexdigest()==row['md5']
        if dest.is_file() and valid(dest.read_bytes()):
            return
        url=BASE+name.rsplit('.',1)[0].replace('/','_').replace('#','__')+'.dat'
        last=None
        for attempt in range(3):
            try:
                with zipfile.ZipFile(io.BytesIO(get(url))) as archive:
                    blob=archive.read(archive.namelist()[0])
                if not valid(blob):
                    raise ValueError(f'{name}: checksum mismatch')
                dest.parent.mkdir(parents=True,exist_ok=True)
                dest.write_bytes(blob)
                return
            except Exception as error:
                last=error
        raise RuntimeError(f'{name}: {last}')
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for i,_ in enumerate(pool.map(fetch,needed),1):
            if i%20==0: print(f'{i}/{len(needed)} bundles ready',flush=True)
    (SOURCE/'fx-bundle-sources.json').write_text(json.dumps({'base':BASE,'files':needed},indent=2)+'\n','utf-8')
    chars=json.loads((SOURCE/'character_table.json').read_text('utf-8'))
    equip=json.loads((SOURCE/'battle_equip_table.json').read_text('utf-8'))
    uniequip=json.loads((SOURCE/'uniequip_table.json').read_text('utf-8'))
    gd={'chars':IDS,'skills':{cid:[s['skillId'] for s in chars[cid]['skills']] for cid in IDS},
        'enemies':[],'tokens':[],'tokenSkills':{},'talentKeys':fx.talent_keys(IDS,chars,equip,uniequip)}
    fx.game_data=lambda root:gd
    fx.FX_SAMPLE_KEYS=[]
    effects=fx.container_index(AB,fx.EFFECT_GLOBS,ROOT/'.cache/fx/effects.json',1,lambda s:print(s,flush=True))
    fx.FX_COVERAGE_KEYS=[key for key in effects if 'avemujica' in key]
    STAGE.mkdir(parents=True,exist_ok=True)
    fx.export_fx(AB,STAGE,{},lambda s:print(s,flush=True),selection='used',jobs=1,root=ROOT,fx_manifest=STAGE/'local-fx.json')
    index=json.loads((STAGE/'fx/index.json').read_text('utf-8'))
    env=fx.AssetEnv(AB,fx.scan_cabs(AB))
    skin_maps={}
    for cid in IDS:
        rel=f'skinpack/{cid}.ab'
        prefab=f'{cid}_avemujica#1'
        go=env.prefabs(rel).get(prefab)
        if go is None:
            raise RuntimeError(f'{cid}: skin prefab missing')
        todo=[go]; pairs={}
        while todo:
            node=todo.pop()
            for component in env.tt(node).get('m_Component',[]):
                file,obj=env.resolve(node.assets_file,component.get('component'))
                if obj is None or file=='builtin' or obj.type.name!='MonoBehaviour':
                    continue
                if env.script(obj)[1]=='CharacterSkinHooker':
                    for pair in env.tt(obj).get('_replaceEffectPairs',[]):
                        pairs[pair['fromEffect'].lower()]=pair['toEffect'].lower()
            todo+=fx.go_children(env,node)
        graphic=index['units'][cid].get('graphic')
        skin_maps[f'{cid}@avemujica#1']={'charId':cid,'replacements':pairs,'mounts':{
            'source':rel+' '+prefab,'graphic':graphic,'points':fx.skin_points(env,rel,prefab,graphic)}}
    (STAGE/'skin-maps.json').write_text(json.dumps(skin_maps,ensure_ascii=False)+'\n','utf-8')

if __name__=='__main__':
    main()
