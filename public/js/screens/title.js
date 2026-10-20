// Title screen: season-style backdrop, big title 卫戍协议：盟约, remembered nickname, 开始, the language menu
// (中文 | English | every pack in public/i18n/, ui/lang.js; a title in an alphabetic script — English — is the big one and
// the small wordmark above it hides).
//
// Pressing 开始 validates the nickname (1..NAME_MAX_LEN chars, no control characters), stores it,
// marks this tab as "entered" (so reloads skip the title) and hands the name to net.js, which
// sends `hello` (now, or as soon as the socket is open). The router then shows the lobby.
//
// Backdrop art: if data/assets.json lists a UI backdrop (`ui.titleBackdrop`, or one of the
// entry/loading illustration names) it is layered under the CSS art; otherwise the screen is
// pure CSS/SVG (radar, ridgelines, glow), so it never issues a request that can 404.

import { useEffect, useMemo, useState } from '../../vendor/hooks.module.js';
import { NAME_MAX_LEN, APP_VERSION, DEV_BUILD } from '../../../shared/constants.js';
import { html, Button, Icon, MicroLabel, TextField, PingPill } from '../ui/components.js';
import { GuideButton } from '../ui/guide.js';
import { toast } from '../ui/toasts.js';
import { net, identity } from '../net.js';
import { store, useStore, shallowEqual } from '../store.js';
import { useLobbyFeed, RoomList } from './lobbyFeed.js';
import { data, useData } from '../data.js';
import { FullscreenButton, detectFeatures } from '../ui/device.js';
import { LangToggle, useLang } from '../ui/lang.js';
import { t, N_ } from '../../../shared/i18n.js';
import { scriptOf } from '../../../shared/i18nPacks.js';
import { GIcon } from '../ui/gameComponents.js';
import { SettingsModal } from '../ui/settings.js';
import { AvatarPicker } from '../ui/avatarPicker.js';
import { avatarSrc } from '../../../shared/avatars.js';
import { DynAvatar } from '../ui/dynAvatar.js';
import { AnnouncementsButton, AnnouncementsModal, announcementsFresh, markAnnouncementsSeen } from '../ui/announcements.js';
import { openStats } from './stats.js';

// 下载完整素材 / 导入素材包（官方 0.3.0 的 title-assets，DSH 2026-10-16 从上游移植）
import { AssetDownloadButton } from '../ui/assetDownload.js';
import { AssetImportButton } from '../ui/assetImport.js';
import { NodeSwitch } from '../ui/nodeSwitch.js';
// Same character classes as server/net.js sanitizeName (control, zero-width, bidi, BOM), so a name
// the client accepts is never rejected by the server's hello validation.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
// Lone surrogates are removed by a scan, not a regex: the lookbehind such a regex needs is a *syntax error* in Safari
// < 16.4, which would stop the whole client from loading there.
export function stripLoneSurrogates(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (n >= 0xdc00 && n <= 0xdfff) { out += str[i] + str[i + 1]; i++; }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    out += str[i];
  }
  return out;
}

/**
 * Normalise a nickname like the server does (NFC, strip lone surrogates / control / invisible /
 * bidi characters, collapse whitespace, trim), then clamp to NAME_MAX_LEN UTF-16 code units — the
 * protocol's `hello.name` limit — without splitting a surrogate pair.
 * @param {any} raw
 * @returns {string}
 */
export function sanitizeName(raw) {
  let s = String(raw ?? '');
  try { s = s.normalize('NFC'); } catch { /* keep as is */ }
  s = stripLoneSurrogates(s).replace(/\s+/g, ' ').replace(CONTROL_CHARS, '').replace(/ {2,}/g, ' ').trim();
  if (s.length > NAME_MAX_LEN) {
    s = s.slice(0, NAME_MAX_LEN);
    // Don't leave half a surrogate pair at the end.
    if (/[\ud800-\udbff]$/.test(s)) s = s.slice(0, -1);
    s = s.trim();
  }
  return s;
}

/** @param {any} raw @returns {boolean} */
export const isValidName = (raw) => sanitizeName(raw).length > 0;

/**
 * Enter the game shell with a nickname (title → lobby).
 * @param {string} rawName
 * @returns {boolean} false when the name is invalid
 */
export function enterSession(rawName) {
  const name = sanitizeName(rawName);
  if (!name) return false;
  identity.saveName(name);
  identity.setEntered(true);
  store.set((s) => ({ me: { ...s.me, name }, session: { ...s.session, entered: true } }));
  net.setName(name);
  return true;
}

