// 机变 draft overlay (research 06 §4.4 / §11.5): family title | description, "倒计时结束后仍未选定将自动分配",
// whose turn ("当前轮到你决策" / "{name} 正在决策…") with countdown, pick order with ✓ / ⌛ / … / door,
// and a 3×2 grid (solo: 3 cards) of cards in the official layout (the official 悬赏 / 机密商店 / 战术 screenshots): a
// framed icon at the top-left with the bold name beside it (tags under the name), the effect text across the card under
// both, left-aligned; the tier chip on the icon's corner and the taker's round avatar alone at the top-right (their
// name is its tooltip and part of the card's accessible name; a taken card's name wraps before it). The effect text
// is the official rich text of the item / effect (items.json / effects.json `descRaw` — the detail card's text — while it
// says what the server card's plain `desc` says: cardText), clamped by lines, and it fits the card on phones too (user
// playtest #6 item 6: at 756×366 it used to sit below a large centred icon, clipped away). Picking takes two taps, like
// buying in the shop (user playtest #4 item 2 — extra enemies, items and tactics were picked by a slip of the finger;
// research 09 §5 EventOnFirstClick → EventOnConfirm): the first tap on an available card selects it (it lifts with a
// gold frame and a 确认选择 · 再次点击 strip; the header shows 确认选择), a second tap on the same card — or 确认选择 —
// sends g.choice; a tap on another card moves the selection, a tap elsewhere or Esc drops it. Cards are buttons (Tab /
// Enter work the same way). While the pick is in flight the card shows a "选择中" strip with a sweeping bar (never a
// spinner over its text — user playtest #3 item 9), dropped as soon as the pick shows in m.public (spBusy itself resets
// when the request settles, ≤ 8 s, or the phase moves on). Untimed drafts (solo, a single-human match: sp.untimed) show
// no countdown and say so.

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon, TierChip, Countdown, MicroLabel, Button } from './components.js';
import { Img, RichText, PlayerAvatar, GIcon } from './gameComponents.js';
import { itemIconUrl, enemyIconUrl, uiUrl, assetsItemIconUrl } from './assetUrls.js';
import { richTextPlain } from './richText.js';
import { sortedPlayers } from './gameLogic.js';
import { data } from '../data.js';
import { t, tName } from '../../../shared/i18n.js';
import { sentText } from './lang.js';
import { resolveJibianArt } from './jibianArt.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** 规则5: the 惊变 card rarities (the rarity is rolled first, then a card of it is drawn). */
export const RARITY_NAMES = { normal: '普通', rare: '稀有', epic: '史诗', legend: '传说', hidden: '隐秘' };
const rarityLabel = (r) => (r && RARITY_NAMES[r] ? t(RARITY_NAMES[r]) : null);
const MUJICA_CARD_IDS = new Set(['jibian_yinhezhanjian', 'jibian_yiwangnvshen', 'jibian_duoshouyeshou']);

const bare = (t) => String(t || '').replace(/\s+/g, '');

/**
 * A card's effect text: the card's own rich text, else the data's rich text (highlighted numbers, 下场作战, set bonuses,
 * line breaks — the detail card's text) while it says what the server's plain `desc` says, else that plain text (a
 * server-side wording the data does not have wins). The server's texts are Chinese: `rawRich` is the record's Chinese
 * rich text they are compared with, `rich` the same record in the current language (the two are one text in Chinese).
 * @param {{ descRaw?: string, desc?: string }} card @param {string} rich items.json / effects.json descRaw
 * @param {string} [rawRich] its Chinese text (data.lookupRaw)
 */
export function cardText(card, rich, rawRich = rich) {
  if (card.descRaw) return rich && card.descRaw === rawRich ? rich : card.descRaw;
  if (rich && (!card.desc || bare(richTextPlain(rawRich || rich)) === bare(card.desc))) return rich;
  return card.desc || rich || '';
}

