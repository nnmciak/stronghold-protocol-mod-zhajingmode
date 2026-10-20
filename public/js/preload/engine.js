// public/js/preload/engine.js — 素材预下载引擎：把 /preload/manifest.json 列出的每个素材放进浏览器，并报告进度。
//
// Two back ends, picked automatically (the UI shows which one is in use):
//
//   * **sw** — the page is in a secure context (https, or http on localhost), so `caches` and a service worker
//     exist. Items are written into Cache Storage and public/resource-sw.js answers the game's own requests from
//     there: real offline play, and an exact, verifiable "this file is here and it is the current one".
//   * **http** — plain http over a LAN address. Neither Service Worker nor Cache Storage is available (both are
//     secure-context only), so the only thing a page can fill is the browser's own HTTP cache: every item is
//     simply fetched and its body drained. No verification is possible — the HTTP cache cannot be queried — so the
//     progress bar counts requests, and a re-run re-requests everything (cheap: the browser answers from disk).
//
// Correctness over speed, three rules:
//
//   1. **Per-file staleness, not per-version.** Asset URLs carry no content hash and tools/fetch-assets.mjs
//      rewrites files in place, so "the manifest changed" must not mean "throw away 900 MB". Each item carries the
//      server's validator (`[url, bytes, tag]`, files.js `fileTag`); a cached copy whose ETag normalises to a
//      different tag is re-fetched and everything else is left alone. A re-run after an art edit moves only the
//      edited files — and the check is a cache lookup, not a network round trip.
//   2. **The page writes, the worker reads.** Items are fetched with `x-sp-preload: 1`, which resource-sw.js
//      ignores entirely, so exactly one component owns each cache entry. Before that, the worker is told the cache
//      name and the version; until it is, it stays out of the way (see its header).
//   3. **Never block the game.** Nothing here is awaited by the app: the panel starts this after the title screen
//      is up, pausing is honoured immediately, and a failure is a message in the panel, never an exception thrown
//      into a match.
//
// One pass = verify, then fetch what is left. `verify()` walks the cache (no network) and rebuilds the work list
// from the items whose stored copy is missing or stale; the pool then downloads exactly those. That is also what
// a resume does — which is why a failure, an eviction or a half-written file needs no bookkeeping of its own:
// whatever is not in the cache is simply in the next list.

/** Where the server publishes the work list (server/http/preload.js). */
export const MANIFEST_URL = '/preload/manifest.json';
/** The worker that serves the cache to the game (public/resource-sw.js). */
export const SW_URL = '/resource-sw.js';
/** Cache names this module creates; the worker only reads names with this prefix. */
export const CACHE_PREFIX = 'sp-assets-';
/** localStorage key: `{ version, cache, auto }` — what the next page load needs to resume silently. */
export const STATE_KEY = 'sp-preload';

/** Header that takes a request out of the worker's hands (resource-sw.js must agree). */
const BYPASS_HEADER = 'x-sp-preload';
/** Items in flight at once. Low enough not to starve the game's own requests on a slow uplink. */
const DOWNLOAD_CONCURRENCY = 6;
/** Extra sockets in http mode, where a request costs one HTTP round trip and nothing is written to Cache Storage. */
const PREFETCH_EXTRA = 2;
/** Verification is cache-only work; more of it in parallel is free. */
const VERIFY_CONCURRENCY = 32;
/** Progress notifications per second (a 14k-item pass would otherwise repaint thousands of times). */
const PROGRESS_HZ = 4;
/** One item taking longer than this fails on its own without touching the other requests in flight. */
const ITEM_TIMEOUT_MS = 60_000;

/**
 * What this browser can do here.
 * @returns {{ secure: boolean, sw: boolean, mode: 'sw' | 'http', reason: string | null }}
 */
export function capabilities() {
  const secure = !!globalThis.isSecureContext;
  const sw = secure && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'caches' in globalThis;
  if (sw) return { secure, sw: true, mode: 'sw', reason: null };
  return {
    secure,
    sw: false,
    mode: 'http',
    reason: secure
      ? '当前浏览器不提供 Service Worker / Cache Storage，只能把素材预取进浏览器自己的缓存，能留下多少由浏览器决定。'
      : '当前页面不是安全上下文（http 且非 localhost），浏览器不提供 Service Worker 与 Cache Storage，只能把素材预取进浏览器自己的缓存：它的容量由浏览器决定，装不下全部 932 MiB，能留下多少不保证。改用 https 或 localhost 可获得完整、可校验的离线缓存。',
  };
}

