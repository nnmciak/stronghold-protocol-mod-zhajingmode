// ui/jibianList.js — 干员调配的「惊变一览」(2026-10-13, 用户要求): a SELF-CONTAINED corner button + panel listing the
// CURRENT mode's whole 惊变 pool (data/config.json `modes[<modeId>].jibian.pool`, 55 entries per 炸惊 mode: effectId /
// name / desc / rarity / flavor). Shown ONLY in 炸惊档 — the same single verdict the screen and the sync use
// (ui/loadoutSync.js isZjNow), so the button can never appear in 普通档. 自包含 (button + panel + its own state in one
// file, like ui/noticeBell.js): screens/loadout.js only has to render <JibianListButton/> and wire nothing else.
//
// ★ 判定的两个 store（踩过的坑，写清楚）：isZjNow(st, app) 的 st 里有两个东西它要读——
//   `st.room` / `st.match.public`（房间难度，优先）与 `st.mode`（普通 / 炸惊开关）。在 loadout.js 里
//   `useStore((s) => isZjNow(st, s))` 把 **loadoutStore 的快照**当 st、app store 当 app，两样都齐。
//   但组件里只有 app store 的 `s`：它**没有 `mode` 字段**（开关存在 loadoutStore），所以照抄成 `isZjNow(s, s)`
//   会让「大厅 + 开关切到炸惊」恒判为 false，按钮永远不出现（node 实测：isZjNow(app, app)=false 而
//   isZjNow({...app, mode:'zhajing'}, app)=true）。所以这里把 loadoutStore 的当前档位并进 st；
//   房间的 room / match.public 仍在 s 里，isZjNow 自己会优先读它们 —— 「房间难度优先」这条不变。
//
// Mode: 炸惊 has TWO modes (mode_single_zhajing / mode_multi_zhajing, shared/constants.js modeIdFor). Inside a match the
// running mode is m.public.modeId (ui/gameLogic/modeRules.js currentModeId) and wins; outside one the screen's own
// 普通 / 炸惊 switch decides, whose 炸惊 side is the single-player mode — the same `mode_single_*` id screens/banPicker.js
// builds for its difficulty lists. Both zhajing pools are identical today, so the fallback can only ever differ if the
// data does (both are read through the data store here, never hard-coded).
//
// Icon: a card whose data carries `bond` (13 of the 55 — 炎国游记 / 等待雪 / 骑士竞技 / 加入大群 / "投资人" …) shows
// THAT 盟约's own glyph (ui/gameComponents.js BondGlyph, the same one the 盟约 panels use), so a bond-flavoured 惊变
// reads as one at a glance; the rest keep assets.items[effectId] (ui/assetUrls.js assetsItemIconUrl — the 8 cards that
// carry their own art), else the shared 惊变 glyph uiUrl(m,'buffIcon/icon_player_buff') — the very fallback the pick
// overlay's card face uses (ui/choiceOverlay.js:77-84). Rarity labels come from RARITY_NAMES of that same file (普通 / 稀有 / 史诗 / 传说): one
// mapping for the whole project, no second copy. Cards are grouped by rarity in the ladder's own order (普通 → 传说),
// the group label carries the rarity colour, and every row keeps the 已选惊变 panel's card look (.jbc: name, 稀有度
// badge, description, grey flavour line) so the two 惊变 surfaces read the same. The list key is `组-序号-effectId`:
// the pool really does hold two cards named 极速送达！ (normal / rare), so a name-keyed list would collide.
//
// Escape / scrim / ✕ all close it, like the project's other overlays. Esc is captured (capture phase, and stopped
// there), so the screen's own Esc handler — which would peel the drawer back or close the whole 干员调配 overlay — never
// sees it while the panel is open.

import { useEffect, useReducer, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { Img, RichText, GIcon, BondGlyph } from './gameComponents.js';
import { data, getMode } from '../data.js';
import { uiUrl } from './assetUrls.js';
import { RARITY_NAMES } from './choiceOverlay.js';
import { isZjNow, loadoutStore } from './loadoutSync.js';
import { modeIdFor } from '../../../shared/constants.js';
import { store, useStore } from '../store.js';
import { t, tName } from '../../../shared/i18n.js';
import { resolveJibianArt } from './jibianArt.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** The order the groups are listed in: 普通 first, 传说 last (the pool's own rarity ladder). */
const RARITY_ORDER = Object.freeze(['normal', 'rare', 'epic', 'legend', 'hidden']);
/** The project's rarity label for a pool entry (ui/choiceOverlay.js RARITY_NAMES), 普通 when the data has no rarity. */
const rarityName = (r) => RARITY_NAMES[r] || RARITY_NAMES.normal;

