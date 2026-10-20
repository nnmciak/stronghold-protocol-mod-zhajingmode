// Operator loadout + ownership + 自选编队 state and server sync (DESIGN §16; 干员持有 — 0.2.0 补位; 自选编队 — 0.2.0 DIY).
//
// `loadoutStore` holds the per-browser loadout (`entries`, persisted in localStorage through store.js savePref), the
// per-browser not-owned list of the 干员持有 tab (`notOwned`, likewise), the 自选编队 picks (`diy`, likewise; with
// `diyKitted` = the operators the server lets a DIY slot field, from every `welcome`) and the overlay's screen state
// (open / origin / tab / selection / filters). `installLoadoutSync()` / `installOwnershipSync()` / `installDiySync()`
// (called once by main.js) keep the server's copies current — one sync engine (installPrefSync), three settings: after
// every `welcome` (new or resumed
// session — the server keeps them on the session and on the seat, so joining a room needs no resend) and after every
// edit (debounced; a pending edit goes out at once when the overlay closes), they send `room.loadout { entries }`
// (sanitised against the loaded data/chess.json: ui/loadoutModel.js sanitizeEntries — a stale entry is dropped, never
// the whole loadout), `room.ownership { notOwned }` (sent as stored: the server keeps the droppable chess and drops
// the rest, so no data is needed) and `room.diy { picks }` (sent as stored, structurally clean: the server keeps the
// legal picks). Replies: RATE → retried later; WRONG_PHASE / ROOM_STARTED → the running match keeps what it took (the
// loadout locks when INFO_CHECK ends; the ownership and the 自选 picks never change during a match) — stored for the
// next match, not an error for the player; anything else is logged. `sync` / `ownSync` / `diySync` ∈ 'idle' |
// 'pending' | 'sending' | 'synced' | 'locked' | 'error' are mirrored into the store for the screen's status line.

import { createStore, loadPref, savePref, store } from '../store.js';   // `store` = app store（room / match 在这里，loadoutStore 没有）
import { BANPICK_DIFFICULTIES } from '../../../shared/banPick.js';
import { data } from '../data.js';
import { LOADOUT_PREF, LOADOUT_ZJ_PREF, parseStored, parseStoredOps, parseStoredBans, toStored, toStoredBans, sanitizeEntries, sanitizeOps, setOps } from './loadoutModel.js';
import { cultivationCharIds } from '../../../shared/protocol.js';
import { OWNERSHIP_PREF, parseStoredOwnership, toStoredOwnership, cleanIds, sanitizeNotOwned } from './ownershipModel.js';
import { DIY_PREF, parseStoredDiy, toStoredDiy, cleanPicks, sanitizeDiyPicks } from './diyModel.js';
import { toast } from './toasts.js';
import { t, N_ } from '../../../shared/i18n.js';

export const SYNC_DEBOUNCE_MS = 500;
export const RETRY_MS = 1500;

function readStored() {
  try { return parseStored(loadPref(LOADOUT_PREF, null)); } catch { return {}; }
}

/** The stored 潜能 / 练度 (0.2.2) out of the same pref as the entries; an older pref has none = the defaults. */
function readStoredOps() {
  try { return parseStoredOps(loadPref(LOADOUT_PREF, null)); } catch { return {}; }
}

/** The stored 卡池预选 (the 100-seat variant's own feature) out of the same pref; an older pref has none. */
function readStoredBans() {
  try { return parseStoredBans(loadPref(LOADOUT_PREF, null)); } catch { return null; }
}

