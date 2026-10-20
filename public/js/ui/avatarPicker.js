// public/js/ui/avatarPicker.js — 头像选择器（用户 2026-10-12）。
//
// 素材全部来自国服客户端（shared/avatars.js 的 id 方案；目录 = data/avatars.json，918 条）：
//   干员 / 精英二 / 皮肤 / 策略分队 / 个人头像（默认·动态·特殊·活动）
// 选择器只产出 id，不碰网络：调用方（screens/title.js 的名片）拿到 id 后 identity.saveAvatar + net.setAvatar。
//
// 用法：
//   html`<${AvatarPicker} open=${open} value=${me.avatar} onPick=${(id) => ...} onClose=${() => ...} />`
// 传 null 表示「不设头像」（清除）。
import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel, TextField, Button, cx } from './components.js';
import { data, useData } from '../data.js';
// 2026-10-12 修复：第 54 行调用了 useGameData()，但这里原来没有 import（界面整块报
// 「界面发生错误 / useGameData is not defined」，main.js 的 screen crashed 就是这个）。
import { useGameData } from './gameComponents.js';
import { avatarSrc, avatarDyn } from '../../../shared/avatars.js';
import { DynAvatar } from './dynAvatar.js';
import { t } from '../../../shared/i18n.js';

/** 页签（顺序 = 目录里的 group）。`sub` 只用于「个人头像」的四个子类。 */
const TABS = [
  { key: 'char', icon: 'user' },
  { key: 'e2', icon: 'crown' },
  { key: 'skin', icon: 'eye' },
  
  { key: 'player', icon: 'users' },
];
const PLAYER_SUBS = ['默认', '动态', '特殊', '活动'];
const TAB_LABEL = { char: '干员头像', e2: '精英二头像', skin: '皮肤头像', player: '个人头像' };
const SUBS = { char: '干员头像', e2: '精英二头像', skin: '皮肤头像', player: '个人头像' };

/** 一个格子。图片懒加载（918 张不能一次性下）。
 *  静态头像：和以前一样一个 <img>（失败画首字母）；动态头像（spine）：交给 DynAvatar 播动画。 */
function Cell({ item, src, cat, active, onPick }) {
  const [bad, setBad] = useState(false);
  const dyn = avatarDyn(cat, item.id);
  return html`<button type="button" class=${cx('avcell', active && 'is-on')} data-avatar=${item.id}
      title=${item.name || item.id} aria-label=${item.name || item.id} aria-pressed=${active ? 'true' : 'false'}
      onClick=${() => onPick(item.id)}>
    <span class="avcell__img">
      ${dyn ? html`<${DynAvatar} cat=${cat} id=${item.id} src=${src} />`
        : src && !bad ? html`<img src=${src} alt="" loading="lazy" decoding="async" draggable=${false} onError=${() => setBad(true)} />`
          : html`<span class="avcell__glyph">${[...(item.name || '?')][0]}</span>`}
    </span>
    <span class="avcell__name">${item.name || ''}</span>
  </button>`;
}

/**
 * @param {{ open: boolean, value?: string|null, title?: string, onPick: (id:string|null)=>void, onClose: ()=>void }} props
 */
export function AvatarPicker({ open, value = null, title, onPick, onClose }) {
  const [tab, setTab] = useState('char');
  const [sub, setSub] = useState('默认');
  const [q, setQ] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [limit, setLimit] = useState(240);   // 首屏给足：干员头像页共 211 个
  const boxRef = useRef(null);
  const cat = data.get('avatars');
  useData('avatars');
  const gd = useGameData();
  const listRef = useRef(null);

  useEffect(() => { if (open) { setLimit(240); setQ(''); } }, [open, tab, sub]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, [open, onClose]);

  const items = useMemo(() => {
    const all = (cat && Array.isArray(cat.items) ? cat.items : []).filter((it) => it && it.group === tab);
    const needle = q.trim().toLowerCase();
    return all.filter((it) => {
      if (tab === 'player' && sub && it.sub !== sub) return false;
      if (!needle) return true;
      return String(it.name || '').toLowerCase().includes(needle) || String(it.id).toLowerCase().includes(needle);
    });
  }, [cat, tab, sub, q]);
  // 每次换页签/子类/搜索都回到顶部
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = 0; }, [tab, sub, q]);
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;
  const onScroll = (e) => {
    const el = e.currentTarget;
    if (rest > 0 && !loadingMore && el.scrollTop + el.clientHeight > el.scrollHeight - 240) {
      setLoadingMore(true);
      setLimit((n) => n + 200);
      setLoadingMore(false);
    }
  };

  if (!open) return null;
  const cur = value && cat ? cat.items.find((x) => x.id === value) : null;
  const curSrc = avatarSrc(cat, value);
  return html`<div class="avpick" role="dialog" aria-modal="true" aria-label=${title || t('选择头像')}>
    <div class="avpick__scrim" onClick=${onClose}></div>
    <div class="avpick__panel" ref=${boxRef}>
      <header class="avpick__head">
        <${MicroLabel} tone="mint">PROFILE IMAGE<//>
        <h3>${t('名片形象')}</h3>
        <button type="button" class="avpick__x" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
      </header>

      <div class="avpick__tabs" role="tablist">
        ${TABS.map((x) => html`<button key=${x.key} type="button" role="tab" aria-selected=${tab === x.key ? 'true' : 'false'}
          class=${cx('avpick__tab', tab === x.key && 'is-on')} onClick=${() => setTab(x.key)}>
          <${Icon} name=${x.icon} />${t(TAB_LABEL[x.key] || x.key)}</button>`)}
      </div>

      <div class="avpick__bar">
        <${TextField} size="sm" icon="search" value=${q} placeholder=${t('搜索名字')} onInput=${setQ} />
        ${tab === 'player' ? html`<div class="avpick__subs">
          ${PLAYER_SUBS.map((s) => html`<button key=${s} type="button" class=${cx('avpick__sub', sub === s && 'is-on')}
            onClick=${() => setSub(s)}>${t(s)}</button>`)}
        </div>` : null}
        <span class="avpick__count num">${items.length}</span>
      </div>

      <div class="avpick__list" ref=${listRef} onScroll=${onScroll}>
        ${shown.length ? shown.map((it) => html`<${Cell} key=${it.id} item=${it} src=${avatarSrc(cat, it.id)} cat=${cat}
            active=${it.id === value} onPick=${(id) => { onPick(id); }} />`)
          : html`<p class="avpick__empty">${t('没有匹配的头像')}</p>`}
        ${rest > 0 ? html`<button type="button" class="avpick__more num" title=${t('点击显示更多')}
          onClick=${() => setLimit((n) => n + 240)}>${t('还有 {n} 个…（点击显示）', { n: rest })}</button>` : null}
      </div>

      <footer class="avpick__foot">
        <div class="avpick__cur">
          <span class="avpick__curimg">${curSrc ? html`<${DynAvatar} cat=${cat} id=${value} src=${curSrc} />` : html`<${Icon} name="user" />`}</span>
          <span><${MicroLabel}>${t('当前设置预览')}<//><b>${cur ? (cur.sub ? `${t(cur.sub)} · ${cur.name}` : cur.name) : t('未设置')}</b></span>
        </div>
        <${Button} variant="ghost" size="sm" onClick=${() => { onPick(null); }}>${t('清除头像')}<//>
        <${Button} variant="primary" size="md" onClick=${onClose}>${t('确认应用')}<//>
      </footer>
    </div>
  </div>`;
}
