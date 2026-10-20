// render/assetFallback.js — 素材「CDN 优先 + 超时回源 HK」的统一入口（owner 2026-10-20：「特效加载的好慢」）。
//
// 背景：魔搭 CDN 对 spine / fx prefab / 贴图 / 地图包这类文件会偶发卡死 12~30 秒（实测 fx/index.json 12.3 秒）。
// 之前只给 spine 做了探针，特效和地图没有，于是「模型好了但特效很慢」。
//
// 做法：所有 `fetch` 走这里 ——
//   1) 先用原 URL 请求，超过 ORIGIN_TIMEOUT_MS 没结果就放弃；
//   2) 改成 `?o=1` 重试（HK 的 Caddy 认这个参数，从本地磁盘直出）；
//   3) 命中过一次回源的文件，本次会话后续直接走回源（不再等 6 秒）。
//
// 只处理 GET 类请求；`?o=1` 是纯查询参数，不会影响缓存命中（Caddy 那边带 immutable 头）。

export const ORIGIN_TIMEOUT_MS = 6000;
export const ORIGIN_RETRY_TIMEOUT_MS = 20000;

/** url → 'cdn' | 'origin'（这个会话里已经确认 CDN 慢的文件） */
const mode = new Map();

/** 把 URL 改成回源地址（保留原有 query）。 */
export function withOrigin(url) {
  if (typeof url !== 'string' || !url) return url;
  if (url.includes('o=1')) return url;
  return url + (url.includes('?') ? '&' : '?') + 'o=1';
}

/** 当前会话里这个 URL 应该用哪个地址（供 <img> 之类不能走 fetch 的地方）。 */
export function preferUrl(url) {
  return mode.get(url) === 'origin' ? withOrigin(url) : url;
}

async function rawFetch(url, init, timeoutMs) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => { try { ctl.abort(); } catch { /* ignore */ } }, timeoutMs) : 0;
  try {
    const opts = ctl ? { ...(init || {}), signal: ctl.signal } : init;
    return await fetch(url, opts);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * fetch 一个素材：CDN 慢就换回源。
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export async function assetFetch(url, init) {
  if (typeof url !== 'string' || !url || typeof fetch !== 'function') return fetch(url, init);
  // ★ 2026-10-20 第二次调整（owner：「还是好慢」）：改成【本地优先】——
  //   素材本来就在 HK 磁盘上，先取 CDN 等于给每个文件加一次跨境往返（实测每个 300~400ms，
  //   抽风时 6 秒）。现在先打本地，本地失败才回落到 CDN。
  if (mode.get(url) !== 'cdn') {
    try {
      const r = await rawFetch(withOrigin(url), init, ORIGIN_TIMEOUT_MS);
      if (r && r.ok) { mode.set(url, 'origin'); return r; }
      throw new Error('status ' + (r ? r.status : 'none'));
    } catch {
      mode.set(url, 'cdn');
    }
  }
  return rawFetch(url, init, ORIGIN_RETRY_TIMEOUT_MS);
}

/** 给 PIXI / 其它注入点用的 fetch 形状（同原生 fetch 签名）。 */
export const assetFetchBound = assetFetch;
