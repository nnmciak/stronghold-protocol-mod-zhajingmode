// ui/enemyJibianOverlay.js — 炸惊模拟 规则14: the 敌方惊变 reveal. ONE card is drawn by the server before round 1 starts
// (a match-long global enemy buff, the same card for the whole room) and this overlay performs the draw in front of the
// players: `flickerMs` (3 s) of cards rolling past at a flicker cadence, then `resultMs` (3 s) with the drawn card
// zoomed in and held. Full-screen and blocking — the phase's own deadline advances the match, so the overlay never
// sends anything and needs no confirm. The card list rides in m.public.enemyJibian.pool during the phase only, so the
// rolling shows real entries rather than placeholders; a pool the server could not send still rolls the drawn card.
//
// The animation is driven by wall-clock elapsed time (not by a tick count) so a dropped frame or a slow first paint
// cannot stretch the 3 s + 3 s the server is counting down in parallel. The bar below the card spans the WHOLE draw
// (flickerMs + resultMs) — it keeps filling while the drawn card is held, reaching 100 % as the phase ends.

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { RichText, GIcon } from './gameComponents.js';
import { t } from '../../../shared/i18n.js';
import { RARITY_NAMES } from './choiceOverlay.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
/** How often the rolling card is swapped (ms) — fast enough to read as a flicker, slow enough to register a name. */
const TICK_MS = 70;

/**
 * 规则14: the 敌方惊变 reveal overlay.
 * @param {{ ej: any }} props `ej` = m.public.enemyJibian ({ rarity, card, pool?, flickerMs?, resultMs? })
 */
export function EnemyJibianOverlay({ ej }) {
  const flickerMs = Math.max(0, Number(ej?.flickerMs) || 0);
  const resultMs = Math.max(0, Number(ej?.resultMs) || 0);
  const card = ej?.card || null;
  const pool = Array.isArray(ej?.pool) && ej.pool.length ? ej.pool : (card ? [card] : []);
  const [elapsed, setElapsed] = useState(0);
  const [idx, setIdx] = useState(0);
  const t0 = useRef(0);

  useEffect(() => {
    t0.current = Date.now();
    setElapsed(0);
    setIdx(0);
    const id = setInterval(() => {
      const ms = Date.now() - t0.current;
      setElapsed(ms);
      if (ms < flickerMs) setIdx(Math.floor(Math.random() * pool.length));
      // 抽奖结束 ≠ 动画结束：展示期（resultMs）里 elapsed 必须继续走，否则进度条停在 flickerMs/total 那一格不动
      // （用户反馈）。整条 bar 覆盖 flickerMs + resultMs，正好在服务端结束这个阶段时填满。
      else if (ms >= flickerMs + resultMs) clearInterval(id);
    }, TICK_MS);
    return () => clearInterval(id);
    // a different drawn card is a different draw: restart the animation from the top
  }, [flickerMs, resultMs, pool.length, card?.id, card?.name]);

  const rolling = elapsed < flickerMs;
  const shown = (rolling && pool.length ? pool[idx % pool.length] : card) || card;
  // ★ 2026-10-16 修 bug（玩家反馈「敌方惊变的稀有度会显示错误」）：定格时原来**优先用 `ej.rarity`**
  //   （服务端 roll 出来的品质），而不是卡自己的品质 —— 而 roll 到的品质在该档被抽空时会回落到整池
  //   （server/match/match/phases.js enterEnemyJibian 的 `list = ofRarity.length ? ofRarity : pool`），
  //   于是标签与卡不符：池子里 0 张稀有卡，旧权重下 25% 的抽取都会变成「稀有的传说卡」。
  //   现在**卡自己的品质优先**，`ej.rarity` 只在卡没带品质时兜底；滚动阶段（用池里真实卡片）本来就是卡的品质。
  const rarity = shown?.rarity || ej?.rarity || null;
  const total = flickerMs + resultMs;
  const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 100;

  return html`<div class=${cx('ejb', rolling ? 'ejb--roll' : 'ejb--result')} data-rarity=${rarity || 'normal'}
    role="dialog" aria-modal="true" aria-label=${t('敌方惊变')} aria-live="polite">
    <div class="ejb__scrim"></div>
    <div class="ejb__inner">
      <div class="ejb__head">
        <span class="ejb__tag"><${GIcon} name="skull" />${t('敌方惊变')}</span>
        <span class="ejb__micro">ENEMY MUTATION</span>
      </div>
      <div class="ejb__stage">
        <div class=${cx('ejb__card', rolling ? 'is-roll' : 'is-zoom')}>
          ${rarity ? html`<span class="ejb__rarity">${t(RARITY_NAMES[rarity] || '普通')}</span>` : null}
          <div class="ejb__name">${shown?.name || t('惊变')}</div>
          ${shown?.desc ? html`<div class="ejb__desc"><${RichText} text=${shown.desc} /></div>` : null}
          ${shown?.flavor ? html`<div class="ejb__flavor">${shown.flavor}</div>` : null}
        </div>
      </div>
      <div class="ejb__bar"><i style=${{ width: `${pct}%` }}></i></div>
      <div class="ejb__foot">${rolling ? t('正在抽取敌方惊变…') : t('敌方惊变已生效 · 持续全局')}</div>
    </div>
  </div>`;
}
