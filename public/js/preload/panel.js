// public/js/preload/panel.js — 首页的「资源预下载」浮标与面板（挂载于 public/index.html）。
//
// Vanilla DOM on purpose: this is a utility overlay that must work even when the game's own module graph, Preact
// or the WebSocket are unhappy — a player whose title screen is stuck should still be able to fill the cache.
//
// It is the only thing that drives engine.js. Nothing here blocks the game: the widget is created after the page
// is interactive, the automatic resume waits for the load event plus a grace period (so it never competes with the
// game's own first paint for bandwidth), and it hides itself while a match is on screen.

import { createPreloader, capabilities } from './engine.js';

/** How long after `load` the silent resume starts — the title screen's own modules come first. */
const AUTO_RESUME_DELAY_MS = 3000;

const fmtBytes = (n) => {
  const v = Number(n) || 0;
  if (v < 1024) return `${Math.round(v)} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x < 10 ? x.toFixed(1) : Math.round(x)} ${units[i]}`;
};

const fmtEta = (s) => {
  if (s == null || !Number.isFinite(s) || s < 0) return '—';
  if (s < 60) return `${Math.round(s)} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒`;
  return `${Math.floor(s / 3600)} 小时 ${Math.round((s % 3600) / 60)} 分`;
};

const PHASE_TEXT = {
  idle: '未开始',
  checking: '正在核对已缓存的文件…',
  downloading: '下载中',
  paused: '已暂停',
  done: '已就绪',
  error: '出错',
};

/** The skeleton, built once; every later update touches text/width on the refs below. */
const SKELETON = `
  <button class="spp-fab" type="button" aria-expanded="false">
    <span class="spp-fab__dot" aria-hidden="true"></span>
    <span class="spp-fab__label">资源预下载</span>
    <span class="spp-fab__pct"></span>
  </button>
  <section class="spp-panel" hidden aria-label="资源预下载">
    <header class="spp-head">
      <h2 class="spp-title">资源预下载</h2>
      <span class="spp-badge spp-badge--mode"></span>
      <button class="spp-close" type="button" title="收起">×</button>
    </header>

    <p class="spp-sub">
      <span class="spp-phase"></span>
      <span class="spp-version"></span>
    </p>

    <div class="spp-bar"><div class="spp-bar__fill"></div></div>
    <div class="spp-stats">
      <span><b class="spp-done"></b> / <span class="spp-total"></span></span>
      <span class="spp-files"></span>
      <span class="spp-speed"></span>
      <span class="spp-eta"></span>
    </div>
    <p class="spp-current" hidden></p>

    <details class="spp-groups">
      <summary>分类明细</summary>
      <div class="spp-groups__list"></div>
    </details>

    <p class="spp-note" hidden></p>
    <p class="spp-storage"></p>

    <div class="spp-actions">
      <button class="spp-primary" type="button">开始预下载</button>
      <button class="spp-recheck" type="button" title="只核对缓存，不重新下载">校验</button>
      <button class="spp-clear" type="button" title="删除已缓存的素材">清除</button>
      <label class="spp-auto"><input type="checkbox" /> 自动续传</label>
    </div>
    <p class="spp-hint">下载在本机进行，不会上传；清站点数据或换浏览器后需要重下。</p>
  </section>
`;

/**
 * Mount the widget. Safe to call more than once (a second call is a no-op).
 * @param {{ autoDelayMs?: number }} [opts]
 * @returns {{ destroy: () => void, preloader: ReturnType<typeof createPreloader> }}
 */
