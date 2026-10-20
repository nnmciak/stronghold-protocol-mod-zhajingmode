// server/http/assetCdn.js — response-layer asset CDN rewriting.
//
// **STATUS: OFF (rolled back 2026-10-10).** The CDN measured 43–115 KB/s for small art and 132–510 KB/s
// for audio from this machine (TTFB 0.5–1s; a 2.7 MB BGM took 7–20 s) on both weishucdn and weishucdn2 —
// slower than this server's own uplink, so every asset is served from here again. Re-measured 2026-10-10
// 23:5x: 19–43 KB/s for 68–117 KB art, 159–228 KB/s for 2.1 MB, and those hosts are Cloudflare
// (2606:4700::) in front of a GitHub repo — they are not a China CDN at all. The module is inert by
// default; set `SP_ASSET_CDN=https://weishucdn.jiangjiangze.icu` to re-enable the public mirror, or to a
// **self-hosted bucket** (阿里云 OSS / 腾讯云 COS / R2 / MinIO) together with its presence manifest
// (`tools/cdn-present.mjs` → `data/cdn-present.json`), which skips the index and the probe sweep entirely.
// `off` disables. Everything below is unchanged and verified — see CDN-素材分发.md.
//
// The client's ONLY source of art URLs is three manifests served from /data/:
//     assets.json · local-assets.json · emotes.json
// (contract: the 素材 CDN docs at https://downcdn.jiangjiangze.icu/). Rewriting those responses is
// therefore enough to move art off this machine's uplink — no client change, no change anywhere else.
//
// Two rules from that contract are load-bearing:
//   1. **Rewrite only in the response.** server/index.js and the pack registry read these same files
//      from disk, and tools/fetch-assets.mjs rewrites them in place; editing the files would corrupt
//      both. This module never writes to them.
//   2. **Never invent a URL.** A path is rewritten only when the CDN is known to carry it. Everything
//      else — this fork's own skins, local-client art, anything not mirrored — keeps pointing at this
//      server, i.e. it keeps using the uplink. A blanket rewrite would turn a missing file into a 404
//      on a host we do not control.
//
// Knowing what the CDN carries takes two sources, because the published index lags the bucket:
//   · `/cdn/v1/tree.json` — the index; covers the great majority and costs one request.
//   · a HEAD probe of the rest — the bucket demonstrably serves files the index has not registered
//     yet (measured: 1294 of 1872 unindexed paths were live, ~178 MiB that would otherwise have
//     stayed on the uplink). Probes run in the background after startup, never block a request, and
//     their results are cached in `.cache/cdn-verified.json` so a restart does not re-probe.
//
// Spine atlases resolve their texture by a path relative to the .atlas, so a directory split between
// the CDN and this server would render broken. Presence was measured to be uniform per directory
// (1159 spine directories, 0 mixed), and the per-file rule below preserves that: files are only moved
// when the CDN has that exact file, and a partially mirrored skin keeps whichever half it lacks local.
//
// URL shape is the contract's: `<root><path>?v=<token>`, the token being the CDN's content token
// (v<upstream tag>-<index sha8>) so a re-mirror at the edge cannot serve stale bytes under a URL the
// browser has already cached as immutable.
//
// Failure behaviour: if the CDN cannot be reached (offline machine, CDN down, DNS broken) the module
// stays inert and every manifest is served straight from disk — a LAN game must not depend on the
// internet being up. `SP_ASSET_CDN=off` disables it explicitly.
//
// (i18n-ignore-file: the log lines are operator-facing diagnostics, 中文 · English — docs/I18N.md)

import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { MIME, isNotModified } from './files.js';

const gzipAsync = promisify(zlib.gzip);

/** The manifests whose responses are rewritten (the CDN contract names three; we add our own local-fx / avatars). */
export const CDN_MANIFESTS = Object.freeze([
  'assets.json', 'local-assets.json', 'emotes.json',
  // ★ 2026-10-18：`local-fx.json`（1.28 MB 的本地特效贴图表，引用 /assets/local/fx/tex/*.webp）原先不在清单里，
  //   于是对局开场那几十张特效贴图仍然回主服取 —— 正是「一堆小文件」里最该搬走的一块。
  'local-fx.json',
  // ★ 2026-10-18：`avatars.json`（176 KB，934 条头像/头像框路径，含干员头像与玩家头像）同样漏了，
  //   表现为「没带 ?v= 的 /assets/char/avatar/*.png 还在打主服」。
  'avatars.json',
]);

