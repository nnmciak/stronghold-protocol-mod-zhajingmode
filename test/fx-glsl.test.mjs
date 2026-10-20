// GLSL 守卫：`render/vfx/glsl.js` 里的着色器源码只许是 ASCII，且大括号/圆括号配平。
// 运行（项目根）: node test/fx-glsl.test.mjs
//
// 为什么需要：2026-10-17 我往 `ramDisturbCd` 的模板字符串里写了一行带 `★` 和中文的 **JS 风格**注释，
// 而那段字符串是直接交给 GPU 编译的着色器源码。`node --check` 抓不到（模板串对它只是字符串），
// 后果是**着色器编译失败**：官方特效整片消失或画错，控制台只在 `[fx] program failed` 里提一句。
//
// 判据（保守，宁少报不误报）：
//   · 落在着色器语句里的行（GLSL 味开头 / 以分号结尾）不得含非 ASCII 或中文标点；
//   · 每个着色器模板串的大括号、圆括号配平 —— **必须用能处理嵌套模板串的解析器**
//     （本项目有 `${a ? '' : \`…${b ? '…' : ''}\`}` 这种三层结构，朴素正则会把它们算错）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const rel = 'public/js/render/vfx/glsl.js';
const src = readFileSync(join(ROOT, rel), 'utf8');
const lines = src.split('\n');
const lineOf = (idx) => src.slice(0, idx).split('\n').length;

// ─────────────────────────────────────── 模板串解析（支持嵌套 + 插值里的字符串）
/**
 * 从 `start`（一个反引号的下标）读出一个完整模板串。
 * @returns {{ end: number, parts: Array<{kind:'text'|'expr', body:string, at:number}> }}
 */
function readTemplate(text, start) {
  const parts = [];
  let i = start + 1, buf = '', textAt = start + 1;
  const flush = () => { if (buf) { parts.push({ kind: 'text', body: buf, at: textAt }); buf = ''; } };
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { buf += text.slice(i, i + 2); i += 2; continue; }
    if (c === '`') { flush(); return { end: i, parts }; }
    if (c === '$' && text[i + 1] === '{') {
      flush();
      const exprAt = i + 2;
      let j = exprAt, depth = 0;
      while (j < text.length) {
        const e = text[j];
        if (e === '\\') { j += 2; continue; }
        if (e === "'" || e === '"') { const q = e; j++; while (j < text.length && text[j] !== q) { if (text[j] === '\\') j++; j++; } j++; continue; }
        if (e === '`') { j = readTemplate(text, j).end + 1; continue; }
        if (e === '{') { depth++; j++; continue; }
        if (e === '}') { if (depth === 0) break; depth--; j++; continue; }
        j++;
      }
      parts.push({ kind: 'expr', body: text.slice(exprAt, j), at: exprAt });
      i = j + 1;
      textAt = i;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return { end: i, parts };
}

/** 抽出所有顶层模板串（跳过落在别的模板串插值里的那些）。 */
function topTemplates(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i); if (i < 0) break; i += 2; continue; }
    if (c === "'" || c === '"') { const q = c; i++; while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; } i++; continue; }
    if (c === '`') { const t = readTemplate(text, i); out.push({ start: i, ...t }); i = t.end + 1; continue; }
    i++;
  }
  return out;
}

/** 一个模板串的 GLSL 文本：递归展开插值（分支两支都收，宁可多扫不可漏扫）。 */
function glslText(parts) {
  let s = '';
  for (const p of parts) {
    if (p.kind === 'text') { s += p.body; continue; }
    // 插值里若含模板串，把它也展开
    let inner = p.body;
    let k = 0;
    while (k < inner.length) {
      if (inner[k] === '`') {
        const t = readTemplate(inner, k);
        s += glslText(t.parts);
        k = t.end + 1;
        continue;
      }
      // 内层字符串字面量（'...' / "..."）原样保留但不参与括号统计以外的东西
      if (inner[k] === "'" || inner[k] === '"') { const q = inner[k]; k++; while (k < inner.length && inner[k] !== q) { if (inner[k] === '\\') k++; k++; } k++; continue; }
      k++;
    }
  }
  return s;
}

// ─────────────────────────────────────── ① 非法字符
console.log('=== ① 着色器语句行里的非法字符 ===');
const FORBIDDEN = ['★', '：', '（', '）', '，', '。', '「', '」', '—', '≤', '≥', '×', '★'];
const GLSL_STMT = /^\s*(vec[234]|float|int|bool|mat[234]|if|else|for|while|return|discard|o_col|uniform|const|in |out )\b|;\s*$/;
const bads = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (!GLSL_STMT.test(l)) continue;
  const bad = FORBIDDEN.some((c) => l.includes(c)) || [...l].some((c) => c.charCodeAt(0) > 127);
  if (bad) bads.push(`${i + 1}| ${l.trim().slice(0, 80)}`);
}
chk('GLSL 语句行无非 ASCII / 中文标点', bads.length === 0, bads.join('  '));

// ─────────────────────────────────────── ② 括号配平
console.log('\n=== ② 每个着色器模板串的括号配平（递归展开插值）===');
const tmpls = topTemplates(src);
let unbalanced = 0;
for (const t of tmpls) {
  const glsl = glslText(t.parts);
  for (const [o, c] of [['{', '}'], ['(', ')']]) {
    const no = (glsl.match(new RegExp('\\' + o, 'g')) || []).length;
    const nc = (glsl.match(new RegExp('\\' + c, 'g')) || []).length;
    if (no !== nc) { unbalanced++; console.log('     glsl.js:%d  %s=%d %s=%d', lineOf(t.start), o, no, c, nc); }
  }
}
chk(`扫了 ${tmpls.length} 个模板串，括号都配平`, unbalanced === 0, unbalanced ? `${unbalanced} 处` : '');

// ─────────────────────────────────────── ③ 阴性对照
console.log('\n=== ③ 阴性对照（判据真能抓到吗）===');
{
  const badLine = '  float x = 1.0; // ★ 中文注释';
  chk('带 ★ 的语句行被判非法', FORBIDDEN.some((c) => badLine.includes(c)) && GLSL_STMT.test(badLine));
  chk('干净的语句行通过', !FORBIDDEN.some((c) => badLine.replace(/\/\/.*/, '').includes(c)) && GLSL_STMT.test('  float x = 1.0;'));
  // 嵌套模板串的配平
  const nested = 'const a = `void main() { ${d.lite ? `` : `{ }`} }`;';
  const tt = topTemplates(nested)[0];
  const g = glslText(tt.parts);
  chk('嵌套模板串被正确展开（括号配平）',
    (g.match(/\{/g) || []).length === (g.match(/\}/g) || []).length,
    `{=${(g.match(/\{/g) || []).length} }=${(g.match(/\}/g) || []).length}`);
  // 真的缺一个 } 必须抓到
  const broken = 'const a = `void main() { if (x) { } `;';
  const bt = topTemplates(broken)[0];
  const bg = glslText(bt.parts);
  chk('缺一个 } 被抓到', (bg.match(/\{/g) || []).length !== (bg.match(/\}/g) || []).length);
}

// ─────────────────────────────────────── ④ 关键着色器族仍在
console.log('\n=== ④ 关键着色器族仍在文件里 ===');
for (const fam of ['ramDisturbCd', 'disturbCd', 'disturbAnchor', 'ram:', 'basic', 'dissolveMask']) {
  chk(`glsl.js 含 ${fam}`, src.includes(fam));
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
