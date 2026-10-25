// server/lobby.js — rooms, seats, host, AI seats, ready/start, reconnect, and room → Match wiring
// (DESIGN §2, §6.1 LOBBY, §8.1). Implements the handler interface consumed by server/net.js.
//
// Rules (the choices where DESIGN is silent are marked ▸):
//   * Rooms are keyed by 4-letter codes from an unambiguous alphabet (no I/O, letters only). Join codes are
//     case-insensitive.
//   * 'solo' rooms hold exactly one human and never bots. 'coop' rooms have 4 seats (humans + AI bots).
//     Humans and bots take the lowest free seat index; seat indexes never compact.
//   * ▸ Being in a LOBBY room and sending room.create / room.join implicitly leaves it. While your room is
//     in a match, create/join of another room fails with ROOM_STARTED (send g.leave or room.leave first).
//   * Host-only: room.setDifficulty, room.addBot, room.removeBot, room.kick, room.kickUnready, room.start. ▸ Changing the
//     difficulty un-readies the other humans. ▸ room.start requires every other human to be connected and ready;
//     the host's start counts as the host's ready (the host may still toggle room.ready for display).
//   * room.kick {seat, playerId} (community report #17, owner approved): before the match only, the host removes another
//     human like an AI seat (an AI seat stays room.removeBot's; never the host itself). `playerId` names the player the
//     host confirmed: a seat that changed hands meanwhile (left, someone else joined) is refused with BAD_TARGET. The
//     seat is freed at once and the player gets `room.closed {reason:'kicked'}` — now, or on the next resume when
//     offline (with the result replay, as the grace timeout) —, so the reconnect token no longer leads back to the seat
//     (it stays the player's identity: net.js sessions belong to players, not seats). ▸ No ban: the player may join
//     again with the code.
//   * room.kickUnready {} (no fields): the same host-only, before-the-match one-shot with no confirmed `playerId` — it
//     removes every seated human whose seat is not ready (never the host, never an AI seat, never a spectator).
//     Removing nobody is a success, not an error (the screen says 没有未准备的博士).
//   * Host migration: when the host leaves (or is removed), the lowest-seat remaining human (connected
//     ones first) becomes host. A room without humans is disposed (bots never keep a room alive).
//   * Disconnect in LOBBY: the seat shows connected=false and is freed after `lobbyGraceMs` (60 s); a
//     session that comes back after that gets `room.closed {reason:'timeout'}`.
//     Disconnect in a match: the seat is kept and match.onDisconnect(playerId) is called.
//   * Reconnect: `hello` with a known token (reconnect window, 10 min, see net.js) rebinds the session;
//     the lobby then broadcasts room.state and, in a match, calls match.onReconnect(playerId).
//     Solo runs (下半: "休整期及机变阶段没有时间限制…24小时内随时返回", research 01 §1 / 06 §17): a session that drops
//     while its solo room's match runs stays resumable for the official `config.constants.singleReconnectTime`
//     (86400 s; option `soloReconnectWindowMs` overrides it) instead of the 10-minute window — the untimed solo match
//     simply waits (net.js session.resumeWindowMs, set at every disconnect). Only after that does expiry turn into
//     match.onLeave ('abandoned'). The extension outlives the match, so a run that ended meanwhile (e.g. a server-run
//     Final Assault) still shows its result on the player's return.
//     A repeated hello on a live connection is a full resync: room.state goes to the requester only
//     (broadcast only when the seat visibly changed, e.g. a rename in LOBBY); the heavy part (match.onReconnect,
//     or the result replay below) runs at most once per `resyncMinGapMs` per session — extra requests inside
//     that window coalesce into one deferred resync, so hello spam cannot amplify into ~15 KB per request.
//   * Result replay: the match's final m.public and each human's m.result are kept after the match ends. A
//     human who resyncs (resume after a drop, a reloaded tab, a repeated hello) while the room is back in LOBBY
//     gets room.state followed by those two frames again, until they act in the room (ready, difficulty, AI
//     seats, start), leave it, or a new match starts. A human removed by the lobby grace gets them right after
//     `room.closed {timeout}` on their next resume (Match.onReconnect cannot do this: the lobby drops the
//     match reference at onEnd and disposes it on the next macrotask).
//   * Per-network limits (internet clients only, see net.js clientAddress): at most `maxRoomsPerAddr` rooms
//     created from one network may exist at once and at most `maxMatchesPerAddr` matches started from one
//     network may run at once (room.create / room.start → ERR.RATE). Without them a socket loop could fill
//     `maxRooms` or keep hundreds of unattended matches simulating for the whole reconnect window.
//   * Permanent departure during a match (room.leave, g.leave, reconnect window expired): the seat is
//     marked departed (shown as connected=false), match.onLeave(playerId) is called, and the seat is freed
//     when the match ends. 'g.leave' is handled here and never reaches match.handle().
//   * All other 'g.*' messages go to room.match.handle(playerId, msg); its {ok}/{error} becomes the reply.
//   * Match lifecycle: room.start → new Match({...}) → room.state (inMatch=true) → match.start(). The match gets
//     `matchNo` = the room's match number (1, 2, …): with the seed it keeps battleIds unique across the room's
//     matches, so a late b.progress / b.result of the previous match is ignored by the next one (DESIGN §14).
//     onEnd(summary) → room back to LOBBY (departed seats freed, humans un-readied, disconnected humans
//     get the lobby grace), dispose() on the next macrotask. Players can start again.
//   * room.closed reasons: 'timeout' (removed after lobby grace), 'kicked' (room.kick, room.removeSpectator), 'empty' (a
//     spectator whose room lost its last player), 'shutdown' (server stopping).
//   * Operator loadout (DESIGN §16): room.loadout { entries } is checked strictly against the game data
//     (shared/protocol.js checkLoadout: known visible chess, a skill index legal for the normal AND the elite status, a
//     module of the elite or 'none'; any bad entry rejects the whole message, nothing is stored). ▸ It is stored on the
//     session (it follows the player into every room they create/join, and survives a resume) and on the seat; the
//     match receives seats[].loadout (bots: none — they fight with the defaults). ▸ Accepted any time: in a LOBBY room
//     (or outside a room) it simply replaces the stored one; while the room's match runs it is also handed to
//     match.setLoadout(playerId, loadout), which accepts it only during INFO_CHECK (the 干员调配 entry of the briefing)
//     and refuses it afterwards (WRONG_PHASE: the match's loadout is locked, the stored one applies to the next match).
//   * Operator ownership (干员持有, 0.2.0 补位, owner's decision 2026-10-05): room.ownership { notOwned } — the base chess
//     ids the player marked as not owned — is checked leniently (shared/protocol.js checkNotOwned: anything that is not
//     a droppable NORMAL chess is dropped, never the whole list; only a malformed list is BAD_MSG) and stored on the
//     session and the seat like the loadout. The match receives seats[].notOwned when it starts (bots: none — they own
//     every operator) and keeps it for its whole length: the setting is out of match ("局外设置，下一局生效"), so while
//     the room's match runs a new list is only stored for the next match (ROOM_STARTED 'stored for the next match',
//     never handed to the match). A spectator's list stays on its session.
//   * 自选编队 (0.2.0 DIY, the owner's decisions of 2026-10-05): room.diy { picks } — the player's picks for the four DIY
//     slots ({ [slotBaseId]: { charId, skillIndex?, uniEquipId? } | null }) — is checked leniently (shared/protocol.js
//     checkDiyPicks against the game data and the kit registry, server/sim/content/kits/index.js KITTED_CHARS: an
//     illegal pick — an operator without a kit, another tier's prototype, a prototype off its locked skill, a second slot
//     of one owned operator, the same operator twice in a tier, an unknown slot / skill / module — is dropped, never the
//     whole roster; only malformed picks are BAD_MSG) and stored on the session and the seat exactly like the
//     not-owned list: the match receives seats[].diy when it starts (bots: none — they field no 自选 piece [ASSUMED]),
//     and a change while it runs is stored for the next match (ROOM_STARTED 'stored for the next match'). Every
//     `welcome` carries `diyKitted` (welcomeInfo): the operators a DIY slot may field, so the client's picker offers
//     exactly what the server accepts.
//   * Spectator seats (community report #26, owner's decision 2026-10-04 — a remake feature, the official room has none):
//     room.spectate { code } takes one of a co-op room's MAX_SPECTATORS (2) spectator seats, in its lobby or while its
//     match runs (▸ solo rooms: ROOM_FULL). A spectator is not a player: never in `seats`, never counted for the 1–4 players
//     or the start gate, never host, never keeps a room alive (a room whose last human leaves closes with room.closed
//     {empty} for its spectators). It receives room.state (`spectators: [{ playerId, name, connected }]`) and every match
//     broadcast (m.public, m.ticker, m.emote, b.pool — public data); the match registers it (opts.spectators /
//     addSpectator) and shows it fields like an eliminated player (b.start watch / m.field), never an m.private. It may
//     only g.watch (the heavy bucket, like every watcher), g.leave / room.leave, and room.loadout / room.ownership /
//     room.diy (stored for its session, never handed to the match); anything else → SPECTATOR (▸ emotes too). Host: room.removeSpectator { playerId } any
//     time → room.closed {kicked} to it. A spectator in a LOBBY room may take a free player seat with room.join of the same
//     code; a player never switches to spectating in place (ALREADY). Disconnect / grace / reconnect / expiry work as for
//     a player seat (the seat is kept and given back on resume).

import { recallSkins, rememberSkins } from './skinsMemory.js';
import { recallLoadout, rememberLoadout } from './loadoutMemory.js';
import { randomBytes, randomInt } from 'node:crypto';
import { BOT_ROOM_CAP, CLIENT_BOTS_SOLO_MAX, CLIENT_BOTS_PER_PERSON, ERR, MAX_SEATS, MAX_SPECTATORS, ROOM_CODE_LEN, ROOM_HUMAN_CAPS, modeIdFor, BOT_FILL_MAX_HUMANS, MAX_SERVER_BOTS, BOT_FILL_MAX_BOTS } from '../shared/constants.js';
import { checkLoadout, checkLoadoutOps, cultivationCharIds, checkLoadoutBans, checkNotOwned, checkDiyPicks } from '../shared/protocol.js';
import { banQuota } from '../shared/banPick.js';
import { encode, isDroppable, isErrCode, sendRaw, sendSession } from './net.js';
import { isCompressibleType, resolveWsCompression } from './wsCompression.js';
import { createSharedDeflate, PRE_DEFLATED } from './wsSharedDeflate.js';
import { getData as defaultGetData, lookup } from './data.js';
import { Match as DefaultMatch } from './match/Match.js';
import { randomBotName } from './match/bot.js';
import { KITTED_CHARS } from './sim/content/kits/index.js';

/** Room code alphabet: uppercase letters without I and O (and no digits, so no 0/1). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Tunables. */
export const LOBBY_DEFAULTS = Object.freeze({
  lobbyGraceMs: 60_000,   // disconnected humans keep their lobby seat this long
  maxRooms: 1000,
  maxRoomsPerAddr: 16,    // rooms created from one client network that may exist at once (0 = unlimited)
  maxMatchesPerAddr: 8,   // matches started from one client network that may run at once (0 = unlimited)
  resyncMinGapMs: 1000,   // heavy resyncs (match state / result replay) per session at most this often on repeated hellos
  soloReconnectWindowMs: 60 * 60 * 1000, // ★ 2026-10-26（owner）：单人局掉线保留 1 小时（原 null = 官方 24 h；挂机十几小时的幽灵房太多）
});

/** Official `singleReconnectTime` (s) when the data lacks it (constData, research 01 §1). */
export const SOLO_RECONNECT_FALLBACK_SEC = 86_400;

/**
 * 大厅侧的两个节流（用户 2026-10-13 审计，都经过实测）：
 *
 * - `STATE_COALESCE_MS`：座位变动触发的 `room.state` 全房广播合并窗口。100 座一帧 ≈ 16.8 KB，
 *   一帧要写给房间里每个在线人类（实测 100 座 = 1.60 MiB / 0.54 ms 每次广播）。10 次 ready 切换就是
 *   16 MiB 上行；25ms 窗口把同一窗口内的多次变动压成一帧（连续操作时省 ~100×）。
 * - `REPLAY_TTL_MS`：`room.replay`（上一局的整份 m.public + 每人 m.result，22–165 KB/房）原来只能靠
 *   玩家动作释放，没人动的房间会一直留着。超过这个时间（远大于重连窗口）就丢掉，走 room.state。
 */
