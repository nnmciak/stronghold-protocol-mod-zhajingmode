// Client entry: boot (fonts, identity, socket), net → store wiring, router, global overlays.
//
// Router (derived from the store, no URL routes):
//   not entered            → Title
//   m.public.phase ≠ LOBBY → Game (screens/game.js: briefing / band draft / match / result by phase)
//   room.inMatch           → Game (match starting, m.public on its way)
//   in a room              → Room
//   otherwise              → Lobby
// Deep link `?room=CODE`: remembered at boot, auto-joined once the player has entered and the
// session is online (after a short grace period in case the server restores a room on resume).
// Reloading a tab that already passed the title re-enters automatically (sessionStorage flag) and
// resumes the server session with the saved token; stale room/match state is dropped if the
// server does not re-push it within RESTORE_GRACE_MS after `welcome`. Boot waits for
// `identity.init()` (which token this tab may use without stealing another live tab's session)
// before the first connect; a page restored from the back/forward cache reloads.
// A `welcome` with a NEW playerId (the server restarted / the session expired) while a room or match was on screen:
// toast 「服务器会话已重置，上一局模拟已结束」 (store.js sessionResetNotice) and return to the lobby with nothing stale.
//
// Shared modules are imported relatively ('../../shared/…' resolves to /shared/… in the browser).
// Multi-device support (ui/device.js + css/devices.css): feature classes on <html>, no page zoom, safe areas, rotation
// re-layout; ui/compat.js polyfills are imported before anything else.
// 干员调配 (DESIGN §16): an overlay over any route (<LoadoutHost/>, opened from lobby / room / briefing); its loadout is
// kept in sync with the server by installLoadoutSync (room.loadout after every welcome and edit), its 干员持有 tab's
// not-owned list (0.2.0 补位) by installOwnershipSync (room.ownership, likewise), the 自选编队 picks (0.2.0 DIY) by
// installDiySync (room.diy, likewise; it also keeps welcome.diyKitted for the picker).
// Game data: every text of the game is static data (/data/*.json) downloaded once per page; the in-match files are
// warmed in the background as soon as the player is in a room (warmGameData), before the match needs them.
// Language (ui/lang.js, docs/I18N.md): chosen before the first render (initLang); App re-renders on a switch (useLang).
// Server texts are translated on arrival: m.toast / m.ticker frames (msgid + params, or the text as a msgid; a
// config.broadcasts line from its id + args), error codes (ui/toasts.js describeError) and room.closed reasons.

// Polyfills first (older Safari / Firefox ESR): every module evaluated after this one sees them.
import './ui/compat.js';
import { render } from '../vendor/preact.module.js';
import { installPerfHud } from './ui/perfHud.js';   // 性能浮层（按 ~ 开关）
import {useErrorBoundary, useState, useEffect } from '../vendor/hooks.module.js';
import {html, UiHosts, Button, MicroLabel, closeAllDialogs, confirmDialog } from './ui/components.js';
import { ConnectionBanner } from './ui/connBanner.js';
import { SysNoticeBanner } from './ui/sysNotice.js';
import { ToastHost, toast, toastError, describeError } from './ui/toasts.js';
import { net, identity, NetError } from './net.js';
import { store, useStore, emptyMatch, selectRoute, sessionResetNotice, isSpectating, shouldDropMatchOnRoom } from './store.js';
import { data } from './data.js';
import { GAME_FILES } from './ui/gameComponents.js';
import { TitleScreen, sanitizeName } from './screens/title.js';
import { LobbyScreen, rememberRoom, parseRoomParam } from './screens/lobby.js';
import { RoomScreen } from './screens/room.js';
import { GameScreen } from './screens/game.js';
import { audio, installAudio } from './audio.js';
import { settingsStore } from './ui/settings.js';
import { GuideHost } from './ui/guide.js';
import { installDeviceSupport } from './ui/device.js';
import { LoadoutHost } from './screens/loadout.js';
import { StatsHost } from './screens/stats.js';
import { recordResult, installStatsRecorder } from './ui/stats.js';
import { installLoadoutSync, installOwnershipSync, installDiySync } from './ui/loadoutSync.js';
import { installSkinsSync } from './ui/skins.js';
import { installCollapsePanels } from './ui/collapsePanels.js';
import { startBuildGuard } from './ui/buildGuard.js';
import { initLang, useLang, tickerText } from './ui/lang.js';
import { recordError } from './diag.js';
import { t, N_, translateWire } from '../../shared/i18n.js';

