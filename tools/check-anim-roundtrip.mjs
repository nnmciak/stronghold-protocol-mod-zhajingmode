// tools/check-anim-roundtrip.mjs — 安全检验:resolveRoles() 能否复现 manifest 里的 anims?
//
// 若能对"健康"的皮肤逐字段复现,就证明 manifest 的 anims 本来就是这条管线生成的,
// 那么对不上骨架的那 67 条 = 清单陈旧(皮肤没走管线)→ 用同一个函数重新生成即可修复。
// 若不能复现,就不能动 manifest(说明渲染器吃的是另一种形状)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atlasInfo } from './assets/atlas.mjs';
import { parseSkel } from './assets/skel.mjs';
import { resolveRoles } from './assets/anim-roles.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const urlToFile = (u) => path.join(ROOT, 'public', String(u).replace(/^\//, '').split('/').join(path.sep));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));

const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let match = 0, mismatch = 0, failed = 0;
const mismatchSamples = [];

for (const [charId, rec] of Object.entries(manifest.chars || {})) {
  const groups = [['基础', { front: (rec || {}).spine && rec.spine.front }]];
  for (const [skinId, sk] of Object.entries((rec && rec.skins) || {})) {
    for (const side of ['front', 'back']) {
      const e = ((sk || {}).spine || {})[side];
      if (!e) continue;
      let skelInfo;
      try {
        skelInfo = parseSkel(fs.readFileSync(urlToFile(e.skel)));
      } catch (err) {
        failed++; continue;
      }
      const roles = resolveRoles(skelInfo.animations, { skillIndices: [0], numberedSkills: false, durations: skelInfo.durations });
      if (deepEq(roles, e.anims)) match++;
      else {
        mismatch++;
        if (mismatchSamples.length < 6) {
          mismatchSamples.push({ id: skinId, side, kind: charId === skinId ? '基础' : '皮肤', got: roles, want: e.anims });
        }
      }
    }
  }
  // 基础的 back 也测
  const be = (rec || {}).spine && rec.spine.back;
  if (be) {
    try {
      const si = parseSkel(fs.readFileSync(urlToFile(be.skel)));
      const roles = resolveRoles(si.animations, { skillIndices: [0], numberedSkills: false, durations: si.durations });
      if (deepEq(roles, be.anims)) match++; else { mismatch++; }
    } catch { failed++; }
  }
}

console.log(`\nresolveRoles 往返复现结果:`);
console.log(`  ✅ 与 manifest 完全一致: ${match}`);
console.log(`  ✗  不一致           : ${mismatch}`);
console.log(`  ★  骨架解析失败      : ${failed}`);

for (const s of mismatchSamples) {
  console.log(`\n  --- ${s.kind} ${s.id} ${s.side} ---`);
  console.log(`     生成: ${JSON.stringify(s.got)}`);
  console.log(`     清单: ${JSON.stringify(s.want)}`);
}