/**
 * Resolve an sp card to display fields.
 * @param {any} card normalised card ({ idx, takenBy, effectId?, itemId?, id?, name?, desc?, descRaw?, tier?, team?, enemyKey? })
 * @param {string|null} family 'bounty'|'supply'|'shop'|'tactic'
 */
export function resolveSpCard(card, family) {
  const choices = data.get('choices');
  const byEffect = (list, id) => (Array.isArray(list) && id ? list.find((x) => x && x.effectId === id) : null);
  const effectId = card.effectId || (!card.itemId && typeof card.id === 'string' && data.lookup('effects', card.id) ? card.id : null);
  const eff = effectId ? data.lookup('effects', effectId) : null;
  const itemId = card.itemId || (!effectId && typeof card.id === 'string' && data.lookup('items', card.id) ? card.id : null);
  const item = itemId ? data.lookup('items', itemId) : null;
  const rawRich = (itemId && data.lookupRaw('items', itemId)?.descRaw) || (effectId && data.lookupRaw('effects', effectId)?.descRaw) || '';
  const bounty = byEffect(choices?.cards?.bounty, effectId);
  const tactic = byEffect(choices?.cards?.tactic, effectId);
  const m = data.get('assets');
  const kind = card.kind === 'item' || item ? 'item' : card.kind === 'bounty' || bounty || family === 'bounty' ? 'bounty' : 'tactic';
  const enemyKey = card.enemyKey || bounty?.enemyKey || eff?.params?.enemy_id || null;
  const team = card.team ?? tactic?.team ?? (eff?.decoIconId === 'icon_team_buff');
  const art = resolveJibianArt(m, card);
  let icon = null;
  if (item) icon = itemIconUrl(m, item);
  else if (kind === 'bounty' && enemyKey) icon = enemyIconUrl(m, enemyKey);
  else if ((card.tacticKind || tactic?.kind) === 'terrain') icon = uiUrl(m, 'buffIcon/icon_stage_buff');
  else if ((card.tacticKind || tactic?.kind) === 'enemyDebuff') icon = uiUrl(m, 'buffIcon/icon_enemy_debuff');
  // 盟约惊变 (用户 2026-10-12): 卡面带对应盟约的头像，替换原来所有惊变卡共用的 icon_player_buff
  else if (art.bondId) icon = art.icon;
  else {
    // 惊变 logo (2026-10-13): a 惊变 pool entry (config modes[*].jibian.pool → server cardView `id`) has no items.json
    // record and no bond, but the manifest registers one `items` key per card that has its own art. Checked LAST, so
    // item / bounty / terrain / enemyDebuff / bond cards keep the icon above; a key the manifest really has wins,
    // everything else still falls back to the shared buff icon (icon_player_buff / icon_team_buff).
    const ownId = effectId || itemId || (typeof card.id === 'string' ? card.id : null);
    icon = assetsItemIconUrl(m, ownId) || uiUrl(m, `buffIcon/${team ? 'icon_team_buff' : 'icon_player_buff'}`);
  }
  return {
    kind,
    name: tName(card.name) || item?.name || eff?.name || bounty?.name || tactic?.name || t('机变'),
    desc: cardText(card, item?.descRaw || eff?.descRaw || '', rawRich) || item?.desc || eff?.desc || bounty?.desc || tactic?.desc || '',
    tier: Number.isFinite(card.tier) ? card.tier : item?.tier ?? bounty?.tier ?? null,
    icon,
    whiteGlyph: art.whiteGlyph,
    team: !!team,
    coin: card.coin ?? bounty?.coin ?? eff?.enemyPrice ?? null,
    // 规则5: a 惊变 card's rarity (rolled before the card), shown as a tag on the card
    rarity: typeof card.rarity === 'string' && card.rarity ? card.rarity : null,
    // 惊变: the grey flavour line printed at the card's bottom (jibian-data.mjs `flavor` → config pool / effects;
    // server/match/choices.js cardView passes it through). The 已选惊变 panel (ui/jibianPanel .jbc__flavor) and the
    // 敌方惊变 reveal already print it — the pick overlay is the third card surface and had been missing it.
    flavor: typeof card.flavor === 'string' && card.flavor ? card.flavor : null,
    // 惊变羁绊（owner 2026-10-19）：[{ name, have, need }]，卡面底部一行一条
    bonds: Array.isArray(card.bonds) && card.bonds.length ? card.bonds : null,
  };
}