// ---- 调配模式: 普通 / 炸惊 (0.3.0) ---------------------------------------------------------------------------------
// 炸惊模拟 (difficulty ZHAJING, shared/constants.js DIFFICULTIES) is a difficulty with 独创数值与新卫戍特质, so the 干员调配 screen edits a
// SECOND set of entries + 潜能/练度 when its 炸惊 switch is on. That set lives in `LOADOUT_ZJ_PREF` and in the store's
// `zjEntries` / `zjOps`. The mode itself is pure UI state (`mode`), never synced and never part of an export.
//
// Which set the ROOM fields is decided at send time by the CURRENT room's difficulty (owner report 2026-10-11
// 「目前干员调配的技能没应用到游戏内」): a 炸惊 room (difficulty ZHAJING, or a `*zhajing*` modeId) gets the 炸惊 set,
// every other room the ordinary one — so the skills tuned on the 炸惊 tab finally reach a 炸惊 match. Before the room is
// known (lobby, no `room.state`/match yet) the screen's own 调配模式 decides, which is the set the player is looking at.
// installLoadoutSync therefore watches BOTH sets (an edit to either one must go out) and `prepare` picks between them
// (syncSetOf); the 卡池预选 next to it is keyed per difficulty the same way (`bans.byDifficulty`).

/** The ordinary 调配: what a non-炸惊 room fields, synced as `room.loadout`. */
export const MODE_NORMAL = 'normal';
/** 炸惊模式: its own set, fielded by a 炸惊 room. */
export const MODE_ZJ = 'zhajing';

function readStoredZj() {
  try { return parseStored(loadPref(LOADOUT_ZJ_PREF, null)); } catch { return {}; }
}
function readStoredZjOps() {
  try { return parseStoredOps(loadPref(LOADOUT_ZJ_PREF, null)); } catch { return {}; }
}

/** The entries the 干员调配 screen is editing right now（炸惊档时是 zjEntries；档位判定见 isZjNow）。 */
export const activeEntriesOf = (st) => (isZjNow(st) ? (st && st.zjEntries) || {} : (st && st.entries) || {});
/** The 潜能 / 练度 of the set being edited (keyed by charId, like the ordinary set)。 */
export const activeOpsOf = (st) => (isZjNow(st) ? (st && st.zjOps) || {} : (st && st.ops) || {});

const isZjText = (v) => /zhajing/i.test(String(v || ''));

/**
 * 真实房间的 difficulty / modeId。★ 房间信息在 app store（store.js 的 room / match.public），**不在** loadoutStore 里：
 * createStore 只装了调配相关的字段（entries / ops / bans / notOwned / diy / mode / zjEntries / zjOps …），
 * 所以原来读 `st.match` / `st.room` 的这一层是**死代码**，永远回落到 `st.mode` —— 这正是
 * 「干员调配改了技能，进局内不生效」（用户 2026-10-11）的根因：界面在普通档编辑、发出去的也是普通那套
 * （chess_char_* 键），而炸惊房间要的是炸惊那套（chess_zj_* 键）。传入的 `st` 自带 match / room 时仍然优先，
 * 保持原契约（注入的测试目标）。
 * @param {any} st loadoutStore state @param {any} [app] app store state（省略时读 store.get()）
 * @returns {{ difficulty: any, modeId: any }}
 */
function roomOf(st, app) {
  const a = app === undefined ? store.get() : app;
  const pick = (src, key) => (src && src.match && src.match.public && src.match.public[key]) ?? (src && src.room && src.room[key]) ?? null;
  return { difficulty: pick(st, 'difficulty') ?? pick(a, 'difficulty'), modeId: pick(st, 'modeId') ?? pick(a, 'modeId') };
}

/**
 * 这一局该发哪一套：按**当前房间**的难度（炸惊 → 炸惊那套），房间还没信息（大厅）时按界面当前的调配模式。
 * @param {any} st loadoutStore state @param {any} [app] app store state（省略时读 store.get()）
 * @returns {'normal'|'zhajing'}
 */
export function syncModeOf(st, app) {
  const { difficulty: diff, modeId } = roomOf(st, app);
  if (diff || modeId) return isZjText(diff) || isZjText(modeId) ? MODE_ZJ : MODE_NORMAL;
  return st && st.mode === MODE_ZJ ? MODE_ZJ : MODE_NORMAL;
}

