// public/js/ui/gameLogic/equipSlots.js — how many equipment slots an operator has and which of them the 变形同构体
// occupies. 炸惊模拟 规则7 (config.modes[*].morphEquipSlot): the 变形同构体 — the only EQUIP record with `canGiveBond` —
// does not use an ordinary slot. It opens a third slot that takes nothing else, so an operator carries at most `equip`
// ordinary items PLUS one morph item. Server mirror: GameData.morphEquipSlot, PlayerItems._attach / _itemRoomFor /
// _itemRoomFor (invariants.js checks the same shape).

import { getItem } from '../../data.js';
import { currentMode, currentModeId, economyConfig } from './modeRules.js';

/**
 * Slot counts of `modeId` (default: the running match's mode).
 * @returns {{ equip: number, morph: boolean }} ordinary slots, and whether the morph item has a slot of its own
 */
export function equipSlots(modeId = currentModeId()) {
  const cfg = economyConfig();
  const mode = currentMode(modeId);
  const n = Number.isInteger(mode?.equipPerChess) ? mode.equipPerChess
    : (Number.isInteger(cfg?.equipPerChess) ? cfg.equipPerChess : 2);
  return { equip: n > 0 ? n : 2, morph: mode?.morphEquipSlot === true };
}

/** Is this item record the 变形同构体 (the EQUIP that borrows a bond from the item paired with it)? */
export const isMorphItem = (item) => !!(item && item.canGiveBond === true);

/** Item id of an entry that is either a ref ({ uid, id }) or a bare id string. */
const idOf = (x) => (typeof x === 'string' ? x : (x && x.id) || null);

/** Same, for a piece's item entry (a ref { uid, id } or a bare id). */
export const isMorphRef = (ref) => isMorphItem(getItem(idOf(ref)));

/**
 * `items` minus the morph item — the entries that count against `equip`.
 * ★ 2026-10-17（用户：维式战锤一个槽位可叠 20 个）：**可叠加**（`stackMax > 0`）的同 id 条目
 * 只算**一格** —— 与 server/match/player/items.js 的 `_normalSlots` 保持同一口径，
 * 否则 20 件锤子会让「EQUIP 20/2」这种标签爆掉。不可叠加的装备仍是一件一格。
 */
export function ordinaryItems(items) {
  const list = Array.isArray(items) ? items : [];
  const seen = new Set();
  const out = [];
  for (const it of list) {
    if (isMorphRef(it)) continue;
    const rec = getItem(idOf(it));
    if (Number(rec && rec.stackMax) > 0) {
      // 同 stackGroup（同系列）共用一格；没写 stackGroup 的退回按 id
      const grp = (typeof rec.stackGroup === 'string' && rec.stackGroup) || idOf(it);
      if (seen.has(grp)) continue;
      seen.add(grp);
    }
    out.push(it);
  }
  return out;
}

/** The morph item of `items`, or null. */
export function morphItemOf(items) {
  const list = Array.isArray(items) ? items : [];
  return list.find(isMorphRef) || null;
}

/** Whether one more ordinary item still fits on a piece carrying `items`. */
export function hasOrdinaryRoom(items, modeId) {
  const { equip, morph } = equipSlots(modeId);
  const list = Array.isArray(items) ? items : [];
  return (morph ? ordinaryItems(list).length : list.length) < equip;
}

/**
 * The `EQUIP n/m` micro label of a piece. With the morph slot on, `n` counts ordinary slots only and an occupied morph
 * slot is shown as `+变形`, so 2 normal items + a 变形同构体 reads `2/2 +变形` rather than `3/2`.
 */
export function equipLabel(items, modeId) {
  const { equip, morph } = equipSlots(modeId);
  const list = Array.isArray(items) ? items : [];
  if (!morph) return `${list.length}/${equip}`;
  return `${ordinaryItems(list).length}/${equip}${morphItemOf(list) ? ' +变形' : ''}`;
}