export const STATE_COALESCE_MS = 25;
export const REPLAY_TTL_MS = 15 * 60_000;
export const REPLAY_SWEEP_MS = 60_000;

const OK = Object.freeze({ ok: true });
const fail = (code, detail) => (detail ? { error: code, detail } : { error: code });

/**
 * How many seats a HUMAN may occupy in a co-op room before the host unlocks it. The remaining seats exist and are
 * AI-only. 40 is what a public room can realistically fill and keep readable; the O(N²) snapshot fan-out is why the
 * 100-seat build needed the latency guard in the first place (see messaging.publicThrottleMs).
 */
const HUMAN_CAP = 40;

/**
 * 解锁码 for raising a room to the full 100 human seats (`room.unlock`). The 100-seat mode is a community/test
 * feature: it is handed out by the operator rather than exposed as a plain checkbox, so a public room does not get
 * flooded past 40 by whoever clicks first. Compared case-insensitively and ignoring separators, so a player may type
 * it with or without dashes.
 */
const UNLOCK_CODE = 'QWJ4-J3J3-8MEH-WKHW';

/** Normalise a typed unlock code: upper case, no spaces or dashes. */
const normCode = (s) => String(s == null ? '' : s).toUpperCase().replace(/[\s-]/g, '');
const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * @typedef {{ seat: number, playerId: string, name: string, isBot: boolean, ready: boolean,
 *             connected: boolean, left: boolean, loadout?: Record<string, { skill: number, module: string|null }> | null,
 *             notOwned?: readonly string[] | null, diy?: Readonly<Record<string, DiyLoadout>> | null }} Seat
 * @typedef {{ charId: string, skillIndex: number, uniEquipId: string|null }} DiyLoadout
 */

/** Deep-frozen copy of a checked loadout (shared by the session, the seat and the match's PlayerState). */
function freezeLoadout(loadout) {
  const out = {};
  for (const [id, e] of Object.entries(loadout || {})) out[id] = Object.freeze({ skill: e.skill, module: e.module ?? null });
  return Object.freeze(out);
}

/** Deep-frozen copy of checked operator settings (0.2.2 潜能 / 练度; shared by the session, the seat and the match). */
function freezeOps(ops) {
  const out = {};
  for (const [id, e] of Object.entries(ops || {})) out[id] = Object.freeze({ potential: e.potential, cultivate: e.cultivate });
  return Object.freeze(out);
}

/** The charIds a player may set a potential / 练度 for, per data object (shared/protocol.js cultivationCharIds). */
const OPS_IDS = new WeakMap();
function opsCharIds(data) {
  if (!data || typeof data !== 'object') return new Set();
  let ids = OPS_IDS.get(data);
  if (!ids) { ids = cultivationCharIds(data.chess, data.backups); OPS_IDS.set(data, ids); }
  return ids;
}

/** Deep-frozen copy of checked 卡池预选 picks (shared/banPick.js profile; session, seat and match share it). */
function freezeBans(bans) {
  const byDifficulty = {};
  for (const [d, e] of Object.entries(bans?.byDifficulty || {})) {
    byDifficulty[d] = Object.freeze({
      bonds: Object.freeze([...(e.bonds || [])]),
      favorites: Object.freeze([...(e.favorites || [])]),
      fill: e.fill !== false,
    });
  }
  return Object.freeze({ v: 1, byDifficulty: Object.freeze(byDifficulty) });
}

/** Deep-frozen copy of checked 自选 picks (shared by the session, the seat and the match's PlayerState). */
function freezeDiy(picks) {
  const out = {};
  for (const [id, p] of Object.entries(picks || {})) out[id] = Object.freeze({ charId: p.charId, skillIndex: p.skillIndex, uniEquipId: p.uniEquipId ?? null });
  return Object.freeze(out);
}

/**
 * Frozen copy of a skin selection, keeping only entries whose chess the game data knows (docs/SKINS.md).
 *
 * Two kinds of key are allowed through without a chess lookup:
 *   * `char_*` — a DIY slot is keyed by character, and its skin is chosen once for the slot rather than per
 *     composed chess (the same rule PlayerState.setSkins uses);
 *   * `chess_char_*_diy*` — a composed DIY chess id.
 * A value is stringified, so a number that survives the protocol check cannot reach the match as a non-string.
 *
 * @param {Record<string, string>} skins `{ [baseChessId]: skinId }`
 * @param {(id: string) => any} getChess
 */
function freezeSkins(skins, getChess) {
  const out = {};
  for (const [id, skinId] of Object.entries(skins || {})) {
    // an empty or non-string value is not a selection: dropping it here (rather than String()-ing it) keeps
    // `skins[id] === ''` out of the match, where it would look like a chosen skin that resolves to no model
    if (typeof skinId !== 'string' || !skinId) continue;
    if (typeof id === 'string' && (id.startsWith('char_') || (id.startsWith('chess_char_') && id.includes('_diy')))) {
      out[id] = skinId;
      continue;
    }
    const rec = getChess(id);
    // ★ 2026-10-15（用户：初雪/银灰的战斗小人不换皮肤）—— 原来这里 `rec.visible === false` 一律丢弃，
    //   但【炸惊棋库的卡正是 visible === false】（只在炸惊可见，普通模式看不见）⇒ 玩家给炸惊的
    //   银灰/初雪选的皮肤全被丢掉，服务端 skinOfPiece 解析不出，战斗小人就用默认模型。
    //   放行条件：记录存在、不是精锐/隐藏、且（可见 或 是炸惊专用卡）。普通模式行为不变。
    //   ★ 2026-10-16：同一口径必须同步到 **PlayerState.setSkins（server/match/player/basics.js）** ——
    //   只修这里是不够的：大厅放行后，进入对局时 setSkins 会按 visible 再滤一次，皮肤一样到不了战斗。
    //   两处的判定条件必须逐字一致（改一处就改两处）。
    const okVisible = !!rec && rec.visible !== false;
    const zjOnly = !!rec && rec.visible === false && rec.zhajing === true;
    if (!rec || rec.isGolden || rec.isHidden || (rec.baseId && rec.baseId !== id) || !(okVisible || zjOnly)) continue;
    out[id] = skinId;
  }
  return Object.freeze(out);
}

/** One room: 4 seat slots, host, difficulty, optional running match. */
export class Room {
  /** @param {string} code @param {'solo'|'coop'} mode @param {string} difficulty @param {number} now */
  constructor(code, mode, difficulty, now) {
    this.code = code;
    this.mode = mode;
    this.difficulty = difficulty;
    /**
     * 「AI 队友最后选择」 (room.setAiPicksLast, GitHub #338; co-op only, off by default): the match's strategy and 机变 draft
     * s put every human seat before every AI seat (Match opts.aiPicksLast). Kept across the room's matches.
     */
    this.aiPicksLast = false;
    /** @type {string | null} */
    this.hostId = null;
    /** @type {(Seat | null)[]} */
    this.seats = new Array(MAX_SEATS).fill(null);
    /** @type {{ playerId: string, name: string, connected: boolean }[]} spectator seats, ≤ MAX_SPECTATORS (header) */
    this.spectators = [];
    /** @type {any} running Match instance */
    this.match = null;
    /** @type {{ live: boolean, ended: boolean, disposed: boolean, match: any } | null} */
    this.matchCtx = null;
    this.matchCount = 0;
    /** @type {any} summary passed to onEnd by the last match */
    this.lastSummary = null;
    /**
     * Frames of the last match's end, replayed on resync to humans who have not moved on yet.
     * @type {{ publicFrame: string | null, frames: Map<string, string>, pending: Set<string> } | null}
     */
    this.replay = null;
    /** @type {string | null} per-network limit key of the creator (net.js clientAddress) */
    this.ownerKey = null;
    /** @type {string | null} per-network limit key of whoever started the running match */
    this.matchKey = null;
    this.createdAt = now;
    this.disposed = false;
    /**
     * Whether this room appears in the title screen's public list (`/lobby.json`). Default on — a room is created to
     * be found — and the host can hide it with `room.setListed`. Hiding does NOT make the room unjoinable: a player
     * who has the 4-character 同盟密钥 can still join; it only keeps the room out of the listing.
     */
    this.listed = true;
    /**
     * How many of `seats` a HUMAN may take, counting from seat 0. The rest are AI-only until the host unlocks the
     * room (see `unlock`). The 100-seat build is a test bench: 40 real players is what a public room can actually
     * fill and keep readable (and the snapshot's O(N²) fan-out is what made 91 seats pin the latency counter), while
     * the remaining 60 seats stay available to AI teammates so a solo player can still fill a big board.
     *
     * `MAX_SEATS` still sizes the array — nothing above this cap exists until it is raised.
     */
    this.humanCap = HUMAN_CAP;
    /** @type {boolean} set once the host has entered the unlock code (raises `humanCap` to MAX_SEATS) */
    this.unlocked = false;
  }

  /** @param {string} playerId @returns {Seat | null} */
  seatOf(playerId) {
    for (const s of this.seats) if (s && s.playerId === playerId) return s;
    return null;
  }

  /** @param {string} playerId @returns {{ playerId: string, name: string, connected: boolean } | null} */
  spectatorOf(playerId) { return this.spectators.find((s) => s.playerId === playerId) || null; }

  /**
   * Lowest free seat a HUMAN may take, or -1. Bounded by `humanCap`: past it the seats exist but are AI-only until
   * the host unlocks the room, which is what keeps a public room at 40 real players.
   */
  freeSeat() {
    const top = Math.min(this.seats.length, this.humanCap);
    for (let i = 0; i < top; i++) if (this.seats[i] === null) return i;
    return -1;
  }

  /**
   * Lowest free seat an AI may take, or -1. Unlike `freeSeat` this runs the whole array, so the seats above
   * `humanCap` stay usable by bots — the point of capping humans rather than shrinking the room.
   */
  freeBotSeat() {
    // fill upward from just past the human cap, so the extra seats read as one block instead of leaving holes
    for (let i = this.humanCap; i < this.seats.length; i++) if (this.seats[i] === null) return i;
    // above the cap is full: fall back to any free seat below it (only reachable when the host unlocked past it)
    return this.seats.indexOf(null);
  }

  /** Humans that have not departed, in seat order. @returns {Seat[]} */
  activeHumans() { return this.seats.filter((s) => s && !s.isBot && !s.left); }

  /**
   * AI teammates seated in THIS room — the count the busy-server cap is applied to (BOT_FILL_MAX_BOTS, see
   * `Lobby.addBot`), and the one the client mirrors for its 「添加 AI 队友」 hint.
   *
   * A seat is an AI seat only when `isBot` (set by `addBot`). A human seat played by the server under AI 托管
   * (`g.autoplay`) keeps `isBot: false` — 托管 is a match-side flag on the player (PlayerState.autoplay), it never
   * turns a human seat into a bot seat — so a 托管'd 博士 does NOT consume the room's AI budget, which is what a
   * player means by 「填入 AI」. A departed AI seat is not reachable (removeBot nulls the seat), but `!s.left` is
   * kept for symmetry with `activeHumans`.
   * @returns {number}
   */
  botCount() { return this.seats.filter((s) => s && s.isBot && !s.left).length; }

  /**
   * ★ 2026-10-18 深夜（owner）：「单房 AI 上限 = 客户端可承载的上限」。
   *   单人房：房主浏览器最多代跑 CLIENT_BOTS_SOLO_MAX 个 → 房间最多这么多 AI；
   *   多真人房：真人 × CLIENT_BOTS_PER_PERSON（每人一台机器分摊）。
   *   这样房间里每个 AI 都有人真在算，服务端不再替它们跑战斗。
   * @returns {number}
   */
  botCapForRoom() {
    // ★ 2026-10-19：一刀切 —— 每房最多 BOT_ROOM_CAP（4）个 AI。
    //   原来的「单人 12 / 每人 3」在服务端压力上还是太乐观（一个 2 人房 6 个 AI 就能顶出 400ms 停顿）。
    return BOT_ROOM_CAP;
  }

