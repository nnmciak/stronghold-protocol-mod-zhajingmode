// Audio manager (Web Audio): BGM per phase, UI SFX, per-unit battle SFX, operator battle voice. Never throws.
//
// Sources: data/assets.json → audio (docs/ASSETS.md):
//   bgm { lobby, prep, combat, combatAlts?: [ {intro?, loop}, … ], boss: { intro?, loop },
//         sifeng: { loop }, rainlove: { loop }, rainloveSifeng: { loop } },
//   bossBgm { [bossId]: { intro?, loop } },
//   voice { [charId]: { start, faceEnemy, select, place, skill1…skill4, squad, squadFirst, result*, gacha } },
//   sfx.ui { click, buy, sell, refresh, freeze, levelup, merge, equip, ready, timer, yourTurn, … },
//   sfx.battle { deploy, tokenDeploy, charDie, tokenDie?, enemyDie, enemyHit, heal, killCoin, … },
//   sfx.units { [charId|tokenId|enemyId]: { attack?, hit?, skill?, die?, born?, mix?: { [role]: { p?, vol? } } } }.
//
// - The AudioContext is created on the first user gesture (pointerdown/keydown/touchend), so browsers
//   never block or warn; everything requested before that is remembered (BGM) or dropped (SFX).
// - Channels: master → { bgm, sfx, voice } gains; volumes from settings (0..1) + mute. Tab hidden ⇒ suspend.
// - BGM: `intro` then `loop` (1 s crossfade); switching tracks fades out/in (0.8 s). The same loop URL
//   keeps playing across phases (prep and combat share a track).
// - 开战 BGM: `bgm.combatAlts` are the mode's own battle tracks (塞壬唱片 骑士之日 / 无畏者). The track is fixed per
//   round, not drawn: 无畏者 through rounds 1–7 and 骑士之日 from round 8 on (`combatTrackFor`, the official
//   schedule), so every client of a match hears the same one, a fight never switches track halfway through and the
//   联防 that follows a 作战 keeps its round's track.
// - Boss战雨爱 (owner's request, settings → 「Boss战雨爱」 关/开启/司凤版): 隐秘核心 (PHASE.HIDDEN_CORE) is the ONLY
//   phase whose BGM the switch replaces — `bgmKeyFor` gives it its own `core:<bossId>` key, and while the setting is
//   on/司凤版 `playBgm` swaps that key for `bgm.rainlove` (正常版) / `bgm.rainloveSifeng` (司凤版). 最终攻势 (R14), the
//   开战 rounds and the 主菜单 keep their own tracks; 关 (the default) resolves `core:<id>` exactly like `boss:<id>`,
//   i.e. the official boss track, so the switch never changes anything until it is turned on.
// - 干员战斗语音 (`audio.voice`, user request): an operator says the official line of the moment it is in —
//   行动出发 start, 行动开始 faceEnemy, 选中干员 select, 部署 place, 作战中1-4 skillN and the settlement's
//   结算 result* (all battle-only; the 休整期 is silent). Voices are seconds long and a battle deploys eight
//   operators, then fires dozens of skills, so they run on their own channel (own gain, settings 干员语音) through
//   VoiceGate: one line at a time, a global gap, a per-unit per-slot cooldown, and a higher-priority line taking the
//   channel over — the official scheduling of `audio_data.json battleVoice.voiceTypeOptions`.
// - Battle SFX from `b.ev` tuples (`handleBattleEvents`): at most MAX_VOICES concurrent unit sounds, at most
//   MAX_PER_URL overlapping copies of one sound (the official banks' maxSoundAllowed 2), a per-unit cooldown and a
//   per-URL minimum gap (SfxLimiter), so a 60-unit fight stays listenable.
// - Impact sounds (user playtest #4 item 6): a 'dmg' plays the `hit` sound of the unit whose hostile attack ('atk' on a
//   unit of the other side) aimed at the target — once, within IMPACT_WINDOW_MS, and only for phys / arts / true damage.
//   A heal "attack" ('atk' of a healer on an ally, chain heals) never makes the healer the author of the next damage
//   on that ally (纯烬艾雅法拉's heals made every later hit on a healed ally ring her impact sound), element gauge fills
//   and DoTs play none, and a chain bounce ('chain' / 'chainHeal': its first id is the previous target) plays no attack
//   sound of that target. An operator's attack / hit sound that is a skill-mode file of its own (official names end in
//   `_n` for the normal attack, `_d` / `_h` / `_s` for its skill modes — the manifest picked 纯烬艾雅法拉's S3 impact
//   p_imp_gtshpbrnch_s as her `hit`) never plays for a normal attack (normalAttackSfx).
// - The official bank mix of a unit's own attack / hit / die / born sound (`mix`, tools/assets/audio.mjs bankMix; community
//   report #30): it plays with chance `p` — 猎狗pro / 深池侦察犬's attack bank is 80 % silence, so they bark on about one
//   attack in five (never replaced by the generic enemy sound) — at its base gain × `vol`, capped at 1: an official volume
//   below 1 is quieter (妖怪's 0.7), none is louder than before (unitGain).
// - Deaths/deployments follow the official per-class defaults (unitSoundClass): only operators play the
//   operator-knocked-down sound; summons use the token sounds; a summon used up by its own effect (fx `consumed`,
//   香槟炸弹) plays its impact sound instead of a death sound.
// - Buffers are fetched once and cached (LRU); failed fetch/decode ⇒ silent (logged once as a warning).
//
// `bgmKeyFor(route, pub)` picks the track for the current screen/phase (main.js calls `audio.install()`,
// which follows the store).

import { PHASE } from '../../shared/constants.js';
import { mediaUrl } from './media.js';
import { sanitizeVoiceOverrides, voiceLangFor } from './voicePrefs.js';

const MAX_VOICES = 8;
const UNIT_COOLDOWN_MS = 160;
const URL_GAP_MS = 45;
const MAX_PER_URL = 2;

/** 「司凤」表情页各音效的音量（未列出的按 0.85）。五条悟那张主人要求压到 0.612。 */
const EMOTE_SFX_VOLUME = Object.freeze({ sifengWin: 0.4 });
/** 需要「同时最多一条、且不打断正在播的那条」的表情音效（once）。 */
const EMOTE_SFX_ONCE = new Set(['sifengWin', 'kskblzdjd', 'meipang', 'sifengAmiya', 'sifengNaiwa', 'sifengDante', 'sifengLesgo', 'sifengBaoli']);
/**
 * 漏怪: the original Arknights exit alarm (`sfx.battle.leak`, `battle/b_ui/b_ui_alarmenter`) runs **1.44 s**, and the
 * official bank is a one-shot: `battle.ON_ENEMY_REACHED_EXIT` carries `maxSoundAllowed: 1` with `popOldest: true` on the
 * `Battle_UI_Important` mixer, i.e. **never two at once** (a new escape replaces the one still ringing). We keep the
 * "never two at once" half and leave the rest of the cue alone: leaks closer together than the cue is long are the same
 * disaster and share one alarm, so a line that breaks costs one clear ring per 1.5 s instead of a stutter of restarts.
 * (The SFX limiter still applies on top.)
 */
const LEAK_SFX_GAP_MS = 1500;
const BUFFER_CACHE = 180;
/** Decoded-PCM budget of the buffer cache beside its entry count: a voice line decodes to 0.4–1.3 MB (see _buffer). */
const BUFFER_BYTES = 64 * 1024 * 1024;
const XFADE_S = 1;
const FADE_S = 0.8;
/** Voice: shortest gap between two lines, and the crossfade of a higher-priority line taking the channel (official 0.1 s). */
const VOICE_GAP_MS = 1200;
const VOICE_XFADE_S = 0.1;
/** 'atk' projectile kinds whose first id is the previous bounce target (sim ai.js), not the attacker. */
const CHAIN_KINDS = new Set(['chain', 'chainHeal']);
/** 'dmg' types that are an attack's impact (element gauge fills / 元素伤害 carry the element's name instead). */
const IMPACT_TYPES = new Set(['phys', 'arts', 'true']);
/** A 'dmg' later than this (real ms) after the attack aimed at the target is not that attack's impact. */
const IMPACT_WINDOW_MS = 2500;
/** Official operator sound files of a skill mode: `…_d` / `…_h` / `…_s` (+ digits) — the normal attack's end in `_n`. */
const SKILL_MODE_FILE = /_(d|h|s)\d*\.mp3$/i;

// ---- pure helpers (unit-tested) -----------------------------------------------------------------------

/**
 * BGM key for a route + match phase.
 * @param {'title'|'lobby'|'room'|'game'|string} route
 * @param {any} pub m.public (may be null)
 * @param {0|1|null} [combatTrack] the round's own 开战 track index into `bgm.combatAlts` (combatTrackFor; omitted ⇒
 *   plain 'combat', i.e. the manifest's default combat track)
 * @returns {string|null} 'lobby' | 'prep' | 'combat' | 'combat:<i>' | 'unite' | 'boss' | 'boss:<bossId>' |
 *   'core' | 'core:<bossId>' (隐秘核心 — the Boss战雨爱 switch keys off this prefix, see bossRainloveKey)
 */
export function bgmKeyFor(route, pub, combatTrack = null) {
  if (route !== 'game') return route === 'title' || route === 'lobby' || route === 'room' ? 'lobby' : null;
  const phase = pub?.phase;
  if (!phase) return 'lobby';
  switch (phase) {
    case PHASE.INFO_CHECK: case PHASE.BAND_DRAFT: case PHASE.BATTLE_CHECK: case PHASE.RESULT: case PHASE.LOBBY:
      return 'lobby';
    case PHASE.UNITE:
      // 联防 has its own track: the official `escaped_single` / `escaped_multi` levels declare
      // `bgmEvent = corrosion` (level_act1autochess_escaped_*.json), so the rescue phase is not the 作战's track.
      // resolveBgm falls back to `bgm.combat` when a manifest predates it.
      return 'unite';
    case PHASE.COMBAT:
      // 开战 BGM: the round's own track — 骑士之日 / 无畏者 are fixed per round, not drawn (combatTrackFor)
      return combatTrack == null ? 'combat' : `combat:${combatTrack ? 1 : 0}`;
    case PHASE.FINAL_ASSAULT:
      return pub.bossId ? `boss:${pub.bossId}` : 'boss';
    case PHASE.HIDDEN_CORE:
      // 隐秘核心 has a key of its own (`core:`) even though it plays the same official boss track as `boss:<id>`:
      // it is the one phase the Boss战雨爱 switch may replace (bossRainloveKey), and 最终攻势 must never be.
      return pub.hiddenBossId ? `core:${pub.hiddenBossId}` : pub.bossId ? `core:${pub.bossId}` : 'core';
    default:
      return 'prep';
  }
}

