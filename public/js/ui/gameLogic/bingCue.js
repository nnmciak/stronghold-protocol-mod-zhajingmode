// ui/gameLogic/bingCue.js — 「？！冰？！」（惊变卡 jibian_bing）的「冰冰冰」音效判定。
//
// 卡池里这张卡的隐藏备注（data/config.json modes[*].jibian.pool `hidden`，是写给开发者的，卡面不显示）：
//   「选择此惊变后，此玩家每次触发寒冷或冻结时播放冰冰冰音效」
// 所以触发源在**服务端**：server/sim/content/jibian.js 的 beforeStatus 钩子既负责「寒冷/冻结时间翻倍」，
// 也在同一处发一个 fx 元组 `['fx', 'jibianBing', x, y, { id, owner }]`（owner = 施加者的 ownerId）。
// 把 owner 带上，是因为多人局里每名玩家都可能触发，而音效只该给**卡主自己**响。
//
// 这里只有纯逻辑（无 React / 无 DOM），音效本身由 audio.js 播；screens/game.js 负责把 b.ev 喂进来，
// 与「谢拉格冻结音效」的判定（ui/gameLogic/uniteFreezeCue.js）同一套路，便于单元测试。
//
// 节流：一次 AoE 寒冷可能在同一批元组里命中十几个敌人，所以**每批最多响一次**，并且两次之间至少隔
// MIN_GAP_MS（连续触发时听起来是「冰冰冰冰」而不是机关枪）。

/** 这张惊变卡的 id（data/config.json 卡池 effectId / 玩家 effects 里的 `jibian:<id>` 前缀）。 */
export const BING_CARD = 'jibian_bing';
/** 两次播放的最小间隔（ms）。 */
export const MIN_GAP_MS = 500;

/** 一局里的节流状态（每名客户端各自一份）。 */
export function createBingCueState() { return { lastAt: -Infinity }; }

/**
 * 我的已选惊变里有没有 ？！冰？？」（玩家 effects 记录：`key: 'jibian:jibian_bing'`，id 形如
 * `jibian_bing#3`）。两种形状都认，方便私有的 (m.private) 与视图的 (effectsView) 记录混用。
 * @param {any[]|null|undefined} effects
 * @returns {boolean}
 */
export function hasBingCard(effects) {
  if (!Array.isArray(effects)) return false;
  for (const e of effects) {
    if (!e) continue;
    if (e.key === `jibian:${BING_CARD}`) return true;
    if (typeof e.id === 'string' && new RegExp(`^${BING_CARD}#`).test(e.id)) return true;
  }
  return false;
}

/**
 * 这一批 b.ev 里有没有**我**触发的寒冷/冻结（服务端发的 fx 元组，owner = 施加者）。
 * @param {any[]} ev @param {string|null} myId
 * @returns {boolean}
 */
export function hasMyBingTrigger(ev, myId) {
  if (!myId || !Array.isArray(ev)) return false;
  for (const e of ev) {
    if (!Array.isArray(e) || e[0] !== 'fx' || e[1] !== 'jibianBing') continue;
    const extra = e[4];
    if (extra && extra.owner === myId) return true;
  }
  return false;
}

/**
 * 现在该不该响。
 * @param {object} o
 * @param {any[]} o.ev 这一帧的 b.ev
 * @param {string|null} o.myId 自己的 playerId
 * @param {boolean} o.hasCard 自己的已选惊变里有没有 ？！冰？！（hasBingCard(...)）
 * @param {string|null} [o.fieldId] 这批元组属于哪块战场
 * @param {string|null} [o.shownFieldId] 屏幕上正在演的那块战场（只对它响，避免后台战场的声音）
 * @param {{ lastAt: number }} [o.st] 节流状态（就地更新）
 * @param {number} [o.now] 当前时间（默认 performance.now / Date.now，测试可注入）
 * @returns {boolean} true = 这次要播
 */
export function bingCue({ ev, myId = null, hasCard = false, fieldId = null, shownFieldId = null, st = null, now = null } = {}) {
  if (!hasCard) return false;
  // 只认屏幕上这块战场的帧
  if (fieldId && shownFieldId && fieldId !== shownFieldId) return false;
  if (!hasMyBingTrigger(ev, myId)) return false;
  const state = st && typeof st === 'object' ? st : createBingCueState();
  const t = Number.isFinite(now) ? now : (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (t - (Number.isFinite(state.lastAt) ? state.lastAt : -Infinity) < MIN_GAP_MS) return false;
  state.lastAt = t;
  return true;
}
