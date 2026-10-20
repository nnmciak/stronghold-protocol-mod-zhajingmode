// public/js/ui/forge.js — 炸惊模拟「锻造器」(user 2026-10-14)：HUD 的按钮 / 悬浮窗 / 计数器 / 已锻造面板。
//
// ★ 用户 2026-10-14「接效果」之后，这一层**只负责显示与上报**：
//   · 数值表、抽卡、已锻造累计的算法全在 shared/forgeData.js（服务端与客户端同一份，不会漂移）；
//   · 数量（`forge.count`）、已锻造表（`forge.forged`）、当前这一组（`forge.rolled`）
//     全是**服务端权威**，随 m.private 下发 —— 刷新不会丢，也不会两边算出不同的结果；
//   · 点一张卡 → gameActions.forgeTake 发 `g.forgeTake`，服务端校验 / 扣数 / 累计 / 立即效果
//     （资金当场到账），然后回一帧新的 m.private，按钮数字与已锻造面板跟着变。
//   · 选完之后面板的去留（2026-10-16 用户定案）：**还有存货就自动接着弹下一组，选完最后一个才关** ——
//     见 ForgeButton 的 onPick 注释。拿到新的锻造器时不会主动弹窗（要自己点 HUD 按钮开）。
//
// 发放（精锐 1 个 / 累计击杀每 FORGE_KILLS_PER 个）在 server/match/player/acquire.js 的 forgeOnElite / forgeOnKills；
// 战斗侧的生效在 server/sim/content/forge.js。

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, MicroLabel, Icon } from './components.js';
import { GIcon } from './gameComponents.js';
import { t, tParts } from '../../../shared/i18n.js';
import {
  FORGE_RARITY, FORGE_KILLS_PER, forgeOptionById, forgedEntries, forgedText, forgedCount, valueText, valueNote,
} from '../../../shared/forgeData.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

export { FORGE_RARITY, FORGE_KILLS_PER };

/** 某个服务端下发的 forge 块（缺省时给一个空壳，UI 不会崩）。 */
const forgeOf = (forge) => ({
  count: Math.max(0, Math.floor(Number(forge && forge.count) || 0)),
  per: Math.max(1, Math.floor(Number(forge && forge.per) || FORGE_KILLS_PER)),
  forged: (forge && forge.forged) || null,   // [{ id, name, unit, total, count }]
  rolled: (forge && forge.rolled) || null,   // { rarity, picks: [optId] }
});

/** 把服务端的 rolled 展开成卡片数据（选项记录来自共享表）。 */
function cardsOf(rolled) {
  if (!rolled || !Array.isArray(rolled.picks)) return { rarity: 'normal', picks: [] };
  return { rarity: rolled.rarity, picks: rolled.picks.map((id) => forgeOptionById(id)).filter(Boolean) };
}

/** 悬浮窗的 key：换一组就重挂载 → 重播入场动画。 */
const rollKey = (rolled) => (rolled ? `${rolled.rarity}:${(rolled.picks || []).join(',')}` : '');

// ── 本地 UI 状态（只有「开着没开着」和「点了哪张」这类纯界面的东西） ─────────────────────────
const listeners = new Set();
let ui = { open: false, forgedOpen: false, picked: null };
const emit = () => { for (const f of listeners) f(ui); };
const patch = (p) => { ui = { ...ui, ...p }; emit(); };
/** 开「锻造器」悬浮窗。 */
export function forgeOpen() { patch({ open: true, picked: null }); }
/** 关「锻造器」悬浮窗。 */
export function forgeClose() { patch({ open: false }); }
/** 开/关「已锻造属性」面板。 */
export function forgedToggle(open) { patch({ forgedOpen: open == null ? !ui.forgedOpen : !!open }); }

/** Hook: 订阅界面状态。 */
function useUi() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return ui;
}

/**
 * 怪物杀敌计数器 + 距离下一个锻造器的进度。
 * 数据来自 m.private 的 `stats.kills`（累计值）与 `forge.per`。
 * @param {{ kills?: number, per?: number }} props
 */
export function KillCounter({ kills, per } = {}) {
  const k = Math.max(0, Math.floor(Number(kills) || 0));
  const step = Math.max(1, Math.floor(Number(per) || FORGE_KILLS_PER));
  const done = k % step;
  const left = step - done;
  const pct = (done / step) * 100;
  return html`<span class="kills" title=${tParts('已击败 {n} 名敌人 · 再击败 {left} 名可获得锻造器',
      { n: html`<b>${k}</b>`, left: html`<b>${left}</b>` })}>
    <${Icon} name="sword" class="kills__icon" />
    <b key=${k} class="kills__n num is-bump">${k}</b>
    <span class="kills__sub num">${done}/${step}</span>
    <span class="kills__bar" aria-hidden="true"><i style=${`width:${pct}%`}></i></span>
  </span>`;
}

