// 看审计清单的完整内容,并对"缺 Die"取样:本地 skel 到底有哪些动画(判断是文件坏还是清单写错)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atlasInfo } from './assets/atlas.mjs';
import { parseSkel } from './assets/skel.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const urlToFile = (u) => path.join(ROOT, 'public', String(u).replace(/^\//, '').split('/').join(path.sep));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));

const issues = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache', 'skin-audit-issues.json'), 'utf8'));

console.log('=== 非"缺 Die"的问题(全部列出)===');
for (const r of issues) {
  const real = r.issues.filter((i) => !i.includes('缺少动画'));
  if (real.length) {
    console.log(`  [${r.kind}] ${r.id} ${r.side}`);
    for (const i of real) console.log(`       ${i}`);
  }
}

const dieOnes = issues.filter((r) => r.issues.some((i) => i.includes('缺少动画')));
console.log(`\n=== "缺 Die"共 ${dieOnes.length} 条,抽样看本地 skel 真实动画名单 ===`);
const seen = new Set();
for (const r of dieOnes) {
  if (seen.size >= 4) break;
  const key = r.id.split('@')[0];
  if (seen.has(key)) continue;
  seen.add(key);
  // 找到 manifest 条目
  let entry = null;
  for (const [, rec] of Object.entries(manifest.chars || {})) {
    for (const [sid, sk] of Object.entries((rec && rec.skins) || {})) {
      if (sid === r.id && sk.spine && sk.spine[r.side]) entry = sk.spine[r.side];
    }
  }
  if (!entry) { console.log(`  ${r.id} ${r.side}: 找不到条目`); continue; }
  const at = urlToFile(entry.atlas);
  const sk = urlToFile(entry.skel);
  const info = atlasInfo(fs.readFileSync(at, 'utf8'));
  const si = parseSkel(fs.readFileSync(sk), info.regions);
  console.log(`  ${r.id} ${r.side}`);
  console.log(`     骨架实际动画: ${si.animations.join(', ')}`);
  console.log(`     清单 anims  : ${JSON.stringify(entry.anims)}`);
}

// 基础模型的对照:能天使 back 的损坏情况
console.log('\n=== char_103_angel 基础 back 的损坏情况 ===');
const angel = (manifest.chars || {}).char_103_angel;
if (angel && angel.spine && angel.spine.back) {
  const e = angel.spine.back;
  const sk = urlToFile(e.skel);
  const st = fs.statSync(sk);
  console.log(`  skel: ${path.basename(sk)}  ${st.size} B`);
  console.log(`  atlas: ${path.basename(urlToFile(e.atlas))}`);
  console.log(`  png: ${(e.textures || []).map((t) => path.basename(t)).join(', ')}`);
  try {
    const info = atlasInfo(fs.readFileSync(urlToFile(e.atlas), 'utf8'));
    const si = parseSkel(fs.readFileSync(sk), info.regions);
    console.log(`  解析成功,动画 ${si.animations.length} 个`);
  } catch (err) {
    console.log(`  ★ 解析失败: ${err.message}`);
  }
  // 正面作对照
  const fe = angel.spine.front;
  if (fe) {
    const fst = fs.statSync(urlToFile(fe.skel));
    console.log(`  对照 front skel: ${fst.size} B`);
  }
}
