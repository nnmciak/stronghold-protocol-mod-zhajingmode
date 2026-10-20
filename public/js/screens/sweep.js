// S.W.E.E.P.报告 (2026-10-13, the owner's request: the event's report screen, laid out after the video 2:17–3:03; every
// drawing here is original, the art is the game's own icons): a full-screen overlay opened from the lobby's plate, three tabs —
//   盟约报告 — 核心盟约 / 附加盟约 tiles (bonds.json isCore); the left panel: the glyph, the name, 激活所需人数 and the
//              thresholds, the description, 对应干员 (visibleMembers by tier; 替补 on an operator marked 未持有 in 干员持有;
//              a tap opens 干员调配 at the operator, over this screen);
//   策略报告 — the strategies (bands.json) as tiles; the left: icon, name, 初始生命值, the effect, the modes it is offered
//              in and its bonds;
//   敌方资料 — 领袖 (bosses.json, the hidden variants left out) and 战术特训敌人 (factions.json types) tiles; the left: art,
//              name, text and the leader with its escorts / the type's enemies; 查看 opens the enemy codex (全部 / 普通 /
//              精英 / 领袖, a search, letter grades from the spread of the game's own enemies with the numbers beside them).
// ⓘ opens 玩法说明 at its 进阶图鉴 chapter. Esc closes the codex first, then the screen. The tab is remembered.
// It comes up from black over the hub and fades back out like the other hub screens (ui/transitions.js).
// Styles: css/screens/lobby.css (sw-*).

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, roman } from '../ui/components.js';
import { Img, RichText, GIcon } from '../ui/gameComponents.js';
import { bondIconUrl, bandIconUrl, enemyIconUrl, factionIconUrl, chessAvatarUrl } from '../ui/assetUrls.js';
import { attackInterval, fmtNum } from '../ui/gameLogic.js';
import { abilityRows } from '../ui/abilityLines.js';
import { data, useData, getBond, setZjBonds, zjBondsEnabled } from '../data.js';
import { useStore, loadPref, savePref } from '../store.js';
import { loadoutStore, openLoadout } from '../ui/loadoutSync.js';
import { openGuide, guidePages, guideStore } from '../ui/guide.js';
import { useLeave } from '../ui/transitions.js';
import { t, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const TAB_PREF = 'sweep.tab';
const TABS = [
  { id: 'bonds', name: N_('盟约报告'), icon: () => html`<${Icon} name="link" />` },
  { id: 'bands', name: N_('策略报告'), icon: () => html`<${Icon} name="rook" />` },
  { id: 'enemies', name: N_('敌方资料'), icon: () => html`<${GIcon} name="target" />` },
];
const MODE_NAME = { SINGLE: N_('独立模拟'), MULTI: N_('同盟模拟') };
const RANK = { NORMAL: N_('普通'), ELITE: N_('精英'), BOSS: N_('领袖') };
const APPLY = { MELEE: N_('近战'), RANGED: N_('远程'), ALL: N_('近战 / 远程'), NONE: N_('不攻击') };
const DMG = { phys: N_('物理'), arts: N_('法术'), heal: N_('治疗') };

// ---- enemy grades ------------------------------------------------------------------------------------------------------

const GRADES = ['E', 'D', 'C', 'B', 'B+', 'A', 'A+', 'S'];
/**
 * Cut points per stat (a value at or past cut i earns GRADES[i + 1]), read off the spread of enemies.json — the codex's
 * letters say where an enemy stands among this game's enemies; the number beside each is the real one. `low`: smaller is
 * better (the attack interval).
 */
const CUTS = {
  maxHp: [2000, 5000, 10000, 20000, 40000, 80000, 200000],
  atk: [200, 300, 450, 650, 850, 1100, 1600],
  def: [50, 150, 300, 500, 800, 1100, 1600],
  res: [10, 20, 35, 50, 60, 70, 85],
  moveSpeed: [0.5, 0.7, 0.9, 1.1, 1.3, 1.6, 2],
  interval: { low: true, cuts: [5, 3.5, 2.5, 2, 1.6, 1.2, 0.8] },
  elementRes: [1, 3, 5, 8, 10, 15, 20],
  elementDmgRes: [1, 5, 10, 20, 30, 40, 50],
};

/** Letter grade of one stat ('—' when the enemy has none: no attack, no movement). @param {string} key @param {any} v */
export function enemyGrade(key, v) {
  const spec = CUTS[key];
  const n = Number(v);
  if (!spec || v == null || !Number.isFinite(n)) return '—';
  const low = !Array.isArray(spec) && spec.low;
  const cuts = Array.isArray(spec) ? spec : spec.cuts;
  let g = 0;
  for (let i = 0; i < cuts.length; i++) if (low ? n <= cuts[i] : n >= cuts[i]) g = i + 1;
  return GRADES[g];
}

/**
 * The codex's enemies: every enemy but the summon-only ones, one per 图鉴 number (a hidden boss variant shares its
 * number), by id.
 * @param {any[]} list enemies.json records
 */
export function codexEnemies(list) {
  const seen = new Set();
  const out = [];
  const num = (k) => { const m = /enemy_(\d+)/.exec(k || ''); return m ? Number(m[1]) : 1e9; };
  for (const e of [...(Array.isArray(list) ? list : [])].sort((a, b) => num(a?.key) - num(b?.key) || String(a?.key).localeCompare(String(b?.key)))) {
    if (!e || typeof e.key !== 'string' || e.tokenOnly) continue;
    const id = e.handbookIndex ? `${e.handbookIndex}|${e.name}` : e.key;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(e);
  }
  return out;
}

/** Unique enemy keys of a boss: the leader, then its escorts (every template). @param {any} boss bosses.json record */
export function bossEnemyKeys(boss) {
  const keys = [boss?.enemyKey];
  for (const list of Object.values(boss?.escortsByTemplate || {})) for (const e of Array.isArray(list) ? list : []) keys.push(e?.key);
  return [...new Set(keys.filter((k) => typeof k === 'string' && k))];
}

// ---- small pieces ------------------------------------------------------------------------------------------------------

/** The big square at the top of the left panel (bracket corners, a ring behind a glyph or the art). */
function Hero({ src, glyph = false, art = false, name, sub = null, fallback }) {
  return html`<div class="sw-hero">
    <span class=${cx('sw-hero__box', glyph && 'is-glyph', art && 'is-art')}>
      <i class="sw-hero__c sw-hero__c--tl"></i><i class="sw-hero__c sw-hero__c--br"></i>
      <span class="sw-hero__img"><${Img} src=${src} fallback=${fallback} /></span>
    </span>
    <h3 class="sw-hero__name">${name}</h3>
    ${sub ? html`<span class="sw-hero__sub">${sub}</span>` : null}
  </div>`;
}

/** One tile of the right grid. */
function Tile({ on, onClick, title, kind, children, badge = null }) {
  return html`<button type="button" class=${cx('sw-tile', `sw-tile--${kind}`, on && 'is-on')} onClick=${onClick} title=${title} aria-pressed=${on ? 'true' : 'false'}>
    <span class="sw-tile__in">${children}</span>${badge}
  </button>`;
}

/** A section of the right grid: a glyph above `[ name ]`, then its tiles. */
function Section({ name, glyph, children, count = null }) {
  return html`<section class="sw-sec">
    <header class="sw-sec__head">
      <span class="sw-sec__glyph">${glyph}</span>
      <span class="sw-sec__name"><i>[</i>${name}${count != null ? html`<small class="num">${count}</small>` : null}<i>]</i></span>
    </header>
    <div class="sw-sec__grid">${children}</div>
  </section>`;
}

/** A small enemy thumbnail with its 图鉴 number in the corner. */
function EnemyThumb({ e, m, on = false, onClick = null, size = 'sm' }) {
  const Tag = onClick ? 'button' : 'span';
  return html`<${Tag} type=${onClick ? 'button' : undefined} class=${cx('sw-eth', `sw-eth--${size}`, on && 'is-on', e.rank === 'BOSS' && 'is-boss', e.rank === 'ELITE' && 'is-elite')}
      onClick=${onClick} title=${e.name}>
    <${Img} src=${enemyIconUrl(m, e.key)} fallback=${html`<${GIcon} name="skull" />`} />
    ${e.handbookIndex ? html`<span class="sw-eth__no">${e.handbookIndex}</span>` : null}
  <//>`;
}

// ---- 盟约报告 ----------------------------------------------------------------------------------------------------------

/**
 * ★ 2026-10-13（用户）：「对应干员」原来只读 bonds.json 的手工名单（visibleMembers），而名单严重滞后 ✗
 * —— 例如企鹅物流名单里没有德克萨斯/缄默德克萨斯/能天使 ✗，叙拉古、炎等也缺一大批 ✗。
 * 真实成员写在棋子记录的 `bonds` 里（= 游戏实际用的那份 ✓），所以这里以【记录反查】为准、名单只作补充，
 * 两者取并集（名单里可能存在记录里没有的条目，保留）。结果按 bondId 缓存。
 */
const __membersByBond = new Map();
function membersFromRecords(bond) {
  const bid = bond && bond.bondId;
  const zjView = zjBondsEnabled();
  const raw = Array.isArray(bond && bond.visibleMembers) && bond.visibleMembers.length
    ? bond.visibleMembers.slice()
    : (Array.isArray(bond && bond.members) ? bond.members.slice() : []);
  // ★ 普通是普通、炸惊是炸惊：名单里不属于当前棋库的 id 先剔除
  //   （普通视图丢掉 chess_zj_*；炸惊视图先留普通 id，稍后由 zjChessOf 映射成炸惊记录）
  const listed = zjView ? raw : raw.filter((id) => !String(id || '').startsWith('chess_zj_'));
  if (!bid) return listed;
  const cacheKey = bid + '|' + (zjView ? 'zj' : 'n');
  let hit = __membersByBond.get(cacheKey);
  if (!hit) {
    hit = [];
    for (const c of (data.list('chess') || [])) {
      if (!c || !Array.isArray(c.bonds) || !c.bonds.includes(bid) || !c.chessId) continue;
      const isZj = c.zhajing === true;   // 棋库判定同上（不看前缀）
      if (zjView !== isZj) continue;   // ★ 普通视图只收普通记录、炸惊视图只收炸惊记录
      hit.push(c.chessId);
    }
    __membersByBond.set(cacheKey, hit);
  }
  const union = [...new Set([...listed, ...hit])];
  // 按 charId 去重：每位干员只留一个（优先非精锐 / _a），避免普通与精锐两条同时占位 ✓
  const seen = new Map();
  for (const id of union) {
    const c = data.lookup('chess', id);
    const key = (c && c.charId) ? c.charId : id;
    const cur = seen.get(key);
    if (!cur || (cur.golden && !(c && c.isGolden))) seen.set(key, { id, golden: !!(c && c.isGolden) });
  }
  return [...seen.values()].map((x) => x.id);
}

/**
 * ★ 2026-10-13（用户）：惊变（炸惊）模式下，盟约一览里的「对应数值」也要显示成蓝字。
 * 项目里蓝字就是 `<@ba.vup>`（richText.js:21 → .rt-vup，css/screens/game-panels.css:8 color:#3fb6ff）。
 * 炸惊的 `zj` 文案是纯文本（没有富文本标签），所以这里自动把数字包上蓝字标签：
 *   · 跳过 `{i:fmt}` 占位符（那是界面动态填的，包起来会坏 ✗）
 *   · 已在标签里的数字会变成嵌套（同色，无害 ✓）
 * 只在炸惊视图调用 ✓ 普通视图原样返回 ✓
 */
function blueNumbers(src) {
  const text = String(src == null ? '' : src);
  if (!text) return text;
  // 按 {0:0%} 这类占位符切分：奇数段是占位符，原样保留 ✓（避免把占位符里的数字包进标签 ✗）
  const parts = text.split(/(\{[^}]*\})/);
  return parts
    .map((seg, i) => (i % 2 === 1 ? seg : seg.replace(/(\d+(?:\.\d+)?\s*%?)/g, '<@ba.vup>$1</>')))
    .join('');
}

