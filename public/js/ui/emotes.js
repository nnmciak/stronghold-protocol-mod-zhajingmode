// Emotes (交流, research 09 §4): the 36 official in-match emotes of 盟约 — 6 themes × 6 (shared/constants.js
// EMOTE_THEMES / EMOTES, generated reference data/emotes.json). Official emotes are pictures only: nothing here ever
// renders an emote's text (our labels are aria-labels only).
//
//   EmoteArt    the emote picture: the local-client art (data/local-assets.json → emoticon/<dir>/<picId>) first, else
//               the copy setup downloads from the public mirror (data/assets.json → ui['emoticon/<dir>/<picId>'];
//               GitHub issue #42), each tried in turn when one fails to load; a neutral glyph when neither is there.
//               An empty box only while a manifest is still in flight; a timeout or a failed manifest (GitHub #99)
//               uses that glyph, and a later success replaces it.
//   EmoteDanmaku the in-match 交流 display: every emote flies right → left across the top of the field with its sender's
//               name (owner's request; it REPLACED EmoteBubble in the team panel). See its own block at the end of the file.
//   EmoteBubble the pop bubble (official emoji_bubble_bkg: a dark rounded square with a tail pointing left + the icon
//               only); pop-in, 3 s, fade. The parent keys it by the emote's seq so a newer emote replaces the old one and
//               pops again, and passes the arrival time (`at`) so a bubble mounted late resumes its timeline instead of
//               restarting it. NO LONGER MOUNTED IN A MATCH (EmoteDanmaku took over); kept as the generic pop-up.
//   EmoteWheel  bottom-left 交流 button (official emoji_btn / emoji_btn_disable) + panel (emoji_bkg): one page per theme
//               with 3×2 cells (emoji_cell_bkg), pager dots, swipe / drag / arrow keys / wheel to change the page (the
//               wheel turns one page per gesture, a plain vertical mouse wheel included, like Unity's ScrollRect). The
//               panel reopens on the theme of the last emote sent (localStorage). Sending closes the panel and greys
//               the button for the 1 s cooldown (chatCD), counted from the send so a remount keeps it.
// Official UI sprites come from the local ui/battle extraction when present; CSS draws look-alikes otherwise.
// Styles: public/css/emotes.css (injected on first use when the page does not link it).

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { EMOTE_THEMES, EMOTE_PAGES, emotePageOf, EMOTE_COOLDOWN_MS, EMOTE_BUBBLE_MS, emoteInfo, emoteArtGroup } from '../../../shared/constants.js';
import { html } from './components.js';
import { GIcon } from './gameComponents.js';
import { data, useData, localAsset, artUrls, nextArtUrl } from '../data.js';
import { loadPref, savePref } from '../store.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

export const EMOTE_CSS_HREF = '/css/emotes.css';
const PREF_THEME = 'emoteTheme';
const SWIPE_PX = 40;      // horizontal drag distance that turns the page
const DRAG_SLOP_PX = 8;   // below this a press is a tap, not a drag
export const WHEEL_STEP_PX = 60;  // wheel / trackpad scroll that turns the page
export const WHEEL_GAP_MS = 180;  // a pause this long ends a wheel gesture (a trackpad's momentum tail included)

// Time of the last send, shared by every wheel on the page: the 1 s cooldown survives a remount of the wheel (the
// server enforces chatCD too and silently drops an emote sent early).
let lastSentAt = -Infinity;

/** Link public/css/emotes.css once when the host page does not (dev harnesses); no-op outside a browser. */
export function ensureEmoteCss(doc = globalThis.document) {
  if (!doc?.head || typeof doc.querySelector !== 'function') return false;
  if (doc.querySelector(`link[rel="stylesheet"][href$="${EMOTE_CSS_HREF}"]`)) return false;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = EMOTE_CSS_HREF;
  doc.head.appendChild(link);
  return true;
}

/**
 * URLs of an emote's official art, best first: the local-client picture, then the mirror copy (data.js artUrls). Empty
 * when the id is unknown or neither manifest lists the picture (a path that is not listed is never requested).
 * @param {string} id official emoji id
 * @returns {string[]}
 */
export function emoteArtUrls(id) {
  const e = emoteInfo(id);
  return e ? artUrls(emoteArtGroup(id), e.picId) : [];
}