/**
 * Resolve a BGM key to { intro?, loop } URLs from the manifest: `boss:<id>` / `core:<id>` fall back to the generic
 * boss track (`core:` is 隐秘核心's own key — the official track unless the Boss战雨爱 switch replaced it upstream),
 * `combat:<i>` to the i-th `bgm.combatAlts` entry (and to `bgm.combat` when the manifest has none), and `unite`
 * (联防's own track) to `bgm.combat` when the manifest predates it.
 * @param {any} manifest
 * @param {string|null} key
 * @returns {{ intro: string|null, loop: string }|null}
 */
export function resolveBgm(manifest, key) {
  const a = manifest?.audio;
  if (!a || !key) return null;
  // 隐秘核心 without a boss id falls back to the generic boss track exactly like the bare 'boss' key does
  const k = key === 'core' ? 'boss' : key;
  let t = null;
  if (k.startsWith('boss:') || k.startsWith('core:')) t = a.bossBgm?.[k.slice(5)] || a.bgm?.boss;
  else if (k.startsWith('combat:')) t = a.bgm?.combatAlts?.[Number(k.slice('combat:'.length))] || a.bgm?.combat;
  else if (k === 'unite') t = a.bgm?.unite || a.bgm?.combat;
  else t = a.bgm?.[k];
  if (!t || typeof t.loop !== 'string') return null;
  return { intro: typeof t.intro === 'string' ? t.intro : null, loop: t.loop };
}

/**
 * 设置 →「Boss战雨爱」的三档 (owner's request): 关 (default) / 开启 (正常版) / 司凤版.
 */
export const BOSS_RAINLOVE = Object.freeze(['off', 'on', 'sifeng']);

/**
 * The key `playBgm` should actually play: 隐秘核心's own `core[:<bossId>]` key becomes the 雨爱 track while the
 * 「Boss战雨爱」 switch is on / 司凤版. Everything else is returned untouched — 最终攻势, the 开战 rounds, 联防, the
 * 主菜单 and every non-boss phase keep the official track, and 关 returns the key as it came in (so a profile that
 * never touches the switch hears exactly what it heard before the feature existed).
 * @param {string|null} key bgmKeyFor output
 * @param {string} setting 'off' | 'on' | 'sifeng' (anything else ⇒ 关)
 * @returns {string|null}
 */
export function bossRainloveKey(key, setting) {
  if (setting !== 'on' && setting !== 'sifeng') return key;
  if (typeof key !== 'string' || !(key === 'core' || key.startsWith('core:'))) return key;
  return setting === 'sifeng' ? 'rainloveSifeng' : 'rainlove';
}

/**
 * The last round that plays 无畏者 (1–7); from the next round on it is 骑士之日 (8–13) — the official schedule
 * (docs/ASSETS.md "BGM"; the two tracks are the 塞壬唱片 act13side battle themes).
 */
export const COMBAT_TRACK_SWITCH_ROUND = 7;

/**
 * The round's own 开战 track index into `bgm.combatAlts` (plan.mjs order: 0 = `m_bat_kazimierz2_1` 骑士之日,
 * 1 = `m_bat_kazimierz2_2` 无畏者). The mode does not draw these: the official schedule plays one per round, 无畏者
 * through the early rounds (1–7) and 骑士之日 from round 8 to the last normal round (8–13). Everything after that is
 * the boss rounds (最终攻势 / 隐秘核心), which have their own tracks and never ask for `combat:<i>`.
 * @param {number|null|undefined} round m.public.round
 * @returns {0|1|null} null when the round is unknown ⇒ the manifest's plain `combat` track
 */
export function combatTrackFor(round) {
  const r = Number(round);
  if (!Number.isFinite(r) || r < 1) return null;
  return r <= COMBAT_TRACK_SWITCH_ROUND ? 1 : 0;
}

/**
 * Official sound class of a battle unit (audio_data `battle.ON_UNIT_DEAD|BORN.<class>` defaults):
 * 'enemy' | 'char' (operators: b_char_dead “干员被击倒” / b_char_set) | 'token' (summons: b_char_tokendead /
 * b_char_tokenset) | 'device' (stage devices: the act crate trap_1105 dies with b_char_tokendead, no born sound).
 * Band map characters (预备干员-医疗 / Touch, `char_*` ids) are characters although the sim runs them as tokens.
 * @param {{ side?: string, kind?: string, defId?: string, def?: string }|null} info tracked unit (UnitInfo subset)
 */
export function unitSoundClass(info) {
  if (!info) return 'char';
  if (info.side === 'enemy') return 'enemy';
  const id = String(info.defId ?? info.def ?? '');
  if (info.kind === 'device') return 'device';
  if (info.kind === 'token') return /^char_/.test(id) ? 'char' : 'token';
  return 'char';
}

/** URL of the generic token death sound (b_char_tokendead): sfx.battle.tokenDie, else next to charDie. */
function tokenDieUrl(manifest) {
  const b = manifest?.audio?.sfx?.battle;
  if (typeof b?.tokenDie === 'string') return b.tokenDie;
  return typeof b?.charDie === 'string' && /b_char_dead\.mp3$/.test(b.charDie) ? b.charDie.replace(/b_char_dead\.mp3$/, 'b_char_tokendead.mp3') : null;
}

/**
 * Death sound of a battle unit ('die' event): the unit's own ON_UNIT_DEAD sound, else its class default — only
 * operators play the operator-knocked-down sound (charDie). A summon that fired and was used up (香槟炸弹: its
 * explosion is the sound) is silent, and so is an operator leaving without being knocked out, when the event says so
 * (`reason` ≠ 'killed').
 * @param {any} manifest data/assets.json
 * @param {{ side?: string, kind?: string, defId?: string, def?: string, boss?: boolean }|null} info
 * @param {{ consumed?: boolean, reason?: string|null }} [o]
 * @returns {string|null} sound URL
 */
export function deathSfxUrl(manifest, info, { consumed = false, reason = null } = {}) {
  if (!info || consumed) return null;
  const cls = unitSoundClass(info);
  if (cls === 'char' && reason && reason !== 'killed') return null;
  const own = manifest?.audio?.sfx?.units?.[info.def]?.die;
  if (typeof own === 'string') return own;
  const b = manifest?.audio?.sfx?.battle ?? {};
  if (cls === 'enemy') return (info.boss ? b.enemyDieHeavy : null) ?? b.enemyDie ?? null;
  if (cls === 'char') return typeof b.charDie === 'string' ? b.charDie : null;
  return tokenDieUrl(manifest);
}

/**
 * Deployment sound of an allied unit ('deploy' event): its own ON_UNIT_BORN sound, else operators b_char_set
 * (sfx.battle.deploy), summons b_char_tokenset (tokenDeploy); stage devices have none.
 * @returns {string|null}
 */
export function deploySfxUrl(manifest, info) {
  if (!info || info.side === 'enemy') return null;
  const own = manifest?.audio?.sfx?.units?.[info.def]?.born;
  if (typeof own === 'string') return own;
  const b = manifest?.audio?.sfx?.battle ?? {};
  const cls = unitSoundClass(info);
  if (cls === 'device') return null;
  const url = cls === 'token' ? (b.tokenDeploy ?? b.deploy) : b.deploy;
  return typeof url === 'string' ? url : null;
}

/**
 * Whether a unit's manifest `attack` / `hit` sound may play for its normal attacks: an operator's (`char_*`) sound file
 * of one of its skill modes (`_d` / `_h` / `_s`, see header) may not. Enemy files use `_h` for heavy weapons (always
 * allowed), and so may summons.
 * @param {string} defId the unit's model id (sfx.units key)
 * @param {string} url
 */
export function normalAttackSfx(defId, url) {
  return typeof url === 'string' && !(typeof defId === 'string' && defId.startsWith('char_') && SKILL_MODE_FILE.test(url));
}

/**
 * Gain of a unit's own sound with its manifest mix (sfx.units[id].mix[role]: the official bank's volume): `base` × `vol`,
 * never above `base` (a bank louder than 1 plays as before — community report #30 asked for quieter, not louder).
 * @param {number} base the role's base gain (attack / hit 0.55, die / born / skill 0.8)
 * @param {{ vol?: number }|null|undefined} mix
 */
export function unitGain(base, mix) {
  const v = mix && Number(mix.vol);
  return Number.isFinite(v) && v >= 0 ? base * Math.min(1, v) : base;
}

/**
 * Whether a unit's own sound plays this time: its official bank's chance `mix.p` (sounds with a file over all the weights;
 * 猎狗pro's attack bank 20 of 100). `roll` ∈ [0, 1).
 */
export function unitSoundPlays(mix, roll) {
  const p = mix && Number(mix.p);
  return !(Number.isFinite(p) && p >= 0 && p < 1) || roll < p;
}

/**
 * Voice priorities — the official battle voice types (`audio_data.json battleVoice.voiceTypeOptions`) mapped onto the
 * manifest's slots: BATTLE_START 100, BATTLE_FACE_ENEMY 90, SKILL_ACTIVE 70, PASSIVE_IMP 60, PASSIVE_NOR 50,
 * PLACE_CHAR 20, FOCUS_CHAR 10. The settlement lines are no battle voice of the official scheduler: they sit at 85,
 * above 作战中 (70) but below 接敌 (90), so a battle's last word is never cut off by an ordinary line. The four prep
 * slots (部署 / 编入队伍 / 任命队长 / 干员报到) keep their levels although the 休整期 is silent (see the header).
 */
export const VOICE_PRIORITY = Object.freeze({
  start: 100, faceEnemy: 90,
  skill1: 70, skill2: 70, skill3: 70, skill4: 70,
  resultFour: 85, resultThree: 85, resultTwo: 85, resultLose: 85,
  gacha: 60, squadFirst: 45, squad: 30, place: 20, select: 10,
});

/** Per-unit per-slot cooldowns (ms): the official 10 s of the 作战中 (passive skill) lines, 3 s between 接敌 lines.
 *  选中干员 has none — official FOCUS_CHAR `cooldown: 0` (it was 1.5 s until this version, which made a tap in the
 *  休整期 inaudible because the previous tap's cooldown was still running). */
export const VOICE_COOLDOWN_MS = Object.freeze({
  start: 0, faceEnemy: 3000,
  skill1: 10000, skill2: 10000, skill3: 10000, skill4: 10000,
  resultFour: 0, resultThree: 0, resultTwo: 0, resultLose: 0,
  gacha: 0, squadFirst: 0, squad: 0, place: 0, select: 0,
});

/**
 * The slot a player's tap asks for: 选中干员 (official FOCUS_CHAR — priority 10, cooldown 0,
 * `overlapIfSamePriority: true`). The battle lines are timed by the gate's global gap; a tap is the player's own
 * request and answers at once: on an idle channel it always plays (no gap, no cooldown), a newer tap replaces the
 * 选中 line still on air (same priority, overlapIfSamePriority), and it still never interrupts a higher-priority
 * line (部署, 作战中, 开战 …). Nor does it start a gap of its own: the battle lines keep the gap of the last battle
 * line, so a tap can never delay a 技能 / 接敌 line.
 */
