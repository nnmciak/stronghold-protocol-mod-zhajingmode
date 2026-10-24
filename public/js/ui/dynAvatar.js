// public/js/ui/dynAvatar.js — 动态头像（用户 2026-10-13）。
//
// 静态头像（绝大多数）：就是一个 <img>，行为与以前完全一致。
// 动态头像（data/avatars.json 的 dyn 表，目前 6 个 spine 骨架）：**先显示静态首帧**，等它滚进视口
// 再用项目自己的 loadSpineData() + PIXI 播 spine 的 loop 动画。GIF 那 3 个不需要这里，<img> 自己会动。
//
// 三条约束（低端机 / 手机不能卡）：
//   1) 同时最多 MAX_LIVE 个画布 —— 每个 PIXI.Application 占一个 WebGL 上下文（浏览器上限 ~16），
//      超了就保持静态图（功能不受影响，只是不动）；
//   2) 离开视口立即销毁（IntersectionObserver），不后台烧 GPU/电量；
//   3) 组件卸载（关掉选择器、离开名片）一定销毁，并用 held 标记保证名额只还一次。
//
// 用法：html`<${DynAvatar} cat=${cat} id=${avatarId} src=${可选，已解析好的静态图 url} />`
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { avatarSrc, avatarDyn } from '../../../shared/avatars.js';

/** 同时最多几个动态头像在播（选择器里 9 个 + 名片 1 个，所以 6 足够且留了余量）。 */
const MAX_LIVE = 6;
let liveCount = 0;

export function DynAvatar({ cat, id, src, alt = '', draggable = false, className = '', priority = false }) {
  const still = src === undefined ? avatarSrc(cat, id) : src;
  const dyn = avatarDyn(cat, id);
  const skel = dyn ? dyn.skel : null;
  const hostRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!skel) return undefined;
    const host = hostRef.current;
    if (!host) return undefined;
    let disposed = false;
    let starting = false;
    let app = null;
    let spine = null;
    let held = false;

    const stop = () => {
      // ★ 先还名额再做拆除：pixi-spine 销毁骨架时可能抛异常，绝不能让 liveCount 泄漏
      //   （踩过：关掉选择器后 6 个名额没还，名片上的动态头像就永远起不来）。
      const a = app;
      const sp = spine;
      app = null;
      spine = null;
      if (held) { held = false; liveCount = Math.max(0, liveCount - 1); }
      if (a && sp) { try { a.stage.removeChild(sp); } catch { /* ignore */ } }
      const view = a && a.view;
      if (view && view.parentNode) { try { view.parentNode.removeChild(view); } catch { /* ignore */ } }
      if (a) { try { a.destroy(true, { children: true }); } catch { /* ignore */ } }
      setPlaying(false);
    };

    /** 名额满了就等一会儿再试（最多几次），而不是永久放弃。 */
    const startWithRetry = (attempt = 0) => {
      if (disposed || app) return;
      const cap = priority ? MAX_LIVE + 2 : MAX_LIVE;
      if (liveCount >= cap) {
        if (attempt < 3) setTimeout(() => startWithRetry(attempt + 1), 1200);
        return;
      }
      start();
    };

    const start = async () => {
      if (disposed || app || starting) return;
      const cap = priority ? MAX_LIVE + 2 : MAX_LIVE;
      if (liveCount >= cap) return;               // 名额满了：保持静态首帧
      starting = true;
      held = true;
      liveCount++;
      try {
        const [assetsMod, pixiMod] = await Promise.all([
          import('../assets.js'),                   // 懒加载：静态头像永远不会付这份钱
          import('../render/app/pixi.js'),
        ]);
        await pixiMod.ensurePixi();
        const data = await assetsMod.loadSpineData({ skel });
        if (disposed) return;
        const PIXI = globalThis.PIXI;
        const box = host.getBoundingClientRect();
        const size = Math.max(32, Math.round(Math.max(box.width, box.height) || 64));
        app = new PIXI.Application({ width: size, height: size, backgroundAlpha: 0, antialias: true });
        app.view.className = 'dynav__cv';
        spine = new PIXI.spine.Spine(data);
        const anim = (data.animations || [])[0];
        if (anim) spine.state.setAnimation(0, anim.name, true);
        spine.update(0);                                 // 先摆到动画第一帧再量/定位
        app.stage.addChild(spine);

        // 贴法（用户 2026-10-13 两轮反馈后定稿）：
        //   1) 铺满：按骨架画布 cover（和静态头像的 object-fit: cover 一致，四边不留缝）；
        //   2) 居中：用 PIXI 自己的 getBounds()（**屏幕坐标**）算偏移，不去猜 pixi-spine 那个"向上"的 Y 轴；
        //   3) 素材自带的边：坠入清醒 / 凝视映像 的画面外多一圈白/浅灰底，量到分别是左侧 11.7%、顶部 12.8%
        //      （_garrison-list/add-dyn-avatars.mjs），所以按目录里的 dyn.zoom / dyn.dx / dyn.dy 再放大+平移，
        //      把那圈边顶出画面。
        //   ★ 运行时用像素去量（RenderTexture / extract.canvas）在这个环境里不可靠，试了三轮都不对，
        //     最终改成"离线量一次、写进 data/avatars.json"：稳、可复查、没有隐藏的兜底分支。
        const w0 = data.width || size;
        const h0 = data.height || size;
        const zoom = Number(dyn && dyn.zoom) > 0 ? Number(dyn.zoom) : 1;
        const s = Math.max(size / w0, size / h0) * 1.02 * zoom;
        spine.scale.set(s);
        spine.position.set(0, 0);
        try {
          const b = spine.getBounds();
          spine.position.set(size / 2 - (b.x + b.width / 2), size / 2 - (b.y + b.height / 2));
        } catch {
          spine.position.set(size / 2, size / 2);
        }
        if (dyn) {                                       // 平移：正值 = 把画面往右 / 往下推
          if (Number(dyn.dx)) spine.position.x += Number(dyn.dx) * size;
          if (Number(dyn.dy)) spine.position.y += Number(dyn.dy) * size;
        }
        app.render();                                    // 先出一帧再挂上去，避免闪一下空白
        host.appendChild(app.view);
        if (!disposed) setPlaying(true);
      } catch (e) {
        stop();                                          // 任何失败都安静退回静态图
      } finally {
        starting = false;
      }
    };

    const io = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
        for (const en of entries) { if (en.isIntersecting) startWithRetry(); else stop(); }
      }, { threshold: 0.2 })
      : null;
    if (io) io.observe(host); else startWithRetry();

    return () => { disposed = true; if (io) io.disconnect(); stop(); };
  }, [skel]);

  return html`<span class=${'dynav' + (className ? ' ' + className : '')} ref=${hostRef}>
    ${still ? html`<img class=${'dynav__still' + (playing ? ' is-off' : '')} src=${still} alt=${alt} draggable=${draggable} />` : null}
  </span>`;
}
