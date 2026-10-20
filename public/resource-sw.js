// public/resource-sw.js — 素材预下载的缓存层：/assets/、/fonts/、/media/ 由这里读缓存。
//
// Registered by public/js/preload/engine.js as a MODULE worker (`{ type: 'module' }`) so it can import the one
// definition of the extension-less audio route instead of keeping a second copy of the list (shared/media.js).
// If a browser cannot register a module worker the engine falls back to plain prefetching — see engine.js.
//
// Two rules shape everything here:
//
//   1. **The page owns the cache.** It creates it, fills it, verifies it and deletes it. This worker only reads
//      (plus an opportunistic fill, below). It never deletes a cache on its own: a worker update would otherwise
//      throw away a player's 900 MB download for nothing.
//   2. **No cache reads until the page says the cache matches the server.** `cacheName` is null in a fresh worker
//      — and a worker is restarted often (idle timeout, update, browser restart), so this is the normal state on
//      every page load until engine.js has compared /preload/manifest.json's version with the one stored in the
//      cache. Serving a stale asset (URLs carry no content hash) would show wrong art or a broken spine, which is
//      worse than no cache at all. Until then every request goes to the network exactly as it did before.
//
// Opportunistic fill: a cache miss that the network answers with 200 is written back, so simply playing the game
// warms the cache. It stops when the page resets (`sp-assets-reset`), which is also what a version change does.
//
// Audio and Range: a request carrying `Range` is never touched — the player seeks, and a cached 200 cannot answer
// a 206. `/media/<rest>` is looked up as `/assets/audio/<rest><ext>` first, because that is the URL the game
// actually asks for (shared/media.js) while the manifest lists the real file.

import { MEDIA_PREFIX, AUDIO_EXTS } from '/shared/media.js';

/** Every cache this module may read belongs to this prefix (the page picks the full name). */
const CACHE_PREFIX = 'sp-assets-';
/** Path prefixes the pre-download covers. Anything else (code, /data/, /ws) is never intercepted. */
const ASSET_PREFIXES = ['/assets/', '/fonts/'];
/** Marks the pre-download's own requests (engine.js must agree): never intercepted, the page stores those itself. */
const BYPASS_HEADER = 'x-sp-preload';

/** The cache the page pre-downloaded into; null = not verified yet = network only. @type {string | null} */
let cacheName = null;

self.addEventListener('install', (event) => {
  // A new worker takes over as soon as it is installed: the page is the only writer, so there is no half-built
  // cache state to protect (the alternative, waiting for every tab to close, would leave players on old code).
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // Only claim the open pages. Caches are deliberately left alone — see rule 1 in the header.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.t === 'sp-assets') {
    // engine.js verified the cache against the current manifest: from here on reads are served from it.
    if (typeof data.cache === 'string' && data.cache) cacheName = data.cache;
    event.source?.postMessage?.({ t: 'sp-assets-ack', cache: cacheName, version: data.version ?? null });
    return;
  }
  if (data.t === 'sp-assets-reset') {
    // The cache was cleared or no longer matches: back to network-only until the next verification.
    cacheName = null;
    event.source?.postMessage?.({ t: 'sp-assets-ack', cache: null, version: null });
  }
});

/** The cache key of a path: the path alone. `?v=…` (files.js `immutable`) addresses the same bytes, so keeping
 *  one entry per file avoids storing 900 MB twice when the game and the pre-download use different queries. */
function key(pathname) {
  return new Request(new URL(pathname, self.location.origin).href);
}

/** `/media/bgm/act1` → the cached `/assets/audio/bgm/act1.<ext>` (server/http/media.js resolves the same way). */
async function mediaAlias(cache, pathname) {
  const rest = pathname.slice(MEDIA_PREFIX.length);
  if (!rest || rest.endsWith('/')) return null;
  const given = (/(\.[a-z0-9]+)$/i.exec(rest)?.[1] || '').toLowerCase();
  const known = given && AUDIO_EXTS.includes(given);
  const stem = known ? rest.slice(0, -given.length) : rest;
  const order = known ? [given, ...AUDIO_EXTS.filter((e) => e !== given)] : AUDIO_EXTS;
  for (const ext of order) {
    // eslint-disable-next-line no-await-in-loop -- a handful of lookups, and the first hit wins
    const hit = await cache.match(key(`/assets/audio/${stem}${ext}`));
    if (hit) return hit;
  }
  return null;
}

async function respond(request, url, isMedia) {
  const cache = await caches.open(cacheName);
  const pathname = url.pathname;
  const hit = await cache.match(key(pathname));
  if (hit) return hit;
  if (isMedia) {
    const alias = await mediaAlias(cache, pathname);
    if (alias) return alias;
  }
  const res = await fetch(request);
  // Fill on the way through, but never store a `/media/…` alias (the real file is what the manifest lists) and
  // never store an error or an opaque response. A failed put must not fail the response the game is waiting for.
  if (!isMedia && res && res.status === 200 && res.type === 'basic' && !/\bno-store\b/i.test(res.headers.get('cache-control') || '')) {
    cache.put(key(pathname), res.clone()).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  // The pre-download's own requests (public/js/preload/engine.js): it writes the cache itself, so the worker must
  // stay out of the way or every file would be fetched and stored twice.
  if (request.headers.get(BYPASS_HEADER)) return;
  // A seek (audio) needs a real 206 from the server; a cached 200 cannot answer it.
  if (request.headers.has('range')) return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  const isMedia = url.pathname.startsWith(MEDIA_PREFIX);
  if (!isMedia && !ASSET_PREFIXES.some((p) => url.pathname.startsWith(p))) return;
  if (!cacheName) return; // not verified yet — leave the request completely alone
  event.respondWith(respond(request, url, isMedia));
});