/**
 * The modeId whose 惊变 pool the panel shows: the running match's mode when there is one, else the 炸惊 mode of the
 * screen's current 档位 (single-player — the same id screens/banPicker.js builds for a difficulty).
 * @returns {string}
 */
export function jibianModeId() {
  const app = store.get() || {};
  const pub = app.match?.public;
  if (pub && pub.modeId) return pub.modeId;
  const diff = pub?.difficulty ?? app.room?.difficulty ?? null;
  return diff ? modeIdFor('solo', diff) : 'mode_single_zhajing';
}

/**
 * The pool of `modeId` (default: the current mode), grouped by rarity as [{ rarity, name, list }], 普通 → 传说.
 * Never throws when config.json is absent (an empty list).
 * ★ `source`: 'ally' (default) reads `modes[<id>].jibian.pool`（我方 55 条）；'enemy' reads
 *   `modes[<id>].enemyJibian.pool`（敌方 15 条，规则14 第 1 / 第 6 回合各抽一张）——两者结构相同。
 * @param {string} [modeId]
 * @param {'ally'|'enemy'} [source]
 */
export function jibianGroups(modeId = jibianModeId(), source = 'ally') {
  const mode = getMode(modeId);
  // ★ 2026-10-24（owner）：敌方一览要把「隐秘」池也列出来（隐秘核心前才抽得到的那 9 张）
  const enemyPool = mode?.enemyJibian
    ? [...(Array.isArray(mode.enemyJibian.pool) ? mode.enemyJibian.pool : []),
       ...(Array.isArray(mode.enemyJibian.hidden?.pool) ? mode.enemyJibian.hidden.pool : [])]
    : null;
  const pool = source === 'enemy' ? enemyPool : mode?.jibian?.pool;
  const seen = new Map();
  for (const e of Array.isArray(pool) ? pool : []) {
    if (!e || typeof e !== 'object') continue;
    const r = RARITY_NAMES[e.rarity] ? e.rarity : 'normal';
    if (!seen.has(r)) seen.set(r, []);
    seen.get(r).push(e);
  }
  return RARITY_ORDER.filter((r) => seen.has(r)).map((r) => ({ rarity: r, name: rarityName(r), list: seen.get(r) }));
}

/** One card of the list: art (its own icon, else the shared 惊变 glyph), name, 稀有度, description and flavour. */
function JibianRow({ e, m }) {
  const rarity = RARITY_NAMES[e.rarity] ? e.rarity : 'normal';
  const art = resolveJibianArt(m, e);
  return html`<div class="jbl__row jbc" data-rarity=${rarity} data-effect=${e.effectId || ''}>
    <span class=${cx('jbl__icon', art.bondId && 'jbl__icon--bond', art.whiteGlyph && 'jibian-art--white-glyph')}>
      ${art.icon
        // ★ 2026-10-23：有**自己的图**就优先用它（黑闪这种 bond 本身没图标的卡，之前会被羁绊图标挡住 → 只剩问号）
        ? html`<${Img} src=${art.icon} fallback=${html`<${GIcon} name="bolt" />`} />`
        // 没有自己的图（含"羁绊本身没有图标"的卡，如 集中一点）→ 和「羁绊之力」一样用通用惊变图标
        : html`<${Img} src=${uiUrl(m, 'buffIcon/icon_player_buff')} fallback=${html`<${GIcon} name="bolt" />`} />`}
    </span>
    <span class="jbl__main">
      <span class="jbl__top">
        <b class="jbc__name">${tName(e.name) || t('惊变')}</b>
        <span class="jbc__rarity jbl__badge">${t(rarityName(rarity))}</span>
      </span>
      ${e.desc ? html`<${RichText} class="jbc__desc" text=${e.desc} />` : null}
      ${e.flavor ? html`<span class="jbc__flavor">${e.flavor}</span>` : null}
    </span>
  </div>`;
}