/**
 * 现在生效的是不是炸惊档：**写入（setEntries / setOpsMap）、显示（界面与页签）与对外同步（syncSetOf）唯一的判定**，
 * 避免出现「界面看着是普通档、实际发的是炸惊那套」这种悄悄改到另一档的情况。
 * @param {any} st loadoutStore state（省略时读 loadoutStore.get()） @param {any} [app] app store state
 * @returns {boolean}
 */
export function isZjNow(st, app) {
  return syncModeOf(st === undefined ? loadoutStore.get() : st, app) === MODE_ZJ;
}

/** 现在要发出去的这一套（entries / ops），`syncModeOf` 决定是普通还是炸惊那套。 */
/**
 * \u623f\u95f4\u5f53\u524d\u8be5\u770b\u54ea\u4e00\u4efd\u5361\u6c60\u9884\u9009\uff08\u754c\u9762\u9875\u7b7e\u4e5f\u8981\u8ddf\u7740\u5b83\uff09\uff1a
 * \u623f\u95f4\u9690\u85cf\u65f6\u7528\u754c\u9762\u81ea\u5df1\u9009\u7684\u9875\u7b7e\uff0c\u623f\u95f4\u5b58\u5728\u65f6\u5f3a\u5236\u7528\u623f\u95f4\u96be\u5ea6\uff08\u7528\u6237 2026-10-11
 * \u53cd\u9988\uff1a\u7ec8\u6781\u623f\u91cc\u754c\u9762\u663e\u793a\u7684 ban \u4f4d\u4e0e\u5b9e\u9645\u4e0d\u7b26\uff09\u3002
 * @param {any} st @param {string|null} fallback \u623f\u95f4\u9690\u85cf\u65f6\u7528\u7684\u9875\u7b7e
 * @param {any} [app] app store state（省略时读 store.get()）
 * @returns {string}
 */
export function roomBanDiff(st, fallback = null, app) {
  // ★ 2026-10-15（用户：「卡池预选的炸惊确认完工一下」）：这里原来硬编码了 4 个难度，
  //   炸惊不在表里 ⇒ 在炸惊房间里 `roomOf(st).difficulty === 'ZHAJING'` 匹配不上，
  //   页签会【回落到 NORMAL】—— 玩家看到的是「险境」的清单、改的也是那一份，
  //   炸惊自己的 2+2 个 ban 位根本编辑不到。改用 shared/banPick.js 的权威表，
  //   以后再加难度不用动这里。
  const list = BANPICK_DIFFICULTIES;
  const d = roomOf(st, app).difficulty;   // 真实房间的难度（房间不存在时由 fallback 决定，见上面的说明）
  if (list.includes(d)) return d;
  return list.includes(fallback) ? fallback : 'NORMAL';
}

export function syncSetOf(st) {
  const zj = syncModeOf(st) === MODE_ZJ;
  return zj
    ? { mode: MODE_ZJ, entries: (st && st.zjEntries) || {}, ops: (st && st.zjOps) || {} }
    : { mode: MODE_NORMAL, entries: (st && st.entries) || {}, ops: (st && st.ops) || {} };
}
/** Switch the 干员调配 mode. Pure UI state: it changes which set the screen edits, nothing else. */
export function setMode(mode) {
  const next = mode === MODE_ZJ ? MODE_ZJ : MODE_NORMAL;
  if (loadoutStore.get().mode !== next) loadoutStore.set({ mode: next });
}

function readStoredOwnership() {
  try { return parseStoredOwnership(loadPref(OWNERSHIP_PREF, null)); } catch { return []; }
}
function readStoredDiy() {
  try { return parseStoredDiy(loadPref(DIY_PREF, null)); } catch { return {}; }
}

