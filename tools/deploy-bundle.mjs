// tools/deploy-bundle.mjs — 生成「搬到另一台机器」用的精简部署包
//
// 为什么需要它：直接拷整个项目目录是 7.4 GB / 59k 文件，其中 public/assets 里有 5.4 GB 是
// `*.bak-before-*` 历史备份（三张素材清单一个都不引用）。这个脚本只带**跑起来真正要用的东西**：
//
//   · public/assets 只带三张清单（assets.json / local-assets.json / emotes.json）引用到的文件；
//     默认还会把「被引用文件所在目录」的**同目录兄弟文件一起带上** —— spine 的 .atlas 用相对路径找同目录
//     贴图，目录被拆开就会渲染失败（server/http/assetCdn.js 头注释里也记了这一条）。用 --exact 可关掉。
//   · 代码（server/shared/tools/scripts/docs/packs）、数据（data）、public 的其余部分、node_modules（服务端
//     只依赖 ws，带上就不用目标机器联网 npm ci）。
//   · 不带的：`*.bak-before-*`、`logs/`、`.cache/`、`_scratch/`、`_backup-*`、编辑器临时文件。
//
// 用法：
//   node tools/deploy-bundle.mjs <目标目录> [--exact] [--no-node-modules]
//   例：node tools/deploy-bundle.mjs "D:\Stronghold"
//
// 生成完在目标机器上：先 node tools/doctor.mjs 自检，再照 docs/DEPLOY.md §1.2/1.3/1.4 做防火墙/固定 IP/开机自启。
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const dest = argv.find((a) => !a.startsWith('--'));
const exact = argv.includes('--exact');
const withModules = !argv.includes('--no-node-modules');

if (!dest) {
  console.error('用法: node tools/deploy-bundle.mjs <目标目录> [--exact] [--no-node-modules]');
  process.exit(2);
}
const DEST = path.resolve(dest);
if (DEST.startsWith(ROOT + path.sep) || DEST === ROOT) {
  console.error('目标目录不能是项目目录自己（或它的子目录）');
  process.exit(2);
}

const SOURCES = ['assets.json', 'local-assets.json', 'emotes.json'];
const PREFIXES = ['/assets/', '/fonts/'];
const BACKUP = /(^|\/)\.?[^/]*\.bak-before-[^/]*(\/|$)/;
const SKIP_TOP = new Set(['.cache', 'logs', '_scratch', 'node_modules']);
const MB = (b) => (b / 1048576).toFixed(1);

/** 三张清单引用的素材路径（裸路径，无前导斜杠） */
function collect(node, out) {
  if (typeof node === 'string') { if (PREFIXES.some((p) => node.startsWith(p))) out.add(node.replace(/^\/+/, '')); return; }
  if (!node || typeof node !== 'object') return;
  for (const k of Object.keys(node)) collect(node[k], out);
}
const wanted = new Set();
for (const name of SOURCES) {
  try { collect(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name), 'utf8')), wanted); } catch { /* 可选文件 */ }
}

/** 目录 → 该目录下所有文件（用于「同目录兄弟一起带」） */
function dirIndex(dir, map = new Map()) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (BACKUP.test(rel)) continue;
    if (e.isDirectory()) dirIndex(abs, map);
    else if (e.isFile()) {
      const d = path.posix.dirname(rel);
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(rel);
    }
  }
  return map;
}

const jobs = [];        // [相对路径, 绝对源路径]
const skipped = [];
let assetCount = 0;
let assetBytes = 0;
let extraSiblings = 0;
let extraBytes = 0;

const assetsDir = path.join(ROOT, 'public', 'assets');
const byDir = dirIndex(assetsDir);
for (const rel of [...wanted].sort()) {
  const abs = path.join(ROOT, 'public', ...rel.split('/'));
  let st = null;
  try { st = fs.statSync(abs); } catch { /* 缺失 */ }
  if (!st || !st.isFile()) { skipped.push(rel); continue; }
  jobs.push(rel);
  assetCount++;
  assetBytes += st.size;
  if (!exact) {
    const d = path.posix.dirname(rel);
    for (const sib of byDir.get(d) || []) {
      if (sib === rel) continue;
      const sabs = path.join(ROOT, sib);
      jobs.push(sib);
      const ss = fs.statSync(sabs);
      extraSiblings++;
      extraBytes += ss.size;
    }
  }
}
// 去重（同一目录的兄弟可能被多次加入）
const assetSet = new Set();
const assetJobs = [];
for (const rel of jobs) {
  if (rel.startsWith('public/')) continue;         // 已带 public/ 前缀的（兄弟文件）统一在这里规范
  const full = `public/${rel}`;
  if (assetSet.has(full)) continue;
  assetSet.add(full);
  assetJobs.push(full);
}
for (const rel of jobs) if (rel.startsWith('public/') && !assetSet.has(rel)) { assetSet.add(rel); assetJobs.push(rel); }

