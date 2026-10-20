# -*- coding: utf-8 -*-
"""把四位 P3R 干员的 fx 增量合并进正式库。

分两步（因为 fx.export_fx 的 --fx-keys 分支会保留"上次"的 units/skills/skins，而那次 crawl 是空的）：
  1) 调 fx.crawl_units 拿到这四位的 units/projectiles/skills/skins
  2) 调 fx.export_fx(keys=...) 导出 prefab 描述/贴图/网格（它会合并 prefabs/tex/mesh 与清单）
  3) 自己把这四位的 units/projectiles/skills/skins 并进 index.json

用法（项目根）：python _fxmerge4.py [--commit]
   不带 --commit 只报告将要做什么。
"""
import json
import os
import shutil
import sys
import time

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ROOT = os.path.dirname(os.path.abspath(__file__))
G = r'C:\Users\陈洁楷\Documents\deepseek-harness\default-workspace\_garrison-list'
AB = r'C:\Program Files\Hypergryph Launcher\games\Arknights\Arknights_Data\StreamingAssets\AB\Windows'
STAGE = os.path.join(G, '_fx-stage')
BK = os.path.join(G, '_fx-bak-prep3r')

UNITS = [
    ('char_4217_makoto', '结城理'),
    ('char_4218_aigis', '埃癸斯'),
    ('char_4219_yukari', '岳羽由加莉'),
    ('char_4220_kormr', '虎狼丸'),
]


def log(*a):
    print(*a, flush=True)


def wj(path, obj, compact=True):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False,
                  separators=(',', ':') if compact else (',', ': '))
    os.replace(tmp, path)


def main():
    commit = '--commit' in sys.argv
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'local-extract'))
    import fx

    fxdir = os.path.join(ROOT, 'public', 'assets', 'local', 'fx')
    manifest_p = os.path.join(ROOT, 'data', 'local-fx.json')

    log('=== ① 扫客户端 + crawl 四位 ===')
    cabs = fx.scan_cabs(AB)
    eff = fx.container_index(AB, fx.EFFECT_GLOBS, os.path.join(ROOT, '.cache', 'fx', 'effects.json'), 8, log)
    gd = fx.game_data(ROOT)
    t0 = time.time()
    units, projectiles, skills, skins, referenced = fx.crawl_units(
        AB, cabs, [u[0] for u in UNITS], gd, eff, {}, {}, log)
    log('  %.1fs  units=%d projectiles=%d skills=%d skins=%d refs=%d'
        % (time.time() - t0, len(units), len(projectiles), len(skills), len(skins), len(referenced)))
    for cid, nm in UNITS:
        log('  %-10s units=%-5s skins=%-5s' % (nm, cid in units, cid in skins))
    log('  skills: %s' % ', '.join(sorted(skills)))

    # 引用闭包：crawl 只给出"直接引用"，再补上 prefab 之间互相引用的（export_fx 会多轮展开，
    # 这里把 crawl 已知的 prefab refs 也并进去，尽量一次给全）
    want = set(referenced)

    if not commit:
        log()
        log('（未带 --commit，仅报告）')
        log('  将导出 %d 个引用键（+ 其引用的级联）' % len(want))
        log('  将并入 index.json 的 units: %s' % ', '.join(sorted(units)))
        log('  将并入 index.json 的 skills: %s' % ', '.join(sorted(skills)))
        log('  将并入 index.json 的 projectiles: %s' % ', '.join(sorted(projectiles)))
        log('  将并入 index.json 的 skins: %s' % ', '.join(sorted(skins)))
        return 0

    log()
    log('=== ② 备份 ===')
    stamp = time.strftime('%Y%m%d-%H%M%S')
    b = os.path.join(BK, 'commit-' + stamp)
    os.makedirs(b, exist_ok=True)
    shutil.copy2(manifest_p, os.path.join(b, 'local-fx.json'))
    for f in ('index.json', 'textures.json'):
        shutil.copy2(os.path.join(fxdir, f), os.path.join(b, f))
    log('  备份 → %s' % b)

    log()
    log('=== ③ 导出 prefab / 贴图 / 网格（合并进现有 index.json 与清单）===')
    t0 = time.time()
    n = fx.export_fx(AB, os.path.join(ROOT, 'public', 'assets', 'local'), {}, log,
                     selection='keys', keys=sorted(want), jobs=8,
                     root=ROOT, fx_manifest=manifest_p)
    log('  写入 %d 个文件，%.1fs' % (n, time.time() - t0))

    log()
    log('=== ④ 把 units/projectiles/skills/skins 并进 index.json ===')
    idx = json.load(open(os.path.join(fxdir, 'index.json'), encoding='utf-8'))
    before = {k: len(idx.get(k) or {}) for k in ('units', 'projectiles', 'skills', 'skins', 'prefabs')}
    for seg, add in (('units', units), ('projectiles', projectiles), ('skills', skills), ('skins', skins)):
        cur = idx.setdefault(seg, {})
        for k, v in add.items():
            if k not in cur:
                cur[k] = v
            else:
                log('  （%s 已存在，跳过）%s' % (seg, k))
    idx['units'] = dict(sorted(idx['units'].items()))
    idx['projectiles'] = dict(sorted(idx['projectiles'].items()))
    idx['skills'] = dict(sorted(idx['skills'].items()))
    idx['skins'] = dict(sorted(idx['skins'].items()))
    wj(os.path.join(fxdir, 'index.json'), idx)
    after = {k: len(idx.get(k) or {}) for k in ('units', 'projectiles', 'skills', 'skins', 'prefabs')}
    for k in before:
        log('  %-14s %d → %d' % (k, before[k], after[k]))

    log()
    log('=== ⑤ 独立复核（重新读盘）===')
    idx2 = json.load(open(os.path.join(fxdir, 'index.json'), encoding='utf-8'))
    mf2 = json.load(open(manifest_p, encoding='utf-8'))
    ok = True
    for cid, nm in UNITS:
        has = cid in (idx2.get('units') or {}) and cid in (idx2.get('skins') or {})
        if not has:
            ok = False
        log('  %-10s units=%-5s skins=%-5s' % (nm, cid in (idx2.get('units') or {}), cid in (idx2.get('skins') or {})))
    for sid in sorted(skills):
        has = sid in (idx2.get('skills') or {})
        if not has:
            ok = False
        log('  %-20s skills=%s' % (sid, has))
    log('  prefabs=%d  textures=%d  清单 count=%s' % (
        len(idx2.get('prefabs') or {}),
        len(json.load(open(os.path.join(fxdir, 'textures.json'), encoding='utf-8')).get('textures') or {}),
        mf2.get('count')))
    log('  → %s' % ('✓ 全部写入' if ok else '★ 有缺项'))
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