/** Loadout + ownership + screen state (separate from the app store: it must survive room / match resets). */
export const loadoutStore = createStore({
  entries: readStored(),
  ops: readStoredOps(), // 潜能 / 练度 (0.2.2): { [charId]: { potential?, cultivate? } } ({} = every operator at the defaults)
  bans: readStoredBans(), // 卡池预选: the shared/banPick.js profile, or null = no picks (the match's random draw)
  bansDiff: 'NORMAL',  // 卡池预选: which difficulty's list the picker is editing (UI only, never synced)
  notOwned: readStoredOwnership(), // 干员持有: base chess ids marked 未持有 (sorted; [] = every operator owned)
  diy: readStoredDiy(), // 自选编队: { [slotBaseId]: { charId, skillIndex?, uniEquipId? } } ({} = every slot empty)
  diyKitted: null,     // the operators a DIY slot may field (welcome.diyKitted; null before the first welcome)
  mode: MODE_NORMAL,   // 干员调配: which set the screen edits ('normal' | 'zhajing'; UI only, never synced)
  zjEntries: readStoredZj(),   // 炸惊模式: its own entries, in a pref of its own (never synced — see the block above)
  zjOps: readStoredZjOps(),    // 炸惊模式: its own 潜能 / 练度
  open: false,
  from: null,          // 'lobby' | 'room' | 'briefing'
  tab: 'loadout',      // 'loadout' (干员调配) | 'ownership' (干员持有) | 'diy' (自选编队)
  sel: null,           // selected base chess id
  filters: { tier: null, prof: null, bond: null, query: '', changedOnly: false },
  sync: 'idle',
  ownSync: 'idle',
  diySync: 'idle',
});

/**
 * Replace the entries of the mode being edited (persisted at once). On the ordinary mode the sync picks the change up; on
 * 炸惊模式 the write goes to that mode's own pref and store field, which the sync does not watch (see 调配模式 above).
 * @param {Record<string, any>} entries
 */
export function setEntries(entries) {
  const next = entries && typeof entries === 'object' ? entries : {};
  const st = loadoutStore.get();
  if (isZjNow(st)) {   // 房间难度优先：和界面 / 同步同一判定（见 isZjNow）
    try { savePref(LOADOUT_ZJ_PREF, toStored(next, st.zjOps || {})); } catch { /* private mode: the session keeps it */ }
    loadoutStore.set({ zjEntries: next });
    return;
  }
  savePref(LOADOUT_PREF, toStoredBans(next, st.ops || {}, st.bans || null));
  loadoutStore.set({ entries: next });
}

/**
 * 直接替换**炸惊档**的 entries / 潜能练度，与当前房间难度无关（导出导入用：导入一份含 `zhajing` 的配置，
 * 不该因为玩家此刻在普通房就写进普通档）。
 * @param {Record<string, any>} entries
 * @param {Record<string, any>|null} opsMap
 */
export function applyZjConfig(entries, opsMap = null) {
  const next = entries && typeof entries === 'object' ? entries : {};
  const ops = opsMap && typeof opsMap === 'object' ? opsMap : {};
  try { savePref(LOADOUT_ZJ_PREF, toStored(next, ops)); } catch { /* private mode: the session keeps it */ }
  loadoutStore.set(opsMap ? { zjEntries: next, zjOps: ops } : { zjEntries: next });
}

/**
 * Replace the stored 潜能 / 练度 map of the mode being edited (0.2.2; persisted at once, the sync picks the change up). Both
 * parts of a mode live in the one record (entries + ops), so writing either one has to carry the other along — and the
 * ordinary record carries the 卡池预选 as well.
 * @param {Record<string, { potential?: number, cultivate?: number }>} ops
 */
export function setOpsMap(ops) {
  const next = ops && typeof ops === 'object' ? ops : {};
  const st = loadoutStore.get();
  if (isZjNow(st)) {   // 同上：setOpsMap 写哪一套和 setEntries 完全一致
    try { savePref(LOADOUT_ZJ_PREF, toStored(st.zjEntries || {}, next)); } catch { /* private mode: the session keeps it */ }
    loadoutStore.set({ zjOps: next });
    return;
  }
  savePref(LOADOUT_PREF, toStoredBans(st.entries || {}, next, st.bans || null));
  loadoutStore.set({ ops: next });
}