/**
 * URL of an emote's official art (the first of emoteArtUrls), or null.
 * @param {string} id official emoji id
 */
export function emoteArtUrl(id) {
  return emoteArtUrls(id)[0] || null;
}

/** True while local or assets is still in flight (idle or loading). A timeout or a failure is `missing`: the glyph. */
const artManifestsPending = () => ['local', 'assets'].some((n) => { const st = data.status(n); return st === 'loading' || st === 'idle'; });

/** Official emote UI sprite (ui/battle: emoji_bubble_bkg, emoji_bkg, emoji_cell_bkg, emoji_btn, emoji_btn_disable). */
export const emoteUiSprite = (name) => localAsset('ui/battle', name);

/** Index of a theme's first page in the wheel (0 when unknown). */
export function themeIndex(themeId) {
  return emotePageOf(themeId);
}

/** Wheel page to open on: the theme of the last emote sent (remembered in localStorage), else the first. */
export function lastThemeIndex() {
  const v = loadPref(PREF_THEME, null);
  return typeof v === 'string' ? themeIndex(v) : 0;
}

/** Remember the theme of a sent emote. */
export function rememberTheme(themeId) {
  if (EMOTE_THEMES.some((t) => t.themeId === themeId)) savePref(PREF_THEME, themeId);
}

/** Clamp a page index into the wheel. */
export const clampPage = (i) => Math.max(0, Math.min(EMOTE_PAGES.length - 1, Math.trunc(Number(i)) || 0));

/**
 * Page change for a finished horizontal drag / swipe: -1 (previous), +1 (next) or 0.
 * @param {number} dx pointer travel in px (negative = leftwards = next page)
 * @param {number} [threshold]
 */
export const swipeStep = (dx, threshold = SWIPE_PX) => (dx <= -threshold ? 1 : dx >= threshold ? -1 : 0);

/**
 * Scroll distance of a wheel event along the pager, in px. Like Unity's horizontal-only ScrollRect, a mostly vertical
 * wheel (a plain mouse wheel) drives the horizontal pager too: down / right = next page.
 * @param {{ deltaX?: number, deltaY?: number, deltaMode?: number }} e
 * @param {number} [pagePx] px per "page" delta (deltaMode 2)
 */
export function wheelDelta(e, pagePx = 300) {
  const x = Number(e?.deltaX) || 0;
  const y = Number(e?.deltaY) || 0;
  const d = Math.abs(x) >= Math.abs(y) ? x : y;
  const unit = e?.deltaMode === 1 ? 16 : e?.deltaMode === 2 ? pagePx : 1; // lines / pages → px
  return d * unit;
}

/**
 * Wheel / trackpad paging, at most one page per gesture. A gesture is a run of wheel events less than WHEEL_GAP_MS
 * apart; once it has turned the page the rest of it (the momentum tail of a trackpad swipe) is ignored, so one swipe
 * never skips several themes.
 * @param {{ x: number, t: number, spent: boolean }} acc gesture state (mutated)
 * @param {number} d scroll distance of this event (wheelDelta)
 * @param {number} now event time (ms)
 * @returns {-1|0|1} page change
 */
export function wheelStep(acc, d, now) {
  if (!(now - acc.t < WHEEL_GAP_MS) || now < acc.t) { acc.x = 0; acc.spent = false; } // a new gesture
  acc.t = now;
  if (acc.spent || !d) return 0;
  acc.x += d;
  if (Math.abs(acc.x) < WHEEL_STEP_PX) return 0;
  acc.spent = true;
  return acc.x > 0 ? 1 : -1;
}

/**
 * Cooldown left (ms) of the 交流 button after a send at `sentAt` (chatCD).
 * @param {number} sentAt
 * @param {number} now
 * @param {number} [cooldownMs]
 */
export function cooldownLeft(sentAt, now, cooldownMs = EMOTE_COOLDOWN_MS) {
  const left = sentAt + cooldownMs - now;
  return left > 0 && left <= cooldownMs ? left : 0; // a clock that went backwards never locks the button
}

/**
 * Age (ms) of a bubble received at `at` — so a bubble mounted late (the team panel re-rendered from scratch) resumes
 * its animation instead of popping in again for a full chatTime. 0 when unknown.
 * @param {number|undefined} at receipt time (Date.now() clock)
 * @param {number} now
 * @param {number} ttl
 */
