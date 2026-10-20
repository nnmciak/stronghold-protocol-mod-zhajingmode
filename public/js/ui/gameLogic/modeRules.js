// public/js/ui/gameLogic/modeRules.js — the small per-mode flags the client needs outside a component's props.
// The running match's mode is m.public.modeId (the server picks it with modeIdFor(roomMode, difficulty), Match.js), and
// its record is config.json `modes[modeId]` — the same record the server's GameData reads, so a rule that is pure data
// (炸惊模拟 规则7 的第三格、规则10 的资金结转 …) is answered identically on both sides.

import { store } from '../../store.js';
import { getConfig, getMode } from '../../data.js';

/** The modeId of the running match (m.public.modeId), or null outside a match. */
export function currentModeId() { return store.get()?.match?.public?.modeId ?? null; }

/**
 * The running match's mode record (config.json `modes[modeId]`), or null.
 * @param {string|null} [modeId] default: the running match's mode
 */
export function currentMode(modeId = currentModeId()) { return modeId ? getMode(modeId) : null; }

/** One field of the running match's mode record, or undefined. */
export function modeFlag(name, modeId = currentModeId()) {
  const m = currentMode(modeId);
  return m ? m[name] : undefined;
}

/** The global (mode-independent) economy block of config.json. */
export const economyConfig = () => getConfig()?.economy || null;