export const VOICE_TAP_SLOTS = Object.freeze(['select']);

/**
 * The settlement slot of a finished 作战: 完美作战 ⇒ 3星结束行动 (绝境 / 终极 ⇒ 完成高难行动 instead), a leaked enemy
 * ⇒ 非3星结束行动, nothing killed at all ⇒ 行动失败.
 * @param {{perfect?:boolean, leaked?:number, killed?:number, total?:number, hard?:boolean}} [o]
 * @returns {'resultFour'|'resultThree'|'resultTwo'|'resultLose'}
 */
export function resultVoiceSlot(o = {}) {
  const leaked = Number.isFinite(o.leaked) ? o.leaked : 0;
  const killed = Number.isFinite(o.killed) ? o.killed : 0;
  const total = Number.isFinite(o.total) ? o.total : 0;
  if (o.perfect) return o.hard ? 'resultFour' : 'resultThree';
  if (total > 0 && killed <= 0) return 'resultLose';
  if (leaked > 0) return 'resultTwo';
  return o.hard ? 'resultFour' : 'resultThree';
}

/**
 * Who says a battle's **result** line (结算): an operator of THAT battle's own field. Never the field the player happens
 * to be looking at (review on #73): reading the tracked units of the field on screen made a teammate's operator say the
 * viewer's 作战结束 line while the viewer was watching them.
 * `pp` is that battle's own `perPlayer` entry (BattleResult, sim/Battle.js): `unitsEnd` lists what stood on its field
 * when the battle ended. Its `defId` names the CHESS (`chess_char_*`) or a summon piece (`token_*`, which does not talk);
 * the voice bank belongs to the operator (`char_*`), so `charOf` maps a chess id to its charId (the chess record's
 * `charId`). Without it only ids that already are a charId count — a real result then has no speaker, which is how the
 * line stayed silent in every battle until 0.1.4's fix.
 * Survivors speak first — the line reports how the battle went, and a wiped-out squad is the only case where a fallen
 * operator ends up saying it. Ties are drawn like every other unit sound.
 * @param {{ unitsEnd?: Array<{ defId?: string|null, alive?: boolean }> } | null | undefined} pp that battle's perPlayer
 * @param {() => number} [random]
 * @param {((defId: string) => string|null|undefined) | null} [charOf] chess id → charId
 * @returns {string|null} charId, or null when that battle fielded no operator at all
 */
export function resultSpeaker(pp, random = Math.random, charOf = null) {
  const ops = [];
  for (const u of Array.isArray(pp?.unitsEnd) ? pp.unitsEnd : []) {
    if (!u || typeof u.defId !== 'string') continue;
    const id = u.defId.startsWith('char_') ? u.defId : charOf ? charOf(u.defId) : null;
    if (typeof id === 'string' && id.startsWith('char_')) ops.push({ id, alive: !!u.alive });
  }
  const standing = ops.filter((o) => o.alive);
  const pool = standing.length ? standing : ops;   // only a wiped-out squad is spoken for by a fallen operator
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))].id;
}

/** Concurrency + cooldown gate for battle SFX. Pure (time is passed in). */
/** Gestures that may unlock audio: iOS Safari only accepts touchend / click / keydown; pointerdown covers the rest. */
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'click', 'keydown'];

export class SfxLimiter {
  /** @param {{ maxVoices?: number, unitCooldownMs?: number, urlGapMs?: number, maxPerUrl?: number }} [o] */
  constructor(o = {}) {
    this.maxVoices = o.maxVoices ?? MAX_VOICES;
    this.unitCooldownMs = o.unitCooldownMs ?? UNIT_COOLDOWN_MS;
    this.urlGapMs = o.urlGapMs ?? URL_GAP_MS;
    // the official battle banks (attack, impact, heal, born, dead…) allow at most 2 overlapping copies of a sound
    // (audio_data maxSoundAllowed 2): a heal / impact heard on every tick of a crowd never piles up
    this.maxPerUrl = o.maxPerUrl ?? MAX_PER_URL;
    this.active = 0;
    this.lastByUnit = new Map();
    this.lastByUrl = new Map();
    this.activeByUrl = new Map();
  }

  /**
   * Whether a sound may start now; records it when allowed (call `release(url)` when it ends).
   * @param {number} now ms
   * @param {string|number|null} unitKey e.g. `${unitId}:atk`
   * @param {string} url
   */
  tryAcquire(now, unitKey, url) {
    if (this.active >= this.maxVoices) return false;
    if ((this.activeByUrl.get(url) || 0) >= this.maxPerUrl) return false;
    if (unitKey != null) {
      const t = this.lastByUnit.get(unitKey);
      if (t != null && now - t < this.unitCooldownMs) return false;
    }
    const u = this.lastByUrl.get(url);
    if (u != null && now - u < this.urlGapMs) return false;
    if (unitKey != null) this.lastByUnit.set(unitKey, now);
    this.lastByUrl.set(url, now);
    if (this.lastByUnit.size > 600) this.lastByUnit.clear();
    if (this.lastByUrl.size > 400) this.lastByUrl.clear();
    this.active += 1;
    this.activeByUrl.set(url, (this.activeByUrl.get(url) || 0) + 1);
    return true;
  }

  /** A sound started by tryAcquire ended. */
  release(url) {
    this.active = Math.max(0, this.active - 1);
    const n = this.activeByUrl.get(url) || 0;
    if (n <= 1) this.activeByUrl.delete(url); else this.activeByUrl.set(url, n - 1);
  }
}

/**
 * Voice gate: one line at a time, a global gap between two lines, a per-unit per-slot cooldown, and takeover by a
 * clearly more important line (the caller fades the playing one out first). Pure — the clock is passed in.
 */
export class VoiceGate {
  /** @param {{ gapMs?: number, preemptMargin?: number, maxUnits?: number }} [o] */
  constructor(o = {}) {
    this.gapMs = Number.isFinite(o.gapMs) ? o.gapMs : VOICE_GAP_MS;
    // a line only takes the channel over when its priority beats the playing one by this margin: an equal-priority
    // line (two 作战中 of different operators) waits for its turn instead of cutting the other off
    this.preemptMargin = Number.isFinite(o.preemptMargin) ? o.preemptMargin : 10;
    this.maxUnits = Number.isFinite(o.maxUnits) ? o.maxUnits : 400;
    this.playing = null;      // { slot, pri } of the line on air
    this.lastAt = -Infinity;
    this.unitUntil = new Map();
  }

  /** Drop all state (a new field must not inherit the previous battle's cooldowns). */
  reset() {
    this.playing = null;
    this.lastAt = -Infinity;
    this.unitUntil.clear();
  }

  /**
   * May a `slot` line from `unitKey` start now?
   * @param {string} slot
   * @param {string|number|null} unitKey the cooldown key (a battle unit id; null = no per-unit cooldown)
   * @param {number} now ms
   * @returns {'play'|'preempt'|'drop'}
   */
  request(slot, unitKey, now) {
    const pri = VOICE_PRIORITY[slot] ?? 0;
    const tap = VOICE_TAP_SLOTS.includes(slot);
    if (this.playing) {
      if (tap && this.playing.slot === slot) return 'preempt';   // a newer tap replaces the 选中 line on air
      if (pri < this.playing.pri + this.preemptMargin) return 'drop';
      return 'preempt';                       // a clearly more important line takes the channel
    }
    if (tap) return 'play';                   // a tap on an idle channel always answers (FOCUS_CHAR cooldown 0)
    if (now - this.lastAt < this.gapMs) return 'drop';
    if (unitKey != null && now < (this.unitUntil.get(`${unitKey}:${slot}`) || 0)) return 'drop';
    return 'play';
  }

  /** Record a line that started (call right after request() answered play / preempt). */
  start(slot, unitKey, now) {
    this.playing = { slot, pri: VOICE_PRIORITY[slot] ?? 0 };
    if (!VOICE_TAP_SLOTS.includes(slot)) this.lastAt = now;   // the gap is between battle lines: a tap starts none
    const cd = VOICE_COOLDOWN_MS[slot] ?? 0;
    if (unitKey != null && cd > 0) {
      if (this.unitUntil.size > this.maxUnits) this.unitUntil.clear();
      this.unitUntil.set(`${unitKey}:${slot}`, now + cd);
    }
  }

  /** The line ended (naturally, by takeover or by a stop). */
  release() { this.playing = null; }
}

// ---- manager -----------------------------------------------------------------------------------------------

/**
 * Could Web Audio decode this response? A host without the `/media/` route answers 404; some static hosts answer a
 * missing path with 200 + the SPA's index.html instead, and fetching *that* would fail to decode as silently as a
 * 404 would — so the fallback looks at the declared type too.
 *
 * A response that declares no type at all is not treated as wrong: absence of a header is not evidence of an HTML
 * page, and fetch stubs / minimal hosts legitimately omit it.
 * @param {{ ok?: boolean, headers?: { get?: (n: string) => string | null } }} res
 */
function isAudioResponse(res) {
  if (!res || !res.ok) return false;
  const type = res.headers?.get?.('content-type');
  return !type || /^\s*audio\//i.test(type);
}
const MUJICA_AUDIO_IDS = new Set(['char_4182_oblvns', 'char_4183_mortis', 'char_4184_dolris', 'char_4185_amoris', 'char_4186_tmoris']);
/** Original audio_data event names. null is an intentionally silent generic event. */
export function mujicaBankForUnit(id, kind, index = 0, active = false, form = null) {
  if (!MUJICA_AUDIO_IDS.has(id) || !['attack', 'hit', 'skill'].includes(kind)) return undefined;
  const code = id.replace(/^char_\d+_/, '');
  if (kind === 'skill') {
    if (code === 'oblvns') return index === 0 ? 'battle.ON_ABILITY_START.skchr_oblvns_1'
      : index === 1 ? `battle.ON_SKILL_START.skchr_oblvns_2.${form === 'oblvns_s2_b' ? 1 : 2}`
      : 'battle.ON_CUSTOM_TRIGGER.skchr_oblvns_3[start]';
    if (code === 'mortis' || code === 'amoris') return `battle.ON_CUSTOM_TRIGGER.${code}_skill_start_${index + 1}`;
    if (code === 'dolris') return `battle.ON_CUSTOM_TRIGGER.dolris_s_${index + 1}_start`;
    return index === 0 ? 'battle.ON_ABILITY_START.skchr_tmoris_1' : 'battle.ON_CUSTOM_TRIGGER.tmoris_skill_2_start';
  }
  if (code === 'oblvns') return kind === 'hit' ? null : active && index === 2
    ? 'battle.ON_ABILITY_START.char_4182_oblvns.attack.4.1' : 'battle.ON_ABILITY_ON.char_4182_oblvns.attack.0.1';
  // Nyamu's individual drum impacts and Uika's S2 pulses arrive at their precise kit timestamps.
  if (code === 'amoris' || code === 'dolris') return null;
  if (code === 'mortis') {
    if (kind === 'attack' && active && index === 1) return null;
    return `battle.ON_ABILITY_${kind === 'attack' ? 'ON' : 'HIT'}.char_4183_mortis.attack${active && index === 1 ? '.3' : ''}`;
  }
  if (kind === 'attack' && active && index === 0) return null;
  return `battle.ON_ABILITY_${kind === 'attack' ? 'ON' : 'HIT'}.char_4186_tmoris.attack.${active && index === 1 ? 1 : 0}`;
}

