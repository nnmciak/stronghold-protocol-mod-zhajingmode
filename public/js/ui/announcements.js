// public/js/ui/announcements.js — 更新公告(选择模拟协议界面):一个独立按钮 + 一个弹出面板。
//
// 版面参照《明日方舟》的公告栏,而不是自己发明一套:
//   * 面板头是一条琥珀色的信息带(官方公告的标题条),右上是发布日期「2026 / 10 / 09」;
//   * 正文按「分节」组织,每节一个小标题(前面一个方块图标)+ 编号条目,条目正文用次级灰;
//   * 开头一句「感谢各位博士…」与结尾一句落款,和官方公告的写法一致;
//   * 只有一条公告时也照样分节,不为了省地方把它压成一段话。
//
// 这与右上角那个铃铛(AnnouncementsButton)是一体的:按钮只做入口,内容全在面板里。
// 服务端的全服公告(sys.notice)是另一条通道,走 ui/sysNotice.js 的顶部横幅 —— 两者用途不同:
// 公告栏是「我们改了什么」,广播是「现在发生什么」。

import { html, Icon, Modal } from './components.js';
import { data, useData } from '../data.js';

/** localStorage 键:上次读过的公告日期(YYYY-MM-DD),用来点亮「NEW」角标。 */
const SEEN_KEY = 'sp100.announcements.seen';

const readSeen = () => {
  try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; }
};
const writeSeen = (d) => {
  try { localStorage.setItem(SEEN_KEY, d); } catch { /* private mode: the badge just stays on */ }
};

const clean = (list) => (Array.isArray(list)
  ? list.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
  : []);

/** 规范化一条公告:date 必填;items 与 sections(带小标题的附加节)各自过滤空行。 */
function normalizeEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const date = typeof e.date === 'string' ? e.date.trim() : '';
  if (!date) return null;
  const sections = (Array.isArray(e.sections) ? e.sections : [])
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      const items = clean(s.items);
      if (!items.length) return null;
      // `numbered: false` → 段落式条目(通知类公告不编号;补丁类默认编号)
      return {
        label: typeof s.label === 'string' && s.label.trim() ? s.label.trim() : '',
        items,
        numbered: s.numbered !== false,
      };
    })
    .filter(Boolean);
  // 插图:只接受站内绝对路径(以 / 开头)或 https,避免公告数据把玩家引到别处
  const images = (Array.isArray(e.images) ? e.images : [])
    .map((im) => {
      if (!im || typeof im !== 'object') return null;
      const src = typeof im.src === 'string' ? im.src.trim() : '';
      if (!src || !(src.startsWith('/') || /^https:\/\//.test(src))) return null;
      return {
        src,
        alt: typeof im.alt === 'string' && im.alt.trim() ? im.alt.trim() : '',
        caption: typeof im.caption === 'string' && im.caption.trim() ? im.caption.trim() : '',
      };
    })
    .filter(Boolean);
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  return {
    date,
    title: str(e.title),
    tag: str(e.tag),
    // 蓝色「重要」角标(运营标记):与置顶(pinned,红色右下角)并列,显示在列表行【右上角】。
    mark: str(e.mark),
    intro: str(e.intro),
    outro: str(e.outro),
    // 置顶: mod 介绍这类「长期有效、新人必读」的条目用 `pinned: true` —— 它排到列表最前,
    // 并带一个红色「置顶」角标,与按日期排序的补丁公告区分开。
    pinned: e.pinned === true,
    // 结尾的群号条: officially styled like the in-game 「加入官方社群」 footer, kept as its own field so it is
    // never mistaken for the closing sentence above it.
    footer: str(e.footer),
    // 「一些大饼」: roadmap / teasing lines. Rendered last and dimmer than everything else — it is a promise, not a
    // shipped change, and should not read with the same weight as the 补丁内容 above it.
    teaser: str(e.teaser),
    build: typeof e.build === 'string' ? e.build : '',
    items: clean(e.items),
    sections,
    images,
  };
}

/** 'YYYY-MM-DD' → { y, m, d }(数字),或 null。左栏的日期方块和右栏的日期行都读它。 */
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/**
 * 读取并排序公告:置顶条目(`pinned: true`)排到最前,其余保持文件里的顺序(最新的在最上)。
 *
 * 排序在这里而不是数据里,是为了让 `_bilibili_uid` / `_comment` 这类元信息不会打乱可读性,
 * 也让「置顶」成为一个可撤销的标记而不是把条目搬来搬去。
 */
function loadEntries() {
  const raw = data.get('announcements');
  const list = (raw && Array.isArray(raw.entries) ? raw.entries : []).map(normalizeEntry).filter(Boolean);
  const pinned = list.filter((e) => e.pinned);
  if (!pinned.length) return list;
  return [...pinned, ...list.filter((e) => !e.pinned)];
}

/**
 * 行内标记,三种:
 *   * `[显示文字](https://…)` → 蓝色可点链接(出处用)
 *   * `@某人`                 → 蓝色(社区惯例:@ 到的人用蓝字)
 *   * `[red]文字[/red]`       → 红色预警(用于「注意 / 仅本服务器有效」这类必须看见的短语)
 *
 * 为什么需要它:公告里的「思路来源 / 原项目 / 借物」要给出处,`@某人` 要显眼,而红色短语是运营用来标「这条
 * 只在这个服务器生效」这类限定条件的 —— 纯文本读起来会被漏掉。
 * 解析很窄(只认这三种写法,不认别的 markdown),所以不会把普通文本误当成标记。
 * 链接只允许 http/https:公告是运营文本,不该出现 javascript: 之类的协议头。
 */
function inline(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  // one pass, longest-alternative-first: markdown link | [red]…[/red] | @mention | plain run
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\[red\]([\s\S]*?)\[\/red\]|@([A-Za-z0-9_\u4e00-\u9fa5·-]{1,32})/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] != null) out.push(html`<a class="anlink" href=${m[2]} target="_blank" rel="noopener noreferrer">${m[1]}</a>`);
    else if (m[3] != null) out.push(html`<span class="anred">${m[3]}</span>`);
    else out.push(html`<span class="anmention">@${m[4]}</span>`);
    last = m.index + m[0].length;
  }
  if (!out.length) return s;          // no markup at all: hand the plain string straight to the renderer
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/**
 * 一个分节:方块图标 + 小标题 + 条目。
 * @param {{ label?: string, items: string[], numbered?: boolean }} props
 *   `numbered: false` 渲染成不加编号的段落(通知类公告用:那不是在列举改动,而是在讲一件事)
 */
