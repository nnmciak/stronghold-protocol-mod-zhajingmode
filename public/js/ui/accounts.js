// Compat module (stronghold-ui package) — install ONLY when the target has no public/js/ui/accounts.js.
// The original deployment has player accounts kept by its own accounts service (login, avatar, #tag, name cards, the
// same records on every device). This module is the LOCAL stand-in: one "本机账号" per browser, everything in
// localStorage — the profile (avatar, #tag) under `sp.pref.localAccount`, the match records in the game's own
// `sp.pref.stats` (ui/stats.js). Nothing is sent to the server, and only the player on this browser has an account:
// teammates show no #tag. To connect a real account system later, replace this file with a module that has the same
// exports (AGENTS.md §3.2 lists them and what each must return).
import { html, AvatarFrame, MicroLabel, Icon, Modal, Button } from './components.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { render } from '../../vendor/preact.module.js';
import { store } from '../store.js';
import { net, identity } from '../net.js';
import { data } from '../data.js';
import { avatarSrc } from '../../../shared/avatars.js';
import { AvatarPicker } from './avatarPicker.js';

/** This module keeps the account in the browser (other modules may check it to word their notes). */
export const LOCAL_ACCOUNT = true;

const KEY = 'sp.pref.localAccount';
const listeners = new Set();
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode / quota: kept for this page only */ } };

let profile = null;
function load() {
  if (profile) return profile;
  profile = read() || {};
  if (!/^\d{4}$/.test(profile.tag || '')) { profile.tag = String(1000 + Math.floor(Math.random() * 9000)); write(profile); }
  return profile;
}
function emit() { for (const fn of listeners) { try { fn(); } catch { /* a listener's own problem */ } } }
// (guarded: the module is also imported by Node tests, where there is no window)
globalThis.addEventListener?.('storage', (e) => { if (e.key === KEY) { profile = null; emit(); } });

/** The local account: { id, name (the game's player name), tag, avatar (data: URL or null), card: null, local: true }. */
export function currentAccount() {
  const p = load();
  const me = store.get().me || {};
  const name = me?.name || p.name || '博士';
  // ★ 官方头像（owner 2026-10-16）：头像是官方头像 id（与标题页同一套，随 hello 发给服务端）。
  //   解析成图片地址给各处渲染；解析不到就 null（回落到名字首字母）。
  const id = typeof me?.avatar === 'string' && me.avatar ? me.avatar : (p.avatarId || null);
  const src = id ? avatarSrc(data.get('avatars'), id) : null;
  return { id: `local-${p.tag}`, name, tag: p.tag, avatar: src, avatarId: id, card: null, local: true };
}
export function onAccountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export async function refreshAccount() { return currentAccount(); }
export async function logoutAccount() { /* a local account cannot log out */ }
/** A fetch timeout signal (some modules import it from here). */
export function timeoutSignal(ms) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }

/** Preact: { me, loaded } — always loaded, `me` is the local account. */
export function useCurrentAccount() {
  const [me, setMe] = useState(currentAccount);
  useEffect(() => {
    const update = () => setMe(currentAccount());
    listeners.add(update);
    const off = store.subscribe ? store.subscribe(update) : null;
    return () => { listeners.delete(update); if (typeof off === 'function') off(); };
  }, []);
  return { me, loaded: true };
}

const isMe = (playerId) => !!playerId && playerId === store.get().me?.playerId;
/** A player's account — only this browser's own player has one here (teammates: null, no #tag). */
export function accountOf(playerId) { return isMe(playerId) ? currentAccount() : null; }
export function useAccount(playerId) {
  const { me } = useCurrentAccount();
  return isMe(playerId) ? me : null;
}
/** The small "#1234" after a name when that player has an account. */
export function AccountTag({ playerId }) {
  const info = useAccount(playerId);
  return info ? html`<span class="acct-tag" title=${`本机账号 ${info.name}#${info.tag}`}>#${info.tag}</span>` : null;
}
/** Plain DOM (chats): the #tag after this browser's own name. */
export function decorateChatName(element, playerId) {
  const info = accountOf(playerId);
  if (element && info && !element.querySelector('.acct-tag')) {
    const tag = document.createElement('span'); tag.className = 'acct-tag'; tag.textContent = `#${info.tag}`; element.append(tag);
  }
  return element;
}