export class AudioManager {
  /**
   * @param {{ getManifest?: () => any, win?: any }} [opts]
   */
  constructor(opts = {}) {
    this.getManifest = typeof opts.getManifest === 'function' ? opts.getManifest : () => null;
    this.random = typeof opts.random === 'function' ? opts.random : Math.random;   // a unit sound's chance (mix.p)
    this.win = opts.win ?? (typeof window !== 'undefined' ? window : null);
    this.ctx = null;
    this.master = null;
    this.bgmGain = null;
    this.sfxGain = null;
    this.voiceGain = null;
    this.volumes = { bgm: 0.6, sfx: 0.8, voice: 0.8, muted: false, emoteSfxVolume: 1 };
    /**
     * Which voice pack operator battle lines come from: 'jp' (the default — the official Japanese dub) or 'cn'.
     * Picked in settings; `_voiceLine` reads `audio.voice[voiceLang]` and falls back to the other language, then
     * to the flat manifest shape. See docs/SKINS.md's sibling note in the changelog for the bilingual port.
     */
    this.voiceLang = 'jp';
    /**
     * 逐干员语音 (upstream 0.2.3 #436, `public/js/voicePrefs.js`): `charId` → 'cn' | 'jp'. An operator without an entry
     * follows `voiceLang` — the global choice above. Local-only, like the rest of the audio preferences (never sent to
     * the server: it is a listening preference of this browser, not part of `room.loadout`).
     */
    this.voiceOverrides = {};
    /**
     * 司凤版大厅BGM (owner's request, settings → 「司凤版大厅BGM」, OFF by default): while on, the 主菜单 track ('lobby' — the title
     * screen, lobby and room all resolve to it, see bgmKeyFor) is played from `audio.bgm.sifeng` instead of the official
     * `audio.bgm.lobby`. Only the menu is swapped: prep / combat / 联防 / boss keep their own tracks.
     */
    this.sifengBgm = false;
    /**
     * Boss战雨爱 (owner's request, settings → 「Boss战雨爱」): 'off' | 'on' | 'sifeng'. While on / 司凤版, the 隐秘核心
     * boss battle plays `bgm.rainlove` (正常版) / `bgm.rainloveSifeng` instead of the official boss track — 最终攻势
     * and every other phase keep theirs (bossRainloveKey). 'off' by default: a profile that never touches the switch
     * hears exactly what it heard before the feature existed.
     */
    this.bossRainlove = 'off';
    this.bgmKey = null;       // the last LOGICAL key playBgm was asked for (so a settings flip can re-resolve it)
    this.bgmHold = null;      // 伟大封印处决音乐：循环到下一个 PREP 再交还给阶段 BGM
    this.buffers = new Map(); // url → Promise<AudioBuffer|null> (insertion order = LRU)
    this.bufBytes = new Map(); // url → decoded PCM bytes (the byte budget of the LRU, see _buffer)
    this.warned = new Set();
    this.limiter = new SfxLimiter();
    this.voiceGate = new VoiceGate();
    this.voiceNode = null;    // { src, gain, url, token } of the line on air
    this.voiceToken = 0;
    this.startVoiceDone = false; // 行动出发 of this field (the first operator deployed says it)
    this.uiVoices = 0;
    this.wantBgm = null;      // desired key (kept while locked)
    this.bgm = null;          // { key, loopUrl, nodes: [{src, gain}], gain }
    this.bgmToken = 0;
    this.units = new Map();   // battle unit id → defId
    this.lastAttacker = new Map(); // target id → { def, at } of the hostile attack last aimed at it (its impact sound)
    this.consumed = new Set();     // summons used up by their own effect (香槟炸弹 exploded): no death sound
    this.installed = false;
    this._unlock = this._unlock.bind(this);
    this._onVis = this._onVis.bind(this);
  }

  /** Attach gesture unlock + visibility handling. Idempotent. */
  install() {
    if (this.installed || !this.win) return;
    this.installed = true;
    try {
      for (const ev of UNLOCK_EVENTS) this.win.addEventListener(ev, this._unlock, { capture: true, passive: true });
      this.win.document?.addEventListener?.('visibilitychange', this._onVis);
      // iOS / iPadOS: a phone call, Siri or another app puts the context into 'interrupted'; coming back to the page
      // (pageshow / focus) resumes it (plus the next gesture, below)
      this.win.addEventListener?.('pageshow', this._onVis);
      this.win.addEventListener?.('focus', this._onVis);
    } catch { /* ignore */ }
  }

  get unlocked() { return !!this.ctx; }

  /**
   * First user gesture: create the context. The gesture listeners stay until the context actually runs — iOS Safari
   * only counts touchend / click (not pointerdown / touchstart) as activation, so a context created on pointerdown can
   * stay 'suspended' until the finger lifts. A 1-sample silent buffer is played inside the gesture (older WebKit only
   * unlocks output after something was started in a gesture).
   */
  _unlock() {
    if (this.ctx) {
      const st = this.ctx.state;
      if (st === 'running') { this._dropUnlock(); return; }
      if (!this.win?.document?.hidden) {
        this._primeOutput();
        const p = this.ctx.resume?.();
        if (p && typeof p.then === 'function') p.then(() => { if (this.ctx?.state === 'running') this._dropUnlock(); }, () => {});
      }
      return;
    }
    try {
      const AC = this.win?.AudioContext || this.win?.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.bgmGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.voiceGain = this.ctx.createGain();
      this.bgmGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.voiceGain.connect(this.master);
      this.master.connect(this.ctx.destination);
      // iOS / iPadOS: a call, Siri or another app's audio moves a running context to 'interrupted' (or 'suspended');
      // a resume without a gesture may then be refused — listen for the next gesture again (dropped once it runs)
      try {
        this.ctx.addEventListener?.('statechange', () => {
          const s = this.ctx?.state;
          if (s && s !== 'running' && s !== 'closed' && !this.win?.document?.hidden) this._armUnlock();
        });
      } catch { /* ignore */ }
      this._applyVolumes();
      this._primeOutput();
      if (this.ctx.state === 'running') this._dropUnlock();
      else {
        const p = this.ctx.resume?.();
        if (p && typeof p.then === 'function') p.then(() => { if (this.ctx?.state === 'running') this._dropUnlock(); }, () => {});
      }
      if (this.wantBgm) { const k = this.wantBgm; this.wantBgm = null; this.playBgm(k); }
      if (this.mujicaStates?.size) this.setMujicaFever(null);
    } catch (err) {
      this._warn('ctx', err);
      this.ctx = null;
    }
  }

  /** (Re-)attach the gesture listeners after the context stopped running while visible (see _unlock / _onVis). */
  _armUnlock() {
    if (!this._unlockDropped || !this.win) return;
    this._unlockDropped = false;
    try { for (const ev of UNLOCK_EVENTS) this.win.addEventListener(ev, this._unlock, { capture: true, passive: true }); } catch { /* ignore */ }
  }

  /** Remove the first-gesture listeners (the context runs). */
  _dropUnlock() {
    if (this._unlockDropped || !this.win) return;
    this._unlockDropped = true;
    try { for (const ev of UNLOCK_EVENTS) this.win.removeEventListener(ev, this._unlock, { capture: true }); } catch { /* ignore */ }
  }

