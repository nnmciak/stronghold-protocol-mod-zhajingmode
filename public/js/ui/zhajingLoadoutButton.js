// 2026-10-13 大厅右侧「炸惊模拟干员调配」入口：先切到炸惊档，再打开干员调配。
// 样式与上面那颗「干员调配」一致（hub-plate），但用 variant primary 以示区别。
import { html, Button } from './components.js';
import { t } from '../../../shared/i18n.js';
import { setMode, MODE_ZJ } from './loadoutSync.js';
import { openLoadout } from '../screens/loadout.js';

export function ZhajingLoadoutButton({ class: cls }) {
  const onClick = () => { setMode(MODE_ZJ); openLoadout('lobby'); };
  return html`<${Button} variant="secondary" size="lg" icon="edit"
    class=${'hub-plate hub-plate--loadout' + (cls ? ' ' + cls : '')}
    data-testid="zj-loadout" onClick=${onClick}
    title=${t('炸惊模拟专用的独立调配：这里的技能、模组、潜能练度只对炸惊房间生效')}>${t('炸惊模拟干员调配')}<//>`;
}
