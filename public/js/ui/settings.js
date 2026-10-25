// Player settings (BGM/SFX/voice volume, mute, damage numbers, render quality, 文字大小, the shortcut keys): a tiny observable
// store persisted in localStorage (`sp.pref.settings`), applied to the audio manager on every change, plus
// the settings modal — which also holds the language switch (ui/lang.js; kept apart in `sp.pref.lang`; under it a note
// while the current language's pack is a machine translation, `_meta.machineTranslated`) and the 快捷键
// section that rebinds the in-match shortcuts (the key map: ui/gameLogic/shortcuts.js; the community request
// 「快捷键可不可以自己设置」, the owner's decision of 2026-10-07).

import { useLayoutEffect, useRef, useState, useEffect } from '../../vendor/hooks.module.js';
import { fxAvailable } from '../render/vfx/available.js';
import { resolveOfficialFx } from '../render/vfx/tier.js';

import { html, Modal, Button, Icon, MicroLabel } from './components.js';
import { createStore, useStore, loadPref, savePref, store } from '../store.js';
import { sanitizeSettings, HOTKEY_ACTIONS, DEFAULT_HOTKEYS, hotkeyLabel, rebindHotkey, isDefaultHotkeys, captureHotkey, TEXT_SIZES } from './gameLogic.js';
import { audio } from '../audio.js';
import { errorCount, currentBattle, diagnosticsText } from '../diag.js';
import { copyText } from './clipboard.js';
// 异形屏适配 (ui/screenFit.js): imported here, ahead of main.js's first render, so the stored offsets are on at boot
import { ScreenFitSection } from './screenFit.js';
// ★ 2026-10-15（新界面包 20261014 的接口）：新版 lobby.js / room.js 从【本文件】
//   `import { SettingsButton } from '../ui/settings.js'`，而这个按钮的实现原本在
//   `ui/settingsButton.js`（旧包给的 ✗ 路径不同）。这里转发一下即可，不复制实现。
export { SettingsButton } from './settingsButton.js';
import { openGuide } from './guide.js';
import { detectFeatures } from './device.js';
import { net } from '../net.js';
import { toast, toastError } from './toasts.js';
import { LangToggle, machineTranslationNote } from './lang.js';
import { t, tc, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Settings store: { bgm, sfx, voice, muted, damageNumbers, quality, textSize, keys }. */
export const settingsStore = createStore(sanitizeSettings(loadPref('settings', null)));

/**
 * 设置 →「文字大小」: put the step on <html data-text> — css/theme.css turns it into the text root `--t`
 * (`:root[data-text="md"] { --t: … }`), which every readable font-size reads; no layout value does. The attribute
 * (not an inline style) keeps the default in the stylesheet: without it — no JavaScript, an old saved profile, a
 * value a future version dropped — the page is the design's own sizes. Values outside TEXT_SIZES fall back to 小.
 * @param {'sm'|'md'|'lg'|'xl'} v
 */
export function applyTextSize(v) {
  const el = globalThis.document?.documentElement;
  if (el) el.dataset.text = TEXT_SIZES.includes(v) ? v : 'sm';
}

settingsStore.subscribe((s) => {
  savePref('settings', sanitizeSettings(s));
  audio.setVolumes(s);
  applyTextSize(s.textSize);
  applyShopScale(s.shopScale);
});
audio.setVolumes(settingsStore.get());
// before the first render (main.js boot renders after its imports ran): the stored step is on screen without a flash
applyTextSize(settingsStore.get().textSize);
applyShopScale(settingsStore.get().shopScale);

/**
 * 设置 →「商店大小」(用户 2026-10-17：有玩家反馈商店 UI 太小)：把倍率写成 `<html>` 上的 `--shop-scale`，
 * 由 `css/screens/game-shop.css` 的 `.shopbar { zoom: var(--shop-scale) }` 消费。
 * 用 CSS 变量而不是 data 属性：这是连续倍率，不是几个档位。越界值一律落回 1。
 * @param {number} v 0.8 ~ 1.6
 */
export function applyShopScale(v) {
  const el = globalThis.document?.documentElement;
  const n = Number(v);
  if (!el) return;
  el.style.setProperty('--shop-scale', String(Number.isFinite(n) ? Math.min(1.6, Math.max(0.8, n)) : 1));
}

/** @param {Partial<ReturnType<typeof sanitizeSettings>>} patch */
export function updateSettings(patch) {
  settingsStore.set(sanitizeSettings({ ...settingsStore.get(), ...patch }));
}

/** Preact hook: current settings. */
export const useSettings = () => useStore((s) => s, Object.is, settingsStore);

/**
 * The label of the key a rebindable shortcut has right now ('R', 'Space' …) — the HUD's key hints (shop bar, ready /
 * pause, underframe). Read at render: the game screen re-renders when the settings dialog closes.
 * @param {'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready'} action
 */
export const hotkeyLabelOf = (action) => hotkeyLabel(settingsStore.get().keys?.[action]);

function Slider({ label, micro, value, onInput, icon }) {
  const pct = Math.round(value * 100);
  return html`<label class="set-row">
    <span class="set-row__label"><${Icon} name=${icon} />${label}<${MicroLabel}>${micro}<//></span>
    <input class="set-range" type="range" min="0" max="100" step="5" value=${pct} style=${`--pct:${pct}%`}
      onInput=${(e) => onInput(Number(e.currentTarget.value) / 100)} />
    <span class="set-row__val num">${pct}</span>
  </label>`;
}

function Toggle({ label, micro, value, onChange }) {
  return html`<div class="set-row">
    <span class="set-row__label">${label}<${MicroLabel}>${micro}<//></span>
    <button type="button" class=${`set-toggle${value ? ' is-on' : ''}`} role="switch" aria-checked=${value ? 'true' : 'false'}
      onClick=${() => onChange(!value)}><i></i><span>${value ? tc('toggle', '开启') : tc('toggle', '关闭')}</span></button>
  </div>`;
}

const QUALITY = [['high', N_('高')], ['medium', N_('中')], ['low', N_('低')]];

/**
 * 伤害数字的三种口径（用户 2026-10-14）：关 / 标准（本项目自己的跳动合并数字）/ 官方（只画官方的红色整数）。
 * `officialDamageNumbers` 原来是个**没有界面入口的隐藏项**，一旦被写成 true 就从界面上关不掉、表现为
 * 「完全没有伤害数字」（numbers.js 在该模式下只画 sim 标记 'r' 的那一发）—— 所以这里做成三选一，
 * 三个状态都能到达，也顺手把那个坑填了。
 */
// ★ 第一项用「不显示」而不是「关闭」：i18n 里「关闭」已被译成 "Close"（关闭对话框），语义不同。
const DMG_NUMBERS = [['off', N_('不显示')], ['normal', N_('标准')], ['official', N_('官方')]];
/** 设置 → 当前是三种口径里的哪一种。 */
const dmgModeOf = (s) => (s.damageNumbers === false ? 'off' : (s.officialDamageNumbers ? 'official' : 'normal'));
/** 三段控件 → 需要写进设置的那几个键。 */
const dmgPatchOf = (id) => (id === 'off'
  ? { damageNumbers: false }
  : { damageNumbers: true, officialDamageNumbers: id === 'official' });
/**
 * 干员语音的语言:官方日语配音(默认)或中文。两套音频都在包里(`public/assets/audio/voice/{jp,cn}`),
 * `data/assets.json` 的 `audio.voice` 也按语言分了层 —— 选中即时生效,下一句台词就走新的一包。
 */
const VOICE_LANG = [['jp', N_('日语（默认）')], ['cn', N_('中文')]];
/**
 * 文字大小: one step of TEXT_SIZES (ui/gameLogic/settings.js) with its label — 小 is the design's own sizes, the others
 * raise the text root `--t` (css/theme.css) and with it every readable font-size; the board and the HUD's boxes stay.
 */
const TEXT_SCALES = [['sm', N_('小')], ['md', N_('中')], ['lg', N_('大')], ['xl', N_('特大')]];
// 设置「官方特效」的分档标签（0.3.0；DSH 从上游移植）。
const OFFICIAL_FX_LABELS = Object.freeze([['off', '关'], ['lite', '精简'], ['full', '完整']]);
/**
 * Boss战雨爱 (owner's request): 隐秘核心 那一场 boss 战的 BGM 三档 — 关 (official boss track) / 开启 (正常版雨爱) /
 * 司凤版 (司凤版雨爱). audio.js bossRainloveKey decides; nothing outside PHASE.HIDDEN_CORE is affected.
 */
const BOSS_RAINLOVE = [['off', N_('关')], ['on', N_('开启')], ['sifeng', N_('司凤版')]];
/** The rebindable shortcuts' names (msgids), by action. */
const HOTKEY_NAMES = { refresh: N_('刷新商店'), freeze: N_('冻结 / 解冻商店'), levelUp: N_('升级调度中心'), retreat: N_('撤退选中干员'),
  sell: N_('出售选中干员'), ready: N_('准备就绪 / 暂停（独立模拟）') };

/**
 * 快捷键: each shortcut with its key. Click its key (or Enter / Space on it) and press the new one: Esc cancels (the
 * dialog stays open), Tab leaves, a key held with Ctrl / Alt / ⌘ or one the interface keeps is refused, a key another
 * shortcut has is swapped — the line under the list says what happened; 恢复默认 restores the keys of 0.1.4. Esc
 * (cancel / close) is fixed. On a touch-only device the section says the keys need a keyboard and folds the list (an
 * attached keyboard still uses it).
 * @param {{ keys: Record<string, string>, touchUi: boolean }} props
 */
function HotkeySection({ keys, touchUi }) {
  const [waiting, setWaiting] = useState(null); // the action waiting for its new key
  const [note, setNote] = useState(null);       // { text, warn }: the result line
  // a layout effect: the key listener is on as soon as the key shows that it waits (an Esc right after the click must
  // end the wait, never reach the dialog's own Esc)
  useLayoutEffect(() => {
    if (!waiting) return undefined;
    const name = t(HOTKEY_NAMES[waiting]);
    const onKey = (e) => {
      const r = captureHotkey(e);
      if (r.kind === 'leave') { setWaiting(null); return; } // Tab: the focus moves on
      // ahead of the dialog's own Esc (it stays open), a focused button's Enter / Space and every other key handler
      e.preventDefault();
      e.stopImmediatePropagation();
      if (r.kind === 'ignore') return;
      const cur = settingsStore.get().keys;
      if (r.kind === 'cancel') {
        setWaiting(null);
        setNote({ text: t('已取消，「{action}」仍是 {key}', { action: name, key: hotkeyLabel(cur[waiting]) }) });
        return;
      }
      if (r.kind === 'refuse') {
        setNote({ warn: true, text: r.reason === 'modifier' ? t('快捷键只能是单个按键，不能搭配 Ctrl、Alt 或 ⌘')
          : t('{key} 不能设为快捷键：Esc、Tab、Enter、方向键和功能键留给界面使用', { key: r.name }) });
        return;
      }
      const res = rebindHotkey(cur, waiting, r.code);
      updateSettings({ keys: res.keys });
      setWaiting(null);
      const key = hotkeyLabel(r.code);
      setNote({ text: res.swapped
        ? t('「{action}」已改为 {key}；「{other}」原来用 {key}，已换成 {old}', { action: name, key, other: t(HOTKEY_NAMES[res.swapped]), old: hotkeyLabel(res.keys[res.swapped]) })
        : t('「{action}」已改为 {key}', { action: name, key }) });
    };
    // a press anywhere but the waiting key ends the wait (another key starts its own)
    const onDown = (e) => { if (!(e.target instanceof Element) || !e.target.closest('.set-key.is-waiting')) setWaiting(null); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, [waiting]);

  const status = note ? note.text : waiting ? t('请按下「{action}」的新按键（Esc 取消）', { action: t(HOTKEY_NAMES[waiting]) }) : '';
  const list = html`<ul class="set-keys__list">
    ${HOTKEY_ACTIONS.map((a) => {
      const on = waiting === a;
      const label = hotkeyLabel(keys?.[a]);
      return html`<li key=${a} class="set-keys__row">
        <span class="set-keys__name">${t(HOTKEY_NAMES[a])}</span>
        <button type="button" class=${cx('set-key', on && 'is-waiting')} data-action=${a} aria-pressed=${on ? 'true' : 'false'}
          aria-label=${t('更改「{action}」的快捷键（当前：{key}）', { action: t(HOTKEY_NAMES[a]), key: label })}
          onClick=${() => { setNote(null); setWaiting((w) => (w === a ? null : a)); }}>
          ${on ? html`<span class="set-key__wait">${t('按下新按键…')}</span>` : html`<kbd>${label}</kbd>`}
        </button>
      </li>`;
    })}
    <li class="set-keys__row is-fixed">
      <span class="set-keys__name">${t('取消 / 关闭')}</span>
      <span class="set-key is-fixed"><kbd>Esc</kbd><small>${t('不可更改')}</small></span>
    </li>
  </ul>
  <p class=${cx('set-keys__note', note?.warn && 'is-warn')} role="status" aria-live="polite">${status}</p>`;
  return html`<section class="set-keys" aria-labelledby="set-keys-title">
    <div class="set-keys__head">
      <span class="set-row__label" id="set-keys-title">${t('快捷键')}<${MicroLabel}>HOTKEYS<//></span>
      <${Button} variant="ghost" size="sm" icon="refresh" class="set-keys__reset" disabled=${isDefaultHotkeys(keys)}
        onClick=${() => { setWaiting(null); updateSettings({ keys: DEFAULT_HOTKEYS }); setNote({ text: t('已恢复默认快捷键') }); }}>${t('恢复默认')}<//>
    </div>
    ${touchUi ? html`<p class="set-hint">${t('快捷键需要实体键盘；触屏设备连接键盘后可用')}</p>
      <details class="set-keys__more"><summary>${t('查看 / 更改快捷键')}</summary>${list}</details>` : list}
  </section>`;
}

/** Where a report goes: the upstream issue tracker (shown as text the player can select; a link may open nothing). */
export const ISSUES_URL = 'https://github.com/sganggs/Stronghold-Protocol/issues';

/**
 * 问题反馈: copy the diagnostics of this page (diag.js) for a GitHub issue — the errors recorded since the page opened,
 * this browser and device, where the player is, and, switched on by default while a battle is on screen, that battle's
 * spec (the dev tools replay it). Player names, the room code and the token are replaced; nothing is uploaded. Laid out
 * like 快捷键 above it (a head with its button, a hint, the result line); the battle switch is the settings' Toggle, and
 * when the clipboard refuses (some in-app browsers), the report is shown selected in a box styled like 干员调配's 导出.
 */
/** The result line of 复制诊断信息, by outcome (msgids: translated when shown, so a language switch reaches it). */
const DIAG_NOTES = { copied: N_('已复制诊断信息，可以粘贴到 GitHub issue 中'), refused: N_('无法写入剪贴板，请手动复制下面的内容') };

function DiagSection() {
  const [attach, setAttach] = useState(true);
  const [note, setNote] = useState(null);       // 'copied' | 'refused' | null: the result line
  const [manual, setManual] = useState(null);   // the report, when the clipboard refused it
  const boxRef = useRef(null);
  // the box opens selected for a manual copy, scrolled to its first line (select() leaves it at the end)
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (manual && el) { el.focus(); el.select(); el.scrollTop = 0; }
  }, [manual]);
  const n = errorCount();
  const battle = currentBattle();
  const copy = async () => {
    const text = diagnosticsText({ state: store.get(), settings: settingsStore.get(), attachBattle: attach && !!battle });
    const ok = await copyText(text);
    setManual(ok ? null : text);
    setNote(ok ? 'copied' : 'refused');
  };
  return html`<section class="set-diag" aria-labelledby="set-diag-title">
    <div class="set-keys__head">
      <span class="set-row__label" id="set-diag-title">${t('问题反馈')}<${MicroLabel}>DIAGNOSTICS<//></span>
      <${Button} variant="ghost" size="sm" icon="copy" class="set-diag__copy" data-testid="diag-copy" onClick=${copy}>${t('复制诊断信息')}<//>
    </div>
    <p class="set-hint">${t('遇到问题时，复制诊断信息并粘贴到 GitHub issue 中，开发者就能看到出错时的情况。诊断信息只在本机生成，不会自动上传；玩家名和房间号会被替换。')}</p>
    <div class="set-diag__meta">
      <span class="set-diag__stat">${t('已记录的错误')}<b class=${cx('set-diag__count num', n > 0 && 'is-warn')} data-testid="diag-count">${n}</b></span>
      <span class="set-diag__url">${ISSUES_URL.replace(/^https:\/\//, '')}</span>
    </div>
    ${battle ? html`<${Toggle} label=${t('附上本场战斗')} micro="BATTLE DATA" value=${attach} onChange=${setAttach} />
      <p class="set-hint set-diag__battle-hint">${t('开发者可以用附上的战斗数据重现这场战斗。')}</p>` : null}
    ${note ? html`<p class=${cx('set-keys__note', note === 'refused' && 'is-warn')} role="status" aria-live="polite">${t(DIAG_NOTES[note])}</p>` : null}
    ${manual ? html`<textarea ref=${boxRef} class="set-diag__text" data-testid="diag-text" spellcheck=${false} readOnly
      aria-label=${t('诊断信息')} value=${manual}></textarea>` : null}
  </section>`;
}

/**
 * 房间人数上限 (the 100-seat build's unlock): a co-op room starts with `humanCap` (40) human seats — the rest exist
 * and are AI-only until the host enters the unlock code, which the SERVER verifies (room.unlock), so the code never
 * ships in the bundle. Moved here from the room screen's bottom bar (the bar is already tight at 40 seats); the bar
 * keeps only the 「真人 N/40」 count. Renders nothing outside a room, or on a solo room (no AI seats to raise past).
 */
function RoomCapSection({ busy, setBusy }) {
  const room = useStore((s) => s.room);
  const myId = useStore((s) => s.me.playerId);
  const [code, setCode] = useState('');
  if (!room || room.mode === 'solo') return null;
  const humanCap = room.humanCap ?? 40;
  const maxSeats = room.maxSeats ?? 100;
  const unlocked = room.unlocked === true;
  const isHost = room.hostId != null && room.hostId === myId;
  const unlock = async (v) => {
    if (busy) return;
    setBusy('roomcap');
    try { await net.request('room.unlock', { code: v }); } catch (err) { toastError(err); } finally { setBusy(null); }
  };
  const submit = (e) => {
    e.preventDefault();
    const v = code.trim();
    if (!v) return;
    unlock(v);
    setCode('');
  };
  return html`<section class="set-roomcap" aria-labelledby="set-roomcap-title">
    <div class="set-keys__head">
      <span class="set-row__label" id="set-roomcap-title">${t('房间人数上限')}<${MicroLabel}>ROOM CAP<//></span>
      ${unlocked
        ? html`<span class="set-roomcap__on"><${Icon} name="check" />${t('已解锁 {n} 人同盟', { n: maxSeats })}</span>`
        : null}
    </div>
    <p class="set-hint">${unlocked
      ? t('本同盟已解锁：最多可有 {max} 名真人博士，其余位置仍可放 AI 队友。', { max: maxSeats })
      : t('同盟房间默认 {cap} 名真人博士，其余 {rest} 个位置只供 AI 队友使用；创建者输入解锁码后可开放到 {max} 人。', { cap: humanCap, rest: Math.max(0, maxSeats - humanCap), max: maxSeats })}</p>
    ${unlocked ? null : html`<form class="set-roomcap__form" onSubmit=${submit}>
      <input class="unlock__code num" type="text" value=${code} placeholder=${t('输入解锁码')}
        aria-label=${t('解锁码')} autocomplete="off" spellcheck=${false} maxlength=${64}
        disabled=${!isHost}
        onInput=${(e) => setCode(e.currentTarget.value)} />
      <${Button} size="sm" variant="secondary" icon="key" type="submit" disabled=${busy || !isHost || !code.trim()}>
        ${t('解锁 {n} 人', { n: maxSeats })}<//>
      ${isHost ? null : html`<span class="set-roomcap__hint">${t('由创建者设置')}</span>`}
    </form>`}
  </section>`;
}

/**
 * 外援测试模式 (设置 → 「外援测试模式」): the local cheat switch — 资金不减 + 商店只刷自选编队的外援 — locked behind the
 * same server-verified unlock code as the room cap (`room.testMode`; the code is checked on the SERVER and never ships
 * in the bundle). Per PLAYER, so only the one who turns it on is affected.
 *
 * The unlocked/on state comes back from the server in `room.state` (its own seat row), never from a client-side secret:
 * once the session has accepted the code, later flips send only `on` and this row renders as a plain toggle.
 * Renders nothing outside a room — there is no seat to hang the flag on. Reuses `.set-roomcap`'s look (an unlock box).
 */
function TestModeSection({ busy, setBusy }) {
  const room = useStore((s) => s.room);
  const myId = useStore((s) => s.me.playerId);
  const [code, setCode] = useState('');
  if (!room) return null;
  const mine = Array.isArray(room.seats) ? room.seats.find((s) => s && s.playerId === myId) : null;
  if (!mine) return null;
  const unlocked = mine.testUnlocked === true;
  const on = mine.testMode === true;
  const send = async (payload) => {
    if (busy) return;
    setBusy('testmode');
    try { await net.request('room.testMode', payload); } catch (err) { toastError(err); } finally { setBusy(null); }
  };
  const submit = (e) => {
    e.preventDefault();
    const v = code.trim();
    if (!v) return;
    send({ code: v, on: true });
    setCode('');
  };
  return html`<section class="set-roomcap" aria-labelledby="set-testmode-title">
    <div class="set-keys__head">
      <span class="set-row__label" id="set-testmode-title">${t('外援测试模式')}<${MicroLabel}>TEST MODE<//></span>
      ${unlocked ? html`<span class="set-roomcap__on"><${Icon} name="check" />${t('已解锁')}</span>` : null}
    </div>
    <p class="set-hint">${t('开启后本局资金不减，商店只刷你自选编队里的外援（其余干员不入池）。仅供本地测试。')}</p>
    ${unlocked
      ? html`<${Toggle} label=${t('外援测试模式')} micro="TEST MODE" value=${on} onChange=${(v) => send({ on: v })} />`
      : html`<form class="set-roomcap__form" onSubmit=${submit}>
          <input class="unlock__code num" type="text" value=${code} placeholder=${t('输入解锁码')}
            aria-label=${t('解锁码')} autocomplete="off" spellcheck=${false} maxlength=${64}
            onInput=${(e) => setCode(e.currentTarget.value)} />
          <${Button} size="sm" variant="secondary" icon="key" type="submit" disabled=${busy || !code.trim()}>
            ${t('解锁')}<//>
        </form>`}
  </section>`;
}

/**
 * Settings modal.
 * @param {{ open: boolean, onClose: Function }} props
 */
export function SettingsModal({ open, onClose }) {
  const s = useSettings();
  const [tested, setTested] = useState(false);
  const [touchUi] = useState(() => detectFeatures().coarse && !detectFeatures().fine);
  // 官方特效：只有服主从本地客户端提取过特效（/data/local-fx.json 有 prefabs）时才显示这一行。
  const [fxOk, setFxOk] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    fxAvailable(null).then((ok) => { if (live) setFxOk(!!ok); }, () => {});
    return () => { live = false; };
  }, [open]);
  const fxTier = resolveOfficialFx(s.officialFx, true);

  // 房间人数上限's own request flag: the modal is not inside the room screen, so it cannot share that screen's `busy`
  const [roomCapBusy, setRoomCapBusy] = useState(null);
  const mtNote = machineTranslationNote(); // a pack marked as machine translation says so under the switch
  return html`<${Modal} open=${open} onClose=${onClose} title=${t('设置')} micro="SETTINGS" width="7.4rem"
    actions=${html`<${Button} variant="secondary" icon="book" class="set-guide" onClick=${() => openGuide(0)}>${t('玩法说明')}<//>
      <${Button} variant="primary" icon="check" onClick=${onClose}>${t('完成')}<//>`}>
    <div class="set-list">
      <div class="set-row">
        <span class="set-row__label">${t('语言')}<${MicroLabel}>LANGUAGE<//></span>
        <${LangToggle} class="set-lang" />
      </div>
      ${mtNote ? html`<p class="set-hint set-lang-note" data-testid="lang-mt-note">${mtNote}</p>` : null}
      <${Slider} label=${t('背景音乐')} micro="BGM" icon="play" value=${s.bgm} onInput=${(v) => updateSettings({ bgm: v })} />
      <${Slider} label=${t('干员语音')} micro="VOICE" icon="mic" value=${s.voice} onInput=${(v) => updateSettings({ voice: v })} />
      <div class="set-row">
        <span class="set-row__label">${t('语音语言')}<${MicroLabel}>VOICE DUB<//></span>
        <div class="set-seg" role="radiogroup">
          ${VOICE_LANG.map(([id, label]) => {
            const on = (s.voiceLang || 'jp') === id;
            return html`<button key=${id} type="button" role="radio" aria-checked=${on ? 'true' : 'false'}
              class=${on ? 'is-on' : ''}
              onClick=${() => { updateSettings({ voiceLang: id }); audio.setVoiceLang(id); }}>${t(label)}</button>`;
          })}
        </div>
      </div>
      <${Slider} label=${t('音效')} micro="SFX" icon="signal" value=${s.sfx}
        onInput=${(v) => { updateSettings({ sfx: v }); if (!tested) { setTested(true); setTimeout(() => setTested(false), 400); audio.sfx('click'); } }} />
      <${Toggle} label=${t('司凤版大厅BGM')} micro="SIFENG LOBBY BGM" value=${s.sifengBgm} onChange=${(v) => updateSettings({ sifengBgm: v })} />
      <${Slider} label=${t('商店大小')} micro="SHOP SCALE" icon="coin"
        value=${(Math.min(1.6, Math.max(0.8, Number(s.shopScale) || 1)) - 0.8) / 0.8}
        onInput=${(v) => updateSettings({ shopScale: Math.round((0.8 + v * 0.8) * 20) / 20 })} />
      <${Toggle} label=${t('司凤表情音效')} micro="SIFENG EMOTE SFX" value=${s.emoteSfx} onChange=${(v) => updateSettings({ emoteSfx: v })} />