export function mountPreloadPanel({ autoDelayMs = AUTO_RESUME_DELAY_MS } = {}) {
  if (globalThis.__SP_PRELOAD_PANEL__) return globalThis.__SP_PRELOAD_PANEL__;

  const caps = capabilities();
  const root = document.createElement('div');
  root.className = 'spp';
  root.dataset.mode = caps.mode;
  root.innerHTML = SKELETON;
  document.body.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const fab = $('.spp-fab');
  const panel = $('.spp-panel');
  const el = {
    fabPct: $('.spp-fab__pct'),
    mode: $('.spp-badge--mode'),
    phase: $('.spp-phase'),
    version: $('.spp-version'),
    fill: $('.spp-bar__fill'),
    done: $('.spp-done'),
    total: $('.spp-total'),
    files: $('.spp-files'),
    speed: $('.spp-speed'),
    eta: $('.spp-eta'),
    current: $('.spp-current'),
    groups: $('.spp-groups__list'),
    note: $('.spp-note'),
    storage: $('.spp-storage'),
    primary: $('.spp-primary'),
    recheck: $('.spp-recheck'),
    clear: $('.spp-clear'),
    auto: $('.spp-auto input'),
    close: $('.spp-close'),
  };

  el.mode.classList.toggle('spp-badge--warn', caps.mode !== 'sw');

  const preloader = createPreloader({ onUpdate: render, log: (...a) => console.info('[preload]', ...a) });
  // Register the worker now, not on the first download: an uninformed worker intercepts nothing, and this way the
  // page is already controlled when the player finally presses 开始.
  if (caps.sw) void preloader.prepare();

  // ---- interaction ---------------------------------------------------------------------------------
  const open = (want) => {
    panel.hidden = !want;
    fab.setAttribute('aria-expanded', String(!!want));
    // Opening the panel is a request to see what this would cost — read the manifest, download nothing.
    if (want) { void preloader.describe(); void refreshStorage(); }
  };
  fab.addEventListener('click', () => open(panel.hidden));
  el.close.addEventListener('click', () => open(false));

  el.primary.addEventListener('click', () => {
    const phase = preloader.getState().phase;
    if (phase === 'downloading' || phase === 'checking') { preloader.pause(); return; }
    if (phase === 'done') { void preloader.recheck(); return; }
    // Persisting the origin's storage keeps the browser from evicting 900 MB under disk pressure.
    void preloader.requestPersistence();
    void preloader.start();
  });
  el.recheck.addEventListener('click', () => void preloader.recheck());
  el.clear.addEventListener('click', () => {
    if (globalThis.confirm?.('清除已缓存的素材？游戏之后会像以前一样从服务器加载。')) void preloader.clear();
  });
  el.auto.addEventListener('change', () => preloader.setAuto(el.auto.checked));

  // ---- 一次性引导（2026-10-13）--------------------------------------------------------------------
  // 背景：预载面板【只预览不下载】，绝大多数玩家从没点过它，于是每次进局都要现拉素材。
  // 这里在首页给一次可关闭的提示条 —— 不自动开始（尊重玩家流量），点「开始预下载」走的
  // 是与面板主按钮完全相同的路径；点「以后再说」或任意一次开始后就不再出现。
  const HINT_KEY = 'sp-preload-hint-v1';
  let hintDismissed = false;
  try { hintDismissed = globalThis.localStorage?.getItem(HINT_KEY) === '1'; } catch { hintDismissed = false; }

  function dismissHint() {
    hintDismissed = true;
    try { globalThis.localStorage?.setItem(HINT_KEY, '1'); } catch { /* 隐私模式下忽略 */ }
    const box = $('.spp-callout');
    if (box) box.remove();
  }

  function showHint() {
    if (hintDismissed || $('.spp-callout')) return;
    const st = preloader.getState();
    if (st.phase === 'done' || st.doneFiles > 0) return;   // 已经下过/下完了就不打扰
    const box = document.createElement('div');
    box.className = 'spp-callout';
    box.innerHTML = '<span class="spp-callout__text">提前把素材下到本机，进对局就不用等加载</span>'
      + '<button class="spp-callout__go" type="button">开始预下载</button>'
      + '<button class="spp-callout__no" type="button">以后再说</button>';
    box.querySelector('.spp-callout__no').addEventListener('click', dismissHint);
    box.querySelector('.spp-callout__go').addEventListener('click', () => {
      dismissHint();
      void preloader.requestPersistence();
      void preloader.start();
    });
    root.appendChild(box);
  }

  function maybeShowHint() {
    if (!hintDismissed) showHint();
  }

  // ---- rendering ------------------------------------------------------------------------------------
  let groupRows = new Map();

  function buildGroups(groups) {
    el.groups.textContent = '';
    groupRows = new Map();
    for (const g of groups) {
      const row = document.createElement('div');
      row.className = 'spp-group';
      row.innerHTML = '<span class="spp-group__name"></span><span class="spp-group__bar"><i></i></span><span class="spp-group__num"></span>';
      row.querySelector('.spp-group__name').textContent = g.label;
      el.groups.appendChild(row);
      groupRows.set(g.id, {
        fill: row.querySelector('.spp-group__bar i'),
        num: row.querySelector('.spp-group__num'),
      });
    }
  }

  function render(state) {
    if (groupRows.size !== state.groups.length) buildGroups(state.groups);

    el.mode.textContent = state.mode === 'sw'
      ? (state.swReady ? '离线缓存模式' : '离线缓存模式 · 准备中')
      : '浏览器缓存模式';

    const pct = state.bytes > 0 ? Math.min(100, (state.doneBytes / state.bytes) * 100) : 0;
    const pctText = `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
    el.fill.style.width = `${pct}%`;
    el.fabPct.textContent = state.phase === 'done' ? '✓' : pctText;
    root.dataset.phase = state.phase;
    fab.classList.toggle('is-busy', state.phase === 'downloading' || state.phase === 'checking');

    el.phase.textContent = PHASE_TEXT[state.phase] || state.phase;
    if (state.phase === 'done' && !state.verified) el.phase.textContent = '已就绪（上次完成，未重新核对）';
    el.version.textContent = state.version ? `版本 ${String(state.version).slice(0, 24)}` : '';

    el.done.textContent = fmtBytes(state.doneBytes);
    el.total.textContent = fmtBytes(state.bytes);
    el.files.textContent = `${state.doneFiles} / ${state.files} 个文件`
      + (state.optional && state.optional.files ? `（另有 ${fmtBytes(state.optional.bytes)} 按需加载：语音 / 商店立绘 / 指南 / 皮肤模型，不进预载）` : '');
    el.speed.textContent = state.speed > 0 ? `${fmtBytes(state.speed)}/s` : '';
    el.eta.textContent = state.etaSec != null && state.speed > 0 ? `剩余约 ${fmtEta(state.etaSec)}` : '';

    if (state.current && state.phase === 'downloading') {
      el.current.hidden = false;
      el.current.textContent = state.current;
    } else {
      el.current.hidden = true;
    }

    for (const g of state.groups) {
      const row = groupRows.get(g.id);
      if (!row) continue;
      const p = g.bytes > 0 ? Math.min(100, (g.doneBytes / g.bytes) * 100) : 0;
      row.fill.style.width = `${p}%`;
      row.num.textContent = `${fmtBytes(g.doneBytes)} / ${fmtBytes(g.bytes)}`;
    }

    const note = state.error || state.reason || '';
    el.note.hidden = !note;
    el.note.textContent = note;
    el.note.classList.toggle('spp-note--error', !!state.error);

    el.auto.checked = !!state.auto;
    el.recheck.disabled = state.mode !== 'sw' || state.phase === 'downloading' || state.phase === 'checking';
    el.clear.disabled = state.phase === 'checking';

    if (state.phase === 'downloading' || state.phase === 'checking') el.primary.textContent = '暂停';
    else if (state.phase === 'paused') el.primary.textContent = '继续';
    else if (state.phase === 'error') el.primary.textContent = '重试';
    else if (state.phase === 'done') el.primary.textContent = '重新校验';
    else el.primary.textContent = '开始预下载';
  }

  async function refreshStorage() {
    const est = await preloader.estimate();
    if (!est) { el.storage.textContent = ''; return; }
    el.storage.textContent = `本浏览器已用 ${fmtBytes(est.usage)}${est.quota ? ` / 可用约 ${fmtBytes(est.quota)}` : ''}`;
  }

  // ---- match visibility ------------------------------------------------------------------------------
  // The floating button has no business over a running match. `selectRoute` is the game's own selector; a
  // dynamic import keeps the widget working even when the game's modules never load.
  let selectRoute = null;
  let store = null;
  import('/js/store.js')
    .then((m) => { selectRoute = m.selectRoute; store = m.store; })
    .catch(() => { /* the widget stays visible, which is the harmless default */ });

  const syncVisibility = () => {
    let hidden = false;
    try { hidden = !!(selectRoute && store && selectRoute(store.get()) === 'game'); } catch { hidden = false; }
    root.classList.toggle('spp--in-match', hidden);
  };
  const visibilityTimer = setInterval(syncVisibility, 2000);
  syncVisibility();

  // ---- first run -------------------------------------------------------------------------------------
  render(preloader.getState());
  void refreshStorage();
  globalThis.setTimeout(maybeShowHint, 1200);
  // 玩家一旦从面板里开始下载，也视为已引导过，避免提示条与下载状态并存
  el.primary.addEventListener('click', () => { if (!hintDismissed && preloader.getState().doneFiles === 0) dismissHint(); });

  const state = preloader.getState();
  if (state.auto) {
    // Silent resume, but only once the title screen has had the network to itself.
    const kick = () => setTimeout(() => { void preloader.resumeIfAuto(); }, autoDelayMs);
    if (document.readyState === 'complete') kick();
    else globalThis.addEventListener('load', kick, { once: true });
  }

  const api = {
    preloader,
    destroy() {
      clearInterval(visibilityTimer);
      root.remove();
      delete globalThis.__SP_PRELOAD_PANEL__;
    },
  };
  globalThis.__SP_PRELOAD_PANEL__ = api;
  return api;
}

mountPreloadPanel();