/**
 * Whether a card shows the in-flight pick (g.choice sent, no answer yet): only until the pick lands in m.public — the
 * player's pick is known or the card is taken — so it can never outlive the request's effect.
 * @param {number|null} busyIdx @param {{ idx: number, takenBy?: string|null }} card @param {number|null|undefined} mine
 */
export function pickBusy(busyIdx, card, mine) {
  return busyIdx != null && !!card && busyIdx === card.idx && mine == null && !card.takenBy;
}

/**
 * Whether I may pick a card right now: my turn (solo: always), no pick of mine yet, the card free and no pick in flight.
 * @param {any} sp normalizeSp(...) @param {{ idx: number, takenBy?: string|null } | null | undefined} card
 * @param {{ myId: string, solo: boolean, busyIdx?: number|null }} o
 */
export function cardPickable(sp, card, { myId, solo, busyIdx = null }) {
  if (!sp || !card) return false;
  const myTurn = solo || sp.turnPid === myId;
  return myTurn && sp.pickOf.get(myId) == null && !card.takenBy && busyIdx == null;
}

/**
 * Two-tap step of a card tap (like the shop's first tap → confirm): tapping an available card selects it, tapping the
 * selected card again confirms it. A card that cannot be picked changes nothing.
 * @param {number|null} armed the selected card's idx
 * @param {number} idx the tapped card
 * @param {boolean} pickable cardPickable(...) of the tapped card
 * @returns {{ armed: number|null, pick: number|null }} the new selection and the card to send (g.choice) or null
 */
export function spTap(armed, idx, pickable) {
  if (!pickable || !Number.isInteger(idx)) return { armed, pick: null };
  if (armed === idx) return { armed: null, pick: idx };
  return { armed: idx, pick: null };
}

/**
 * The selected card while it can still be picked (my turn, not taken, nothing in flight), else null — a selection
 * never outlives the state that allowed it.
 * @param {number|null} armed @param {any} sp @param {{ myId: string, solo: boolean, busyIdx?: number|null }} o
 */
export function armedCard(armed, sp, o) {
  if (armed == null || !sp) return null;
  const card = sp.cards.find((c) => c && c.idx === armed);
  return cardPickable(sp, card, o) ? armed : null;
}

/**
 * The overlay: keeps the two-tap selection and renders ChoiceView. `onPick(idx)` sends the confirmed card (g.choice).
 * @param {{ pub:any, sp:any, myId:string, solo:boolean, onPick:(idx:number)=>void, busyIdx?:number|null, total?:number|null }} props
 */
export function ChoiceOverlay(props) {
  const { sp, myId, solo, busyIdx = null, onPick } = props;
  const [sel, setSel] = useState(null);
  const armed = armedCard(sel, sp, { myId, solo, busyIdx });
  // a selection whose card cannot be picked any more (taken, the turn moved on, a pick in flight) is dropped
  useEffect(() => { if (sel != null && armed == null) setSel(null); }, [sel, armed]);
  useEffect(() => {
    if (armed == null) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed]);
  if (!sp) return null;
  const tap = (idx) => {
    const card = sp.cards.find((c) => c && c.idx === idx);
    const r = spTap(armed, idx, cardPickable(sp, card, { myId, solo, busyIdx }));
    setSel(r.armed);
    if (r.pick != null) onPick(r.pick);
  };
  // 规则5: 惊变刷新重投指定的一张。用户 2026-10-11：「要按确认才能刷新 我需要直接刷新」——
  // 现在每张卡下方各有一个刷新键，点它直接重投**那一张**（不需要先选中/确认）；
  // 只有当刷新键没给出 idx 时（例如别处复用同一个回调）才回退到「已选中的那张」。
  const reroll = (idx = null) => {
    if (typeof props.onReroll !== 'function') return;
    const i = Number.isInteger(idx) ? idx : armed;
    if (i == null) return;
    props.onReroll(i);
  };
  return html`<${ChoiceView} ...${props} armed=${armed} onTap=${tap} onReroll=${reroll}
    onConfirm=${() => { if (armed != null) tap(armed); }} onDisarm=${() => setSel(null)} />`;
}

