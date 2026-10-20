// server/http/files.js — one file on disk → an HTTP response (static.js and media.js decide which file):
//     MIME types incl. .mjs/.js text/javascript, .skel application/octet-stream, .atlas text/plain;
//     gzip for text-like types, .skel and uncompressed fonts when the client accepts it (small files are
//     compressed once and cached in memory); strong ETag + Last-Modified with 304s; Cache-Control
//     (html & code/data: no-cache + revalidate; public/assets|fonts|vendor: 1 day; any `?v=` URL: immutable);
//     single byte-range requests (206/416, used by <audio>).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';

/** Extension → Content-Type. */
export const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.atlas': 'text/plain; charset=utf-8',
  '.skel': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
});

/** Extensions worth gzipping (text-like, .skel, uncompressed fonts). */
export const COMPRESSIBLE = new Set([
  '.html', '.htm', '.js', '.mjs', '.css', '.json', '.map', '.webmanifest', '.txt', '.md', '.csv', '.xml',
  '.atlas', '.skel', '.bin', '.wasm', '.svg', '.ico', '.otf', '.ttf', '.wav',
]);

/** 值得 gzip 的最小字节数。导出给 static.js 的内存清单视图用（2026-10-16），好让两处口径一致。 */
export const GZIP_MIN_BYTES = 512;
const GZIP_CACHE_MAX_FILE = 8 << 20;      // larger files are gzip-streamed on the fly
const GZIP_CACHE_MAX_TOTAL = 96 << 20;
// Asset URLs carry no content hash yet, and tools/fetch-assets.mjs / tools/vendor.mjs can rewrite files in
// place (atlas + png + skel must stay consistent), so "long" is one day; revalidation after that is a cheap 304.
export const LONG_CACHE = 'public, max-age=86400';   // 1 day
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
/**
 * 60 秒的短缓存（用户 2026-10-13 审计）：一次开页要拉 ~190 个模块/样式/共享代码，全是 `no-cache` 时
 * **每次加载**都要重发一遍条件请求（实测 173 个模块的条件 GET 合计 36–41 ms 服务端 CPU + 同样次数的 RTT）。
 * index.html 仍是 no-cache（部署立刻生效），页面上的 buildGuard 也还在轮询 build 标签强制刷新陈旧页面。
 */
const MEDIUM_CACHE = 'public, max-age=60';

/**
 * ★ 开发开关（用户 2026-10-14）：`SP_DEV_NOCACHE=1` 时，js / css / 共享代码一律 `no-cache` ——
 *   浏览器每次都会拿 ETag 重新校验，**改完文件一刷新就是新的**，不必硬刷、也不必等那 60 秒。
 *
 * 为什么需要它：页面是 SPA，模块只在**整页加载**时拉一次；错误框上的「重新加载界面」只重建 React 树、
 * 不会重新下载 JS。60 秒强缓存期内，普通 F5 会继续用旧模块 —— 这造成过好几次「明明改了却还是老样子」
 * 的误判（用户 2026-10-14 的 `(entries || []).map is not a function` 就是这样）。
 *
 * 代价：一次开页多 ~40 个条件 GET（304）。**只在本地调试时开**，生产不设这个变量，行为与原来完全一致。
 */
const DEV_NO_CACHE = ['1', 'true', 'on', 'yes'].includes(String(process.env.SP_DEV_NOCACHE ?? '').trim().toLowerCase());
const LONG_CACHE_DIRS = ['assets', 'fonts', 'vendor']; // first path segment under public/
const MEDIUM_CACHE_DIRS = ['css', 'js'];             // 代码与样式：改部署后 60 s 内自动跟上
/**
 * `/data/*.json` 走 **1 天**缓存（用户 2026-10-17：「/data 缓存改 86400」）：开页要拉 10.2 MB / 126k 个对象的
 * 静态数据，60 s 的口径下每个新会话都要把 ~40 个 JSON 重新校验一遍（服务端 118 ms 的解析 + 40 次 RTT）。
 * 数据只在随包部署时变，而部署必然重启 ⇒ 进程 build 变化会让带 `?v=` 的清单 URL 失效；`index.html` 仍是
 * no-cache，所以换包后玩家刷新就能拿到新页面。代价是【不带 ?v= 的 /data 请求】在换包后最多 1 天陈旧 ——
 * 这正是 ASSETS.md 里 assets.js 给三个素材清单挂 `?v=<build>` 的原因。
 */
const DATA_MOUNT = 'data';

const gzipAsync = promisify(zlib.gzip);

// ---------------------------------------------------------------------------------------------------
// gzip cache (LRU by bytes)
// ---------------------------------------------------------------------------------------------------

