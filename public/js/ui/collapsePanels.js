// public/js/ui/collapsePanels.js — 面板收纳（用户 2026-10-13）。
//
// 设计原则：**纯加法**。不碰任何现有组件的代码与 DOM 结构 ✗ ——
//   · 状态写在 <body> 的类上（`collapse-detail` / `collapse-effects` / `collapse-shopbar` / `collapse-bonds`），
//     所以面板被重新渲染也不会丢 ✓；
//   · 收起完全由 CSS 做（`body.collapse-xxx .面板根 { display: none }`）✓；
//   · 每个面板屏幕边缘挂一个小把手按钮，点一下收起 / 再点展开，选择记在 localStorage ✓。
// 这样即使某个选择器没命中，也只是"那个把手不出现"，绝不会把游戏界面改坏 ✓。

const KEY = 'uiCollapsed';
const PANELS = [
  // ★ 2026-10-26（owner）：删掉「下面（商店栏）」和「左边（干员详情）」的收起把手；
  //   右侧 buff 栏（效果列）整块不显示了，它的把手也一并去掉。只保留顶部盟约条的把手。
  { id: 'bonds',   pos: 'top',    sel: ['.bondbar', '.bonds', '.band-bar', '.bond-bar', '.topbar-bonds', '.hz'], label: '盟约条' },
];
const REMOVED = ['detail', 'effects', 'shopbar'];

function loadState() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(KEY);
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}

function saveState(o) {
  try { globalThis.localStorage && globalThis.localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* 记不住就只影响下次 */ }
}

function apply(panel, on) {
  const cls = 'collapse-' + panel.id;
  const b = globalThis.document && globalThis.document.body;
  if (!b) return;
  b.classList.toggle(cls, !!on);
  const btn = b.querySelector(`.collapseHandle--${panel.id}`);
  if (btn) {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = panel.pos === 'left' ? (on ? '›' : '‹')
      : panel.pos === 'right' ? (on ? '‹' : '›')
      : panel.pos === 'top' ? (on ? '⌄' : '⌃') : (on ? '⌃' : '⌄');
    btn.title = (on ? '展开' : '收起') + panel.label;
  }
}

/** 装上把手（幂等：重复调用只是刷新一遍）。 */
export function installCollapsePanels(doc = globalThis.document) {
  if (!doc || !doc.body) return;
  // 已删除面板的收纳状态：清掉 body 类与把手，避免旧 localStorage 把商店栏/详情栏永久藏起来
  {
    const old = loadState();
    let dirty = false;
    for (const id of REMOVED) {
      if (old[id] != null) { delete old[id]; dirty = true; }
      doc.body.classList.remove('collapse-' + id);
      doc.querySelectorAll?.('.collapseHandle--' + id).forEach((n) => n.remove());
    }
    if (dirty) saveState(old);
  }
  const state = loadState();
  for (const panel of PANELS) {
    const el = panel.sel.map((s) => { try { return doc.querySelector(s); } catch { return null; } }).find(Boolean);
    apply(panel, state[panel.id]);                    // 先按记忆恢复（即使元素此刻不在，类也留着 ✓）
    if (!el || doc.querySelector(`.collapseHandle--${panel.id}`)) continue;
    if (el.closest && el.closest('.collapseHandle')) continue;
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = `collapseHandle collapseHandle--${panel.id} collapseHandle--${panel.pos}`;
    btn.dataset.testid = `collapse-${panel.id}`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const st = loadState();
      st[panel.id] = !st[panel.id];
      saveState(st);
      apply(panel, st[panel.id]);
    });
    doc.body.appendChild(btn);
    apply(panel, loadState()[panel.id]);
  }
}

/** 面板每次重新渲染后类仍在 body 上，无需重装；这里只在 SPA 切页时兜底再叫一次。 */
export function refreshCollapsePanels() { installCollapsePanels(); }

// ★ 面板是在大厅/对局挂载之后才出现的，启动时那一次通常什么都找不到 ✗ ——
//   用一个【节流 500ms】的轻量观察器：body 结构一变就补装把手（每半秒最多一次，避免战斗期空转）。
if (typeof MutationObserver === 'function' && globalThis.document) {
  let timer = null;
  const kick = () => {
    if (timer != null) return;
    timer = setTimeout(() => {
      timer = null;
      try { installCollapsePanels(); } catch { /* 视图还没好就等下一次 */ }
    }, 500);
  };
  const start = () => {
    if (!globalThis.document.body) return;
    try { new MutationObserver(kick).observe(globalThis.document.body, { childList: true, subtree: true }); } catch { /* 只靠启动那次 */ }
    kick();
  };
  if (globalThis.document.body) start();
  else globalThis.document.addEventListener('DOMContentLoaded', start, { once: true });
}
