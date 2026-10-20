// public/js/ui/gameLogic/prepLoadout.js — 休整期换技能 / 模组（含自选编队）的**客户端纯逻辑**。
//
// 服务端那半：server/match/match/platform.js `setPrepLoadout`（第三方 mod 移植，2026-10-11）——
// 只在休整期（PREP）且未「准备」时接受**单干员增量**；自选编队槽的增量会转给 player/diy.js 的 setDiyPick。
// 这个模块只做两件事：判断「现在能不能换」，以及把一次点击变成 `g.loadout` 的载荷（纯函数，便于无头验收）。

/**
 * 现在能换吗：自己场上/整备区的棋子、休整期、本回合还没按「准备就绪」。
 * `editable` 就是详情卡里那个「这块棋子归我管、现在能动」的标记（出售按钮用的是同一个），
 * 所以非己方棋子、非休整期、已准备时它都是 false —— 与服务器端的拒绝条件一致。
 * @param {{ editable?: boolean, ready?: boolean, piece?: any }} o
 * @returns {boolean}
 */
export function canPrepLoadout({ editable = false, ready = false, piece = null } = {}) {
  if (!editable || ready) return false;
  // **不要求 piece 存在**：场上已部署的单位只有 unit（详情卡的 piece 为 null），而 editable 本身已经等于
  // 「自己的棋子 + 休整期 + 未准备」（game.js：phase === PREP && priv && alive && !priv.ready && !watchingOther）。
  // 只在明确拿到一件装备时才拒绝（装备没有技能/模组）。
  if (piece && typeof piece === 'object' && piece.kind === 'item') return false;
  return true;
}

/**
 * 一次点击 → `g.loadout` 的载荷：`{ [基础棋子 id]: { skill? , module? } }`。
 * 自选编队棋子用**槽 id**（`chess.baseId || chess.chessId`，自选记录带着 `diyFor`，服务端按槽匹配）；
 * 拖到棋盘上的精锐用它的基础 id（配发是按基础棋子存的，见 share/protocol.js resolveLoadout）。
 * @param {any} chess 详情卡正在显示的那条记录（普通 / 精锐 / 自选 / 补位）
 * @param {{ skill?: number, module?: string }} e 只带要改的字段
 * @returns {Record<string, { skill?: number, module?: string }> | null} null = 载荷不成立（不发送）
 */
export function prepLoadoutDelta(chess, e) {
  const id = chess && typeof chess === 'object' ? (chess.baseId || chess.chessId) : null;
  if (typeof id !== 'string' || !id) return null;
  const one = {};
  if (e && Number.isInteger(e.skill)) one.skill = e.skill;
  if (e && typeof e.module === 'string') one.module = e.module;
  if (!Object.keys(one).length) return null;
  return { [id]: one };
}

/**
 * 详情卡上可以点的技能 / 模组选项（就用这条记录自己的数据，服务端用同一份数据校验）。
 * @param {any} chess @param {boolean} golden @returns {{ skills: number[], modules: string[] }}
 */
export function prepLoadoutOptions(chess, golden) {
  const skills = [...new Set((Array.isArray(chess?.skills) ? chess.skills : [])
    .map((s) => (s && Number.isInteger(s.index) ? s.index : null)).filter((i) => i != null))].sort((a, b) => a - b);
  if (!skills.length && Number.isInteger(chess?.skill?.index)) skills.push(chess.skill.index);
  const modules = golden && Array.isArray(chess?.modules)
    ? [...new Set(chess.modules.map((m) => (m && m.uniEquipId) || null).filter((x) => typeof x === 'string' && x))]
    : [];
  if (golden) modules.push('none');
  return { skills, modules };
}
