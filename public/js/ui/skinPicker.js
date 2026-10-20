// 皮肤选择器 (docs/SKINS.md) — the 皮肤 section of the 干员调配 screen's detail panel.
//
// All 174 skins are built-in. Operators without skins return null silently.
// Outside match only: changes are persisted to localStorage and mirrored via room.skins.

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, MicroLabel } from './components.js';
import { useStore, shallowEqual } from '../store.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { skinsStore, availableSkins, loadSkinData, setSkin, clearSkin } from './skins.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * The skin tile's art: its 180×180 avatar.
 *
 * Deliberately NOT `portrait` (the 180×360 illustration): the tiles are small squares, so a half-body drawing gets
 * letterboxed down to an unreadable sliver. The illustration belongs where there is a tall frame — the operator
 * detail header and the shop card — and the avatar is what a square tile wants. See docs/SKINS.md.
 *
 * Keyed by OPERATOR id, not by chess id: data/assets.json groups everything under `chars[charId]`.
 */
function skinArt(charId, skinId) {
  const rec = data.get('assets')?.chars?.[charId]?.skins?.[skinId];
  return (rec && (rec.avatar || rec.portrait)) || null;
}

/** The operator's default art for the tile's 「默认」 option: its avatar, then its illustration. */
function defaultArt(charId) {
  const rec = data.get('assets')?.chars?.[charId];
  return (rec && (rec.avatar || rec.portrait)) || null;
}

/**
 * 皮肤 section for one operator.
 * @param {{ chess: any }} props `chess` is the chess record of the detail panel
 */
export function SkinSection({ chess }) {
  const s = useStore((v) => v, shallowEqual, skinsStore);
  const [, bump] = useState(0);

  // 皮肤按【一个或多个】chess id 存。为什么要多键:同一件衣服在服务端有几条查找路径 ——
  //   skinOfPiece 的顺序是 baseId → pieceId → rec.charId → pick.charId
  // 自选(外援)干员的 pieceId 是槽位 id(chess_char_5_diy1_a),而它的 charId 要等运行时才注入,
  // 只写一个键就可能在某一环落空(表现为"换了时装但模型没变")。写全了无论命中哪一环都成立。
  const keys = (Array.isArray(chess && chess.chessIds) ? chess.chessIds : [chess && chess.chessId])
    .filter((k) => typeof k === 'string' && k);
  const chessId = keys[0] || '';        // 读的时候以第一个为准("当前装着哪件")
  const charId = chess && chess.charId;

  useEffect(() => {
    let dead = false;
    loadSkinData();
    const off = data.subscribe?.(() => { if (!dead) bump((n) => n + 1); });
    const t = setInterval(() => { if (!dead) bump((n) => n + 1); }, 500);
    return () => { dead = true; clearInterval(t); off?.(); };
  }, [chessId, charId]);

  if (!chessId || !charId) return null;
  const skinsReady = data.status('skins') === 'ready';
  if (!skinsReady) {
    return html`<section class="lo-sec lo-sec--skin" data-testid="skin-section">
      <header class="lo-sec__head">
        <h3>${t('皮肤')}<${MicroLabel}>SKIN<//></h3>
        ${s.sync === 'error' ? html`<span class="lo-skin__sync is-err" data-testid="skin-sync">${t('同步失败，正在重试…')}</span>`
          : s.sync === 'sending' || s.sync === 'pending' ? html`<span class="lo-skin__sync" data-testid="skin-sync">${t('同步中…')}</span>`
          : s.sync === 'synced' ? html`<span class="lo-skin__sync is-ok" data-testid="skin-sync">${t('已同步到服务器')}</span>`
          : null}
        <span class="lo-sec__note">${t('正在载入配置…')}</span>
      </header>
    </section>`;
  }

  const list = availableSkins(charId);
  if (!list.length) return null; // 确认加载完且真无皮肤才隐藏

  const chosen = s.entries[chessId] || (charId ? s.entries[charId] || null : null);
  const defArt = defaultArt(charId);
  // 多键写入:第一个键留着"当前选择",其余键同步成同一件(或一并清掉)
  // 干员皮肤（炸惊修复 2026-10-11）：keys 只含**本页签棋库**的 id，而同一名干员在普通/炸惊两套棋库里
  // id 不同（chess_char_1_01_a vs chess_zj_01_a），皮肤表按棋子 id 存 → 换个模式就查不到（炸惊里小人不变）。
  // 多写一份 charId：服务端 skinOfPiece 会回落到 rec.charId，客户端各处也有同样的回落，于是模式间通用。
  const allKeys = charId && !keys.includes(charId) ? [...keys, charId] : keys;
  const pick = (skinId) => { for (const k of allKeys) setSkin(k, skinId); };
  const clear = () => { for (const k of allKeys) clearSkin(k); };

  return html`<section class="lo-sec lo-sec--skin" data-testid="skin-section">
    <header class="lo-sec__head">
      <h3>${t('皮肤')}<${MicroLabel}>SKIN<//></h3>
      <span class="lo-sec__note">${t('{n} 款可选', { n: list.length })}</span>
    </header>
    <div class="lo-skins" role="radiogroup" aria-label=${t('选择皮肤')}>
      <button type="button" role="radio" aria-checked=${chosen ? 'false' : 'true'} data-skin=""
        class=${cx('lo-skin', 'lo-skin--default', !chosen && 'is-on')} onClick=${clear}>
        <span class="lo-skin__art">
          ${defArt
            ? html`<img src=${defArt} alt="" loading="lazy" />`
            : html`<span class="lo-skin__art--none"></span>`}
        </span>
        <span class="lo-skin__text">
          <b class="lo-skin__name">${t('默认')}</b>
          <span class="lo-skin__group">DEFAULT</span>
        </span>
        ${!chosen ? html`<span class="lo-skin__badge">${t('已装配')}</span>` : null}
      </button>
      ${list.map((x) => {
        const art = skinArt(charId, x.id) || defArt;
        const isEquipped = chosen === x.id;
        return html`<button key=${x.id} type="button" role="radio" aria-checked=${isEquipped ? 'true' : 'false'}
            data-skin=${x.id}
            class=${cx('lo-skin', isEquipped && 'is-on')}
            onClick=${() => pick(x.id)}>
          <span class="lo-skin__art">
            ${art
              ? html`<img src=${art} alt="" loading="lazy" onError=${(e) => {
                  if (defArt && e.currentTarget.src !== defArt) {
                    e.currentTarget.src = defArt;
                  }
                }} />`
              : html`<span class="lo-skin__art--none"></span>`}
          </span>
          <span class="lo-skin__text">
            <b class="lo-skin__name">${x.name}</b>
            <span class="lo-skin__group">${x.group || 'SPECIAL'}</span>
          </span>
          ${isEquipped ? html`<span class="lo-skin__badge">${t('已装配')}</span>` : null}
        </button>`;
      })}
    </div>
  </section>`;
}
