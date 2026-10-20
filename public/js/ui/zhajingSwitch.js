// 2026-10-13 「普通 / 炸惊」调配切换（原来在你的 loadout.js 里，新 UI 版没有）。
// 数据层沿用 ui/loadoutSync.js 的 loadoutStore + MODE_ZJ（炸惊那套 entries 存在 LOADOUT_ZJ_PREF，两者互不影响）。
// 显示的是**生效档位**：真实房间难度优先（ui/loadoutSync.js isZjNow），房间不存在（大厅）时才看 loadoutStore.mode ——
// 与写入 / 同步同源，所以这里高亮的那一档，就是正在编辑、也是房间真正会用到的那一套。
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';
import { loadoutStore, setMode, MODE_NORMAL, MODE_ZJ, isZjNow } from './loadoutSync.js';
import { useStore } from '../store.js';

export function ZhajingSwitch() {
  // loadoutStore = 界面自己选的档（订阅它：点切换立刻重绘）；app store = 真实房间难度（isZjNow 里优先读它）。
  // 两个 store 都订阅：房主改了难度这里立刻跟着变，不会再出现「高亮普通档、实际在用炸惊那套」。
  const mode = useStore((s) => s.mode, Object.is, loadoutStore);
  const zj = useStore((s) => isZjNow({ ...loadoutStore.get(), mode }, s));
  
  const onMode = (m) => setMode(m);
  return html`<div class=${'lo-modes' + (zj ? ' is-zj' : '')} data-mode=${zj ? 'zhajing' : 'normal'}>
    <div class="lo-seg" role="tablist" aria-label=${t('调配模式')}>
      <button type="button" role="tab" aria-selected=${!zj} class=${zj ? '' : 'is-on'}
        title=${t('普通模式：与其他房间共用这一套调配')} onClick=${() => onMode(MODE_NORMAL)}>${t('普通')}</button>
      <button type="button" role="tab" aria-selected=${zj} class=${zj ? 'is-on' : ''}
        title=${t('炸惊模式：炸惊模拟专用的独立调配。炸惊模拟的房间会使用这一套，其他房间仍用普通调配')} onClick=${() => onMode(MODE_ZJ)}>${t('炸惊')}</button>
    </div>
    ${zj ? html`<span class="lo-modes__tip">${t('炸惊模拟：这里的调配独立保存，不与普通调配互相影响。')}</span>` : null}
  </div>`;
}
