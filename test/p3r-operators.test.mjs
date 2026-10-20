// 验证三位 P3R 干员的 kit 都能加载 + 用真实 chess 记录构造成功
// 运行：从**项目根**执行  node test/p3r-operators.test.mjs  （ROOT = cwd）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const chess = JSON.parse(readFileSync(join(ROOT, 'data/chess.json'), 'utf8'));
const assets = JSON.parse(readFileSync(join(ROOT, 'data/assets.json'), 'utf8'));
const { validSpine } = await import('file:///' + join(ROOT, 'public/js/assets.js').replace(/\\/g, '/'));
const idx = await import('file:///' + join(ROOT, 'server/sim/content/kits/index.js').replace(/\\/g, '/'));

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const CASES = [
  ['chess_zj_60_2_a', 'char_4220_kormr', '虎狼丸'],
  ['chess_zj_60_3_a', 'char_4218_aigis', '埃癸斯'],
  ['chess_zj_60_4_a', 'char_4219_yukari', '岳羽由加莉'],
];

for (const [chessId, cid, name] of CASES) {
  console.log('\n══ %s %s (%s) ══', name, cid, chessId);
  const rec = chess[chessId];
  chk('chess 记录存在', !!rec);
  chk('charId 一致', rec?.charId === cid, rec?.charId);

  const a = assets.chars[cid];
  chk('assets 素材登记', !!a);
  chk('validSpine front/back', validSpine(a?.spine?.front) && validSpine(a?.spine?.back));

  chk('OPERATOR_KITS 有它', !!idx.OPERATOR_KITS[cid]);
  chk('KITTED_CHARS 含它', idx.KITTED_CHARS.includes(cid));
  chk('zhajing 标记（决定进池）', rec?.zhajing === true);
  // 虎狼丸是近战（rangeId 1-1），普攻范围由 rangeId 决定、天赋范围由 kit 内置常量给；
  // 另两位是远程，必须有 rangeGrid。
  if (cid === 'char_4220_kormr') {
    chk('近战 rangeId=1-1（范围由 rangeId 决定）', rec?.rangeId === '1-1', rec?.rangeId);
    // 虎狼丸官方无技能（character_table.skills = []），只有天赋
    chk('无技能（官方如此）', Array.isArray(rec?.skills) && rec.skills.length === 0, `${rec?.skills?.length ?? 0} 个`);
    chk('天赋 1 项', Array.isArray(rec?.talents) && rec.talents.length === 1);
  } else {
    chk('rangeGrid 非空', Array.isArray(rec?.rangeGrid) && rec.rangeGrid.length > 0, `${rec?.rangeGrid?.length} 格`);
    chk('有技能记录', Array.isArray(rec?.skills) && rec.skills.length > 0, `${rec?.skills?.length ?? 0} 个`);
  }

  if (idx.OPERATOR_KITS[cid] && rec) {
    try {
      const built = idx.OPERATOR_KITS[cid](rec.skills?.[rec.backup?.skillIndex ?? 0]?.bb ?? {}, rec, {});
      chk('用真实记录构造 kit 成功', true, `键: ${Object.keys(built).join(',')}`);
    } catch (e) {
      chk('用真实记录构造 kit 成功', false, e.message);
      console.log('     ' + (e.stack || '').split('\n').slice(1, 3).join('\n     '));
    }
  }
}

console.log('\n══ 池统计 ══');
const zj = Object.values(chess).filter((c) => c.zhajing === true);
console.log('  炸惊池棋子: %d 个（原 181 + 虎狼丸 2 + 埃癸斯 2 + 由加莉 2 = 187）', zj.length);
console.log('  chess.json 总条数: %d', Object.keys(chess).length);
console.log('  assets.json chars: %d', Object.keys(assets.chars).length);

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
