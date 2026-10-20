// ui/gameLogic/settings.js — settings defaults and sanitising. Re-exported from ../gameLogic.js.

import { VOICE_LANGS, sanitizeVoiceOverrides } from '../../voicePrefs.js';
export { VOICE_LANGS } from '../../voicePrefs.js';

import { clamp, isObj } from './shared.js';
import { DEFAULT_HOTKEYS, sanitizeHotkeys } from './shortcuts.js';


// ---- settings ------------------------------------------------------------------------------------------------------

/**
 * The operator voice dubs (settings 语音语言): 'cn' 中文 (`audio.voice`, the default) and 'jp' 日本語 (`audio.voiceJp`,
 * falling back to the Chinese line it lacks — public/js/audio.js voiceLine). Not tied to the interface language.
 */


/**
 * The steps of 设置 →「文字大小」 (textSize): the interface text root `--t` of css/theme.css — 'sm' is the design's own
 * sizes (`--t: 1rem`), the others lift the phone's 40 px root by a floor and grow the desktop gently. Text only: the
 * layout root `1rem` (and with it the field camera, the detail card's side and the DOM fallback board) never moves.
 */
export const TEXT_SIZES = Object.freeze(['sm', 'md', 'lg', 'xl']);

/** keys: the in-match shortcuts' key map (ui/gameLogic/shortcuts.js; settings → 快捷键). voiceLang: VOICE_LANGS.
 *  textSize: TEXT_SIZES (css/theme.css `--t`, applied by ui/settings.js applyTextSize). */
export const DEFAULT_SETTINGS = Object.freeze({ bgm: 0.6, sfx: 0.8, voice: 0.8, voiceLang: 'cn', voiceOverrides: Object.freeze({}), muted: false, damageNumbers: true, officialDamageNumbers: false, ammoCount: false, mysticEnergy: false, quality: 'high', officialFx: 'auto', textSize: 'sm', damageScale: 1, keys: DEFAULT_HOTKEYS });
/** 伤害数字大小：0.7（小）~ 1.6（大）的连续倍率，默认 1（见 render/fx/numbers.js 的 numScale）。 */
export const DAMAGE_SCALE_MIN = 0.7;
export const DAMAGE_SCALE_MAX = 1.6;
// 设置「官方特效」的可选值（0.3.0 render/vfx；由 DSH 2026-10-16 从上游移植）。
export const OFFICIAL_FX_MODES = Object.freeze(['auto', 'off', 'lite', 'full']);
const QUALITIES = ['high', 'medium', 'low'];

/**
 * Sanitize persisted settings.
 * @param {any} raw
 * @returns {{ bgm: number, sfx: number, voice: number, voiceLang: 'cn'|'jp', voiceOverrides: Record<string, string>, muted: boolean, damageNumbers: boolean, officialDamageNumbers: boolean, quality: 'high'|'medium'|'low',
 *   textSize: 'sm'|'md'|'lg'|'xl', keys: Record<'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready', string> }}
 */
export function sanitizeSettings(raw) {
  const r = isObj(raw) ? raw : {};
  const vol = (v, d) => (Number.isFinite(v) ? clamp(Math.round(v * 100) / 100, 0, 1) : d);
  return {
    bgm: vol(r.bgm, DEFAULT_SETTINGS.bgm),
    sfx: vol(r.sfx, DEFAULT_SETTINGS.sfx),
    voice: vol(r.voice, DEFAULT_SETTINGS.voice),
    voiceLang: VOICE_LANGS.includes(r.voiceLang) ? r.voiceLang : DEFAULT_SETTINGS.voiceLang,
    voiceOverrides: sanitizeVoiceOverrides(r.voiceOverrides),
    muted: typeof r.muted === 'boolean' ? r.muted : DEFAULT_SETTINGS.muted,
    damageNumbers: typeof r.damageNumbers === 'boolean' ? r.damageNumbers : DEFAULT_SETTINGS.damageNumbers,
    officialDamageNumbers: typeof r.officialDamageNumbers === 'boolean' ? r.officialDamageNumbers : false,
    // 设置「弹药数量」(0.3.0, PR #552)：弹药条下方显示 剩余/总数；官方 HUD 没有这个数字，默认关
    ammoCount: typeof r.ammoCount === 'boolean' ? r.ammoCount : false,
    // 设置「秘术师能量」(0.3.0, PR #636)：秘术师血条下方显示 储存/上限；官方用干员身上的特效表示
    mysticEnergy: typeof r.mysticEnergy === 'boolean' ? r.mysticEnergy : false,
    quality: QUALITIES.includes(r.quality) ? r.quality : DEFAULT_SETTINGS.quality,
    officialFx: OFFICIAL_FX_MODES.includes(r.officialFx) ? r.officialFx : DEFAULT_SETTINGS.officialFx,
    textSize: TEXT_SIZES.includes(r.textSize) ? r.textSize : DEFAULT_SETTINGS.textSize,
    // ★ 设置「商店大小」(用户 2026-10-17，有玩家反馈商店 UI 太小)：
    //   0.8 ~ 1.6 的倍率，默认 1。由 ui/settings.js 的 applyShopScale 写成 `--shop-scale`，
    //   css/screens/game-shop.css 的 `.shopbar { zoom: var(--shop-scale) }` 消费它。
    shopScale: Number.isFinite(Number(r.shopScale)) ? clamp(Number(r.shopScale), 0.8, 1.6) : 1,
    // ★ 设置「伤害数字大小」(2026-10-18)：0.7 ~ 1.6 的连续倍率，默认 1。
    //   由 ui/settings.js 的滑块写入，渲染侧在 render/fx/numbers.js 的 numScale 里乘上去。
    damageScale: r.damageScale == null || r.damageScale === '' || !Number.isFinite(Number(r.damageScale))
      ? 1
      : clamp(Number(r.damageScale), DAMAGE_SCALE_MIN, DAMAGE_SCALE_MAX),
    keys: sanitizeHotkeys(r.keys),
    sifengBgm: r.sifengBgm === true,
    emoteSfx: r.emoteSfx !== false,
    emoteSfxVolume: Number.isFinite(Number(r.emoteSfxVolume)) ? Math.max(0, Math.min(1.5, Number(r.emoteSfxVolume))) : 1,
    bossRainlove: ['off', 'on', 'sifeng'].includes(r.bossRainlove) ? r.bossRainlove : 'off',
  };
}