/**
 * 「锻造器」按钮 + 悬浮窗。数量与卡面都来自 `forge`（服务端）。
 * @param {{ forge?: object, onTake?: (optId:string, rarity:string)=>void, class?: string }} props
 */
export function ForgeButton({ forge = null, onTake = null, class: cls = '' } = {}) {
  const s = useUi();
  const f = forgeOf(forge);
  const n = f.count;
  const cards = cardsOf(f.rolled);
  return html`<span class=${cx('forge', cls)}>
    <button type="button" class=${cx('forge__btn', n > 0 && 'is-ready', s.open && 'is-on')}
      data-testid="forge-button" aria-label=${t('锻造器')} title=${t('锻造器')}
      aria-disabled=${n > 0 ? 'false' : 'true'}
      onClick=${() => (s.open ? forgeClose() : forgeOpen())}>
      <${GIcon} name="forge" class="forge__icon" />
      <span class="forge__label">${t('锻造器')}</span>
      ${n > 0 ? html`<b key=${n} class="forge__n num">${n}</b>` : null}
    </button>
    ${s.open && f.rolled && cards.picks.length
      ? html`<${ForgePanel} key=${rollKey(f.rolled)} rarity=${cards.rarity} picks=${cards.picks}
          left=${n} entries=${f.forged} onClose=${forgeClose}
          onPick=${(opt) => {
            patch({ picked: opt.id });
            onTake?.(opt.id, cards.rarity);
            // ★ 2026-10-16 用户「锻造器有多个的情况下，选择了一个之后会自动弹出下一个」——
            //   这条**取代**了 2026-10-15 的「获得新的锻造器不要再自动弹出窗口」。区别在"还有没有存货"：
            //     · `n > 1`（点完还剩 ≥1 个）：**保持打开** —— 服务端扣数后会立刻抽好下一组
            //       （acquire.js forgeTake：count > 0 就 drawForge），下一帧的 m.private 带着新的
            //       `f.rolled` 回来，面板原地换成新的一组（ForgePanel 的 key=rollKey 变了 → 重挂载 → 重播入场动画），
            //       体感就是"自动弹出下一个"，不用再点一次 HUD 按钮。
            //     · `n <= 1`（这是最后一个）：**关掉**，免得留一个没有卡可选的空窗。
            //   `n` 是这一帧服务端下发的数量（点击前的值），所以 `n > 1` 正好表示"点完还有"。
            if (n > 1) patch({ picked: null });   // 清掉选中态，下一组不继承"已选"的高亮
            else forgeClose();
          }} />`
      : null}
  </span>`;
}

/** 悬浮窗：三张同稀有度卡片，点一张即选中（✕ / Esc / 遮罩都能关）。 */
export function ForgePanel({ rarity, picks, left, entries, onClose, onPick }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose(); }
    };
    globalThis.addEventListener?.('keydown', onKey, true);
    return () => globalThis.removeEventListener?.('keydown', onKey, true);
  }, [onClose]);
  const s = useUi();
  const has = forgedCount(entries);
  return html`<div class="forgeov" role="dialog" aria-label=${t('锻造器')} data-rarity=${rarity}>
    <div class="forgeov__scrim" onClick=${onClose}></div>
    <div class="forgeov__box">
      <header class="forgeov__head">
        <span class="forgeov__title">${t('锻造器')}</span>
        <span class=${cx('forgeov__rarity', `is-${rarity}`)}>${t((FORGE_RARITY.find((r) => r.id === rarity) || {}).name || '普通')}</span>
        <span class="forgeov__left">${t('剩余')}<b class="num">${left}</b></span>
        <button type="button" class="forgeov__x" aria-label=${t('关闭')} title=${t('关闭 (Esc)')} onClick=${onClose}>
          <${GIcon} name="close" />
        </button>
      </header>
      <p class="forgeov__tip">${t('悬停预览，点击确认')}</p>
      <div class="forgeov__grid">
        ${picks.map((o, i) => html`<button key=${o.id} type="button" style=${`--i:${i}`}
          class=${cx('fcard', `fcard--${rarity}`, s.picked === o.id && 'is-picked')}
          data-testid=${`forge-card-${o.id}`} onClick=${() => onPick(o)}>
          <span class="fcard__top">
            <span class="fcard__name">${t(o.name)}</span>
            <${MicroLabel}>${o.id.toUpperCase()}<//>
          </span>
          <span class="fcard__value num">${valueText(o, rarity)}</span>
          ${valueNote(o, rarity) ? html`<span class="fcard__note">${t(valueNote(o, rarity))}</span>` : null}
          <span class="fcard__hint">${t(o.hint)}</span>
        </button>`)}
      </div>
      ${has > 0 ? html`<div class="forgeov__forged">
        <span class="forgeov__forgedhead">${t('已锻造')}</span>
        ${forgedEntries(entries).map((e) => html`<span key=${e.id} class="fged__pill">
          <span class="fged__pillname">${t(e.name)}</span>
          <b class="fged__pillval num">${forgedText(e)}</b>
          ${e.count > 1 ? html`<span class="fged__pillcnt num">×${e.count}</span>` : null}
        </span>`)}
      </div>` : null}
      <footer class="forgeov__foot">${tParts('精锐干员或累计击败 {n} 名敌人可获得锻造器',
        { n: html`<b class="num">${FORGE_KILLS_PER}</b>` })}</footer>
    </div>
  </div>`;
}