function Section({ label, items, numbered = true }) {
  if (!items.length) return null;
  const cls = `ansect__items${numbered ? '' : ' ansect__items--plain'}`;
  const body = items.map((it, i) => html`<li key=${i}>${inline(it)}</li>`);
  return html`<section class="ansect">
    ${label ? html`<h4 class="ansect__label"><${Icon} name="stop" class="ansect__icon" />${label}</h4>` : null}
    ${numbered ? html`<ol class=${cls}>${body}</ol>` : html`<ul class=${cls}>${body}</ul>`}
  </section>`;
}

/**
 * 一条公告的正文(右栏)。左栏选中哪条就渲染哪条 —— 和游戏内公告板一样是「左列表 / 右详情」,而不是把历次
 * 公告堆成一长条往下滚。
 */
function EntryDetail({ entry, latest }) {
  const e = entry;
  const dt = parseDate(e.date);
  const dayLabel = dt ? `${dt.m} 月 ${dt.d} 日` : e.date;
  return html`<article class="andetail">
    <header class="andetail__head">
      <h3 class="andetail__title">${e.title}</h3>
      <div class="andetail__meta">
        <span class="andetail__date num">${dayLabel}</span>
        ${e.date === latest ? html`<span class="anitem__new">最新</span>` : null}
        ${e.tag ? html`<span class="anitem__tag">${e.tag}</span>` : null}
        ${e.build ? html`<span class="anitem__build num">${e.build}</span>` : null}
      </div>
    </header>
    ${e.intro ? html`<p class="anitem__intro">${inline(e.intro)}</p>` : null}
    <${Section} items=${e.items} label="" />
    ${e.sections.map((s, k) => html`<${Section} key=${k} label=${s.label} items=${s.items} numbered=${s.numbered} />`)}
    ${e.outro ? html`<p class="anitem__outro">${inline(e.outro)}</p>` : null}
    ${e.images.length ? html`<div class="anfigs">
      ${e.images.map((im, i) => html`<figure key=${i} class="anfig">
        <img class="anfig__img" src=${im.src} alt=${im.alt} loading="lazy" />
        ${im.caption ? html`<figcaption class="anfig__cap">${inline(im.caption)}</figcaption>` : null}
      </figure>`)}
    </div>` : null}
    ${e.teaser ? html`<p class="anitem__teaser">${inline(e.teaser)}</p>` : null}
    ${e.footer ? html`<p class="anitem__footer"><${Icon} name="users" />${inline(e.footer)}</p>` : null}
  </article>`;
}