/**
 * Documented public base of the asset CDN.
 *
 * **Rolled back to `off` on 2026-10-10**: measured from this machine the CDN delivered 43–115 KB/s for
 * small art and 132–510 KB/s for audio (TTFB 0.5–1s) — a 2.7 MB BGM took 7–20 s — on both
 * weishucdn and weishucdn2. That is slower than serving from here, so every asset goes back over this
 * server's own uplink. The rewriting code below is kept intact: set `SP_ASSET_CDN` to a base URL to
 * turn it back on once the CDN's path from this network is fixed.
 */
const DEFAULT_BASE = 'off';

/** Values that mean "do not rewrite" (operators write all of these). */
const OFF = new Set(['', 'off', 'none', 'no', 'false', '0', 'disable', 'disabled']);

const INDEX_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 15_000;
const RETRY_MS = [5_000, 15_000, 60_000, 300_000]; // index fetch: then every 5 min
const PROBE_CONCURRENCY = 16;

/**
 * Local presence manifest — the **self-hosted bucket** path (国内 OSS / COS / R2 / MinIO).
 *
 * The index + HEAD-probe machinery below exists because the public mirror's published index lags its bucket
 * (measured: 1294 of 1872 unindexed paths were live). A bucket WE fill has no such problem: the uploader knows
 * exactly which paths it wrote, so it writes them into `data/cdn-present.json` and this server then needs no
 * network call, no token fetch and no sweep. Shape:
 *
 *   { "schema": 1, "base": "https://<bucket-endpoint>", "token": "<cache-busting token>", "paths": ["assets/…"] }
 *
 * Generated by `tools/cdn-present.mjs`. `base` is compared with the configured root, so a file generated for
 * another bucket is ignored — switching `SP_ASSET_CDN` can never silently rewrite URLs at a host that does not
 * carry them. When the file applies, the index + probe path is skipped entirely (that is the point: a plain
 * bucket serves no `/cdn/v1/tree.json`).
 */
const PRESENT_FILE = 'cdn-present.json';

/** Art path prefixes the contract covers. */
const PREFIXES = ['/assets/', '/fonts/'];
/** Matches a JSON string holding a root-relative art path. */
const ART_IN_JSON = /"(\/(?:assets|fonts)\/[^"\\]*)"/g;

/**
 * Create the manifest rewriter.
 * @param {{ base?: string, dataDir?: string, cacheFile?: string, presentFile?: string,
 *   log?: { info?: Function, warn?: Function, error?: Function, debug?: Function } }} [opts]
 *   base: CDN root (default `SP_ASSET_CDN` env, else the documented public base)
 *   dataDir/cacheFile: where the manifests live and where probe results are cached
 *   presentFile: the self-hosted-bucket presence manifest (default `<dataDir>/cdn-present.json`)
 * @returns {{ handles: Function, serve: Function, ready: Function, stats: Function, load: Function }}
 */