/** Set one operator's 潜能 / 练度 of the mode being edited (a patch; an entry back at the defaults is removed) — 0.2.2. */
export function setOperatorOps(charId, patch) {
  setOpsMap(setOps(activeOpsOf(loadoutStore.get()), charId, patch));
}

/**
 * Replace the stored 卡池预选 profile (the 100-seat variant's own feature). All three parts live in the one
 * `sp.pref.loadout` record, so writing any one of them has to carry the others along.
 * @param {any} bans shared/banPick.js profile
 */
export function setBans(bans) {
  const st = loadoutStore.get();
  savePref(LOADOUT_PREF, toStoredBans(st.entries || {}, st.ops || {}, bans || null));
  loadoutStore.set({ bans: bans || null });
}

/**
 * Apply a parsed entry map (an imported preset). Sanitised against the loaded data first, then persisted and synced
 * like any ordinary edit — so a preset from another build never sends the server an entry it would refuse. An import
 * that keeps nothing (every chess unknown, or every choice already the default) changes NOTHING: wiping the current
 * loadout over it would be a loss the player never asked for.
 * @param {Record<string, any>} entries `parseImport(...).entries`
 * @param {(id: string) => any} lookup chess lookup
 * @returns {{ applied: number, dropped: number }} entries kept / entries that were not imported
 */
export function applyLoadoutEntries(entries, lookup) {
  const asked = Object.keys(entries || {}).length;
  const clean = sanitizeEntries(entries, lookup);
  const applied = Object.keys(clean).length;
  if (applied) setEntries(clean);
  return { applied, dropped: Math.max(0, asked - applied) };
}

/** Replace the stored not-owned list (干员持有; persisted at once, the sync picks the change up). */
export function setNotOwned(list) {
  const next = cleanIds(list);
  savePref(OWNERSHIP_PREF, toStoredOwnership(next));
  loadoutStore.set({ notOwned: next });
}

/**
 * Apply an imported not-owned list (parseOwnershipImport(...).notOwned), sanitised against the loaded data (droppable
 * chess only), persisted and synced like an edit. An empty list is a valid import (= every operator owned).
 * @param {string[]} list @param {(id: string) => any} lookup chess lookup
 * @returns {{ applied: number, dropped: number }}
 */
export function applyOwnershipImport(list, lookup) {
  const asked = cleanIds(list).length;
  const clean = sanitizeNotOwned(list, lookup);
  setNotOwned(clean);
  return { applied: clean.length, dropped: Math.max(0, asked - clean.length) };
}

/** Replace the stored 自选编队 picks (persisted at once, the sync picks the change up). */
export function setDiyPicks(picks) {
  const next = cleanPicks(picks);
  try { savePref(DIY_PREF, toStoredDiy(next)); } catch { /* private mode: the session keeps it */ }
  loadoutStore.set({ diy: next });
}

/**
 * Apply an imported roster (parseDiyImport(...).picks), sanitised against the loaded data and the kit list (the picks
 * the server would keep), persisted and synced like an edit. An empty roster is a valid import (= every slot empty).
 * @param {Record<string, any>} picks @param {any} data `{ chess, backups }` @param {Iterable<string>|null} kitted
 * @returns {{ applied: number, dropped: number }}
 */
export function applyDiyImport(picks, data, kitted) {
  const asked = Object.keys(cleanPicks(picks)).length;
  const clean = sanitizeDiyPicks(picks, data, kitted);
  setDiyPicks(clean);
  const applied = Object.keys(clean).length;
  return { applied, dropped: Math.max(0, asked - applied) };
}

/**
 * Open the 干员调配 overlay. @param {'lobby'|'room'|'briefing'} from @param {string|null} [sel]
 * @param {'loadout'|'ownership'|'diy'|null} [tab] the tab to show (default: the last one)
 */
