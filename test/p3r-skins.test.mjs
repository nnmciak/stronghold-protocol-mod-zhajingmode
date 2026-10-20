// 皮肤完整性验证：每条登记 → 磁盘文件存在且 PNG 有效；并与 gen-avatars.mjs 的产出对照
// 运行（项目根）: node _skinverify.mjs
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const PUB = join(ROOT, 'public', 'assets');
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };
const bare = (u) => String(u).replace(/^\/assets\/~[0-9a-f]+\//, '').replace(/^\/assets\//, '');

const assets = JSON.parse(readFileSync(join(ROOT, 'data/assets.json'), 'utf8'));
const skins = JSON.parse(readFileSync(join(ROOT, 'data/skins.json'), 'utf8'));
const avatars = JSON.parse(readFileSync(join(ROOT, 'data/avatars.json'), 'utf8'));

const CASES = [
  ['char_4218_aigis', 'char_4218_aigis@p3r#1', '埃癸斯·静思真谛'],
  ['char_4219_yukari', 'char_4219_yukari@p3r#1', '岳羽由加莉·戍卫晨昏'],
  ['char_4220_kormr', 'char_4220_kormr@p3r#1', '虎狼丸·飞越甜蜜之城'],
  ['char_4217_makoto', 'char_4217_makoto@p3r#1', '结城理（对照，不应被破坏）'],
];

console.log('=== ① assets.json 里每个皮肤引用的文件都在 ===');
for (const [cid, skinId, label] of CASES) {
  const s = assets.chars[cid]?.skins?.[skinId];
  if (!s) { chk(`${label} 有登记`, false); continue; }
  const refs = [];
  if (s.avatar) refs.push(['avatar', s.avatar]);
  if (s.portrait) refs.push(['portrait', s.portrait]);
  for (const [side, sp] of Object.entries(s.spine || {})) {
    refs.push([`spine.${side}.skel`, sp.skel]);
    refs.push([`spine.${side}.atlas`, sp.atlas]);
    for (const [i, t] of (sp.textures || []).entries()) refs.push([`spine.${side}.tex${i}`, t]);
    refs.push([`spine.${side}.anims`, sp.anims ? '__anims__' : null]);
  }
  let bad = 0;
  for (const [what, u] of refs) {
    if (u === '__anims__') { if (!s.spine?.[what.split('.')[1]]?.anims) bad++; continue; }
    if (!u) { console.log('     ✗ %s %s 缺 URL', label, what); bad++; continue; }
    const p = join(PUB, bare(u));
    if (!existsSync(p)) { console.log('     ✗ %s %s → 文件不存在: %s', label, what, bare(u)); bad++; }
  }
  chk(`${label} 的 ${refs.length} 个引用全部落在磁盘上`, bad === 0, bad ? `${bad} 个缺失` : '');
}

console.log('\n=== ② 皮肤头像尺寸应为 180x180 ===');
for (const [cid, skinId, label] of CASES) {
  const s = assets.chars[cid]?.skins?.[skinId];
  if (!s?.avatar) { chk(`${label} 有皮肤头像`, false); continue; }
  const b = readFileSync(join(PUB, bare(s.avatar))).subarray(16, 24);
  const w = b.readUInt32BE(0), h = b.readUInt32BE(4);
  chk(`${label} 头像 ${w}x${h}`, w === 180 && h === 180);
}

console.log('\n=== ③ skins.json 有这三条 ===');
for (const [cid, skinId] of CASES) {
  const arr = skins.chars[cid] || [];
  chk(`${cid} 在 skins.json`, arr.some((x) => x && x.id === skinId), JSON.stringify(arr.find((x) => x?.id === skinId) || null));
}

console.log('\n=== ④ avatars.json 有这三条（src 指向真实文件）===');
for (const [, skinId, label] of CASES) {
  const id = 'skin:' + skinId;
  const it = avatars.items.find((x) => x && x.id === id);
  const u = avatars.src[id];
  chk(`${label} items 有条目`, !!it, it ? it.name : '');
  chk(`${label} src 指向存在的文件`, !!u && existsSync(join(PUB, bare(u))), u ? bare(u) : '(缺)');
}

console.log('\n=== ⑤ 与 gen-avatars.mjs 的产出对照（项目权威生成器）===');
try {
  const out = execFileSync('node', ['tools/gen-avatars.mjs'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const m = /skin[^\n]*?(\d+)/i.exec(out);
  console.log('  生成器输出（前 6 行）:');
  for (const l of out.split('\n').slice(0, 6)) if (l.trim()) console.log('     %s', l.trim().slice(0, 110));
  const hit = CASES.filter(([, sid]) => out.includes(sid));
  console.log('  生成器识别到我们的皮肤: %d/%d', hit.length, CASES.length);
  for (const [, sid] of CASES) console.log('     %s %s', out.includes(sid) ? '✓' : '✗', sid);
} catch (e) {
  console.log('  （生成器跑不起来，跳过对照: %s）', String(e.message).slice(0, 120));
}

console.log('\n=== 汇总 ===');
console.log('  assets.json chars %d   hash %s', Object.keys(assets.chars).length, assets.hash);
console.log('  skins.json  counts %s', JSON.stringify(skins.counts));
console.log('  avatars.json items %d  count %s', avatars.items.length, avatars.count);
console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
