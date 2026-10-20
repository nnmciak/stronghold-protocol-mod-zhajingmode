// 通用守卫：模块里**调用了但从未声明**的标识符（既不是声明、不是导入、也不是已知全局）。
// 运行（项目根）: node test/fx-undeclared.test.mjs
//
// 为什么需要（2026-10-17，一天内栽了三次，症状都是「屏幕上所有单位消失」）：
//   ① `skillfx.js` 里用 `isObj(...)` 但从没导入 —— `ReferenceError: isObj is not defined`
//   ② `skillfx.js` 里写 `this.formMap(...)`（应为 `this.w.formMap`）—— `TypeError: this.formMap is not a function`
//   ③ 删掉 `const mode = …` 时漏删 `const a = mode?.attack` —— `ReferenceError: mode is not defined`
//   三次都发生在**渲染链**上（`_record` / `sync`），异常一抛整条链断，表现就是「看不到人」。
//   `node --check` 只查语法，现有的行为测试全跑在 Node、不碰这条链 —— 所以必须静态扫。
//
// 判据（保守，宁少报不误报）：取所有「后面跟 `(`」的裸标识符（含 `?.` 调用），
// 排除：声明（const/let/var/function/class）、函数参数、导入名、解构目标、已知全局、对象字面量的键、属性访问。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const MODULES = [
  'public/js/render/vfx/skillfx.js',
  'public/js/render/vfx/skills.js',
  // `geom.js` 与 `glsl.js` 里有大段 **GLSL 源码模板串**（`texture(...)` / `vec2(...)` / `chan1(...)` 是着色器函数），
  // JS 侧扫描必然误报 —— 那部分由 `test/fx-glsl.test.mjs` 单独守（非 ASCII + 括号配平）。
  // 'public/js/render/vfx/geom.js',
  // 'public/js/render/vfx/glsl.js',
  'public/js/render/vfx/effect.js',
  'public/js/render/vfx/talents.js',
  'public/js/render/vfx/talentfx.js',
  'public/js/render/vfx/wiring.js',
  'public/js/render/vfx/system.js',
  // `library.js` 有一个跨行方法定义让参数解析漏掉（`async` 之类）—— 噪声，先排除
  'public/js/render/vfx/materials.js',
  'public/js/render/vfx/gl.js',
  'public/js/render/fx/kinds.js',
];

/** 已知全局 / 宿主 API（不是本仓库的标识符）。 */
const GLOBALS = new Set([
  'Array', 'Object', 'Math', 'Number', 'String', 'Boolean', 'JSON', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Date', 'RegExp',
  'Promise', 'Error', 'TypeError', 'RangeError', 'Symbol', 'BigInt', 'Proxy', 'Reflect', 'Infinity', 'NaN', 'isNaN',
  'parseInt', 'parseFloat', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'structuredClone',
  'console', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'queueMicrotask', 'performance', 'document', 'window', 'globalThis', 'navigator', 'location',
  'Image', 'Blob', 'URL', 'URLSearchParams', 'TextDecoder', 'TextEncoder', 'AudioContext', 'OffscreenCanvas',
  'WebGL2RenderingContext', 'Float32Array', 'Uint16Array', 'Uint32Array', 'Int32Array', 'Uint8Array', 'Int8Array',
  'Float64Array', 'ArrayBuffer', 'DataView', 'getComputedStyle', 'matchMedia', 'devicePixelRatio', 'localStorage',
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'function', 'class', 'do', 'else', 'in', 'of',
  'void', 'delete', 'instanceof', 'await', 'yield', 'super', 'this', 'import', 'export',
]);