/**
 * ★ 2026-10-13（用户）：炸惊用的是另一套棋库（chess_zj_*，visible:false），同名干员的记录与阶数都不同。
 * 炸惊视图下把「对应干员」换成炸惊棋库里的同一名干员（按 charId 配对，口径同服务器 gamedata.chessInRoster：
 * 同 charId + 是否精锐配对）；炸惊棋库里没有的干员即为该模式不存在 → 不显示。
 * 普通视图原样返回。结果带缓存（棋库不变）。
 */
let __zjByChar = null;
function zjChessOf(chess) {
  if (!chess || !chess.charId) return chess;
  if (String(chess.chessId || '').startsWith('chess_zj_')) return chess;   // 本身就是炸惊记录 ✓
  if (!__zjByChar) {
    __zjByChar = new Map();
    for (const c of (data.list('chess') || [])) {
      if (!c || c.zhajing !== true || !c.charId) continue;   // 炸惊棋库 = zhajing === true（chess_zj_* 里有 4 条 zhajing:false 的副本不算棋库）
      const key = c.charId + '|' + (c.isGolden ? 'b' : 'a');
      if (!__zjByChar.has(key)) __zjByChar.set(key, c);
    }
  }
  const key = chess.charId + '|' + (chess.isGolden ? 'b' : 'a');
  return __zjByChar.get(key) || null;   // null = 炸惊棋库里没有这名干员
}