/** The cache key of an asset URL — the path alone, matching resource-sw.js `key()`. */
export function cacheKey(url) {
  return new Request(new URL(url, globalThis.location?.origin || 'http://localhost').href);
}

/** files.js ETag (`"<size>-<mtime>"`, `-gz` when gzipped) → the bare tag the manifest carries. */
export function normalizeTag(etag) {
  return String(etag || '').trim().replace(/^W\//, '').replace(/^"/, '').replace(/"$/, '').replace(/-gz$/, '');
}

/** Fetch the work list. `no-store`: a cached copy would defeat the version check that follows it. */
export async function fetchManifest() {
  const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`清单请求失败 HTTP ${res.status}`);
  const json = await res.json();
  if (!json || !Array.isArray(json.groups)) throw new Error('清单格式不正确');
  return json;
}

/**
 * Flatten the manifest into the ordered task list. Each item carries its stage (server/http/preload.js `stageOf`):
 * 0 必需, 1 延后 (currently unused). Stage-2 items ("按需" — 语音 / 商店立绘 / 指南 / 皮肤 spine) are not in
 * `groups` at all; the game fetches one when a screen that uses it renders. Array#sort is stable, so within a stage
 * the server's manifest order survives and "resume after N items" keeps its meaning.
 */
function flatten(manifest) {
  const items = [];
  for (const group of manifest.groups) {
    for (const entry of group.items || []) {
      const [url, bytes, tag, stage] = entry || [];
      if (typeof url !== 'string') continue;
      items.push({ url, bytes: Number(bytes) || 0, tag: typeof tag === 'string' ? tag : '', group: group.id, stage: Number(stage) || 0 });
    }
  }
  items.sort((a, b) => a.stage - b.stage);
  return items;
}

function readState() {
  try { return JSON.parse(globalThis.localStorage?.getItem(STATE_KEY) || 'null') || null; } catch { return null; }
}

function writeState(next) {
  try { globalThis.localStorage?.setItem(STATE_KEY, JSON.stringify(next)); } catch { /* private mode: no resume */ }
}

/** A signal that follows `parent` but can be aborted on its own — one hung item must not cancel the pool. */
function childSignal(parent, ms) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (parent.aborted) controller.abort();
  else parent.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('timeout')), ms);
  return {
    signal: controller.signal,
    release: () => { clearTimeout(timer); parent.removeEventListener('abort', onAbort); },
  };
}

/**
 * Register the worker and wait until it can be talked to. Resolves even when the page is not controlled yet (a
 * first visit): the download itself only needs Cache Storage — the worker is what serves the game afterwards.
 */
async function ensureWorker(log) {
  await navigator.serviceWorker.register(SW_URL, { type: 'module', scope: '/' });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }
  if (!navigator.serviceWorker.controller) log('service worker 尚未接管本页：本次仍会写入缓存，刷新后生效');
}

/**
 * The pre-download state machine. One instance per page; the panel drives it and renders `getState()`.
 * @param {{ onUpdate?: (state: object) => void, log?: (...a: any[]) => void }} [hooks]
 */