export function openLoadout(from = 'lobby', sel = null, tab = null) {
  data.load('chess');
  data.load('bonds');
  data.load('assets');
  data.load('local');
  data.load('backups');
  loadoutStore.set({ open: true, from, ...(sel ? { sel } : {}), ...(tab === 'loadout' || tab === 'ownership' || tab === 'diy' ? { tab } : {}) });
}
export const closeLoadout = () => loadoutStore.set({ open: false });

/**
 * One setting kept in sync with the server (see the header): `key` = the store field, `stateKey` = its sync state field,
 * `msgType` / `field` = the C2S message, `prepare()` → the payload to send (may await data; null = the data is missing:
 * nothing is sent, state 'error'), `lockedText` = what a refused edit tells the player.
 */
function installPrefSync({ net, timers, target, notify, key, keys = null, stateKey, msgType, field, fields = null, prepare, lockedText, tag, onReply = null }) {
  const T = timers || { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  // `keys` / `fields`: a message that carries SEVERAL parts of one pref (`room.loadout` sends `entries` + `ops`, 0.2.2).
  // `prepare` then resolves to the whole payload object and every listed key is watched for edits — sending only one
  // part would clear the other, because the server reads the parts of every frame it receives.
  const watchKeys = Array.isArray(keys) && keys.length ? keys : [key];
  const outFields = Array.isArray(fields) && fields.length ? fields : [field];
  const multi = outFields.length > 1;
  const changedIn = (a, b) => watchKeys.some((k) => a[k] !== b[k]);
  // (`lockedText` is a msgid: the toast is translated when it shows — docs/I18N.md)
  const tell = notify || ((text) => toast(t(text), 'warn'));
  let timer = null;
  let seq = 0;            // requests sent (the reply of an older one never overrides a newer one's state)
  let pendingJson = null; // JSON of the newest request still awaiting its reply
  let lastSent = null;    // JSON of the last payload the server accepted (on this session)
  let edited = false;     // an edit is waiting to be sent (a lock refusal is then worth telling the player)
  let disposed = false;

  const setState = (sync) => { if (target.get()[stateKey] !== sync) target.set({ [stateKey]: sync }); };

  const schedule = (ms = SYNC_DEBOUNCE_MS) => {
    if (disposed) return;
    T.clearTimeout(timer);
    setState('pending');
    timer = T.setTimeout(() => { timer = null; void flush(); }, ms);
  };

  // Review fix: a send is never held back behind one still in flight. The socket is ordered and the server applies
  // the frames in order, so the newest payload always wins; holding the edit until the previous reply arrived let a
  // click right after closing the overlay (准备就绪 → INFO_CHECK ends) overtake it, and the edit silently missed the match.
  async function flush() {
    if (disposed) return;
    if (net.status !== 'online') { setState('idle'); return; } // the next welcome resends
    try {
      const payload = await prepare();
      if (disposed) return;
      // never sanitise against missing data: every entry would be dropped and the server's copy cleared
      if (payload == null) { setState('error'); return; }
      const json = JSON.stringify(payload);
      if (json === pendingJson) return; // the same content is already on its way
      if (json === lastSent && pendingJson == null) { edited = false; setState('synced'); return; }
      const my = ++seq;
      const wasEdit = edited;
      edited = false;
      pendingJson = json;
      setState('sending');
      try {
        const reply = await net.request(msgType, multi ? payload : { [field]: payload });
        if (my !== seq) return;
        pendingJson = null;
        lastSent = json;
        setState('synced');
        // ★ 2026-10-18 跨服配装：服务端可能在回包里带回"按玩家名记住的那一份"（换节点/清缓存后本机是空的）。
        //   只在这条消息支持回填时处理，且由调用方自己判断"本地确实是空的"才写回。
        if (onReply) { try { onReply(reply); } catch { /* 回填失败不影响同步本身 */ } }
      } catch (err) {
        if (my !== seq) return;
        pendingJson = null;
        const code = err && err.code;
        if (code === 'WRONG_PHASE' || code === 'ROOM_STARTED') {
          // the server stored it for the next match; the running one keeps what it took
          lastSent = json;
          setState('locked');
          if (wasEdit) tell(lockedText);
        } else if (code === 'RATE' || code === 'TIMEOUT' || code === 'OFFLINE') { edited = edited || wasEdit; schedule(RETRY_MS); }
        else { console.warn(`[${tag}] ${msgType} refused`, code, err && err.detail); setState('error'); }
      }
    } catch (e) {
      console.warn(`[${tag}] sync failed`, e);
      setState('error');
    }
  }

  const offWelcome = net.on('welcome', () => { lastSent = null; pendingJson = null; seq++; schedule(50); });
  const offStore = target.subscribe((s, prev) => {
    if (changedIn(s, prev)) { edited = true; schedule(); }
    // closing the overlay sends a pending edit at once (review fix): the player's next click — 准备就绪 in the solo
    // briefing, 开始模拟 in the room — must not overtake the debounced message (the match locks its loadout when
    // INFO_CHECK ends, so a late edit would silently only apply to the next match). Same socket ⇒ ordered.
    if (prev.open && !s.open && timer != null) { T.clearTimeout(timer); timer = null; void flush(); }
  });
  // a match leaving INFO_CHECK locks the loadout; a new match (the room back in LOBBY / a new INFO_CHECK) accepts it again
  const offRoom = net.on('room.state', (msg) => { if (msg && !msg.inMatch && target.get()[stateKey] === 'locked') { lastSent = null; schedule(); } });

  return {
    flush,
    dispose() {
      disposed = true;
      T.clearTimeout(timer);
      offWelcome?.();
      offStore?.();
      offRoom?.();
    },
  };
}

/**
 * Wire the loadout sync once. Dependencies are injectable for tests.
 * @param {{ net: any, getChessReady?: () => Promise<any>, lookupChess?: (id: string) => any,
 *   timers?: { setTimeout: Function, clearTimeout: Function }, target?: ReturnType<typeof createStore> }} deps
 * @returns {{ flush: () => Promise<void>, dispose: () => void }}
 */
export function installLoadoutSync({ net, getChessReady, lookupChess, timers, target = loadoutStore, notify } = {}) {
  const ready = getChessReady || (() => data.load('chess'));
  const lookup = lookupChess || ((id) => data.lookup('chess', id));
  return installPrefSync({
    // one message carries all three parts (潜能 / 练度 and 卡池预选): `room.loadout { entries, ops, bans }` — the
    // server reads every field of each frame, so sending them separately would clear the others. Both 调配 sets are
    // watched: the one that goes out is picked per the current room's difficulty (syncSetOf).
    net, timers, target, notify, key: 'entries', keys: ['entries', 'ops', 'bans', 'zjEntries', 'zjOps'], stateKey: 'sync',
    msgType: 'room.loadout', field: 'entries', fields: ['entries', 'ops', 'bans'], tag: 'loadout',
    lockedText: N_('本局的干员调配已锁定，修改将在下一局生效'),
    // ★ 2026-10-18 跨服配装：本机（这个 origin 的 localStorage）没有配装时，收下服务端按玩家名记住的那一份。
    //   只认"本地确实为空"的情况，绝不会覆盖玩家本机的选择。
    //   炸惊档（zhajing）现在也同步：回包带 `mode`，只有和当前这一档一致时才写回，写入位置由 setEntries 自己判
    //   （isZjNow → zjEntries，否则 entries）。
    onReply(msg) {
      try {
        // 回执数据在 `payload` 里（net.js 把处理器给的 payload 拼进 ok 回包）
        const pl = msg && msg.payload && typeof msg.payload === 'object' ? msg.payload : msg;
        if (!pl || !pl.entries || typeof pl.entries !== 'object') return;
        const st = target.get();
        if (!st) return;
        const cur = syncSetOf(st);
        if (pl.mode && cur.mode !== pl.mode) return;          // 回包是另一档的，丢掉
        if (Object.keys(cur.entries || {}).length) return;    // 本机已有：以本机为准
        if (!Object.keys(pl.entries).length) return;          // 服务端也没有
        setEntries(pl.entries);
      } catch { /* 回填失败不影响同步本身 */ }
    },
    async prepare() {
      const st = target.get();
      const set = syncSetOf(st);
      const current = set.entries;
      const ops = set.ops || {};
      const bans = st.bans || null;
      // nothing to sanitise at all: a player who never opened 干员调配 does not download chess.json just for this
      if ((!current || Object.keys(current).length === 0) && Object.keys(ops).length === 0
        && !(bans && Object.keys(bans.byDifficulty || {}).length)) {
        return { mode: set.mode, entries: {}, ops: {}, bans: null };
      }
      const loaded = await ready();
      if (loaded == null) return null;
      // ops may only name an operator of the roster / 自选 owned pool (shared/protocol.js cultivationCharIds); the same
      // data the server checks against. `cultivationCharIds` takes the chess map keyed by chess id.
      let allowed = null;
      try {
        const map = {};
        for (const c of data.list('chess')) if (c && c.chessId) map[c.chessId] = c;
        allowed = cultivationCharIds(map, data.get('backups') || null);
      } catch { allowed = null; }
      // the 卡池预选 goes as stored: the server cleans it against the real bond table (unknown ids / a 小盟约 marked ❤
      // are refused there), so a stale pick can never poison the message
      return {
        // ★ 2026-10-18：带上这是哪一档（normal / zhajing）—— 服务端要按档位各记一份
        mode: set.mode,
        entries: sanitizeEntries(current, lookup),
        ops: allowed ? sanitizeOps(ops, (id) => allowed.has(id)) : {},
        bans: bans && bans.byDifficulty ? bans : null,
      };
    },
  });
}

/**
 * Wire the 干员持有 sync once (0.2.0 补位): `room.ownership { notOwned }` after every welcome and edit. The list goes as
 * stored (structurally clean); the server keeps its droppable chess. During a match the server stores it for the next
 * one (ROOM_STARTED → 'locked'): the setting is out of match.
 * @param {{ net: any, timers?: { setTimeout: Function, clearTimeout: Function }, target?: ReturnType<typeof createStore>,
 *   notify?: (text: string) => void }} deps
 */
export function installOwnershipSync({ net, timers, target = loadoutStore, notify } = {}) {
  return installPrefSync({
    net, timers, target, notify, key: 'notOwned', stateKey: 'ownSync', msgType: 'room.ownership', field: 'notOwned', tag: 'ownership',
    lockedText: N_('干员持有是局外设置，修改将在下一局生效'),
    prepare: async () => cleanIds(target.get().notOwned),
  });
}

/**
 * Wire the 自选编队 sync once (0.2.0 DIY): `room.diy { picks }` after every welcome and edit. The picks go as stored
 * (structurally clean); the server keeps the legal ones. During a match the server stores them for the next one
 * (ROOM_STARTED → 'locked'): the setting is out of match. Every `welcome` also brings the operators a DIY slot may field
 * (`diyKitted`, the picker's list).
 * @param {{ net: any, timers?: { setTimeout: Function, clearTimeout: Function }, target?: ReturnType<typeof createStore>,
 *   notify?: (text: string) => void }} deps
 */
export function installDiySync({ net, timers, target = loadoutStore, notify } = {}) {
  const offKit = net.on('welcome', (msg) => {
    const list = msg && Array.isArray(msg.diyKitted) ? msg.diyKitted.filter((x) => typeof x === 'string') : null;
    target.set({ diyKitted: list });
  });
  const sync = installPrefSync({
    net, timers, target, notify, key: 'diy', stateKey: 'diySync', msgType: 'room.diy', field: 'picks', tag: 'diy',
    lockedText: N_('自选编队是局外设置，修改将在下一局生效'),
    prepare: async () => cleanPicks(target.get().diy),
  });
  return { flush: sync.flush, dispose() { offKit?.(); sync.dispose(); } };
}