/** The panel: every 惊变 of the current mode, grouped by rarity; scrollable, closable (✕ / Esc / the scrim). */
function JibianListPanel({ m, onClose, source = 'ally' }) {
  const enemy = source === 'enemy';
  const title = enemy ? '敌方惊变一览' : '惊变一览';
  const groups = jibianGroups(undefined, source);
  const total = groups.reduce((n, g) => n + g.list.length, 0);
  // Esc closes the panel ONLY: captured, and stopped before the screen's own Esc handler (drawer / overlay)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return html`<div class=${cx('jbl', enemy && 'jbl--enemy')} role="dialog" aria-modal="false" aria-label=${t(title)}>
    <div class="jbl__scrim" onClick=${onClose}></div>
    <div class="jbl__box">
      <div class="jbl__head">
        <span class="jbl__title">${t(title)}</span>
        <span class="jbl__count">${t('共 {n} 个', { n: total })}</span>
        <button type="button" class="jbl__x" aria-label=${t('关闭')} title=${t('关闭 (Esc)')} onClick=${onClose}>
          <${Icon} name="close" />
        </button>
      </div>
      <div class="jbl__scroll">
        ${groups.length ? groups.map((g) => html`<section key=${g.rarity} class="jbl__sec" data-rarity=${g.rarity}>
          <div class="jbl__lbl"><span class="jbl__lblname">${t(g.name)}</span><span class="jbl__lbln num">${g.list.length}</span></div>
          <div class="jbl__list">
            ${g.list.map((e, i) => html`<${JibianRow} key=${`${g.rarity}-${i}-${e.effectId || e.name}`} e=${e} m=${m} />`)}
          </div>
        </section>`) : html`<p class="jbl__none">${t(enemy ? '这个模式没有敌方惊变数据' : '这个模式没有惊变数据')}</p>`}
      </div>
    </div>
  </div>`;
}

/**
 * 干员调配右下角的两个惊变按钮（2026-10-14 用户要求）：**我方「惊变一览」+ 敌方「敌方惊变」**。
 *
 * 两者放进同一个 .lo-jbbar 的竖排 flex 容器 —— 各自绝对定位 + 手算偏移会在不同字号/缩放下重叠
 * （踩过：敌方按钮盖住了我方按钮），容器排布则永远不会。按钮外观共用 .lo-jbbtn（边框 + 右侧 3px 竖条
 * + 左浅右深的渐变），只靠 --ally / --enemy 换色：我方 mint，敌方红。判定与以前一致（只有炸惊档出现，
 * 两个 store 都读，理由见文件头的长注释）。面板内容按 source 取 jibian.pool / enemyJibian.pool。
 */
export function JibianListButtons() {
  const [open, setOpen] = useState(null);   // null | 'ally' | 'enemy'
  const zj = useStore((s) => isZjNow({ ...s, mode: loadoutStore.get().mode }, s));
  const m = data.get('assets');
  // leaving 炸惊档 (the switch, or the room's difficulty changing) closes the panel with it
  useEffect(() => { if (!zj) setOpen(null); }, [zj]);
  if (!zj) return null;
  const btn = (kind, txt, micro, tip) => html`<button type="button"
      class=${cx('lo-jbbtn', `lo-jbbtn--${kind}`, open === kind && 'is-on')}
      data-testid=${kind === 'ally' ? 'loadout-jibian-list' : 'loadout-enemy-jibian-list'}
      aria-expanded=${open === kind ? 'true' : 'false'} title=${t(tip)}
      onClick=${() => setOpen(open === kind ? null : kind)}>
      <span class="lo-jbbtn__txt">${t(txt)}</span>
      <span class="lo-jbbtn__micro num">${micro}</span>
    </button>`;
  return html`<${JibianConfigWarmup} />
    <div class="lo-jbbar">
      ${btn('enemy', '敌方惊变', 'ENEMY', '查看本模式全部敌方惊变')}
      ${btn('ally', '惊变一览', 'MUTATIONS', '查看本模式全部惊变')}
      ${btn('bonds', '羁绊一览', 'BONDS', '查看全部惊变羁绊（凑齐固定惊变获得加成）')}
    </div>
    ${open === 'bonds'
      ? html`<${JibianBondPanel} m=${m} onClose=${() => setOpen(null)} />`
      : open ? html`<${JibianListPanel} m=${m} source=${open} onClose=${() => setOpen(null)} />` : null}`;
}

/** 兼容旧名字（screens/loadout.js 早期只挂了我方那个）。 */
export const JibianListButton = JibianListButtons;

/**
 * 干员调配右下角的「敌方惊变」: same gating and self-containment as JibianListButton (炸惊档 only), but the
 * panel lists `modes[<id>].enemyJibian.pool` — the 15 cards the server draws for the ENEMY side on rounds 1 and 6
 * (规则14, two cards live at once and stack). Red so the two lists are told apart at a glance; it sits just above
 * the 「惊变一览」 button (that one already rests on the screen's bottom edge, so there is no room below it).
 */
export function EnemyJibianListButton() {
  const [open, setOpen] = useState(false);
  const zj = useStore((s) => isZjNow({ ...s, mode: loadoutStore.get().mode }, s));
  const m = data.get('assets');
  useEffect(() => { if (!zj) setOpen(false); }, [zj]);
  if (!zj) return null;
  return html`<${JibianConfigWarmup} />
    <button type="button" class=${cx('lo-ejbbtn', open && 'is-on')} data-testid="loadout-enemy-jibian-list"
      aria-expanded=${open ? 'true' : 'false'} title=${t('查看本模式全部敌方惊变')} onClick=${() => setOpen(true)}>
      <span class="lo-ejbbtn__txt">${t('敌方惊变')}</span>
      <span class="lo-ejbbtn__micro num">ENEMY</span>
    </button>
    ${open ? html`<${JibianListPanel} m=${m} source="enemy" onClose=${() => setOpen(false)} />` : null}`;
}

/**
 * 羁绊一览面板（2026-10-19，owner）：列出 data/jibianBonds.json 里的每个羁绊 ——
 * 名字、档位阈值、成员（用 config 池里的卡名显示）、效果。
 * 数据只在打开时拉一次（`/data/jibianBonds.json`），失败就显示空列表，绝不抛。
 */
function JibianBondPanel({ m, onClose }) {
  const [bonds, setBonds] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch('/data/jibianBonds.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!alive) return; setBonds(j && Array.isArray(j.bonds) ? j.bonds : []); })
      .catch(() => { if (alive) setBonds([]); });
    return () => { alive = false; };
  }, []);

  // effectId → 卡名（从本模式的惊变池里取；取不到就显示 id）
  const nameOf = (id) => {
    const mode = getMode(jibianModeId());
    const pool = (mode && mode.jibian && Array.isArray(mode.jibian.pool)) ? mode.jibian.pool : [];
    const hit = pool.find((c) => c && c.effectId === id);
    return (hit && hit.name) || id;
  };

  const list = bonds || [];
  return html`<div role="presentation"
      style="position:fixed;inset:0;z-index:60;display:flex;align-items:flex-start;justify-content:center;padding:5vh 12px;overflow:auto;background:rgba(0,0,0,.62)"
      onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true"
      style="width:min(920px,94vw);max-height:88vh;overflow:auto;background:#0f1614;border:1px solid rgba(150,220,200,.28);border-radius:10px;padding:18px 20px">
      <header class="modal__head">
        <div class="mm-modal__title-row">
          <h2 class="modal__title">${t('羁绊一览')}</h2>
          <button type="button" class="mm-modal__close" onClick=${onClose} aria-label=${t('关闭')}>×</button>
        </div>
        <p style="margin:6px 0 0;opacity:.7;font-size:13px">${t('凑齐指定惊变即可获得羁绊加成')}</p>
      </header>
      <div class="modal__body" style="display:flex;flex-direction:column;gap:10px">
        ${bonds == null
          ? html`<p style="opacity:.7">${t('加载中…')}</p>`
          : list.length === 0
          ? html`<p style="opacity:.7">${t('没有羁绊数据')}</p>`
          : list.map((b) => html`<div key=${b.id}
              style="border:1px solid rgba(160,172,168,.28);border-radius:8px;padding:10px 12px;background:rgba(10,16,15,.5)">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <b style="font-size:16px">${b.name}</b>
                ${(b.tiers || []).map((n, i) => html`<span key=${i}
                  style="border:1px dashed rgba(232,163,61,.55);border-radius:4px;padding:0 6px;color:#e8a33d;font-size:12.5px"
                >${i === 0 ? t('一档 {n}', { n }) : t('二档 {n}', { n })}</span>`)}
              </div>
              <div style="margin-top:6px;color:#c8d2ce;font-size:13.5px;line-height:1.5">${b.effect || ''}</div>
              <div style="margin-top:6px;color:#8d9a96;font-size:12.5px">
                ${t('所属惊变')}：${(b.members || []).map((id) => nameOf(id)).join('、')}
              </div>
            </div>`)}
      </div>
    </div>
  </div>`;
}

/**
 * 先把 config.json 拉起来并在它落地时重绘（组件在 html 模板里当标签用，所以名字要大写）。
 * 惊变池就在这个文件里：不订阅的话，面板可能在 config 还没到时打开而显示「没有惊变数据」，且之后不再重绘。
 * 自身不画任何东西 —— 与项目里 useData 的订阅方式一致（data.subscribe + data.load）。
 */
function JibianConfigWarmup() {
  const [, force] = useReducer((c) => c + 1, 0);
  useEffect(() => {
    let alive = true;
    const unsub = data.subscribe((n) => { if (alive && n === 'config') force(); });
    data.load('config');
    return () => { alive = false; unsub(); };
  }, []);
  return null;
}