const RESTORE_GRACE_MS = 1500;
const JOIN_DELAY_MS = 350;
const TICKER_KEEP = 20;
const EMOTE_KEEP = 20;

const SCREENS = { title: TitleScreen, lobby: LobbyScreen, room: RoomScreen, game: GameScreen };

/** Copy of a server message without transport fields. */
function payload(msg) {
  const { t, rid, ...rest } = msg; // eslint-disable-line no-unused-vars
  return rest;
}

function clearRoomParam() {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has('room')) return;
    url.searchParams.delete('room');
    history.replaceState(history.state, '', url.pathname + (url.search || '') + url.hash);
  } catch { /* ignore */ }
}

// ---- net → store wiring ---------------------------------------------------------------------------

let seq = 0;
let welcomeAt = 0;
let roomStateAt = 0;
let matchAt = 0;
let restoreTimer = null;
let joinTimer = null;
let joinInFlight = false;

function clearPendingJoin() {
  store.patch('ui', { pendingJoin: null });
  clearRoomParam();
}

/** Auto-join the deep-linked room once entered + online (idempotent). */
function schedulePendingJoin() {
  clearTimeout(joinTimer);
  joinTimer = setTimeout(async () => {
    const s = store.get();
    const code = s.ui.pendingJoin;
    if (!code || joinInFlight || !s.session.entered || net.status !== 'online') return;
    if (s.room) {
      if (s.room.code !== code) toast(t('你已在其他同盟中，请先离开当前同盟'), 'warn');
      clearPendingJoin();
      return;
    }
    joinInFlight = true;
    try {
      await net.request('room.join', { code });
    } catch (err) {
      toastError(err);
    } finally {
      joinInFlight = false;
      clearPendingJoin();
    }
  }, JOIN_DELAY_MS);
}

/** End the post-resume "syncing" state early once the server re-pushed what we were showing. */
function maybeFinishRestore() {
  const s = store.get();
  if (!s.ui.restoring) return;
  const roomOk = !s.room || roomStateAt >= welcomeAt;
  const matchOk = !s.match.public || matchAt >= welcomeAt || !s.room?.inMatch;
  if (roomOk && matchOk) {
    clearTimeout(restoreTimer);
    store.patch('ui', { restoring: false });
  }
}

/**
 * Leave whatever room / match was on screen for the lobby with nothing stale left behind: open imperative dialogs,
 * the post-resume restore timer, ticker lines and emote bubbles of the old match (the battle runner and the 暂离 flag
 * follow the store themselves).
 */
function backToLobby() {
  clearTimeout(restoreTimer);
  const s = store.get();
  if (s.room || s.match.public) closeAllDialogs();
  store.set({ room: null, match: emptyMatch(), ticker: [], emotes: [] });
  store.patch('ui', { restoring: false });
}

function onWelcome(msg) {
  identity.saveToken(msg.token);
  const prev = store.get();
  const prevId = prev.me.playerId;
  const name = typeof msg.name === 'string' && msg.name ? msg.name : prev.me.name;
  // 头像 (shared/avatars.js): the welcome carries the session's current one (the server keeps it across reconnects;
  // null = 未设置). The title screen's picker pushed ours with hello, so this is the authoritative echo.
  const avatar = typeof msg.avatar === 'string' && msg.avatar ? msg.avatar : null;
  store.set({ me: { playerId: msg.playerId ?? null, name, token: typeof msg.token === 'string' ? msg.token : null, avatar } });
  welcomeAt = Date.now();
  // 全服公告: the server keeps the outstanding notice and replays it on every welcome, so a player who connects
  // (or reconnects) after the broadcast still sees it. A later sys.notice overwrites this one.
  if (msg.notice && typeof msg.notice.text === 'string' && msg.notice.text) {
    store.patch('ui', { notice: { text: msg.notice.text, level: msg.notice.level || 'info', ttlSec: msg.notice.ttlSec || 0, at: msg.notice.at || 0 } });
  }

  if (prevId != null && prevId !== msg.playerId) {
    // A brand-new server session (the server restarted — crashed / killed, so no room.closed arrived — or this session
    // expired on it): whatever we showed before is gone — back to the lobby cleanly and say why.
    const notice = sessionResetNotice(prev, msg.playerId);
    backToLobby();
    if (notice) toast(t(notice), 'warn', { ttl: 7000 });
  } else if (prev.room || prev.match.public) {
    // Resumed session: the server re-pushes room/match state; drop whatever it doesn't.
    store.patch('ui', { restoring: true });
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      const s = store.get();
      const patch = {};
      if (s.room && roomStateAt < welcomeAt) patch.room = null;
      if (s.match.public && matchAt < welcomeAt) patch.match = emptyMatch();
      store.set(patch);
      store.patch('ui', { restoring: false });
    }, RESTORE_GRACE_MS);
  }
  schedulePendingJoin();
}

