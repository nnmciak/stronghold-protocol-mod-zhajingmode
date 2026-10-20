// 2026-10-13 创建同盟时的"三档真人上限"（4 / 8 / 40；服务端 shared/constants.js ROOM_HUMAN_CAPS）
// 40 以上要房主进房后用解锁码开放到 MAX_SEATS（100 人，room.unlock）。
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';
import { createStore, useStore } from '../store.js';
import { ROOM_HUMAN_CAPS } from '../../../shared/constants.js';

export const roomCapStore = createStore({ cap: ROOM_HUMAN_CAPS[ROOM_HUMAN_CAPS.length - 1] ?? 40 });
export const setRoomCap = (cap) => roomCapStore.set({ cap: ROOM_HUMAN_CAPS.includes(cap) ? cap : roomCapStore.get().cap });

export function RoomCapSeg() {
  const cap = useStore((s) => s.cap, Object.is, roomCapStore);
  return html`<div class="rrcap">
    <span class="rrcap__k">${t('真人上限')}</span>
    <div class="set-seg" role="radiogroup" aria-label=${t('真人上限')}>
      ${ROOM_HUMAN_CAPS.map((n) => html`<button key=${n} type="button" role="radio" aria-checked=${cap === n ? 'true' : 'false'}
        class=${cap === n ? 'is-on' : ''} onClick=${() => setRoomCap(n)}>${n} ${t('人')}</button>`)}
    </div>
    <span class="rrcap__hint">${t('创建后房主可用解锁码开放到 {max} 人', { max: 100 })}</span>
  </div>`;
}
