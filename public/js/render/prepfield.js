// render/prepfield.js — where the prep board is shown (research 09 §1.2, DESIGN §3 / §15): normally the own board
// (rows 7–12, the stage grid as is); in the Final Assault / Hidden Core prep the player's pieces stand on THEIR half of
// the boss field — the sim's mapping (server/match/finalAssault.js bossFieldPlacement, sim Battle.mapTile / mapDir):
// board rows ≥ 7 → row − 7 (board 9–12 → boss 2–5, the bench row 7 → 0, the temp row 8 → 1); the right-hand player
// (side 'R') is mirrored col c → 20 − c with RIGHT ↔ LEFT (UP / DOWN unchanged, ConvertChessPositionInfoToBossMap).
// 2026-10-11 待部署区翻倍到 20 格（两排，棋盘 row 7 与 row 6）：**多出来的那一排往场地远端之外再排一行**（显示行 −1），
// 棋盘 9–12 → 显示 2–5 依旧不动 —— 否则整备阶段看到的站位就和战斗里真正落子的 boss 行差一行（用户报的「错位」）。
// Pieces only ever stand on rows ≥ 6 now; other board rows (range tiles reaching past the field) shift the same way, so
// a DOWN range below the bench falls off the grid (row < minRow) instead of landing on the boss rows, and `tilesToDisp`
// drops every tile that is not on the boss field + that extra bench row — e.g. an UP range past the top wall.
//
// The view keeps every public coordinate in BOARD space (the server's, g.move targets, canPlace, highlightTiles,
// tileScreen, holdPiece, setPieceDir): only what is drawn and picked goes through this transform. Pure functions.
//
// The round's leader (community report #12, owner's decision 2026-10-04: research 09 §2.2's "the leader stands by its
// spawn point" over research 08 §4.1's pen): `leaderStand` finds it in m.private.nextEnemies (an entry with `start`, the
// leader's spawn tile on the boss field, server/match/waves.js previewOf) — the Final Assault prep shows it standing
// there instead of in the pen, and lights its hit tiles in red beside an operator's orange range preview (render/app.js).

/**
 * Board row → display (boss-field) row: row − 6。
 *
 * boss 视图的行号整体 +1（board3d/layout.js AREAS.boss 1–7 + 程序化合成的待部署区第 0 行），
 * 于是：棋盘 6（待部署区第二排）→ 0（最靠玩家）、7（第一排）→ 1、8（temp）→ 2、9–12（场地）→ 3–6、墙 7。
 * 整备期与战斗**同时** +1，所以"整备期看到的站位 = 战斗里落子的行"依旧成立。
 */
export const BOSS_ROW_SHIFT = -7;

/** 战斗视图（boss / hidden）里，模拟坐标（boss 场地 0–5）→ 显示行：+1（与整备期的场地 3–6 对齐）。 */
export const BOSS_FIELD_DISP_SHIFT = 0;

export const MAX_COL = 20;
export const BENCH_EXTRA_BOARD_ROW = 6;

const MIRROR = Object.freeze({ RIGHT: 'LEFT', LEFT: 'RIGHT', UP: 'UP', DOWN: 'DOWN' });

/** RIGHT ↔ LEFT (UP / DOWN unchanged); unknown values pass through. */
export function mirrorDir(d) {
  return typeof d === 'string' && MIRROR[d.toUpperCase()] ? MIRROR[d.toUpperCase()] : d;
}

/** The identity transform (normal prep). */
export const IDENTITY = Object.freeze({
  kind: 'board', side: 'L', mirror: false,
  toDisp: (row, col) => ({ row, col }),
  toBoard: (row, col) => ({ row, col }),
  dirToDisp: (d) => d,
  dirToBoard: (d) => d,
});

/**
 * Transform of the Final Assault prep on side 'L' | 'R' of the boss field. `toBoard` returns null for display tiles
 * that are not on the player's half of the boss rows (0–5) — nothing of the board is there.
 *
 * 待部署区两排（用户 2026-10-11，炸惊 20 格）：`benchRows` = 这几局待部署区有几排。棋盘 row 7（第一排）依旧映射到
 * 显示行 0，所以**棋盘 9–12 → 显示 2–5 那条映射一个字没动**（它必须和战斗里真正落子的 boss 行一致）；多出来的那一排
 * （棋盘 row 6，离战场更远的那排）落到显示行 **−1** —— 也就是 boss 场地的远端之外再一行，于是它才不会挤到敌人的
 * 后排上、也不会因为越界被丢掉（2026-10-11 的「boss 战整备阶段待部署区错位」就是这个：以前只认 row 7）
 * @param {'L'|'R'} side
 * @param {number} [benchRows] 待部署区排数（缺省 1 = 普通 10 格一排）
 */