function onRoomState(msg) {
  const room = payload(msg);
  roomStateAt = Date.now();
  const myId = store.get().me.playerId;
  const seats = Array.isArray(room.seats) ? room.seats : [];
  if (myId != null && seats.length && !seats.some((s) => s && s.playerId === myId) && !isSpectating(room, myId)) {
    // We are no longer seated (kicked / left elsewhere) — neither in a player seat nor a spectator seat.
    if (store.get().room) toast(t('你已不在该同盟中'), 'warn');
    store.set({ room: null, match: emptyMatch() });
    return;
  }
  const prevRoom = store.get().room;
  // 新对局开始：丢掉**上一局**的残留。注意只在**换了房间**时才丢 —— 服务器先发 m.public、后发合并过的
  // room.state(inMatch: true)，无脑丢会把刚到手的一局抹掉（用户 2026-10-13：永远卡在「正在进入模拟…」）。
  // 判定见 store.js shouldDropMatchOnRoom。
  if (shouldDropMatchOnRoom({ prevRoom, room, matchRoomCode: store.get().match.roomCode })) store.set({ match: emptyMatch() });
  store.set({ room });
  if (room.mode === 'coop' && typeof room.code === 'string') rememberRoom(room.code);
  maybeFinishRestore();
}

const CLOSE_REASON = {
  // 'timeout' = this player was removed after staying disconnected past the lobby grace (server/lobby.js)
  host_left: N_('创建者已离开，同盟已解散'), timeout: N_('由于长时间断开连接，你已离开同盟'), empty: N_('同盟已解散'),
  kicked: N_('你已被移出同盟'), ended: N_('模拟已结束'), expired: N_('同盟已过期'), shutdown: N_('服务器维护中，同盟已关闭'),
};

