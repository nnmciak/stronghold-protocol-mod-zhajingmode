// 「首次获得 X → 获得对应装备」三条（S.E.E.S.txt，用户：这三条也是盟约效果）
// 运行（项目根）: node test/sees-first-gift.test.mjs
//
// 实现：server/sim/content/bonds/addon/meta.js 的 registry.bond('seesShip', { onGain })
//   触发点 = server/match/player/acquire.js:85（玩家获得干员时派发 ev = { piece, kind, source }）
//   闩锁   = 玩家计数器 bondaddon:sees:gift:<kormr|yukari|aigis>
import { registerMeta } from '../server/sim/content/bonds/addon/meta.js';

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

// 收集 registry 注册出来的东西
const bonds = {}, globals = {};
const registry = {
  global: (id, h) => { globals[id] = h; },
  bond: (id, h) => { bonds[id] = { ...(bonds[id] || {}), ...h }; },
  // 其它注册（garrison / jibian …）不需要，给个兜底
  jibian: () => {}, garrison: () => {}, effect: () => {},
};
registerMeta(registry);

const hook = bonds.seesShip && bonds.seesShip.onGain;
chk('seesShip 注册了 onGain', typeof hook === 'function', typeof hook);

/** 造一个只带我们需要的那几个上下文的假 ctx。 */
function makeCtx() {
  const counters = new Map(), items = [], toasts = [];
  return {
    counters, items, toasts,
    counter: (k) => counters.get(k) ?? 0,
    setCounter: (k, v) => { counters.set(k, v); },
    grantItem: (id) => { items.push(id); return { id }; },
    toast: (t) => { toasts.push(t); },
  };
}
const gain = (ctx, id) => hook(ctx, { piece: { id }, kind: 'chess', source: 'buy' });

console.log('=== ① 首次获得虎狼丸 → 袖章 ===');
{
  const ctx = makeCtx();
  gain(ctx, 'chess_zj_60_2_a');
  chk('★ 发了袖章', ctx.items.includes('chess_item_sees_armband_a'), JSON.stringify(ctx.items));
  chk('有提示', ctx.toasts.length === 1, ctx.toasts[0] || '');
}

console.log('\n=== ② 同一人再获得一次 → 不重复发 ===');
{
  const ctx = makeCtx();
  gain(ctx, 'chess_zj_60_2_a');
  gain(ctx, 'chess_zj_60_2_a');
  gain(ctx, 'chess_zj_60_2_b');   // 精锐也算同一个人
  chk('★ 只发一次', ctx.items.length === 1, JSON.stringify(ctx.items));
}

console.log('\n=== ③ 由加莉 / 埃癸斯 各发各的 ===');
{
  const ctx = makeCtx();
  gain(ctx, 'chess_zj_60_4_a');
  gain(ctx, 'chess_zj_60_3_b');
  chk('★ 由加莉 → 校服', ctx.items.includes('chess_item_sees_uniform_a'), JSON.stringify(ctx.items));
  chk('★ 埃癸斯 → 召唤器', ctx.items.includes('chess_item_sees_evoker_a'), JSON.stringify(ctx.items));
  chk('共 2 件', ctx.items.length === 2);
}

console.log('\n=== ④ 无关干员 / 获得物品 不触发 ===');
{
  const ctx = makeCtx();
  gain(ctx, 'chess_zj_01_a');
  hook(ctx, { piece: { id: 'chess_item_sees_armband_a' }, kind: 'item', source: 'buy' });
  chk('★ 什么都没发', ctx.items.length === 0, JSON.stringify(ctx.items));
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
