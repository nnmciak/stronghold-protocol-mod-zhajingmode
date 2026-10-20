// 2026-10-13 房间内的「同盟密钥」面板（原版 room.js 的 InviteBox；新 UI 版没有，现补回）。
// 只含显示与复制：密钥/邀请链接。隐藏(不列入大厅)的开关在服务端 0.2.5 上不支持(room.setListed ✗)，故不提供。
import { useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel } from './components.js';
import { t } from '../../../shared/i18n.js';
import { copyText } from './clipboard.js';
import { toast } from './toasts.js';

/** 邀请链接（当前页面 + ?room=CODE），与原版 room.js:106 一致。 */
export function inviteLink(code) {
  const base = (typeof location !== 'undefined' ? location.origin + location.pathname : '');
  return `${base}?room=${encodeURIComponent(code)}`;
}

export function InviteKeyBox({ code, name = "", room = null }) {
  const [busy, setBusy] = useState(false);
  if (!code) return null;
  const invite = name ? `${name} 邀请你加入同盟` : "邀请你加入同盟";
  const copy = async (what) => {
    setBusy(true);
    const ok = await copyText(what === "code" ? code : `${inviteLink(code)} ${invite}`);
    setBusy(false);
    if (ok) toast(what === "code" ? t("已复制同盟密钥 {code}", { code }) : t("已复制邀请链接"), "success");
  };
  return html`<div class="invite">
    <div class="invite__label"><${Icon} name="key" /><span>${t("同盟密钥")}</span><${MicroLabel}>ALLIANCE KEY<//></div>
    <div class="invite__code num selectable" aria-label=${t("同盟密钥 {code}", { code })}>
      ${[...String(code)].map((ch, i) => html`<span key=${i}>${ch}</span>`)}
    </div>
    <div class="invite__acts">
      <${Button} size="sm" icon="copy" disabled=${busy} onClick=${() => copy("code")}>${t("复制密钥")}<//>
      <${Button} size="sm" variant="ghost" icon="share" disabled=${busy} onClick=${() => copy("link")}>${t("复制邀请链接")}<//>
    </div>
    ${room && room.private ? html`<span class="invite__listed-hint">${t("私密房间：仅凭同盟密钥或邀请链接加入")}</span>` : null}
  </div>`;
}
