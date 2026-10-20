// test-diy-routing.mjs — 验证外援(自选)的库存路由适配器。
//
// 背景:自选槽位是 isDiy,被 gd.visibleChess 排除,不在任何 pool 的 entries 里。
// 所以商店抽取要靠 roll() 的 extra 参数(已恢复),而拷贝记账要靠 poolOf(baseId) 路由到 diyStock。
// 这里直接构造一个带 diyStock 的 PlayerRules 实例来测路由,不依赖 Match 的自选加载路径。

import { PlayerRules } from '../server/match/player/rules.js';

const out = [];
const P = (...a) => out.push(a.join(''));
let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; P('  OK   ' + name); }
  else { fail++; P('  FAIL ' + name + (detail ? '  ← ' + detail : '')); }
};

// 造一个最小的宿主:只需要 m.gd + m.bannedChess,以及 diyStock
const gd = {
  visibleChess: ['chess_normal'],
  // SharedPool 的构造要读这两个(第 65/67 行);给个最小实现即可
  poolCopies: () => 5,
  tierOf: () => 1,
};
const host = Object.create(PlayerRules.prototype);
host.m = { gd, bannedChess: [] };
host.diyStock = {
  entries: new Map([
    ['chess_char_6_diy1_a', { cap: 5, left: 5, tier: 6, shopLevel: 6 }],
    ['chess_char_5_diy1_a', { cap: 8, left: 3, tier: 5, shopLevel: 5 }],
  ]),
  has(id) { return this.entries.has(id); },
};

P('=== 1) 外援 id 路由到 diyStock ===');
const p6 = host.poolOf('chess_char_6_diy1_a');
check('poolOf(外援) 返回适配器(有 take)', typeof p6.take === 'function');
check('has(外援) = true', p6.has('chess_char_6_diy1_a') === true);
check('left(外援) = 5', p6.left('chess_char_6_diy1_a') === 5);
check('cap(外援) = 5', p6.cap('chess_char_6_diy1_a') === 5);

P('');
P('=== 2) take() 扣的是 diyStock,不是自己的 pool ===');
const before = host.diyStock.entries.get('chess_char_6_diy1_a').left;
const taken = p6.take('chess_char_6_diy1_a', 1);
const after = host.diyStock.entries.get('chess_char_6_diy1_a').left;
check('take(1) 返回 1', taken === 1, 'returns ' + taken);
check('库存 5 → 4', after === before - 1, before + ' → ' + after);

P('');
P('=== 3) take() 不会取超额 ===');
const t2 = p6.take('chess_char_6_diy1_a', 999);
const left2 = host.diyStock.entries.get('chess_char_6_diy1_a').left;
check('take(999) 返回剩余 4', t2 === 4, 'returns ' + t2);
check('库存归 0', left2 === 0, 'left=' + left2);
check('再 take(1) 返回 0(空)', p6.take('chess_char_6_diy1_a', 1) === 0);

P('');
P('=== 4) give() 归还,封顶在 cap ===');
const g1 = p6.give('chess_char_6_diy1_a', 3);
check('give(3) 返回 3', g1 === 3, 'returns ' + g1);
check('库存 0 → 3', host.diyStock.entries.get('chess_char_6_diy1_a').left === 3);
const g2 = p6.give('chess_char_6_diy1_a', 999);
check('give(999) 只补到 cap(返回 2)', g2 === 2, 'returns ' + g2);
check('库存 = cap = 5', host.diyStock.entries.get('chess_char_6_diy1_a').left === 5);

P('');
P('=== 5) 5 阶槽位(剩余 3)独立记账 ===');
const p5 = host.poolOf('chess_char_5_diy1_a');
check('left(5阶) = 3', p5.left('chess_char_5_diy1_a') === 3);
p5.take('chess_char_5_diy1_a', 2);
check('take(2) 后 = 1', host.diyStock.entries.get('chess_char_5_diy1_a').left === 1);
check('6 阶槽位不受影响 = 5', host.diyStock.entries.get('chess_char_6_diy1_a').left === 5);

P('');
P('=== 6) 普通干员仍走玩家自己的池(不误伤) ===');
const pn = host.poolOf('chess_normal');
check('poolOf(普通) 不是适配器(无 diyStock 的 take 语义)', pn !== p6);
check('poolOf(普通) 是 SharedPool', pn && typeof pn.roll === 'function' && typeof pn._eligible === 'function');
check('普通池不含外援 id', pn.has('chess_char_6_diy1_a') === false);

P('');
P('=== 7) 没装自选时 poolOf 一律走玩家池 ===');
const host2 = Object.create(PlayerRules.prototype);
host2.m = { gd, bannedChess: [] };
host2.diyStock = { entries: new Map(), has() { return false; } };
const q = host2.poolOf('chess_char_6_diy1_a');
check('无库存时退化为普通池', q && typeof q.roll === 'function');

P('');
P('=== 8) entries 暴露给 invariants.js(它要遍历)===');
check('适配器有 entries', p6.entries instanceof Map);
check('entries 与外援库存同一份', p6.entries === host.diyStock.entries);

P('');
P('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.stdout.write(out.join('\n') + '\n');
process.exit(fail ? 1 : 0);