export function bubbleAge(at, now, ttl = EMOTE_BUBBLE_MS) {
  const age = Number.isFinite(at) && Number.isFinite(now) ? now - at : 0;
  return age > 0 ? Math.min(age, Math.max(0, ttl)) : 0;
}

/** Neutral stand-in for a missing emote picture (a glyph, never text). */
function EmoteGlyph({ class: cls }) {
  return html`<span class=${cx('eart', 'eart--glyph', cls)} aria-hidden="true"><${GIcon} name="emote" /></span>`;
}

/**
 * Official emote picture (the local-client art, else the mirror copy; the next one when a picture fails to load);
 * neutral glyph when unavailable.
 * @param {{ id: string, class?: string }} props
 */
export function EmoteArt({ id, class: cls }) {
  useData('local', 'assets');
  const [bad, setBad] = useState(() => new Set()); // URLs that failed to load
  const src = nextArtUrl(emoteArtUrls(id), bad);
  if (src) {
    return html`<img key=${src} class=${cx('eart', cls)} src=${src} alt="" draggable=${false} decoding="async"
      onError=${() => setBad((s) => new Set(s).add(src))} />`;
  }
  if (emoteInfo(id) && artManifestsPending()) return html`<span class=${cx('eart', 'eart--pending', cls)} aria-hidden="true"></span>`;
  return html`<${EmoteGlyph} class=${cls} />`;
}

/**
 * Pop bubble (picture only) beside the sender's avatar. Unknown ids show the neutral glyph. Key it by the emote's seq
 * (a newer emote replaces the bubble and pops again).
 * @param {{ id: string, class?: string, ttl?: number, at?: number }} props ttl = display time in ms (fade-out at the
 *   end); at = when the emote arrived (Date.now() clock): a bubble mounted after that resumes its pop / fade timeline
 *   instead of restarting it.
 */
export function EmoteBubble({ id, class: cls, ttl = EMOTE_BUBBLE_MS, at }) {
  useData('local');
  useEffect(() => { ensureEmoteCss(); }, []);
  const life = Math.max(300, Number(ttl) || EMOTE_BUBBLE_MS);
  const [age] = useState(() => bubbleAge(at, Date.now(), life)); // fixed at mount: the CSS animation runs from there
  const bg = emoteUiSprite('emoji_bubble_bkg');
  const e = emoteInfo(id);
  const style = [`--ebubble-ttl:${life}ms`, age && `--ebubble-age:${Math.round(age)}ms`, bg && `--ebubble-bg:url("${bg}")`].filter(Boolean).join(';');
  return html`<div class=${cx('ebubble', bg && 'has-sprite', cls)} style=${style} role="img"
    aria-label=${e ? t(e.label) : t('表情')} data-emote=${e ? e.id : ''}>
    <span class="ebubble__icon"><${EmoteArt} id=${id} /></span>
  </div>`;
}

/**
 * 交流 button + emote panel.
 * @param {{ onSend: (id:string)=>void, open: boolean, onToggle: (open:boolean)=>void, disabled?: boolean,
 *   cooldownMs?: number }} props
 */