export function bossPrepField(side, benchRows = 1) {
  const R = side === 'R';
  // ★ 2026-10-13 修复「boss 整备区有一半格子放不下人 / 无法部署在该位置」：
  // 原来把玩家锁在自己那半场（L: col 0–10，R: col 10–20），但那只是**双人同场**的分法；
  // **单人**（炸惊 solo，sim 用 `_s` 模板）里玩家用的是**整块场地**，于是右半边（col ≥ 11）全被判成
  // 「col/类型不符」—— 用户报的「最上面那行 / 下面这行不行」其实是「那半边的格都不行」。
  // 这里不再自锁半场，把越界交给服务端裁决（它按自己的场地规则判，非法落点会拒并给提示）。
  const lo = 0, hi = MAX_COL;
  const rows = Math.max(1, Math.trunc(Number(benchRows) || 1));
  const flip = (c) => (R ? MAX_COL - c : c);
  // 两排待部署区：minRow = 0（程序化合成的第二排）；一排：minRow = 1（棋盘 7 的第一排）。
  // 棋盘 → 显示一律 row + BOSS_ROW_SHIFT（−6）：6→0、7→1、8→2、9–12→3–6，墙 13→7。
  const minRow = rows > 1 ? BENCH_EXTRA_DISP_ROW : 1;
  return Object.freeze({
    kind: 'bossPrep', side: R ? 'R' : 'L', mirror: R, minRow, maxRow: BOSS_PREP_DISP_MAX_ROW,
    toDisp: (row, col) => ({ row: row + BOSS_ROW_SHIFT + (row <= 7 ? 1 : 0), col: flip(col) }),
    toBoard: (row, col) => {
      if (!Number.isInteger(row) || !Number.isInteger(col) || col < lo || col > hi) return null;
      // 可拾取/落位的显示行：minRow..6（0 = 合成待部署区排，1–6 = 棋盘 7–12）；7 = 墙行
      if (row < minRow || row > 6) return null;
      return { row: row <= 1 ? row - BOSS_ROW_SHIFT - 1 : row - BOSS_ROW_SHIFT, col: flip(col) };
    },
    dirToDisp: (d) => (R ? mirrorDir(d) : d),
    dirToBoard: (d) => (R ? mirrorDir(d) : d),
  });
}

/** Last display row of the boss field band (场地行 1–6 + the wall row 7) in the Final Assault prep. */
export const BOSS_DISP_MAX_ROW = 7;

export const BENCH_EXTRA_DISP_ROW = 0;

/** boss 关整备期允许出现的显示行范围：0（合成待部署区第二排）… 7（场地墙行）。 */
export const BOSS_PREP_DISP_MAX_ROW = 7;

/** 战斗视图的显示变换：模拟的 boss 场地坐标（0–5）整体 +1（见 BOSS_FIELD_DISP_SHIFT）。 */
export function bossBattleField() {
  return Object.freeze({
    kind: 'bossField', side: 'L', mirror: false, minRow: BOSS_FIELD_DISP_SHIFT, maxRow: 6 + BOSS_FIELD_DISP_SHIFT,
    toDisp: (row, col) => ({ row: row + BOSS_FIELD_DISP_SHIFT, col }),
    toBoard: (row, col) => ({ row: row - BOSS_FIELD_DISP_SHIFT, col }),
    dirToDisp: (d) => d,
    dirToBoard: (d) => d,
  });
}

/**
 * Map a list of board tiles ([[r,c]] or [{row,col}]) to display tiles ([[r,c]]). In the Final Assault prep tiles that
 * do not land on the boss field are dropped —— 下界用变换自己的 `minRow`（两排待部署区时是 −1，那排必须留下）。
 */
export function tilesToDisp(xf, tiles) {
  const out = [];
  if (!Array.isArray(tiles)) return out;
  const boss = xf && xf.kind === 'bossPrep';
  const min = boss && Number.isInteger(xf.minRow) ? xf.minRow : 0;
  // 两排待部署区时格带一直到合成的那一行（0）；上界是场地墙行（maxRow）
  const max = boss && Number.isInteger(xf.maxRow) ? xf.maxRow : BOSS_DISP_MAX_ROW;
  for (const t of tiles) {
    const r = Array.isArray(t) ? t[0] : t?.row, c = Array.isArray(t) ? t[1] : t?.col;
    if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
    const d = xf.toDisp(r, c);
    if (boss && (d.row < min || d.row > max || d.col < 0 || d.col > MAX_COL)) continue;
    out.push([d.row, d.col]);
  }
  return out;
}

/**
 * The leader standing on the boss field in its prep (see the header): the first `nextEnemies` entry flagged `boss` with
 * a spawn tile `start` ([row, col], boss-field rows 0–5) → { entry, row, col, tiles } — `tiles` its hit tiles there
 * (render/pick.js hitTiles: the sim's hit rectangle, data/enemies.json `hitArea` through `hitAreaOf(enemyKey)`; a point
 * leader its own tile) — or null.
 * @param {Array<object>|null} list m.private.nextEnemies
 * @param {(enemyKey: string) => any} hitAreaOf
 * @param {(x: number, y: number, a: any) => number[][]} hitTilesOf render/pick.js hitTiles
 */
export function leaderStand(list, hitAreaOf, hitTilesOf) {
  if (!Array.isArray(list)) return null;
  // e.start 是 boss 场地的**模拟**坐标（0–5）；显示行统一 +BOSS_FIELD_DISP_SHIFT，与战斗 / 整备的 +1 一致
  const entry = list.find((e) => e && e.boss && typeof e.enemyKey === 'string' && Array.isArray(e.start)
    && Number.isInteger(e.start[0]) && Number.isInteger(e.start[1]) && e.start[0] >= 0 && e.start[0] <= 5
    && e.start[1] >= 0 && e.start[1] <= MAX_COL);
  if (!entry) return null;
  const [srow, col] = entry.start;
  const row = srow + BOSS_FIELD_DISP_SHIFT;
  let area = null;
  try { area = hitAreaOf ? hitAreaOf(entry.enemyKey) : null; } catch { area = null; }
  const tiles = (typeof hitTilesOf === 'function' ? hitTilesOf(col, srow, area) : [[srow, col]])
    .map(([r, c]) => [r + BOSS_FIELD_DISP_SHIFT, c])
    .filter(([r, c]) => r >= BOSS_FIELD_DISP_SHIFT && r <= BOSS_DISP_MAX_ROW && c >= 0 && c <= MAX_COL);
  return { entry, row, col, tiles };
}
