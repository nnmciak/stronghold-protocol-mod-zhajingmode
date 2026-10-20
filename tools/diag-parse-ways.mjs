// 决定性小实验:同一份本地文件,不同调用方式是否给出不同结果?
// 重点排除两个嫌疑:(a) 传 Buffer(可能是内存池的视图) (b) atlas 文本是否先经过 normalizeAtlas
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atlasInfo, normalizeAtlas } from './assets/atlas.mjs';
import { parseSkel } from './assets/skel.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const urlToFile = (u) => path.join(ROOT, 'public', String(u).replace(/^\//, '').split('/').join(path.sep));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));

function entryFor(charId, skinId, side) {
  const rec = manifest.chars[charId];
  if (!rec) return null;
  if (skinId === null) return rec.spine && rec.spine[side];
  const sk = (rec.skins || {})[skinId];
  return sk && sk.spine && sk.spine[side];
}

const CASES = [
  ['char_103_angel', 'char_103_angel@wild#1', 'back'],
  ['char_150_snakek', 'char_150_snakek@wild#1', 'back'],
  ['char_600_cpione', null, 'back'],
  ['char_603_csnipe', null, 'back'],
  ['char_103_angel', null, 'back'],
  ['char_103_angel', null, 'front'],
];

for (const [charId, skinId, side] of CASES) {
  const e = entryFor(charId, skinId, side);
  console.log(`\n=== ${skinId || charId + ' 基础'} ${side} ===`);
  if (!e) { console.log('   没有条目'); continue; }
  const atlasFile = urlToFile(e.atlas);
  const skelFile = urlToFile(e.skel);
  console.log(`   atlas ${path.basename(atlasFile)}  ${fs.statSync(atlasFile).size} B`);
  console.log(`   skel  ${path.basename(skelFile)}  ${fs.statSync(skelFile).size} B`);
  const at = fs.readFileSync(atlasFile, 'utf8');
  const rawInfo = atlasInfo(at);
  const png = path.join(path.dirname(atlasFile), rawInfo.pages[0]);
  const size = (() => { const b = fs.readFileSync(png).subarray(0, 26); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; })();
  const norm = normalizeAtlas(at, { pageSize: () => size });
  const normInfo = atlasInfo(norm.text);
  console.log(`   原始 atlas: 页 ${rawInfo.pages.length} 区域 ${rawInfo.regions.size} hasSize=${rawInfo.hasSize}`);
  console.log(`   归一后    : 页 ${normInfo.pages.length} 区域 ${normInfo.regions.size}`);

  const buf = fs.readFileSync(skelFile);
  console.log(`   Buffer.byteOffset=${buf.byteOffset} byteLength=${buf.byteLength} underlying=${buf.buffer.byteLength}`);

  // 三种调用方式
  const ways = [
    ['Buffer + 原始区域', buf, rawInfo.regions],
    ['Buffer + 归一区域', buf, normInfo.regions],
    ['纯 Uint8Array 拷贝 + 归一区域', Uint8Array.from(buf), normInfo.regions],
  ];
  for (const [label, bytes, regions] of ways) {
    try {
      const sk = parseSkel(bytes, regions);
      console.log(`   [${label}] ✓ 动画 ${sk.animations.length} 个, 缺区域 ${sk.missingRegions.length} 个${sk.missingRegions.length ? ' 例: ' + sk.missingRegions.slice(0, 3).join(',') : ''}`);
    } catch (err) {
      console.log(`   [${label}] ★ ${err.message}`);
    }
  }
}