/**
 * 铃铛按钮(入口)。它挂在标题界面右上角那排图标里 —— 那里在 `.title-main` 内部,而 `.title-main` 是
 * `position: relative; z-index: 2`,会为后代建立层叠上下文:任何从它里面弹出的面板,自身 z-index 再高也只能赢在
 * 这个上下文内部,而兄弟节点 `.roomlist`(z-index 3)会盖在它上面。所以按钮与面板分成两个导出:按钮留在工具栏,
 * 面板由 TitleScreen 挂在根层级(和 RoomList / SettingsModal 同级)。状态因此提到调用方。
 *
 * @param {{ open: boolean, fresh: boolean, onOpen: () => void }} props
 */
export function AnnouncementsButton({ open, fresh, onOpen }) {
  useData('announcements');
  const entries = loadEntries();
  if (!entries.length) return null;
  return html`
    <button type="button" class=${`anbtn fsbtn tapx${fresh ? ' is-fresh' : ''}`}
      aria-label=${'更新公告'} title=${'更新公告'} onClick=${onOpen} aria-expanded=${open ? 'true' : 'false'}>
      <${Icon} name="bell" />
      ${fresh ? html`<span class="anbtn__dot" aria-hidden="true" />` : null}
    </button>`;
}

/**
 * 公告面板。必须挂在 `.title-main` 之外(见上),否则会被房间列表盖住。
 *
 * 版面是游戏内公告板那种左右分栏(左:历次公告列表,带日期方块与「NEW」角标;右:选中那一条的正文),
 * 而不是把每条都铺成一长列。
 *
 * @param {{ open: boolean, picked: number, onPick: (i: number) => void, onClose: () => void }} props
 */
export function AnnouncementsModal({ open, picked = 0, onPick, onClose }) {
  useData('announcements');
  const entries = loadEntries();
  if (!entries.length) return null;

  const latest = entries[0].date;
  const sel = entries[Math.min(Math.max(0, picked), entries.length - 1)] || entries[0];
  const readSeenNow = readSeen();
  const fresh = !readSeenNow || readSeenNow < latest;

  return html`<${Modal} open=${open} title=${'更新公告'} micro="PATCH NOTES" tone="amber" onClose=${onClose}
    class="anmodal" width="min(11rem, 96vw)">
    <div class="anboard">
      <nav class="anboard__list" aria-label=${'公告列表'}>
        ${entries.map((e, i) => {
          const dt = parseDate(e.date);
          const isNew = e.date === latest && fresh;
          return html`<button type="button" key=${e.date + i}
            class=${`anrow${i === picked ? ' is-on' : ''}${isNew ? ' is-new' : ''}${e.mark ? ' has-mark' : ''}`}
            aria-current=${i === picked ? 'true' : undefined}
            onClick=${() => onPick(i)}>
            <span class="anrow__d">
              <b class="num">${dt ? dt.d : '·'}</b>
              <i class="num">${dt ? dt.m : ''}月</i>
            </span>
            <span class="anrow__t">
              <span class="anrow__title">${e.title}</span>
              ${e.tag ? html`<span class="anrow__tag">${e.tag}</span>` : null}
            </span>
            ${e.pinned ? html`<span class="anrow__pin">置顶</span>` : null}
            ${e.mark ? html`<span class="anrow__mark">${e.mark}</span>` : null}
            ${isNew ? html`<span class="anrow__new">NEW</span>` : null}
          </button>`;
        })}
      </nav>
      <div class="anboard__body">
        <${EntryDetail} entry=${sel} latest=${latest} />
      </div>
    </div>
  <//>`;
}

/** 是否还有未读公告(铃铛上的金点)。 */
export function announcementsFresh() {
  const entries = loadEntries();
  if (!entries.length) return false;
  const seen = readSeen();
  return !seen || seen < entries[0].date;
}

/** 把最新一条标记为已读(面板关闭时调用)。 */
export function markAnnouncementsSeen() {
  const entries = loadEntries();
  if (entries.length) writeSeen(entries[0].date);
}
