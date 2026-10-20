// 惊变「高卢银行支票」回归：+10 / 0 / -10 / +100 是**相对资金的增减量**，四档都要真的发生。
// 运行（项目根）: node test/jibian-cheque.test.mjs
//
// 用户 2026-10-17：「其实是在原有的基础上增加或减少 不是变成10或-10」。
// 修之前 `chequeSettle` 把掷点 `Math.max(0, …)` 钳掉、`jibianChequeValue` 又只认 `> 0`，
// 结果 -10 这一档整档消失（实测 20000 次掷点负金额 0 次），那张卡变成纯白给。
import { registerMeta } from '../server/sim/content/jibian.js';
import { PlayerState } from '../server/match/playerstate.js';

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const REF = 'jibian:jibian_gaoluzhipiao';
function hooksOf() {
  const reg = { seen: {}, register(n, d) { this.seen[n] = d; }, has: () => false };
  registerMeta(reg);
  return reg.seen[REF];
}

/** 假 ctx：只实现 onPrepStart / onBattleResult 用到的口子。 */
function fakeCtx(counters = {}, seed = 12345) {
  let s = seed;
  return {
    counters, playerId: 1,
    gd: { enemy: () => ({}) },
    counter: (k) => counters[k],
    setCounter: (k, v) => { counters[k] = v; },
    funds: () => 0, effects: () => [],
    rng: () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; },
  };
}

const H = hooksOf();

// ── ① 四档都要出现，且比例对得上
//     注：金额有 0 下限（用户：「基础为0吧还是 然后扣不到负数」），所以这里让卡先带一个高余额再掷一次，
//         用"掷后 − 掷前"读出这一掷的真实增量 —— 否则新卡掷到 -10 会被下限吃掉、测不到负档。
console.log('=== ① 掷点分布（20000 次 onPrepStart，从余额 1000 起掷以避开 0 下限）===');
{
  const N = 20000;
  const BASE = 1000;
  const tally = new Map();
  for (let i = 0; i < N; i++) {
    const ctx = fakeCtx({ 'jibian:gaoluzhipiao:value': BASE }, 1000 + i);
    H.onPrepStart(ctx);
    const delta = ctx.counters['jibian:gaoluzhipiao:value'] - BASE;
    tally.set(delta, (tally.get(delta) || 0) + 1);
  }
  const rows = [...tally.entries()].sort((a, b) => b[0] - a[0]);
  for (const [v, n] of rows) console.log('     %+5d : %6d 次  %6.2f%%', v, n, (n / N) * 100);
  const pct = (v) => (tally.get(v) || 0) / N * 100;
  chk('★ 出现了 -10 这一掷（原来被钳成 0，一次都没有）', (tally.get(-10) || 0) > 0, `${tally.get(-10) || 0} 次`);
  chk('★ -10 约占 33%', Math.abs(pct(-10) - 33.3) < 3, pct(-10).toFixed(2) + '%');
  chk('+10 约占 33%', Math.abs(pct(10) - 33.3) < 3, pct(10).toFixed(2) + '%');
  chk('0 约占 33%（不再混进 -10）', Math.abs(pct(0) - 33.3) < 3, pct(0).toFixed(2) + '%');
  chk('+100 约占 0.1%', Math.abs(pct(100) - 0.1) < 0.1, pct(100).toFixed(3) + '%');
}

