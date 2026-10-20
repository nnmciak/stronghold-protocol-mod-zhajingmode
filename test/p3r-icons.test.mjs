// 验证技能图标：客户端解析链 + 语义（该有的有、不该有的没有）
// 运行（项目根）: node _iconcheck.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const assets = JSON.parse(readFileSync(join(ROOT, 'data/assets.json'), 'utf8'));
const chess = JSON.parse(readFileSync(join(ROOT, 'data/chess.json'), 'utf8'));

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

// 客户端两条解析函数（public/js/assets.js 与 ui/assetUrls.js 各一份，这里用前者）
const { skillIconUrl } = await import('file:///' + join(ROOT, 'public/js/assets.js').replace(/\\/g, '/'));
const { skillIconUrl: skillIconUrl2 } = await import('file:///' + join(ROOT, 'public/js/ui/assetUrls.js').replace(/\\/g, '/'));

console.log('=== ① assets.js skillIconUrl（按 iconId → skillsById 回退）===');
for (const sid of ['skchr_aigis_1', 'skchr_aigis_2', 'skchr_yukari_1', 'skchr_yukari_2']) {
  const u = skillIconUrl(assets, sid);
  chk(`${sid} 可解析`, typeof u === 'string' && u.includes('/skill/'), String(u));
}

console.log('\n=== ② ui/assetUrls.js skillIconUrl（吃 chess 记录）===');
for (const [cid, name] of [['chess_zj_60_3_a', '埃癸斯 _a'], ['chess_zj_60_3_b', '埃癸斯 _b'],
                           ['chess_zj_60_4_a', '由加莉 _a'], ['chess_zj_60_4_b', '由加莉 _b']]) {
  const rec = chess[cid];
  const u = skillIconUrl2(assets, rec);
  console.log('  %-12s 装 %-18s iconId=%s → %s', name, rec.skill?.name, rec.skill?.iconId, u ?? '(null)');
  chk(`${name} 有图标`, typeof u === 'string' && u.includes('/skill/'));
}

console.log('\n=== ③ 虎狼丸（无技能）不该有图标 ===');
const k = chess.chess_zj_60_2_a;
console.log('  skill=%s  skills=%d', k?.skill, (k?.skills || []).length);
chk('虎狼丸 skill 为 null', k?.skill === null);
chk('虎狼丸 skills 为空数组', Array.isArray(k?.skills) && k.skills.length === 0);
chk('虎狼丸没有 skillIcon 登记', !assets.skills['skchr_kormr_1'], '（不应存在）');

console.log('\n=== ④ 图标文件与登记的 ~hash 一致（防路径漂移）===');
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
for (const sid of ['skchr_aigis_1', 'skchr_aigis_2', 'skchr_yukari_1', 'skchr_yukari_2']) {
  const url = assets.skills[sid];
  const m = /^\/assets\/~([0-9a-f]+)\/(.+)$/.exec(url || '');
  if (!m) { chk(`${sid} URL 格式`, false, String(url)); continue; }
  const abs = join(ROOT, 'public', 'assets', m[2]);
  if (!existsSync(abs)) { chk(`${sid} 文件存在`, false, m[2]); continue; }
  const h = createHash('sha256').update(readFileSync(abs)).digest('hex').slice(0, 16);
  chk(`${sid} ~hash 与实际文件一致`, h === m[1], h === m[1] ? '' : `登记 ${m[1]} vs 实际 ${h}`);
}

console.log('\n=== ⑤ 对照：结城理的三张仍完好 ===');
for (const sid of ['skchr_makoto_1', 'skchr_makoto_2', 'skchr_makoto_3']) {
  chk(`${sid} 未被破坏`, typeof assets.skills[sid] === 'string' && assets.skills[sid].includes('/skill/'), assets.skills[sid]);
}

console.log('\n=== 汇总 ===');
console.log('  assets.skills     %d 条', Object.keys(assets.skills).length);
console.log('  assets.skillsById %d 条', Object.keys(assets.skillsById).length);
console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
