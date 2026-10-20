// tools/audit-skin-spines.mjs — 用项目自己的解析器全量自检皮肤模型。
//
// 为什么用它:tools/assets/skel.mjs 的 parseSkel(bytes, atlasRegions) 会把骨架里的附件路径
// 与 atlas 的区域名逐一核对,返回 missingRegions —— 「附件找不到图」= 该部件没有贴图 = 模型残破。
// 这是客户端同款解析器(@pixi-spine/runtime-3.8),不依赖任何我手写的解析(手写的翻过三次车)。
//
// 检查项:
//   1. skel 能否解析(解析失败 = 模型加载不了 → 客户端会回落到头像图)
//   2. missingRegions(附件在 atlas 里没有区域 → 部件缺图)
//   3. 骨架里的动画名单 vs data/assets.json 的 anims 键是否一致
//   4. atlas 的 size: 是否等于真实贴图尺寸(上一轮已修,这里作为回归)
//
// 用法:node tools/audit-skin-spines.mjs [--limit N]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atlasInfo } from './assets/atlas.mjs';
import { parseSkel, skelParserAvailable } from './assets/skel.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const urlToFile = (u) => path.join(ROOT, 'public', String(u).replace(/^\//, '').split('/').join(path.sep));

function pngSize(file) {
  try {
    const b = fs.readFileSync(file).subarray(0, 26);
    if (b.toString('latin1', 0, 8) !== '\x89PNG\r\n\x1a\n') return null;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  } catch { return null; }
}

if (!skelParserAvailable()) {
  console.error('★ 需要 @pixi-spine/runtime-3.8(在仓库根跑一次 npm install)');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
const chars = manifest.chars || {};

/** 检查一个 spine 条目;返回问题数组 */
function check(tag, entry, expectAnims) {
  const issues = [];
  if (!entry || typeof entry !== 'object') return [`${tag}: 没有 spine 条目`];
  const atlasFile = urlToFile(entry.atlas);
  const skelFile = urlToFile(entry.skel);
  if (!fs.existsSync(atlasFile)) issues.push(`${tag}: atlas 文件不存在`);
  if (!fs.existsSync(skelFile)) issues.push(`${tag}: skel 文件不存在`);
  if (issues.length) return issues;

  const atlasText = fs.readFileSync(atlasFile, 'utf8');
  const info = atlasInfo(atlasText);
  // ① size: 回归
  if (!info.hasSize) issues.push(`${tag}: atlas 仍缺 size:`);
  const page = info.pages[0];
  if (page) {
    const png = path.join(path.dirname(atlasFile), page);
    const sz = fs.existsSync(png) ? pngSize(png) : null;
    if (!sz) issues.push(`${tag}: 贴图 ${page} 读不到`);
    else {
      const m = /^size:\s*(\d+)\s*,\s*(\d+)/m.exec(atlasText);
      if (m && (Number(m[1]) !== sz.width || Number(m[2]) !== sz.height)) {
        issues.push(`${tag}: size 写 ${m[1]},${m[2]} 但贴图是 ${sz.width},${sz.height}`);
      }
    }
  }
  // ② 骨架解析 + 附件/区域核对
  try {
    const bytes = fs.readFileSync(skelFile);
    const info2 = parseSkel(bytes, info.regions);
    if (info2.missingRegions.length) {
      issues.push(`${tag}: ${info2.missingRegions.length} 个附件在 atlas 里没有区域(例: ${info2.missingRegions.slice(0, 3).join(', ')})`);
    }
    // ③ 动画名单 vs manifest anims(只比【字符串】值:anims 里有的值是对象或 null,不是动画名)
    if (expectAnims && typeof expectAnims === 'object') {
      const want = new Set(Object.values(expectAnims).filter((v) => typeof v === 'string' && v));
      const have = new Set(info2.animations);
      const miss = [...want].filter((a) => !have.has(a));
      if (miss.length) issues.push(`${tag}: 骨架缺少动画 ${miss.join(', ')}`);
    }
  } catch (e) {
    issues.push(`${tag}: ★ skel 解析失败 — ${String(e && e.message).slice(0, 90)}`);
  }
  return issues;
}

const rows = [];
let checked = 0;
for (const [charId, rec] of Object.entries(chars)) {
  for (const side of ['front', 'back']) {
    const e = ((rec || {}).spine || {})[side];
    if (e) { checked++; rows.push(['基础', charId, side, check(`${charId} 基础/${side}`, e, e.anims)]); }
  }
  for (const [skinId, skin] of Object.entries((rec && rec.skins) || {})) {
    for (const side of ['front', 'back']) {
      const e = ((skin || {}).spine || {})[side];
      if (e) { checked++; rows.push(['皮肤', skinId, side, check(`${skinId} ${side}`, e, e.anims)]); }
    }
  }
}

const bad = rows.filter((r) => r[3].length);
const base = rows.filter((r) => r[0] === '基础');
const skin = rows.filter((r) => r[0] === '皮肤');
const baseBad = base.filter((r) => r[3].length);
const skinBad = skin.filter((r) => r[3].length);

console.log(`\n检查了 ${checked} 个 spine 条目(基础 ${base.length} / 皮肤 ${skin.length})`);
console.log(`  基础模型有问题: ${baseBad.length}`);
console.log(`  皮肤模型有问题: ${skinBad.length}`);

// 按问题类型归类
const kinds = new Map();
for (const [, , , issues] of bad) {
  for (const i of issues) {
    const k = i.includes('skel 解析失败') ? 'skel 解析失败'
      : i.includes('没有区域') ? '附件缺图(missingRegions)'
      : i.includes('缺少动画') ? '骨架缺动画'
      : i.includes('size') ? 'size 不符'
      : i.includes('不存在') || i.includes('读不到') ? '文件缺失'
      : '其他';
    kinds.set(k, (kinds.get(k) || 0) + 1);
  }
}
console.log('\n问题分类:');
for (const [k, v] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

if (bad.length) {
  console.log('\n明细(最多 40 条):');
  for (const [kind, id, side, issues] of bad.slice(0, 40)) {
    console.log(`  [${kind}] ${id} ${side}`);
    for (const i of issues) console.log(`        ${i}`);
  }
  if (bad.length > 40) console.log(`  … 共 ${bad.length} 条`);
  // 供后续修复的清单
  const out = path.join(ROOT, '.cache', 'skin-audit-issues.json');
  fs.writeFileSync(out, JSON.stringify(bad.map(([k, id, side, issues]) => ({ kind: k, id, side, issues })), null, 1));
  console.log(`\n清单已写入 ${path.relative(ROOT, out)}`);
} else {
  console.log('\n✅ 没有任何问题');
}
