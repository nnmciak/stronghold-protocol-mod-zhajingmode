// ui/jibianPanel.js — 炸惊模拟: the 「已选惊变」panel. Lists the 惊变 the viewed seat has taken (m.private.effects
// entries the match marks `jibian: true`, server/match/player/views.js effectsView) beside the room's 敌方惊变 — every
// card drawn so far (config enemyJibian.rounds: 第 1、第 6 回合各一张，两张同时生效、效果叠加), not just the newest one.
// While scouting a teammate the panel reads the WATCHED player's effects — game.js
// passes the same source the effects column uses (`watchingOther && field ? field.effects : priv?.effects`), so 观战
// shows that teammate's 惊变 without a second data path.
//
// Rarity colours follow the two source lists, with the added 稀有 tier in blue: 友方 普通 blue / 稀有 blue / 史诗 violet /
// 传说 gold, 敌方 普通 dark red / 稀有 blue / 史诗 orange / 传说 bright red. The card's grey flavour line (`flavor`) is
// printed at the bottom, as on the real cards.

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, MicroLabel } from './components.js';
import { Img, RichText, GIcon } from './gameComponents.js';
import { t, tName } from '../../../shared/i18n.js';
import { RARITY_NAMES } from './choiceOverlay.js';
import { data } from '../data.js';
import { resolveJibianArt } from './jibianArt.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** @param {{ id?: string, name?: string, desc?: string, rarity?: string|null, flavor?: string|null, enemy?: boolean }} e */
function JibianCard({ e }) {
  const rarity = e.rarity || 'normal';
  // ★ 2026-10-23：素材清单可能还没加载完（此时 data.get('assets') 是 null → 没有图标）。
  //   这里主动 load 并订阅，清单到达后重绘一次；之前面板只在打开那一刻取一次，抢不到就一直没图。
  const [, bump] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!data.get('assets') && typeof data.load === 'function') {
      Promise.resolve(data.load('assets')).then(() => { if (alive) bump((n) => n + 1); }).catch(() => {});
    }
    const unsub = typeof data.subscribe === 'function'
      ? data.subscribe((n) => { if (alive && n === 'assets') bump((x) => x + 1); })
      : null;
    return () => { alive = false; if (typeof unsub === 'function') unsub(); };
  }, []);
  const art = resolveJibianArt(data.get('assets'), e);
  return html`<div class=${cx('jbc', e.enemy && 'jbc--enemy')} data-rarity=${rarity}>
    <div class="jbc__top">
      ${art.icon ? html`<span class=${cx('jbc__icon', art.whiteGlyph && 'jibian-art--white-glyph')}><${Img} src=${art.icon} /></span>` : null}
      <span class="jbc__name">${tName(e.name) || t('惊变')}</span>
      <span class="jbc__rarity">${t(RARITY_NAMES[rarity] || '普通')}</span>
    </div>
    ${e.desc ? html`<div class="jbc__desc"><${RichText} text=${e.desc} /></div>` : null}
    ${e.flavor ? html`<div class="jbc__flavor">${e.flavor}</div>` : null}
  </div>`;
}

/**
 * 「羁绊」分页（owner 2026-10-19）：列出全部惊变羁绊，按当前这条 seat 已选的惊变算进度。
 * 数据来自 /data/jibianBonds.json（只拉一次；失败就显示空列表，绝不抛）。
 * @param {{ owned: Set<string> }} props
 */
