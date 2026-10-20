# -*- coding: utf-8 -*-
"""定向增量提取：四位 P3R 干员（char_4217_makoto / 4218_aigis / 4219_yukari / 4220_kormr）的官方战斗特效。

与 `extract.py --only fx --fx-set used` 的区别：只 crawl 这四位（不扫全部 516 个单位），
把结果**合并**进现有 fx 索引与清单，而不是重写整套。

用法（项目根）：
    python _fxadd4.py --stage      # 只提取到暂存目录并报告，不碰现有库
    python _fxadd4.py --commit     # 合并进 public/assets/local/fx 与 data/local-fx.json

注意：fx.py 用 multiprocessing，Windows 上必须 __main__ 守卫。
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

UNITS = [
    ('char_4217_makoto', '结城理'),
    ('char_4218_aigis', '埃癸斯'),
    ('char_4219_yukari', '岳羽由加莉'),
    ('char_4220_kormr', '虎狼丸'),
]


def log(*a):
    print(*a, flush=True)


def read_json(p, default=None):
    try:
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def main():
    commit = '--commit' in sys.argv
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'local-extract'))
    import fx

    fxdir = os.path.join(ROOT, 'public', 'assets', 'local', 'fx')
    fx_manifest = os.path.join(ROOT, 'data', 'local-fx.json')

    # 暂存目录沿用现有索引（合并语义），这样写出来的就是"完整的新库"
    stage_fx = os.path.join(STAGE, 'fx')
    os.makedirs(stage_fx, exist_ok=True)
    if not os.path.exists(os.path.join(stage_fx, 'index.json')):
        shutil.copy2(os.path.join(fxdir, 'index.json'), os.path.join(stage_fx, 'index.json'))
    if not os.path.exists(os.path.join(stage_fx, 'textures.json')):
        shutil.copy2(os.path.join(fxdir, 'textures.json'), os.path.join(stage_fx, 'textures.json'))
    # 已有 prefab 描述文件也先接到暂存，避免只看新增时缺上下文
    for sub in ('prefabs', 'tex', 'mesh'):
        d = os.path.join(stage_fx, sub)
        os.makedirs(d, exist_ok=True)

    log('=== ① 扫客户端 ===')
    cabs = fx.scan_cabs(AB)
    eff = fx.container_index(AB, fx.EFFECT_GLOBS, os.path.join(ROOT, '.cache', 'fx', 'effects.json'), 8, log)
    log('  CAB %d，特效预制体 %d' % (len(cabs), len(eff)))

    log()
    log('=== ② crawl 四位 ===')
    gd = fx.game_data(ROOT)
    log('  game_data chars=%d enemies=%d tokens=%d' % (len(gd['chars']), len(gd['enemies']), len(gd['tokens'])))
    for cid, nm in UNITS:
        log('  %s 在 chars 里: %s' % (nm, cid in gd['chars']))

    unit_ids = [c[0] for c in UNITS]
    t0 = time.time()
    units, projectiles, skills, skins, referenced = fx.crawl_units(
        AB, cabs, unit_ids, gd, eff, {}, {}, log)
    log('  crawl 用时 %.1fs' % (time.time() - t0))
    log('  units=%d projectiles=%d skills=%d skins=%d' % (len(units), len(projectiles), len(skills), len(skins)))
    log('  引用到的特效键 %d 个' % len(referenced))
    for cid, nm in UNITS:
        u = units.get(cid)
        log('  %-10s units=%-5s skins=%-5s' % (nm, bool(u), cid in skins))
    log('  技能: %s' % ', '.join(sorted(skills)))
    log('  弹道: %s' % ', '.join(sorted(projectiles)))

    if not units and not skills:
        log('★ 没有 crawl 到任何东西，中止')
        return 2

    # 保存中间结果，便于检查
    os.makedirs(STAGE, exist_ok=True)
    json.dump({'units': sorted(units), 'projectiles': sorted(projectiles), 'skills': sorted(skills),
               'skins': sorted(skins), 'referenced': sorted(referenced)},
              open(os.path.join(STAGE, 'crawl-summary.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    log('  中间结果 → %s' % os.path.join(STAGE, 'crawl-summary.json'))

    log()
    log('=== ③ 导出 prefab 描述 / 贴图 / 网格 ===')
    log('  （这一步耗时最长，新增 prefab 数约 %d）' % len(referenced))
    # export_fx(selection='used') 会自己算 wanted（含 FX_SAMPLE/COVERAGE/generic），
    # 但它的 unit_ids 来自 game_data 全表。这里传 keys=referenced 走增量分支：
    # 它只导出给定键，且会**合并**进现有 index.json / textures.json / 清单。
    stage_manifest = os.path.join(STAGE, 'local-fx.json')
    if not os.path.exists(stage_manifest):
        shutil.copy2(fx_manifest, stage_manifest)
    t0 = time.time()
    n = fx.export_fx(AB, os.path.join(STAGE), {}, log,
                     selection='keys', keys=sorted(referenced), jobs=8,
                     root=ROOT, fx_manifest=stage_manifest)
    log('  导出 %d 个文件，用时 %.1fs' % (n, time.time() - t0))

    log()
    log('=== ④ 结果核对 ===')
    idx = read_json(os.path.join(stage_fx, 'index.json'))
    mf = read_json(stage_manifest)
    log('  暂存 index: units=%d skills=%d prefabs=%d' % (
        len(idx.get('units') or {}), len(idx.get('skills') or {}), len(idx.get('prefabs') or {})))
    log('  暂存清单 count=%s  groups=%s' % (mf.get('count'), {k: len(v) for k, v in (mf.get('groups') or {}).items()}))
    newp = [k for k in (idx.get('prefabs') or {}) if k not in (read_json(os.path.join(fxdir, 'index.json')).get('prefabs') or {})]
    log('  新增 prefab %d 个: %s' % (len(newp), ', '.join(newp[:6])))

    if not commit:
        log()
        log('（--stage 模式：未改动 public/assets/local/fx 与 data/local-fx.json）')
        return 0

    log()
    log('=== ⑤ 合并进正式库 ===')
    raise SystemExit('commit 分支待实现')


if __name__ == '__main__':
    raise SystemExit(main())
