// ui/perfHud.js — 性能浮层（owner 2026-10-20：「卡」要能看数字）。
//
// 按 `~`（反引号）开关，只在本地显示，不影响任何逻辑、不上报任何数据。
//
// 显示内容：
//   FPS / 帧耗时（p50、p95、最大）
//   WS 状态 + 往返延迟（net.snapshot().ping）
//   慢资源（> 400ms 的 fetch/文档请求，最近 5 条，带耗时）
//   JS 堆占用（Chromium 才有）
//
// 设计取舍：不 import 渲染层内部对象（避免耦合），只用 rAF 采样 + PerformanceObserver。

import { net } from '../net.js';

const SLOW_MS = 400;
const MAX_SLOW = 5;

let el = null;
let visible = false;
let rafId = 0;
let lastT = 0;
const frameMs = [];          // 最近 120 帧的耗时（ms）
const slow = [];             // { name, ms }

function ensureEl() {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'sp-perfhud';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = [
    'position:fixed', 'left:8px', 'top:120px', 'z-index:99999',
    'padding:8px 10px', 'border-radius:6px',
    'background:rgba(8,12,11,.86)', 'color:#9fe8c8',
    'font:11px/1.5 ui-monospace,Consolas,monospace',
    'white-space:pre', 'pointer-events:none',
    'box-shadow:0 4px 16px rgba(0,0,0,.5)',
    'border:1px solid rgba(120,240,210,.25)',
    'display:none',
  ].join(';');
  document.body.appendChild(el);
  return el;
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p))];
}

function sample(t) {
  if (lastT) {
    frameMs.push(t - lastT);
    if (frameMs.length > 120) frameMs.shift();
  }
  lastT = t;
  rafId = requestAnimationFrame(sample);
}

function render() {
  if (!visible || !el) return;
  const avg = frameMs.length ? frameMs.reduce((a, b) => a + b, 0) / frameMs.length : 0;
  const fps = avg > 0 ? 1000 / avg : 0;
  const p50 = pct(frameMs, 0.5);
  const p95 = pct(frameMs, 0.95);
  const worst = frameMs.length ? Math.max(...frameMs) : 0;
  const snap = (() => { try { return net.snapshot(); } catch { return {}; } })();
  const ping = Number.isFinite(snap.ping) ? snap.ping.toFixed(0) : '-';
  const mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) : '-';
  const slowTxt = slow.length
    ? slow.map((s) => `  ${s.ms.toFixed(0).padStart(5)}ms ${s.name}`).join('\n')
    : '  （暂无）';
  el.textContent =
    `FPS ${fps.toFixed(0)}  帧 ${avg.toFixed(1)}ms\n` +
    `p50 ${p50.toFixed(1)}  p95 ${p95.toFixed(1)}  max ${worst.toFixed(1)}\n` +
    `WS ${snap.status || '-'}  ping ${ping}ms\n` +
    `JS堆 ${mem}MB\n` +
    `慢资源(>${SLOW_MS}ms):\n${slowTxt}\n` +
    '（按 ~ 关闭）';
}

function slowObserver() {
  if (typeof PerformanceObserver !== 'function') return;
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration < SLOW_MS) continue;
        const name = String(e.name).replace(location.origin, '').split('?')[0];
        slow.unshift({ name: name.length > 42 ? name.slice(0, 42) + '…' : name, ms: e.duration });
        if (slow.length > MAX_SLOW) slow.length = MAX_SLOW;
      }
    });
    po.observe({ type: 'resource', buffered: true });
  } catch { /* 老浏览器忽略 */ }
}

function toggle() {
  visible = !visible;
  ensureEl().style.display = visible ? 'block' : 'none';
  if (visible) {
    frameMs.length = 0;
    lastT = 0;
    if (!rafId) rafId = requestAnimationFrame(sample);
  }
}

/** 装浮层（幂等）。按 `~` 开关。 */
export function installPerfHud() {
  if (typeof document === 'undefined' || installPerfHud.done) return;
  installPerfHud.done = true;
  ensureEl();
  slowObserver();
  addEventListener('keydown', (e) => {
    if (e.key === '`' || e.key === '~' || e.code === 'Backquote') {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      e.preventDefault();
      toggle();
    }
  });
  setInterval(render, 250);
}
