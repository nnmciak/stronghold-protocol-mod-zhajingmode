// server/http/preload.js — /preload/manifest.json: 素材预下载的工作清单 (the work list the browser pre-downloads).
// (i18n-ignore-file: the group labels are 中文 UI text by design — public/js/preload/panel.js shows them verbatim)
//
// The page cannot know which of the ~58k files under public/assets it will ever ask for, and reading the three
// manifests itself would mean pulling 2.7 MB of JSON before the first byte of art moves. So the server answers one
// generated JSON: every /assets/ and /fonts/ URL those manifests reference, with its size on disk, grouped for the
// UI and sorted so that "resume after N items" stays valid across page loads.
//
//   * sources: data/assets.json (the game's own catalog), data/local-assets.json (local-client art, optional — an
//     install without it gets an empty manifest, see static.js) and data/emotes.json. Only string values that look
//     like an asset path are taken; nothing else in those documents is walked into the list.
//   * a referenced file that is absent from disk goes into `missing` instead of being dropped silently — otherwise
//     a broken install hides behind a progress bar that never reaches 100%.
//   * every item carries `[url, bytes, tag, stage]`: `tag` is files.js `fileTag` — the same `<size>-<mtime>` the ETag
//     is built from. The browser compares it against the ETag of its cached copy, so an asset edited on disk is
//     re-fetched while the other 14k stay untouched, with no network round trip per file. `stage` splits the list
//     into 必需 / 延后 / 按需 (see `stageOf`): the first two are what a client downloads, the third is left to the
//     screens that actually use it — that is the "瘦身首次预载" lever, and the only one that removes bytes rather
//     than reordering them.
//   * the answer is cached in memory and rebuilt when a source's size/mtime moves or after TTL_MS: the stat pass
//     over ~14k files costs around a second, which is not something to repeat per request.
//   * the ETag is the work list's own version string (`<assets hash>-<files>-<bytes>-s<ruleset>`); the ruleset tag
//     moves when the stage rules change, so a reclassification re-verifies even though no file changed. The browser
//     revalidates with a cheap 304, and public/js/preload/engine.js uses the same string to decide whether its cache
//     is still current.
//
// static.js serves this as a virtual file next to /data.js, so a test with custom publicDir/dataDir options gets
// its own manifest with no extra wiring in routes.js / index.js.
//
// Size of the list: ~6.9k items ≈ 0.6 MB of JSON, ≈ 0.1 MB gzipped (Vary: Accept-Encoding is set); the ~7.3k
// stage-2 items (voice / shop art / guide / skin spines) are counted in `optional` but never listed.

import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { acceptsGzip, fileTag, isNotModified } from './files.js';
import { noopLog } from './config.js';

const gzipAsync = promisify(zlib.gzip);

/** Data manifests whose asset paths make up the work list, in the order they are read. */
const SOURCES = ['assets.json', 'local-assets.json', 'emotes.json'];

/** A string in one of those documents counts as an asset path only if it starts like one. */
const ASSET_RE = /^\/(?:assets|fonts|audio|media)\//;

/** How long a built list is reused before the sources are stat-ed again (ms). */
const TTL_MS = 60_000;

/** Concurrent fsp.stat calls while measuring the list. Windows' thread pool caps the useful value. */
const STAT_CONCURRENCY = 32;

/** Below this the JSON is sent as-is (gzip overhead is not worth it). */
const GZIP_MIN_BYTES = 512;

/** The one path this module answers. */
export const PRELOAD_PATH = '/preload/manifest.json';

/**
 * Group id → the label the panel shows. The order here is the order the UI lists them: the two big ones first,
 * because they are what makes the progress bar move and what a player waits for in a match.
 */
const GROUPS = [
  ['spine', '战斗模型 · Spine'],
  ['audio', '音频 · BGM / 音效 / 语音'],
  ['char', '干员立绘与头像'],
  ['local', '本地客户端素材'],
  ['ui', '界面素材'],
  ['enemy', '敌人'],
  ['skill', '技能图标'],
  ['band', '阵营'],
  ['token', '召唤物'],
  ['item', '道具'],
  ['prof', '职业图标'],
  ['module', '模组'],
  ['bond', '羁绊'],
  ['fonts', '字体'],
  ['other', '其他'],
];
const GROUP_IDS = new Set(GROUPS.map(([id]) => id));

