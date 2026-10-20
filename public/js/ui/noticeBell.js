// 2026-10-13 公告铃铛（自包含）：按钮 + 弹窗 + 受控状态
// 修复：左侧列表点不动 —— AnnouncementsModal 的签名是 { open, picked, onPick, onClose }，
//       之前只传了 open/onClose，缺 picked/onPick 就无法切换 ✓
import { useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { AnnouncementsButton, AnnouncementsModal, announcementsFresh, markAnnouncementsSeen } from './announcements.js';

export function NoticeBell() {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(0);
  return html`<${AnnouncementsButton} open=${open} fresh=${announcementsFresh()} onOpen=${() => { setPicked(0); setOpen(true); }} />
    <${AnnouncementsModal} open=${open} picked=${picked} onPick=${(i) => setPicked(i)} onClose=${() => { setOpen(false); markAnnouncementsSeen(); }} />`;
}