/** 其余全部目录/文件（代码、数据、public 的非 assets 部分） */
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    const top = rel.split('/')[0];
    if (SKIP_TOP.has(top)) continue;
    if (BACKUP.test(rel)) continue;
    if (rel.startsWith('public/assets/')) continue;   // 素材单独处理
    if (/~$|\.swp$|\.tmp$/.test(e.name)) continue;
    if (e.isDirectory()) walk(abs, out);
    else if (e.isFile()) out.push(rel);
  }
  return out;
}
const codeJobs = walk(ROOT, []);
if (withModules) {
  // node_modules 单独遍历（walk 里被 SKIP_TOP 排除了）
  const nm = path.join(ROOT, 'node_modules');
  if (fs.existsSync(nm)) {
    const stack = [nm];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const abs = path.join(d, e.name);
        if (e.isDirectory()) stack.push(abs);
        else if (e.isFile()) codeJobs.push(path.relative(ROOT, abs).split(path.sep).join('/'));
      }
    }
  }
}

const all = [...codeJobs, ...assetJobs];
let totalBytes = 0;
for (const rel of all) { try { totalBytes += fs.statSync(path.join(ROOT, rel)).size; } catch { /* 忽略 */ } }

console.log(`目标目录: ${DEST}`);
console.log(`素材: 引用 ${wanted.size} 条 → 存在 ${assetCount} 个 / ${MB(assetBytes)} MiB`);
if (!exact) console.log(`      + 同目录兄弟 ${extraSiblings} 个 / ${MB(extraBytes)} MiB（.atlas 找贴图要用；--exact 可关）`);
if (skipped.length) console.log(`      清单引用但磁盘缺失 ${skipped.length} 条（不拷）`);
console.log(`其余文件: ${codeJobs.length} 个（含 node_modules: ${withModules}）`);
console.log(`合计: ${all.length} 个文件 / ${MB(totalBytes)} MiB   ← 对比整包 7.4 GB / 59k`);
const drive = path.parse(DEST).root;
try {
  const st = fs.statfsSync(drive);
  console.log(`目标盘可用: ${MB(st.bavail * st.bsize)} MiB`);
} catch { /* 忽略 */ }

// ------------------------------------------------------------------ 拷贝
let copied = 0;
let copiedBytes = 0;
let cursor = 0;
const t0 = Date.now();
const CONC = 16;
async function worker() {
  for (;;) {
    const i = cursor++;
    if (i >= all.length) return;
    const rel = all[i];
    const src = path.join(ROOT, ...rel.split('/'));
    const dst = path.join(DEST, ...rel.split('/'));
    try {
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      await fsp.copyFile(src, dst);
      copied++;
      copiedBytes += (await fsp.stat(dst)).size;
      if (copied % 2000 === 0) process.stdout.write(`\r  已拷 ${copied}/${all.length} …`);
    } catch (e) {
      console.error(`\n  拷贝失败 ${rel}: ${e.message}`);
    }
  }
}
await fsp.mkdir(DEST, { recursive: true });
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`\r  拷贝完成: ${copied} 个文件 / ${MB(copiedBytes)} MiB，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// ------------------------------------------------------------------ 随包说明
await fsp.writeFile(path.join(DEST, '迁移说明.txt'), `这是一份精简部署包（由 tools/deploy-bundle.mjs 生成）。

它包含运行所需的全部内容：代码、data/、node_modules（服务端只依赖 ws）、以及三张素材清单引用到的
public/assets 文件（带上了同目录兄弟文件，spine 的 .atlas 找贴图要用）。**不含** *.bak-before-* 历史备份、
logs/、.cache/、_scratch/。

在这台机器上按顺序做：

1) 自检（只读，不修改任何文件）
     node tools/doctor.mjs

2) 起一次前台实例，确认真能跑
     node server/index.js
   然后浏览器打开 http://127.0.0.1:3000 ，能进标题画面、能打一局就行。

3) 防火墙 + 固定局域网 IP + 开机自启（照着 docs/DEPLOY.md 的 §1.2 / §1.3 / §1.4）
     powershell -ExecutionPolicy Bypass -File scripts\\install-service-windows.ps1 -AllowPublicNetwork
   它会注册计划任务（开机即以 SYSTEM 身份跑，无需登录；进程退出 5 秒后自动重启；日志 logs\\server.log）
   并添加 TCP 3000 入站规则。查看状态：同一条命令加 -Status；更新后重启：-Restart。

4) 路由器：把外网端口 3000 的转发/DMZ 从旧机器改到**这台**机器的保留 IP。
   改完在旧机器上停掉服务，再在外部网络验证（或让朋友试）。

5) 回滚：把路由器转发指回旧机器、旧机器重新启动服务即可（旧机器的部署原封不动）。

注意：
  · Node 需要 22 或更高（node -v 确认）。
  · 尽量走有线网口；Wi-Fi 会引入抖动。
  · 这份包里的服务端素材仍由本机上行发出（没有 CDN）。同一条宽带下，换机器不改变带宽占用。
`);
console.log(`已写出 ${path.join(DEST, '迁移说明.txt')}`);
