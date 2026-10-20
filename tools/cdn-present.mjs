// tools/cdn-present.mjs — 自建素材 CDN 的「我传了什么」清单生成器 + 上传清单 + 校验
//
// 用途（配合 server/http/assetCdn.js 的本地清单路径）：
//   1. 从三张素材清单（data/assets.json / local-assets.json / emotes.json）里收集服务端会改写的所有 /assets/、
//      /fonts/ 路径，逐个 stat 磁盘 → 得到**必须上传的文件集**（缺的记下来，不猜）。
//   2. 写出两份东西：
//        data/cdn-present.json  —— 运行时用的存在性清单（base + token + paths），启动即就绪，不拉索引、不 HEAD 探测
//        <out>.files.txt        —— 纯路径列表（bucket key），给 rclone --files-from / ossutil / coscli 用
//   3. --verify：上传完之后抽查（默认 8 个，可按大小分层），核对状态码与字节数，并实测吞吐。
//
// 用法：
//   node tools/cdn-present.mjs --base https://<bucket-endpoint> --dry-run
//   node tools/cdn-present.mjs --base https://<bucket-endpoint>
//   node tools/cdn-present.mjs --base https://<bucket-endpoint> --verify 12
//
// 说明：`*.bak-before-*` 备份目录永远不进清单（它们不在三张清单里，这里是二次防御）。
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 参数解析：--k v / --flag */
function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

const A = args(process.argv.slice(2));
const dataDir = path.resolve(A['data-dir'] || path.join(ROOT, 'data'));
const publicDir = path.resolve(A['public-dir'] || path.join(ROOT, 'public'));
const outFile = path.resolve(A.out || path.join(dataDir, 'cdn-present.json'));
const listFile = path.resolve(A.list || `${outFile}.files.txt`);
const base = String(A.base || process.env.SP_ASSET_CDN || '').trim().replace(/\/+$/, '');
const dryRun = !!A['dry-run'];
const verifyN = A.verify ? Number(A.verify) || 8 : 0;

if (!base && !A['verify-only']) {
  console.error('缺少 --base（或环境变量 SP_ASSET_CDN）：例如 --base https://sp-assets.oss-cn-shenzhen.aliyuncs.com');
  process.exit(2);
}

/** server/http/assetCdn.js 只改写这两个前缀；其它路径改了也没人会去取。 */
const PREFIXES = ['/assets/', '/fonts/'];
const SOURCES = ['assets.json', 'local-assets.json', 'emotes.json'];
const BACKUP_SEG = /(^|\/)\.?[^/]*\.bak-before-[^/]*(\/|$)/;

/** 递归收集所有看起来像素材路径的字符串（与 server/http/preload.js 同一套规则）。 */
function collect(node, out) {
  if (typeof node === 'string') {
    if (PREFIXES.some((p) => node.startsWith(p))) out.add(node);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const k of Object.keys(node)) collect(node[k], out);
}

const MB = (b) => (b / 1048576).toFixed(1);

async function build() {
  const urls = new Set();
  let hash = '';
  for (const name of SOURCES) {
    const abs = path.join(dataDir, name);
    let json;
    try { json = JSON.parse(await fsp.readFile(abs, 'utf8')); } catch { continue; }
    if (!hash && typeof json?.hash === 'string') hash = json.hash;
    collect(json, urls);
  }
  const all = [...urls].sort();
  const paths = [];
  const missing = [];
  const backups = [];
  let bytes = 0;
  for (const u of all) {
    const bare = u.split('?')[0].split('#')[0].replace(/^\/+/, '');
    if (BACKUP_SEG.test(bare)) { backups.push(bare); continue; }
    const st = await fsp.stat(path.join(publicDir, ...bare.split('/'))).catch(() => null);
    if (!st || !st.isFile()) { missing.push(bare); continue; }
    paths.push([bare, st.size]);
    bytes += st.size;
  }
  const shape = createHash('sha1').update(paths.map(([p, s]) => `${p}\0${s}`).join('\n')).digest('hex').slice(0, 8);
  const token = `${hash || 'nohash'}-${paths.length}-${shape}`;
  return { all: all.length, paths, missing, backups, bytes, token, hash };
}

