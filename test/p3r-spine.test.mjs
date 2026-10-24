// spine 模型全面验证：6 个骨架（默认+皮肤 × 前后面）
//   ① 能否被项目 runtime 解析  ② anims 角色映射是否合理  ③ 需要的动画是否齐备
//   ④ 皮肤版的角色映射是否与默认版一致（避免换皮肤后动作错乱）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkel } from '../tools/assets/skel.mjs';

const ROOT = process.cwd();
const assets = JSON.parse(readFileSync(join(ROOT, 'data/assets.json'), 'utf8'));

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };
const bare = (u) => String(u).replace(/^\/assets\/~[0-9a-f]+\//, '').replace(/^\/assets\//, '');

const CHARS = [
  ['char_4217_makoto', '结城理'],
  ['char_4218_aigis', '埃癸斯'],
  ['char_4219_yukari', '岳羽由加莉'],
  ['char_4220_kormr', '虎狼丸'],
];

/** 一个骨架条目 → { animations, durations, events, hits } */
function parse(entry, label) {
  const skelPath = join(ROOT, 'public', 'assets', bare(entry.skel));
  const atlasPath = join(ROOT, 'public', 'assets', bare(entry.atlas));
  const atlasText = readFileSync(atlasPath, 'utf8');
  // atlas region 名
  const lines = atlasText.replace(/\r\n/g, '\n').split('\n');
  const regions = new Set();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l || l[0] === ' ' || l[0] === '\t') continue;
    if (/^(size|format|filter|repeat|pma|scale):/.test(l) || l.includes(':')) continue;
    if ((lines[i + 1] || '').trim().startsWith('rotate:')) regions.add(l.trim());
  }
  const sk = parseSkel(readFileSync(skelPath), regions);
  return { sk, regions: regions.size };
}

console.log('='.repeat(74));
console.log('  spine 模型验证');
console.log('='.repeat(74));

const summary = {};
for (const [cid, name] of CHARS) {
  const ch = assets.chars[cid];
  const skinId = `${cid}@p3r#1`;
  const skin = ch?.skins?.[skinId];
  console.log('\n══ %s %s ══' % (name, cid));

  const forms = [['默认', ch?.spine], ['皮肤', skin?.spine]];
  for (const [form, spine] of forms) {
    if (!spine) { chk(`${form} 有 spine 登记`, false); continue; }
    for (const side of ['front', 'back']) {
      const e = spine[side];
      if (!e) { chk(`${form}.${side} 存在`, false); continue; }
      const tag = `${form}.${side}`;
      try {
        const { sk, regions } = parse(e, tag);
        const anims = sk.animations;
        const roleKeys = Object.keys(e.anims || {}).filter((k) => e.anims[k]);
        const missing = (sk.missingRegions || []).length;
        console.log('  ── %s ── %d 个动画, atlas %d region, 缺 %d', tag, anims.length, regions, missing);
        console.log('     骨架动画: %s', anims.join(', '));
        console.log('     登记的角色: %s', roleKeys.join(', '));
        console.log('     hits: %s', JSON.stringify(sk.hits || {}));
        chk(`${tag} 能解析且有动画`, anims.length > 0);
        chk(`${tag} 无缺失 region`, missing === 0, missing ? `${missing} 个` : '');
        // 角色映射里的每个 clip 名都要真在骨架里。
        // 注意：anims 里除 clip 名外还有非 clip 字段 ——
        //   `via`（动画路由机制：attackAny / attack / idle …）、`index`（技能序号，数字）、
        //   `skills`（按技能序号索引的子表）。这些不能当 clip 校验。
        const CLIP_KEYS = new Set(['begin', 'loop', 'end', 'idle', 'die', 'move', 'deploy', 'attackDown', 'stun']);
        const badClips = [];
        const walk = (v, path, key) => {
          if (v === null || v === undefined) return;
          if (typeof v === 'string') {
            // 只有「在 clip 位置上的字符串」才是 clip 名
            if (key === 'via') return;                    // 路由机制名
            if (v && !anims.includes(v)) badClips.push(path + '=' + v);
            return;
          }
          if (typeof v === 'number') return;
          if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, key)); return; }
          if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path + '.' + k, k);
        };
        for (const [k, v] of Object.entries(e.anims || {})) walk(v, tag + '.' + k, k);
        chk(`${tag} 角色映射的 clip 都存在于骨架`, badClips.length === 0, badClips.slice(0, 4).join(', '));
        summary[`${cid}|${form}|${side}`] = { anims: new Set(anims), animsArr: anims, roles: e.anims };
      } catch (err) {
        chk(`${tag} 解析`, false, err.message);
      }
    }
  }
}

console.log('\n' + '='.repeat(74));
console.log('  皮肤版与默认版的角色映射一致性');
console.log('='.repeat(74));
for (const [cid, name] of CHARS) {
  for (const side of ['front', 'back']) {
    const a = summary[`${cid}|默认|${side}`];
    const b = summary[`${cid}|皮肤|${side}`];
    if (!a || !b) { chk(`${name}.${side} 两版都有`, false); continue; }
    // 只比较两版都有的动画名（皮肤可能少几个，如 Die）
    const common = [...a.anims].filter((x) => b.anims.has(x));
    const onlyDefault = [...a.anims].filter((x) => !b.anims.has(x));
    const onlySkin = [...b.anims].filter((x) => !a.anims.has(x));
    console.log('\n  ── %s.%s ── 共有 %d 个动画', name, side, common.length);
    if (onlyDefault.length) console.log('     仅默认版有: %s', onlyDefault.join(', '));
    if (onlySkin.length) console.log('     仅皮肤版有: %s', onlySkin.join(', '));
    // 角色映射：把 clip 名映射到"该 clip 在两版中的序号位置"再比，避免名字不同就报错
    const norm = (r, anims) => JSON.stringify(r, (k, v) => (typeof v === 'string' && anims.has(v) ? `#${[...anims].indexOf(v)}` : v));
    const same = norm(a.roles, a.anims) === norm(b.roles, b.anims);
    chk(`${name}.${side} 角色映射一致`, same);
    if (!same) {
      console.log('     默认: %s', JSON.stringify(a.roles));
      console.log('     皮肤: %s', JSON.stringify(b.roles));
    }
  }
}

console.log('\n' + '='.repeat(74));
console.log('  %s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
console.log('='.repeat(74));
process.exit(fail ? 1 : 0);