/**
 * 头像（用户 2026-10-12）：选中的 id 存 localStorage（identity.saveAvatar）并推给 net（随 hello 发给服务端，
 * 房间 / 对局 / 结算里队友就能看到）。传 null = 清除头像。
 * @param {string|null} id
 */
export function setAvatar(id) {
  const v = typeof id === 'string' && id ? id : '';
  identity.saveAvatar(v);
  store.set((s) => ({ me: { ...s.me, avatar: v || null } }));
  net.setAvatar(v || null);
}

// data/assets.json `ui` keys are 'group/key' (docs/ASSETS.md).
const BACKDROP_KEYS = ['titleBackdrop', 'entry/bkg_01', 'entry/bkg_02'];
const RIDGE_KEYS = ['titleRidges', 'entry/bg_mountains_tiled'];

/**
 * Find a UI image URL in data/assets.json (tolerant of a few plausible shapes).
 * @param {any} assets
 * @param {string[]} names
 * @returns {string|null}
 */
export function findUiAsset(assets, names) {
  if (!assets || typeof assets !== 'object') return null;
  const asUrl = (v) => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') return v.url || v.path || v.src || null;
    return null;
  };
  const ui = assets.ui;
  if (ui && typeof ui === 'object' && !Array.isArray(ui)) {
    for (const n of names) {
      const u = asUrl(ui[n]);
      if (u) return u;
    }
  }
  const lists = [Array.isArray(ui) ? ui : null, Array.isArray(assets.files) ? assets.files : null].filter(Boolean);
  for (const list of lists) {
    for (const n of names) {
      const hit = list.map(asUrl).find((u) => typeof u === 'string' && u.includes('/ui/') && u.toLowerCase().split('/').pop().startsWith(n.toLowerCase()));
      if (hit) return hit;
    }
  }
  return null;
}

// Dot-matrix watchtower emblem (13×14 bitmap; dots grow toward the base for depth).
const EMBLEM = [
  'XXX..XXX..XXX',
  'XXX..XXX..XXX',
  'XXXXXXXXXXXXX',
  '.XXXXXXXXXXX.',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '..XXXX.XXXX..',
  '..XXXX.XXXX..',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '.XXXXXXXXXXX.',
  'XXXXXXXXXXXXX',
  'XXXXXXXXXXXXX',
];

export function Emblem() {
  const dots = useMemo(() => {
    const out = [];
    EMBLEM.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        if (ch !== 'X') return;
        const rad = 0.2 + (r / (EMBLEM.length - 1)) * 0.2;
        const accent = (r === 6 || r === 7) && (c === 5 || c === 7);
        out.push({ cx: c + 0.5, cy: r + 0.5, r: rad, accent, d: (r * 13 + c) % 7 });
      });
    });
    return out;
  }, []);
  return html`<div class="emblem" aria-hidden="true">
    <span class="emblem__bracket emblem__bracket--l"></span>
    <svg class="emblem__svg" viewBox="-0.5 -0.5 14 15">
      ${dots.map((d, i) => html`<circle key=${i} cx=${d.cx} cy=${d.cy} r=${d.r} class=${d.accent ? 'is-accent' : `d${d.d}`} />`)}
    </svg>
    <span class="emblem__bracket emblem__bracket--r"></span>
  </div>`;
}

function Ridges() {
  return html`<svg class="title-bg__ridges" viewBox="0 0 1920 420" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="ridge-far" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#16231f" /><stop offset="1" stop-color="#0a0e0d" />
      </linearGradient>
      <linearGradient id="ridge-near" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0f1714" /><stop offset=".6" stop-color="#080b0a" />
      </linearGradient>
      <linearGradient id="ridge-edge" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#17f9b7" stop-opacity="0" />
        <stop offset=".3" stop-color="#17f9b7" stop-opacity=".55" />
        <stop offset=".7" stop-color="#17f9b7" stop-opacity=".55" />
        <stop offset="1" stop-color="#17f9b7" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path class="ridge ridge--far" fill="url(#ridge-far)" stroke="url(#ridge-edge)"
      d="M0 420V250l120-40 90 30 90-70 60 20 80-70 80 55 80-25 90 70 90-20 80 50 100-15 90 25 90-55 90-55 70-55 70 45 80-20 90 65 80-20 100 55 100-20 100 40v180z" />
    <path class="ridge ridge--near" fill="url(#ridge-near)" stroke="url(#ridge-edge)"
      d="M0 420V322l160-32 100 20 120-50 90 40 130-20 120 50 140-30 140 35 120-35 140 20 140-50 120 30 120-20 120 40 160-20v147z" />
  </svg>`;
}

