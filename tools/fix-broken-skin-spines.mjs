// tools/fix-broken-skin-spines.mjs — 重下【已确认损坏】的模型文件,并用项目自己的解析器验证。
//
// 只处理审计(tools/audit-skin-spines.mjs)确认的硬损坏:
//   · skel 解析失败(char_103_angel 基础/back)
//   · 附件在 atlas 里没有区域(4 条,全是 back)
// 流程:下载官方三件套到临时目录 → 用 parseSkel 验证(能解析 + 无缺区域 + size 与贴图一致)
//      → 验证通过才替换本地文件(原文件备份 .bak-before-redownload)
//
// 用法:node tools/fix-broken-skin-spines.mjs [--dry]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atlasInfo, normalizeAtlas } from './assets/atlas.mjs';
import { parseSkel } from './assets/skel.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const MIRROR = 'https://gh-proxy.com/https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine';
const TMP = path.join(ROOT, '.cache', 'redownload');

// 目标:charId(上游目录名) / stem / 侧 / 类型
const TARGETS = [
  { id: 'char_103_angel', stem: 'char_103_angel', side: 'Back', why: 'skel 解析失败(文件损坏)' },
  { id: 'char_103_angel', stem: 'char_103_angel_wild_1', side: 'Back', why: '18 个附件缺区域' },
  { id: 'char_150_snakek', stem: 'char_150_snakek_wild_1', side: 'Back', why: '28 个附件缺区域' },
  { id: 'char_600_cpione', stem: 'char_600_cpione', side: 'Back', why: '30 个附件缺区域' },
  { id: 'char_603_csnipe', stem: 'char_603_csnipe', side: 'Back', why: '21 个附件缺区域' },
];

function pngSize(buf) {
  if (buf.toString('latin1', 0, 8) !== '\x89PNG\r\n\x1a\n') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

fs.mkdirSync(TMP, { recursive: true });

for (const t of TARGETS) {
  const label = `${t.stem} ${t.side}`;
  console.log(`\n--- ${label}  (${t.why}) ---`);
  const dir = path.join(TMP, `${t.stem}-${t.side}`);
  fs.mkdirSync(dir, { recursive: true });

  const files = {};
  let ok = true;
  for (const ext of ['atlas', 'png', 'skel']) {
    const url = `${MIRROR}/${t.id}/${t.stem}/${t.side}/${t.stem}.${ext}`;
    try {
      const buf = await get(url);
      files[ext] = buf;
      fs.writeFileSync(path.join(dir, `${t.stem}.${ext}`), buf);
      console.log(`    ↓ ${ext}  ${buf.length} B`);
    } catch (e) {
      console.log(`    ★ ${ext} 下载失败: ${e.message}`);
      ok = false;
    }
  }
  if (!ok) continue;

  // 验证:normalizeAtlas(size 用真实贴图) → atlasInfo → parseSkel(带区域)
  const size = pngSize(files.png);
  if (!size) { console.log('    ★ 下载的贴图不是合法 PNG,跳过'); continue; }
  const norm = normalizeAtlas(files.atlas.toString('utf8'), { pageSize: () => size });
  const info = atlasInfo(norm.text);
  let sk;
  try {
    sk = parseSkel(files.skel, info.regions);
  } catch (e) {
    console.log(`    ★ 下载的 skel 仍解析失败: ${e.message} → 不替换`);
    continue;
  }
  console.log(`    ✓ skel 可解析,动画 ${sk.animations.length} 个: ${sk.animations.slice(0, 8).join(', ')}`);
  console.log(`    ✓ atlas 区域 ${info.regions.size} 个,缺区域 ${sk.missingRegions.length} 个`);
  console.log(`    ✓ 贴图 ${size.width}x${size.height}`);

  if (sk.missingRegions.length) {
    console.log(`    ★ 官方这版仍有 ${sk.missingRegions.length} 个附件缺区域 → 不替换(说明是模型与 atlas 本身的设计差异)`);
    continue;
  }

  // 找本地文件位置(从 manifest)
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'assets.json'), 'utf8'));
  const urlToFile = (u) => path.join(ROOT, 'public', String(u).replace(/^\//, '').split('/').join(path.sep));
  let entry = null;
  for (const [, rec] of Object.entries(manifest.chars || {})) {
    const sp = (rec || {}).spine;
    if (sp && sp.front && String(sp.front.skel).includes(`${t.stem}.skel`) && t.side === 'Front') entry = sp.front;
    if (sp && sp.back && String(sp.back.skel).includes(`${t.stem}.skel`) && t.side === 'Back') entry = sp.back;
    for (const [, sk2] of Object.entries((rec && rec.skins) || {})) {
      const s2 = sk2.spine || {};
      if (s2.front && String(s2.front.skel).includes(`${t.stem}.skel`) && t.side === 'Front') entry = s2.front;
      if (s2.back && String(s2.back.skel).includes(`${t.stem}.skel`) && t.side === 'Back') entry = s2.back;
    }
  }
  if (!entry) { console.log('    ★ 在 manifest 里找不到对应条目,跳过'); continue; }

  const pairs = [
    [urlToFile(entry.atlas), norm.text],
    [urlToFile(entry.skel), files.skel],
    [urlToFile(entry.textures[0]), files.png],
  ];
  for (const [dst, data] of pairs) {
    if (!fs.existsSync(dst)) { console.log(`    ★ 本地文件不存在: ${path.relative(ROOT, dst)}`); continue; }
    const before = fs.readFileSync(dst);
    const same = Buffer.isBuffer(data) ? before.equals(data) : before.toString('utf8') === data;
    if (same) { console.log(`    = 未变 ${path.basename(dst)}`); continue; }
    if (DRY) { console.log(`    [dry] 将替换 ${path.basename(dst)} (${before.length} → ${Buffer.byteLength(data)})`); continue; }
    const bak = dst + '.bak-before-redownload';
    if (!fs.existsSync(bak)) fs.copyFileSync(dst, bak);
    if (Buffer.isBuffer(data)) fs.writeFileSync(dst, data);
    else fs.writeFileSync(dst, data);
    console.log(`    ✔ 替换 ${path.basename(dst)} (${before.length} → ${Buffer.byteLength(data)} B)`);
  }
}

console.log(DRY ? '\n(--dry:没有写盘)\n' : '\n完成。请再跑 node tools/audit-skin-spines.mjs 复核。\n');