function BondTab({ owned }) {
  const [bonds, setBonds] = useState(null);
  // ★ 2026-10-20（owner）：羁绊下面要写出「所有」所属惊变的名字，不能只写张数。
  //   名字来自 config 的惊变池（effectId → name），单/多人的池合并一份即可。
  const [names, setNames] = useState({});
  useEffect(() => {
    let alive = true;
    fetch('/data/jibianBonds.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!alive) return; setBonds(j && Array.isArray(j.bonds) ? j.bonds : []); })
      .catch(() => { if (alive) setBonds([]); });
    fetch('/data/config.json', { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!alive || !c || !c.modes) return;
        const map = {};
        for (const m of Object.values(c.modes)) {
          const pool = m && m.jibian && Array.isArray(m.jibian.pool) ? m.jibian.pool : [];
          for (const card of pool) {
            if (card && card.effectId && card.name) map[card.effectId] = card.name;
          }
        }
        setNames(map);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (bonds == null) return html`<div class="jbpanel__none">${t('加载中…')}</div>`;
  if (!bonds.length) return html`<div class="jbpanel__none">${t('没有羁绊数据')}</div>`;
  const rows = bonds.map((b) => {
    const members = Array.isArray(b.members) ? b.members : [];
    const have = members.filter((id) => owned.has(id)).length;
    const tiers = Array.isArray(b.tiers) ? b.tiers : [2];
    const active = have >= (tiers[0] || 2);
    const full = tiers.length > 1 && have >= tiers[1];
    return { b, have, tiers, active, full, members };   // ★ members 要带出来，否则 JSX 里会 ReferenceError
  }).sort((x, y) => (Number(y.active) - Number(x.active)) || (y.have - x.have));
  return html`<div class="jbpanel__bonds">
    ${rows.map(({ b, have, tiers, active, full, members }) => html`<div key=${b.id}
      class=${cx('jbond', active && 'is-on', full && 'is-full')}>
      <div class="jbond__top">
        <b class="jbond__name">${b.name}</b>
        <span class=${cx('jbond__num', have > 0 && 'is-on', full && 'is-full')}>${have}/${tiers[0]}</span>
        ${tiers.length > 1 ? html`<span class=${cx('jbond__num jbond__num--t2', full && 'is-full')}>${tiers[1]}</span>` : null}
      </div>
      <i class="jbond__bar" style=${`width:${Math.min(100, Math.round((have / Math.max(1, tiers[0])) * 100))}%`}></i>
      <div class="jbond__effect">${b.effect || ''}</div>
      <div class="jbond__members">${t('所属惊变')}：${members.map((id) => {
        const nm = names[id] || id;
        return html`<span key=${id} class=${cx('jbond__mem', owned.has(id) && 'is-on')}>${nm}</span>`;
      })}</div>
    </div>`)}
  </div>`;
}

/**
 * @param {{ effects: any[]|null, watchingName?: string|null, spectator?: boolean, onClose: () => void }} props
 */
export function JibianPanel({ effects, watchingName = null, spectator = false, onClose }) {
  const [tab, setTab] = useState('jibian');   // 'jibian' | 'bond'
  const list = (Array.isArray(effects) ? effects : []).filter((e) => e && e.jibian);
  const enemy = list.filter((e) => e.enemy);
  const mine = list.filter((e) => !e.enemy);
  // 已拥有的惊变 id 集合（羁绊进度用）：effect 的 id 可能带 `jibian:` 前缀
  // ★ 2026-10-20：服务端下发的 effect 有时用 id、有时用 key/effectId 携带 jibian:<id>，
  //   只取 e.id 会导致羁绊进度永远 0/N。这里把三个字段都收进来，统一去掉前缀。
  const owned = new Set();
  // ★ 2026-10-20：服务端给的惊变 effect 里 `id` 是「卡片id#uid」（choices.js addRef），
  //   `key` = `jibian:<卡片id>`，`data.effectId` 才是裸的卡片 id。三处都试，统一剥前缀/后缀，
  //   否则和 jibianBonds.members 永远对不上（所有羁绊显示 0/N）。
  const addOwned = (v) => {
    let t = String(v == null ? '' : v).trim();
    if (!t) return;
    t = t.replace(/^jibian:/, '');
    const hash = t.indexOf('#');
    if (hash > 0) t = t.slice(0, hash);
    if (t) owned.add(t);
  };
  for (const e of mine) {
    if (!e) continue;
    addOwned(e.id);
    addOwned(e.key);
    addOwned(e.effectId);
    addOwned(e.jibianId);
    if (e.data) addOwned(e.data.effectId);
  }
  return html`<div class="jbpanel" role="dialog" aria-modal="false" aria-label=${t('已选惊变')}>
    <div class="jbpanel__scrim" onClick=${onClose}></div>
    <div class="jbpanel__box">
      <div class="jbpanel__head">
        <${MicroLabel}>MUTATIONS</${MicroLabel}>
        <b class="jbpanel__title">${t('已选惊变')}</b>
        ${watchingName ? html`<span class="jbpanel__who"><${GIcon} name="eye" />${t('正在查看 {name} 的惊变', { name: watchingName })}</span>` : null}
        <button type="button" class="jbpanel__x" aria-label=${t('关闭')} title=${t('关闭')} onClick=${onClose}><${GIcon} name="close" /></button>
      </div>
      <div class="jbpanel__tabs">
        <button type="button" class=${cx('jbpanel__tab', tab === 'jibian' && 'is-on')}
          onClick=${() => setTab('jibian')}>${t('惊变')}</button>
        <button type="button" class=${cx('jbpanel__tab', tab === 'bond' && 'is-on')}
          onClick=${() => setTab('bond')}>${t('羁绊')}</button>
      </div>
      <div class="jbpanel__body">
        ${tab === 'bond' ? html`<${BondTab} owned=${owned} />` : html`<div class="jbpanel__sec">
          <div class="jbpanel__lbl">${t('敌方惊变')}<span class="jbpanel__hint">${t('全场共享 · 持续全局')}</span></div>
          ${enemy.length ? html`<div class="jbpanel__grid">${enemy.map((e, i) => html`<${JibianCard} key=${e.id ?? i} e=${e} />`)}</div>`
            : html`<div class="jbpanel__none">${t('本局没有敌方惊变')}</div>`}
        </div>
        <div class="jbpanel__sec">
          <div class="jbpanel__lbl">${spectator || watchingName ? t('TA 的惊变') : t('我的惊变')}<span class="jbpanel__hint">${t('共 {n} 个', { n: mine.length })}</span></div>
          ${mine.length ? html`<div class="jbpanel__grid">${mine.map((e, i) => html`<${JibianCard} key=${e.id ?? i} e=${e} />`)}</div>`
            : html`<div class="jbpanel__none">${t('还没有选过惊变')}</div>`}
        </div>`}
      </div>
    </div>
  </div>`;
}
