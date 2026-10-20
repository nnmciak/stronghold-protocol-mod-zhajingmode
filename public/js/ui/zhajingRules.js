// 炸惊模拟 · 规则介绍（用户 2026-10-11）
//   入口：大厅难度卡片（「炸惊模拟」卡上）与房间内顶部栏各一个「规则」按钮，打开的同一块面板。
//   内容按当前 data/config.json 的实际配置写（20 格待部署区 / 敌方惊变 1+6 / 我方惊变 1·2·4·7 /
//   可转职装备 3·8·10 / 禁用的盟约 / 数值膨胀 / 隐藏核心），改动数据时记得同步这里。
//   2026-10-12 校对：可转职装备写错的 7 → 8；敌方惊变改成「每次全场共用同一张…两张同时生效、效果叠加」；
//   惊变牌库 / 刷新两条按新的牌库规则（只排除已拥有、被刷掉的回到牌库）改写。
import { html } from './components.js';
import { Button } from './components.js';
import { GIcon } from './gameComponents.js';
import { t } from '../../../shared/i18n.js';
import { createStore, useStore } from '../store.js';

export const ZHAJING_RULES_TITLE = '炸惊模拟 · 规则速览';
export const ZHAJING_RULES = Object.freeze([
  { k: '待部署区', v: '20 格、分两排（普通难度仍是 10 格一排）。' },
  { k: '敌方惊变', v: '第 1、第 6 回合开始前各抽一次，每次全场共用同一张，抽到后整局一直生效（两张同时生效、效果叠加）。' },
  { k: '我方惊变', v: '第 1 / 2 / 4 / 7 回合；每名玩家各抽各的，每次 3 张任选其一。' },
  { k: '惊变牌库', v: '每名玩家一副牌库：已选到的惊变不会再出现（选不到重复的卡）；只是抽到过、没选中的卡会回到牌库。' },
  { k: '刷新', v: '每张卡下方各有一次刷新机会，本阶段共 3 次；刷新只换掉场上这一张，被刷掉的卡回到牌库，之后仍可能再抽到。' },
  { k: '可转职装备', v: '第 3 / 8 / 10 回合的快递环节；战锤类装备合并成一个奖池一起抽。' },
  { k: '禁用盟约', v: '空船、投资人：本模式不会出现。' },
  { k: '数值膨胀', v: '敌人生命与攻击随回合成长，首领额外乘算；首领血量按存活队伍数阶梯加成。' },
  { k: '隐藏核心', v: '击败首领后进入隐秘核心，敌人更强、有专属首领与奖励。' },
  { k: '干员调配', v: '炸惊使用独立的调配（干员技能 / 模组 / 练度），与普通难度互不影响；自选干员在本模式不生效。' },
]);

/** 面板开关（两个入口共用）。 */
export const rulesStore = createStore({ open: false });
export const openZhajingRules = () => rulesStore.set({ open: true });
export const closeZhajingRules = () => rulesStore.set({ open: false });

/**
 * 「规则」按钮（大厅难度卡片 / 房间顶部栏都用它）。
 * @param {{ size?: string, class?: string }} [props]
 */
export function ZhajingRulesButton({ size = 'sm', class: cls = '' } = {}) {
  return html`<${Button} size=${size} variant="ghost" class=${cls} data-testid="zj-rules"
    title=${t(ZHAJING_RULES_TITLE)} onClick=${(e) => { e?.stopPropagation?.(); openZhajingRules(); }}>${t('规则')}<//>`;
}

/** 规则面板本体：挂在屏幕根节点一次即可（关闭时不渲染）。 */
export function ZhajingRulesHost() {
  const s = useStore((v) => v, Object.is, rulesStore);   // selector 必须是函数（照 ui/settings.js 的 useSettings）
  if (!s || !s.open) return null;
  return html`<div class="zjrules" role="dialog" aria-label=${t(ZHAJING_RULES_TITLE)} onClick=${(e) => { if (e.target === e.currentTarget) closeZhajingRules(); }}>
    <div class="zjrules__veil" aria-hidden="true"></div>
    <div class="zjrules__box">
      <header class="zjrules__head">
        <span class="zjrules__title">${t(ZHAJING_RULES_TITLE)}</span>
        <button type="button" class="zjrules__close" aria-label=${t('关闭')} onClick=${closeZhajingRules}><${GIcon} name="back" /></button>
      </header>
      <div class="zjrules__body">
        ${ZHAJING_RULES.map((r) => html`<div key=${r.k} class="zjrules__row">
          <span class="zjrules__k">${t(r.k)}</span>
          <span class="zjrules__v">${t(r.v)}</span>
        </div>`)}
      </div>
      <footer class="zjrules__foot">${t('祝你好运，博士。')}</footer>
    </div>
  </div>`;
}