export function EmoteWheel({ onSend, open, onToggle, disabled = false, cooldownMs = EMOTE_COOLDOWN_MS }) {
  useData('local');
  useEffect(() => { ensureEmoteCss(); }, []);
  const [page, setPage] = useState(lastThemeIndex);
  const [dir, setDir] = useState(0);          // direction of the last page change (slide-in animation)
  const [dx, setDx] = useState(0);            // live drag offset (px)
  const [cooling, setCooling] = useState(() => cooldownLeft(lastSentAt, Date.now(), cooldownMs) > 0);
  const drag = useRef(null);                  // { id, x0, moved }
  const swallowClick = useRef(false);
  const wheelAcc = useRef({ x: 0, t: -Infinity, spent: false });
  const live = useRef({});
  live.current = { page, onToggle };

  const go = (to) => {
    const next = clampPage(to);
    if (next === live.current.page) return;
    setDir(next > live.current.page ? 1 : -1);
    setPage(next);
    live.current.page = next; // several key presses before the next render still step one page each
  };

  // reopen on the last used theme
  useEffect(() => { if (open) { setPage(lastThemeIndex()); setDir(0); setDx(0); } }, [open]);

  // cooldown: the button is greyed for chatCD after a send (from the send time, so a remounted wheel keeps it)
  useEffect(() => {
    if (!cooling) return undefined;
    const t = setTimeout(() => setCooling(false), cooldownLeft(lastSentAt, Date.now(), cooldownMs));
    return () => clearTimeout(t);
  }, [cooling]);

  // outside press closes; ← / → change the page
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!(e.target instanceof Element) || !e.target.closest('.ewheel')) live.current.onToggle(false); };
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        go(live.current.page + (e.key === 'ArrowRight' ? 1 : -1));
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const send = (id) => {
    if (swallowClick.current) { swallowClick.current = false; return; }
    const e = emoteInfo(id);
    const now = Date.now();
    if (!e || cooling || disabled || cooldownLeft(lastSentAt, now, cooldownMs) > 0) return;
    lastSentAt = now;
    rememberTheme(e.themeId);
    setCooling(true);
    onSend(id);
    onToggle(false);
  };

  // swipe / drag (touch, pen and mouse)
  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    drag.current = { id: e.pointerId, x0: e.clientX, moved: false };
    swallowClick.current = false;
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) { drag.current = null; setDx(0); return; } // released outside
    const off = e.clientX - d.x0;
    if (!d.moved && Math.abs(off) < DRAG_SLOP_PX) return;
    if (!d.moved) { d.moved = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    const edge = (off > 0 && live.current.page === 0) || (off < 0 && live.current.page === EMOTE_PAGES.length - 1);
    setDx(edge ? off / 3 : off); // rubber band at the first / last page
  };
  const endDrag = (e, cancelled) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    swallowClick.current = true;               // the click that follows a drag is not a send
    setTimeout(() => { swallowClick.current = false; }, 0);
    setDx(0);
    if (!cancelled) { const step = swipeStep(e.clientX - d.x0); if (step) go(live.current.page + step); }
  };
  const onWheel = (e) => {
    const d = wheelDelta(e, e.currentTarget?.clientWidth || 300);
    if (!d) return;
    e.preventDefault();
    const step = wheelStep(wheelAcc.current, d, performance.now());
    if (step) go(live.current.page + step);
  };

  const theme = EMOTE_PAGES[clampPage(page)];
  const btnSprite = emoteUiSprite(disabled || cooling ? 'emoji_btn_disable' : 'emoji_btn');
  const panelBg = emoteUiSprite('emoji_bkg');
  const cellBg = emoteUiSprite('emoji_cell_bkg');
  const panelStyle = [panelBg && `--ewheel-bg:url("${panelBg}")`, cellBg && `--ewheel-cell:url("${cellBg}")`].filter(Boolean).join(';');
  return html`<div class="ewheel">
    <button type="button" class=${cx('ewheel__btn', btnSprite && 'has-sprite', open && 'is-on', cooling && 'is-cooling')}
      style=${btnSprite ? `--ewheel-btn:url("${btnSprite}")` : ''} onClick=${() => onToggle(!open)}
      aria-expanded=${open ? 'true' : 'false'} aria-haspopup="dialog" disabled=${disabled || cooling}>
      ${btnSprite ? null : html`<${GIcon} name="emote" />`}<span class="ewheel__label">${t('交流')}</span>
    </button>
    ${open ? html`<div class=${cx('ewheel__panel', panelBg && 'has-sprite', cellBg && 'has-cell')} style=${panelStyle} role="dialog" aria-label=${t('交流')}>
      <div class="ewheel__viewport" onPointerDown=${onPointerDown} onPointerMove=${onPointerMove}
        onPointerUp=${(e) => endDrag(e, false)} onPointerCancel=${(e) => endDrag(e, true)} onWheel=${onWheel}>
        <div key=${`${theme.themeId}:${theme.part}`} class=${cx('ewheel__page', dir > 0 && 'is-from-right', dir < 0 && 'is-from-left', dx !== 0 && 'is-dragging')}
          style=${dx ? `transform:translateX(${dx}px)` : ''} role="group" aria-label=${t(theme.name)} data-theme=${theme.themeId} data-part=${theme.part}>
          ${theme.emotes.map((e) => html`<button key=${e.id} type="button" class="ewheel__item" data-emote=${e.id} aria-label=${t(e.label)}
              disabled=${cooling || disabled} onClick=${() => send(e.id)}>
            <${EmoteArt} id=${e.id} />
          </button>`)}
        </div>
      </div>
      <button type="button" class="ewheel__nav is-prev" aria-label=${t('上一组表情')} disabled=${page <= 0} onClick=${() => go(page - 1)}><${GIcon} name="chevronLeft" /></button>
      <button type="button" class="ewheel__nav is-next" aria-label=${t('下一组表情')} disabled=${page >= EMOTE_PAGES.length - 1} onClick=${() => go(page + 1)}><${GIcon} name="chevronRight" /></button>
      <div class="ewheel__dots" role="tablist" aria-label=${t('表情主题')}>
        ${EMOTE_PAGES.map((th, i) => html`<button key=${`${th.themeId}:${th.part}`} type="button" role="tab" class=${cx('ewheel__dot', i === page && 'is-on')}
          aria-selected=${i === page ? 'true' : 'false'} aria-label=${`${t(th.name)} ${i + 1}/${EMOTE_PAGES.length}${th.parts > 1 ? ` (${th.part + 1}/${th.parts})` : ''}`} onClick=${() => go(i)}></button>`)}
      </div>
    </div>` : null}
  </div>`;
}