// ---- the panel (opened from the hub's top-right chip) -------------------------------------------------------------------
function ensureStyle() {
  if (document.getElementById('local-acct-style')) return;
  const st = document.createElement('style');
  st.id = 'local-acct-style';
  st.textContent = `.acct-tag{margin-left:.06em;font-size:.8em;font-weight:600;opacity:.62;letter-spacing:.02em}
.lacct{display:flex;flex-direction:column;gap:.16rem;min-width:min(5.6rem,86vw)}
.lacct__who{display:flex;align-items:center;gap:.16rem}
.lacct__pic{width:.9rem;height:.9rem;flex:none;display:grid;place-items:center;overflow:hidden;border:2px solid var(--mint-700,#2b7);background:#101614;font-size:.4rem;font-weight:900}
.lacct__pic img{width:100%;height:100%;object-fit:cover}
.lacct__name{font-size:.3rem;font-weight:900}
.lacct__note{margin:0;font-size:.17rem;line-height:1.5;opacity:.72}
.lacct__btns{display:flex;flex-wrap:wrap;gap:.1rem}`;
  document.head.appendChild(st);
}
let host = null;
function AccountPanel({ onStats, onClose }) {
  const { me } = useCurrentAccount();
  // ★ 官方头像（owner 2026-10-16）：不再上传本地图片，改为从官方头像库（919 个）里选。
  const [pickOpen, setPickOpen] = useState(false);
  const currentId = me.avatarId || null;
  // 与 screens/title.js 的 setAvatar 等价（反向 import 会形成循环依赖，故本地实现）：
  // id 存 localStorage（identity.saveAvatar）+ 写 store.me + 推给 net（随 hello 发给服务端 → 队友可见）。
  const setAv = (id) => {
    const v = typeof id === 'string' && id ? id : '';
    try { identity.saveAvatar(v); } catch { /* 存不下就只在本页生效 */ }
    store.set((st) => ({ me: { ...st.me, avatar: v || null } }));
    try { net.setAvatar(v || null); } catch { /* 未连接：下次 hello 带 */ }
    emit();
  };
  const clear = () => setAv(null);
  return html`<${Modal} open=${true} title="本机账号" micro="LOCAL ACCOUNT" onClose=${onClose}>
    <div class="lacct">
      <div class="lacct__who">
        <span class="lacct__pic">${me.avatar ? html`<img src=${me.avatar} alt="" />` : [...me.name][0]}</span>
        <span><b class="lacct__name">${me.name}<span class="acct-tag">#${me.tag}</span></b><br /><${MicroLabel}>LOCAL · 本机<//></span>
      </div>
      <p class="lacct__note">头像从官方头像库里选（与标题页同一套）；编号和战绩保存在这台设备的浏览器里。昵称跟随游戏里的名字。</p>
      <div class="lacct__btns">
        <${Button} size="sm" variant="secondary" icon="edit" onClick=${() => setPickOpen(true)}>选择头像<//>
        ${currentId ? html`<${Button} size="sm" variant="ghost" onClick=${clear}>移除头像<//>` : null}
        ${onStats ? html`<${Button} size="sm" variant="primary" icon="chart" onClick=${() => { onClose(); onStats(); }}>统计数据<//>` : null}
      </div>
    </div>
    <${AvatarPicker} open=${pickOpen} value=${currentId} onPick=${(id) => { setAv(id); setPickOpen(false); }}
      onClose=${() => setPickOpen(false)} />
  <//>`;
}
/** Open the account panel ({ onStats } adds the 统计数据 button). */
export function openAccountPanel(opts = {}) {
  ensureStyle();
  if (!host) { host = document.createElement('div'); host.className = 'local-acct-host'; document.body.appendChild(host); }
  const close = () => render(null, host);
  render(html`<${AccountPanel} onStats=${opts.onStats} onClose=${close} />`, host);
}

/** The hub's top-right chip: avatar + name #tag; a click opens the account panel (with 统计数据). */
export function AccountMeChip({ player, onStats }) {
  const { me } = useCurrentAccount();
  useEffect(ensureStyle, []);
  const name = player?.name || me.name || '博士';
  return html`<button type="button" class="me-chip me-chip--btn stats-entry" onClick=${() => openAccountPanel({ onStats })} title="本机账号 · 统计数据" aria-label="本机账号">
    <${AvatarFrame} size="sm" name=${name} seat=${0} self=${true} src=${me.avatar || undefined} />
    <span class="me-chip__text"><span class="me-chip__name">${name}<span class="acct-tag">#${me.tag}</span></span><${MicroLabel}>LOCAL · 本机账号<//></span>
    <${Icon} name="user" class="me-chip__stats" />
  </button>`;
}

/** Nothing to start: no service. */
export function startAccounts() {}
