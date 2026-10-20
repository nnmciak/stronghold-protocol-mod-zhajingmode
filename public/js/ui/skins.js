// 干员皮肤：客户端状态与同步 (docs/SKINS.md).
//
// Two different things live here, and keeping them apart is what makes 「按需安装」 work:
//
//   * the CATALOGUE (data/skins.json) — every skin the project knows about, installed or not: ids, names, series.
//     It carries no URLs, because a skin that is not installed has no files to point at.
//   * what is INSTALLED (data/assets.json → chars[charId].skins) — the skins whose models are actually on this
//     server. `availableSkins()` marks which is which, and the picker greys out (or offers to install) the rest.
//
// The choice itself is a plain `{ [chessId]: skinId }` map, persisted per browser in localStorage and mirrored to
// the server through `room.skins` — the same shape and the same wiring as the operator loadout (ui/loadoutSync.js),
// except that this one is PUBLIC: the server puts it in `Match.publicView().players[]`, which is how a teammate
// sees your skin.

import { createStore, loadPref, savePref } from '../store.js';
import { data } from '../data.js';

export const SKINS_PREF = 'skins';
export const SYNC_DEBOUNCE_MS = 500;
export const RETRY_MS = 1500;

function readStored() {
  const raw = loadPref(SKINS_PREF, null);
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [chessId, skinId] of Object.entries(raw)) {
      if (typeof chessId === 'string' && typeof skinId === 'string' && skinId) out[chessId] = skinId;
    }
  }
  return out;
}

/**
 * The chosen skins (per browser), the sync state, and the skin currently being installed — kept apart from the
 * app store for the same reason the loadout is.
 */
export const skinsStore = createStore({ entries: readStored(), sync: 'idle' });

/** Replace the whole selection (persisted at once; the sync picks the change up). */
export function setSkins(entries) {
  const next = {};
  for (const [chessId, skinId] of Object.entries(entries && typeof entries === 'object' ? entries : {})) {
    if (typeof skinId === 'string' && skinId) next[chessId] = skinId;
  }
  savePref(SKINS_PREF, next);
  skinsStore.set({ entries: next });
}

/** Choose a skin for one operator. */
export function setSkin(chessId, skinId) {
  setSkins({ ...skinsStore.get().entries, [chessId]: skinId });
}

/** Drop one operator's choice (it goes back to its default model). */
export function clearSkin(chessId) {
  const next = { ...skinsStore.get().entries };
  delete next[chessId];
  setSkins(next);
}

/**
 * ★ 2026-10-17（用户：「精锐这四个人…基础是皮肤…精锐还是原皮」）：
 * 一个棋子的**普通形态** id —— 精锐记录（`_b`）归一到它的基础（`_a`）。
 *
 * 为什么需要：皮肤选择是**按棋子 id** 存的，而换装页只会写基础 id（`chess_zj_60_5_a`）与 charId
 * （`char_4217_makoto`）—— 精锐 id（`chess_zj_60_5_b`）服务端**正确拒绝**（`setSkins` 的 isGolden 判定，
 * 因为精锐与基础共用同一个模型）。所以任何**直接拿精锐 id 去查**的地方都会落空，
 * 而查 `_b` 时唯一正确的答案就是它基础形态的那件皮肤。
 *
 * 与 `assets.js` 的 `baseCharId` 同一个形态（去尾缀），只是这里去的是棋子 id 的 `_a`/`_b`。
 * 三个客户端解析点（app.js pieceInfo / app/info.js / 各处直接调用）都经过 `skinFor`，所以在这里兜住即可。
 */
export const normalizeBaseId = (id) => {
  const s = typeof id === 'string' ? id : '';
  if (!s) return null;
  if (/_[ab]$/.test(s)) return s.slice(0, -2) + '_a';
  return s;
};

/**
 * The skin this browser picked for an operator, or null.
 *
 * 先精确查（保持原有语义与既有数据不变），未命中再按 `normalizeBaseId` 归一再查一次 ——
 * 于是「用精锐 id 查」也能拿到基础形态存的皮肤，而不是静默回落到原皮。
 * @param {string} chessId
 */