// ---- 交流 弹幕 (owner's request: 「把表情系统改成弹幕」) -----------------------------------------------------------
//
// What it replaces: the in-match emote used to pop a bubble beside the sender's avatar in the team panel (EmoteBubble,
// one per player, the newest winning — see teamPanel.js). Owner asked for a danmaku instead, so EVERY emote now flies
// right → left across the upper part of the screen, carrying the sender's NAME next to the picture (the official emotes
// are pictures only, but the name is what makes a flying line read as a comment rather than a stray icon).
//
// The stream can be loud: a 100-seat room may have dozens of players, so three guards keep it readable —
//   · one sender's consecutive danmaku are spaced by DANMAKU_GAP_MS (their own burst cannot fill the screen alone);
//   · at most DANMAKU_MAX lines are on screen, the oldest dropped;
//   · every line is assigned a LANE whose last occupant entered longest ago, so two lines rarely overlap.
// A tab that mounts into a running match treats the emote log it finds as history (like Ticker) and plays none of it.

/** Lanes a danmaku may fly in (rows inside .edm). More lanes = fewer collisions. */
export const DANMAKU_LANES = 5;
/** Flight time (ms), right edge → past the left edge. */
export const DANMAKU_MS = 9000;
/** Most lines on screen at once; beyond this the oldest goes. */
export const DANMAKU_MAX = 18;
/** One sender's next danmaku waits at least this long (ms). */
export const DANMAKU_GAP_MS = 1000;
/** An emote older than this (ms) at mount is history, not news (a tab resuming mid-match). */
export const DANMAKU_STALE_MS = 30000;

/**
 * Lane for a new danmaku: the one whose last line entered longest ago, then claim it. Mutates `laneAt` (the per-lane
 * entry times) so the next call picks a different lane.
 * @param {number[]} laneAt entry time of each lane's newest line (mutated)
 * @param {number} now
 * @returns {number} lane index
 */
export function pickLane(laneAt, now) {
  let best = 0;
  for (let i = 1; i < laneAt.length; i++) if (laneAt[i] < laneAt[best]) best = i;
  laneAt[best] = now;
  return best;
}

/**
 * Lines to add for the emotes that arrived since the last look (pure — the caller owns the bookkeeping).
 * @param {Array<{seq:number, playerId:string, id:string, at:number}>} fresh emotes newer than `seenSeq`
 * @param {{ laneAt: number[], lastFrom: Map<string, number>, names: Map<string, string>, myId?: string|null, now: number }} state
 * @returns {Array<{seq:number, id:string, playerId:string, name:string, mine:boolean, lane:number, at:number}>}
 */
export function danmakuLines(fresh, { laneAt, lastFrom, names, myId = null, now }) {
  const out = [];
  for (const e of fresh) {
    const last = lastFrom.get(e.playerId);
    if (Number.isFinite(last) && e.at - last < DANMAKU_GAP_MS) continue; // this sender just spoke
    lastFrom.set(e.playerId, e.at);
    out.push({
      seq: e.seq, id: e.id, playerId: e.playerId,
      name: names.get(e.playerId) || '', mine: e.playerId === myId,
      lane: pickLane(laneAt, Number.isFinite(e.at) ? e.at : now), at: now,
    });
  }
  return out;
}