function wireNet() {
  net.on('status', (snap) => {
    const cur = store.get().connection;
    store.set({
      connection: {
        status: snap.status, ping: snap.ping, attempt: snap.attempt, retryAt: snap.retryAt,
        lastError: snap.lastError, everOnline: cur.everOnline || snap.status === 'online',
      },
    });
  });
  net.on('clock', (c) => store.set({ clock: { offset: c.offset, rtt: c.rtt, synced: c.synced } }));
  net.on('welcome', onWelcome);
  net.on('helloError', (err) => toastError(err));
  net.on('replaced', () => toast(t('该身份已在其他页面登录，本页已断开'), 'warn', { ttl: 6000 }));
  net.on('unhandledError', (err) => toastError(err));
  net.on('room.state', onRoomState);
  net.on('room.closed', (msg) => {
    backToLobby();
    const known = Object.hasOwn(CLOSE_REASON, String(msg.reason)) ? CLOSE_REASON[msg.reason] : null;
    toast(known ? t(known) : typeof msg.reason === 'string' && msg.reason.length < 60 ? t('同盟已关闭：{reason}', { reason: msg.reason }) : t('同盟已关闭'), 'warn');
  });
  // 记下这一帧属于哪个房间：onRoomState 用它区分"同一局"和"上一局的残留"（见 shouldDropMatchOnRoom）
  net.on('m.public', (msg) => { matchAt = Date.now(); store.patch('match', { public: payload(msg), roomCode: store.get().room?.code ?? null }); maybeFinishRestore(); });
  net.on('m.private', (msg) => { matchAt = Date.now(); store.patch('match', { private: payload(msg) }); });
  net.on('m.field', (msg) => store.patch('match', { field: payload(msg) }));
  net.on('m.result', (msg) => {
    const res = payload(msg);
    store.patch('match', { result: res });
    // 本机统计: every arrival, including the lobby's result replay after a reconnect / reload — replays
    // dedupe by content id inside recordResult (spectator seats' copies build no record at all)
    recordResult(res, { myId: store.get().me.playerId, roomMode: store.get().room?.mode ?? null, now: Date.now() });
  });
  net.on('m.toast', (msg) => {
    const kind = ['info', 'success', 'warn', 'error'].includes(msg.kind) ? msg.kind : 'info';
    // msgid + params (server ≥ 0.2.0) or the text itself as a msgid, in the current language
    toast(translateWire(msg), kind);
  });
  net.on('m.ticker', (msg) => {
    if (typeof msg.text !== 'string') return;
    const text = tickerText(msg);    // type, player + the round it came in: a BOSS_HIT line is dropped once its boss round is over and superseded by the
    // same player's next one (ui/ticker.js tickerLineLive / tickerSupersedes)
    const type = typeof msg.type === 'string' ? msg.type : null;
    const playerId = typeof msg.playerId === 'string' ? msg.playerId : null;
    // its broadcast priority: the strip plays the highest first (ui/ticker.js enqueueTickerLines)
    const priority = Number.isFinite(msg.priority) ? msg.priority : 0;
    // `sound`：这一行自带的播报音 key（服务端 tickerText(..., { sound })），ui/ticker.js 播它而不是默认 broadcast
    const sound = typeof msg.sound === 'string' && msg.sound ? msg.sound : null;
    store.set((s) => ({ ticker: [...s.ticker.slice(-(TICKER_KEEP - 1)), { id: ++seq, text, at: Date.now(), type, playerId, round: s.match?.public?.round ?? null, priority, sound }] }));
  });
  net.on('m.emote', (msg) => {
    store.set((s) => ({ emotes: [...s.emotes.slice(-(EMOTE_KEEP - 1)), { seq: ++seq, playerId: msg.playerId, id: msg.id, at: Date.now() }] }));
  });

  // 惊变「死亡回归」(owner 2026-10-16；owner 2026-10-16 改时序)：按下按钮的那一刻**不播音频**，
  // 只在这里挂一个标志；等大家**重新进入整备阶段**时再由 screens/game.js 播（那里能看到 pub.phase）。
  // 音频本身走「背景音乐」通道（audio.deathReturnAnnounce），所以音乐滑条能控它、司凤类开关管不到它。
  net.on('m.deathReturn', (msg) => {
    // `phase` = 公告到达时所在的阶段（通常是战斗结算）。音频等到**大家重新进入整备阶段**才播，
    // 所以 game.js 要求"当前是 PREP 且与这个 phase 不同" —— 公告恰好落在整备阶段里时要等阶段真的切过去。
    const st = store.get();
    store.patch('ui', {
      deathReturnPending: {
        at: Date.now(),
        playerId: (msg && msg.playerId) || null,
        phase: (st && st.match && st.match.public && st.match.public.phase) || null,
      },
    });
    // ★ 兜底：服务端 3 秒后回到整备阶段，但"玩家的 pub.phase 是否真的变到 PREP"依赖他当时的视图
    //   （被淘汰进入观战时视图可能不更新）—— 所以 3.5 秒后若还没播过，就强制播一次。
    //   两个触发点共用 ui.deathReturnPending 这一个标志位：谁先播谁清掉，另一个看到标志没了就不播。
    setTimeout(() => {
      const cur = store.get();
      if (!(cur && cur.ui && cur.ui.deathReturnPending)) return;   // 已经播过
      store.patch('ui', { deathReturnPending: null });
      audio.deathReturnAnnounce();
    }, 3500);
  });
  // 全服公告 (server/lobby.js announce): reaches lobby, waiting rooms and running matches alike — a shutdown
  // warning has to arrive mid-battle too. SysNoticeBanner renders it as a top strip; the client-side 「已读」 is
  // just localStorage, so the server keeps re-sending the same text until the operator replaces it.
  net.on('sys.notice', (msg) => {
    // an EMPTY text is the operator taking the notice down (lobby.announce { clear: true }): drop the strip
    const text = typeof msg.text === 'string' ? msg.text : '';
    store.patch('ui', { notice: text ? { text, level: msg.level || 'info', ttlSec: msg.ttlSec || 0, at: msg.at || 0 } : null });
  });

  // Entering (title → lobby) while already online also needs the deep-link join.
  store.subscribe((s, prev) => {
    if (s.session.entered && !prev.session.entered) schedulePendingJoin();
    // in a room (co-op or solo, also a resumed one) a match is near: its data starts downloading
    if (s.room && !prev.room) warmGameData();
  });
}

