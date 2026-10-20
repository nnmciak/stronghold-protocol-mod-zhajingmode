// public/js/ui/gameLogic/bench.js — 当前这一局的待部署区规格（用户 2026-10-11：翻倍只在炸惊模式生效）。
// 普通模式 10 格一排；炸惊 20 格两排。数值一律从服务端发下来的 hand 长度读，保证和服务器一致。
import { store } from '../../store.js';
import { BENCH, benchSizeOf, handTileOf as tileOf, handIndexOf as indexOf } from '../../../../shared/constants.js';

/** 当前对局的整备区格数（读 m.private.hand 的长度；没有对局时按普通 10）。 */
export function benchSize() {
  const n = store.get()?.match?.private?.hand?.length;
  return Number.isInteger(n) && n > 0 ? n : BENCH.base;
}

/** 当前对局的模式 id（取不到时返回 null ⇒ 普通规格）。 */
export const benchModeId = () => store.get()?.match?.public?.modeId ?? null;

/** 槽位 idx → 棋盘格子（按当前对局规格）。 */
export const benchTileOf = (idx) => tileOf(idx, benchSize());

/** 棋盘格子 → 槽位 idx（按当前对局规格）。 */
export const benchIndexOf = (row, col) => indexOf(row, col, benchSize());

export { benchSizeOf };
