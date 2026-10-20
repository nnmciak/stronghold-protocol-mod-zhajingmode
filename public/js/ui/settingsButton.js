// 2026-10-13 新 UI（hub）大厅/房间头部需要的设置按钮。
// 自包含实现：弹窗用你自己 settings.js 里的 SettingsModal（你那套设置界面），因此不会引入任何内部符号。
import { useState } from '../../vendor/hooks.module.js';
import { html, Button } from './components.js';
import { GIcon } from './gameComponents.js';
import { SettingsModal } from './settings.js';
import { t } from '../../../shared/i18n.js';

export function SettingsButton({ class: cls, size = 'md', variant = 'ghost', label = t('设置'), square = false }) {
  const [open, setOpen] = useState(false);
  const cls2 = cls ? 'settings-btn ' + cls : 'settings-btn';
  return html`<${Button} variant=${variant} size=${size} square=${square} class=${cls2}
    onClick=${() => setOpen(true)} title=${t('设置')} aria-label=${t('设置')} data-testid="settings-btn">
    <${GIcon} name="gear" class="btn__icon" />${square ? null : label}<//>
  ${open ? html`<${SettingsModal} open=${true} onClose=${() => setOpen(false)} />` : null}`;
}