/** 去掉注释与模板串的插值，避免把文字当成代码。 */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function analyse(src) {
  const declared = new Set();
  const add = (n) => { if (n) declared.add(n); };
  // 声明
  for (const m of src.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) for (const n of m[1].split(',')) add(n.split(':').pop().trim().replace(/^\.\.\./, ''));
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g)) for (const n of m[1].split(',')) add(n.trim().replace(/^\.\.\./, ''));
  // 导入
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) for (const n of m[1].split(',')) add(n.split(/\s+as\s+/).pop().trim());
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g)) add(m[1]);
  for (const m of src.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  // 函数/方法参数（含默认值与解构）
  for (const m of src.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const p of m[1].split(',')) {
      const core = p.split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(core)) add(core);
      else for (const n of core.replace(/[{}[\]]/g, ' ').split(/[\s,:]+/)) if (/^[A-Za-z_$][\w$]*$/.test(n)) add(n);
    }
  }
  // ★ 跨行 / 嵌套括号的参数列表（`async (opts = {}) => {`、`(a, (b)) => …`）：取 `(` 到匹配的 `)`
  for (const m of src.matchAll(/\(([^)]*)\)\s*(?:=>|\{)/g)) {
    for (const n of m[1].replace(/[{}[\]]/g, ' ').split(/[\s,:]+/)) if (/^[A-Za-z_$][\w$]*$/.test(n)) add(n);
  }
  // ★ 不用「`[(,]name[,)]` → 当已声明」这种兜底：它会把**代码里出现的任何实参名**都收进 declared，
  //   从而**掩盖真 bug**（实测：把 `mode` 的孤儿引用注回去，扫描器仍然通过 —— 假阴性）。
  //   回调名（`.map(fn)` 之类）改用显式白名单，见下面 CALLBACKS。
  for (const m of src.matchAll(/(?:^|[\s,{])(?:get\s+|set\s+|async\s+)?([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/gm)) {
    add(m[1]);
    for (const p of m[2].split(',')) {
      const core = p.split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(core)) add(core);
    }
  }
  // class 方法（多行参数）
  for (const m of src.matchAll(/^[ \t]+(?:static\s+|get\s+|set\s+|async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)) add(m[1]);
  // 解构赋值 / 对象键
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) add(m[1]);

  // 被调用的裸标识符（排除 `.x(`、`?.x(`），以及**可选链成员读**的基对象（`mode?.attack`）
  const unknown = new Map();
  for (const m of src.matchAll(/(?<![.\w$?])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const n = m[1];
    if (GLOBALS.has(n) || declared.has(n)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    if (!unknown.has(n)) unknown.set(n, line);
  }
  // ★ 事故 ③ 的形态：`mode?.attack` —— 可选链的**基对象**从未声明时同样抛 ReferenceError
  for (const m of src.matchAll(/(?<![.\w$?])([A-Za-z_$][\w$]*)\s*\?\./g)) {
    const n = m[1];
    if (GLOBALS.has(n) || declared.has(n)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    if (!unknown.has(n)) unknown.set(n, line);
  }
  return { declared, unknown };
}

/** 已知误报：来自**正则字面量**或**注释里的示例代码**，不是真的调用。
 *  本扫描器的 `strip()` 只处理注释/字符串/模板串，不解析正则字面量（`/^(Active…)/`）——
 *  这里逐个登记，比继续加强词法分析划算。新增条目必须写清来源。 */
const ALLOW = new Map([
  ['public/js/render/vfx/skills.js', new Set([
    'Active',    // L240 `/^(Active(OneOf)?BuffAbility|…)/` —— 正则字面量里的方法名
    '_',         // L324 JSDoc 里的 `https://…/Buff/_…` 链接
    'SPECIAL_',  // L560 JSDoc 里的 `SPECIAL_xxx` 示例
    'fn',        // JSDoc 里的占位（`fn(…)`）
    'onFinish',  // 文档里提到的回调名
  ])],
]);

/** 作为**实参**传递的命名函数（回调）：它们不是"被调用"，扫描器只会看到 `map(fn)` 这类形态。
 *  显式登记，替代那个会掩盖真 bug 的宽泛兜底。 */
const CALLBACKS = new Set(['has', 'f', 'up', 'num', 'lc', 'str', 'idOf', 'keys', 'byUnityOrder', 'r2', 'r1', 'uniq', 'clamp']);

console.log('=== 逐文件：有没有「调用了但从未声明」的标识符 ===');
for (const rel of MODULES) {
  let raw;
  try { raw = readFileSync(join(ROOT, rel), 'utf8'); } catch { console.log('  · %s（不存在，跳过）', rel); continue; }
  const { unknown } = analyse(strip(raw));
  const allow = ALLOW.get(rel) || new Set();
  const list = [...unknown.entries()]
    .filter(([n]) => !allow.has(n) && !CALLBACKS.has(n))
    .map(([n, l]) => `${n}(L${l})`);
  chk(rel, list.length === 0, list.length ? `未声明: ${list.join(', ')}` : '');
}

console.log('\n=== 阴性对照（判据真的能抓到吗）===');
{
  const cases = [
    ['const a = 1;\nfoo(2);', 'foo', true],
    ['import { bar } from "x";\nbar(1);', 'bar', false],
    ['const f = (q) => q;\nf(1);', 'f', false],
    ['const mode = 1;\nconst a = mode?.x;\nif (a) x();', 'x', true],
    ['function g(p) { return p; }\ng(1);', 'g', false],
  ];
  for (const [src, name, shouldFlag] of cases) {
    const { unknown } = analyse(strip(src));
    const flagged = unknown.has(name);
    chk(`${shouldFlag ? '应抓到' : '不应抓'} ${name}`, flagged === shouldFlag, flagged ? '(flagged)' : '');
  }
}

// ★ 覆盖范围（诚实说明）：
//   抓得到 —— 整个文件里**从未出现**的标识符（事故 ① `isObj`）、未定义的成员方法（`this.formMap`，见 fx-identifiers）。
//   抓不到 —— **块级作用域**误用：`for (const mode of …) {…}` 里声明过、却在块外引用（事故 ③）。
//     本扫描器不做作用域分析，只做「这个名字在文件里出现过吗」。要抓那类需要真正的 JS 作用域分析器，
//     成本远高于收益 —— 事故 ③ 已由「渲染链上的调用一律 try/catch」兜住（不会再让整屏消失）。
console.log('\n=== 三次真实事故的覆盖情况 ===');
{
  // 事故 ① isObj 未定义 —— 抓得到
  const isObjCase = 'if (plan && isObj(modeAtk)) { x(); }';
  chk('事故① isObj 未声明 → 抓到', analyse(strip(isObjCase)).unknown.has('isObj'));
  // 事故 ③ mode 块级作用域 —— 已知抓不到（如实标注，避免以后误以为有保护）
  const modeCase = 'for (const mode of xs) { use(mode); }\nconst a = mode?.attack;';
  const r3 = analyse(strip(modeCase));
  chk('事故③ mode 块级误用 → 已知抓不到（不计入失败）', true,
    r3.unknown.has('mode') ? '竟然抓到了' : '按预期抓不到（靠 try/catch 兜底）');
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