/**
 * One look at the emote log: the lines to add since the last look. Pure apart from `state`, the caller's bookkeeping
 * object `{ seen, laneAt, lastFrom, names }` (the component keeps it in a ref) — kept out of the component so the whole
 * decision (first-look history, staleness, per-sender spacing, lanes) is testable without a renderer.
 *
 * The FIRST look remembers the log's newest seq and returns nothing: a tab that mounts into a running match finds the
 * whole match's emotes in the store, and playing them all at once would be a wall of danmaku (same idea as Ticker).
 * @param {{ seen: number|null, laneAt: number[]|null, lastFrom: Map<string, number>, names: Map<string, string> }} state mutated
 * @param {Array<{seq:number, playerId:string, id:string, at:number}>} emotes the store's emote log
 * @param {{ laneCount: number, now: number, max: number, myId?: string|null }} opts
 * @returns {Array<{seq:number, id:string, playerId:string, name:string, mine:boolean, lane:number, at:number}>}
 */
export function ingestEmotes(state, emotes, { laneCount, now, max, myId = null }) {
  const list = Array.isArray(emotes) ? emotes : [];
  if (state.seen == null) { state.seen = list.length ? list[list.length - 1].seq : 0; return []; }
  if (!Array.isArray(state.laneAt) || state.laneAt.length !== laneCount) state.laneAt = new Array(Math.max(1, laneCount)).fill(-Infinity);
  const fresh = list.filter((e) => e && e.seq > state.seen && now - e.at < DANMAKU_STALE_MS);
  if (!fresh.length) return [];
  state.seen = fresh[fresh.length - 1].seq;
  const add = danmakuLines(fresh, { laneAt: state.laneAt, lastFrom: state.lastFrom, names: state.names, myId, now });
  return add.slice(-Math.max(1, max)); // a burst bigger than the cap keeps only its newest lines
}

/**
 * 交流 弹幕: emote pictures fly right → left across the top of the field with their sender's name.
 * @param {{ emotes: Array<{seq:number, playerId:string, id:string, at:number}>,
 *   players?: Array<{ playerId?: string, name?: string }>, myId?: string|null,
 *   lanes?: number, ttl?: number, max?: number }} props
 */
export function EmoteDanmaku({ emotes, players, myId = null, lanes = DANMAKU_LANES, ttl = DANMAKU_MS, max = DANMAKU_MAX }) {
  useData('local');
  useEffect(() => { ensureEmoteCss(); }, []);
  const laneCount = Math.max(1, Math.trunc(lanes) || DANMAKU_LANES);
  const [live, setLive] = useState([]);
  const st = useRef({ seen: null, laneAt: null, lastFrom: new Map(), names: new Map() });
  // refreshed on every render, so a name that arrives with the public state is used by the NEXT line (no effect re-run)
  const nm = new Map();
  for (const p of Array.isArray(players) ? players : []) if (p && p.playerId) nm.set(p.playerId, p.name || '');
  st.current.names = nm;

  useEffect(() => {
    const add = ingestEmotes(st.current, emotes, { laneCount, now: Date.now(), max, myId });
    if (add.length) setLive((prev) => [...prev, ...add].slice(-Math.max(1, max)));
  }, [emotes, laneCount, max, myId]);

  // drop the lines whose animation has run out (the CSS animation is `forwards`, so a dropped one is already invisible)
  const any = live.length > 0;
  useEffect(() => {
    if (!any) return undefined;
    const iv = setInterval(() => {
      const now = Date.now();
      setLive((prev) => { const next = prev.filter((d) => now - d.at < ttl); return next.length === prev.length ? prev : next; });
    }, 400);
    return () => clearInterval(iv);
  }, [any, ttl]);

  if (!live.length) return null;
  const dur = Math.max(600, ttl);
  return html`<div class="edm" style=${`--edm-lanes:${laneCount}`} aria-hidden="true">
    ${live.map((d) => html`<div key=${d.seq} class=${cx('edm__item', d.mine && 'is-mine')}
      style=${`--edm-lane:${d.lane};--edm-dur:${dur}ms`} data-emote=${d.id} data-player=${d.playerId}>
      ${d.name ? html`<span class="edm__name">${d.name}</span>` : null}
      <span class="edm__icon"><${EmoteArt} id=${d.id} /></span>
    </div>`)}
  </div>`;
}