// ── ①b **累加**：每回合是在原有金额上增加/减少，不是覆盖
//     用户 2026-10-17：「其实是在原有的基础上增加或减少 不是变成10或-10」+「之前是不是不能叠加到20」
console.log('\n=== ①b 金额累加（确定性：用固定 rng 值控制每一掷）===');
{
  // chequeRoll：r = rng()*100；
  //   r < 0.1 → +100 ；(r-0.1)/99.9*total < up → +10 ；< up+zero → 0 ；否则 → -10（初始 33/33/33，total 99）
  const R_UP = 0.2;      // → +10
  const R_ZERO = 0.5;    // → 0
  const R_DOWN = 0.8;    // → -10
  const R_JACK = 0.0005; // → +100
  const counters = {};
  const roll = (r) => {
    const ctx = fakeCtx(counters, 1);
    ctx.rng = () => r;                      // 固定这一掷
    H.onPrepStart(ctx);
    return counters['jibian:gaoluzhipiao:value'];
  };
  const seq = [];
  seq.push(['+10', roll(R_UP)]);
  seq.push(['+10', roll(R_UP)]);
  seq.push(['-10', roll(R_DOWN)]);
  seq.push(['0', roll(R_ZERO)]);
  seq.push(['+100', roll(R_JACK)]);
  console.log('     依次 %s', seq.map(([k, v]) => `${k}→${v}`).join('  '));
  chk('★ 第 1 次 +10 → 金额 10', seq[0][1] === 10, String(seq[0][1]));
  chk('★ 第 2 次 +10 → 金额 **20**（能叠加了！原来被覆盖成 10）', seq[1][1] === 20, String(seq[1][1]));
  chk('★ 第 3 次 -10 → 金额 10（在原基础上减少）', seq[2][1] === 10, String(seq[2][1]));
  chk('第 4 次 0 → 金额不变（仍 10）', seq[3][1] === 10, String(seq[3][1]));
  chk('第 5 次 +100 → 金额 110', seq[4][1] === 110, String(seq[4][1]));

  // ★ 下限 0：新卡第一掷就是 -10 → 停在 0，不能是负数
  const c2 = {};
  const roll2 = (r) => {
    const ctx = fakeCtx(c2, 1);
    ctx.rng = () => r;
    H.onPrepStart(ctx);
    return c2['jibian:gaoluzhipiao:value'];
  };
  const neg = [roll2(R_DOWN), roll2(R_DOWN), roll2(R_DOWN)];
  console.log('     新卡连续三次 -10 → %s', JSON.stringify(neg));
  chk('★ 基础为 0：第一掷 -10 停在 0（不是 -10）', neg[0] === 0, String(neg[0]));
  chk('★ 扣不到负数：连续三次 -10 仍是 0', neg.every((v) => v === 0), JSON.stringify(neg));
  // 有余额时才真的扣
  const a = roll2(R_UP);          // +10 → 10
  const b = roll2(R_UP);          // +10 → 20
  const c = roll2(R_DOWN);        // -10 → 10
  const d = roll2(R_DOWN);        // -10 → 0
  const e = roll2(R_DOWN);        // -10 → 停在 0
  console.log('     +10→%d +10→%d -10→%d -10→%d -10→%d', a, b, c, d, e);
  chk('有余额时 -10 真的扣（20 → 10）', c === 10 && b === 20, `${b} → ${c}`);
  chk('扣到 0 就停（10 → 0 → 0）', d === 0 && e === 0, `${d}, ${e}`);
}

// ── ② 权重：击杀推高 +10、漏怪推高 -10，三项之和恒为 99
console.log('\n=== ② 战斗结果推高对应权重 ===');
{
  const ctx = fakeCtx({}, 777);
  H.onPrepStart(ctx);
  const read = () => ['w10', 'w0', 'wm10'].map((k) => ctx.counters['jibian:gaoluzhipiao:' + k]);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const w0 = read();
  H.onBattleResult(ctx, { result: { killed: 5, leaked: [], unite: null } });
  const w1 = read();
  chk('杀 5 只：+10 权重 33 → 43', Math.abs(w1[0] - 43) < 1e-6, `${w0[0]} → ${w1[0]}`);
  chk('三项之和仍是 99', Math.abs(sum(w1) - 99) < 1e-6, String(sum(w1)));
  H.onBattleResult(ctx, { result: { killed: 0, leaked: [{ enemyKey: 'e1', counted: true }, { enemyKey: 'e2', counted: true }], unite: null } });
  const w2 = read();
  chk('漏 2 只：-10 权重再 +1（2 × 0.5）', Math.abs(w2[2] - (w1[2] + 1)) < 1e-6, `${w1[2]} → ${w2[2]}`);
  chk('三项之和仍是 99', Math.abs(sum(w2) - 99) < 1e-6, String(sum(w2)));
}