/**
 * Download every data file of the match UI (gameComponents GAME_FILES: operators, skills, bonds, items, enemies, 特质 …)
 * in the background once the player is in a room — a match is near (the lobby alone never downloads them). The game's
 * texts are static data loaded once per page — never fetched during a match — and the match screen waits for these
 * files, so with them warmed it opens at once and no text ever appears late (user playtest #3 item 9). Idempotent (the
 * data store shares each file's promise).
 */
function warmGameData() {
  const go = () => { data.loadAll(GAME_FILES).catch(() => {}); };
  if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(go, { timeout: 2500 });
  else setTimeout(go, 600);
}

// ---- UI chrome (the connection banner lives in ui/connBanner.js) -----------------------------------

function ScreenCrashed({ error, reset }) {
  return html`<div class="screen crash">
    <div class="crash__box brackets">
      <${MicroLabel} tone="mint">SYSTEM FAULT<//>
      <h2>${t('界面发生错误')}</h2>
      <p class="t-lo">${String(error?.message || error).slice(0, 200)}</p>
      <${Button} variant="primary" icon="refresh" onClick=${reset}>${t('重新加载界面')}<//>
    </div>
  </div>`;
}

function App() {
  const route = useStore(selectRoute);
  // 2026-10-13「问一句」：启动/重连后落进对局时，先确认一次是否返回（用户要求：不要静默自动进入）
  // 2026-10-13 修复：只在"启动/刷新时就处于对局中"才提示返回对局；正常开局（从大厅进入）**永不提示**。
  // 之前只要路由短暂变成 game（开局瞬间的状态抖动）就会弹窗 → 用户报告"有概率提示" ✗
  const [bootInGame] = useState(() => selectRoute(store.get()) === 'game');
  const [matchResumeAsk, setMatchResumeAsk] = useState({ asked: false, declined: false });
  useEffect(() => {
    if (!bootInGame || matchResumeAsk.asked || route !== 'game') return;
    setMatchResumeAsk({ asked: true, declined: false });
    confirmDialog({
      title: t('发现进行中的对局'),
      text: t('你有一局正在进行，是否返回对局？'),
      okText: t('返回对局'),
    }).then((yes) => { if (!yes) setMatchResumeAsk({ asked: true, declined: true }); });
  }, [route, matchResumeAsk.asked]);
  const shownRoute = matchResumeAsk.declined && route === 'game' ? 'lobby' : route;
  useLang(); // a language switch re-renders the whole tree in place
  const [error, resetError] = useErrorBoundary((err) => console.error('[ui] screen crashed', err));
  const Screen = SCREENS[shownRoute] || LobbyScreen;
  return html`<div class="app-root">
    <div class="app-bg" aria-hidden="true"></div>
    ${error ? html`<${ScreenCrashed} error=${error} reset=${resetError} />` : html`<${Screen} key=${route} />`}
    <${SysNoticeBanner} />
    <${ConnectionBanner} />
    <${ToastHost} />
    <${UiHosts} />
    <${GuideHost} />
    <${LoadoutHost} />
    <${StatsHost} />
  </div>`;
}

// ---- boot -----------------------------------------------------------------------------------------

async function waitForFonts(ms) {
  const fonts = document.fonts;
  if (!fonts || typeof fonts.load !== 'function') return;
  const loads = [
    fonts.load('900 1em "Noto Sans SC"', '卫戍协议盟约'), // i18n-ignore (font sample)
    fonts.load('700 1em "Noto Sans SC"', '开始'), // i18n-ignore (font sample)
    fonts.load('700 1em Bender', '0123456789'),
    fonts.load('700 1em Rajdhani', '0123456789'),
  ].map((p) => p.catch(() => null));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, ms))]);
}

function installGlobalErrorHandlers() {
  window.addEventListener('unhandledrejection', (ev) => {
    const err = ev.reason;
    // Media autoplay/abort rejections (audio.play() before a user gesture, interrupted loads) are
    // expected browser behaviour, not app errors: log quietly, never toast.
    if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) { console.warn('[app] ignored rejection', err.name); return; }
    console.error('[app] unhandled rejection', err);
    recordError('rejection', err);
    if (err instanceof NetError) toastError(err);
    else toast(t('发生意外错误：{error}', { error: describeError(err) }).slice(0, 120), 'error');
  });
  window.addEventListener('error', (ev) => {
    if (!(ev instanceof ErrorEvent)) return; // resource load errors are not script errors
    console.error('[app] uncaught error', ev.error || ev.message);
    recordError('error', ev.error || ev.message, ev.error ? null : `${ev.filename || '?'}:${ev.lineno || 0}:${ev.colno || 0}`);
  });
}

