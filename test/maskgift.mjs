import { registerMeta } from '../server/sim/content/bonds/addon/meta.js';
const handlers = {};
const store = {
  bond: (id, h) => { handlers[id] = { ...(handlers[id] || {}), ...h }; },
};
const registry = new Proxy(store, { get: (t, k) => (k in t ? t[k] : () => {}) });
registerMeta(registry);
const h = handlers['mujicaShip'];
console.log('捕获的 bond 处理器:', Object.keys(handlers).length, '| 有 mujicaShip:', !!h);
if (!h || typeof h.onGain !== 'function') { console.log('FAIL'); process.exit(1); }
let granted = null, toasted = null, counter = null;
const ctx = {
  counter: () => (counter ? 1 : 0),
  setCounter: (k, v) => { counter = { k, v }; },
  grantItem: (id) => { granted = id; return true; },
  toast: (m, level) => { toasted = { m, level }; },
};
h.onGain(ctx, { kind: 'chess', piece: { id: 'chess_zj_amoris_b' } });
console.log('获得若麦 →', granted, '| 计数器', JSON.stringify(counter), '| toast', toasted && toasted.m);
granted = null;
h.onGain(ctx, { kind: 'chess', piece: { id: 'chess_zj_amoris_a' } });
console.log('再次获得 → grantItem 再调?', granted !== null, '(应 false)');
counter = null; granted = null;
h.onGain(ctx, { kind: 'chess', piece: { id: 'chess_zj_oblvns_a' } });
console.log('获得祥子 → grantItem 调用?', granted !== null, '(应 false)');
