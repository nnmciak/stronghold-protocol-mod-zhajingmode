// In-match intents (`g.*`, DESIGN §8.2) with uniform error handling: every request goes through
// `act()`, which plays a UI sound on success, shows the ERR_TEXT toast on failure and never throws.
// The UI never mutates state optimistically — it waits for the next m.private / m.public push.
// `net.request` is looked up at call time so the dev mock harness can stub it.

import { net } from '../net.js';
import { toastError } from './toasts.js';
import { audio } from '../audio.js';

const SUCCESS_SFX = {
  'g.buy': 'buy', 'g.sell': 'sell', 'g.refresh': 'refresh', 'g.freeze': 'freeze', 'g.levelUp': 'levelup',
  'g.move': 'drop', 'g.equip': 'equip', 'g.art': 'artPlace', 'g.reward': 'pick', 'g.choice': 'pick', 'g.spReroll': 'pick',
  'g.band': 'confirm', 'g.bandSkip': 'back', 'g.infoReady': 'ready', 'g.emote': 'emote', 'g.destroy': 'back',
};

let inflight = 0;
const busyListeners = new Set();
const emitBusy = () => { for (const fn of [...busyListeners]) { try { fn(inflight); } catch { /* ignore */ } } };

/** Subscribe to the number of in-flight intents (for subtle busy indicators). */
export function onBusy(fn) { busyListeners.add(fn); return () => busyListeners.delete(fn); }

/**
 * Send an intent. Resolves true on `ok`, false on error (already toasted).
 * @param {string} t
 * @param {object} [fields]
 * @param {{ sfx?: string|false, quiet?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
export async function act(t, fields = {}, opts = {}) {
  inflight += 1;
  emitBusy();
  try {
    await net.request(t, fields);
    const s = opts.sfx === undefined ? SUCCESS_SFX[t] : opts.sfx;
    if (s) audio.sfx(s);
    return true;
  } catch (err) {
    if (!opts.quiet) {
      toastError(err);
      audio.sfx('error', { volume: 0.6 });
    }
    return false;
  } finally {
    inflight = Math.max(0, inflight - 1);
    emitBusy();
  }
}

export const actions = {
  infoReady: () => act('g.infoReady'),
  band: (bandId) => act('g.band', { bandId }),
  bandSkip: () => act('g.bandSkip'),
  buy: (slot) => act('g.buy', { slot }),
  refresh: () => act('g.refresh'),
  // 惊变「维多利亚的秘密」: 本回合那一次特殊刷新（只出维多利亚、无视商店等级）
  specialRefresh: () => act('g.specialRefresh'),
  // 惊变「死亡回归」: 按下 → 自己目标生命归 0、立刻淘汰、3 秒后全体回到该回合整备阶段
  deathReturn: () => act('g.deathReturn'),
  // 「”神秘“商店」的独立特殊刷新
  mysticRefresh: () => act('g.mysticRefresh'),
  // 惊变「板藤」: 套现（卖价 4 起、每回合 +4；键位在商店栏）
  sellBanteng: () => act('g.sellBanteng'),
  // 惊变「高卢银行支票」: 提现（金额 = 每个整备阶段掷出的 +10 / 0 / -10 / +100；金额 0 时键位置灰）
  cashCheque: () => act('g.cashCheque'),
  freeze: () => act('g.freeze'),
  levelUp: () => act('g.levelUp'),
  sell: (uid) => act('g.sell', { uid }),
  // `dir` (UP|RIGHT|DOWN|LEFT): the direction chosen with the deploy wheel (research 09 §6.1 — g.move / g.art carry it;
  // the server defaults to RIGHT when absent)
  move: (uid, to, dir) => act('g.move', dir ? { uid, to, dir } : { uid, to }),
  // `replaceUid`: the equipped item the replace dialog picked (ui/equipReplace.js) — it is destroyed; absent ⇒ none needed
  equip: (itemUid, targetUid, replaceUid) => act('g.equip', Number.isInteger(replaceUid) ? { itemUid, targetUid, replaceUid } : { itemUid, targetUid }),
  art: (itemUid, row, col, dir) => act('g.art', dir ? { itemUid, row, col, dir } : { itemUid, row, col }),
  destroy: (uid) => act('g.destroy', { uid }),
  reward: (idx) => act('g.reward', { idx }),
  choice: (idx) => act('g.choice', { idx }),
  // 炸惊模拟 规则5: redraw one 惊变 card of the 惊变阶段 (one per player; the server refuses it elsewhere)
  spReroll: (idx) => act('g.spReroll', { idx }, { sfx: 'tab' }),
  ready: (ready) => act('g.ready', { ready }, { sfx: ready ? 'ready' : 'back' }),
  // 休整期换技能 / 模组（第三方 mod 移植）：单干员增量 { [baseChessId]: { skill? , module? } }。
  // 服务端只在休整期且未「准备」时接受（platform.setPrepLoadout）；自选编队槽会自动转成 setDiyPick。
  prepLoadout: (loadout) => act('g.loadout', { loadout }, { quiet: true }),
  emote: (id) => act('g.emote', { id }, { quiet: true }),
  /** ★ 炸惊模拟「锻造器」(user 2026-10-14)：选一张卡。服务端校验 / 扣数 / 累计 / 立即效果，
   *  然后回一帧新的 m.private，按钮数字与已锻造面板跟着变。 */
  forgeTake: (optId, rarity) => act('g.forgeTake', { optId, rarity }, { quiet: true }),
  // `playerId`: the player tapped in the team panel (a shared field shows two) — what an eliminated viewer follows
  watch: (fieldId, playerId = null) => act('g.watch', typeof playerId === 'string' && playerId ? { fieldId, playerId } : { fieldId }, { sfx: 'tab' }),
  autoplay: (on) => act('g.autoplay', { on }),
  // solo battles only (ui/matchStatus.js pauseAvailable): m.public.paused follows
  pause: (on) => act('g.pause', { on: !!on }, { sfx: on ? 'click' : 'confirm' }),
};
