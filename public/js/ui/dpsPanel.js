// ui/dpsPanel.js — 战斗中的 DPS 面板(屏幕右侧悬挂):最上方总伤,下方按伤害从高到低排列干员,
// 每行【左边干员头像 / 右边伤害】。
//
// 数据来自服务端 `b.snap.dmg = [[干员 id, 累计伤害, ownerId]]` —— battle/events.js 的 snapshot() 取自
// `Battle.dmgByOp`(server/sim/battle/queries.js trackOpDmg),**按干员累计**,所以干员阵亡或撤退后
// 他打出的伤害仍然留在榜上。命中判定与账目口径见 server/sim/damage.js(只算打向敌方的伤害)。
//
// **归属(观战规则,用户 2026-10-10)**:面板显示的是屏幕上这块战场的账,而这块战场属于谁由
// screens/game.js 算好(观战他人时 = 被观战人)传进来;面板只算那个人的输出。
// 这样观战队友时看到的就是**他的** DPS,而不是联防战场上两人的合计。
//
// 逐帧数据刻意不进 store(见 screens/game.js 的说明),所以这里只吃 screens/game.js 那条已经节流过的
// hud 通道:`snapHud(snap).dmg`(ui/gameLogic/format.js)。面板本身是纯展示,排序/过滤在本地做。
//
// 样式:css/screens/game.css 的 `.dpsbox`(右下角,避开右上的效果列与右中的 DP 框)。

import { useMemo } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { Img } from './gameComponents.js';
import { data } from '../data.js';
import { avatarUrl, enemyIconUrl } from '../assets.js';
import { t } from '../../../shared/i18n.js';

/** 最多显示几行,多出来的收成 "+N"。一屏 10.8rem 高、一行约 .27rem,右下角十行放得下。 */
export const DPS_MAX_ROWS = 10;

/**
 * 伤害数字:千分位。`1888959` → `"1,888,959"`。
 * @param {number} n
 * @returns {string}
 */
export function fmtDmg(n) {
  const v = Math.round(Number(n) || 0);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 把 `b.snap.dmg` 整理成排好序的行。服务端给的是 `[干员 id, 伤害, ownerId]` 三元组,顺序不管,而且
 * **同一名干员可能有多行**(联防战场上两名玩家带同一名干员时,服务端按 owner 分开记账)。
 * 这里按 `owner` 过滤(观战他人时只算被观战人的输出)后再把同名干员合并成一行。
 * 非字符串 id / 非有限数 / ≤0 的条目一律丢掉,所以坏数据不会画出空行。
 * @param {any} dmg `b.snap.dmg`
 * @param {string|null} [owner] 只看这个玩家的输出;null = 不过滤(自己打 / 联防战场两人共用一块)
 * @returns {{ id: string, dmg: number }[]|null} 伤害降序;没有可显示的行时 null
 */
export function dpsRows(dmg, owner = null) {
  if (!Array.isArray(dmg) || !dmg.length) return null;
  const byId = new Map();
  for (const e of dmg) {
    if (!Array.isArray(e) || typeof e[0] !== 'string' || !e[0]) continue;
    const v = Number(e[1]);
    if (!Number.isFinite(v) || v <= 0) continue;
    const o = typeof e[2] === 'string' ? e[2] : null;
    // ownerId 缺失的行(理论上不该有)一律保留,免得把账丢掉
    if (owner && o && o !== owner) continue;
    const cur = byId.get(e[0]);
    if (cur) cur.dmg += v;
    else byId.set(e[0], { id: e[0], dmg: v });
  }
  const rows = [...byId.values()];
  if (!rows.length) return null;
  // 伤害降序;同伤害按 id 定序,免得每帧抖来抖去
  rows.sort((a, b) => (b.dmg - a.dmg) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows;
}

/**
 * 战斗 DPS 面板。
 * @param {{ dmg?: any, owner?: string|null }} props `dmg` = `b.snap.dmg`(`[[干员 id, 伤害, ownerId]]`),
 *        `owner` = 这块战场属于谁(观战他人时 = 被观战人;准备台 `n:<playerId>` 或战斗战场反查得到)
 */
export function DpsPanel({ dmg, owner = null }) {
  const rows = useMemo(() => dpsRows(dmg, owner), [dmg, owner]);
  if (!rows) return null;
  const m = data.get('assets');
  let total = 0;
  for (const r of rows) total += r.dmg;
  const shown = rows.slice(0, DPS_MAX_ROWS);
  const rest = rows.length - shown.length;
  return html`<div class="dpsbox" aria-label=${t('总伤')} role="status">
    <div class="dpsbox__total">
      <span class="dpsbox__cap">${t('总伤')}</span>
      <b class="dpsbox__sum">${fmtDmg(total)}</b>
    </div>
    <ul class="dpsbox__list">
      ${shown.map((r) => html`<li class="dpsbox__row" key=${r.id}>
        <${Img}
          src=${avatarUrl(m, r.id) || enemyIconUrl(m, r.id)}
          class="dpsbox__ava"
          alt=""
          fallback=${html`<i class="dpsbox__ava dpsbox__ava--none"></i>`} />
        <span class="dpsbox__dmg">${fmtDmg(r.dmg)}</span>
      </li>`)}
    </ul>
    ${rest > 0 ? html`<div class="dpsbox__more">+${rest}</div>` : null}
  </div>`;
}