  /** 服务器承载保护: while the whole server seats fewer than `botFillMaxHumans` humans a room's AI may take every
   *  free bot seat (including the AI-only ones above `humanCap`); at or above that count the server is busy and the
   *  room may hold at most `botFillMaxBots` AI. `botFillOpen` is that quiet/busy switch (never the AI gate itself),
   *  and the client pairs it with its own room's `botCount` to grey out 「添加 AI 队友」 only once the cap is reached
   *  and say why; an unlocked room reports open (the server skips both rules there). No server-wide count is sent on
   *  room broadcasts — that would walk every room on every frame — so the client falls back to the last count the
   *  caller supplied and only needs to be roughly right for the hint text; the SERVER's `addBot` is the gate.
   */
  toState(opts = {}) {
    return {
      t: 'room.state',
      code: this.code,
      hostId: this.hostId,
      mode: this.mode,
      difficulty: this.difficulty,
      aiPicksLast: this.aiPicksLast,
      inMatch: !!this.match,
      // whether the room is in the title screen's public list (host toggle, `room.setListed`)
      listed: this.listed,
      // how many seats a human may take right now, and whether the host has already unlocked the rest
      // (`room.unlock`): the client shows 「真人 N/40」 plus the 解锁 toggle off these two.
      humanCap: this.humanCap,
      maxSeats: this.seats.length,
      unlocked: this.unlocked,
      // 服务器承载保护: the busy-server AI cap (BOT_FILL_MAX_BOTS per room) and the quiet/busy switch. An unlocked
      // room is always open (the server skips both rules there). Without a count (the ordinary broadcast path — see
      // above) the client assumes open and lets the server refuse.
      botFillMaxHumans: BOT_FILL_MAX_HUMANS,
      botFillMaxBots: this.botCapForRoom(),   // ★ 动态：客户端可承载上限（单人 12 / 多真人 x3）
      botFillOpen: this.unlocked || !Number.isFinite(opts?.seatedHumans) ? true : opts.seatedHumans < BOT_FILL_MAX_HUMANS,
      /** server-wide seated humans, or null when the caller did not supply a count */
      seatedHumans: Number.isFinite(opts?.seatedHumans) ? opts.seatedHumans : null,
      seats: this.seats.map((s) => (s
        ? { seat: s.seat, playerId: s.playerId, name: s.name, avatar: s.avatar ?? null, isBot: s.isBot, ready: s.ready, connected: s.connected && !s.left,
            // 外援测试模式 (room.testMode): only the viewer's own row is read by the client, but the payload is shared, so
            // both flags travel per seat — two booleans next to a name cost nothing and keep it debuggable.
            testUnlocked: !!s.testUnlocked, testMode: !!s.testMode }
        : null)),
      spectators: this.spectators.map((s) => ({ playerId: s.playerId, name: s.name, avatar: s.avatar ?? null, connected: s.connected })),
    };
  }
}

/** Room registry + lobby message handlers. Pass an instance as the `handler` of net.js Network. */
export class Lobby {
  /**
   * @param {{
   *   registry: import('./net.js').SessionRegistry,
   *   log?: { info: Function, warn: Function, error: Function, debug?: Function },
   *   MatchClass?: new (opts: object) => any,
   *   getData?: () => object,
   *   now?: () => number,
   *   seedFn?: () => number,
   *   options?: Partial<typeof LOBBY_DEFAULTS>,
   * }} opts
   */
  constructor({ registry, log = noopLog, MatchClass = DefaultMatch, getData = defaultGetData, now = Date.now, seedFn, options = {} }) {
    this.registry = registry;
    this.log = log;
    this.MatchClass = MatchClass;
    this.getData = getData;
    this.now = now;
    this.seedFn = seedFn || (() => randomInt(2 ** 32));
    this.opts = { ...LOBBY_DEFAULTS, ...options };
    // 每帧只压一次（用户 2026-10-13）：同一参数组共享压缩字节。默认开，`SP_WS_SHARED_DEFLATE=off` 关掉。
    // 有一次性自检兜底：与 ws 自己的输出逐字节不一致就自动停用（见 server/wsSharedDeflate.js）。
    const sharedOff = String(process.env.SP_WS_SHARED_DEFLATE || '').toLowerCase() === 'off';
    this.sharedDeflate = sharedOff ? null : createSharedDeflate(resolveWsCompression(process.env.SP_WS_COMPRESSION || 'on'));
    /**
     * 广播账本（用户 2026-10-13）：累计帧数 / 收件人数 / 压前字节 / 上网字节（压缩后）。
     * `/healthz` 的 `broadcast` 字段直接暴露它；两次采样相减即可知道"这段时间广播发了多少"。
     * 每次广播只加几个整数，热路径上可忽略。`state*` 是房间列表（room.state，不压缩），`match*` 是对局帧。
     */
    this.bcast = {
      matchFrames: 0, matchRecipients: 0, matchBytes: 0, matchWireBytes: 0,
      stateFrames: 0, stateRecipients: 0, stateBytes: 0,
      sharedCompressed: 0, sharedFallback: 0,
    };
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    /**
     * The outstanding 全服公告 (announce): `{ text, level, ttlSec, at }`, or null. Kept so a session that connects
     * after the broadcast still receives it (welcomeInfo → welcome.notice), which is the whole point of warning the
     * room before a shutdown. Not persisted — it dies with the process, exactly like the rooms.
     * @type {{ text: string, level: string, ttlSec: number, at: number } | null}
     */
    this.notice = null;
    /** @type {Map<string, NodeJS.Timeout>} lobby grace timers by playerId */
    this.graceTimers = new Map();
    /** @type {Map<string, NodeJS.Timeout>} deferred (coalesced) resyncs by playerId */
    this.resyncTimers = new Map();
    /** @type {Set<any>} rooms whose room.state is dirty and waiting for the coalescing window */
    this.stateDirty = new Set();
    /** @type {NodeJS.Timeout | null} the single coalescing timer for stateDirty */
    this.stateTimer = null;
    /** @type {NodeJS.Timeout | null} 60 s housekeeping (replay TTL); unref'd, cleared in shutdown() */
    this.houseTimer = null;
    this.startHousekeeping();
    /** per-network limit warnings: at most one log line per 10 s (the rest are counted) */
    this.limitLog = { at: -Infinity, suppressed: 0 };
  }

  /** @param {string} code @returns {Room | null} */
  getRoom(code) { return this.rooms.get(String(code).toUpperCase()) || null; }

  /**
   * Public snapshot of one room, safe to hand to anyone on the title screen.
   *
   * Deliberately narrow: the 同盟密钥 (`code`), mode, difficulty, how full it is and whether a match is already running.
   * It does NOT carry player ids, names, tokens or the seat layout — the title screen has no session, so nothing that
   * identifies a player may travel here. `ageSec` is computed server-side because a pre-`hello` client has no server
   * clock offset yet, so it cannot turn `createdAt` into a meaningful "how long ago" by itself.
   * @param {Room} r
   */
  listing(r) {
    let occupied = 0;
    let humans = 0;
    for (const s of r.seats) if (s && !s.left) { occupied++; if (!s.isBot) humans++; }
    return {
      code: r.code,
      mode: r.mode,
      difficulty: r.difficulty,
      occupied,
      humans,
      // `capacity` is what the title screen compares against to decide 「满员」: the HUMAN cap, not the seat array,
      // so a room with 40 humans + 60 AI reads as full instead of showing 100 slots nobody can take.
      capacity: r.humanCap,
      maxSeats: r.seats.length,
      unlocked: r.unlocked,
      spectators: r.spectators.length,
      inMatch: !!r.match,
      ageSec: Math.max(0, Math.round((this.now() - r.createdAt) / 1000)),
    };
  }

  /**
   * The room list for the title screen: every room whose host has not hidden it, fullest first (a room with people in
   * it is more useful to see than an empty one), then oldest first so the order does not jump around as rooms age.
   */
  publicRooms() {
    const out = [];
    for (const r of this.rooms.values()) {
      if (r.disposed || !r.listed) continue;
      if (!r.activeHumans().length) continue;          // an abandoned room is noise
      out.push(this.listing(r));
    }
    out.sort((a, b) => (b.humans - a.humans) || (b.occupied - a.occupied) || (b.ageSec - a.ageSec));
    return out;
  }

  /** Counters for /healthz. */
  stats() {
    let matches = 0;
    let humans = 0;
    let bots = 0;
    let spectators = 0;
    for (const r of this.rooms.values()) {
      if (r.match) matches++;
      for (const s of r.seats) if (s && !s.left) (s.isBot ? bots++ : humans++);
      spectators += r.spectators.length;
    }
    return { rooms: this.rooms.size, matches, humans, bots, spectators };
  }

  /**
   * Seated humans across the whole server, i.e. the 服务器承载保护 load number: `>= BOT_FILL_MAX_HUMANS` means busy,
   * which caps each room's AI at BOT_FILL_MAX_BOTS (see `addBot`).
   * Computed on demand and NOT memoised: it is read by `addBot` (a rare click) and by `sendState` (a room entry), so
   * the walk is affordable, and a cache would hand the gate a stale count right after seats changed.
   * @returns {number}
   */
  seatedHumans() {
    return this.stats().humans;
  }

  // ---------------------------------------------------------------------------------------------------
  // net.js handler interface
  // ---------------------------------------------------------------------------------------------------

  /**
   * After `welcome`: resend room state / match state for resumed (or repeated) hellos.
   * @param {import('./net.js').Session} session
   * @param {{ resumed: boolean, repeat: boolean }} info
   */
  onHello(session, { resumed, repeat }) {
    if (!resumed && !repeat) return;
    const room = this.roomOf(session);
    if (!room) {
      if (session.notice) {
        sendSession(session, { t: 'room.closed', reason: session.notice });
        session.notice = null;
      }
      if (session.pendingResult) {
        // Already-encoded m.public / m.result frames, both in the compression whitelist (server/wsCompression.js).
        for (const frame of session.pendingResult) if (frame) sendRaw(session.ws, frame, { compress: true });
        session.pendingResult = null;
      }
      return;
    }
    session.notice = null;
    session.pendingResult = null;
    // a player seat, or a spectator seat (header): both carry `connected` / `name`
    const seat = room.seatOf(session.playerId) || room.spectatorOf(session.playerId);
    if (process.env.SP_DBG_WS) console.log(`[dbg] hello ${session.playerId} 名字=${session.name} 座位=${seat ? (seat.isBot ? 'bot' : 'human') : '无'} seat.connected=${seat ? seat.connected : '-'} session.roomCode=${session.roomCode} room=${room.code}`);
    this.clearGrace(session.playerId);
    // Only a visible change (reconnect, rename, new host) is broadcast; a plain resync (repeated hello on a
    // live socket) answers the requester alone, so hello spam cannot amplify into room-wide traffic.
    let changed = !seat.connected;
    seat.connected = true;
    if (!room.match && seat.name !== session.name) { seat.name = session.name; changed = true; }
    // 头像 (shared/avatars.js): 局外改头像后重发的 hello 也要落到席位上（房间已开局的就不动了）
    // 头像 (shared/avatars.js)：局外改头像后重发的 hello 要落到席位上 —— **开局之后也要**（用户 2026-10-13：
    // 先开局再换头像，房间座位/队伍面板/确认本局信息一直显示字母）。原来带 !room.match 条件，开局后就不动了；
    // 而且对局里的 ps.avatar 是开局时从席位快照的旧值，所以这里把含正在跑的对局也一起改掉。
    const av = session.avatar ?? null;
    if (seat.avatar !== av) {
      seat.avatar = av;
      changed = true;
      const _m = room.match;
      const _ps = _m && _m.players && typeof _m.players.get === 'function' ? _m.players.get(session.playerId) : null;
      if (_ps && _ps.avatar !== av) {
        _ps.avatar = av;
        try { if (typeof _ps.dirty === 'function') _ps.dirty(); } catch { /* 视图刷新失败不影响席位 */ }
        try { if (_m.markPrivate) _m.markPrivate(_ps); } catch { /* 同上 */ }
      }
    }
    // 对局内同步（独立于席位是否变化；用户 2026-10-13）：席位早就对了、对局里 ps.avatar 还是开局快照的旧值时，
    // 上面那段（挂在 seat.avatar !== av 条件下）不会执行，于是策略界面/队伍面板/确认本局信息一直显示字母。
    {
      const _m2 = room.match;
      const _ps2 = _m2 && _m2.players && typeof _m2.players.get === 'function' ? _m2.players.get(session.playerId) : null;
      if (_ps2 && _ps2.avatar !== av) {
        _ps2.avatar = av;
        changed = true;
        try { if (typeof _ps2.dirty === 'function') _ps2.dirty(); } catch { /* 视图刷新失败不影响席位 */ }
        try { if (_m2.markPrivate) _m2.markPrivate(_ps2); } catch { /* 同上 */ }
      }
    }    if (!room.hostId) { this.migrateHost(room); changed = true; }
    if (changed) this.broadcastState(room);
    else this.sendState(room, session);
    this.resync(session, !resumed);
  }

