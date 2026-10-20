// tools/normalize-skin-atlases.mjs — 给【皮肤】的 spine atlas 补上 `size:` 行。
//
// 背景(这是本次"皮肤糊"的根因):
//   tools/assets/atlas.mjs 的 normalizeAtlas() 是资产管线的一部分,它会给 atlas 补 `size: W,H` ——
//   注释写得很清楚:「fexli atlases omit it; spine-ts divides by 0 and pixi-spine warns」,
//   并在与真实 PNG 尺寸不符时【改正】它。
//   base 模型、敌人都走这条管线,所以它们的 atlas 都有正确的 `size:`。
//   而皮肤资源是从外部整包放进来的(public/assets/spine/op/<charId>/<stem>/),**从没走过管线** ——
//   于是皮肤 atlas 全部缺 `size:`(或带着错的),spine-ts 按错误/零页面尺寸算 UV。
//
//   后果的严重程度 = 贴图里有多少空白:艺术区没铺满贴图的皮肤会被拉伸。
//   实测艺术区占比:396/440 条 ≥85%(看不出来),而洛洛只有 36~39%(全表倒数第 8/11)→ 糊得最明显。
//
// 这个脚本对每个皮肤 atlas 调同一个 normalizeAtlas():
//   · 缺 `size:` → 在页名后插入真实的 PNG 尺寸
//   · 有但与 PNG 不符 → 改正
// 幂等:再跑一次输出相同。原文件先备份成 `<atlas>.bak-before-size`。
//
// 用法:node tools/normalize-skin-atlases.mjs [--dry]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAtlas } from './assets/atlas.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

/** PNG 的真实像素尺寸(只读头 26 字节,不做完整解码)。 */
function pngSize(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(26);
    if (fs.readSync(fd, head, 0, 26, 0) < 26) return null;
    if (head.toString('latin1', 0, 8) !== '\x89PNG\r\n\x1a\n') return null;
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

const urlToFile = (u) => path.join(ROOT, 'public', String(u).replace(/^\//, '').split('/').join(path.sep));

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'assets.json'), 'utf8'));
const chars = manifest.chars || {};

let seen = 0, inserted = 0, corrected = 0, unchanged = 0, noPng = 0;
const problems = [];

for (const [charId, rec] of Object.entries(chars)) {
  for (const [skinId, skin] of Object.entries((rec && rec.skins) || {})) {
    for (const side of ['front', 'back']) {
      const entry = skin && skin.spine && skin.spine[side];
      if (!entry || typeof entry.atlas !== 'string') continue;
      seen++;
      const atlasFile = urlToFile(entry.atlas);
      if (!fs.existsSync(atlasFile)) { problems.push(`${skinId} ${side}: atlas 不存在`); continue; }
      const dir = path.dirname(atlasFile);
      // 页名 = atlas 的第一行非空内容(即 PNG 文件名)
      const text = fs.readFileSync(atlasFile, 'utf8');
      const pageName = text.split('\n').map((l) => l.trim()).find(Boolean);
      const png = pageName ? path.join(dir, pageName) : null;
      const size = png && fs.existsSync(png) ? pngSize(png) : null;
      if (!size) { noPng++; problems.push(`${skinId} ${side}: 贴图 ${pageName} 读不到尺寸`); continue; }

      const had = /^size:/m.test(text);
      const res = normalizeAtlas(text, { pageSize: () => size });
      if (!res.changed) { unchanged++; continue; }
      if (DRY) {
        console.log(`  [dry] ${skinId} ${side}: ${had ? '改正 size' : '缺 size → 插入'} ${size.width},${size.height}`);
      } else {
        const bak = atlasFile + '.bak-before-size';
        if (!fs.existsSync(bak)) fs.copyFileSync(atlasFile, bak);
        fs.writeFileSync(atlasFile, res.text);
      }
      if (had) corrected++; else inserted++;
    }
  }
}

console.log(`\n皮肤 spine 条目: ${seen}`);
console.log(`  缺 size: 插入 ${inserted}`);
console.log(`  有 size 但尺寸不符: 改正 ${corrected}`);
console.log(`  本来就正确(未动) ${unchanged}`);
if (noPng) console.log(`  读不到贴图尺寸: ${noPng}`);
if (problems.length) {
  console.log('\n需要注意:');
  for (const p of problems.slice(0, 20)) console.log('  · ' + p);
  if (problems.length > 20) console.log(`  … 共 ${problems.length} 条`);
}
if (DRY) console.log('\n(--dry:没有写盘)\n');