export function createAssetCdn({ base, dataDir, cacheFile, presentFile, log = {} } = {}) {
  const raw = base !== undefined ? base : (process.env.SP_ASSET_CDN ?? DEFAULT_BASE);
  const root = String(raw || '').trim().replace(/\/+$/, '');
  const enabled = !OFF.has(root.toLowerCase()) && /^https?:\/\//i.test(root);

  /** @type {Set<string>} CDN-relative paths known to exist (index ∪ probes) */
  const have = new Set();
  /** @type {Set<string>} paths that came from the index (already accounted for) */
  const indexed = new Set();
  let token = '';
  /** @type {Map<string, {buf: Buffer, gz: Buffer|null, etag: string, rewritten: number, local: number}>} */
  const cache = new Map();
  let loadPromise = null;
  let sweepPromise = null;
  let attempts = 0;
  let lastError = null;
  let probes = { done: 0, present: 0, absent: 0, running: false };

  async function fetchJson(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), INDEX_TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  // ---------------------------------------------------------------------------------------------
  // probe cache — so a restart does not re-HEAD several hundred paths
  // ---------------------------------------------------------------------------------------------

  async function readCache() {
    if (!cacheFile) return;
    try {
      const raw = JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
      if (raw && raw.base === root && Array.isArray(raw.present)) {
        for (const p of raw.present) have.add(p);
        log.debug?.(`[cdn] 探测缓存命中 · probe cache: ${raw.present.length} 条`);
      }
    } catch { /* no cache yet — the sweep will build one */ }
  }

  async function writeCache() {
    if (!cacheFile) return;
    const present = [...have].filter((p) => !indexed.has(p));
    try {
      await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
      await fsp.writeFile(cacheFile, JSON.stringify({ schema: 1, base: root, at: new Date().toISOString(), present }));
    } catch (e) {
      log.warn?.(`[cdn] 探测缓存写入失败 · could not write probe cache: ${e.message}`);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // local presence manifest (self-hosted bucket) then index + background probes
  // ---------------------------------------------------------------------------------------------

  /**
   * Seed `have` / `indexed` / `token` from the local presence manifest written by `tools/cdn-present.mjs`.
   * Never throws. When it applies, the caller must NOT run `load()`/`sweep()`: the manifest already states
   * exactly what the bucket carries, and a plain bucket serves no index to consult.
   * @returns {Promise<boolean>} true when the manifest applied to this `root`
   */
  async function readPresent() {
    if (!enabled) return false;
    const file = presentFile || (dataDir ? path.join(dataDir, PRESENT_FILE) : null);
    if (!file) return false;
    let raw;
    try { raw = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return false; }
    if (!raw || raw.schema !== 1 || !Array.isArray(raw.paths)) return false;
    const fileBase = String(raw.base || '').trim().replace(/\/+$/, '');
    if (fileBase !== root) {
      log.warn?.(`[cdn] 本地清单的 base 与 SP_ASSET_CDN 不一致，已忽略 · presence manifest ignored: ${fileBase || '(空)'} ≠ ${root}`);
      return false;
    }
    for (const p of raw.paths) {
      if (typeof p !== 'string' || !p) continue;
      const bare = p.replace(/^\/+/, '');
      indexed.add(bare);
      have.add(bare);
    }
    if (!indexed.size) return false;
    // ★ 2026-10-18：`token: ""` 是**显式要求不加 `?v=`**（客户端有好几处用 `url.replace(/\.skel$/, '.atlas')`
    //   一类"以扩展名结尾"的判断，尾巴上挂查询串会让它们全部失配 —— 表现为「干员只有头像、没有 Spine 模型」）。
    //   只有缺省（undefined）才回落成 'local'。
    token = typeof raw.token === 'string' ? raw.token : 'local';
    lastError = null;
    log.info?.(`[cdn] 本地清单就绪（自建 bucket：不做索引、不做探测）· local presence manifest ready: ${root} (${indexed.size} 文件, token ${token})`);
    return true;
  }

  /** Fetch the CDN token + index. Never throws; safe to await. */
  function load() {
    if (!enabled || indexed.size) return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        // The token is part of the contract's URL shape, so the index and the token load together:
        // a rewritten URL without `?v=` is not a URL the contract defines.
        const api = await fetchJson(`${root}/cdn/v1/api.json`);
        if (!api || typeof api.token !== 'string' || !api.token) throw new Error('api.json carried no token');
        token = api.token;
        const tree = await fetchJson(`${root}/cdn/v1/tree.json`);
        for (const [dir, v] of Object.entries(tree?.dirs || {})) {
          for (const f of v?.files || []) { const p = `${dir}/${f[0]}`; indexed.add(p); have.add(p); }
        }
        if (!indexed.size) throw new Error('tree.json listed no files');
        if (!token && typeof tree?.token === 'string') token = tree.token;
        lastError = null;
        cache.clear();
        log.info?.(`[cdn] 素材 CDN 索引就绪 · index ready: ${root} (${indexed.size} 文件, token ${token || 'n/a'})`);
        void sweep();
      } catch (e) {
        lastError = e;
        attempts += 1;
        const wait = RETRY_MS[Math.min(attempts - 1, RETRY_MS.length - 1)];
        log.warn?.(`[cdn] 索引获取失败，${Math.round(wait / 1000)}s 后重试（清单暂由本机提供）· index fetch failed, retrying in ${Math.round(wait / 1000)}s (manifests served locally): ${e.message}`);
        setTimeout(() => { loadPromise = null; void load(); }, wait).unref?.();
      }
    })();
    return loadPromise;
  }

  /**
   * HEAD every art path of the manifests that is not already known to exist, and adopt the ones the
   * CDN answers 200 for. Runs in the background; each batch of discoveries invalidates the cached
   * manifests so the next request already points at the CDN.
   */
  function sweep() {
    if (!enabled || !dataDir || sweepPromise) return sweepPromise;
    sweepPromise = (async () => {
      const candidates = new Set();
      for (const name of CDN_MANIFESTS) {
        const text = await fsp.readFile(path.join(dataDir, name), 'utf8').catch(() => '');
        for (const m of text.matchAll(ART_IN_JSON)) {
          const bare = m[1].slice(1);
          if (!have.has(bare)) candidates.add(bare);
        }
      }
      if (!candidates.size) { probes.running = false; return; }
      probes = { done: 0, present: 0, absent: 0, running: true };
      const list = [...candidates];
      let cursor = 0;
      let found = 0;
      const worker = async () => {
        while (cursor < list.length) {
          const p = list[cursor++];
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
          try {
            const r = await fetch(`${root}/${p}`, { method: 'HEAD', signal: ctrl.signal });
            if (r.status === 200) { have.add(p); found++; probes.present++; }
            else probes.absent++;
          } catch { probes.absent++; } finally { clearTimeout(t); probes.done++; }
          // publish discoveries as they arrive, so a long sweep still helps immediately
          if (found && found % 100 === 0) cache.clear();
        }
      };
      await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, list.length) }, worker));
      cache.clear();
      probes.running = false;
      log.info?.(`[cdn] 后台核对完成 · probe sweep done: ${probes.present} 条可走 CDN, ${probes.absent} 条确认缺失留本机 (${probes.present} via CDN, ${probes.absent} stay local)`);
      await writeCache();
    })().catch((e) => {
      probes.running = false;
      log.warn?.(`[cdn] 后台核对失败 · probe sweep failed: ${e.message}`);
    });
    return sweepPromise;
  }

  // ---------------------------------------------------------------------------------------------
  // serving
  // ---------------------------------------------------------------------------------------------

  /** Is this one of the three manifests? */
  function handles(name) {
    return enabled && CDN_MANIFESTS.includes(name);
  }

  /**
   * Rewrite the art URLs of one manifest. Only JSON strings holding a plain `/assets/…` or `/fonts/…`
   * path the CDN carries are replaced; every other byte is left alone, so the file stays valid JSON of
   * the same shape.
   * @param {string} text raw manifest JSON
   */
  function rewrite(text) {
    let rewritten = 0;
    let local = 0;
    const suffix = token ? `?v=${token}` : '';
    const out = text.replace(ART_IN_JSON, (whole, p) => {
      const bare = p.split('?')[0].split('#')[0];
      if (!PREFIXES.some((pre) => bare.startsWith(pre))) return whole;
      // ★ 2026-10-14：本机清单里的素材路径带一个**内容哈希段** —— `/assets/~<hash>/…`
      //   （server/http/media.js 的 hashedFileOpts，命中时那一段还决定 immutable 缓存）。
      //   CDN 镜像的是上游原始素材树，**没有这一段**；它的内容版本用 `?v=<token>` 表达（契约如此）。
      //   所以查 CDN 之前先剥掉哈希段，改写出去的 URL 也用剥掉后的路径 —— 否则每一条都查不到、
      //   整份 assets.json 一条都改写不了（用户 2026-10-14 实测：24019 条全部留在本机）。
      const noHash = bare.replace(/^(\/(?:assets|fonts)\/)~[0-9a-f]{6,}\//, '$1');
      if (!have.has(noHash.slice(1))) { local += 1; return whole; }
      rewritten += 1;
      return `"${root}${noHash}${suffix}"`;
    });
    return { text: out, rewritten, local };
  }

  /**
   * Serve a rewritten manifest, or return false to let the normal static path handle it.
   * Returning false is the safe default: an unloaded index, a read error or a disabled CDN all fall
   * back to the file on disk.
   * @returns {Promise<boolean>} true when the response was written
   */
  async function serve(req, res, name, absPath) {
    // Only rewrite once the index AND the token are in hand. The probe cache alone would produce a
    // manifest that is mostly still local, and a rewrite without the token would be off-contract; until
    // then the on-disk manifest is served, which is correct — just not yet offloaded.
    // ★ 2026-10-18：token 为空是**合法**的（不再要求非空）——清单可以显式要求"不加 ?v="，
    //   见 readPresent 里的注释（客户端的 `.skel$` 一类判断会被查询串打坏）。
    if (!handles(name) || !indexed.size) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let entry = cache.get(name);
    if (!entry) {
      let text;
      try { text = await fsp.readFile(absPath, 'utf8'); } catch (e) {
        log.warn?.(`[cdn] 读取清单失败，回退本机 · manifest read failed, falling back: ${name}: ${e.message}`);
        return false;
      }
      const { text: out, rewritten, local } = rewrite(text);
      const buf = Buffer.from(out, 'utf8');
      const etag = `"cdn-${buf.length.toString(16)}-${createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`;
      entry = { buf, gz: null, etag, rewritten, local };
      cache.set(name, entry);
      log.info?.(`[cdn] ${name}: ${rewritten} 条走 CDN，${local} 条留本机 · ${rewritten} via CDN, ${local} local`);
    }

    const acceptsGzip = /\bgzip\b/i.test(req.headers['accept-encoding'] || '');
    if (acceptsGzip && !entry.gz) {
      try { entry.gz = await gzipAsync(entry.buf); } catch { entry.gz = null; }
    }
    const body = acceptsGzip && entry.gz ? entry.gz : entry.buf;
    const headers = {
      'Content-Type': MIME['.json'],
      'Cache-Control': 'no-cache',
      ETag: entry.etag,
      Vary: 'Accept-Encoding',
      'X-Asset-CDN': `${entry.rewritten}cdn/${entry.local}local`,
    };
    if (acceptsGzip && entry.gz) headers['Content-Encoding'] = 'gzip';
    // Only If-None-Match is honoured: the rewritten body has no meaningful Last-Modified (it changes
    // when the probe sweep discovers more files), and answering an If-Modified-Since-only client with
    // 304 would leave it with a stale manifest forever.
    if (req.headers['if-none-match'] && isNotModified(req, entry.etag, new Date(0))) {
      res.writeHead(304, headers); res.end(); return true;
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }

  if (enabled) {
    void (async () => {
      // A self-hosted bucket states its contents in a local file; only the public-mirror path needs the network.
      if (await readPresent()) return;
      await readCache();
      await load();
    })();
  } else {
    log.info?.('[cdn] 素材 CDN 已关闭（SP_ASSET_CDN=off）· asset CDN disabled');
  }

  /**
   * ★ 2026-10-14：给【已经被内存重写过的】清单文本再过一遍 CDN 重写。
   *   为什么需要它：`/data/assets.json` 与 `/data/local-assets.json` 由 assetViews.js 的内存版回答，
   *   而那一支在 static.js 里【早于】assetCdn.serve 就 return 了 —— 于是这两个最大的清单永远走不到 CDN
   *   （emotes.json 不在 views 里，所以它能走）。这里复用同一个 rewrite()：索引 / token 没就绪时返回 null，
   *   调用方原样使用自己的文本，行为与不开 CDN 时完全一致。
   * @param {string} text 清单 JSON 文本
   * @returns {{ text: string, rewritten: number, local: number } | null}
   */
  function rewriteText(text) {
    if (!enabled || !indexed.size) return null;
    // ★ assetViews 的 `view.body` 是 Buffer（它自己用 .length 当 Content-Length），所以这里两种都收。
    const s = Buffer.isBuffer(text) ? text.toString('utf8') : text;
    if (typeof s !== 'string' || !s) return null;
    const r = rewrite(s);
    if (r.rewritten > 0) {
      log.info?.(`[cdn] 内存清单: ${r.rewritten} 条走 CDN，${r.local} 条留本机 · ${r.rewritten} via CDN (in-memory view)`);
    }
    return r;
  }

  return {
    rewriteText,
    handles,
    serve,
    load,
    ready: () => have.size > 0,
    stats: () => ({
      root, token, enabled, ready: have.size > 0,
      indexed: indexed.size, known: have.size, probes: { ...probes },
      attempts, lastError: lastError ? String(lastError.message || lastError) : null,
    }),
  };
}
