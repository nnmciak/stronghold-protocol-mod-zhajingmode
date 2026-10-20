// public/js/ui/sysNotice.js — 全服公告横幅(sys.notice)。
//
// 服务端 operator 发一条公告(lobby.announce → 每个 socket 一帧 `sys.notice`,welcome.notice 里也会带一份给后连
// 进来的人),这里把它渲染成**顶部一条常驻横幅**:关服通知不是 toast,几秒后自己消失就失去意义了。
//
// 三个来源合流到 store.ui.notice:
//   * net.on('sys.notice')  —— 实时广播(已经在线的所有人)
//   * welcome.notice        —— 后连接 / 重连的人
//   * GET /notice           —— 页面加载时补一次(标题界面还没握手的几秒里发过公告的情况)
//
// 关闭写 localStorage('sp100.notice.seen' = JSON {text, at, until}),是「本机已读」,不是服务端撤回。
//
// 为什么带时间戳而不是只存文本:关服通知常常要重发(「2 分钟后」→「1 分钟后」→「现在」),文本可能一模一样。
// 只比文本的话,玩家点掉第一条之后,后面每一条同样的话都会被当成「已读」不再显示 —— 正好丢掉最关键的那条。
// 规则:同一条(文本相同、at ≤ 已读时刻)在 10 分钟窗口内不再弹;窗口过了、或服务端重发(at 变新)则重新出现。

import { useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { useStore } from '../store.js';

/** localStorage 键:上次点掉的那条公告 `{ text, at }`,以及本机把它静音到什么时候。 */
const SEEN_KEY = 'sp100.notice.seen';
/** 点掉之后同一段文本的静音时长:够长以免每局都弹,够短以便真出事时再提醒一次。 */
const MUTE_MS = 10 * 60 * 1000;

const readSeen = () => {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j && typeof j === 'object' ? j : null;
  } catch { return null; }
};
const writeSeen = (text, at) => {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify({ text, at, until: Date.now() + MUTE_MS })); } catch { /* private mode: it just shows again next load */ }
};

/** 这条公告对本机是否已经「安静」了(文本相同 + 发得比静音早 + 还在静音窗口内)。 */
function muted(notice, seen) {
  if (!seen) return false;
  if (seen.text !== notice.text) return false;            // 换了内容 → 重新出现
  if (Number(notice.at) > Number(seen.at || 0)) return false; // 服务端重发(时间戳变新)→ 重新出现
  return Date.now() < Number(seen.until || 0);
}

const LEVEL_ICON = { info: 'info', warn: 'warn', error: 'warn' };
const LEVEL_TEXT = { info: '公告', warn: '注意', error: '重要' };

/**
 * 全服公告横幅:固定在屏幕顶部,点右侧 ✕ 关闭(本机已读 10 分钟)。没有公告时不渲染。
 */
export function SysNoticeBanner() {
  const notice = useStore((s) => s.ui.notice);
  const [seen, setSeen] = useState(readSeen);

  const text = notice && typeof notice.text === 'string' ? notice.text : '';
  if (!text) return null;
  if (muted(notice, seen)) return null;

  const level = ['info', 'warn', 'error'].includes(notice.level) ? notice.level : 'info';
  const close = () => { writeSeen(text, notice.at); setSeen({ text, at: notice.at, until: Date.now() + MUTE_MS }); };

  return html`<div class=${`sysnotice sysnotice--${level}`} role="status" aria-live="polite">
    <span class="sysnotice__tag"><${Icon} name=${LEVEL_ICON[level]} />${LEVEL_TEXT[level]}</span>
    <span class="sysnotice__text">${text}</span>
    <button type="button" class="sysnotice__close" aria-label="关闭公告" title="关闭公告" onClick=${close}>
      <${Icon} name="close" />
    </button>
  </div>`;
}