  /** Start a silent 1-sample buffer (inside a user gesture: unlocks output on older WebKit). */
  _primeOutput() {
    try {
      const c = this.ctx;
      if (!c || typeof c.createBuffer !== 'function') return;
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, c.sampleRate || 44100);
      src.connect(c.destination);
      src.start ? src.start(0) : src.noteOn?.(0);
    } catch { /* ignore */ }
  }

  _onVis() {
    try {
      if (!this.ctx) return;
      if (this.win?.document?.hidden) this.ctx.suspend().catch(() => {});
      else if (this.ctx.state !== 'running') {
        // back on the page: resume, and keep a gesture ready in case the browser wants one first (iOS after a call)
        this._armUnlock();
        this.ctx.resume().then(() => { if (this.ctx?.state === 'running') this._dropUnlock(); }, () => {});
      }
    } catch { /* ignore */ }
  }

  _warn(key, err) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    try { console.warn(`[audio] ${key} unavailable`, err?.message || err || ''); } catch { /* ignore */ }
  }

  /**
   * Set channel volumes (0..1), mute, and — when given — the operator voice pack.
   * @param {{ bgm?: number, sfx?: number, voice?: number, muted?: boolean, voiceLang?: string, sifengBgm?: boolean,
   *   bossRainlove?: 'off'|'on'|'sifeng' }} v
   */
  setVolumes(v) {
    const n = (x, d) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : d);
    this.volumes = {
      emoteSfxVolume: Number.isFinite(Number(v && v.emoteSfxVolume)) ? Math.max(0, Math.min(1.5, Number(v.emoteSfxVolume))) : 1,
      bgm: n(v?.bgm, this.volumes.bgm),
      sfx: n(v?.sfx, this.volumes.sfx),
      voice: n(v?.voice, this.volumes.voice),
      muted: typeof v?.muted === 'boolean' ? v.muted : this.volumes.muted,
    };
    // the voice pack rides along with the other audio preferences: it is the same settings panel and the same
    // stored record, and an unset value must not reset a choice made earlier
    if (typeof v?.voiceLang === 'string') this.setVoiceLang(v.voiceLang, v.voiceOverrides);
    // 司凤版大厅BGM: flipping the switch re-resolves the track that is playing right now, so the 主菜单 BGM changes the moment
    // it is toggled instead of waiting for the next screen change (playBgm no-ops when the URL is unchanged).
    if (typeof v?.sifengBgm === 'boolean' && v.sifengBgm !== this.sifengBgm) {
      this.sifengBgm = v.sifengBgm;
      if (this.bgmKey) this.playBgm(this.bgmKey);
    }
    // Boss战雨爱: same deal — the switch takes effect on the track that is playing right now, so flipping it during
    // 隐秘核心 swaps 雨爱 / the official boss track on the spot (and off a battle it is a no-op: the key is unchanged
    // and playBgm sees the same loop URL). Anything outside the three steps is ignored (a stale stored value).
    if (BOSS_RAINLOVE.includes(v?.bossRainlove) && v.bossRainlove !== this.bossRainlove) {
      this.bossRainlove = v.bossRainlove;
      if (this.bgmKey) this.playBgm(this.bgmKey);
    }
    this._applyVolumes();
  }

  /**
   * Switch the operator voice pack ('jp' | 'cn'). Ignored for anything else, so a stale stored preference
   * cannot silence every line. The next line played uses the new pack; a line already playing is left alone.
   * 逐干员覆盖 (`overrides`) rides along: it is independent of the global choice, so a stale global value must not
   * drop it.
   * @param {string} lang @param {Record<string,string>} [overrides] @returns {boolean} whether the lang was accepted
   */
  setVoiceLang(lang, overrides = this.voiceOverrides) {
    this.voiceOverrides = sanitizeVoiceOverrides(overrides);
    if (lang !== 'jp' && lang !== 'cn') return false;
    this.voiceLang = lang;
    return true;
  }

  _applyVolumes() {
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(this.volumes.muted ? 0 : 1, t, 0.03);
      // perceptual curve
      this.bgmGain.gain.setTargetAtTime(this.volumes.bgm ** 2 * 0.55, t, 0.05);
      this.sfxGain.gain.setTargetAtTime(this.volumes.sfx ** 2 * 0.9, t, 0.03);
      // no 0.9: a voice line is already mastered as loud as the rest of the official mix (settings 干员语音 tunes it)
      this.voiceGain.gain.setTargetAtTime(this.volumes.voice ** 2, t, 0.03);
    } catch { /* ignore */ }
  }

  /** Fetch + decode (cached, LRU). Resolves null on failure. */
  _buffer(url) {
    if (!this.ctx || typeof url !== 'string' || !url) return Promise.resolve(null);
    const hit = this.buffers.get(url);
    if (hit) {
      this.buffers.delete(url);
      this.buffers.set(url, hit);
      return hit;
    }
    const p = (async () => {
      try {
        // Extension-less URL first so download managers leave the BGM alone; a host without /media/ still works.
        const media = mediaUrl(url);
        let res = await fetch(media);
        if (media !== url && !isAudioResponse(res)) {
          // Drop the unusable response (404, or a 200 that is really index.html) before trying the original URL.
          try { await res.body?.cancel?.(); } catch { /* the fallback request matters more than draining this one */ }
          res = await fetch(url);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ab = await res.arrayBuffer();
        return await new Promise((resolve) => {
          try {
            const r = this.ctx.decodeAudioData(ab, resolve, () => resolve(null));
            if (r && typeof r.then === 'function') r.then(resolve, () => resolve(null));
          } catch { resolve(null); }
        });
      } catch (err) {
        this._warn(url, err);
        return null;
      }
    })();
    this.buffers.set(url, p);
    p.then((buf) => {
      if (!buf) return;
      try {
        this.bufBytes.set(url, (buf.length || 0) * (buf.numberOfChannels || 1) * 4);
        this._trimBuffers();
      } catch { /* ignore */ }
    }, () => {});
    this._trimBuffers();
    return p;
  }

  /**
   * Evict least-recently-used buffers until both the entry count and the decoded-PCM budget hold. The count alone is
   * not enough once voice lines are in the cache: 180 of them are ~100 MB of PCM (a voice decodes to 0.4–1.3 MB).
   */
  _trimBuffers() {
    let bytes = 0;
    for (const n of this.bufBytes.values()) bytes += n;
    if (this.buffers.size <= BUFFER_CACHE && bytes <= BUFFER_BYTES) return;
    for (const url of [...this.buffers.keys()]) {
      if (this.buffers.size <= BUFFER_CACHE && bytes <= BUFFER_BYTES) break;
      // never evict the playing BGM (a voice keeps its own reference to its buffer)
      if (this.bgm && url === this.bgm.loopUrl) continue;
      bytes -= this.bufBytes.get(url) || 0;
      this.buffers.delete(url);
      this.bufBytes.delete(url);
    }
  }

  /** Preload a list of URLs (e.g. UI SFX) once unlocked. */
  preload(urls) {
    if (!this.ctx) return;
    for (const u of Array.isArray(urls) ? urls : []) this._buffer(u);
  }

  // ---- BGM ------------------------------------------------------------------------------------------------

  /**
   * Switch BGM (null stops). Same loop URL ⇒ no restart.
   * @param {string|null} key see bgmKeyFor
   */
  playBgm(key) {
    try {
      this.bgmKey = key;   // the LOGICAL key: setVolumes re-plays it when 司凤版大厅BGM is toggled
      // ★ 2026-10-25：自定义大厅音乐（ui/lobbyMusic.js）接管时，默认大厅 BGM 必须让位 ——
      //   之前这个钩子只被 lobbyMusic 挂上、audio 从没读过，于是两首同时响（「自定义音乐和大厅音乐重合」）。
      if (key === 'lobby' && typeof this.lobbyMusicOverride === 'function' && this.lobbyMusicOverride(key)) {
        if (this.ctx) this._fadeOutBgm();
        this.wantBgm = null;
        return;
      }
      if (!this.ctx) { this.wantBgm = key; return; }
      // 司凤版大厅BGM: swap ONLY the 主菜单 track ('lobby' covers the title screen, the lobby and a room — bgmKeyFor).
      // prep / combat / combat:<i> / unite / boss keep the official tracks.
      const k0 = key === 'lobby' && this.sifengBgm ? 'sifeng' : key;
      // Boss战雨爱: and 隐秘核心 ('core[:<bossId>]') plays 雨爱 while that switch is on — every other key, 最终攻势
      // included, is returned untouched (bossRainloveKey).
      const k = bossRainloveKey(k0, this.bossRainlove);
      const track = resolveBgm(this.getManifest(), k);
      if (this.bgm && track && this.bgm.loopUrl === track.loop) { this.bgm.key = k; return; }
      if (!track && !this.bgm) return;
      const token = ++this.bgmToken;
      this._fadeOutBgm();
      if (!track) return;
      this._startBgm(k, track, token);
    } catch (err) { this._warn('bgm', err); }
  }

  async _startBgm(key, track, token) {
    const [intro, loop] = await Promise.all([track.intro ? this._buffer(track.intro) : null, this._buffer(track.loop)]);
    if (token !== this.bgmToken || !this.ctx || !loop) return;
    try {
      const ctx = this.ctx;
      const gain = ctx.createGain();
      gain.connect(this.bgmGain);
      const t0 = ctx.currentTime + 0.05;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(this.mujicaMusicUrl && !this.mujicaMusicFinished ? 0 : 1, t0 + FADE_S);
      const nodes = [];
      let loopAt = t0;
      if (intro) {
        const s = ctx.createBufferSource();
        s.buffer = intro;
        const g = ctx.createGain();
        s.connect(g); g.connect(gain);
        s.start(t0);
        const end = t0 + intro.duration;
        const xf = Math.min(XFADE_S, intro.duration / 2);
        g.gain.setValueAtTime(1, Math.max(t0, end - xf));
        g.gain.linearRampToValueAtTime(0, end);
        nodes.push({ src: s, gain: g });
        loopAt = end - xf;
      }
      const s = ctx.createBufferSource();
      s.buffer = loop;
      s.loop = true;
      const g = ctx.createGain();
      s.connect(g); g.connect(gain);
      if (intro) {
        g.gain.setValueAtTime(0, loopAt);
        g.gain.linearRampToValueAtTime(1, loopAt + Math.min(XFADE_S, intro.duration / 2));
      }
      s.start(loopAt);
      nodes.push({ src: s, gain: g });
      this.bgm = { key, loopUrl: track.loop, nodes, gain };
    } catch (err) { this._warn('bgm-start', err); }
  }

  _fadeOutBgm() {
    const cur = this.bgm;
    this.bgm = null;
    if (!cur || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      cur.gain.gain.cancelScheduledValues(t);
      cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
      cur.gain.gain.linearRampToValueAtTime(0, t + FADE_S);
      for (const n of cur.nodes) { try { n.src.stop(t + FADE_S + 0.05); } catch { /* ignore */ } }
      setTimeout(() => { try { cur.gain.disconnect(); } catch { /* ignore */ } }, (FADE_S + 0.3) * 1000);
    } catch { /* ignore */ }
  }

  // ---- SFX ------------------------------------------------------------------------------------------------

  /** 备战落场音（0.3.2 PR #416）：该单位自己的部署音，走音效通道与音量，每次落地只响一次。 */
  deployCue(info, key) {
    try {
      const url = deploySfxUrl(this.getManifest(), { def: info?.def ?? null, defId: info?.defId ?? null, kind: info?.kind ?? null, side: 'ally' });
      if (!url) return false;
      this._play(url, { volume: 0.5, unitKey: 'land:' + (key ?? '') });
      return true;
    } catch { return false; }
  }

  _play(url, { volume = 1, rate = 1, limited = false, unitKey = null, exclusive = null, once = null } = {}) {
    if (!this.ctx || !url || this.volumes.muted || this.volumes.sfx <= 0) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (limited) { if (!this.limiter.tryAcquire(now, unitKey, url)) return; }
    else if (this.uiVoices >= 12) return;
    else this.uiVoices += 1;
    // 用户 2026-10-11：同一个 exclusive / once 键的上一份还在响时先掐掉（exclusive）或直接不放（once）。
    // 表情音效用 `once`：**同时最多一条，而且开始播放后不会被打断**。
    if (exclusive) {
      if (!this._exclusiveVoices) this._exclusiveVoices = new Map();
      const prev = this._exclusiveVoices.get(exclusive);
      if (prev) { try { prev.stop(); } catch { /* ignore */ } this._exclusiveVoices.delete(exclusive); }
    }
    const release = () => {
      if (limited) this.limiter.release(url); else this.uiVoices = Math.max(0, this.uiVoices - 1);
      if (once && this._onceVoices) this._onceVoices.delete(once);
    };
    if (once) {
      if (!this._onceVoices) this._onceVoices = new Set();
      if (this._onceVoices.has(once)) {
        // 还在播 → 放弃这一次（只退掉刚占用的名额，**不要**动 once 标记，否则会把正在播的那条放行成可叠）
        if (limited) this.limiter.release(url); else this.uiVoices = Math.max(0, this.uiVoices - 1);
        return;
      }
      this._onceVoices.add(once);
    }
    this._buffer(url).then((buf) => {
      if (!buf || !this.ctx) { release(); return; }
      try {
        const s = this.ctx.createBufferSource();
        s.buffer = buf;
        s.playbackRate.value = rate;
        const g = this.ctx.createGain();
        g.gain.value = Math.max(0, Math.min(1.5, volume));
        s.connect(g); g.connect(this.sfxGain);
        if (exclusive) this._exclusiveVoices.set(exclusive, s);
        let done = false;
        const end = () => {
          if (!done) {
            done = true;
            release();
            if (exclusive && this._exclusiveVoices && this._exclusiveVoices.get(exclusive) === s) this._exclusiveVoices.delete(exclusive);
            try { g.disconnect(); } catch { /* ignore */ }
          }
        };
        s.onended = end;
        setTimeout(end, (buf.duration / rate) * 1000 + 250); // safety if onended never fires
        s.start();
      } catch { release(); }
    }, release);
  }

  /**
   * UI sound by name (sfx.ui keys). Unknown names are ignored.
   * @param {string} name
   * @param {{ volume?: number }} [o]
   */
  sfx(name, o = {}) {
    try {
      const url = this.getManifest()?.audio?.sfx?.ui?.[name];
      if (typeof url === 'string') this._play(url, { volume: o.volume ?? 0.9 });
    } catch { /* ignore */ }
  }

  /** Battle sound by name (sfx.battle keys), limited like unit sounds. */
  battle(name, o = {}) {
    try {
      const url = this.getManifest()?.audio?.sfx?.battle?.[name];
      if (typeof url === 'string') this._play(url, { volume: o.volume ?? 0.7, limited: true, unitKey: o.unitKey ?? `b:${name}` });
    } catch { /* ignore */ }
  }

  /**
   * 谢拉格冻结音效（用户定制，第二次联防阶段专用）：与 `battle()` 同一条通道，但**带播放速度**。
   * 速度由调用方（screens/game.js + ui/gameLogic/uniteFreezeCue.js）按「**第一轮** 1.0 → 2.0，之后
   * **0.8 → 2.0**，每触发一次 +0.1，到顶回到 0.8」的梯子推进；这里只负责播。`limited: false`：冻结可能
   * 一瞬间来好几只，这里的"每触发一次响一次"是需求本身，不能像单位音效那样被 limiter 丢掉
   * （同时最多 12 个，见 `_play`）。
   * @param {number} rate 播放速度（Web Audio playbackRate），1 = 原速
   * @param {{ volume?: number, unitKey?: string }} [o]
   */
  freeze(rate = 1, o = {}) {
    try {
      const url = this.getManifest()?.audio?.sfx?.battle?.freeze;
      if (typeof url !== 'string') return;
      const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
      this._play(url, { volume: o.volume ?? 0.85, rate: r });
    } catch { /* ignore */ }
  }

  /**
   * ？！冰？！（惊变卡 jibian_bing）的「冰冰冰」音效（用户定制）：卡池隐藏备注里写的是「此玩家每次触发寒冷
   * 或冻结时播放冰冰冰音效」，所以触发次数可能很密（一次 AoE 寒冷命中十几只）。节流交给调用方
   * （ui/gameLogic/bingCue.js 的 MIN_GAP_MS），这里 `limited: false` 一触发就播，不被单位音效的 limiter 吞掉。
   * @param {{ volume?: number }} [o]
   */
  jibianBing(o = {}) {
    try {
      const url = this.getManifest()?.audio?.sfx?.battle?.jibianBing;
      if (typeof url !== 'string') return;
      const gain = Number(this.volumes && this.volumes.emoteSfxVolume);
      const mul = Number.isFinite(gain) ? Math.max(0, Math.min(1.5, gain)) : 1;
      this._play(url, { volume: (o.volume ?? 0.85) * mul });
    } catch { /* ignore */ }
  }

  /**
   * 通用「播报附带的音频」（owner 2026-10-16，惊变「异戒神将」）：按 key 取 `audio.sfx.battle.<key>` 播放。
   * 与 `jibianBing` 同一条 sfx 通道，但**独立**于默认的 `broadcast` 提示音 —— 播报条（ui/ticker.js）在
   * 这一行带 `sound` 时改播它。取不到 key 就静默返回（不报错、不影响战斗）。
   * @param {string} key `audio.sfx.battle` 下的键（如 'yijieshenjiang'）
   * @param {{ volume?: number }} [o]
   */
  announceSound(key, o = {}) {
    try {
      if (typeof key !== 'string' || !key) return false;
      const url = this.getManifest()?.audio?.sfx?.battle?.[key];
      if (typeof url !== 'string') { console.warn('[announce] 清单里没有 audio.sfx.battle.' + key); return false; }
      this._play(url, { volume: o.volume ?? 0.85 });
      return true;
    } catch { return false; }
  }

  /**
   * 惊变「死亡回归」的播报音（owner 2026-10-16）：`audio.sfx.battle.siwanghuigui`。
   *
   * 三条口径（owner 指定）：
   *   · **受「背景音乐」滑条控制** → 走 `bgmGain` 通道（不是 sfx），所以音乐调小它就跟着小；
   *     因为 bgm 通道自带 ×0.55，音量 0.6 时实际增益 ≈ 0.198，天然就轻；
   *   · **不受「司凤」类开关影响** → 不读 emoteSfx / emoteSfxVolume / bossRainlove / sifengBgm，
   *     与 `emoteSound()` 那套完全无关（那套会被「司凤表情音效」总开关掐掉）；
   *   · **在音乐音量之上再乘 0.7**，并在**结尾 2 秒线性淡出**（AudioBufferSource 尾部 20 %，上限 2 s）。
   *
   * 同时最多一条：新的这次直接把上一条掐掉（`once` 语义由 _deathReturnVoice 自己管）。
   * @param {{ volume?: number }} [o]
   */
  deathReturnAnnounce(o = {}) {
    try {
      const url = this.getManifest()?.audio?.sfx?.battle?.siwanghuigui;
      if (typeof url !== 'string') { console.warn('[deathReturn] 清单里没有 audio.sfx.battle.siwanghuigui'); return; }
      if (!this.ctx) { console.warn('[deathReturn] AudioContext 还没建（需要一次用户手势）'); return; }
      if (!this.bgmGain) { console.warn('[deathReturn] bgmGain 不存在'); return; }
      if (this.volumes.muted) { console.warn('[deathReturn] 已静音，跳过'); return; }
      if (this.volumes.bgm <= 0) { console.warn('[deathReturn] 背景音乐音量为 0，跳过'); return; }
      const vol = Math.max(0, Math.min(1.5, (o.volume ?? 1) * 0.7));
      this._buffer(url).then((buf) => {
        if (!buf) { console.warn('[deathReturn] 音频解码失败:', url); return; }
        if (!this.ctx || !this.bgmGain) return;
        try {
          if (this._deathReturnVoice) { try { this._deathReturnVoice.stop(); } catch { /* ignore */ } }
          const s = this.ctx.createBufferSource();
          s.buffer = buf;
          const g = this.ctx.createGain();
          const t0 = this.ctx.currentTime;
          g.gain.setValueAtTime(vol, t0);
          // 结尾淡出：2 秒（曲子短于 10 秒时退化为尾部 20%）
          const fade = Math.min(2, Math.max(0.2, buf.duration * 0.2));
          const fadeAt = Math.max(t0 + 0.05, t0 + buf.duration - fade);
          g.gain.setValueAtTime(vol, fadeAt);
          g.gain.linearRampToValueAtTime(0, t0 + buf.duration);
          s.connect(g); g.connect(this.bgmGain);
          this._deathReturnVoice = s;
          const done = () => {
            if (this._deathReturnVoice === s) this._deathReturnVoice = null;
            try { g.disconnect(); } catch { /* ignore */ }
          };
          s.onended = done;
          setTimeout(done, buf.duration * 1000 + 300);
          s.start();
        } catch { /* ignore */ }
      }, () => {});
    } catch { /* ignore */ }
  }

  /**
   * 「司凤」表情页第一张（会赢的 / 五条悟）的音效：`audio.sfx.emote.sifengWin`。
   * 用户 2026-10-11：发送这张表情时**全场**都播（含发送者），可在 设置 → 司凤表情音效 里关掉。
   * 音量在默认基础上再降两档（0.85 → 0.68 → 0.612）；`once: true` 表示**同时最多一条、且开始后不被打断**：
   * 上一段还在响时，新的这一次直接忽略（既不叠加、也不掐断正在播的那段）。
   * @param {{ volume?: number }} [o]
   */
  sifengWin(o = {}) {
    this.emoteSound('sifengWin', o);
  }

  /**
   * 「司凤」表情页的**通用**表情音效入口（用户 2026-10-11 又加了两张：kskblzdjd / 没胖）。
   * 音频清单在 `data/assets.json` 的 `audio.sfx.emote.<key>`；音量用下面的表，未列出的按 0.85；
   * 一律 `once` —— **同时最多一条，而且开始播放后不会被打断**（新的这次直接忽略）。
   * 是否播放由 设置 →「司凤表情音效」总开关决定（在 screens/game.js 里判断）。
   * @param {string} key `audio.sfx.emote` 下的键 @param {{ volume?: number }} [o]
   */
  emoteSound(key, o = {}) {
    try {
      const url = this.getManifest()?.audio?.sfx?.emote?.[key];
      if (typeof url !== 'string') return;
      const once = 'emote:' + key;
      if (EMOTE_SFX_ONCE.has(key) && this._onceVoices && this._onceVoices.has(once)) return;
      const gain = Number(this.volumes && this.volumes.emoteSfxVolume);
      const mul = Number.isFinite(gain) ? Math.max(0, Math.min(1.5, gain)) : 1;   // 设置里的「司凤表情音量」总音量条
      this._play(url, { volume: (o.volume ?? (EMOTE_SFX_VOLUME[key] ?? 0.85)) * mul, limited: false, once });
    } catch { /* ignore */ }
  }

  /**
   * Per-unit sound (attack/hit/skill/die/born), throttled.
   * @param {string} defId charId/tokenId/enemyId (or chess id — mapped via its spine/char id by the caller)
   * @param {'attack'|'hit'|'skill'|'die'|'born'} kind
   * @param {number|string} unitId battle unit id (cooldown key)
   * @returns {boolean} whether a unit-specific sound exists
   */
  unit(defId, kind, unitId, skillIndex) {
    try {
      const tracked = this.units.get(unitId);
      const active = !!tracked?.skillOn || (kind !== 'skill' && Number.isInteger(skillIndex));
      const bank = mujicaBankForUnit(defId, kind, skillIndex ?? tracked?.skillIndex ?? 0, active, tracked?.form);
      if (bank !== undefined) return bank ? this._playMujicaBank(bank, `${unitId}:${kind}`, kind === 'skill' ? 0.8 : 0.55) : true;
      const u = this.getManifest()?.audio?.sfx?.units?.[defId];
      // DESIGN §16: the equipped skill's own ON_SKILL_START sound (`skills[index]`) when the manifest has it
      const own = kind === 'skill' && Number.isInteger(skillIndex) && u?.skills ? u.skills[skillIndex] : null;
      const url = typeof own === 'string' ? own : u?.[kind];
      if (typeof url !== 'string') return false;
      if ((kind === 'attack' || kind === 'hit') && !normalAttackSfx(defId, url)) return false;
      // the official bank's mix (header): a silent roll still counts as the unit's own sound (no generic fallback)
      const mix = kind === 'skill' ? null : u?.mix?.[kind];
      if (!unitSoundPlays(mix, this.random())) return true;
      this._play(url, { volume: unitGain(kind === 'attack' || kind === 'hit' ? 0.55 : 0.8, mix), limited: true, unitKey: `${unitId}:${kind}` });
      return true;
    } catch { return false; }
  }

  // ---- operator battle voice ----------------------------------------------------------------------------------

  /**
   * Play an operator's battle line (`audio.voice[charId][slot]`; a slot with several lines draws one at random).
   * Only in battle: every caller is a running battle's own event stream or its settlement (user request — the 休整期
   * is silent). The line must pass VoiceGate: one at a time, a global gap, a per-unit cooldown, higher priority wins.
   * @param {string} charId e.g. 'char_263_skadi'
   * @param {'start'|'faceEnemy'|'select'|'place'|'skill1'|'skill2'|'skill3'|'skill4'|'squad'|'squadFirst'
   *   |'resultFour'|'resultThree'|'resultTwo'|'resultLose'|'gacha'} slot
   * @param {{ unitKey?: string|number|null, volume?: number }} [o] `unitKey` = the cooldown key (a battle unit id)
   * @returns {boolean} whether such a line exists and started
   */
  /**
   * The line list of one voice slot, honouring the chosen language.
   *
   * The manifest is `audio.voice[lang][charId][slot]` since the bilingual port; older manifests (and the
   * `_backup` copies of them) keep the flat `audio.voice[charId][slot]` shape, and a manifest built from a
   * different tool chain may only carry `chars[charId].voice`. All three are tried in that order, so a
   * language the manifest lacks falls back to whatever it does have instead of going silent.
   *
   * @param {string} charId @param {string} slot
   * @returns {string|string[]|undefined}
   */
  _voiceLine(charId, slot) {
    const m = this.getManifest();
    const root = m?.audio?.voice;
    if (!root) return undefined;
    const lang = voiceLangFor(charId, this.voiceLang, this.voiceOverrides);
    const byLang = root[lang];
    if (byLang && typeof byLang === 'object') {
      const hit = byLang[charId]?.[slot];
      if (hit !== undefined) return hit;
      // the other language is better than silence (a manifest may carry only one)
      const other = lang === 'jp' ? root.cn : root.jp;
      const alt = other && typeof other === 'object' ? other[charId]?.[slot] : undefined;
      if (alt !== undefined) return alt;
    }
    const flat = root[charId]?.[slot];
    if (flat !== undefined) return flat;
    return m?.chars?.[charId]?.voice;
  }

  voice(charId, slot, o = {}) {
    try {
      if (!this.ctx || !this.voiceGain || this.volumes.muted || this.volumes.voice <= 0) return false;
      if (typeof charId !== 'string' || typeof slot !== 'string') return false;
      const line = this._voiceLine(charId, slot);
      const url = Array.isArray(line) ? line[Math.floor(Math.random() * line.length)] : line;
      if (typeof url !== 'string' || !url) return false;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const verdict = this.voiceGate.request(slot, o.unitKey ?? null, now);
      if (verdict === 'drop') return false;
      if (verdict === 'preempt') this._stopVoice();
      this.voiceGate.start(slot, o.unitKey ?? null, now);
      const token = ++this.voiceToken;
      this._playVoice(url, token, o.volume);
      return true;
    } catch (err) { this._warn('voice', err); return false; }
  }

  /** Fetch/decode and start one voice line through the voice channel. */
  _playVoice(url, token, volume) {
    // `token` is the line's own `voiceToken`. Every deferred step below — the decode, a failed fetch, `onended` and the
    // safety timer — can land AFTER this line was taken over or stopped: `voiceToken` has moved on and the channel then
    // belongs to the line that replaced it. So each step re-checks its token and, when it is stale, touches NOTHING:
    // `_stopVoice` (takeover / stop) and `setFieldUnits` released the gate themselves. An unconditional release here let
    // a stale callback free the channel the NEW line had just taken, and the next line walked in on top of it (review
    // on #73).
    this._buffer(url).then((buf) => {
      if (token !== this.voiceToken) return;   // taken over / stopped while it decoded: not ours to release
      if (!buf || !this.ctx || !this.voiceGain) { this.voiceGate.release(); return; }
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const gain = this.ctx.createGain();
        gain.gain.value = Math.max(0, Math.min(1.5, Number.isFinite(volume) ? volume : 1));
        src.connect(gain); gain.connect(this.voiceGain);
        const node = { src, gain, url, token };
        let done = false;
        const end = () => {
          if (done) return;
          done = true;
          // this line's own end (natural, or the safety timer): only the line that still owns the channel may free it.
          // A stale end is the takeover's leftovers — `_stopVoice` already faded it out and released the gate.
          if (token === this.voiceToken) {
            if (this.voiceNode === node) this.voiceNode = null;
            this.voiceGate.release();
          }
          try { gain.disconnect(); } catch { /* ignore */ }
        };
        src.onended = end;
        setTimeout(end, (buf.duration + 0.3) * 1000); // safety if onended never fires
        src.start();
        this.voiceNode = node;
      } catch (err) {
        this._warn('voice-play', err);
        if (token === this.voiceToken) this.voiceGate.release();
      }
    }, () => { if (token === this.voiceToken) this.voiceGate.release(); });
  }

  /** Fade the line on air out (a higher priority line is taking the channel over). */
  _stopVoice() {
    const cur = this.voiceNode;
    this.voiceNode = null;
    this.voiceToken += 1;              // a line still decoding must not start afterwards
    this.voiceGate.release();
    if (!cur || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      cur.gain.gain.cancelScheduledValues(t);
      cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
      cur.gain.gain.linearRampToValueAtTime(0, t + VOICE_XFADE_S);
      cur.src.stop(t + VOICE_XFADE_S + 0.02);
    } catch { /* ignore */ }
  }

  // ---- battle events ------------------------------------------------------------------------------------------

  /** Original Fever music uses the music bus and replaces the current battlefield BGM. */
  setMujicaFever(state) {
    this.mujicaStates ??= new Map();
    if (state?.playerId != null) this.mujicaStates.set(state.playerId, state);
    const feverRunning = [...this.mujicaStates.values()].some((s) => s.active);
    if (!feverRunning) { this.mujicaMusicEpoch = null; this.mujicaMusicFinished = false; }
    const active = [...this.mujicaStates.values()].filter((s) => s.active && s.performing !== false);
    const choice = active.some((s) => s.vocal) ? 'vocal' : 'instrumental';
    const url = active.length ? this.getManifest()?.audio?.mujicaFever?.[choice] : null;
    if (!url && feverRunning && this.mujicaMusicUrl) this.mujicaMusicFinished = true;
    if (url && (!this.ctx || !this.bgmGain)) return; // keep state until the first user gesture unlocks audio
    if (this.mujicaMusicUrl === url) return;
    this.mujicaMusicUrl = url;
    const generation = this.mujicaMusicGeneration = (this.mujicaMusicGeneration || 0) + 1;
    try { this.mujicaMusic?.stop(); } catch { /* already ended */ }
    this.mujicaMusic = null;
    if (this.ctx && this.bgm?.gain) this.bgm.gain.gain.setTargetAtTime(url && !this.mujicaMusicFinished ? 0 : 1, this.ctx.currentTime, 0.12);
    if (!url || !this.ctx || !this.bgmGain || this.mujicaMusicFinished) return;
    if (this.mujicaMusicEpoch == null) this.mujicaMusicEpoch = this.ctx.currentTime;
    this._buffer(url).then((buffer) => {
      if (generation !== this.mujicaMusicGeneration || !this.ctx) return;
      if (!buffer) {
        this.mujicaMusicUrl = null;
        if (this.bgm?.gain) this.bgm.gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.12);
        return;
      }
      const source = this.ctx.createBufferSource();
      const offset = Math.max(0, this.ctx.currentTime - this.mujicaMusicEpoch);
      if (offset >= buffer.duration) {
        this.mujicaMusicFinished = true;
        if (this.bgm?.gain) this.bgm.gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.12);
        return;
      }
      source.buffer = buffer; source.loop = false;
      source.connect(this.bgmGain);
      source.onended = () => {
        try { source.disconnect(); } catch { /* disconnected */ }
        if (generation !== this.mujicaMusicGeneration || this.mujicaMusic !== source) return;
        this.mujicaMusic = null;
        this.mujicaMusicFinished = true;
        if (this.ctx && this.bgm?.gain) this.bgm.gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.12);
      };
      this.mujicaMusic = source;
      // Instrumental and vocal recordings share a timeline; changing the mix must not restart the song.
      source.start(0, offset);
    }).catch((err) => {
      if (generation === this.mujicaMusicGeneration) {
        this.mujicaMusicUrl = null;
        if (this.ctx && this.bgm?.gain) this.bgm.gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.12);
      }
      this._warn('mujica-fever', err);
    });
  }

  /** Reset the unit map for a new field (m.field.units = UnitInfo[]). */
  setFieldUnits(units) {
    this.mujicaStates?.clear();
    this.setMujicaFever(null);
    this.units.clear();
    this.lastAttacker.clear();
    this.consumed.clear();
    // a new field is a new battle: the first operator deployed says 行动出发 again and no cooldown carries over
    this.startVoiceDone = false;
    try { this.voiceGate.reset(); this._stopVoice(); } catch { /* ignore */ }
    for (const u of Array.isArray(units) ? units : []) this._track(u);
  }

  _track(u) {
    if (!u || typeof u !== 'object' || u.id == null) return;
    // UnitInfo.spine is the model id (charId / tokenId / enemyId) — the key of sfx.units; kind/defId pick the
    // official class sounds (operator vs summon vs device)
    this.units.set(u.id, { def: u.spine || u.defId, defId: u.defId ?? null, kind: u.kind ?? null, side: u.side, boss: !!u.boss,
      skillIndex: Number.isInteger(u.skillIndex) ? u.skillIndex : null });
  }

  /** Play a resolved battle sound for a unit event, limited like unit sounds. */
  _playUnitUrl(url, unitKey, volume = 0.8) {
    if (typeof url === 'string') this._play(url, { volume, limited: true, unitKey });
  }

  _playMujicaBank(bank, unitKey, volume = 0.55) {
    const manifest = this.getManifest()?.audio;
    const rows = manifest?.mujicaBankDefs?.[bank];
    if (Array.isArray(rows) && rows.length) {
      const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.weight) || 0), 0);
      let pick = this.random() * total, selected = rows[rows.length - 1];
      for (const row of rows) { pick -= Math.max(0, Number(row.weight) || 0); if (pick < 0) { selected = row; break; } }
      if (selected.url) {
        const lo = Number(selected.minPitch) || 1, hi = Number(selected.maxPitch) || lo;
        const gainLo = Number.isFinite(selected.minVolume) ? selected.minVolume : 1;
        const gainHi = Number.isFinite(selected.maxVolume) ? selected.maxVolume : gainLo;
        this._play(selected.url, { volume: volume * (gainLo + (gainHi - gainLo) * this.random()),
          rate: lo + (hi - lo) * this.random(), limited: true, unitKey });
      }
      return true;
    }
    const values = manifest?.mujicaBanks?.[bank];
    const url = Array.isArray(values) ? values[Math.min(values.length - 1, Math.floor(this.random() * values.length))] : values;
    if (typeof url !== 'string') return false;
    this._playUnitUrl(url, unitKey, volume);
    return true;
  }

  /**
   * React to `b.ev` tuples (DESIGN §8.2).
   * @param {any[]} ev
   */
  handleBattleEvents(ev) {
    if (!Array.isArray(ev)) return;
    if (!this.ctx) {
      for (const e of ev) if (Array.isArray(e) && e[0] === 'fx' && e[1] === 'mujicaFever') this.setMujicaFever(e[4]);
      return;
    }
    try {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      for (const e of ev) {
        if (!Array.isArray(e)) continue;
        const kind = e[0];
        if (kind === 'spawn') { this._track(e[1]); continue; }
        if (kind === 'atk') {
          // a chain bounce: its first id is the previous target, whose attack sound this is not (see header)
          if (CHAIN_KINDS.has(e[3])) { this.lastAttacker.delete(e[2]); continue; }
          const src = this.units.get(e[1]);
          if (!src) continue;
          // The action's sound is separate from a note's spawn/impact or a timed drum strike.
          if (src.def === 'char_4182_oblvns' || src.def === 'char_4185_amoris') {
            this.unit(src.def, 'attack', e[1], src.skillOn ? src.skillIndex : undefined);
            continue;
          }
          // only a hostile attack authors the target's next impact (a heal — an ally aiming at an ally — never does)
          const tgt = this.units.get(e[2]);
          if (tgt && tgt.side !== src.side) this.lastAttacker.set(e[2], { def: src.def, at: now,
            ...(MUJICA_AUDIO_IDS.has(src.def) ? { sourceId: e[1], skillIndex: src.skillOn ? src.skillIndex : undefined } : {}) });
          if (!this.unit(src.def, 'attack', e[1], MUJICA_AUDIO_IDS.has(src.def) && src.skillOn ? src.skillIndex : undefined) && src.side === 'enemy') this.battle('enemyHit', { unitKey: `${e[1]}:atk`, volume: 0.35 });
        } else if (kind === 'dmg') {
          const by = this.lastAttacker.get(e[1]);
          if (!by || !IMPACT_TYPES.has(e[3])) continue;
          this.lastAttacker.delete(e[1]); // one impact per attack
          if (now - by.at <= IMPACT_WINDOW_MS) this.unit(by.def, 'hit', by.sourceId ?? `h${e[1]}`, by.skillIndex);
        } else if (kind === 'heal') {
          this.battle('heal', { unitKey: `heal:${e[1]}`, volume: 0.35 });
        } else if (kind === 'skill') {
          const u = this.units.get(e[1]);
          if (u) u.skillOn = !!e[2];
          if (!e[2]) continue;
          if (u) {
            this.unit(u.def, 'skill', e[1], u.skillIndex ?? undefined);
            // 作战中N: the equipped skill's own slot (0-based; 作战中4 is the fallback of a 4th slot)
            if (unitSoundClass(u) === 'char') {
              const n = Number.isInteger(u.skillIndex) ? Math.min(4, u.skillIndex + 1) : 1;
              this.voice(u.def, `skill${n}`, { unitKey: e[1] });
            }
          }
        } else if (kind === 'engage') {
          // 行动开始: the first attack a unit makes on an enemy (the sim's ENGAGE, official ENCOUNTER_ENEMY, 3 s apart)
          const u = this.units.get(e[1]);
          if (u && unitSoundClass(u) === 'char') this.voice(u.def, 'faceEnemy', { unitKey: e[1] });
        } else if (kind === 'die') {
          const u = this.units.get(e[1]);
          if (!u) continue;
          const consumed = this.consumed.delete(e[1]);
          const m = this.getManifest();
          const url = deathSfxUrl(m, u, { consumed, reason: typeof e[2] === 'string' ? e[2] : null });
          if (!url) continue;
          const own = url === m?.audio?.sfx?.units?.[u.def]?.die;
          const mix = own ? m.audio.sfx.units[u.def].mix?.die : null;
          if (!unitSoundPlays(mix, this.random())) continue;
          this._playUnitUrl(url, own ? `${e[1]}:die` : `die:${e[1]}`, own ? unitGain(0.8, mix) : 0.7);
        } else if (kind === 'leak') {
          // 漏怪: an enemy reached its goal (Battle.leak emits the sim's own EV.LEAK — it is NOT a `die`, so until now a
          // leak was completely silent, for the player's own field and for a 联防 the helpers could not hold alike).
          // The cue is the ORIGINAL Arknights stage alarm — the one an enemy entering the exit plays in any normal
          // stage (manifest `sfx.battle.leak`, bank battle.ON_ENEMY_REACHED_EXIT, file b_ui_alarmenter).
          // `LEAK_SFX_GAP_MS` keeps it to one alarm at a time (the official bank's own maxSoundAllowed 1).
          if (now - (this.lastLeakSfxAt ?? -Infinity) < LEAK_SFX_GAP_MS) continue;
          if (typeof this.getManifest()?.audio?.sfx?.battle?.leak !== 'string') continue;
          this.lastLeakSfxAt = now;
          this.battle('leak', { unitKey: 'leak', volume: 0.85 });
        } else if (kind === 'deploy') {
          const u = this.units.get(e[1]);
          if (!u || u.side === 'enemy') continue;
          const m = this.getManifest();
          const url = deploySfxUrl(m, u);
          // 行动出发 / 部署: the first operator of the battle says the battle-start line, the others their deploy line
          // (a knocked-out operator redeploying in the same battle is one of the others; a summon says nothing).
          // Kept ahead of the deploy-SFX guards below: the voice channel is independent of the unit sound's roll.
          if (unitSoundClass(u) === 'char') {
            if (!this.startVoiceDone) {
              this.startVoiceDone = true;
              if (!this.voice(u.def, 'start')) this.voice(u.def, 'place', { unitKey: e[1] });
            } else this.voice(u.def, 'place', { unitKey: e[1] });
          }
          if (!url) continue;
          const own = url === m?.audio?.sfx?.units?.[u.def]?.born;
          const mix = own ? m.audio.sfx.units[u.def].mix?.born : null;
          if (!unitSoundPlays(mix, this.random())) continue;
          this._playUnitUrl(url, own ? `${e[1]}:born` : 'deploy', own ? unitGain(0.8, mix) : 0.5);
        } else if (kind === 'fx') {
          if (e[1] === 'mujicaFever') { this.setMujicaFever(e[4]); continue; }
          if (e[1] === 'mujicaSound') {
            const ex = e[4], u = this.units.get(ex?.id);
            if (u && MUJICA_AUDIO_IDS.has(u.def) && typeof ex.bank === 'string') this._playMujicaBank(ex.bank, `mujica:${ex.id}:${ex.bank}`);
            continue;
          }
          if (e[1] === 'setForm') {
            const ex = e[4], u = this.units.get(ex?.id);
            if (u && MUJICA_AUDIO_IDS.has(u.def)) {
              if (u.def === 'char_4183_mortis' && ex.form === 'doll' && u.form !== 'doll') this._playMujicaBank('battle.ON_CUSTOM_TRIGGER.mortis_switch_black_fog_audio', `${ex.id}:doll`);
              u.form = ex.form;
            }
          }
          if (e[1] === 'mujicaNote') {
            const ex = e[4];
            if (!ex || !['spawn', 'hit'].includes(ex.state)) continue;
            const event = ex.state === 'spawn' ? 'BORN' : 'HIT';
            let bank = `battle.ON_PROJECTILE_${event}.${ex.projectile}`;
            if (ex.state === 'hit' && /^projectile_chr_oblvns_s1(?:_[1-8])?$/.test(ex.projectile))
              bank = 'battle.ON_CUSTOM_TRIGGER.projectile_chr_oblvns_s1_hit';
            this._playMujicaBank(bank, `mujica:${ex.id}:${ex.state}:${ex.projectile}`);
            continue;
          }
          // a summon used up by its own effect (香槟炸弹 exploding: `consumed`): its impact sound now, no death sound
          const ex = e[4];
          if (!ex || typeof ex !== 'object' || !ex.consumed || ex.id == null) continue;
          const u = this.units.get(ex.id);
          if (!u || u.side === 'enemy') continue;
          this.consumed.add(ex.id);
          if (this.consumed.size > 200) this.consumed.delete(this.consumed.values().next().value);
          this.unit(u.def, 'hit', `${ex.id}:boom`);
        } else if (kind === 'bounty') {
          this.battle('killCoin', { unitKey: 'coin' });
        }
      }
    } catch (err) { this._warn('events', err); }
  }
}

