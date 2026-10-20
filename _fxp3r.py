# -*- coding: utf-8 -*-
"""补抽四位 P3R 干员的 **p3r 皮肤变体**特效（<key>_p3r#1）。

默认皮的 prefab 已由 _fxmerge4.py 抽入；皮肤变体是独立 prefab（客户端命名 <key>_p3r#1），
crawl_units 只跟随默认皮引用，所以要单独按名字取。

用法（项目根）：python _fxp3r.py [--commit]
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
BK = os.path.join(G, '_fx-bak-prep3r')
AB = r'C:\Program Files\Hypergryph Launcher\games\Arknights\Arknights_Data\StreamingAssets\AB\Windows'
CODES = ('makoto', 'aigis', 'yukari', 'kormr')


def log(*a):
    print(*a, flush=True)


def main():
    commit = '--commit' in sys.argv
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'local-extract'))
    import fx

    fxdir = os.path.join(ROOT, 'public', 'assets', 'local', 'fx')
    manifest_p = os.path.join(ROOT, 'data', 'local-fx.json')

    log('=== ① 全量扫客户端，筛出四位的 _p3r#1 prefab ===')
    eff = fx.container_index(AB, fx.EFFECT_GLOBS, os.path.join(ROOT, '.cache', 'fx', 'effects.json'), 8, log)
    log('  客户端 prefab %d' % len(eff))
    want = sorted(k for k in eff if k.endswith('_p3r#1') and any(c in k for c in CODES))
    log('  四位 p3r 变体 %d 个' % len(want))
    idx = json.load(open(os.path.join(fxdir, 'index.json'), encoding='utf-8'))
    have = set(idx.get('prefabs') or {})
    todo = [k for k in want if k not in have]
    log('  其中库里还没有的 %d 个' % len(todo))
    for k in todo[:20]:
        log('     %s' % k)

    # 顺带：非 p3r 的、也还没抽的（保险起见一起补）
    rest = sorted(k for k in eff
                  if any(c in k for c in CODES) and not k.endswith('_p3r#1') and k not in have
                  and not any(x in k for x in ('_p3r',)))
    if rest:
        log('  另有非 p3r 且未抽的 %d 个: %s' % (len(rest), ', '.join(rest[:10])))
        todo = sorted(set(todo) | set(rest))

    if not todo:
        log('  无需补抽')
        return 0
    if not commit:
        log()
        log('（未带 --commit）将导出 %d 个键' % len(todo))
        return 0

    log()
    log('=== ② 备份 ===')
    b = os.path.join(BK, 'p3r-' + time.strftime('%Y%m%d-%H%M%S'))
    os.makedirs(b, exist_ok=True)
    shutil.copy2(manifest_p, os.path.join(b, 'local-fx.json'))
    for f in ('index.json', 'textures.json'):
        shutil.copy2(os.path.join(fxdir, f), os.path.join(b, f))
    log('  备份 → %s' % b)

    log()
    log('=== ③ 导出 ===')
    t0 = time.time()
    n = fx.export_fx(AB, os.path.join(ROOT, 'public', 'assets', 'local'), {}, log,
                     selection='keys', keys=todo, jobs=8, root=ROOT, fx_manifest=manifest_p)
    log('  写入 %d 个文件，%.1fs' % (n, time.time() - t0))

    log()
    log('=== ④ 复核 ===')
    idx2 = json.load(open(os.path.join(fxdir, 'index.json'), encoding='utf-8'))
    mf2 = json.load(open(manifest_p, encoding='utf-8'))
    got = [k for k in todo if k in (idx2.get('prefabs') or {})]
    log('  prefabs %d → %d' % (len(have), len(idx2.get('prefabs') or {})))
    log('  清单 count=%s' % mf2.get('count'))
    for c in CODES:
        n2 = len([k for k in idx2['prefabs'] if c in k and k.endswith('_p3r#1')])
        log('  %-8s p3r 变体入库 %d' % (c, n2))
    log('  → %s' % ('✓ 全部写入' if len(got) == len(todo) else '★ 有缺项 %d' % (len(todo) - len(got))))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