async function boot() {
  installGlobalErrorHandlers();
  // touch / hover / fullscreen classes, zoom-gesture blocking, rotation re-layout (ui/device.js, css/devices.css)
  installDeviceSupport();
  // A page restored from the back/forward cache has a dead socket and a stale token choice: start over.
  window.addEventListener('pageshow', (ev) => { if (ev.persisted) location.reload(); });
  // Pick this tab's reconnect token (asks other live tabs; ≤150 ms) while fonts load.
  const identityReady = identity.init();

  const pendingJoin = parseRoomParam(location.search);
  const savedName = sanitizeName(identity.loadName());
  const entered = identity.wasEntered() && !!savedName;
  store.set((s) => ({
    me: { ...s.me, name: savedName },
    session: { entered },
    ui: { ...s.ui, pendingJoin },
  }));

  wireNet();
  installStatsRecorder(store); // follows the match on screen, so a 放弃模拟 can be recorded (ui/stats.js)
  installLoadoutSync({ net });
  installOwnershipSync({ net });
  installDiySync({ net });
  installSkinsSync({ net });
installCollapsePanels();
  net.attachBrowserHooks();
  // Audio: unlock on first gesture, BGM follows the route / match phase (js/audio.js).
  installAudio({ getManifest: () => data.get('assets'), subscribe: store.subscribe, getState: store.get, selectRoute, settings: settingsStore.get() });
  data.load('assets').catch(() => {});
  // 干员皮肤目录 (docs/SKINS.md): the picker's catalogue. Loaded up front because the 换装 tab reads it the moment
  // the 干员调配 overlay opens, and a miss would show an empty list rather than merely load late.
  data.load('skins').catch(() => {});
  // Warm the data cache in the background (missing files are tolerated).
  data.loadAll('config').catch(() => {});
  // Optional local-client art manifest (emotes, tutorial pages, official UI sprites; DESIGN §13).
  data.load('local').catch(() => {});
  // 全服公告, third source: whoever loads the page before the socket handshake completes. welcome.notice covers the
  // rest (and any reconnect), so this is only about those first seconds — never awaited, never fatal.
  fetch('/notice', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const n = j && j.notice;
      if (n && typeof n.text === 'string' && n.text) {
        store.patch('ui', { notice: { text: n.text, level: n.level || 'info', ttlSec: n.ttlSec || 0, at: n.at || 0 } });
      }
    })
    .catch(() => {});

  const connectWhenReady = identityReady.then(() => {
    if (entered) net.setName(savedName);
    else net.connect();
  });
  // the language (and its UI translations) before the first render: no Chinese flash for an English player
  const langReady = initLang().catch((err) => console.warn('[app] language setup failed', err));
  await Promise.all([waitForFonts(1200), connectWhenReady, langReady]);
  const root = document.getElementById('app');
  render(html`<${App} />`, root);

  const splash = document.getElementById('boot');
  if (splash) {
    splash.classList.add('is-done');
    setTimeout(() => splash.remove(), 300);
  }
  globalThis.__SP__ = { store, net, data, version: 1 };
  // A page keeps the modules it imported at load time for its whole lifetime, so a deploy cannot reach an open tab
  // (ui/buildGuard.js): watch `/healthz.build`. Outside a match the page reloads itself; during a match the guard says
  // so instead (the connection banner offers 刷新页面) and reloads once the match — settlement screen included — is over,
  // so a running game is never thrown away.
  try {
    startBuildGuard({
      inMatch: () => selectRoute(store.get()) === 'game',
      onStale: ({ waiting }) => { if (waiting) store.patch('ui', { buildStale: true }); },
    });
  } catch (err) {
    console.warn('[app] build guard failed to start', err);
  }
}

boot().catch((err) => {
  console.error('[app] boot failed', err);
  const el = document.getElementById('boot-err');
  if (el) el.textContent = t('启动失败，请刷新页面重试');
});

// 性能浮层：按 ~ 开关。失败绝不影响启动。
try { installPerfHud(); } catch (e) { console.warn('[perf] hud failed', e && e.message); }