  /**
   * Validated client message from an identified session.
   * @param {import('./net.js').Session} session
   * @param {any} msg
   * @returns {{ ok: true } | { error: string, detail?: string }}
   */
  onMessage(session, msg) {
    switch (msg.t) {
      case 'room.create': return this.create(session, msg);
      case 'room.join': return this.join(session, msg);
      case 'room.leave': return this.leave(session);
      case 'room.ready': return this.ready(session, msg);
      case 'room.setDifficulty': return this.setDifficulty(session, msg);
      case 'room.setAiPicksLast': return this.setAiPicksLast(session, msg);
      case 'room.setListed': return this.setListed(session, msg);
      case 'room.unlock': return this.unlock(session, msg);
      case 'room.testMode': return this.testMode(session, msg);
      case 'room.addBot': return this.addBot(session, msg);
      case 'room.removeBot': return this.removeBot(session, msg);
      case 'room.kick': return this.kick(session, msg);
      case 'room.kickUnready': return this.kickUnready(session);
      case 'room.start': return this.start(session);
      case 'room.loadout': return this.loadout(session, msg);
      case 'room.ownership': return this.ownership(session, msg);
      case 'room.diy': return this.diy(session, msg);
      case 'room.skins': return this.skins(session, msg);
      case 'room.spectate': return this.spectate(session, msg);
      case 'room.removeSpectator': return this.removeSpectator(session, msg);
      default:
        if (typeof msg.t === 'string' && msg.t.startsWith('g.')) return this.routeGame(session, msg);
        return fail(ERR.BAD_MSG, `unhandled type ${String(msg.t).slice(0, 32)}`);
    }
  }

  /** The session's socket closed. @param {import('./net.js').Session} session */
  onDisconnect(session) {
    this.clearResync(session.playerId); // the next resume resyncs immediately
    const room = this.roomOf(session);
    // a solo run may be resumed within singleReconnectTime (24 h); everything else keeps the registry's window
    session.resumeWindowMs = room && room.match && room.mode === 'solo' ? this.soloResumeWindowMs() : null;
    if (!room) return;
    const player = room.seatOf(session.playerId);
    const seat = player || room.spectatorOf(session.playerId);
    seat.connected = false;
    // a spectator's seat is kept like a player's (nothing to tell the match: it plays no field)
    if (room.match) { if (player) this.callMatch(room, 'onDisconnect', session.playerId); } else this.startGrace(room, seat);
    this.broadcastState(room);
  }

  /** The session's reconnect window elapsed (already removed from the registry). */
  onExpire(session) {
    session.notice = null;
    session.pendingResult = null;
    this.clearResync(session.playerId);
    const code = session.roomCode;
    session.roomCode = null;
    const room = code ? this.rooms.get(code) : null;
    if (room) this.removeMember(room, session.playerId);
  }

  /**
   * Dispose every room (notifying members with room.closed) — used on server shutdown.
   * @param {string} [reason]
   */
  shutdown(reason = 'shutdown') {
    for (const room of [...this.rooms.values()]) this.disposeRoom(room, reason);
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    for (const t of this.resyncTimers.values()) clearTimeout(t);
    this.resyncTimers.clear();
    if (this.stateTimer) { clearTimeout(this.stateTimer); this.stateTimer = null; }
    this.stateDirty.clear();
    if (this.houseTimer) { clearInterval(this.houseTimer); this.houseTimer = null; }
  }

  /** 每 60 秒一次的房间保养（回放 TTL + 公告到期撤下）；unref，别拖住进程退出。 */
  startHousekeeping() {
    if (this.houseTimer) return;
    const t = setInterval(() => {
      try { this.sweepReplays(); this.sweepNotice(); } catch (e) { this.log.warn('[lobby] housekeeping failed', e); }
    }, REPLAY_SWEEP_MS);
    t.unref?.();
    this.houseTimer = t;
  }