export function createPreloader({ onUpdate, log = () => {} } = {}) {
  const caps = capabilities();
  /** @type {'idle'|'checking'|'downloading'|'paused'|'done'|'error'} */
  let phase = 'idle';
  let manifest = null;
  let items = [];
  /** The work list of the current pass: rebuilt by verify(), emptied as the pool works through it. */
  let pending = [];
  let cacheName = null;
  let cache = null;
  let presentFiles = 0;
  let presentBytes = 0;
  /** Present items per group id — what the panel's per-group bars read. */
  const groupDone = new Map();
  let failed = 0;
  /** Did the last pass actually walk the cache, or is `done` an assumption from an unchanged version? */
  let verified = false;
  /** Did the worker register successfully? (Only meaningful in sw mode.) */
  let swReady = false;
  let errorMessage = null;
  let currentUrl = null;
  let abort = null;
  let running = false;
  let lastEmit = 0;
  let windowBytes = 0;
  let windowAt = 0;
  let speed = 0;
  const listeners = new Set();

  const stored = readState();
  let auto = !!(stored && stored.auto);

  const totalBytes = () => (manifest ? manifest.bytes || 0 : 0);
  const totalFiles = () => (manifest ? manifest.files || 0 : 0);

  /** Count one finished item into its group's totals (missing group id counts as `other`). */
  function bump(group, bytes) {
    const id = group || 'other';
    const cur = groupDone.get(id) || { files: 0, bytes: 0 };
    cur.files++;
    cur.bytes += bytes;
    groupDone.set(id, cur);
  }

  function getState() {
    return {
      phase,
      mode: caps.mode,
      reason: caps.reason,
      version: manifest ? manifest.version : (stored?.version ?? null),
      cache: cacheName,
      files: totalFiles(),
      bytes: totalBytes(),
      doneFiles: presentFiles,
      doneBytes: presentBytes,
      /** 按需素材（语音 / 商店立绘 / 指南）：不在工作清单里，由用到它的界面自己取。null = 服务器没给这个字段。 */
      optional: manifest && manifest.optional
        ? { files: Number(manifest.optional.files) || 0, bytes: Number(manifest.optional.bytes) || 0 }
        : null,
      groups: manifest
        ? manifest.groups.map((g) => ({
          id: g.id,
          label: g.label,
          files: g.files || 0,
          bytes: g.bytes || 0,
          doneFiles: groupDone.get(g.id)?.files || 0,
          doneBytes: groupDone.get(g.id)?.bytes || 0,
        }))
        : [],
      failed,
      current: currentUrl,
      speed,
      etaSec: speed > 0 && totalBytes() > presentBytes ? Math.round((totalBytes() - presentBytes) / speed) : null,
      auto,
      verified,
      error: errorMessage,
      supported: caps.sw,
      swReady,
    };
  }

  function emit(force = false) {
    const now = Date.now();
    if (!force && now - lastEmit < 1000 / PROGRESS_HZ) return;
    lastEmit = now;
    const state = getState();
    try { onUpdate?.(state); } catch { /* a broken listener must not stop the download */ }
    for (const fn of listeners) { try { fn(state); } catch { /* ditto */ } }
  }

  function setPhase(next, message = null) {
    phase = next;
    errorMessage = message;
    emit(true);
  }

  /** Ask the worker to start (or stop) serving the game from this cache. */
  function tellWorker(active) {
    const controller = globalThis.navigator?.serviceWorker?.controller;
    if (!controller) return;
    try {
      controller.postMessage(active
        ? { t: 'sp-assets', cache: cacheName, version: manifest?.version ?? null }
        : { t: 'sp-assets-reset' });
    } catch { /* the worker stays in network-only mode, which is always safe */ }
  }

  /** Every cache of ours except the current one belongs to an older asset version. */
  async function dropOtherCaches() {
    if (!('caches' in globalThis)) return;
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== cacheName).map((k) => caches.delete(k)));
    } catch (e) { log('清理旧缓存失败', e); }
  }

  /** Is the cached copy of this item the one the server has now? */
  async function isCurrent(item) {
    let hit;
    try { hit = await cache.match(cacheKey(item.url)); } catch { return false; }
    if (!hit) return false;
    if (!item.tag) return true;
    return normalizeTag(hit.headers.get('etag')) === item.tag;
  }

  /** sw mode: one item — download it (out of the worker's hands) and store it. */
  async function download(item, signal) {
    const res = await fetch(item.url, { cache: 'no-store', headers: { [BYPASS_HEADER]: '1' }, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // cache.put consumes the body, so a resolved put means the whole file is stored and nothing is left unread.
    await cache.put(cacheKey(item.url), res);
  }

  /** http mode: no cache to write and none to verify — the fetch itself is the whole job. */
  async function prefetch(item, signal) {
    const res = await fetch(item.url, { headers: { [BYPASS_HEADER]: '1' }, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // The body has to be drained or the browser abandons the transfer; it goes nowhere but the HTTP cache.
    const reader = res.body?.getReader?.();
    if (reader) { for (;;) { const { done } = await reader.read(); if (done) break; } }
    else await res.arrayBuffer();
  }

  /** Run `worker` over `list` with `limit` in flight; `signal` cancels whatever is in flight. */
  async function pool(list, limit, signal, worker) {
    let next = 0;
    const runners = new Array(Math.min(limit, list.length)).fill(0).map(async () => {
      for (;;) {
        if (signal.aborted) return;
        const index = next++;
        if (index >= list.length) return;
        const item = list[index];
        currentUrl = item.url;
        const child = childSignal(signal, ITEM_TIMEOUT_MS);
        try {
          await worker(item, child.signal);
          windowBytes += item.bytes;
          presentFiles++;
          presentBytes += item.bytes;
          bump(item.group, item.bytes);
        } catch (e) {
          // An abort of the parent signal is a pause, not a failure; a child abort is this item's own timeout.
          if (signal.aborted) return;
          failed++;
          log('预下载失败', item.url, e?.message || e);
        } finally {
          child.release();
        }
        emit();
      }
    });
    await Promise.all(runners);
  }

  /**
   * Walk the cache and rebuild `pending` from the items whose stored copy is missing or stale. Cache lookups
   * only — this is what makes a re-run after an art edit move just the edited files.
   */
  async function verify(signal) {
    const have = new Uint8Array(items.length);
    let next = 0;
    const runners = new Array(Math.min(VERIFY_CONCURRENCY, items.length)).fill(0).map(async () => {
      for (;;) {
        if (signal.aborted) return;
        const i = next++;
        if (i >= items.length) return;
        if (await isCurrent(items[i])) have[i] = 1;
        emit();
      }
    });
    await Promise.all(runners);
    if (signal.aborted) return;
    presentFiles = 0;
    presentBytes = 0;
    groupDone.clear();
    pending = [];
    for (let i = 0; i < items.length; i++) {
      if (have[i]) { presentFiles++; presentBytes += items[i].bytes; bump(items[i].group, items[i].bytes); }
      else pending.push(items[i]);
    }
    verified = true;
    log(`校验完成：${presentFiles}/${items.length} 项已是最新，待下载 ${pending.length} 项`);
  }

  /** Load the work list and get the cache + worker ready. Once per page. */
  async function ensureReady(signal) {
    if (!manifest) {
      manifest = await fetchManifest();
      items = flatten(manifest);
      if (!items.length) throw new Error('清单里没有任何素材');
      cacheName = CACHE_PREFIX + (manifest.hash || 'nohash');
    }
    if (caps.mode === 'sw') {
      await ensureWorker(log);
      swReady = true;
      cache = await caches.open(cacheName);
      await dropOtherCaches();
      // The worker starts in network-only mode on every page load; this is what turns the cache back on.
      tellWorker(true);
      await verify(signal);
    } else {
      // http mode has no cache to inspect, so the counters are rebuilt from zero for every pass. Without this a
      // second run would keep adding to the first one's totals and report more files than the manifest has.
      presentFiles = 0;
      presentBytes = 0;
      groupDone.clear();
      pending = items;
    }
  }

  async function run() {
    if (running) return;
    running = true;
    failed = 0;
    abort = new AbortController();
    const signal = abort.signal;
    windowBytes = 0;
    windowAt = Date.now();
    let tick = null;
    try {
      setPhase('checking');
      await ensureReady(signal);
      // Started once → keep resuming on later page loads without asking again (the panel's 自动续传 switch).
      writeState({ version: manifest.version, cache: cacheName, auto: true });
      auto = true;
      if (signal.aborted) { setPhase('paused'); return; }

      setPhase('downloading');
      tick = setInterval(() => {
        const dt = (Date.now() - windowAt) / 1000;
        if (dt > 0) speed = windowBytes / dt;
        windowBytes = 0;
        windowAt = Date.now();
        emit();
      }, 1000);
      await pool(pending, caps.mode === 'sw' ? DOWNLOAD_CONCURRENCY : DOWNLOAD_CONCURRENCY + PREFETCH_EXTRA,
        signal, caps.mode === 'sw' ? download : prefetch);
      speed = 0;
      if (signal.aborted) { setPhase('paused'); return; }
      if (failed) setPhase('error', `${failed} 项下载失败（其余已完成，再次点击会只重试这些）`);
      else setPhase('done');
    } catch (e) {
      if (signal.aborted) { setPhase('paused'); return; }
      setPhase('error', e?.message || String(e));
      log('预下载中止', e);
    } finally {
      if (tick) clearInterval(tick);
      running = false;
      currentUrl = null;
      emit(true);
    }
  }

  return {
    getState,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /**
     * Register the worker without downloading anything. Worth doing as soon as the page mounts: the worker then
     * controls this page before the first file lands, so a download started later is served to the game straight
     * away instead of only after a reload. An uninformed worker does nothing at all (see resource-sw.js), so this
     * is safe even for a player who never presses 开始.
     */
    async prepare() {
      if (caps.mode !== 'sw') return false;
      try {
        await ensureWorker(log);
        swReady = true;
      } catch (e) {
        swReady = false;
        log('service worker 注册失败', e);
      }
      emit(true);
      return swReady;
    },

    /**
     * Read the manifest for display only — sizes and groups, no cache access, no requests for assets. The panel
     * calls this when it is opened so the player sees what 开始预下载 would actually cost before committing.
     */
    async describe() {
      if (!manifest) {
        try {
          manifest = await fetchManifest();
          items = flatten(manifest);
          cacheName = CACHE_PREFIX + (manifest.hash || 'nohash');
        } catch (e) { log('清单读取失败', e); }
      }
      emit(true);
      return getState();
    },

    /** Start (or continue) the download. Also the "resume" entry point. */
    async start() {
      if (running) return;
      if (phase === 'error') failed = 0;
      await run();
    },

    /** Stop after the requests in flight settle; the next start() re-verifies and continues. */
    pause() {
      if (!running) return;
      abort?.abort();
      setPhase('paused');
    },

    /** Re-check every cached item against the current manifest and rebuild the work list. Downloads nothing. */
    async recheck() {
      if (running) return;
      try {
        setPhase('checking');
        manifest = await fetchManifest();
        items = flatten(manifest);
        cacheName = CACHE_PREFIX + (manifest.hash || 'nohash');
        failed = 0;
        if (caps.mode === 'sw') {
          await ensureWorker(log);
          swReady = true;
          cache = await caches.open(cacheName);
          await dropOtherCaches();
          tellWorker(true);
          await verify(new AbortController().signal);
        } else {
          presentFiles = 0;
          presentBytes = 0;
          groupDone.clear();
          pending = items;
          verified = false;
        }
        setPhase(pending.length ? 'paused' : 'done');
      } catch (e) {
        setPhase('error', e?.message || String(e));
      }
    },

    /** Throw the cache away (the game then loads from the server exactly as it did before). */
    async clear() {
      abort?.abort();
      if ('caches' in globalThis) {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k)));
        } catch (e) { log('清除缓存失败', e); }
      }
      cache = null;
      pending = [];
      presentFiles = 0;
      presentBytes = 0;
      groupDone.clear();
      failed = 0;
      verified = false;
      writeState({ version: manifest?.version ?? stored?.version ?? null, cache: null, auto: false });
      auto = false;
      tellWorker(false);
      setPhase('idle');
    },

    /** Turn silent resume on/off (the panel's 自动续传 switch); persisted either way. */
    setAuto(value) {
      auto = !!value;
      writeState({ version: manifest?.version ?? stored?.version ?? null, cache: cacheName, auto });
      emit(true);
    },

    /**
     * What this page load should do on its own. The worker is told about the cache either way — it forgets on
     * every restart, and without that message it would serve nothing from the cache at all.
     * @returns {Promise<boolean>} whether a download is now running
     */
    async resumeIfAuto() {
      if (!auto || running) return false;
      try {
        setPhase('checking');
        manifest = await fetchManifest();
        items = flatten(manifest);
        cacheName = CACHE_PREFIX + (manifest.hash || 'nohash');
        if (caps.mode === 'sw') {
          await ensureWorker(log);
          swReady = true;
          cache = await caches.open(cacheName);
          await dropOtherCaches();
          tellWorker(true);
        }
        if (stored && stored.version === manifest.version) {
          // Nothing moved since the last completed pass: report it without walking 14k cache entries. `recheck`
          // is the explicit way to find out whether the browser quietly evicted something.
          presentFiles = totalFiles();
          presentBytes = totalBytes();
          groupDone.clear();
          for (const g of manifest.groups) groupDone.set(g.id, { files: g.files || 0, bytes: g.bytes || 0 });
          pending = [];
          verified = false;
          setPhase('done');
          return false;
        }
      } catch (e) {
        setPhase('error', e?.message || String(e));
        return false;
      }
      await run();
      return true;
    },

    /** Free storage the browser may otherwise evict under pressure — worth asking for before 900 MB. */
    async requestPersistence() {
      try { return (await globalThis.navigator?.storage?.persist?.()) ?? false; } catch { return false; }
    },

    /** `{ usage, quota }` of this origin, or null where the API is missing. */
    async estimate() {
      try {
        const e = await globalThis.navigator?.storage?.estimate?.();
        return e && typeof e.usage === 'number' ? { usage: e.usage, quota: e.quota || 0 } : null;
      } catch { return null; }
    },
  };
}
