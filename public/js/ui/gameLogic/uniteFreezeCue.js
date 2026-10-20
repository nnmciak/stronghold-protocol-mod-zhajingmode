// ui/gameLogic/uniteFreezeCue.js — 「第二次联防（阶段 2 跨队兜底）+ 双方都激活谢拉格盟约 + 敌人被冻结」时的音效提示。
//
// 需求（用户 2026-10-10 提出）：
//   * 只在 **第二联防阶段**（uniteRound === 2，即跨队兜底的第二块战场）；
//   * 且当前这块战场上的**两名玩家都触发了谢拉格盟约**（kjeragShip 已激活）；
//   * 每当有**敌人被冻结**（b.ev `['status', unitId, 'freeze', 1]`）时就触发一次这个音效；
//   * 播放速度：**第一轮从 1.0× 起**（1.0, 1.1, … 2.0），到 2.0× 触发后的**下一次**回到 0.8×，
//     之后每轮都是 0.8 → 2.0 循环（0.8, 0.9, … 2.0, 0.8, …）；
//   * 整条梯子一直推进到**本次联防阶段结束**才复位（阶段切换即复位；同一阶段内换战场不重来）。
//
// 这里只有纯逻辑（无 React / 无 DOM），音效本身由 audio.js 播放；screens/game.js 负责把 b.ev 与
// m.public / runner 状态喂进来，便于单元测试与复用。
//
// 关于「谢拉格盟约」的判据：m.public players[].bonds 里 `kjeragShip` 的 `active`（服务端 bondsMeta
// computeBonds 的结果），战斗中的实时层数（runner state().bondLayers[pid].kjeragShip > 0）也算触发 ——
// 一层都没有的「激活」是数据上的边缘情况，层数动了就一定触发过。

/** 谢拉格 盟约 id（data/bonds.json）。 */
export const KJERAG_BOND = 'kjeragShip';
/** 阶段 2 的轮次号（server/match/match/unitePhase.js startUnite(plans, 2)）。 */
export const RELAY_UNITE_ROUND = 2;
/** 速度梯子：**第一轮** 1.0 → 2.0（11 档），**之后每轮** 0.8 → 2.0（13 档），到顶后的下一次回到该轮起点。 */
export const RATE_FIRST = 1.0;
export const RATE_MIN = 0.8;
export const RATE_STEP = 0.1;
export const RATE_MAX = 2.0;
/** 第一轮的档数：1.0 … 2.0 = 11。 */
export const FIRST_STEPS = Math.round((RATE_MAX - RATE_FIRST) / RATE_STEP) + 1; // 11
/** 之后每轮的档数：0.8 … 2.0 = 13。 */
export const RATE_STEPS = Math.round((RATE_MAX - RATE_MIN) / RATE_STEP) + 1; // 13

/** 一局联防的速度状态（每名玩家各自推进；阶段切换就换一个新的）。 */
export function createCueState() { return { step: 0, round: 0 }; }

/**
 * 这一次触发应该用的播放速度，并推进状态（`step` 是**下一次**要用的计数）。
 *
 * 第 n 次触发（n 从 0 数）：
 *   n <  11 → 1.0 + n × 0.1            （1.0, 1.1, … 2.0）
 *   n >= 11 → 0.8 + ((n − 11) % 13) × 0.1（0.8, 0.9, … 2.0, 0.8, …）
 * 所以整条序列是：1.0 … 2.0, 0.8 … 2.0, 0.8 … 2.0, …
 * @param {{ step: number }} st
 * @returns {number} 0.8 … 2.0
 */
export function nextRate(st) {
  const n = st && Number.isInteger(st.step) && st.step >= 0 ? st.step : 0;
  const rate = n < FIRST_STEPS
    ? RATE_FIRST + n * RATE_STEP
    : RATE_MIN + ((n - FIRST_STEPS) % RATE_STEPS) * RATE_STEP;
  if (st) st.step = n + 1;
  return Math.round(rate * 100) / 100;
}