const r = await build();
console.log(`素材路径（三张清单引用）: ${r.all} 条`);
console.log(`需要上传: ${r.paths.length} 个文件 / ${MB(r.bytes)} MiB`);
if (r.backups.length) console.log(`跳过备份目录: ${r.backups.length} 条（${r.backups.slice(0, 2).join(', ')} …）`);
if (r.missing.length) console.log(`磁盘缺失（不上传，客户端会拿到 404 之外的原始路径）: ${r.missing.length} 条`);
console.log(`token: ${r.token}`);

if (!dryRun) {
  const payload = {
    schema: 1,
    base,
    token: r.token,
    generated: new Date().toISOString(),
    files: r.paths.length,
    bytes: r.bytes,
    paths: r.paths.map(([p]) => p),
  };
  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await fsp.writeFile(outFile, JSON.stringify(payload));
  await fsp.writeFile(listFile, r.paths.map(([p]) => p).join('\n') + '\n');
  console.log(`\n写出 ${outFile}`);
  console.log(`写出 ${listFile}  （rclone --files-from 用）`);
  console.log('\n上传示例：');
  console.log(`  rclone copy "${publicDir}" <remote>:<bucket> --files-from "${listFile}" --header-upload "Cache-Control: public, max-age=31536000, immutable" --transfers 16`);
  console.log(`  # 阿里云：ossutil cp -r --include-from-file ... / 腾讯云：coscli cp ... / 或直接上传 public/assets 与 public/fonts`);
  console.log(`\n上传完后校验：node tools/cdn-present.mjs --base ${base} --verify 12`);
  console.log(`然后在启动服务器时设 SP_ASSET_CDN=${base}`);
}

// ---------------------------------------------------------------- 校验
if (verifyN > 0) {
  const list = r.paths.length ? r.paths.map(([p, s]) => ({ p, s })) : [];
  if (!list.length) { console.log('（没有可校验的路径）'); process.exit(0); }
  // 按大小分层抽样：小图要 TTFB，大图要吞吐
  const bySize = [...list].sort((a, b) => a.s - b.s);
  const picks = [];
  const bucketsLo = [0, 60e3, 300e3, 1e6];
  for (const lo of bucketsLo) {
    const cand = bySize.filter((x) => x.s >= lo && x.s < (lo === 1e6 ? Infinity : lo * 5));
    if (cand.length) picks.push(cand[Math.floor(cand.length / 2)]);
  }
  while (picks.length < verifyN) picks.push(bySize[Math.floor(Math.random() * bySize.length)]);
  console.log(`\n校验 ${new Set(picks.map((x) => x.p)).size} 个路径 @ ${base}`);
  let bad = 0;
  for (const { p, s } of picks.slice(0, verifyN)) {
    const url = `${base}/${p}?v=${r.token}`;
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
      const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
      const secs = (Date.now() - t0) / 1000;
      if (!res.ok) { bad++; console.log(`  FAIL  HTTP ${res.status}  ${p}`); continue; }
      const ok = buf.length === s;
      if (!ok) bad++;
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${(s / 1024).toFixed(0).padStart(6)} KB  ${(buf.length / 1024 / secs).toFixed(0).padStart(7)} KB/s  ${p}${ok ? '' : `  ← 字节数不符: ${buf.length} vs ${s}`}`);
    } catch (e) { bad++; console.log(`  FAIL  ${e.name === 'TimeoutError' ? '超时' : e.message}  ${p}`); }
  }
  console.log(bad === 0 ? '\n校验通过 ✅' : `\n${bad} 项失败 ❌`);
  if (bad) process.exit(1);
}