export const skinFor = (chessId) => {
  const entries = skinsStore.get().entries;
  const exact = entries[chessId];
  if (exact) return exact;
  const base = normalizeBaseId(chessId);
  if (base && base !== chessId && entries[base]) return entries[base];
  return null;
};

/**
 * Every skin of an operator (built-in full set).
 *
 * Takes the OPERATOR id (`char_498_inside`), not the chess id (`chess_char_1_01_a`): both data/skins.json and
 * data/assets.json are grouped per operator, while a skin *choice* is stored per chess — see ui/skinPicker.js.
 * @param {string} charId
 * @returns {{ id: string, name: string, group: string, installed: boolean }[]}
 */
export function availableSkins(charId) {
  const list = data.get('skins')?.chars?.[charId];
  if (!Array.isArray(list)) return [];
  return list.map((s) => ({ id: s.id, name: s.name, group: s.group || '', installed: true }));
}

/** Whether this install has the files for a skin (all 174 skins are built-in). @param {string} charId */
export function isInstalled(charId, skinId) {
  return true;
}

/** Load what the picker needs (the catalogue, and the manifest that says what is installed). */
export function loadSkinData() {
  data.load('skins').catch(() => {});
  data.load('assets').catch(() => {});
}

/**
 * Keep the server's copy of this browser's skins current.
 *
 * Mirrors installLoadoutSync, minus the sanitising: the loadout has to be checked against data/chess.json before
 * it is sent (a stale entry would be dropped by the server), whereas a skinId needs no lookup to be sent — the
 * server keeps the entries whose chess it recognises and drops the rest, and an unknown skinId is harmless.
 * @param {{ net: any, timers?: { setTimeout: Function, clearTimeout: Function } }} deps
 * @returns {{ flush: () => Promise<void>, dispose: () => void }}
 */
export function installSkinsSync({ net, timers } = {}) {
  const T = timers || { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  let timer = null;
  let seq = 0;
  let pendingJson = null;
  let lastSent = null;
  let disposed = false;

  const setState = (sync) => { if (skinsStore.get().sync !== sync) skinsStore.set({ sync }); };
  const schedule = (ms = SYNC_DEBOUNCE_MS) => {
    if (disposed) return;
    T.clearTimeout(timer);
    setState('pending');
    timer = T.setTimeout(() => { timer = null; void flush(); }, ms);
  };

  async function flush() {
    if (disposed || net.status !== 'online') { setState('idle'); return; }
    try {
      const skins = skinsStore.get().entries;
      const json = JSON.stringify(skins);
      if (json === pendingJson) return;
      if (json === lastSent && pendingJson == null) { setState('synced'); return; }
      const my = ++seq;
      pendingJson = json;
      setState('sending');
      try {
        const res = await net.request('room.skins', { skins });
        if (my !== seq) return;
        // ★ 2026-10-13（用户）：服务端会回传【合并后】的记录 —— 本机为空（换了访问地址/浏览器）时它带回
        //   按玩家名记住的那份，这里直接采用，于是不用重新一套一套点回来。
        const back = res && typeof res === 'object' ? res.skins : null;
        if (back && typeof back === 'object' && !Array.isArray(back)
          && !Object.keys(skinsStore.get().entries).length && Object.keys(back).length) {
          savePref(SKINS_PREF, back);
          skinsStore.set({ entries: back });
        }
        pendingJson = null;
        lastSent = json;
        setState('synced');
      } catch (err) {
        if (my !== seq) return;
        pendingJson = null;
        const code = err && err.code;
        if (code === 'RATE' || code === 'TIMEOUT' || code === 'OFFLINE') { schedule(RETRY_MS); return; }
        console.warn('[skins] room.skins refused', code, err && err.detail);
        setState('error');
      }
    } catch (e) {
      console.warn('[skins] sync failed', e);
      setState('error');
    }
  }

  const offWelcome = net.on('welcome', () => { lastSent = null; pendingJson = null; seq++; schedule(50); });
  const offStore = skinsStore.subscribe((s, prev) => { if (s.entries !== prev.entries) schedule(); });

  return {
    flush,
    dispose() {
      disposed = true;
      T.clearTimeout(timer);
      offWelcome?.();
      offStore?.();
    },
  };
}
