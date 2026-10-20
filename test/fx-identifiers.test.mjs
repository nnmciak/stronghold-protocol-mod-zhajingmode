// 静态守卫：特效/渲染层的模块里，不许出现「未定义也未导入」的小工具名。
// 运行（项目根）: node test/fx-identifiers.test.mjs
//
// 为什么需要：2026-10-17 我在 `skillfx._record` 里写了 `isObj(modeAtk)`，但 `skillfx.js` **从来没有** `isObj`
// （它是 `skills.js` 的私有工具，未导出）。于是每帧、每个单位都抛
//   ReferenceError: isObj is not defined   at SkillFx._record (skillfx.js)
// 把整条特效链连同渲染帧一起打断 —— 表现是「所有特效都没了、单位也画不出来」，
// 而 `node --check`（语法检查）与现有的行为测试都发现不了（它只在浏览器跑到那一行才炸）。
//
// 判据：在这些模块里，若某个短工具名被**调用**，就必须在同一文件里被定义或从别处导入。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

/** 这些短名在本仓库多处各自定义 —— 跨文件借用而不导入是最容易犯的错。 */
const TOOLS = ['isObj', 'isPlain', 'numOr', 'lc', 'posIntOr', 'uniq', 'clamp', 'toNum', 'isStr', 'isNum'];

const MODULES = [
  'public/js/render/vfx/skillfx.js',
  'public/js/render/vfx/skills.js',
  'public/js/render/vfx/geom.js',
  'public/js/render/vfx/effect.js',
  'public/js/render/vfx/talents.js',
  'public/js/render/vfx/talentfx.js',
  'public/js/render/vfx/wiring.js',
  'public/js/render/vfx/system.js',
  'public/js/render/vfx/funnels.js',
  'public/js/render/vfx/funnelfx.js',
  'public/js/render/vfx/library.js',
  'public/js/render/vfx/materials.js',
  'public/js/render/vfx/mounts.js',
  'public/js/render/vfx/flight.js',
  'public/js/render/vfx/curves.js',
  'public/js/render/vfx/shapes.js',
  'public/js/render/vfx/psys.js',
  'public/js/render/vfx/gl.js',
  'public/js/render/vfx/glsl.js',
  'public/js/render/vfx/clips.js',
  'public/js/render/vfx/math.js',
  'public/js/render/vfx/rng.js',
];

/** 去掉注释与字符串字面量，避免把注释里提到的名字当成调用（踩过：注释里的 "size clamp"）。 */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

console.log('=== 逐文件：短工具名必须已定义 / 已导入（只扫代码，不含注释与字符串）===');
for (const rel of MODULES) {
  let raw;
  try { raw = readFileSync(join(ROOT, rel), 'utf8'); } catch { console.log('  · %s（不存在，跳过）', rel); continue; }
  const src = code(raw);
  const missing = [];
  for (const n of TOOLS) {
    const used = new RegExp(`(?<![\\w$.])${n}\\s*\\(`).test(src);
    if (!used) continue;
    const defined = new RegExp(`(?:const|let|var|function)\\s+${n}\\b`).test(src);
    // 导入：import { a, n } from '…'  /  import n from '…'  /  import * as …（不覆盖）
    const imported = new RegExp(`import\\s*(?:\\{[^}]*\\b${n}\\b[^}]*\\}|${n})\\s*from`).test(src);
    if (!defined && !imported) missing.push(n);
  }
  chk(rel, missing.length === 0, missing.length ? `未定义/未导入: ${missing.join(', ')}` : '');
}

console.log('\n=== ② 成员调用 `this.X(...)` 必须在本文件里定义过（新）===');
// 为什么加这条：2026-10-17 我在 `SkillFx._foldAllForms` 里写了 `this.formMap(unitKey)`，
// 而 `formMap` 是 **wiring** 的方法（应为 `this.w.formMap`）—— 建记录时抛
// `TypeError: this.formMap is not a function`，而 `_record` 跑在每帧的渲染链上
// ⇒ **整屏单位消失**（用户：「又变成看不到人了」）。这类错误 `node --check` 抓不到。
for (const rel of MODULES) {
  let raw;
  try { raw = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
  const src = code(raw);
  // 「本文件定义过的东西」用**行级**收集（简单可靠）：类方法 / 对象方法 / 属性赋值 / 委托回调。
  // 为什么不用括号配对的正则：参数里可能有箭头函数（`_instCast(U, v, win = xs.find((w) => …)) {`），
  // 朴素的 `\([^)]*\)\s*\{` 会在内层 `)` 就截断，把真方法误判为「未定义」。
  const definedNames = new Set();
  for (const line of src.split('\n')) {
    // 行首形态：`name(` / `name =` / `name:` / `name;`（类方法、属性赋值）
    const m = /^\s*(?:static\s+|get\s+|set\s+|async\s+)?#?([A-Za-z_$][\w$]*)\s*[(:;=]/.exec(line);
    if (m) definedNames.add(m[1]);
    // 行内**带点**赋值才收：`this.track = null` / `opts.fetch = …`（委托回调属性，之后调用合法）。
    // ★ 不能收 `const formMap = …` 这种局部变量 —— 那会把 `this.formMap` 这个真 bug 当成"已定义"而放过
    //   （阴性对照实测过：放宽后假阴性了）。
    for (const a of line.matchAll(/[.\]]\s*([A-Za-z_$][\w$]*)\s*=[^=]/g)) definedNames.add(a[1]);
    for (const a of line.matchAll(/[.\]]\s*([A-Za-z_$][\w$]*)\s*:\s*(?![:=])/g)) definedNames.add(a[1]);
  }
  const bad = [];
  for (const m of src.matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*\(/g)) {
    const n = m[1];
    if (n === 'w' || n === 'opts' || n === 'ctx' || n === 'P') continue;   // 委托对象
    if (!definedNames.has(n)) bad.push(n);
  }
  const uniq = [...new Set(bad)];
  chk(`${rel} 的 this.X() 调用`, uniq.length === 0, uniq.length ? `未在本文件定义: ${uniq.join(', ')}` : '');
}

console.log('\n=== 已知的跨模块借用（应当都被显式导入）===');
{
  const src = code(readFileSync(join(ROOT, 'public/js/render/vfx/skillfx.js'), 'utf8'));
  chk('skillfx.js 不再裸用 isObj', !/(?<![\w$.])isObj\s*\(/.test(src));
  for (const n of ['foldModeAttack', 'attachUses', 'planUses', 'skillPlan']) {
    chk(`skillfx.js 导入了 ${n}`, new RegExp(`import\\s*\\{[^}]*\\b${n}\\b[^}]*\\}`).test(src));
  }
  chk('skills.js 导出了 foldModeAttack', /export function foldModeAttack/.test(readFileSync(join(ROOT, 'public/js/render/vfx/skills.js'), 'utf8')));
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