<${Toggle} label=${t('全屏时保持屏幕常亮')} micro="SCREEN WAKE LOCK" value=${s.fullscreenWakeLock} onChange=${(v) => updateSettings({ fullscreenWakeLock: v })} />
      <${Slider} label=${t('司凤表情音量')} micro="SIFENG EMOTE VOLUME" icon="play" value=${s.emoteSfxVolume} onInput=${(v) => updateSettings({ emoteSfxVolume: v })} />
      <div class=${s.bossRainlove === 'sifeng' ? 'set-row set-row--vow' : 'set-row'}>
        <span class="set-row__label">${t('Boss战雨爱')}<${MicroLabel}>BOSS BGM<//></span>
        <div class="set-seg" role="radiogroup" aria-label=${t('Boss战雨爱')} data-testid="boss-rainlove">
          ${BOSS_RAINLOVE.map(([id, label]) => html`<button key=${id} type="button" role="radio" aria-checked=${s.bossRainlove === id ? 'true' : 'false'}
            class=${s.bossRainlove === id ? 'is-on' : ''} onClick=${() => updateSettings({ bossRainlove: id })}>${t(label)}</button>`)}
        </div>
        ${s.bossRainlove === 'sifeng' ? html`<figure class="set-vow" aria-hidden="true">
          <img class="set-vow__pic" src="/assets/local/ui/settings/token_vow.png" alt="" />
          <figcaption class="set-vow__cap">${t('我以消耗的token十倍返还于我为束缚')}<br />${t('让你们所有人听到这些歌曲')}</figcaption>
        </figure>` : null}
      </div>
      <p class=${s.bossRainlove === 'sifeng' ? 'set-hint set-hint--vow' : 'set-hint'}>${t('只在隐秘核心的 boss 战里替换背景音乐，其余战斗与主菜单不受影响。')}</p>
      <${Toggle} label=${t('静音')} micro="MUTE" value=${s.muted} onChange=${(v) => updateSettings({ muted: v })} />
      <div class="set-row">
        <span class="set-row__label">${t('伤害数字')}<${MicroLabel}>DAMAGE NUMBERS<//></span>
        <div class="set-seg" role="radiogroup" aria-label=${t('伤害数字')} data-testid="damage-numbers">
          ${DMG_NUMBERS.map(([id, label]) => html`<button key=${id} type="button" role="radio" aria-checked=${dmgModeOf(s) === id ? 'true' : 'false'}
            class=${dmgModeOf(s) === id ? 'is-on' : ''} onClick=${() => updateSettings(dmgPatchOf(id))}>${t(label)}</button>`)}
        </div>
      </div>
      <p class="set-hint">${t('标准：本项目自己的伤害数字（会跳动、同单位同类型自动合并）。官方：只显示官方的红色整数。')}</p>
      ${''/* ★ 2026-10-18（用户）：伤害数字大小 —— 连续倍率滑块，0.7（小）~ 1.6（大），默认 1 */}
      <${Slider} label=${t('伤害数字大小')} micro="DAMAGE NUMBER SIZE" icon="attack"
        value=${(Math.min(1.6, Math.max(0.7, Number(s.damageScale) || 1)) - 0.7) / 0.9}
        onInput=${(v) => updateSettings({ damageScale: Math.round((0.7 + v * 0.9) * 20) / 20 })} />
      <p class="set-hint">${t('只影响伤害/治疗飘字的大小，不影响其它界面；拖动后立即生效。')}</p>
      <${Toggle} label=${t('弹药数量')} micro="AMMO COUNT" value=${s.ammoCount} onChange=${(v) => updateSettings({ ammoCount: v })} />
      <p class="set-hint">${t('弹药类技能开启时，在弹药条下方显示剩余弹药 / 总弹药数（如 13/14）。官方界面没有这个数字。')}</p>
      <${Toggle} label=${t('秘术师能量')} micro="STORED ENERGY" value=${s.mysticEnergy} onChange=${(v) => updateSettings({ mysticEnergy: v })} />
      <p class="set-hint">${t('在秘术师的血条下方显示储存的攻击能量 / 上限（如 2/3）。官方用干员身上的特效表示，没有这个数字。')}</p>
      <div class="set-row">
        <span class="set-row__label">${t('画面质量')}<${MicroLabel}>QUALITY<//></span>
        <div class="set-seg" role="radiogroup">
          ${QUALITY.map(([id, label]) => html`<button key=${id} type="button" role="radio" aria-checked=${s.quality === id ? 'true' : 'false'}
            class=${s.quality === id ? 'is-on' : ''} onClick=${() => updateSettings({ quality: id })}>${t(label)}</button>`)}
        </div>
      </div>
      ${fxOk ? html`<div class="set-row" data-testid="official-fx">
        <span class="set-row__label">${t('官方特效')}<${MicroLabel}>OFFICIAL FX<//></span>
        <div class="set-seg" role="radiogroup" aria-label=${t('官方特效')}>
          ${OFFICIAL_FX_LABELS.map(([id, label]) => html`<button key=${id} type="button" role="radio" aria-checked=${fxTier === id ? 'true' : 'false'}
            class=${fxTier === id ? 'is-on' : ''} onClick=${() => updateSettings({ officialFx: id })}>${label}</button>`)}
        </div>
      </div>
      <p class="set-hint">${t('使用服主从自己的游戏客户端提取的官方战斗特效（普攻、弹道、命中、状态、阵亡、部署，干员、召唤物和敌人的技能与天赋）。精简：半分辨率贴图与更少的粒子上限。')}</p>` : null}
      <div class="set-row">
        <span class="set-row__label">${t('文字大小')}<${MicroLabel}>TEXT SIZE<//></span>
        <div class="set-seg set-textsize" role="radiogroup" aria-label=${t('文字大小')} data-testid="text-size">
          ${TEXT_SCALES.map(([id, label]) => html`<button key=${id} type="button" role="radio" aria-checked=${s.textSize === id ? 'true' : 'false'}
            class=${s.textSize === id ? 'is-on' : ''} onClick=${() => updateSettings({ textSize: id })}>${t(label)}</button>`)}
        </div>
      </div>
      <p class="set-hint set-textsize-note">${t('调整界面文字大小，棋盘保持原比例。')}</p>
      <${ScreenFitSection} />
      <${HotkeySection} keys=${s.keys} touchUi=${touchUi} />
      <${RoomCapSection} busy=${roomCapBusy} setBusy=${setRoomCapBusy} />
      <${TestModeSection} busy=${roomCapBusy} setBusy=${setRoomCapBusy} />
      <${DiagSection} />
      <p class="set-hint">${touchUi ? t('触屏操作：点击单位选中（撤退 / 出售）· 长按单位或卡牌查看详情 · 拖动部署后滑动选择朝向') : t('右键查看详情')}</p>
    </div>
  <//>`;
}