/**
 * ★ 2026-10-13（用户）：普通模式下不存在的盟约（只有炸惊 activeBondIds 收录的那些，如 岁 / 企鹅物流 / 医师），
 * 在【普通视图】下左栏数据一律显示 0 —— 判据取自 config.modes.mode_single_normal.activeBondIds，数据驱动、不写死名字。
 */
function normalBondIdSet() {
  const cfg = data.get('config') || {};
  const list = (((cfg.modes || {}).mode_single_normal || {}).activeBondIds) || [];
  return new Set(Array.isArray(list) ? list : []);
}
/** 该盟约在当前视图下是否应当"清 0"（只在普通视图、且普通模式名单里没有它时）。 */
function blankInNormal(bondId) {
  if (!bondId || zjBondsEnabled()) return false;
  const set = normalBondIdSet();
  return set.size > 0 && !set.has(bondId);
}

/**
 * ★ 2026-10-13（用户）：盟约报告的「普通 / 炸惊」切换。
 * 炸惊把每个盟约的文案/阈值/数值写在记录的 `zj` 块里（shared/zjBonds.js 合并，服务器按模式合并）。
 * 这里只翻 data.js 的开关：getBond() 随之返回合并后的记录，useData('bonds') 的订阅者会自动重绘。
 * 用现成的 .sw-pill / .sw-pill--ghost 表示选中/未选，不新增任何 CSS。
 */
function ZjSwitch() {
  const on = zjBondsEnabled();
  // 重绘由父组件的 useData('bonds', …) 订阅负责（setZjBonds 会 notifyBonds）✓
  const btn = (active) => 'all:unset;cursor:pointer;padding:0 .08rem;font-weight:700;opacity:' + (active ? '1' : '.4');
  return html`<span class="sw-pill" role="group" aria-label=${t('盟约视图')} title=${t('切换普通 / 炸惊模式的盟约效果')}>
    <button type="button" style=${btn(!on)}
      onClick=${() => setZjBonds(false)} aria-pressed=${on ? 'false' : 'true'}>${t('普通')}</button>
    <span style="opacity:.35;padding:0 .04rem">/</span>
    <button type="button" style=${btn(on)}
      onClick=${() => setZjBonds(true)} aria-pressed=${on ? 'true' : 'false'}>${t('炸惊')}</button>
  </span>`;
}

