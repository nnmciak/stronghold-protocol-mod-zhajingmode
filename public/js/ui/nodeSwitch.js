// ui/nodeSwitch.js — 登录界面上的「南方节点 / 北方节点」选择。
//
// 两个入口是**两台独立服务器**（各自的大厅与对局），所以切换 = 整页跳到另一个入口：
//   · 南方节点：https://thousandaki.top（香港，域名 + HTTPS，默认）
//   · 北方节点：http://124.70.189.186（北京，延迟低，但没有域名/HTTPS）
//
// 为什么是跳转而不是"连另一个服的 WS"：HTTPS 页面不允许开明文 ws:// 连接（混合内容），
// 而北方那台没有证书。跳转是唯一两边都成立的方案；页面里会明确写出这一点。
//
// 选择只决定**你从哪个入口进**；进入之后，同盟大厅里仍然能看到另一节点的房间，
// 点一下会跳到那台服（screens/lobbyFeed.js 的 openPeer）。

import { html, MicroLabel } from './components.js';

/** 两个节点。`id` 同时是 localStorage 里记的值。 */
export const NODES = [
  {
    id: 'hk',
    tone: 'mint',
    label: '南方节点',
    tag: 'HK',
    host: 'thousandaki.top',
    url: 'https://thousandaki.top',
    note: '域名 · HTTPS · 默认',
  },
  {
    id: 'bj',
    tone: 'amber',
    label: '北方节点',
    tag: 'BJ',
    host: '124.70.189.186',
    url: 'http://124.70.189.186',
    note: '北京 · 延迟更低',
  },
];

const KEY = 'sp.node';

const hostOf = (url) => {
  try { return new URL(url).host.toLowerCase(); } catch { return ''; }
};

/** 当前页面所在节点（按 host 判断；不认识就 null）。 */
export function currentNode() {
  const h = String((globalThis.location && globalThis.location.host) || '').toLowerCase();
  return NODES.find((n) => hostOf(n.url) === h) || null;
}

/** 上次选的节点 id（没有任何记录时返回 null）。 */
export function rememberedNode() {
  try { return globalThis.localStorage?.getItem(KEY) || null; } catch { return null; }
}

/**
 * 节点选择条。
 * @param {{ compact?: boolean }} props
 */
export function NodeSwitch({ compact = false } = {}) {
  const current = currentNode();
  const remembered = rememberedNode();

  const pick = (n) => {
    if (current && current.id === n.id) return;          // 已经在这台
    try { globalThis.localStorage?.setItem(KEY, n.id); } catch { /* 隐私模式 */ }
    const search = String((globalThis.location && globalThis.location.search) || '');
    // 保留 ?room=CODE 一类的参数，跳过去还能直接进房
    globalThis.location.assign(n.url + '/' + search);
  };

  return html`<div class=${`nodeswitch${compact ? ' nodeswitch--compact' : ''}`}>
    <div class="nodeswitch__head">
      <${MicroLabel} tone="mint">NODE // 选择节点<//>
      ${current ? html`<span class="nodeswitch__now">当前：${current.label}</span>` : null}
    </div>
    <div class="nodeswitch__row" role="group" aria-label=${'选择服务器节点'}>
      ${NODES.map((n) => {
        const on = !!current && current.id === n.id;
        const last = remembered === n.id && !on;
        return html`<button type="button" key=${n.id}
          class=${`nodeswitch__btn is-${n.tone}${on ? ' is-on' : ''}${last ? ' is-last' : ''}`}
          aria-pressed=${on ? 'true' : 'false'}
          title=${on ? `当前就在${n.label}` : `切换到${n.label}（${n.host}）`}
          onClick=${() => pick(n)}>
          <span class="nodeswitch__tag">${n.tag}</span>
          <span class="nodeswitch__label">${n.label}</span>
          <span class="nodeswitch__note">${n.note}</span>
          ${last ? html`<span class="nodeswitch__last">上次选择</span>` : null}
        </button>`;
      })}
    </div>
    <p class="nodeswitch__hint">
      切换会重新载入页面。选完之后，在同盟大厅里照样能看到另一节点的房间，点一下会自动跳过去。
    </p>
  </div>`;
}