export class GzipCache {
  constructor(maxTotal = GZIP_CACHE_MAX_TOTAL) {
    this.maxTotal = maxTotal;
    this.total = 0;
    /** @type {Map<string, Buffer>} */ this.map = new Map();
    /** @type {Map<string, Promise<Buffer>>} */ this.inflight = new Map();
  }

  /** @returns {Promise<Buffer>} gzip of the file identified by (path, size, mtime) */
  get(absPath, stat) {
    const key = `${absPath}\0${stat.size}\0${stat.mtimeMs}`;
    const hit = this.map.get(key);
    if (hit) { this.map.delete(key); this.map.set(key, hit); return Promise.resolve(hit); }
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = (async () => {
      const raw = await fsp.readFile(absPath);
      // 大文件降级压缩：同一份 3.2 MB JSON，level 6 ≈ 41.6 ms 阻塞事件循环，level 1 约 1/4 的 CPU
      // 只多 ~10% 字节（大 JSON 重复度高，level 1 已能压到 ~1/8）。小文件仍用 6，比值更划算。
      const level = raw.length > (512 << 10) ? 1 : 6;
      const gz = await gzipAsync(raw, { level });
      this.store(key, gz);
      return gz;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  store(key, buf) {
    if (buf.length > this.maxTotal) return;
    this.map.set(key, buf);
    this.total += buf.length;
    for (const [k, v] of this.map) {
      if (this.total <= this.maxTotal) break;
      this.map.delete(k);
      this.total -= v.length;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------------------------------

/** Does the Accept-Encoding header allow gzip (q > 0)? @param {string | undefined} header */
export function acceptsGzip(header) {
  if (!header || typeof header !== 'string') return false;
  let gzipQ = null;
  let starQ = null;
  for (const part of header.split(',')) {
    const [token, ...params] = part.trim().toLowerCase().split(';');
    let q = 1;
    for (const p of params) {
      const m = /^\s*q=([0-9.]+)\s*$/.exec(p);
      if (m) q = Number(m[1]);
    }
    if (!Number.isFinite(q)) q = 0;
    if (token === 'gzip' || token === 'x-gzip') gzipQ = q;
    else if (token === '*') starQ = q;
  }
  if (gzipQ != null) return gzipQ > 0;
  return starQ != null && starQ > 0;
}

/**
 * Parse a single `bytes=` range against a file size.
 * @returns {{ start: number, end: number } | 'unsatisfiable' | null} null = ignore header (serve 200)
 */
export function parseRange(header, size) {
  if (typeof header !== 'string') return null;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return null; // multi-range or malformed → ignore (RFC 9110 permits serving the full body)
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  if (a === '') {
    const suffix = Number(b);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(a);
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  if (b !== '' && Number(b) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end };
}

const stripWeak = (tag) => tag.trim().replace(/^W\//, '');

/** Conditional GET check (If-None-Match wins over If-Modified-Since). */
export function isNotModified(req, etag, mtime) {
  const inm = req.headers['if-none-match'];
  if (typeof inm === 'string') {
    if (inm.trim() === '*') return true;
    return inm.split(',').some((t) => stripWeak(t) === etag);
  }
  const ims = req.headers['if-modified-since'];
  if (typeof ims === 'string') {
    const t = Date.parse(ims);
    if (Number.isFinite(t)) return Math.floor(mtime.getTime() / 1000) * 1000 <= t;
  }
  return false;
}

/**
 * The strong validator of a file: `<size hex>-<mtime ms hex>`. `serveFile` quotes it into the ETag (and appends
 * `-gz` when the body is gzipped); `server/http/preload.js` puts the bare tag into /preload/manifest.json so the
 * browser-side pre-download can tell a cached copy from a stale one **without** a network round trip per file.
 * Both sides must use this function — a second copy of the format would drift apart silently, and a pre-download
 * comparing two different formats would re-download everything on every page load.
 * @param {import('node:fs').Stats} stat
 */
export function fileTag(stat) {
  return `${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}`;
}

/** If-Range: serve the range only when the validator still matches. */
function ifRangeMatches(req, etag, lastModified) {
  const v = req.headers['if-range'];
  if (typeof v !== 'string') return true;
  const s = v.trim();
  if (s.startsWith('"') || s.startsWith('W/')) return s === etag; // strong comparison
  return s === lastModified;
}

function cacheControlFor(ext, mountName, segments, query) {
  // ★ SP_DEV_NOCACHE=1：本地调试时让 js/css/共享代码每次都重新校验
  if (DEV_NO_CACHE) return 'no-cache';
  if (ext === '.html' || ext === '.htm') return 'no-cache';
  if (/(^|&)v=/.test(query)) return IMMUTABLE_CACHE;
  if (mountName === 'public' && segments.length > 1 && LONG_CACHE_DIRS.includes(segments[0])) return LONG_CACHE;
  if (mountName === 'public' && segments.length > 1 && MEDIUM_CACHE_DIRS.includes(segments[0])) return MEDIUM_CACHE;
  if (mountName === 'shared' || mountName === 'sim') return MEDIUM_CACHE;   // 共享模块 / 模拟代码，同样是每次开页必拉的
  // 2026-10-19（owner：改了 data 之后详情面板还显示旧的重复特质）：/data/*.json 从 1 天缓存改成
  //   no-cache（带 ETag 协商）：没改的文件仍只回 304、不重传；改过的下一次刷新立刻生效。
  if (mountName === DATA_MOUNT) return 'no-cache';                          // 静态数据（/data/*.json）
  return 'no-cache';
}

/**
 * 启动预热 gzip：把 `dataDir/*.json` 先压进缓存。不预热的话，第一个访客会撞上主线程压缩
 * （实测 3.2 MB 的 chess.json = 41.6 ms 阻塞事件循环），预热后只是一次缓存命中。best-effort，永不抛。
 */
export async function warmGzip(dir, gzipCache, log) {
  try {
    let n = 0;
    for (const name of await fsp.readdir(dir)) {
      if (!name.endsWith('.json')) continue;
      const abs = path.join(dir, name);
      try {
        const st = await fsp.stat(abs);
        if (st.isFile() && st.size >= GZIP_MIN_BYTES && st.size <= GZIP_CACHE_MAX_FILE) { await gzipCache.get(abs, st); n++; }
      } catch { /* 单个文件失败不影响其它 */ }
    }
    if (n && log && log.info) log.info(`[http] gzip 预热 ${n} 个 /data/*.json`);
  } catch { /* 目录不存在等：忽略 */ }
}

export async function serveFile(req, res, absPath, stat, mountName, segments, query, gzipCache, log, opts = {}) {
  const ext = path.extname(absPath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const compressible = COMPRESSIBLE.has(ext);
  const rangeHeader = req.headers.range;
  const useGzip = compressible && stat.size >= GZIP_MIN_BYTES && !rangeHeader && acceptsGzip(req.headers['accept-encoding']);
  // ★ 2026-10-14：内容哈希（0.2.6 assetIndex.js）—— 调用方给了就用它当 ETag，
  // 否则回落到 fork 原有的 size-mtime。opts.cacheControl 同理（URL 带 ~<hash> 时 immutable）。
  const baseTag = opts.contentHash || fileTag(stat);
  const etag = `"${baseTag}${useGzip ? '-gz' : ''}"`;
  const lastModified = stat.mtime.toUTCString();
  const isHead = req.method === 'HEAD';

  const headers = {
    'Content-Type': type,
    'Cache-Control': opts.cacheControl || cacheControlFor(ext, mountName, segments, query),
    ETag: etag,
    'Last-Modified': lastModified,
  };
  if (compressible) headers.Vary = 'Accept-Encoding';

  if (isNotModified(req, etag, stat.mtime)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  if (useGzip) {
    headers['Content-Encoding'] = 'gzip';
    if (stat.size <= GZIP_CACHE_MAX_FILE) {
      const gz = await gzipCache.get(absPath, stat);
      headers['Content-Length'] = gz.length;
      res.writeHead(200, headers);
      res.end(isHead ? undefined : gz);
      return;
    }
    res.writeHead(200, headers);
    if (isHead) { res.end(); return; }
    await streamTo(fs.createReadStream(absPath), res, log, zlib.createGzip());
    return;
  }

  headers['Accept-Ranges'] = 'bytes';
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  if (rangeHeader && ifRangeMatches(req, etag, lastModified)) {
    const r = parseRange(rangeHeader, stat.size);
    if (r === 'unsatisfiable') {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': 0 });
      res.end();
      return;
    }
    if (r) {
      ({ start, end } = r);
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
  }
  headers['Content-Length'] = stat.size === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);
  if (isHead || stat.size === 0) { res.end(); return; }
  await streamTo(fs.createReadStream(absPath, { start, end }), res, log);
}

async function streamTo(src, res, log, transform) {
  try {
    if (transform) await pipeline(src, transform, res);
    else await pipeline(src, res);
  } catch (e) {
    if (e && e.code !== 'ERR_STREAM_PREMATURE_CLOSE') log.debug?.('[http] stream aborted', e.code || e.message);
    res.destroy();
  }
}