/**
 * 某名玩家的谢拉格盟约是否已触发。
 * @param {any} pub m.public
 * @param {string} playerId
 * @param {{ [playerId: string]: Record<string, number> }|null} [liveLayers] runner state().bondLayers（战斗中实时层数）
 * @returns {boolean}
 */
export function kjeragTriggered(pub, playerId, liveLayers = null) {
  if (!playerId) return false;
  const live = liveLayers && liveLayers[playerId];
  if (live && Number(live[KJERAG_BOND]) > 0) return true;                 // 本场战斗真的涨过层
  const rows = Array.isArray(pub?.players) ? pub.players : [];
  const me = rows.find((p) => p && p.playerId === playerId);
  const list = Array.isArray(me?.bonds) ? me.bonds : [];
  const b = list.find((x) => x && x.bondId === KJERAG_BOND);
  return !!(b && (b.active || Number(b.layers) > 0));
}

/**
 * 这块战场上的玩家（联防：plan.helpers 就是上场的两人）。
 * @param {any} pub @param {string} fieldId
 * @returns {string[]}
 */
export function fieldPlayers(pub, fieldId) {
  const fields = Array.isArray(pub?.fields) ? pub.fields : [];
  const f = fields.find((x) => x && x.fieldId === fieldId);
  if (f && Array.isArray(f.players)) return f.players.filter((x) => typeof x === 'string');
  return [];
}

/**
 * 这一次 b.ev 批里有没有「敌人被冻结」（`['status', id, 'freeze', 1]`）。
 * @param {any[]} ev
 * @returns {boolean}
 */
export function hasEnemyFreeze(ev) {
  if (!Array.isArray(ev)) return false;
  for (const e of ev) if (Array.isArray(e) && e[0] === 'status' && e[2] === 'freeze' && (e[3] === 1 || e[3] === true)) return true;
  return false;
}

/**
 * 现在该不该响、响多快。
 *
 * @param {object} o
 * @param {any} o.pub m.public
 * @param {any[]} o.ev 这一帧的 b.ev
 * @param {string|null} o.fieldId 这块 b.ev 属于哪块战场
 * @param {string|null} o.shownFieldId 屏幕上正在演的那块战场（只对它响，避免后台战场的声音）
 * @param {number} o.uniteRound 联防轮次（1 = 阶段 1 队内兜底，2 = 阶段 2 跨队兜底）
 * @param {{ [pid: string]: Record<string, number> }|null} [o.liveLayers] runner state().bondLayers
 * @param {{ step: number, round: number }} o.st
 * @returns {{ rate: number|null, state: { step: number, round: number } }}
 *          `rate` = 本次要播放的速度（null = 这次不响）；`state` = 传回给下次调用的状态。
 */
export function uniteFreezeCue({ pub, ev, fieldId = null, shownFieldId = null, uniteRound = 0, liveLayers = null, st } = {}) {
  const state = st && typeof st === 'object' ? st : createCueState();
  const round = Number(uniteRound) || 0;
  // 阶段换了（进/出第二联防阶段）→ 速度梯子重来。
  // 同一阶段内换战场【不】重来：梯子要一直推进到本次联防阶段结束（用户 2026-10-10 的规格）。
  if (state.round !== round) { state.round = round; state.step = 0; }
  const stage2 = round === RELAY_UNITE_ROUND;
  // 只认屏幕上这块战场的帧；轮次不是阶段 2、或这块战场没在演，就什么都不做
  const same = !!fieldId && (!shownFieldId || fieldId === shownFieldId);
  const members = stage2 && same ? fieldPlayers(pub, fieldId) : [];
  // 必须**两名**玩家上场，且都触发谢拉格
  const eligible = members.length >= RELAY_UNITE_ROUND && members.every((pid) => kjeragTriggered(pub, pid, liveLayers));
  if (!eligible || !hasEnemyFreeze(ev)) return { rate: null, state };
  return { rate: nextRate(state), state };
}