/** Which group an asset URL belongs to: /assets/<id>/…, or the /fonts/ mount. */
function groupOf(url) {
  const seg = url.split('/');
  if (seg[1] === 'fonts') return 'fonts';
  const id = seg[2] || 'other';
  return GROUP_IDS.has(id) ? id : 'other';
}

/**
 * The stages of the work list (user request 2026-10-10, "瘦身首次预载"). Each item carries its stage as the 4th
 * element of `[url, bytes, tag, stage]`; a client that only reads the first three (an older page still open, an
 * out-of-tree tool) simply preloads everything, exactly as before.
 *
 *   0 必需 — the art a player needs to be in a room and in a battle. Downloaded first, in manifest order.
 *   1 延后 — currently empty (see below). Kept because the tier is genuinely useful: move the skin rule back to
 *            STAGE_DEFER and cosmetic variants are preloaded again, just behind every stage-0 item.
 *   2 按需 — never needed to PLAY: 逐条语音, 商店皮肤立绘与头像, 指南图, and (since the second pass of 2026-10-10)
 *            the 皮肤 / 迭代 / 异格 spine of every operator. Not in the work list at all — the game asks for one the
 *            moment the screen that uses it (换装/图鉴/指南/语音播放) renders it, and the SW / HTTP cache keeps it
 *            from then on.
 *
 * Stage 2 is where the bytes are: 语音 152 MiB + 商店立绘/头像 87 MiB + 指南 45 MiB + 皮肤 spine 227 MiB ≈ 511 MiB
 * that a session which never opens those screens would otherwise download in full. `files` / `bytes` in the payload
 * are the PRELOAD totals (stages 0+1 — the denominator a client's progress bar counts to) and `optional` carries the
 * stage-2 totals so the panel can say what was left out. `groups[].items` likewise holds only preloaded items, so a
 * per-group bar can still reach 100 %.
 */
const STAGE_PRELOAD = 0;
/** 延后段：本轮未使用（皮肤 spine 已按用户决定移出预载）。保留 `stageOf` 里的那一行注释，便于一行回退。 */
const STAGE_DEFER = 1;
const STAGE_ON_DEMAND = 2;
/** Bump when the rules below change: it is part of `version`, so clients re-verify after a reclassification. */
const STAGE_RULESET = 2;
/** Assets only ever fetched from a screen the player opens. Keep this list in sync with the doc above. */
const ON_DEMAND_RE = [
  /^\/assets\/audio\/voice\//,              // 逐干员语音
  /^\/assets\/char\/skin_portrait_shop\//,  // 商店皮肤立绘
  /^\/assets\/char\/skin_avatar\//,         // 皮肤头像
  /^\/assets\/local\/guide\//,              // 本地客户端 · 指南图
  /^\/assets\/ui\/guide\//,                 // 界面 · 指南图
];

/**
 * 皮肤 / 迭代 / 异格 spine：`spine/op/<charId>/<变体>/…`；基础模型是 `spine/op/<charId>/front|back/…`。
 * 这两类几乎对半（基础 195.4 MiB / 变体 227.0 MiB），而变体只有玩家**真的用了那个皮肤**才会被画出来。
 */
function isSpineVariant(url) {
  const seg = url.split('/');   // ['', 'assets', 'spine', 'op', <charId>, <variant|front|back>, …]
  return seg[1] === 'assets' && seg[2] === 'spine' && seg[3] === 'op'
    && !!seg[5] && seg[5] !== 'front' && seg[5] !== 'back';
}

/**
 * Which stage an asset URL belongs to (table above). Anything unrecognised stays stage 0 — the safe default.
 *
 * 权衡（已与用户确认 2026-10-10）：皮肤 spine 改成按需后预载 653.3 → 426.3 MiB，代价是某玩家**第一次用到某皮肤**时
 * 要在对局中即时下 1–3 MB（.skel + .png + .atlas）。换装/图鉴界面渲染该皮肤时就会触发这次下载，所以通常发生在备战
 * 阶段而非开打瞬间；若线上反馈开打卡顿，把 `isSpineVariant` 那一行改回 `STAGE_DEFER` 即可。
 */