const STATUS_TEXT = {
  idle: N_('准备连接'), connecting: N_('正在连接服务器'), connected: N_('已连接服务器'), handshaking: N_('正在验证身份'),
  online: N_('已连接服务器'), reconnecting: N_('连接中断，正在重连'), closed: N_('连接已关闭'),
};

/** Title screen component. */
export function TitleScreen() {
  const conn = useStore((s) => s.connection, shallowEqual);
  const pendingJoin = useStore((s) => s.ui.pendingJoin);
  const feed = useLobbyFeed();
  useLang(); // re-render on a language switch
  const [name, setName] = useState(() => store.get().me.name || identity.loadName() || '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 头像（名片）：选中的 id（shared/avatars.js），null = 未设置
  const [avatar, setAvatarState] = useState(() => store.get().me.avatar || identity.loadAvatar() || null);
  const [pickOpen, setPickOpen] = useState(false);
  // 更新公告:state lives here, not in the button, because the BUTTON renders inside `.title-main` (a stacking
  // context: position relative + z-index 2) while the PANEL must render outside it — otherwise `.roomlist`, a
  // sibling at z-index 3, paints over the open panel.
  const [annOpen, setAnnOpen] = useState(false);
  const [annPicked, setAnnPicked] = useState(0);
  const [annFresh, setAnnFresh] = useState(false);
  const assetsSettled = useData('assets');
  useData('avatars');
  useData('announcements');
  const assets = data.get('assets');
  // the bell's gold dot: recomputed once the announcements file has arrived (and after the panel is closed)
  useEffect(() => { setAnnFresh(announcementsFresh()); }, [assetsSettled, annOpen]);
  const backdrop = findUiAsset(assets, BACKDROP_KEYS);
  const ridges = findUiAsset(assets, RIDGE_KEYS);
  // Track load/fail per URL (not as booleans reset in effects: an image can load before an effect runs).
  const [bgLoadedUrl, setBgLoadedUrl] = useState(null);
  const [ridgesLoadedUrl, setRidgesLoadedUrl] = useState(null);
  const [ridgesFailedUrl, setRidgesFailedUrl] = useState(null);
  const bgLoaded = !!backdrop && bgLoadedUrl === backdrop;
  const ridgesLoaded = !!ridges && ridgesLoadedUrl === ridges;
  const ridgesFailed = !!ridges && ridgesFailedUrl === ridges;
  // CSS ridgelines only when there is no ridge art (avoids a swap flash when the art arrives).
  const cssRidges = assetsSettled && (!ridges || ridgesFailed);

  const valid = isValidName(name);
  const avatarCat = data.get('avatars');
  const avatarImg = avatarSrc(avatarCat, avatar);
  const start = () => {
    if (!valid) { toast(t('请输入博士代号'), 'warn'); return; }
    // 头像先给 net（它只存值），再 setName → 这一次 hello 就同时带上代号和头像
    setAvatar(avatar);
    enterSession(name);
  };
  const pickAvatar = (id) => {
    setAvatarState(id);
    setAvatar(id);
    // 标题页还没连上/还没发过 hello 时 setAvatar 只存值；这里补一次，保证改完立刻生效
    if (store.get().session.entered) net.setAvatar(id || null);
  };

  // Join a listed room: exactly the path a `?room=CODE` invite link takes. Set the code, then start the session — the
  // `session.entered` transition makes main.js join it (its store subscription calls schedulePendingJoin). Deliberately
  // no import of that helper: main.js imports this module, so reaching back would be a circular dependency.
  // `canJoin` (a valid name) gates the buttons, so this never runs with an empty name.
  const joinRoom = (code) => {
    store.patch('ui', { pendingJoin: code });
    start();
  };

  const online = conn.status === 'online' || conn.status === 'connected';
  const dotClass = online ? 'is-on' : conn.status === 'reconnecting' || conn.status === 'connecting' || conn.status === 'handshaking' ? 'is-warn' : 'is-bad';

  // touch screens: no autofocus (it would pop the on-screen keyboard over a landscape phone's whole view)
  const touchUi = useMemo(() => detectFeatures().coarse, []);
  // a title in an alphabetic script (English, French …) is the big one in the display face and the wordmark above it
  // hides; a CJK / kana / Hangul title keeps the Chinese layout (shared/i18nPacks.js scriptOf — a pack needs no flag)
  const alphabetic = scriptOf(t('卫戍协议')) === 'alphabetic';
  return html`<div class="screen title-screen">
    <div class=${`title-bg${bgLoaded ? ' has-art' : ''}${ridgesLoaded ? ' has-ridges' : ''}`} aria-hidden="true">
      ${backdrop ? html`<img class="title-bg__art" src=${backdrop} alt="" draggable=${false}
        onLoad=${() => setBgLoadedUrl(backdrop)} />` : null}
      <div class="title-bg__glow"></div>
      <div class="title-bg__radar"><div class="title-bg__sweep"></div></div>
      <div class="title-bg__target"></div>
      ${cssRidges ? html`<${Ridges} />` : null}
      ${ridges && !ridgesFailed ? html`<div class="title-bg__ridge-art" style=${`background-image:url("${ridges}")`}>
        <img src=${ridges} alt="" hidden onLoad=${() => setRidgesLoadedUrl(ridges)} onError=${() => setRidgesFailedUrl(ridges)} />
      </div>` : null}
      <div class="title-bg__haze"></div>
      <span class="cross" style="left:7%;top:22%"></span>
      <span class="cross" style="left:93%;top:30%"></span>
      <span class="cross" style="left:14%;top:70%"></span>
      <span class="cross" style="left:88%;top:62%"></span>
      <span class="cross" style="left:60%;top:12%"></span>
    </div>

    <div class="title-corner title-corner--tl">
      <span class="title-corner__mark"></span>
      <div><${MicroLabel} tone="mint">RHODES ISLAND // SIMULATION SERVICE<//><br /><${MicroLabel}>TACTICAL CO-OP NODE · 02<//></div>
    </div>
    <div class="title-corner title-corner--tr">
      <div>
        <${LangToggle} class="title-lang" />
        <${MicroLabel} tone="hi">TARGET POINT<//><br /><${MicroLabel}>STRONGHOLD PROTOCOL<//>
        ${feed.online == null ? null : html`<div class="title-online">
          <span class=${`status-dot ${dotClass}`}></span>
          <span>${t('在线')}<b class="num">${feed.online}</b>${t('人')}</span>
        </div>`}
      </div>
    </div>

    <main class="title-main">
      <${Emblem} />
      ${alphabetic ? null : html`<div class="title-en">
        <span class="title-en__a">STRONGHOLD PROTOCOL</span>
        <span class="title-en__b">ALLIANCE</span>
      </div>`}
      <h1 class=${`title-cn${alphabetic ? ' title-cn--latin' : ''}`}>${t('卫戍协议')}<span class="title-cn__colon">${alphabetic ? ': ' : '：'}</span><em>${t('盟约')}</em></h1>
      <p class="title-tag">${t('调配资金与干员，与同伴协同布防，抵御多波次进攻，直至击败敌方领袖。')}</p>

      ${''/* 2026-10-18：节点选择放在登录框正上方 —— 玩家进门前先决定从哪台服进。
            两台是**独立服务器**（各有大厅与对局），切换=整页跳转；进游戏后仍可在同盟大厅加入另一节点的房间。 */}
      <${NodeSwitch} />

      ${''/* 水印跟在副标题下面（用户 2026-10-13「把我的 mod 水印调整到我标红的这个区域」）：
           原来是绝对定位钉在页脚上方、内容之外，现在放进主列里当副标题那一带的第二行。 */}
      <${TitleWatermark} />

      <div class="title-login">
        ${pendingJoin ? html`<div class="title-invite">
          <${Icon} name="key" />
          <span>${t('收到同盟邀请')}</span><b class="num">${pendingJoin}</b><span class="t-lo">${t('· 输入代号后将自动加入')}</span>
        </div>` : null}
        <div class="title-idrow">
          <button type="button" class="title-avatar" onClick=${() => setPickOpen(true)}
            title=${t('选择头像')} aria-label=${t('选择头像')}>
            ${avatarImg ? html`<${DynAvatar} cat=${avatarCat} id=${avatar} src=${avatarImg} />` : html`<${Icon} name="user" class="title-avatar__ph" />`}
            <span class="title-avatar__tag">${t('头像')}</span>
          </button>
          <${TextField} label=${t('博士代号')} micro="CALLSIGN" size="lg" icon="user" value=${name} maxLength=${NAME_MAX_LEN}
            placeholder=${t('输入你的代号（最多 {NAME_MAX_LEN} 字）', { NAME_MAX_LEN })} autoFocus=${!touchUi}
            onInput=${setName} onEnter=${start} />
        </div>
        <${Button} variant="primary" size="xl" block=${true} iconRight="chevrons" disabled=${!valid} onClick=${start}>${t('开始')}<//>
        <div class="title-conn">
          <span class=${`status-dot ${dotClass}`}></span>
          <span>${STATUS_TEXT[conn.status] ? t(STATUS_TEXT[conn.status]) : conn.status}</span>
          ${conn.status === 'online' ? html`<${PingPill} ms=${conn.ping} />` : null}
          <${GuideButton} class="title-guide" label=${t('玩法说明')} />
          <button type="button" class="title-stats fsbtn tapx" aria-label=${t('统计数据')} title=${t('统计数据')}
            onClick=${openStats}><${GIcon} name="chart" /></button>
          <${AnnouncementsButton} open=${annOpen} fresh=${annFresh}
            onOpen=${() => { setAnnPicked(0); setAnnOpen(true); }} />
          <button type="button" class="title-settings fsbtn tapx" aria-label=${t('设置')} title=${t('设置')}
            onClick=${() => setSettingsOpen(true)}><${GIcon} name="gear" /></button>
          <${FullscreenButton} class="title-fs" />
        </div>
      </div>
    </main>

    ${''/* 下载完整素材 / 导入素材包（官方 0.3.0 的 title-assets）。
         ★ 2026-10-16（owner 两次反馈）：先是手机横屏看不见「导入素材包」—— 当时它是 `.title-screen`
         这个 flex 容器的直接子项却没有任何 CSS，宽度失控被裁；放进主列（登录框下方）后仍然被挡住，
         因为**登录框那一列在手机横屏下本身就超出视口底部**。owner 定案：「移到右边空处」——
         所以现在绝对定位到**右下角**（房间列表在左下、版本号在右下角一小行，中间是空的），
         宽度自足、不再依赖任何列的尺寸。 */}
    <div class="title-assets">
      ${''/* ★ 2026-10-17（用户：「把我登录界面的下载完整素材删掉 那个太吃带宽了」）：
           「下载完整素材」按钮已移除 —— 它会把整个美术包从服务器拉一遍，流量太大。
           模块 public/js/ui/assetDownload.js 保留（想恢复只需把下面这行加回来）：
             <${AssetDownloadButton} />
           下面的「导入素材包」保持原样。 */}
      <${AssetImportButton} />
    </div>

    <${SettingsModal} open=${settingsOpen} onClose=${() => setSettingsOpen(false)} />

    <${AvatarPicker} open=${pickOpen} value=${avatar} onPick=${pickAvatar} onClose=${() => setPickOpen(false)} />

    <${RoomList} rooms=${feed.rooms} peers=${feed.peers} loaded=${feed.loaded} onJoin=${joinRoom} canJoin=${valid} />

    ${''/* 更新公告的面板: must be a SIBLING of RoomList (root level), not inside .title-main — see the state
         comment above. Closing marks the newest entry read, so the bell's gold dot goes out. */}
    <${AnnouncementsModal} open=${annOpen} picked=${annPicked} onPick=${setAnnPicked}
      onClose=${() => { setAnnOpen(false); markAnnouncementsSeen(); setAnnFresh(false); }} />

    <footer class="title-foot">
      <span>${t('非官方同人复刻 · 游戏素材版权归 上海鹰角网络 / Yostar 所有')}</span>
      <${MicroLabel}>v${APP_VERSION} · WEB SIMULATION<//>
      ${DEV_BUILD ? html`<span class="title-dev" role="note">${t('开发版 · 不稳定，请勿用于公开服务器')}</span>` : null}
    </footer>
  </div>`;
}


/**
 * 100 人版水印（封面/输入代号页）：交流群与商用禁止。
 * 用 data 而非 i18n：这是一条固定公告，四份语言包里都没有对应 msgid，走 t() 会原样回退。
 * 做成独立元素而不是塞进 .title-foot —— 那个 footer 是 space-between 三栏布局，
 * 再多一个子元素会把版本号与开发版标签挤变形。
 */
export function TitleWatermark() {
  return html`<div class="title-watermark" role="note" aria-label=${'此 MOD 官方交流群：1129106742，禁止商用'}>
    <span class="title-watermark__row"><span class="title-watermark__k">此 MOD 官方交流群</span><b class="title-watermark__q num">1129106742</b></span>
    <span class="title-watermark__ban">禁止商用</span>
  </div>`;
}