  /** 丢掉太久没人动的房间回放（`room.replay`）：它持有上一局的整份 m.public 与每人 m.result。 */
  sweepReplays() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const r = room.replay;
      if (r && Number.isFinite(r.at) && now - r.at > REPLAY_TTL_MS) room.replay = null;
    }
  }

  /**
   * 公告**到期自动撤下**（用户 2026-10-12）。`ttlSec` 原来只是"显示提示"，而这个 build 的客户端并没有按它
   * 自动隐藏（全项目只找到把它写进 store 的 3 处，没有消费它的地方）⇒ 过了 ttl，横幅仍留在屏幕上直到玩家手动关。
   * 这里把 ttl 变成**真实过期**：到期就广播一次空文本（客户端 `main.js` 的 sys.notice 处理器收到空文本会把
   * `ui.notice` 置空 ⇒ 横幅消失），并把服务端的 `this.notice` 清掉，后连的客户端也不会再看到它。
   *
   * `ttlSec = 0`（含缺省）语义**不变**：一直挂着，直到操作员手动撤下 —— 这正是"全服公告"原来的行为。
   * @returns {boolean} 这次是否撤下了一条公告
   */
  sweepNotice() {
    const n = this.notice;
    if (!n || !(n.ttlSec > 0)) return false;
    if (this.now() - n.at <= n.ttlSec * 1000) return false;
    this.log.info(`[lobby] 公告到期自动撤下（ttl ${n.ttlSec}s）：${String(n.text).slice(0, 40)}`);
    this.announce({ clear: true });     // 广播空文本 + 清 this.notice + 记日志
    return true;
  }

  // ---------------------------------------------------------------------------------------------------
  // room.* handlers
  // ---------------------------------------------------------------------------------------------------

  create(session, { mode, difficulty, cap, test } = {}) {
    // ── 维护闸（临时）: SP_NO_ROOM=1 时拒绝创建房间，其余功能不受影响 ──
    {
      const lock = String(process.env.SP_NO_ROOM ?? '').trim().toLowerCase();
      if (lock === '1' || lock === 'true' || lock === 'on' || lock === 'yes') {
        this.log.info(`[lobby] create refused (maintenance) by ${session.name}`);
        return fail(ERR.INTERNAL, '房间创建已暂时关闭（服务器维护中）');
      }
    }
    const cur = this.roomOf(session);
    if (cur && cur.match) return fail(ERR.ROOM_STARTED, 'leave your running match first');
    if (this.rooms.size >= this.opts.maxRooms) return fail(ERR.INTERNAL, 'too many rooms');
    const key = session.limitKey || null;
    if (key && this.opts.maxRoomsPerAddr > 0) {
      // The room being left disappears with this create when the creator is its only human (a spectator is none).
      const leaving = cur && cur.ownerKey === key && cur.activeHumans().length === 1 && !cur.spectatorOf(session.playerId) ? 1 : 0;
      if (this.countRooms((r) => r.ownerKey === key) - leaving >= this.opts.maxRoomsPerAddr) {
        this.limitWarn(`room limit (${this.opts.maxRoomsPerAddr}) reached for ${session.addr}`);
        return fail(ERR.RATE, 'too many rooms from your network');
      }
    }
    const code = this.genCode();
    if (!code) return fail(ERR.INTERNAL, 'no room code available');
    if (cur) this.removeMember(cur, session.playerId);
    const room = new Room(code, mode, difficulty, this.now());
    // 用户 2026-10-13：创建同盟时的三档真人上限（4 / 8 / 40）。白名单在 shared/constants.js ROOM_HUMAN_CAPS，
    // protocol 的 room.create.cap 已经先校验过；solo 房间只有一个座位，这里不改。100 仍走创建者的解锁码。
    if (mode !== 'solo' && ROOM_HUMAN_CAPS.includes(cap)) room.humanCap = cap;
    // 2026-10-13 用户需求：炸惊模式的真人上限为 12（选了 4/8 档仍按 4/8 ✓，选 40 档只到 12 ✓）
    const ZHAJING_CAP = 12;
    if (String(room.difficulty || '').toUpperCase() === 'ZHAJING' || /zhajing/i.test(String(room.modeId || mode || ''))) {
      room.humanCap = Math.min(room.humanCap, ZHAJING_CAP);
    }
    room.ownerKey = key;
    room.seats[0] = this.humanSeat(0, session);
    room.hostId = session.playerId;
    this.rooms.set(code, room);
    session.roomCode = code;
    session.notice = null;
    session.pendingResult = null;
    if (test === true) {
      session.testUnlocked = true;
      session.testMode = true;
      const own = room.seats.find((s) => s && s.playerId === session.playerId);
      if (own) { own.testUnlocked = true; own.testMode = true; }
      this.log.info(`[lobby] ${code} 测试模式随房创建开启（${session.name}）`);
    }
    this.log.info(`[lobby] ${code} created (${mode}/${difficulty}) by ${session.name}`);
    this.broadcastState(room);
    return OK;
  }

  join(session, { code }) {
    const norm = String(code).trim().toUpperCase();
    const room = norm.length === ROOM_CODE_LEN ? this.rooms.get(norm) : undefined;
    if (!room) return fail(ERR.ROOM_NOT_FOUND);
    const cur = this.roomOf(session);
    // idempotent for members; a spectator of this room goes on below: it may take a free player seat (header)
    if (cur === room && !room.spectatorOf(session.playerId)) { this.sendState(room, session); return OK; }
    if (cur && cur.match) return fail(ERR.ROOM_STARTED, 'leave your running match first');
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.mode === 'solo') return fail(ERR.ROOM_FULL, 'solo room');
    const idx = room.freeSeat();
    if (idx < 0) return fail(ERR.ROOM_FULL);
    if (cur) this.removeMember(cur, session.playerId);
    room.seats[idx] = this.humanSeat(idx, session);
    session.roomCode = room.code;
    session.notice = null;
    session.pendingResult = null;
    if (!room.hostId) room.hostId = session.playerId;
    this.broadcastState(room);
    return OK;
  }

  leave(session) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    this.removeMember(room, session.playerId);
    return OK;
  }

  /**
   * room.spectate: one of a co-op room's MAX_SPECTATORS spectator seats, in its lobby or during its match (header). In a
   * running match the match registers the spectator and resends what it may see (Match.addSpectator).
   */
  spectate(session, { code }) {
    const norm = String(code).trim().toUpperCase();
    const room = norm.length === ROOM_CODE_LEN ? this.rooms.get(norm) : undefined;
    if (!room) return fail(ERR.ROOM_NOT_FOUND);
    const cur = this.roomOf(session);
    if (cur === room) {
      if (!room.spectatorOf(session.playerId)) return fail(ERR.ALREADY, 'seated as a player');
      this.sendState(room, session);
      return OK;
    }
    if (cur && cur.match) return fail(ERR.ROOM_STARTED, 'leave your running match first');
    if (room.mode === 'solo') return fail(ERR.ROOM_FULL, 'solo room');
    if (room.spectators.length >= MAX_SPECTATORS) return fail(ERR.ROOM_FULL, 'no free spectator seat');
    if (cur) this.removeMember(cur, session.playerId);
    room.spectators.push({ playerId: session.playerId, name: session.name, avatar: session.avatar ?? null, connected: session.connected });
    session.roomCode = room.code;
    session.notice = null;
    session.pendingResult = null;
    this.broadcastState(room);
    if (room.match) this.callMatch(room, 'addSpectator', session.playerId);
    return OK;
  }

  /** room.removeSpectator (host, any time): the spectator gets room.closed {kicked} and its seat is freed. */
  removeSpectator(session, { playerId }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (!room.spectatorOf(playerId)) return fail(ERR.BAD_TARGET, 'not a spectator of this room');
    const target = this.registry.byId(playerId);
    const wasHere = !!target && target.roomCode === room.code;
    const replay = this.replayFor(room, playerId);
    this.removeMember(room, playerId);
    if (wasHere) {
      // like room.kick: now, or on the next resume (with the result replay, as after the grace timeout)
      if (target.connected) sendSession(target, { t: 'room.closed', reason: 'kicked' });
      else { target.notice = 'kicked'; target.pendingResult = replay; }
    }
    return OK;
  }

  ready(session, { ready }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    const seat = room.seatOf(session.playerId);
    if (seat.ready !== ready) {
      seat.ready = ready;
      this.broadcastState(room);
    }
    return OK;
  }

  setDifficulty(session, { difficulty }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    if (room.difficulty !== difficulty) {
      room.difficulty = difficulty;
      for (const s of room.seats) if (s && !s.isBot && s.playerId !== room.hostId) s.ready = false;
      this.broadcastState(room);
    }
    return OK;
  }

  /**
   * Host-only: hide or show this room in the title screen's public list. Hiding does not close the room or change its
   * 同盟密钥 — someone the host gave the code to can still join. The running match is unaffected.
   */
  /** 「AI 队友最后选择」 (GitHub #338): host-only, before the match, co-op rooms only (a solo room has no AI seat). */
  setAiPicksLast(session, { on }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.mode === 'solo') return fail(ERR.BAD_TARGET, 'solo rooms have no AI teammates');
    this.dropReplay(room, session.playerId);
    if (room.aiPicksLast !== on) {
      room.aiPicksLast = on;
      for (const s of room.seats) if (s && !s.isBot && s.playerId !== room.hostId) s.ready = false;
      this.broadcastState(room);
    }
    return OK;
  }

  setListed(session, { listed }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    const next = !!listed;
    if (room.listed !== next) {
      room.listed = next;
      this.broadcastState(room);
    }
    return OK;
  }

  /**
   * Raise this room from `HUMAN_CAP` to the full 100 human seats (`room.unlock`, host only).
   *
   * The code is checked HERE, never on the client: sending it up and comparing it in the browser would put it in the
   * bundle for anyone to read, which defeats the point of gating a public room. A wrong code costs nothing but the
   * round trip.
   *
   * Solvers keep their seats: this only moves the line a human may sit below, so the AI that already occupy seats
   * above 40 stay where they are (the host can remove them if the room is about to fill).
   *
   * @returns {{ ok: true } | { error: string, detail?: string }}
   */
  unlock(session, { code } = {}) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    if (room.unlocked) return OK;   // idempotent: a second unlock is not an error
    if (normCode(code) !== normCode(UNLOCK_CODE)) return fail(ERR.BAD_MSG, 'unlock code rejected');
    room.unlocked = true;
    room.humanCap = room.seats.length;
    // 2026-10-13 炸惊房即使解锁也最多 12 名真人（用户需求 ✓）
    if (/zhajing/i.test(String(room.difficulty || room.modeId || ''))) room.humanCap = Math.min(room.humanCap, 12);
    this.log.info(`[lobby] room ${room.code} unlocked to ${room.humanCap} human seats`);
    this.broadcastState(room);
    return OK;
  }

  /**
   * 外援测试模式 (room.testMode, per PLAYER — not host-only): the local cheat switch (资金不减 + 商店只刷自选编队的外援),
   * moved out of the `SP_CHEAT` env var and into 设置 so it can be flipped mid-session.
   *
   * The same server-verified unlock code as the room cap gates it: the code is checked HERE and never ships in the
   * bundle. Once a SESSION has accepted the code, later flips may omit it — so the settings toggle needs no stored
   * secret on the client. The flag lives on the session and on the player's own seat (like `room.skins`), so a match
   * created later inherits it (`lobby.start` packs the seat) and a match already running is updated in place.
   *
   * @returns {{ ok: true } | { error: string, detail?: string }}
   */
  testMode(session, { code, on } = {}) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (!session.testUnlocked) {
      if (normCode(code) !== normCode(UNLOCK_CODE)) return fail(ERR.BAD_MSG, 'unlock code rejected');
      session.testUnlocked = true;
    }
    session.testMode = on === true;
    const seat = room.seats.find((s) => s && s.playerId === session.playerId);
    if (seat) { seat.testUnlocked = true; seat.testMode = session.testMode; }
    // a match already running: apply it to this player at once (the audit knows about the flag, so its 花钱 = 资金减少
    // invariants step aside for exactly this player — see server/match/audit.js)
    const ps = room.match && room.match.players ? room.match.players.get(session.playerId) : null;
    if (ps) {
      ps.testMode = session.testMode;
      try { ps.dirty(); } catch { /* the match may be mid-teardown; the flag still lands for the next one */ }
    }
    this.log.info(`[lobby] ${session.playerId} 外援测试模式 ${session.testMode ? 'ON' : 'OFF'}`);
    this.broadcastState(room);
    return OK;
  }

  addBot(session, msg = {}) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    // 100-seat build: a room needs 100 seats filled and the host cannot click 99 times before every round of testing, so
    // any seated human may add an AI (kicking / removing stays host-only). Upstream: host only.
    if (room.hostId !== session.playerId && !room.seatOf(session.playerId)) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    if (room.mode === 'solo') return fail(ERR.ROOM_FULL, 'solo rooms cannot have AI teammates');
    // `freeBotSeat`, not `freeSeat`: an AI may use the seats above `humanCap` that a human cannot, and it prefers
    // them so adding teammates never boxes out a real player who could still join.
    // 2026-10-13 用户需求「指哪填哪」：请求里带了 seat 且该座位为空就用它，否则仍按 freeBotSeat()（不要
    // 一律从 humanCap 之上的第 41 位开始填）。
    const want = Number(msg && msg.seat);
    const picked = Number.isInteger(want) && want >= 0 && want < room.seats.length && room.seats[want] === null ? want : -1;
    const idx = picked >= 0 ? picked : room.freeBotSeat();
    if (idx < 0) return fail(ERR.ROOM_FULL);
    // 服务器承载保护 (BOT_FILL_MAX_HUMANS / BOT_FILL_MAX_BOTS): while the whole server seats fewer than
    // BOT_FILL_MAX_HUMANS humans the AI seats are handed out freely — the quiet rule, and the 100-seat path above is
    // untouched by it (no AI count at all). At or above that count the server counts as busy: AI is NOT refused
    // outright, but the room may hold at most BOT_FILL_MAX_BOTS of them, whichever seat they would take (below
    // `humanCap` included). A room the host 解锁了 skips the cap (room.unlock is the operator's own decision).
    // 服务器承载保护（2026-10-15 用户）：全服 AI 总数上限 MAX_SERVER_BOTS —— 一直生效，
    // 不看在线真人、也不看是否解锁：它就是这台机器的容量上限。
    // 计数复用现成的 stats().bots（本来只给 /healthz 显示用）；这是一次点击级的调用，不必缓存。
    const serverBots = this.stats().bots;
    if (serverBots >= MAX_SERVER_BOTS) {
      return fail(ERR.SERVER_BOT_LIMIT,
        `server already holds ${serverBots} AI (limit ${MAX_SERVER_BOTS}); `
        + `remove some AI teammates or wait for a room to free up`);
    }
    // ★ 2026-10-18 深夜：单房上限 = 客户端可承载上限（一直生效，不再区分忙/闲）。
    //   解锁房间仍然跳过（房主自己的决定，出问题也是他那台机器扛）。
    if (!room.unlocked) {
      const bots = room.botCount();
      const cap = room.botCapForRoom();
      if (bots >= cap) {
        return fail(ERR.ROOM_BOT_LIMIT,
          `room already holds ${bots} AI (limit ${cap} = client capacity: `
          + `${cap === CLIENT_BOTS_SOLO_MAX ? 'single human' : 'humans x ' + CLIENT_BOTS_PER_PERSON})`);
      }
    }
    const used = new Set(room.seats.filter((s) => s && s.isBot).map((s) => s.name));
    // a RANDOM operator name (bot.js randomBotName) rather than the six fixed labels: a 100-seat room may add far
    // more bots than six, and every seat past the sixth used to fall through to a bare number. No `AI` prefix on the
    // name — all four screens that list a bot already mark it (`seat__bot-label`, `dorder__ai`, `rcard__ai`,
    // `team__ai`), so a name carrying its own prefix read as "AI·AI·芬" on three of them.
    // `lastSlot` fills this seat and leaves none free — that bot is always 海猫络合物
    const lastSlot = room.seats.filter((s) => s && !s.left).length + 1 >= room.seats.length;
    const name = randomBotName(this.safeData(), Math.random, used, { lastSlot }) || `队友 ${idx + 1}`;
    let playerId;
    do playerId = 'ai_' + randomBytes(4).toString('hex'); while (room.seatOf(playerId));
    room.seats[idx] = { seat: idx, playerId, name, isBot: true, ready: true, connected: true, left: false };
    this.broadcastState(room);
    return OK;
  }

  removeBot(session, { seat }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    const target = room.seats[seat];
    if (!target || !target.isBot) return fail(ERR.BAD_TARGET, 'seat does not hold an AI');
    room.seats[seat] = null;
    this.broadcastState(room);
    return OK;
  }

  /** Host removes another human before the match (header: room.kick). */
  kick(session, { seat, playerId }) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    const target = room.seats[seat];
    if (!target || target.left) return fail(ERR.BAD_TARGET, 'seat holds no player');
    if (target.playerId !== playerId) return fail(ERR.BAD_TARGET, 'seat changed hands'); // the confirmed player left meanwhile
    if (target.isBot) return fail(ERR.BAD_TARGET, 'seat holds an AI (room.removeBot)');
    if (target.playerId === session.playerId) return fail(ERR.BAD_TARGET, 'cannot kick yourself');
    this.kickSeatNow(room, target);
    return OK;
  }

  /**
   * Host removes EVERY seated human who has not readied yet, before the match (header: room.kickUnready) — the
   * one-click 「踢出所有未准备玩家」. One message, not a client-side loop over room.kick: every removal frees a seat and
   * `room.state` (and with it the seat indexes) is re-broadcast, so a loop would be aiming at a moved target.
   *
   * Targets are seated humans only (never an AI seat — that stays room.removeBot's), never the host (the host does not
   * ready, so "unready host" is the normal state and not a kick reason) and never a spectator (spectators hold no seat).
   * `ready` is the seat flag room.ready sets; an offline player keeps it on their seat, so a disconnected player who had
   * readied is left alone.
   *
   * Finding nothing is NOT an error: the call succeeds with nobody removed, and the screen says 没有未准备的博士.
   */
  kickUnready(session) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    this.dropReplay(room, session.playerId);
    const targets = room.activeHumans().filter((s) => !s.ready && s.playerId !== room.hostId);
    for (const target of targets) this.kickSeatNow(room, target);
    return OK;
  }

  /**
   * Free one human's seat and tell them (the shared tail of room.kick and room.kickUnready; the seat has already been
   * validated as a seated human that is not the host).
   * The seat is freed at once and the player gets `room.closed {reason:'kicked'}` — now, or on the next resume when
   * offline (with the result replay, as the grace timeout) —, so the reconnect token no longer leads back to the seat
   * (it stays the player's identity: net.js sessions belong to players, not seats).
   * @param {Room} room
   * @param {Seat} target the seat object still in room.seats
   */
  kickSeatNow(room, target) {
    const kicked = this.registry.byId(target.playerId);
    const wasHere = !!kicked && kicked.roomCode === room.code;
    const replay = this.replayFor(room, target.playerId);
    this.removeMember(room, target.playerId);
    if (wasHere) {
      if (kicked.connected) sendSession(kicked, { t: 'room.closed', reason: 'kicked' });
      else { kicked.notice = 'kicked'; kicked.pendingResult = replay; }
    }
    this.log.info(`[lobby] ${room.code} ${target.name} removed by the host`);
  }

  start(session) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    const humans = room.activeHumans();
    for (const s of humans) {
      if (s.playerId !== room.hostId && (!s.connected || !s.ready)) return fail(ERR.NOT_READY);
    }
    const bots = room.seats.filter((s) => s && s.isBot);
    if (humans.length < 1 || (room.mode === 'solo' && (humans.length !== 1 || bots.length > 0))) {
      return fail(ERR.BAD_MSG, 'invalid seat configuration');
    }
    const key = session.limitKey || null;
    if (key && this.opts.maxMatchesPerAddr > 0 && this.countRooms((r) => !!r.match && r.matchKey === key) >= this.opts.maxMatchesPerAddr) {
      this.limitWarn(`match limit (${this.opts.maxMatchesPerAddr}) reached for ${session.addr}`);
      return fail(ERR.RATE, 'too many running matches from your network');
    }
    return this.startMatch(room, key);
  }

  /**
   * room.loadout (DESIGN §16): check the operator loadout — with its per-operator 潜能 / 练度 `ops` (0.2.2) and the
   * 卡池预选 `bans` (the 100-seat variant's own feature) — against the game data, store all three on the session and
   * the seat, and — while a match runs — hand them to the match (accepted only during INFO_CHECK, see the header).
   * Any part refused: nothing is stored.
   */
  loadout(session, { entries, ops, bans, mode }) {
    const data = this.safeData();
    // ★ 2026-10-18 跨服配装：配装只存在浏览器 localStorage 里，而它按 origin 隔离 —— 换节点进来就是空的。
    //   本机有按玩家名（+档位）记住的一份时，用它顶上空表（客户端收到回包里带回来的 entries 会写回本地）。
    //   `mode` 由客户端给（'normal' | 'zhajing'，见 loadoutSync.js 的 syncSetOf），普通档与炸惊档各记一份。
    const md = mode === 'zhajing' ? 'zhajing' : 'normal';
    const nm = (session && (session.name || session.nick || session.playerName || session.displayName)) || null;
    let inEntries = entries;
    let inOps = ops;
    let inBans = bans;
    try {
      const empty = !inEntries || typeof inEntries !== 'object' || !Object.keys(inEntries).length;
      if (empty && nm) {
        const mem = recallLoadout(nm, md);
        if (mem) { inEntries = mem.entries; inOps = mem.ops || inOps; inBans = mem.bans ?? inBans; }
      }
    } catch { /* 记忆坏了就当没有，绝不影响正常上报 */ }
    const res = checkLoadout(inEntries, (id) => lookup('chess', id, data));
    if (!res || res.error) return fail(res && isErrCode(res.error) ? res.error : ERR.BAD_MSG, res && res.detail);
    const ids = opsCharIds(data);
    const resOps = checkLoadoutOps(inOps, (id) => ids.has(id));
    if (!resOps || resOps.error) return fail(resOps && isErrCode(resOps.error) ? resOps.error : ERR.BAD_MSG, resOps && resOps.detail);
    const resBans = checkLoadoutBans(inBans, {
      quota: (d) => banQuota(data.config, d),
      bond: (b) => lookup('bonds', b, data),
    });
    if (!resBans || resBans.error) return fail(resBans && isErrCode(resBans.error) ? resBans.error : ERR.BAD_MSG, resBans && resBans.detail);
    const loadout = freezeLoadout(res.loadout);
    const opsSet = freezeOps(resOps.ops);
    const bansSet = freezeBans(resBans.bans);
    try {
      if (nm && Object.keys(loadout).length) rememberLoadout(nm, md, { entries: loadout, ops: opsSet, bans: bansSet });
    } catch { /* 记不住不影响本局 */ }
    // 回包带上**最终生效**的这一套（服务端回填时它与收到的不同）以及档位。
    // 走 `payload`：net.js 只把显式给的 payload 拼进 ok 回包（见那里的注释）。
    const out = Object.assign({}, OK, { payload: { mode: md, entries: loadout, ops: opsSet, bans: bansSet } });
    session.loadout = loadout;
    session.ops = opsSet;
    session.bans = bansSet;
    const room = this.roomOf(session);
    if (!room) return out;
    const seat = room.seatOf(session.playerId);
    if (seat) { seat.loadout = loadout; seat.ops = opsSet; seat.bans = bansSet; }
    if (!room.match || !seat) return out; // a spectator's loadout stays on its session, never reaching the match
    if (typeof room.match.setLoadout !== 'function') return fail(ERR.ROOM_STARTED, 'stored for the next match');
    let r;
    try {
      r = room.match.setLoadout(session.playerId, loadout, opsSet, bansSet);
    } catch (e) {
      this.log.error(`[lobby] ${room.code} match.setLoadout threw`, e);
      return fail(ERR.INTERNAL);
    }
    if (r && typeof r === 'object' && r.error) {
      return fail(isErrCode(r.error) ? r.error : ERR.INTERNAL, typeof r.detail === 'string' ? r.detail : undefined);
    }
    return out;
  }

  /**
   * room.ownership (0.2.0 补位): keep the droppable chess of the not-owned list, store it on the session and the seat
   * (see the header). A running match never takes it: it keeps the list its seat had at its start.
   */
  ownership(session, { notOwned }) {
    const data = this.safeData();
    const res = checkNotOwned(notOwned, (id) => lookup('chess', id, data));
    if (!res || res.error) return fail(ERR.BAD_MSG, res && res.detail);
    const list = Object.freeze(res.notOwned.slice());
    session.notOwned = list;
    const room = this.roomOf(session);
    if (!room) return OK;
    const seat = room.seatOf(session.playerId);
    if (seat) seat.notOwned = list;
    if (room.match && seat) return fail(ERR.ROOM_STARTED, 'stored for the next match');
    return OK;
  }

  /**
   * room.diy (0.2.0 自选编队): keep the legal picks (checkDiyPicks against the data and KITTED_CHARS), store them on the
   * session and the seat (see the header). A running match never takes them: it keeps the picks its seat had at its
   * start.
   */
  diy(session, { picks }) {
    const res = checkDiyPicks(picks, { data: this.safeData(), kitted: KITTED_CHARS });
    if (!res || !('ok' in res)) return fail(ERR.BAD_MSG, res && res.detail);
    const kept = freezeDiy(res.picks);
    session.diy = kept;
    const room = this.roomOf(session);
    if (!room) return OK;
    const seat = room.seatOf(session.playerId);
    if (seat) seat.diy = kept;
    if (room.match && seat) return fail(ERR.ROOM_STARTED, 'stored for the next match');
    return OK;
  }

  /**
   * room.skins (docs/SKINS.md): keep the legal skin choices, store them on the session and the seat, and hand them
   * to a running match.
   *
   * Unlike room.ownership / room.diy a running match DOES take them: a skin only changes which model is drawn, so
   * swapping mid-match is safe and is what a 换装 tab is for. The choice is kept for the next match either way.
   * A match that does not implement `setSkins` (an older StubMatch) stores it for the next one instead of failing.
   */
  skins(session, { skins }) {
    const data = this.safeData();
    const cleaned = freezeSkins(skins, (id) => lookup('chess', id, data));
    // ★ 2026-10-13（用户）：按玩家名记住/回填皮肤（换浏览器/清缓存也能自动恢复）。
    //   防御式：任何异常都退回原本行为，绝不影响皮肤上报本身。
    let merged = cleaned;
    try {
      const nm = (session && (session.name || session.nick || session.playerName || session.displayName)) || null;
      if (nm) {
        const back = recallSkins(nm) || null;
        merged = Object.assign({}, back || {}, cleaned || {});
        if (cleaned && Object.keys(cleaned).length) rememberSkins(nm, cleaned);
      }
    } catch (e) { merged = cleaned; }
    session.skins = merged;
    const room = this.roomOf(session);
    if (!room) return Object.assign({}, OK, { skins: merged });
    const seat = room.seatOf(session.playerId);
    if (seat) seat.skins = merged;
    if (!room.match) return OK;
    if (typeof room.match.setSkins !== 'function') return fail(ERR.ROOM_STARTED, 'stored for the next match');
    let r;
    try {
      r = room.match.setSkins(session.playerId, cleaned);
    } catch (e) {
      this.log.error(`[lobby] ${room.code} match.setSkins threw`, e);
      return fail(ERR.INTERNAL);
    }
    if (r && typeof r === 'object' && r.error) {
      return fail(isErrCode(r.error) ? r.error : ERR.INTERNAL, typeof r.detail === 'string' ? r.detail : undefined);
    }
    return OK;
  }

  /**
   * Extra fields of every `welcome` (net.js): the operators a 自选 slot may field (shared/diy.js `kitted`) and the
   * outstanding 全服公告 — someone who connects AFTER a broadcast must still see 「服务器即将关闭」.
   */
  welcomeInfo() {
    return { diyKitted: KITTED_CHARS, notice: this.noticeFor() };
  }

  // ---------------------------------------------------------------------------------------------------
  // Match wiring
  // ---------------------------------------------------------------------------------------------------

  /** @param {Room} room @param {string | null} [key] per-network limit key of the starter */
  startMatch(room, key = null) {
    const host = room.seatOf(room.hostId);
    if (host) host.ready = true;
    const seats = room.seats.filter(Boolean).map((s) => ({
      seat: s.seat, playerId: s.playerId, name: s.name, isBot: s.isBot, connected: s.connected,
      // DESIGN §16: the human's checked operator loadout (bots fight with the defaults)
      loadout: s.isBot ? null : s.loadout || null,
      // 0.2.2 潜能 / 练度: the human's per-operator settings (bots always fight at the data's own values)
      ops: s.isBot ? null : s.ops || null,
      // 卡池预选 (the 100-seat variant's own feature): the human's own 盟约 ban picks — its pool is built from them
      bans: s.isBot ? null : s.bans || null,
      // 0.2.0 补位: the chess the human marked as not owned (bots own every operator)
      notOwned: s.isBot ? null : s.notOwned || null,
      // 0.2.0 自选编队: the human's checked DIY picks (bots field no 自选 piece [ASSUMED])
      diy: s.isBot ? null : s.diy || null,
      // 干员皮肤 (docs/SKINS.md): the human's chosen operator skins. PlayerState.setSkins refuses bots anyway, so no
      // `isBot` guard is needed here — passing it through is what makes a skin chosen in the lobby reach the match.
      skins: s.skins || null,
      // 外援测试模式 (room.testMode): this human's own local cheat switch — 资金不减 + 商店只刷自选编队的外援.
      // Bots never get it (an AI with infinite funds would distort a test match).
      testMode: s.isBot ? false : !!s.testMode,
    }));
    // lastPublic / results: the latest m.public broadcast and the m.result frames (encoded), kept for the replay.
    const ctx = { live: true, ended: false, disposed: false, match: null, lastPublic: null, sharedResult: null, results: new Map() };
    let seed = 0;
    try { seed = this.seedFn() >>> 0; } catch { seed = randomInt(2 ** 32); }
    try {
      const match = new this.MatchClass({
        roomCode: room.code,
        mode: room.mode,
        difficulty: room.difficulty,
        modeId: modeIdFor(room.mode, room.difficulty),
        // 「AI 队友最后选择」 (GitHub #338): fixed for the match
        aiPicksLast: room.mode !== 'solo' && room.aiPicksLast === true,
        seats,
        // the spectator seats (header): watched like eliminated players, never players
        spectators: room.spectators.map((s) => s.playerId),
        seed,
        // the room's match number: with the seed it keeps battleIds unique across the room's matches (DESIGN §14)
        matchNo: room.matchCount + 1,
        data: this.safeData(),
        log: this.log,
        now: this.now,
        send: (playerId, msg) => (ctx.live ? this.matchSend(room, ctx, playerId, msg) : false),
        broadcast: (msg) => { if (ctx.live) this.matchBroadcast(room, ctx, msg); },
        // 已编码帧的通道（用户 2026-10-13）：同一份 JSON 只编一次；没有它时 match 会自动退回上面两条。
        sendRaw: (playerId, data, opts) => (ctx.live ? this.matchSendRaw(room, ctx, playerId, data, opts) : false),
        broadcastRaw: (frame, opts) => { if (ctx.live) this.matchBroadcastRaw(room, ctx, frame, opts); },
        onEnd: (summary) => this.onMatchEnd(room, ctx, summary),
      });
      ctx.match = match;
      room.match = match;
      room.matchCtx = ctx;
      room.matchKey = key;
      room.replay = null;
      room.matchCount++;
      this.log.info(`[lobby] ${room.code} match #${room.matchCount} starting (${room.mode}/${room.difficulty}, ${seats.length} seats, seed ${seed})`);
      this.broadcastState(room);
      match.start();
    } catch (e) {
      this.log.error(`[lobby] ${room.code} match failed to start`, e);
      if (room.matchCtx === ctx) { room.match = null; room.matchCtx = null; room.matchKey = null; }
      this.disposeMatchCtx(ctx);
      this.broadcastState(room);
      return fail(ERR.INTERNAL, 'match failed to start');
    }
    return OK;
  }

  /** onEnd callback: return the room to LOBBY and dispose the match on the next macrotask. */
  onMatchEnd(room, ctx, summary) {
    if (ctx.ended || !ctx.live || room.matchCtx !== ctx || room.disposed) return;
    ctx.ended = true;
    room.lastSummary = summary ?? null;
    room.match = null;
    room.matchCtx = null;
    room.matchKey = null;
    room.replay = this.buildReplay(room, ctx);
    setImmediate(() => this.disposeMatchCtx(ctx));
    this.log.info(`[lobby] ${room.code} match #${room.matchCount} ended`);
    for (let i = 0; i < room.seats.length; i++) {
      const s = room.seats[i];
      if (!s || s.isBot) continue;
      if (s.left) { room.seats[i] = null; continue; }
      s.ready = false;
      if (!s.connected) this.startGrace(room, s);
    }
    for (const s of room.spectators) if (!s.connected) this.startGrace(room, s);
    const host = room.hostId ? room.seatOf(room.hostId) : null;
    if (!host || host.isBot || host.left) this.migrateHost(room);
    if (room.activeHumans().length === 0) this.disposeRoom(room, 'empty');
    else this.broadcastState(room);
  }

  /** Match unicast; m.result frames are also kept for the replay. */
  matchSend(room, ctx, playerId, msg) {
    if (msg && msg.t === 'm.result') {
      const data = encode(msg);
      if (data != null) {
        ctx.results.set(playerId, data);
        // 已经编好了：直接发这份帧，别再让 sendToPlayer 编第二遍（用户 2026-10-13；m.result 是每人一份的大帧）
        if (this.sendToPlayerRaw(room, playerId, data, { type: 'm.result' })) return true;
      }
    }
    return this.sendToPlayer(room, playerId, msg);
  }

  /** Match broadcast; the latest m.public and a broadcast m.result are also kept for the replay. */
  matchBroadcast(room, ctx, msg) {
    const data = this.broadcastRoom(room, msg);
    if (data == null) return;
    if (msg.t === 'm.public') ctx.lastPublic = data;
    else if (msg.t === 'm.result') ctx.sharedResult = data;
  }

  /**
   * 已经编码好的单播帧（用户 2026-10-13）：把 JSON 编一遍就够，`matchSend` 那条路会让 lobby 再 encode 一次。
   * `opts.type` 有两个用处：m.result 的 replay 副本、以及压缩白名单（isCompressibleType）。
   */
  matchSendRaw(room, ctx, playerId, data, opts = {}) {
    if (typeof data !== 'string') return false;
    if (opts.type === 'm.result') ctx.results.set(playerId, data);
    return this.sendToPlayerRaw(room, playerId, data, opts);
  }

  /** 已经编码好的广播帧；`opts.type` 决定压缩与 replay 记录（m.public / m.result）。 */
  matchBroadcastRaw(room, ctx, frame, opts = {}) {
    if (typeof frame !== 'string') return;
    const data = this.broadcastRoom(room, { t: opts.type }, frame);
    if (data == null) return;
    if (opts.type === 'm.public') ctx.lastPublic = data;
    else if (opts.type === 'm.result') ctx.sharedResult = data;
  }

  /** 单播已编码帧：会话校验与 sendToPlayer 一致，帧转一次 Buffer（省掉 ws 的每人一次 byteLength 扫描）。 */
  sendToPlayerRaw(room, playerId, data, opts = {}) {
    if (room.disposed) return false;
    const seat = room.seatOf(playerId) || room.spectatorOf(playerId);
    if (!seat || seat.isBot || seat.left) return false;
    const session = this.registry.byId(playerId);
    if (!session || session.roomCode !== room.code || !session.connected) return false;
    return sendRaw(session.ws, Buffer.from(data, 'utf8'), { compress: isCompressibleType(opts.type) });
  }

  /**
   * Replay record for the humans still seated when a match ends (null when the match produced no m.result,
   * e.g. it was abandoned: those clients then see "simulation closed").
   * @param {Room} room @returns {Room['replay']}
   */
  buildReplay(room, ctx) {
    const frames = new Map();
    for (const s of [...room.seats, ...room.spectators]) {
      if (!s || s.isBot || s.left) continue;
      const frame = ctx.results.get(s.playerId) || ctx.sharedResult;
      if (frame) frames.set(s.playerId, frame);
    }
    if (frames.size === 0) return null;
    return { publicFrame: ctx.lastPublic, frames, pending: new Set(frames.keys()), at: Date.now() };
  }

  /** The replay frames still owed to a player (null when they moved on). @returns {string[] | null} */
  replayFor(room, playerId) {
    const r = room.replay;
    if (!r || !r.pending.has(playerId)) return null;
    return [r.publicFrame, r.frames.get(playerId)].filter(Boolean);
  }

  /** The player moved on from the result screen (acted in the room, left): stop replaying it. */
  dropReplay(room, playerId) {
    const r = room.replay;
    if (!r || !r.pending.delete(playerId)) return;
    r.frames.delete(playerId);
    if (r.pending.size === 0) room.replay = null;
  }

  /**
   * The heavy part of a resync — full match state (match.onReconnect) or, back in LOBBY, the result replay.
   * Immediate after a (re)connect; for repeated hellos on a live socket at most once per resyncMinGapMs
   * (requests inside the window coalesce into one deferred resync).
   * @param {import('./net.js').Session} session @param {boolean} coalesce
   */
  resync(session, coalesce) {
    const pid = session.playerId;
    if (coalesce) {
      if (this.resyncTimers.has(pid)) return; // the scheduled resync answers this request too
      const wait = (Number.isFinite(session.resyncAt) ? session.resyncAt : -Infinity) + this.opts.resyncMinGapMs - this.now();
      if (wait > 0) {
        const t = setTimeout(() => { this.resyncTimers.delete(pid); this.runResync(session); }, wait);
        t.unref?.();
        this.resyncTimers.set(pid, t);
        return;
      }
    } else {
      this.clearResync(pid);
    }
    this.runResync(session);
  }

  /** @param {import('./net.js').Session} session */
  runResync(session) {
    if (!session.connected || this.registry.byId(session.playerId) !== session) return;
    const room = this.roomOf(session);
    if (!room) return;
    session.resyncAt = this.now();
    if (room.match) {
      this.callMatch(room, room.spectatorOf(session.playerId) ? 'addSpectator' : 'onReconnect', session.playerId);
      return;
    }
    const frames = this.replayFor(room, session.playerId);
    // The replay is the room's m.public + m.result, already encoded — both compressible (see wsCompression.js).
    if (frames) for (const frame of frames) sendRaw(session.ws, frame, { compress: true });
  }

  clearResync(playerId) {
    const t = this.resyncTimers.get(playerId);
    if (t) { clearTimeout(t); this.resyncTimers.delete(playerId); }
  }

  /** Log a per-network limit refusal without letting a refusal loop flood the log. */
  limitWarn(text) {
    const now = this.now();
    if (now - this.limitLog.at < 10_000) { this.limitLog.suppressed++; return; }
    const more = this.limitLog.suppressed ? ` (+${this.limitLog.suppressed} similar refusals)` : '';
    this.limitLog.at = now;
    this.limitLog.suppressed = 0;
    this.log.warn(`[lobby] ${text}${more}`);
  }

  /** Number of rooms matching a predicate. */
  countRooms(pred) {
    let n = 0;
    for (const r of this.rooms.values()) if (pred(r)) n++;
    return n;
  }

  /** Route a 'g.*' intent to the running match. */
  routeGame(session, msg) {
    const room = this.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (!room.match) return fail(ERR.WRONG_PHASE, 'no running match');
    if (msg.t === 'g.leave') {
      this.removeMember(room, session.playerId);
      return OK;
    }
    // a spectator only watches (header): nothing else of it ever reaches the match
    if (msg.t !== 'g.watch' && room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    let res;
    try {
      res = room.match.handle(session.playerId, msg);
    } catch (e) {
      this.log.error(`[lobby] ${room.code} match.handle(${msg.t}) threw`, e);
      return fail(ERR.INTERNAL);
    }
    if (res && typeof res.then === 'function') {
      // Contract violation (handle must be synchronous): never let the rejection go unhandled.
      this.log.error(`[lobby] ${room.code} match.handle(${msg.t}) returned a Promise; it must be synchronous`);
      Promise.resolve(res).catch((e) => this.log.error(`[lobby] ${room.code} match.handle(${msg.t}) rejected`, e));
      return OK;
    }
    if (res && typeof res === 'object' && res.error) {
      return fail(isErrCode(res.error) ? res.error : ERR.INTERNAL, typeof res.detail === 'string' ? res.detail : undefined);
    }
    return OK;
  }

  /** Call an optional match hook without letting it throw. onLeave falls back to onDisconnect. */
  callMatch(room, method, ...args) {
    const m = room.match;
    if (!m) return undefined;
    let fn = m[method];
    if (typeof fn !== 'function' && method === 'onLeave') fn = m.onDisconnect;
    if (typeof fn !== 'function') return undefined;
    try {
      return fn.apply(m, args);
    } catch (e) {
      this.log.error(`[lobby] ${room.code} match.${method} threw`, e);
      return undefined;
    }
  }

  disposeMatchCtx(ctx) {
    if (ctx.disposed) return;
    ctx.disposed = true;
    ctx.live = false;
    try { ctx.match?.dispose?.(); } catch (e) { this.log.error('[lobby] match.dispose threw', e); }
  }

  safeData() {
    try { return this.getData(); } catch (e) { this.log.error('[lobby] getData failed', e); return Object.freeze({}); }
  }

  /** How long a dropped solo run stays resumable (ms): the option, else data singleReconnectTime, else 24 h. */
  soloResumeWindowMs() {
    const o = this.opts.soloReconnectWindowMs;
    if (typeof o === 'number' && Number.isFinite(o) && o > 0) return o;
    const sec = this.safeData()?.config?.constants?.singleReconnectTime;
    return (typeof sec === 'number' && Number.isFinite(sec) && sec > 0 ? sec : SOLO_RECONNECT_FALLBACK_SEC) * 1000;
  }

  // ---------------------------------------------------------------------------------------------------
  // Membership helpers
  // ---------------------------------------------------------------------------------------------------

  /** The session's current room (self-heals stale `roomCode`). @returns {Room | null} */
  roomOf(session) {
    if (!session.roomCode) return null;
    const room = this.rooms.get(session.roomCode);
    const seat = room ? room.seatOf(session.playerId) : null;
    if (room && !seat && room.spectatorOf(session.playerId)) return room; // a spectator seat
    if (!room || !seat || seat.left || seat.isBot) { session.roomCode = null; return null; }
    return room;
  }

  /** @returns {Seat} */
  humanSeat(idx, session) {
    return {
      seat: idx, playerId: session.playerId, name: session.name, avatar: session.avatar ?? null, isBot: false, ready: false, connected: session.connected, left: false,
      loadout: session.loadout || null,
      // 0.2.2 潜能 / 练度: settings made before joining ride along onto the new seat
      ops: session.ops || null,
      // 卡池预选: ditto (the pick list is a 局外 setting, like the loadout and the skins)
      bans: session.bans || null,
      notOwned: session.notOwned || null,
      diy: session.diy || null,
      // 干员皮肤 (docs/SKINS.md): a player who picked skins before joining keeps them on the new seat
      skins: session.skins || null,
    };
  }

  /**
   * Remove a human from a room permanently (leave, grace timeout, expiry, switching rooms).
   * In LOBBY the seat is freed; during a match it is marked departed and match.onLeave is called.
   * @param {Room} room @param {string} playerId
   */
  removeMember(room, playerId) {
    const session = this.registry.byId(playerId);
    if (session && session.roomCode === room.code) session.roomCode = null;
    this.clearGrace(playerId);
    this.dropReplay(room, playerId);
    if (this.freeSpectatorSeat(room, playerId)) return;
    const seat = room.seatOf(playerId);
    if (!seat || seat.isBot || seat.left || room.disposed) return;
    if (room.match) {
      seat.left = true;
      seat.connected = false;
      seat.ready = false;
      this.callMatch(room, 'onLeave', playerId);
    } else {
      room.seats[seat.seat] = null;
    }
    if (room.disposed) return; // onLeave may have ended the match and emptied the room
    if (room.hostId === playerId) this.migrateHost(room);
    if (room.activeHumans().length === 0) this.disposeRoom(room, 'empty');
    else this.broadcastState(room);
  }

  /**
   * Free a spectator seat (removeMember): the match forgets the spectator; never a host change or a disposal — a
   * spectator neither holds the host nor keeps a room alive. @returns {boolean} true when it was a spectator seat
   */
  freeSpectatorSeat(room, playerId) {
    const i = room.spectators.findIndex((s) => s.playerId === playerId);
    if (i < 0) return false;
    room.spectators.splice(i, 1);
    if (room.disposed) return true;
    this.callMatch(room, 'removeSpectator', playerId);
    this.broadcastState(room);
    return true;
  }

  /** Lowest-seat connected human becomes host (else lowest-seat human, else null). */
  migrateHost(room) {
    const humans = room.activeHumans();
    const pick = humans.find((s) => s.connected) || humans[0] || null;
    const prev = room.hostId;
    room.hostId = pick ? pick.playerId : null;
    if (pick && prev !== pick.playerId) this.log.info(`[lobby] ${room.code} host → ${pick.name}`);
  }

  startGrace(room, seat) {
    const playerId = seat.playerId;
    this.clearGrace(playerId);
    const t = setTimeout(() => {
      this.graceTimers.delete(playerId);
      if (room.disposed || room.match) return;
      const s = room.seatOf(playerId) || room.spectatorOf(playerId);
      if (!s || s.connected) return;
      const session = this.registry.byId(playerId);
      if (session && session.roomCode === room.code) {
        session.notice = 'timeout';
        session.pendingResult = this.replayFor(room, playerId); // still shown after room.closed on resume
      }
      this.removeMember(room, playerId);
    }, this.opts.lobbyGraceMs);
    t.unref?.();
    this.graceTimers.set(playerId, t);
  }

  clearGrace(playerId) {
    const t = this.graceTimers.get(playerId);
    if (t) { clearTimeout(t); this.graceTimers.delete(playerId); }
  }

  /**
   * Delete a room, detach its members (room.closed unless the room simply emptied) and dispose its match.
   * @param {Room} room @param {string} reason
   */
  disposeRoom(room, reason) {
    if (room.disposed) return;
    room.disposed = true;
    if (this.rooms.get(room.code) === room) this.rooms.delete(room.code);
    this.stateDirty.delete(room);
    const ctx = room.matchCtx;
    room.match = null;
    room.matchCtx = null;
    room.matchKey = null;
    room.replay = null;
    for (const s of room.seats) {
      if (!s || s.isBot) continue;
      this.clearGrace(s.playerId);
      const session = this.registry.byId(s.playerId);
      if (!session || session.roomCode !== room.code) continue;
      session.roomCode = null;
      if (s.left || reason === 'empty') continue;
      if (session.connected) sendSession(session, { t: 'room.closed', reason });
      else session.notice = reason;
    }
    // spectators did not leave: they are told whatever closed the room (its last human leaving included)
    for (const s of room.spectators) {
      this.clearGrace(s.playerId);
      const session = this.registry.byId(s.playerId);
      if (!session || session.roomCode !== room.code) continue;
      session.roomCode = null;
      if (session.connected) sendSession(session, { t: 'room.closed', reason });
      else session.notice = reason;
    }
    if (ctx) this.disposeMatchCtx(ctx);
    this.log.info(`[lobby] ${room.code} disposed (${reason})`);
  }

  genCode() {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LEN; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------------------------------

  /** Connected, non-departed human sessions of a room — its spectators included (room.state, match broadcasts). */
  *memberSessions(room) {
    // 不 spread 成临时数组：这个生成器在每次广播时都会走一遍（100 座 = 每次广播两次数组分配 + 100 次 Map 查）
    for (const list of [room.seats, room.spectators]) {
      for (const s of list) {
        if (!s || s.isBot || s.left) continue;
        const session = this.registry.byId(s.playerId);
        if (session && session.connected && session.roomCode === room.code) yield session;
      }
    }
  }

  /**
   * 座位变动 → 全房 room.state。**合并**：同一窗口内的多次变动只发一帧（实测 100 座一帧 16.8 KB × 每人在线，
   * 每次广播 1.60 MiB 上行；连续 ready/addBot 场景原先是"一次操作一帧"）。
   */
  broadcastState(room) {
    if (room.disposed) return;
    this.stateDirty.add(room);
    if (this.stateTimer) return;
    const t = setTimeout(() => { this.stateTimer = null; this.flushState(); }, STATE_COALESCE_MS);
    t.unref?.();
    this.stateTimer = t;
  }

  /** 窗口到点：每个脏房间编码一次、发一遍（原 broadcastState 的实现）。 */
  flushState() {
    if (this.stateDirty.size === 0) return;
    const rooms = [...this.stateDirty];
    this.stateDirty.clear();
    for (const room of rooms) {
      if (room.disposed) continue;
      // no seatedHumans here: counting every room on every broadcast would scale the work with the load we are trying
      // to protect against. The client's hint uses whatever the last count it saw; the SERVER's addBot is the gate.
      const data = encode(room.toState());
      const b = this.bcast;
      b.stateFrames++;
      b.stateBytes += data.length;
      for (const session of this.memberSessions(room)) if (sendRaw(session.ws, data)) b.stateRecipients++;
    }
  }

  sendState(room, session) {
    sendSession(session, room.toState({ seatedHumans: this.seatedHumans() }));
  }

  /**
   * Match broadcast: encode once, send to every connected member. @returns {string | null} the encoded frame
   *
   * The deflate flag comes from the type whitelist (server/wsCompression.js) — the same one `send()` applies to a
   * unicast frame, so a private snapshot is not left as the single uncompressed stream on an otherwise compressed
   * connection. Room state (`broadcastState`) is deliberately NOT compressed: it is not in the whitelist.
   */
  broadcastRoom(room, msg, preEncoded = null) {
    if (room.disposed) return null;
    const data = typeof preEncoded === 'string' ? preEncoded : encode(msg);
    if (data == null) { this.log.error(`[lobby] ${room.code} unserializable broadcast ${msg && msg.t}`); return null; }
    const droppable = isDroppable(msg);
    const compress = isCompressibleType(msg && msg.t);
    // 一次转成 Buffer：ws 的 sender 对**字符串**会给每个收件人各跑一遍 Buffer.byteLength，
    // 100 座一帧 23.7 KB ⇒ 每次广播白扫 2.2 MB（用户 2026-10-13 审计）。
    const frame = Buffer.from(data, 'utf8');
    const b = this.bcast;
    b.matchFrames++;
    b.matchBytes += frame.length;
    const sendTo = (list, buf, opts, wireLen = null) => {
      for (const s of list) {
        if (sendRaw(s.ws, buf, opts)) { b.matchRecipients++; b.matchWireBytes += wireLen == null ? buf.length : wireLen; }
      }
    };
    const plainOpts = { droppable, compress };
    const sd = this.sharedDeflate;
    // 临时诊断（SP_DBG_WS=1 才打）：谁在收这帧广播 —— 排查「对局状态到不了客户端」。
    if (process.env.SP_DBG_WS) {
      const ids = [...this.memberSessions(room)].map((s) => `${s.playerId}${s.connected ? '' : '(断)'}`);
      console.log(`[dbg] bcast ${msg && msg.t} room=${room.code} → ${ids.join(', ') || '（无人）'}`);
    }
    if (!compress || !sd || !sd.enabled) {
      b.sharedFallback++;
      sendTo([...this.memberSessions(room)], frame, plainOpts);
      return data;
    }
    // 共享压缩：按"协商参数组"压**一次**，组内复用字节（同一帧不再被每人各压一遍）。
    // ★ 低于 ws 自己的压缩阈值时绝不能走这条路：那时 ws 不会设 RSV1 位，客户端会收到裸 deflate 字节。
    const plainList = [];
    const groups = new Map();
    for (const s of this.memberSessions(room)) {
      const real = sd.install(s.ws);
      const key = real ? sd.keyFor(real) : null;
      const threshold = real && Number.isFinite(real._threshold) ? real._threshold : 512;
      if (!key || frame.length < threshold) { plainList.push(s); continue; }
      let g = groups.get(key);
      if (!g) { g = { real, list: [] }; groups.set(key, g); }
      g.list.push(s);
    }
    if (groups.size === 0) { b.sharedFallback++; sendTo(plainList, frame, plainOpts); return data; }
    for (const [key, g] of groups) {
      sd.compress(key, frame, g.real, (err, defl) => {
        if (err || !defl) { b.sharedFallback++; sendTo(g.list, frame, plainOpts); return; }
        b.sharedCompressed++;
        const marked = Buffer.from(frame);
        marked[PRE_DEFLATED] = defl;
        sendTo(g.list, marked, { droppable, compress: true }, defl.length);   // 账本记真正上网的（压缩后）字节
      });
    }
    if (plainList.length) { b.sharedFallback++; sendTo(plainList, frame, plainOpts); }
    return data;
  }

  /** Match unicast. @returns {boolean} */
  sendToPlayer(room, playerId, msg) {
    if (room.disposed) return false;
    const seat = room.seatOf(playerId) || room.spectatorOf(playerId);
    if (!seat || seat.isBot || seat.left) return false;
    const session = this.registry.byId(playerId);
    if (!session || session.roomCode !== room.code) return false;
    return sendSession(session, msg);
  }

  /**
   * 全服公告 (sys.notice): one frame to EVERY connected session — lobby, waiting rooms and running matches alike, so
   * 「服务器即将关闭」 reaches people who are mid-battle, not just whoever happens to be on the title screen.
   *
   * It is a message, not an action: nothing is closed or scheduled here. The operator sends the notice and decides
   * separately whether to stop the server, so a mistyped announcement cannot take the room down.
   *
   * The latest notice is kept in memory (`this.notice`) and replayed to every new session on `welcome` (see
   * `noticeFor`), so a player who connects AFTER the broadcast still sees it — the whole point of a shutdown warning.
   *
   * @param {{ text?: string, level?: 'info'|'warn'|'error', ttlSec?: number, clear?: boolean }} opts
   *   `ttlSec` is a DISPLAY hint (the client hides the strip when it lapses); 0/absent = stays until dismissed.
   *   `clear: true` takes the notice down instead (needs no `text`).
   * @returns {{ ok: true, sent: number, notice: object|null, cleared?: boolean } | { ok: false, error: string }}
   */
  announce({ text, level = 'info', ttlSec = 0, clear = false } = {}) {
    // 撤回: forget the notice and tell every client to drop the strip. The banner is per-browser dismissable, so
    // without this a notice could only ever be replaced, never taken down.
    if (clear === true) {
      const had = this.notice;
      this.notice = null;
      const msg = { t: 'sys.notice', text: '', level: 'info', ttlSec: 0, at: this.now() };
      let n = 0;
      for (const session of this.registry.all()) {
        if (session.closed || !session.ws) continue;
        try { if (sendSession(session, msg)) n++; } catch { /* a dying socket must not stop the fan-out */ }
      }
      this.log.info(`[lobby] announce cleared (${had ? 'had one' : 'none outstanding'}) → ${n} sessions`);
      return { ok: true, sent: n, notice: null, cleared: true };
    }
    const body = typeof text === 'string' ? text.trim().slice(0, 300) : '';
    if (!body) return { ok: false, error: 'empty text' };
    const lv = ['info', 'warn', 'error'].includes(level) ? level : 'info';
    const ttl = Number.isFinite(ttlSec) && ttlSec > 0 ? Math.min(86_400, Math.floor(ttlSec)) : 0;
    const notice = { text: body, level: lv, ttlSec: ttl, at: this.now() };
    this.notice = notice;
    const msg = { t: 'sys.notice', ...notice };
    let sent = 0;
    for (const session of this.registry.all()) {
      if (session.closed || !session.ws) continue;
      try { if (sendSession(session, msg)) sent++; } catch { /* a dying socket must not stop the fan-out */ }
    }
    this.log.info(`[lobby] announce (${lv}${ttl ? `, ${ttl}s` : ''}) → ${sent} sessions: ${body.slice(0, 60)}`);
    return { ok: true, sent, notice };
  }

  /** The notice a newly welcomed session should be shown, or null (nothing announced, or its ttl lapsed). */
  noticeFor() {
    const n = this.notice;
    if (!n) return null;
    if (n.ttlSec > 0 && this.now() - n.at > n.ttlSec * 1000) return null;
    return n;
  }
}