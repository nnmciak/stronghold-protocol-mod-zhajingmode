// 惊变「？*/）层数/¥）dgxu」（jibian_cengshudaluan）—— 洗牌不得跨越"可叠加 / 不可叠加"。
// 运行（项目根）: node test/jibian-cengshu-nostack.test.mjs
//
// 用户 2026-10-17：「这个不要让他可以把可叠加的盟约跟不可叠加的盟约替换」。
// 数据依据：`data/bonds.json` 的 `noStack`。不可叠加的 4 个（调和 / 协防干员 / 独行 / 绝技）的
//   `perStackParams` 与 `layerMilestones` **都是空的** ⇒ 层数对它们没有任何效果
//   （前端 `bondStrip.js` 对它们直接显示「层数不显示」）。无差别洗牌会把这些层数白扔。
//
// 通过 `registerMeta(假 registry)` 拿到真实处理器 —— 不复制逻辑，测的就是跑在服务器上的那份。
import { registerMeta } from '../server/sim/content/jibian.js';

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const REF = 'jibian:jibian_cengshudaluan';
function handlerOf() {
  const reg = { seen: {}, register(name, defs) { this.seen[name] = defs; }, has: () => false };
  registerMeta(reg);
  const h = reg.seen[REF];
  return h && h.onRoundStart ? h.onRoundStart : null;
}

/** 假 ctx：只实现这个处理器用到的那几个口子（`bondIds` 读 `ctx.data.bonds` + `ctx.bonds()`）。 */
function fakeCtx(layers, noStack, { round = 5, seed = 1, active = null } = {}) {
  const calls = [];
  const isActive = (id) => (active ? !!active[id] : true);
  return {
    calls,
    /** 洗牌后每个盟约的层数 */
    result: () => ({ ...layers }),
    ctx: {
      data: { bonds: Object.fromEntries(Object.keys(layers).map((id) => [id, { bondId: id }])) },
      bonds: () => Object.fromEntries(Object.keys(layers).map((id) => [id, { active: isActive(id), count: 1 }])),
      bondActive: isActive,
      bondNoStack: (id) => !!noStack[id],
      layers: (id) => layers[id] || 0,
      setLayers: (id, n, opts) => { calls.push({ id, n, reason: opts?.reason }); layers[id] = n; },
      counter: () => 0,
      setCounter: () => {},
      toast: () => {},
      rng: {
        int: (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; },
      },
    },
  };
}

const SUM = (o, skip = () => false) => Object.entries(o).filter(([k]) => !skip(k)).reduce((s, [, v]) => s + v, 0);

console.log('=== ① 不可叠加盟约不参与洗牌（核心修复）===');
{
  const layers = { yanShip: 40, jinZhun: 30, tiaohe: 0, duXing: 0 };
  const noStack = { tiaohe: true, duXing: true };
  const s = fakeCtx(layers, noStack);
  const h = handlerOf();
  chk('拿到真实处理器 onRoundStart', typeof h === 'function');
  h(s.ctx, { round: 5 });
  console.log('     洗牌后: %s', JSON.stringify(s.result()));
  chk('★ 调和（不可叠加）层数仍为 0', s.result().tiaohe === 0, String(s.result().tiaohe));
  chk('★ 独行（不可叠加）层数仍为 0', s.result().duXing === 0, String(s.result().duXing));
  chk('★ 不可叠加的盟约**没有被 setLayers 写过**',
    !s.calls.some((c) => c.id === 'tiaohe' || c.id === 'duXing'),
    JSON.stringify(s.calls.map((c) => c.id)));
  chk('可叠加盟约的层数总和不变（40 + 30 = 70）',
    SUM(s.result(), (k) => noStack[k]) === 70, String(SUM(s.result(), (k) => noStack[k])));
}

console.log('\n=== ② 不可叠加的盟约即使已经带着层数，也不会被洗走 ===');
{
  const layers = { yanShip: 40, tiaohe: 7, duXing: 3 };
  const noStack = { tiaohe: true, duXing: true };
  const s = fakeCtx(layers, noStack);
  handlerOf()(s.ctx, { round: 5 });
  console.log('     洗牌后: %s', JSON.stringify(s.result()));
  chk('★ 调和保持 7（它自己的值没被拿去填坑）', s.result().tiaohe === 7, String(s.result().tiaohe));
  chk('★ 独行保持 3', s.result().duXing === 3, String(s.result().duXing));
  chk('可叠加盟约的层数总和不变（40）', s.result().yanShip === 40, String(s.result().yanShip));
}

console.log('\n=== ③ 可叠加盟约之间照常洗（功能没被削弱）===');
{
  const layers = { yanShip: 10, jinZhun: 20, aoShu: 30, xunJie: 40 };
  const s = fakeCtx(layers, {}, { seed: 7 });
  handlerOf()(s.ctx, { round: 5 });
  console.log('     洗牌后: %s', JSON.stringify(s.result()));
  const vals = Object.values(s.result()).sort((a, b) => a - b);
  chk('四个可叠加盟约的层数集合不变（只是分配被打乱）',
    JSON.stringify(vals) === JSON.stringify([10, 20, 30, 40]), JSON.stringify(vals));
  chk('确实发生了重排（不是原样）',
    JSON.stringify(Object.values(s.result())) !== JSON.stringify([10, 20, 30, 40]),
    JSON.stringify(Object.values(s.result())));
}

console.log('\n=== ④ 边界：只有 1 个可叠加盟约时不洗 ===');
{
  const layers = { yanShip: 40, tiaohe: 0 };
  const s = fakeCtx(layers, { tiaohe: true });
  handlerOf()(s.ctx, { round: 5 });
  chk('可叠加盟约不足 2 个 ⇒ 一次 setLayers 都不调', s.calls.length === 0, `${s.calls.length} 次`);
}

console.log('\n=== ⑤ 抽到这张卡的当回合不洗（原有行为保留）===');
{
  const layers = { yanShip: 10, jinZhun: 20 };
  const s = fakeCtx(layers, {});
  s.ctx.counter = () => 5;                       // cengFirst 已等于本回合
  handlerOf()(s.ctx, { round: 5 });
  chk('该回合不洗', s.calls.length === 0, `${s.calls.length} 次`);
}

console.log('\n=== ⑥ 未激活 / 隐藏的盟约也进洗牌池（2026-10-26 owner）===');
{
  // 炎 999 + 奥术 888 已激活；精准 0（有 1 名在场）；远见 0（未激活、隐藏）；卡西米尔 50（本模式外）
  const layers = { yanShip: 999, aoShu: 888, jinZhun: 0, yuanJian: 0, kasimier: 50 };
  const active = { yanShip: true, aoShu: true, jinZhun: true };
  const s = fakeCtx(layers, {}, { active });
  s.ctx.modeId = 'mode_single_zhajing';
  s.ctx.gd = { mode: () => ({ activeBondIds: ['yanShip', 'aoShu', 'jinZhun'], inactiveBondIds: ['yuanJian'] }) };
  handlerOf()(s.ctx, { round: 5 });
  console.log('     洗牌后: %s', JSON.stringify(s.result()));
  const ids = s.calls.map((c) => c.id);
  chk('★ 未激活/隐藏的远见参与洗牌', ids.includes('yuanJian'), ids.join(','));
  chk('★ 本模式外的卡西米尔不参与（保持 50）', s.result().kasimier === 50, String(s.result().kasimier));
  chk('★ 池内四者层数总和不变（999+888）', s.result().yanShip + s.result().aoShu + s.result().jinZhun + s.result().yuanJian === 1887);
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
