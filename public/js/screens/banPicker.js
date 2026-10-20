// screens/banPicker.js — 卡池预选: 自选要 ban 的盟约, per difficulty, with the 大盟约 「特别关心 ❤」 mark.
//
// WHY IT EXISTS. The 100-seat variant gives every player a pool of its own (server/match/player/rules.js INDEPENDENT
// POOL: the full original copy count of every non-banned base chess), so the player's own 盟约 ban list decides what
// its shop can offer — every player's shop is different. Before this screen the bans were a single random draw shared
// by the whole room; now each player picks, and the remaining quota is filled randomly unless the player turns that
// off.
//
// The mark 「特别关心 ❤」 is 大盟约-only and means "never ban this one": it is lifted out of the ban list and the
// random fill skips it, so a favourite is guaranteed to be in this player's pool.
//
// The lists are PER DIFFICULTY (the quota depends on it, and the player picks before a room exists). A hook-free view:
// the state lives in ui/loadoutSync.js (`bans`) and the model in ui/loadoutModel.js.

import { html, MicroLabel, Icon, Button } from '../ui/components.js';
import { data } from '../data.js';
import { banEntryOf } from '../ui/loadoutModel.js';
import { roomBanDiff } from '../ui/loadoutSync.js';
import { BANPICK_DIFFICULTIES, banQuota, banPickStats, toggleBan, toggleFavorite } from '../../../shared/banPick.js';
import { DIFFICULTY_NAMES } from '../../../shared/constants.js';
import { t, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Difficulty short labels (the official names are long; the chip carries the full one as its title). */
const DIFF_SHORT = Object.freeze({ FUNNY: N_('标准'), NORMAL: N_('险境'), HARD: N_('绝境'), ABYSS: N_('终极'), ZHAJING: N_('炸惊') });

/** Every 盟约 the data knows, split into 大盟约 and 小盟约 with weight > 0 (only those are bannable). */
export function banPickerBonds() {
  const list = data.list('bonds') || [];
  const sort = (a, b) => (a.bondOrder ?? 0) - (b.bondOrder ?? 0) || String(a.name).localeCompare(String(b.name), 'zh');
  const core = list.filter((b) => b && b.isCore).sort(sort);
  const addon = list.filter((b) => b && !b.isCore && Number(b.weight) > 0).sort(sort);
  // a weight-0 盟约 is never bannable and never drawn as a random fill — shown greyed so the player knows why
  // ★ 2026-10-18：核心盟约**不看 weight**（S.E.E.S 是 weight 0 的核心盟约）—— 灰名单必须排除 isCore，否则会同时出现在大盟约和灰名单里。
  const inert = list.filter((b) => b && !b.isCore && Number(b.weight) <= 0).sort(sort);
  return { core, addon, inert };
}

/** The bond ids the match mode switched off for a difficulty (config.modes[*].inactiveBondIds). */
function modeInactiveFor(difficulty) {
  const cfg = data.get('config') || {};
  const m = cfg.modes ? cfg.modes[modeIdFor(difficulty)] : null;
  return new Set(Array.isArray(m?.inactiveBondIds) ? m.inactiveBondIds : []);
}

/** `mode_${type}_${difficulty}` — the single-player mode id for a difficulty (its inactiveBondIds are the same). */
function modeIdFor(difficulty) {
  return `mode_single_${String(difficulty).toLowerCase()}`;
}

function BondChip({ bond, kind, on, fav, disabled, onToggle, onFav, locked }) {
  return html`<div class=${cx('bp-chip', `bp-chip--${kind}`, on && 'is-on', fav && 'is-fav', disabled && 'is-off', locked && 'is-locked')}
      data-bond=${bond.bondId} title=${bond.desc ? String(bond.desc).slice(0, 300) : bond.name}>
    <button type="button" class="bp-chip__main" disabled=${disabled || locked}
      aria-pressed=${on ? 'true' : 'false'} onClick=${() => onToggle(bond.bondId)}>
      <span class="bp-chip__name">${bond.name}</span>
      ${on ? html`<span class="bp-chip__mark" aria-hidden="true"><${Icon} name="check" /></span>` : null}
      ${locked ? html`<span class="bp-chip__lock">${t('本难度已关闭')}</span>` : null}
    </button>
    ${kind === 'core' && !locked ? html`<button type="button" class=${cx('bp-chip__fav', fav && 'is-on')}
      aria-pressed=${fav ? 'true' : 'false'} title=${fav ? t('取消特别关心') : t('特别关心：永不 ban 掉这个盟约')}
      onClick=${() => onFav(bond.bondId)}>❤</button>` : null}
  </div>`;
}

/**
 * The 卡池预选 panel of the 干员调配 overlay.
 * @param {{ m: any, st: any, onSet: (patch: any) => void, onDiff: (d: string) => void }} props `st` = the loadout
 *   store snapshot; `onSet` takes one difficulty's entry, `onDiff` switches the edited difficulty
 */
export function BanPicker({ m, st, onSet, onDiff, onClose = null }) {
  const { core, addon, inert } = banPickerBonds();
  const bondOf = (id) => data.lookup('bonds', id) || null;
  const diffs = BANPICK_DIFFICULTIES;
  // 用户反馈（终极房）：房间存在时页签必须跟随房间难度，否则显示/编辑的是另一份清单
  const diff = roomBanDiff(st, st.bansDiff);
  const cfg = data.get('config') || {};
  const quotas = {};
  for (const d of diffs) quotas[d] = banQuota(cfg, d);
  const quota = quotas[diff];
  const entry = banEntryOf(st.bans, diff);
  const stats = banPickStats(entry, quota, bondOf);
  const inactive = modeInactiveFor(diff);
  const set = (e) => onSet(e);
  const noQuota = quota.core === 0 && quota.addon === 0;

  return html`<main class="bp">
    <button type="button" class="bp__x" onClick=${onClose} aria-label=${t('关闭')} title=${t('关闭')}><${Icon} name="close" /></button>
    <header class="bp__head">
      <h2>${t('卡池预选')}<${MicroLabel}>POOL BAN PICKS<//></h2>
      <p class="bp__lead">${t('每个难度独立设置。你选中的盟约会从【你自己的】干员池里移除——队友的池子不受影响；剩余槽位默认随机补满。')}</p>
    </header>

    <div class="bp__diffs" role="tablist" aria-label=${t('难度')}>
      ${diffs.map((d) => {
        const q = quotas[d];
        const s = banPickStats(banEntryOf(st.bans, d), q, bondOf);
        return html`<button key=${d} type="button" role="tab" aria-selected=${d === diff ? 'true' : 'false'}
          class=${cx('bp-diff', d === diff && 'is-on', s.changed && 'is-changed')}
          title=${t(DIFFICULTY_NAMES[d] || d)} data-diff=${d}
          onClick=${() => onDiff(d)}>
          <span class="bp-diff__name">${t(DIFF_SHORT[d] || d)}</span>
          <span class="bp-diff__q num">${q.core}+${q.addon}</span>
          ${s.changed ? html`<span class="bp-diff__dot" aria-hidden="true"></span>` : null}
        </button>`;
      })}
    </div>

    <div class="bp__bar">
      <span class="bp__quota">
        ${noQuota
          ? html`<b>${t('本难度不 ban 任何盟约')}</b>`
          : html`${t('大盟约 {a}/{b}', { a: stats.core, b: quota.core })}　${t('小盟约 {a}/{b}', { a: stats.addon, b: quota.addon })}`}
      </span>
      ${stats.favorites ? html`<span class="bp__fav-count">❤ ${t('特别关心 {n}', { n: stats.favorites })}</span>` : null}
      <span class="bp__fillnote">${t('未填满的槽位由系统随机补（强制）')}</span>
      <${Button} size="sm" variant="ghost" icon="refresh" disabled=${!stats.changed}
        onClick=${() => set({ bonds: [], favorites: [] })}>${t('恢复默认')}<//>
    </div>

    ${noQuota ? html`<p class="bp__note"><${Icon} name="info" />${t('这个难度不提供 ban 位，下面的选择不会生效。')}</p>` : null}

    <section class="bp__sec">
      <header class="bp__sec-head">
        <h3>${t('大盟约')}<${MicroLabel}>ALLIANCE<//></h3>
        <span class="bp__hint">${t('点 ❤ 表示「特别关心」：标成金色，永不被 ban（自己的名单和随机补都跳过它）')}</span>
      </header>
      <div class="bp__chips">
        ${core.map((b) => html`<${BondChip} key=${b.bondId} bond=${b} kind="core"
          on=${entry.bonds.includes(b.bondId)} fav=${entry.favorites.includes(b.bondId)}
          locked=${inactive.has(b.bondId)}
          onToggle=${(id) => set(toggleBan(entry, id, quota, bondOf))}
          onFav=${(id) => set(toggleFavorite(entry, id, quota, bondOf))} />`)}
      </div>
    </section>

    <section class="bp__sec">
      <header class="bp__sec-head">
        <h3>${t('小盟约')}<${MicroLabel}>ADD-ON<//></h3>
        ${inactive.size ? html`<span class="bp__hint">${t('标灰的是本难度固定关闭的盟约，不可选')}</span>` : null}
      </header>
      <div class="bp__chips">
        ${addon.map((b) => html`<${BondChip} key=${b.bondId} bond=${b} kind="addon"
          on=${entry.bonds.includes(b.bondId)} fav=${false} locked=${inactive.has(b.bondId)}
          onToggle=${(id) => set(toggleBan(entry, id, quota, bondOf))} />`)}
        ${inert.map((b) => html`<${BondChip} key=${b.bondId} bond=${b} kind="inert" on=${false} fav=${false}
          disabled=${true} onToggle=${() => {}} />`)}
      </div>
    </section>

    <p class="bp__note"><${Icon} name="info" />${t('被 ban 的盟约不会直接 ban 干员：只有当一名干员的【全部】盟约都落网时，它才会从你的池子里移除。')}</p>
  </main>`;
}