function BondPanel({ bond, m, notOwned }) {
  const blank = blankInNormal(bond.bondId);   // 普通视图下：普通模式没有的盟约 → 左栏清 0
  const off = new Set(Array.isArray(notOwned) ? notOwned : []);
  const rawIds = membersFromRecords(bond);   // 记录反查 ∪ 名单 ✓
  // 炸惊视图：换成炸惊棋库里的同一名干员（按 charId 配对）；炸惊没有的干员不显示 ✓
  const ids = zjBondsEnabled()
    ? rawIds.map((id) => zjChessOf(data.lookup('chess', id))).filter(Boolean).map((c) => c.chessId)
    : rawIds;
  const members = (blank ? [] : ids).map((id) => data.lookup('chess', id)).filter(Boolean)
    .sort((a, b) => (b.tier - a.tier) || ((a.shopSortId ?? 0) - (b.shopSortId ?? 0)));
  const anyOff = members.some((c) => off.has(c.chessId));
  const steps = Array.isArray(bond.thresholds) ? bond.thresholds.filter((n) => Number.isFinite(n)) : [];
  return html`<div class="sw-detail">
    <${Hero} src=${bondIconUrl(m, bond.bondId)} glyph=${true} name=${bond.name}
      fallback=${html`<span class="sw-hero__txt">${[...(bond.name || '?')][0]}</span>`} />
    <div class="sw-facts">
      <span class="sw-pill">${t('激活所需人数')}<b class="num">${blank ? 0 : (steps[0] ?? bond.activeCount ?? '—')}</b></span>
      ${steps.length > 1 ? html`<span class="sw-pill sw-pill--ghost" title=${t('达到这些人数时效果增强')}>${t('档位')}<b class="num">${steps.join(' / ')}</b></span>` : null}
      <span class="sw-kind">${bond.isCore ? t('核心盟约') : t('附加盟约')}</span>
      <${ZjSwitch} />
    </div>
    <div class="sw-text">${blank ? null : html`<${RichText} as="p" text=${zjBondsEnabled() ? blueNumbers(bond.descRaw || bond.desc || '') : (bond.descRaw || bond.desc || '')} />`}</div>
    ${members.length ? html`<div class="sw-box">
      <div class="sw-box__head">
        <span class="sw-box__k"><${Icon} name="user" />${t('对应干员')}<small class="num">${members.length}</small></span>
        <span class="sw-box__note">${anyOff ? html`<span class="sw-box__swap" aria-hidden="true">⇄</span>${t('未持有的干员由替补干员上场')}` : t('点击干员前往干员调配')}</span>
      </div>
      <div class="sw-ops">${members.map((c) => html`<button key=${c.chessId} type="button" class=${cx('sw-op', `sw-op--t${c.tier}`, off.has(c.chessId) && 'is-standin')}
          onClick=${() => openLoadout('sweep', c.chessId, 'loadout')} title=${t('{name} · 前往干员调配', { name: c.name })}>
        <${Img} src=${chessAvatarUrl(m, c)} fallback=${html`<span class="sw-op__txt">${[...(c.name || '?')][0]}</span>`} />
        <span class="sw-op__tier">${roman(c.tier)}</span>
        ${off.has(c.chessId) ? html`<span class="sw-op__sub">${t('替补')}</span>` : null}
      </button>`)}</div>
    </div>` : null}
  </div>`;
}