/**
 * 「已锻造属性」入口徽标（TopBar「锻造器」右边）：只在锻造过东西后出现，点开只读面板。
 * @param {{ forge?: object, class?: string }} props
 */
export function ForgedChip({ forge = null, class: cls = '' } = {}) {
  const s = useUi();
  const f = forgeOf(forge);
  const n = forgedCount(f.forged);
  if (n <= 0) return null;
  return html`<span class=${cx('fged', cls)}>
    <button type="button" class=${cx('fged__chip', s.forgedOpen && 'is-on')} data-testid="forged-chip"
      aria-label=${t('已锻造属性')} title=${t('已锻造属性')} onClick=${() => forgedToggle()}>
      <${GIcon} name="forge" class="fged__chipicon" />
      <span class="fged__chiplabel">${t('已锻造')}</span>
      <b class="fged__chipn num">${n}</b>
    </button>
    ${s.forgedOpen ? html`<${ForgedPanel} entries=${f.forged} onClose=${() => forgedToggle(false)} />` : null}
  </span>`;
}

/** 「已锻造属性」只读面板：每项一行 —— 名称 · 累计总加成 · 叠加次数。 */
export function ForgedPanel({ entries = null, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose(); }
    };
    globalThis.addEventListener?.('keydown', onKey, true);
    return () => globalThis.removeEventListener?.('keydown', onKey, true);
  }, [onClose]);
  // ★ entries 可能是 map（服务端下发的形状）、数组（旧版）或 null —— forgedEntries 三种都认。
  const rows = forgedEntries(entries);
  const stacks = rows.reduce((s2, e) => s2 + (e.count || 0), 0);
  return html`<div class="fgedov" role="dialog" aria-label=${t('已锻造属性')} data-testid="forged-panel">
    <div class="fgedov__scrim" onClick=${onClose}></div>
    <div class="fgedov__box">
      <header class="fgedov__head">
        <span class="fgedov__title">${t('已锻造属性')}</span>
        <span class="fgedov__sub">${tParts('共 {n} 次锻造', { n: html`<b class="num">${stacks}</b>` })}</span>
        <button type="button" class="fgedov__x" aria-label=${t('关闭')} title=${t('关闭 (Esc)')} onClick=${onClose}>
          <${GIcon} name="close" />
        </button>
      </header>
      <div class="fgedov__body">
        ${rows.length === 0 ? html`<p class="fgedov__empty">${t('还没有锻造过')}</p>` : rows.map((e, i) => html`
          <div key=${e.id} class="fgedov__row" style=${`--i:${i}`}>
            <span class="fgedov__name">${t(e.name)}</span>
            <span class="fgedov__val num">${forgedText(e)}</span>
            <span class="fgedov__cnt num" title=${tParts('叠加 {n} 次', { n: html`<b>${e.count}</b>` })}>×${e.count}</span>
          </div>`)}
      </div>
      <footer class="fgedov__foot">${tParts('精锐干员或累计击败 {n} 名敌人可获得锻造器',
        { n: html`<b class="num">${FORGE_KILLS_PER}</b>` })}</footer>
    </div>
  </div>`;
}