// ── ③ 提现：负数要真的扣钱，且消耗这张卡
console.log('\n=== ③ 提现（PlayerState.cashCheque）===');
{
  /** 最小 this：只提供 cashCheque / jibianChequeValue 用到的东西。 */
  function fakePS(value, { funds = 100 } = {}) {
    const ps = {
      counters: { 'jibian:gaoluzhipiao:value': value, 'jibian:gaoluzhipiao:w10': 40 },
      effects: [{ key: 'jibian:jibian_gaoluzhipiao' }, { key: 'jibian:other' }],
      funds,
      stats: { fundsGained: 0 },
      toasts: [],
      _gate: () => null,
      dirty: () => {},
      m: { toast: (self, kind, msg) => { self.toasts.push(msg); } },
      jibianHas: (id) => ps.effects.some((e) => e.key === 'jibian:' + id),
    };
    ps.jibianChequeValue = () => PlayerState.prototype.jibianChequeValue.call(ps);
    ps.addFunds = (n) => PlayerState.prototype.addFunds.call(ps, n, { reason: 'jibian' });
    return ps;
  }
  const cash = (ps) => PlayerState.prototype.cashCheque.call(ps);

  {
    const ps = fakePS(10);
    const before = ps.funds;
    cash(ps);
    chk('+10：资金 100 → 110', ps.funds === before + 10, `${before} → ${ps.funds}`);
    chk('+10：卡片被消耗', !ps.jibianHas('jibian_gaoluzhipiao'));
  }
  {
    const ps = fakePS(-10);
    const before = ps.funds;
    chk('-10：jibianChequeValue 返回 -10（不再被钳成 0）', ps.jibianChequeValue() === -10, String(ps.jibianChequeValue()));
    cash(ps);
    chk('★ -10：资金 100 → 90（真的扣钱）', ps.funds === before - 10, `${before} → ${ps.funds}`);
    chk('-10：卡片被消耗', !ps.jibianHas('jibian_gaoluzhipiao'));
    chk('-10：提示写的是负数', (ps.toasts[0] || '').includes('-10'), ps.toasts[0] || '');
  }
  {
    const ps = fakePS(-10, { funds: 5 });
    cash(ps);
    chk('资金不足时扣到 0 为止，不变负', ps.funds === 0, String(ps.funds));
  }
  {
    const ps = fakePS(0);
    const before = ps.funds;
    const r = cash(ps);
    chk('0：拒绝提现（不消耗卡，下回合重掷）', r !== undefined && ps.jibianHas('jibian_gaoluzhipiao') && ps.funds === before,
      `funds=${ps.funds} has=${ps.jibianHas('jibian_gaoluzhipiao')}`);
  }
  {
    const ps = fakePS(100);
    const before = ps.funds;
    cash(ps);
    chk('+100：资金 100 → 200', ps.funds === before + 100, `${before} → ${ps.funds}`);
  }
}

// ── ④ 提现后概率归回初始
console.log('\n=== ④ 提现后概率清零 ===');
{
  const ps = {
    counters: { 'jibian:gaoluzhipiao:value': 10, 'jibian:gaoluzhipiao:w10': 55, 'jibian:gaoluzhipiao:w0': 20, 'jibian:gaoluzhipiao:wm10': 24 },
    effects: [{ key: 'jibian:jibian_gaoluzhipiao' }],
    funds: 0, stats: { fundsGained: 0 }, toasts: [],
    _gate: () => null, dirty: () => {},
    m: { toast: (s, k, msg) => { s.toasts.push(msg); } },
    jibianHas: (id) => ps.effects.some((e) => e.key === 'jibian:' + id),
  };
  ps.jibianChequeValue = () => PlayerState.prototype.jibianChequeValue.call(ps);
  ps.addFunds = (n) => PlayerState.prototype.addFunds.call(ps, n, { reason: 'jibian' });
  PlayerState.prototype.cashCheque.call(ps);
  const w = ['w10', 'w0', 'wm10'].map((k) => ps.counters['jibian:gaoluzhipiao:' + k]);
  chk('三项权重归回 33/33/33', JSON.stringify(w) === JSON.stringify([33, 33, 33]), JSON.stringify(w));
  chk('金额清零', ps.counters['jibian:gaoluzhipiao:value'] === 0, String(ps.counters['jibian:gaoluzhipiao:value']));
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