let manifestGetter = () => null;
/** App-wide audio manager. */
export const audio = new AudioManager({ getManifest: () => manifestGetter() });

/**
 * Wire the singleton to the app (called once by main.js): manifest source, settings and store-driven BGM.
 * @param {{ getManifest: () => any, subscribe: (fn: (s:any, prev:any) => void) => () => void, getState: () => any,
 *   selectRoute: (s:any) => string, settings?: { bgm:number, sfx:number, voice:number, muted:boolean } }} deps
 */
export function installAudio(deps) {
  try {
    manifestGetter = typeof deps?.getManifest === 'function' ? deps.getManifest : manifestGetter;
    audio.install();
    if (deps?.settings) audio.setVolumes(deps.settings);
    if (typeof deps?.subscribe === 'function' && typeof deps?.getState === 'function') {
      const sync = (s) => {
        try {
          const pub = s.match?.public ?? null;
          // 伟大封印处决音乐：从处决后一直循环，直到进入下一个 PREP 才交还给阶段 BGM
          if (audio.bgmHold) {
            // 下一个 PREP（或对局结束时）才交还 BGM；SETTLE / 战斗结束暂停期间继续循环
            if (pub && pub.phase !== 'PREP' && pub.phase !== 'RESULT' && pub.phase !== 'LOBBY') return;
            audio.bgmHold = null;
          }
          // 开战 BGM: the round's own track out of bgm.combatAlts (骑士之日 / 无畏者 are fixed per round, not drawn),
          // so every client of a room hears the same one, a mid-fight re-render (or a teammate view) never switches,
          // and the next round moves on by the table. 联防 shares its round ⇒ same key ⇒ the loop keeps playing.
          audio.playBgm(bgmKeyFor(deps.selectRoute(s), pub, combatTrackFor(pub?.round)));
        } catch { /* ignore */ }
      };
      sync(deps.getState());
      return deps.subscribe((s, prev) => {
        if (s.match?.public?.phase !== prev?.match?.public?.phase || s.room !== prev?.room || s.session !== prev?.session
          || s.match?.public?.bossId !== prev?.match?.public?.bossId
          || s.match?.public?.hiddenBossId !== prev?.match?.public?.hiddenBossId) sync(s);
      });
    }
  } catch (err) { console.warn('[audio] install failed', err); }
  return () => {};
}
