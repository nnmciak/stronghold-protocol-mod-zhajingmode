// 数据里的描述文本必须符合官方约定（否则 UI 会原样显示 `{key}` 占位符）。
// 运行（项目根）: node test/data-desc-format.test.mjs
//
// 用户 2026-10-17：「这几个干员的技能描述你都没填数值啊」（截图里是 `{multi_atk_scale:0%}`）。
//
// 根因：`data/chess.json` 的 `descRaw` 是从官方模板抄来的**未解析**文本。
//   官方约定（对照 chess_char_1_01_a 隐现 / chess_char_2_11_a 风丸）：
//     · `descRaw` = 数值已解析 + 保留 `<@ba.*>` / `<$ba.*>` 标记（含闭合 `</>`）
//     · `desc`    = `descRaw` 剥掉 `<@…>` / `<$…>` / `</>`；**`<替身>` 这类词标记连尖括号一起保留**
//   而客户端 `public/js/ui/richText.js` 的 `TAG_OPEN` 只认 `<@` / `<$` 前缀，
//   **不做 `{key}` 替换** ⇒ 占位符会原样显示给玩家。
//
// 这个测试把上面每一条都钉住，防止以后再抄进未解析的模板。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const chess = JSON.parse(readFileSync(join(ROOT, 'data/chess.json'), 'utf8'));

/** 官方 rich text 标签：`<@ba.xxx>` / `<$ba.xxx>` / `</>`。`<替身>` 不算（会被 updateTag 保留）。 */
const TAG = /<[@$][A-Za-z0-9_.\-]{1,48}>|<\/>/g;
/** 未解析占位符：`{key}` 或 `{key:0%}`。 */
const PH = /\{[^{}]*[A-Za-z_@][^{}]*\}/;

const nodes = [];
(function walk(n, path) {
  if (Array.isArray(n)) { n.forEach((v, i) => walk(v, path + `[${i}]`)); return; }
  if (!n || typeof n !== 'object') return;
  if (typeof n.descRaw === 'string' || typeof n.desc === 'string') nodes.push({ path, node: n });
  for (const [k, v] of Object.entries(n)) {
    if (k === 'descRaw' || k === 'desc') continue;
    walk(v, path ? `${path}.${k}` : k);
  }
})(chess, '');

console.log('=== 扫描 data/chess.json：%d 个带描述文本的节点 ===', nodes.length);

// ── ① 不能有任何未解析的占位符
{
  const bad = [];
  for (const { path, node } of nodes) {
    for (const f of ['descRaw', 'desc']) {
      const v = node[f];
      if (typeof v === 'string' && PH.test(v)) bad.push(`${path}.${f}`);
    }
  }
  chk('★ 没有未解析的 {key} 占位符（否则 UI 原样显示）', bad.length === 0, `${bad.length} 处`);
  for (const b of bad.slice(0, 6)) console.log('      ★ %s', b);
}

// ── ② desc === strip_tags(descRaw)（官方约定；全库 4615 对全部满足）
{
  const bad = [];
  let pairs = 0;
  for (const { path, node } of nodes) {
    const { desc, descRaw } = node;
    if (typeof desc !== 'string' || typeof descRaw !== 'string' || !descRaw) continue;
    pairs++;
    const want = descRaw.replace(TAG, '');
    if (want !== desc) bad.push({ path, desc, want });
  }
  chk('★ desc === 剥掉标记的 descRaw（全库约定）', bad.length === 0, `${bad.length} / ${pairs} 不成立`);
  for (const b of bad.slice(0, 4)) {
    console.log('      ★ %s', b.path);
    console.log('         desc  : %s', JSON.stringify(b.desc.slice(0, 80)));
    console.log('         应为  : %s', JSON.stringify(b.want.slice(0, 80)));
  }
}

// ── ③ descRaw 不能出现客户端不认识的标记（`<b>` 之类会被原样画出来）
{
  const bad = [];
  for (const { path, node } of nodes) {
    const v = node.descRaw;
    if (typeof v !== 'string') continue;
    // 把所有合法标签去掉后，不该还残留 <xxx> 形式
    const rest = v.replace(TAG, '');
    const stray = rest.match(/<[^<>]{1,16}>/g);
    // `<替身>` 这类中文词标记是官方的，放行
    const illegal = (stray || []).filter((t) => !/^<[\u4e00-\u9fa5]{1,8}>$/.test(t));
    if (illegal.length) bad.push({ path, illegal });
  }
  chk('★ descRaw 里没有客户端不支持的标记（如 <b>）', bad.length === 0, `${bad.length} 处`);
  for (const b of bad.slice(0, 6)) console.log('      ★ %s  %o', b.path, b.illegal);
}

// ── ④ P3R 四人的每条技能都要有非空描述
{
  const OPS = ['chess_zj_60_2_a', 'chess_zj_60_2_b', 'chess_zj_60_3_a', 'chess_zj_60_3_b',
    'chess_zj_60_4_a', 'chess_zj_60_4_b', 'chess_zj_60_5_a', 'chess_zj_60_5_b'];
  const bad = [];
  let n = 0;
  for (const cid of OPS) {
    const r = chess[cid];
    if (!r) { bad.push(`${cid} 记录缺失`); continue; }
    for (const s of [r.skill, ...(r.skills || [])]) {
      if (!s || !s.skillId) continue;
      n++;
      if (!s.desc || !s.desc.trim()) bad.push(`${cid}/${s.skillId} desc 为空`);
      if (!s.descRaw || !s.descRaw.trim()) bad.push(`${cid}/${s.skillId} descRaw 为空`);
    }
  }
  chk('★ P3R 四人的技能描述都非空', bad.length === 0, `检查 ${n} 条技能；问题 ${bad.length}`);
  for (const b of bad.slice(0, 6)) console.log('      ★ %s', b);
}

// ── ⑤ 描述里的数字必须与 bb 一致（抽样：由加莉 S1 / 埃癸斯 S2 / 结城理 S2）
{
  const cases = [
    ['chess_zj_60_4_a', 'skchr_yukari_1', ['55%', '250%', '1.5']],
    ['chess_zj_60_3_a', 'skchr_aigis_2', ['100%', '210%']],
    ['chess_zj_60_5_b', 'skchr_makoto_2', ['4', '220%', '35%', '1.5', '250%']],
  ];
  for (const [cid, sid, wants] of cases) {
    const r = chess[cid];
    const s = [r.skill, ...(r.skills || [])].find((x) => x && x.skillId === sid);
    const okAll = s && wants.every((w) => s.desc.includes(w));
    chk(`${cid} / ${sid} 的 desc 含 ${wants.join(' ')}`, !!okAll,
      okAll ? '' : `实际: ${(s?.desc || '').slice(0, 90)}`);
  }
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