function BondsTab({ m, sel, onSel }) {
  const all = (data.list('bonds') || []).filter((b) => b && b.bondId).sort((a, b) => (a.identifier ?? 99) - (b.identifier ?? 99));
  const sections = [
    { id: 'core', name: t('核心盟约'), glyph: html`<${GIcon} name="flag" />`, items: all.filter((b) => b.isCore) },
    { id: 'extra', name: t('附加盟约'), glyph: html`<${Icon} name="link" />`, items: all.filter((b) => !b.isCore) },
  ];
  return sections.map((s) => s.items.length ? html`<${Section} key=${s.id} name=${s.name} glyph=${s.glyph} count=${s.items.length}>
    ${s.items.map((b) => html`<${Tile} key=${b.bondId} kind="bond" on=${sel === b.bondId} onClick=${() => onSel(b.bondId)} title=${b.name}>
      <span class="sw-disc"><${Img} src=${bondIconUrl(m, b.bondId)} fallback=${html`<span class="sw-disc__txt">${[...(b.name || '?')][0]}</span>`} /></span>
      <span class="sw-tile__cap">${b.name}</span>
    <//>`)}
  <//>` : null);
}

// ---- 策略报告 ----------------------------------------------------------------------------------------------------------

function BandPanel({ band, m }) {
  const modes = (Array.isArray(band.modeTypeList) ? band.modeTypeList : []).filter((k) => MODE_NAME[k]);
  const bonds = (Array.isArray(band.bondIds) ? band.bondIds : []).map((id) => getBond(id)).filter(Boolean);
  return html`<div class="sw-detail">
    <${Hero} src=${bandIconUrl(m, band.bandId)} art=${true} name=${band.name}
      fallback=${html`<span class="sw-hero__txt">${[...(band.name || '?')][0]}</span>`} />
    <div class="sw-facts">
      <span class="sw-pill">${t('初始生命值')}<b class="num">${band.totalHp ?? '—'}</b></span>
      ${modes.map((k) => html`<span key=${k} class="sw-pill sw-pill--ghost">${t(MODE_NAME[k])}</span>`)}
    </div>
    <div class="sw-text">
      ${band.effectName ? html`<h4 class="sw-text__h">${band.effectName}</h4>` : null}
      <${RichText} as="p" text=${band.descRaw || band.desc || ''} />
      ${bonds.length ? html`<p class="sw-text__bonds">${t('相关盟约')}${bonds.map((b) => html`<span key=${b.bondId} class="sw-chip">
        <${Img} src=${bondIconUrl(m, b.bondId)} />${b.name}</span>`)}</p>` : null}
    </div>
  </div>`;
}

function BandsTab({ m, sel, onSel }) {
  const all = (data.list('bands') || []).filter((b) => b && b.bandId).sort((a, b) => (a.sortId ?? 99) - (b.sortId ?? 99));
  return html`<${Section} name=${t('策略')} glyph=${html`<${Icon} name="rook" />`} count=${all.length}>
    ${all.map((b) => html`<${Tile} key=${b.bandId} kind="band" on=${sel === b.bandId} onClick=${() => onSel(b.bandId)} title=${b.name}>
      <span class="sw-face"><${Img} src=${bandIconUrl(m, b.bandId)} fallback=${html`<span class="sw-face__txt">${[...(b.name || '?')][0]}</span>`} /></span>
      <span class="sw-tile__cap">${b.name}</span>
      <span class="sw-tile__hp num" title=${t('初始生命值')}>${b.totalHp}</span>
    <//>`)}
  <//>`;
}

// ---- 敌方资料 ----------------------------------------------------------------------------------------------------------

/** The enemies tab's entries: { kind: 'boss'|'type', id }. */
const bossList = () => (data.list('bosses') || []).filter((b) => b && b.bossId && !b.hidden).sort((a, b) => (a.sortId ?? 99) - (b.sortId ?? 99));
const typeList = () => Object.values(data.get('factions')?.types || {}).filter((f) => f && f.type).sort((a, b) => (a.sortId ?? 99) - (b.sortId ?? 99));
const typeKeys = (f) => [...new Set([...(Array.isArray(f?.pool) ? f.pool : []), ...(Array.isArray(f?.entries) ? f.entries : [])])];

function EnemyPanel({ sel, m, onCodex }) {
  if (sel.kind === 'boss') {
    const boss = data.lookup('bosses', sel.id);
    if (!boss) return null;
    const e = data.lookup('enemies', boss.enemyKey);
    const escorts = bossEnemyKeys(boss).slice(1).map((k) => data.lookup('enemies', k)).filter(Boolean);
    return html`<div class="sw-detail">
      <${Hero} src=${enemyIconUrl(m, boss.enemyKey)} art=${true} name=${boss.name} fallback=${html`<${GIcon} name="skull" />`} />
      <div class="sw-text"><${RichText} as="p" text=${e?.descRaw || e?.desc || ''} /></div>
      <div class="sw-box">
        <div class="sw-box__head">
          <span class="sw-box__k"><${GIcon} name="skull" />${t('敌方领袖')}</span>
          <button type="button" class="sw-look" onClick=${() => onCodex({ title: boss.name, keys: bossEnemyKeys(boss), key: boss.enemyKey })}><${Icon} name="search" />${t('查看')}</button>
        </div>
        <div class="sw-ethumbs">
          ${e ? html`<${EnemyThumb} e=${e} m=${m} onClick=${() => onCodex({ title: boss.name, keys: bossEnemyKeys(boss), key: e.key })} />` : null}
          ${escorts.length ? html`<span class="sw-ethumbs__sep">${t('护卫')}</span>` : null}
          ${escorts.map((x) => html`<${EnemyThumb} key=${x.key} e=${x} m=${m} onClick=${() => onCodex({ title: boss.name, keys: bossEnemyKeys(boss), key: x.key })} />`)}
        </div>
      </div>
    </div>`;
  }
  const f = data.get('factions')?.types?.[sel.id];
  if (!f) return null;
  const list = typeKeys(f).map((k) => data.lookup('enemies', k)).filter(Boolean);
  const keys = codexEnemies(list).map((e) => e.key);
  const shown = keys.map((k) => data.lookup('enemies', k));
  return html`<div class="sw-detail">
    <${Hero} src=${factionIconUrl(m, f.icon)} glyph=${true} name=${f.name} fallback=${html`<${GIcon} name="target" />`} />
    <div class="sw-text"><p class="rt">${f.desc || ''}</p></div>
    <div class="sw-box">
      <div class="sw-box__head">
        <span class="sw-box__k"><${GIcon} name="target" />${t('敌方情报')}<small class="num">${shown.length}</small></span>
        <button type="button" class="sw-look" onClick=${() => onCodex({ title: f.name, keys, key: keys[0] })}><${Icon} name="search" />${t('查看')}</button>
      </div>
      <div class="sw-ethumbs sw-ethumbs--grid">
        ${shown.map((x) => html`<${EnemyThumb} key=${x.key} e=${x} m=${m} onClick=${() => onCodex({ title: f.name, keys, key: x.key })} />`)}
      </div>
    </div>
  </div>`;
}

function EnemiesTab({ m, sel, onSel, onCodex }) {
  const bosses = bossList();
  const types = typeList();
  const total = codexEnemies(data.list('enemies') || []).length;
  return html`
    <${Section} name=${t('领袖')} glyph=${html`<${GIcon} name="skull" />`} count=${bosses.length}>
      ${bosses.map((b) => html`<${Tile} key=${b.bossId} kind="boss" on=${sel.kind === 'boss' && sel.id === b.bossId} onClick=${() => onSel({ kind: 'boss', id: b.bossId })} title=${b.name}>
        <span class="sw-art"><${Img} src=${enemyIconUrl(m, b.enemyKey)} fallback=${html`<${GIcon} name="skull" />`} /></span>
        <span class="sw-tile__cap">${b.name}</span>
      <//>`)}
    <//>
    <${Section} name=${t('战术特训敌人')} glyph=${html`<${GIcon} name="target" />`} count=${types.length}>
      ${types.map((f) => html`<${Tile} key=${f.type} kind="type" on=${sel.kind === 'type' && sel.id === f.type} onClick=${() => onSel({ kind: 'type', id: f.type })} title=${f.name}>
        <span class="sw-glyph"><${Img} src=${factionIconUrl(m, f.icon)} fallback=${html`<${GIcon} name="target" />`} /></span>
        <span class="sw-tile__cap">${String(f.name || f.type).replace(t('特训敌人·'), '')}</span>
      <//>`)}
    <//>
    <button type="button" class="sw-allcodex" onClick=${() => onCodex({ title: null, keys: null, key: null })}>
      <${GIcon} name="skull" /><span><b>${t('敌方图鉴')}</b><small>${t('全部 {n} 种敌人 · 评级与实际数值', { n: total })}</small></span><${Icon} name="chevronRight" />
    </button>`;
}

// ---- the enemy codex ---------------------------------------------------------------------------------------------------

const STAT_ROWS = [
  ['maxHp', N_('生命值'), 'plus'], ['moveSpeed', N_('移动速度'), 'chevrons'],
  ['atk', N_('攻击力'), 'sword'], ['interval', N_('攻击速度'), 'hourglass'],
  ['def', N_('防御力'), 'shield'], ['elementRes', N_('元素抗性'), 'snow'],
  ['res', N_('法术抗性'), 'info'], ['elementDmgRes', N_('损伤抵抗'), 'box'],
];

function statValue(e, key) {
  const s = e?.stats || {};
  if (key === 'interval' || key === 'atk') {
    if (e?.applyWay === 'NONE' && !(Number(s.atk) > 0)) return null; // never attacks
    return key === 'atk' ? s.atk ?? 0 : attackInterval(s.bat, s.aspd);
  }
  if (key === 'moveSpeed') return Number(s.moveSpeed) > 0 ? s.moveSpeed : null;
  return s[key] ?? 0;
}
function statText(key, v) {
  if (v == null) return '—';
  if (key === 'interval') return `${Math.round(v * 10) / 10}s`;
  if (key === 'moveSpeed') return String(Math.round(v * 100) / 100);
  return fmtNum(v);
}

function CodexDetail({ e, m }) {
  const s = e.stats || {};
  const factions = data.get('factions')?.types || {};
  const types = (Array.isArray(e.acTypes) ? e.acTypes : e.acType ? [e.acType] : []).filter((k) => factions[k]);
  const imm = Object.entries(s.immunities || {}).filter(([, v]) => v).map(([k]) => ({ stun: t('晕眩'), silence: t('沉默'), sleep: t('沉睡'), frozen: t('冻结'), levitate: t('浮空') }[k] || k));
  const abil = abilityRows(e.abilities, false);
  const dmg = (Array.isArray(s.dmgTypes) && s.dmgTypes.length ? s.dmgTypes : [s.dmgType]).filter((k) => DMG[k]).map((k) => t(DMG[k]));
  return html`<div class="sw-cd" key=${e.key}>
    <div class="sw-cd__head">
      <span class="sw-cd__cat">${t(RANK[e.rank] || RANK.NORMAL)}${s.motion === 'FLY' ? ` · ${t('空中')}` : ''}</span>
      <h3 class="sw-cd__name">${e.handbookIndex ? html`<span class="sw-cd__no">${e.handbookIndex}</span>` : null}${e.name}</h3>
      <span class="sw-cd__way">${t(APPLY[e.applyWay] || APPLY.MELEE)}${dmg.length ? ` ${dmg.join(' / ')}` : ''}</span>
      <span class="sw-cd__lp" title=${t('漏过时扣除的目标生命值')}><${Icon} name="rook" /><b class="num">${s.lpr ?? 1}</b></span>
      ${types[0] ? html`<span class="sw-cd__mark" aria-hidden="true"><${Img} src=${factionIconUrl(m, factions[types[0]].icon)} /></span>` : null}
    </div>
    <div class="sw-cd__main">
      <div class="sw-cd__art">
        <span class="sw-cd__img"><${Img} src=${enemyIconUrl(m, e.key)} fallback=${html`<${GIcon} name="skull" />`} /></span>
        <span class="sw-cd__mass" title=${t('重量等级：越重越难被推动或拉动')}><${Icon} name="box" />${t('重量')}<b class="num">${s.massLevel ?? 0}</b></span>
      </div>
      <div class="sw-cd__stats">${STAT_ROWS.map(([k, label, icon]) => {
        const v = statValue(e, k);
        return html`<span key=${k} class="sw-stat">
          <span class="sw-stat__k"><${Icon} name=${icon} />${t(label)}</span>
          <small class="sw-stat__v num">${statText(k, v)}</small>
          <b class=${cx('sw-stat__g', `g-${enemyGrade(k, v).replace('+', 'p').replace('—', 'none')}`)}>${enemyGrade(k, v)}</b>
        </span>`;
      })}</div>
    </div>
    ${e.descRaw || e.desc ? html`<${RichText} as="p" text=${e.descRaw || e.desc} class="sw-cd__desc" />` : null}
    ${types.length ? html`<p class="sw-cd__types">${types.map((k) => html`<span key=${k} class="sw-chip"><${Img} src=${factionIconUrl(m, factions[k].icon)} />${factions[k].name}</span>`)}</p>` : null}
    <h4 class="sw-cd__h">${t('能力')}</h4>
    <ul class="sw-cd__abil">
      ${abil.length ? abil.map((a, i) => html`<li key=${i}><${RichText} text=${a.text} /></li>`) : html`<li class="t-dim">${t('无特殊能力')}</li>`}
      ${imm.length ? html`<li>${t('免疫：{list}', { list: imm.join('、') })}</li>` : null}
    </ul>
  </div>`;
}

const RANK_TABS = [['all', N_('全部')], ['NORMAL', N_('普通')], ['ELITE', N_('精英')], ['BOSS', N_('领袖')]];

/** The enemy codex over the report: a list at the left, the detail at the right. */
function EnemyCodex({ open, m, onClose }) {
  const [rank, setRank] = useState('all');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState(open.keys);
  const [sel, setSel] = useState(open.key);
  const all = useMemo(() => codexEnemies(data.list('enemies') || []), [data.get('enemies')]);
  const pool = scope ? scope.map((k) => data.lookup('enemies', k)).filter(Boolean) : all;
  const needle = q.trim().toLowerCase();
  const list = pool.filter((e) => (rank === 'all' || e.rank === rank)
    && (!needle || String(e.name || '').toLowerCase().includes(needle) || String(e.handbookIndex || '').toLowerCase().includes(needle)));
  const cur = list.find((e) => e.key === sel) || list[0] || null;
  const counts = Object.fromEntries(RANK_TABS.map(([k]) => [k, pool.filter((e) => k === 'all' || e.rank === k).length]));
  return html`<div class="sw-codex" role="dialog" aria-label=${t('敌方图鉴')}>
    <div class="sw-codex__top">
      <button type="button" class="sw-back" onClick=${onClose} aria-label=${t('返回')} title=${t('返回 (Esc)')}><${Icon} name="chevronLeft" /></button>
      <span class="sw-codex__title">${t('敌方图鉴')}</span>
      ${scope ? html`<button type="button" class="sw-scope" onClick=${() => setScope(null)} title=${t('显示全部敌人')}>${open.title || t('筛选')}<${Icon} name="close" /></button>` : null}
      <label class="sw-search"><${Icon} name="search" /><input type="search" value=${q} placeholder=${t('名称或编号')} onInput=${(ev) => setQ(ev.currentTarget.value)} /></label>
    </div>
    <div class="sw-codex__body">
      <div class="sw-codex__list">
        ${list.length ? list.map((e) => html`<${EnemyThumb} key=${e.key} e=${e} m=${m} size="md" on=${cur?.key === e.key} onClick=${() => setSel(e.key)} />`)
          : html`<p class="sw-codex__empty">${t('没有符合条件的敌人')}</p>`}
      </div>
      <div class="sw-codex__side">
        <div class="sw-ranks" role="tablist">
          <span class="sw-ranks__n num" title=${t('当前列表')}>${list.length}</span>
          ${RANK_TABS.map(([k, label]) => html`<button key=${k} type="button" role="tab" aria-selected=${rank === k ? 'true' : 'false'} class=${cx(rank === k && 'is-on')}
            disabled=${k !== 'all' && !counts[k]} onClick=${() => setRank(k)}>${t(label)}</button>`)}
        </div>
        ${cur ? html`<${CodexDetail} e=${cur} m=${m} />` : null}
      </div>
    </div>
  </div>`;
}

// ---- the screen --------------------------------------------------------------------------------------------------------

/** First page of 玩法说明's 进阶图鉴 chapter (0 when the pages are not listed). */
function handbookPage() {
  const i = guidePages().findIndex((p) => p.key === 'autochess_handbook_1');
  return i < 0 ? 0 : i;
}

/**
 * The report overlay. @param {{ onClose: () => void }} props
 */
export function SweepReport({ onClose }) {
  const ready = useData('bonds', 'bands', 'bosses', 'factions', 'enemies', 'chess', 'assets', 'config');
  // ★ 离开报告界面时还原为普通视图（炸惊视图只在本页有效，不影响大厅其它界面）
  useEffect(() => () => { setZjBonds(false); }, []); // __zjReset
  useData('local');
  const m = data.get('assets');
  const notOwned = useStore((s) => s.notOwned, Object.is, loadoutStore);
  const [tab, setTabState] = useState(() => { const v = loadPref(TAB_PREF, 'bonds'); return TABS.some((x) => x.id === v) ? v : 'bonds'; });
  const setTab = (v) => { setTabState(v); savePref(TAB_PREF, v); };
  const [bondSel, setBondSel] = useState(null);
  const [bandSel, setBandSel] = useState(null);
  const [enemySel, setEnemySel] = useState(null);
  const [codex, setCodex] = useState(null);
  const [leaving, leave] = useLeave(onClose);

  // defaults once the data is there: the first tile of each tab
  const bonds = ready ? (data.list('bonds') || []).filter((b) => b && b.bondId).sort((a, b) => (a.identifier ?? 99) - (b.identifier ?? 99)) : [];
  const bands = ready ? (data.list('bands') || []).filter((b) => b && b.bandId).sort((a, b) => (a.sortId ?? 99) - (b.sortId ?? 99)) : [];
  const bond = getBond(bondSel) || bonds[0] || null;
  const band = data.lookup('bands', bandSel) || bands[0] || null;
  const firstBoss = ready ? bossList()[0] : null;
  const eSel = enemySel || (firstBoss ? { kind: 'boss', id: firstBoss.bossId } : null);

  useEffect(() => {
    document.body.classList.add('sw-open');
    return () => document.body.classList.remove('sw-open');
  }, []);
  // registered once, so it runs before the handlers of what opens above (干员调配 from a member, 玩法说明, a dialog),
  // which keep their own Esc
  const esc = useRef(null);
  esc.current = () => (codex ? setCodex(null) : leave());
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key !== 'Escape' || ev.defaultPrevented) return;
      if (loadoutStore.get().open || guideStore.get().open || document.querySelector('.modal, .guide')) return;
      ev.preventDefault();
      esc.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  let left = null;
  let right = null;
  if (!ready) {
    right = html`<p class="sw-loading">${t('正在读取报告…')}</p>`;
  } else if (tab === 'bonds') {
    left = bond ? html`<${BondPanel} key=${bond.bondId} bond=${bond} m=${m} notOwned=${notOwned} />` : null;
    right = html`<${BondsTab} m=${m} sel=${bond?.bondId} onSel=${setBondSel} />`;
  } else if (tab === 'bands') {
    left = band ? html`<${BandPanel} key=${band.bandId} band=${band} m=${m} />` : null;
    right = html`<${BandsTab} m=${m} sel=${band?.bandId} onSel=${setBandSel} />`;
  } else {
    left = eSel ? html`<${EnemyPanel} key=${`${eSel.kind}:${eSel.id}`} sel=${eSel} m=${m} onCodex=${setCodex} />` : null;
    right = html`<${EnemiesTab} m=${m} sel=${eSel || {}} onSel=${setEnemySel} onCodex=${setCodex} />`;
  }

  return html`<div class=${cx('sw', leaving && 'is-leaving')} data-tab=${tab}>
    <div class="sw__bg" aria-hidden="true"><i class="sw__mist"></i><i class="sw__lines"></i></div>
    <header class="sw-top">
      <div class="sw-top__left">
        <button type="button" class="sw-back" onClick=${leave} aria-label=${t('返回')} title=${t('返回 (Esc)')}>
          <${Icon} name="chevronLeft" /><span class="sw-back__mark">S.W.E.E.P.</span>
        </button>
        <button type="button" class="sw-info" onClick=${() => openGuide(handbookPage())} aria-label=${t('进阶图鉴')} title=${t('进阶图鉴：敌人类型、盟约、策略与轮选')}><${Icon} name="info" /></button>
      </div>
      <nav class="sw-tabs" role="tablist" aria-label=${t('S.W.E.E.P.报告')}>
        ${TABS.map((x) => html`<button key=${x.id} type="button" role="tab" aria-selected=${tab === x.id ? 'true' : 'false'} class=${cx('sw-tab', tab === x.id && 'is-on')}
          onClick=${() => setTab(x.id)}><span class="sw-tab__icon">${x.icon()}</span><span>${t(x.name)}</span></button>`)}
      </nav>
    </header>
    <main class="sw-body">
      <aside class="sw-left">${left}</aside>
      <div class="sw-right">${right}</div>
    </main>
    ${codex ? html`<${EnemyCodex} key=${`${codex.title}|${codex.key}`} open=${codex} m=${m} onClose=${() => setCodex(null)} />` : null}
  </div>`;
}
