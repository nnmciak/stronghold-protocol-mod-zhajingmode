// 2026-10-13 一键踢掉所有未准备的博士（服务端 intent: room.kickUnready，见 server/lobby.js）
// 独立文件：非房主 / 对局已开始 / 没有未准备的人时自动不渲染。
import { html, Button, confirmDialog } from './components.js';
import { useState } from '../../vendor/hooks.module.js';
import { t } from '../../../shared/i18n.js';
import { store, useStore } from '../store.js';
import { net } from '../net.js';
import { toast, toastError } from './toasts.js';

export function KickUnreadyButton() {
  const st = useStore((x) => x);
  const room = st && st.room;
  const me = st && st.me;
  const [busy, setBusy] = useState(false);
  if (!room || room.inMatch || !me || room.hostId !== me.playerId) return null;
  const unready = (room.seats || []).filter((s) => s && !s.left && !s.isBot && s.playerId !== me.playerId && !s.ready);
  const onClick = async () => {
    const yes = await confirmDialog({ title: t('踢出未准备的博士'), text: t('将把所有未准备的博士移出同盟（你自己不会被踢）。确定吗？'), okText: t('全部踢出') });
    if (!yes) return;
    setBusy(true);
    try { const r = await net.request('room.kickUnready'); toast(t('已踢出未准备的博士') + (r && r.kicked != null ? ' ×' + r.kicked : '')); }
    catch (e) { toastError(e); }
    finally { setBusy(false); }
  };
  return html`<${Button} variant="ghost" size="sm" icon="user" disabled=${busy || !unready.length}
    onClick=${onClick} title=${t('一键踢出所有未准备的博士')}>${t('踢出未准备')}${unready.length ? ' (' + unready.length + ')' : ''}<//>`;
}