/**
 * The overlay's view (pure: no hooks — test/ui renders it as a function).
 * @param {{ pub:any, sp:any, myId:string, solo:boolean, busyIdx?:number|null, total?:number|null, armed?:number|null,
 *   onTap?:(idx:number)=>void, onConfirm?:()=>void, onDisarm?:()=>void }} props
 */
export function ChoiceView({ pub, sp, myId, solo, busyIdx = null, total = null, armed = null, onTap = () => {}, onConfirm = () => {}, onDisarm = () => {}, onReroll = () => {} }) {
  if (!sp) return null;
  const fam = data.get('choices')?.families?.[sp.family] || null;
  const rawFam = data.getRaw('choices')?.families?.[sp.family] || null;
  const players = new Map(sortedPlayers(pub).map((p) => [p.playerId, p]));
  const myTurn = solo || sp.turnPid === myId;
  const mine = sp.pickOf.get(myId);
  const turnName = players.get(sp.turnPid)?.name || t('队友');
  const special = /_s$/.test(String(sp.family || ''));
  const order = solo ? [] : sp.order;
  // 机变阶段的倒计时（用户要求显示）：本小队这一手的截止时间来自 private 帧的 sp.turnDeadline —— 到了 AI 就替你选
  // （服务端 spDraft.js scheduleSpPickTimeout 的 AFK 安全网，config.timers.spTurn = 16s）。房间级的 m.deadline 在
  // SP_DRAFT 恒为 0（25 个小队并行，一个 m.deadline 描述不了 25 个时钟），所以 solo / 单人房也要靠这个字段才有倒计时。
  const turnDeadline = Number(sp.turnDeadline) > 0 ? Number(sp.turnDeadline) : 0;
  const turnTotal = Number(sp.turnSeconds) > 0 ? Number(sp.turnSeconds) : null;
  const timed = !sp.untimed || turnDeadline > 0;
  const armedCardRec = armed != null ? sp.cards.find((c) => c && c.idx === armed) : null;
  const armedName = armedCardRec ? resolveSpCard(armedCardRec, sp.family).name : null;
  const mujicaCards = sp.family === 'jibian' && sp.cards.length <= 3
    && sp.cards.some(c => MUJICA_CARD_IDS.has(c.effectId || c.id));
  // a press anywhere but a card or the confirm button drops the selection
  const onDown = (e) => {
    if (armed == null) return;
    const t = e.target;
    if (t && typeof t.closest === 'function' && t.closest('.spcard, .spcardwrap, .spcard__rerollbtn, .spov__confirm, .spov__reroll, .spov__rerollbar')) return;
    onDisarm();
  };
  return html`<div class=${cx('spov', armed != null && 'has-armed', mujicaCards && 'spov--mujica-cards')} role="dialog" aria-label=${t('机变阶段')} onPointerDown=${onDown}>
    <div class="spov__veil" aria-hidden="true"></div>
    <div class="spov__inner">
      <header class="spov__head">
        <div class="spov__titles">
          <${MicroLabel} tone="mint">${t('CONTINGENCY // 机变阶段')}</${MicroLabel}>
          <h2 class=${cx('spov__title', special && 'is-special')}>${sentText(sp.name, rawFam?.name, fam?.name) || fam?.name || t('机变')}<span class="spov__bar">|</span><span class="spov__desc"><${RichText} text=${sentText(sp.desc, rawFam?.desc, fam?.desc) || fam?.desc || t('选择一项')} /></span></h2>
          <p class="spov__sub">${timed ? t('倒计时结束后仍未选定将自动分配') : t('选择一项（无时间限制）')}${mine == null && myTurn ? t(' · 点击卡牌选中，再次点击确认') : ''}</p>
        </div>
        <div class="spov__turn">
          ${mine != null ? html`<span class="spov__turntxt is-done"><${Icon} name="check" />${t('已完成选择')}</span>`
            : myTurn ? html`<span class="spov__turntxt is-mine">${t('当前轮到你决策')}</span>`
            : html`<span class="spov__turntxt">${t('{turnName} 正在决策…', { turnName })}<${Icon} name="hourglass" /></span>`}
          ${armed != null ? html`<${Button} variant="primary" size="lg" icon="check" class="spov__confirm" data-testid="sp-confirm"
              title=${armedName ? t('确认选择「{armedName}」（再次点击卡牌亦可）', { armedName }) : t('确认选择')} onClick=${onConfirm}>${t('确认选择')}<//>` : null}
          ${timed ? html`<${Countdown} deadline=${turnDeadline || pub?.deadline} total=${turnTotal ?? total ?? undefined} size="sm" />` : null}
        </div>
      </header>
      ${order.length ? html`<div class="spov__order" aria-label=${t('决策顺序')}>
        ${order.map((pid, i) => {
          const p = players.get(pid);
          const picked = sp.pickOf.has(pid);
          const cur = sp.turnPid === pid && !picked;
          const left = p?.status === 'left';
          return html`<div key=${pid} class=${cx('spov__who', cur && 'is-cur', picked && 'is-done', pid === myId && 'is-self')}>
            <span class="spov__idx num">${i + 1}</span>
            <${PlayerAvatar} player=${p || { name: '?' }} size="sm" self=${pid === myId} />
            <span class="spov__wname">${p?.name || t('博士')}</span>
            <span class="spov__wstate">${left ? html`<${Icon} name="exit" />` : picked ? html`<${Icon} name="check" />` : cur ? html`<${Icon} name="hourglass" />` : html`<${Icon} name="dots" />`}</span>
          </div>`;
        })}
      </div>` : null}
      <div class=${cx('spov__grid', sp.cards.length <= 3 && 'spov__grid--3')}>
        ${sp.cards.map((card) => {
          const r = resolveSpCard(card, sp.family);
          const taker = card.takenBy ? players.get(card.takenBy) : null;
          const can = cardPickable(sp, card, { myId, solo, busyIdx });
          const busy = pickBusy(busyIdx, card, mine);
          const isArmed = can && armed === card.idx;
          const takerName = taker ? (card.takenBy === myId ? t('你') : taker.name) : null;
          // 2026-10-13（用户）：每个卡牌【正下方】各一个「加载」刷新键（refresh 图标 + 持续旋转），重投它自己那张；
          // 「剩余可刷新次数」仍在卡牌下方那条居中的 .spov__rerollbar 里（整局不可再生，ps.spRerollsUsed）。
          // ★ 2026-10-19：每张卡各能刷新一次（服务端在新卡上打 rerolled 标记）
          const canReroll = sp.family === 'jibian' && myTurn && !card.takenBy && mine == null && !card.rerolled;
          return html`<div key=${card.idx} class="spcardwrap">
            <button type="button" data-rarity=${r.rarity || 'normal'}
              class=${cx('spcard', `spcard--${r.kind}`, card.takenBy && 'is-taken', card.takenBy === myId && 'is-mine', can && 'is-pickable', isArmed && 'is-armed', busy && 'is-busy')}
              aria-busy=${busy ? 'true' : undefined} aria-pressed=${can ? String(isArmed) : undefined} disabled=${!can} onClick=${() => can && onTap(card.idx)}
              aria-label=${isArmed ? t('{name}，已选中，再次点击确认', { name: r.name }) : takerName ? t('{name}，{takerName}已选择', { name: r.name, takerName }) : r.name} title=${`${r.name}\n${richTextPlain(r.desc)}`}>
            <span class="spcard__glow" aria-hidden="true"></span>
            <span class="spcard__head">
              <span class=${cx('spcard__icon', r.whiteGlyph && 'jibian-art--white-glyph')}><${Img} src=${r.icon} fallback=${html`<${GIcon} name=${r.kind === 'bounty' ? 'target' : 'bolt'} />`} /></span>
              <span class="spcard__title">
                <b class="spcard__name">${r.name}</b>
                ${r.team || (r.kind === 'bounty' && r.coin) || r.rarity ? html`<span class="spcard__tags">
                  ${r.rarity ? html`<span class=${cx('spcard__tag', `spcard__tag--${r.rarity}`)}>${rarityLabel(r.rarity)}</span>` : null}
                  ${r.team ? html`<span class="spcard__tag spcard__tag--team">${t('全队获得')}</span>` : null}
                  ${r.kind === 'bounty' && r.coin ? html`<span class="spcard__tag spcard__tag--coin">${t('赏金 {coin}', { coin: r.coin })}</span>` : null}
                </span>` : null}
              </span>
            </span>
            <${RichText} text=${r.desc} class="spcard__desc" />
            ${r.tier ? html`<${TierChip} tier=${r.tier} size="md" class="spcard__tier" />` : null}
            ${r.bonds ? html`<span class="spcard__bonds">${r.bonds.map((b) => html`<button type="button" class=${cx('spcard__bond', b.have > 0 && 'is-on')} key=${b.name} title=${b.effect || b.name} data-testid=${`sp-bond-${b.name}`} onClick=${(e) => { e.stopPropagation(); e.preventDefault(); }} onMouseDown=${(e) => e.stopPropagation()}><span class="spcard__bondline"><span class="spcard__bondname">${b.name}</span><span class=${cx("spcard__bondmain", b.have > 0 && "is-on", b.tiers && b.tiers.length > 1 && b.have >= b.tiers[1] && "is-full")}>${b.have}/${b.tiers ? b.tiers[0] : b.need}</span>${b.tiers && b.tiers.length > 1 ? html`<span class=${cx("spcard__bondsub", b.have >= b.tiers[1] && "is-full")}>${b.tiers[1]}</span>` : null}</span>${b.effect ? html`<span class="spcard__bondeffect">${b.effect}</span>` : null}</button>`)}</span>` : null}
            ${r.flavor ? html`<span class="spcard__flavor">${r.flavor}</span>` : null}
            ${taker ? html`<span class="spcard__taker" title=${t('{name} 已选择', { name: taker.name })}><${PlayerAvatar} player=${taker} size="sm" /></span>` : null}
            ${isArmed ? html`<span class="spcard__confirm" role="status"><b>${t('确认选择')}</b><small>${t('再次点击')}</small></span>` : null}
            ${busy ? html`<span class="spcard__busy" role="status">${t('选择中')}</span>` : null}
            </button>
            ${canReroll ? html`<button type="button" class="spcard__rerollbtn" data-testid=${`sp-reroll-${card.idx}`}
              aria-label=${t('刷新这张惊变')} title=${t('重投这张惊变（剩余 {n} 次）', { n: sp.rerollLeft })}
              onClick=${(e) => { e.stopPropagation(); if (typeof onReroll === 'function') onReroll(card.idx); }}>
              <${Icon} name="refresh" /></button>` : null}
          </div>`;
        })}
      </div>
      ${sp.family === 'jibian' ? html`<div class="spov__rerollbar">
        <span class="spov__rerollcount" data-testid="sp-reroll-count">${t('每张卡可刷新一次')}</span>
      </div>` : null}
    </div>
  </div>`;
}