function stageOf(url) {
  if (isSpineVariant(url)) return STAGE_ON_DEMAND;
  for (const re of ON_DEMAND_RE) if (re.test(url)) return STAGE_ON_DEMAND;
  return STAGE_PRELOAD;
}

/**
 * The file on disk a manifest URL addresses. The URL is percent-decoded the same way static.js decodes the request
 * path, so a manifest carrying `%5B`-escaped brackets (the 红蓝门 URL-encoding case) finds the same file the browser
 * would get. A stray `%` that is not an escape falls back to the raw form.
 * @returns {string | null} absolute path, or null when the path tries to leave the root
 */
function diskPath(root, url) {
  const clean = url.split('?')[0].split('#')[0];
  const raw = clean.replace(/^\/+/, '');
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* not an escape sequence — use it as written */ }
  const segs = decoded.split('/');
  if (segs.some((s) => s === '..' || s === '.' || s === '')) return null;
  return path.join(root, ...segs);
}

/** Walk a parsed manifest and collect every string that looks like an asset path. */
function collect(node, out) {
  if (typeof node === 'string') { if (ASSET_RE.test(node)) out.add(node); return; }
  if (!node || typeof node !== 'object') return;
  for (const key of Object.keys(node)) collect(node[key], out);
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Create the manifest builder/serving pair for one set of served directories.
 * @param {{ publicDir: string, dataDir: string, log?: object }} dirs
 * @returns {{ handles: (rawPath: string) => boolean,
 *             serve: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>,
 *             get: () => Promise<object>, warm: () => void }}
 */
export function createPreloadManifest({ publicDir, dataDir, log = noopLog }) {
  const pub = path.resolve(publicDir);
  const dat = path.resolve(dataDir);
  /** @type {{ signature: string, builtAt: number, payload: object, body: Buffer, etag: string, mtime: Date, gzip: (() => Promise<Buffer>) | null } | null} */
  let cache = null;
  let inflight = null;

  /** Cheap change detector: name + size + mtime of every source, without parsing any of them. */
  async function signature() {
    const parts = await Promise.all(SOURCES.map(async (name) => {
      const st = await fsp.stat(path.join(dat, name)).catch(() => null);
      return st && st.isFile() ? `${name}:${st.size}:${Math.floor(st.mtimeMs)}` : `${name}:-`;
    }));
    return parts.join('|');
  }

  async function build() {
    const urls = new Set();
    let hash = '';
    let newest = 0;
    for (const name of SOURCES) {
      const abs = path.join(dat, name);
      let text;
      try {
        text = await fsp.readFile(abs, 'utf8');
      } catch { continue; } // local-assets.json is legitimately absent on a server-only install
      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        log.warn(`[preload] ${name} is not valid JSON — skipped`, e.message);
        continue;
      }
      const st = await fsp.stat(abs).catch(() => null);
      if (st) newest = Math.max(newest, st.mtimeMs);
      if (!hash && json && typeof json.hash === 'string') hash = json.hash;
      collect(json, urls);
    }

    // Sorted, so the item order (and therefore "resume after N") survives a manifest regenerated in another order.
    const list = [...urls].sort();
    const stats = await mapLimit(list, STAT_CONCURRENCY, async (url) => {
      const abs = diskPath(pub, url);
      if (!abs) return null;
      const st = await fsp.stat(abs).catch(() => null);
      return st && st.isFile() ? { size: st.size, tag: fileTag(st) } : null;
    });

    const buckets = new Map(GROUPS.map(([id]) => [id, []]));
    const missing = [];
    /** Per-stage totals: what the preload covers (0+1) and what it deliberately leaves to on-demand fetching (2). */
    const stageFiles = [0, 0, 0];
    const stageBytes = [0, 0, 0];
    let files = 0;
    let bytes = 0;
    for (let i = 0; i < list.length; i++) {
      const url = list[i];
      const st = stats[i];
      if (!st) { missing.push(url); continue; }
      const stage = stageOf(url);
      stageFiles[stage]++;
      stageBytes[stage] += st.size;
      if (stage === STAGE_ON_DEMAND) continue;   // not part of the work list at all
      buckets.get(groupOf(url)).push([url, st.size, st.tag, stage]);
      files++;
      bytes += st.size;
    }

    const version = `${hash || 'nohash'}-${files}-${bytes}-s${STAGE_RULESET}`;
    const payload = {
      v: 1,
      version,
      hash,
      files,
      bytes,
      stages: [
        { id: STAGE_PRELOAD, label: '必需', files: stageFiles[STAGE_PRELOAD], bytes: stageBytes[STAGE_PRELOAD] },
        { id: STAGE_DEFER, label: '延后', files: stageFiles[STAGE_DEFER], bytes: stageBytes[STAGE_DEFER] },
        { id: STAGE_ON_DEMAND, label: '按需', files: stageFiles[STAGE_ON_DEMAND], bytes: stageBytes[STAGE_ON_DEMAND] },
      ],
      /** The stage-2 totals — what a client deliberately does NOT download up front. */
      optional: { files: stageFiles[STAGE_ON_DEMAND], bytes: stageBytes[STAGE_ON_DEMAND] },
      groups: GROUPS
        .map(([id, label]) => {
          const items = buckets.get(id);
          return { id, label, files: items.length, bytes: items.reduce((sum, [, size]) => sum + size, 0), items };
        })
        .filter((g) => g.files > 0),
      missing,
    };
    const body = Buffer.from(JSON.stringify(payload));
    const mtime = new Date(newest || Date.now());
    const mib = (b) => (b / 1048576).toFixed(1);
    log.info(`[preload] work list ${version}: 预载 ${files} files, ${mib(bytes)} MiB`
      + ` (必需 ${mib(stageBytes[STAGE_PRELOAD])} / 延后 ${mib(stageBytes[STAGE_DEFER])} MiB)`
      + `, 按需不入列 ${stageFiles[STAGE_ON_DEMAND]} files, ${mib(stageBytes[STAGE_ON_DEMAND])} MiB`
      + `, ${payload.groups.length} groups`
      + (missing.length ? `, ${missing.length} referenced file(s) missing on disk` : ''));
    return { payload, body, etag: `"pl-${version}"`, mtime, gzip: null };
  }

  /** The current entry, rebuilt when a source changed or the TTL ran out. Concurrent callers share one build. */
  function current() {
    const fresh = cache && Date.now() - cache.builtAt < TTL_MS;
    if (fresh) return Promise.resolve(cache);
    if (inflight) return inflight;
    inflight = (async () => {
      const sig = await signature();
      if (cache && cache.signature === sig) { cache.builtAt = Date.now(); return cache; }
      const entry = await build();
      cache = { ...entry, signature: sig, builtAt: Date.now() };
      return cache;
    })().finally(() => { inflight = null; });
    return inflight;
  }

  return {
    /** Is this request the manifest? (static.js asks before the mount lookup.) */
    handles: (rawPath) => rawPath === PRELOAD_PATH,

    async serve(req, res) {
      const entry = await current();
      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
        ETag: entry.etag,
        'Last-Modified': entry.mtime.toUTCString(),
        Vary: 'Accept-Encoding',
      };
      if (isNotModified(req, entry.etag, entry.mtime)) { res.writeHead(304, headers); res.end(); return; }
      const isHead = req.method === 'HEAD';
      if (entry.body.length >= GZIP_MIN_BYTES && acceptsGzip(req.headers['accept-encoding'])) {
        if (!entry.gzip) entry.gzip = gzipAsync(entry.body, { level: 6 });
        const gz = await entry.gzip;
        headers['Content-Encoding'] = 'gzip';
        headers['Content-Length'] = gz.length;
        res.writeHead(200, headers);
        res.end(isHead ? undefined : gz);
        return;
      }
      headers['Content-Length'] = entry.body.length;
      res.writeHead(200, headers);
      res.end(isHead ? undefined : entry.body);
    },

    /** The built payload (tools / tests). */
    async get() { return (await current()).payload; },

    /** Start building now so the first page load does not pay for the stat pass. Never throws. */
    warm() { current().catch((e) => log.warn('[preload] warm-up failed', e.message)); },
  };
}
