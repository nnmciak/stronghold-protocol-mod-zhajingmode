import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../server/data.js';
import { Match } from '../server/match/Match.js';
import { MetaRegistry } from '../server/match/effectsMeta.js';
import * as mujicaBond from '../server/sim/content/mujicaBond.js';

// 2026-10-25：颂乐人偶「每 10 次刷新送一名」的周期结算修复
//   旧逻辑只在 grantChess 成功时扣周期 → 满仓/空池时计数停在 >=10，之后每次刷新都重试，腾出位置后连发。
//   现在计数是 0..9 的周期进度，先结算再发奖；旧积压按取余规范（不补发）。
const ID = (code) => `chess_zj_${code}_a`;
const KEY = 'bond:mujica:refreshes';
const progress = (ps) => Number(ps.counters[KEY]) || 0;

function setup(t, { shopLevel = 2, multi = false, activate = true, normal = false } = {}) {
  const registry = new MetaRegistry();
  mujicaBond.registerMeta(registry);
  const seats = (multi ? ['p1', 'p2'] : ['p1']).map((playerId, seat) => ({
    seat, playerId, name: playerId, isBot: false, connected: true,
  }));
  const m = new Match({
    roomCode: 'MUJIR', mode: multi ? 'coop' : 'solo',
    difficulty: normal ? 'NORMAL' : 'ZHAJING',
    modeId: normal ? 'mode_single_normal' : (multi ? 'mode_multi_zhajing' : 'mode_single_zhajing'),
    seed: 11, data: getData(), registry, seats,
    send: () => true, broadcast: () => {}, onEnd: () => {},
  });
  t.after(() => m.dispose());
  m.phase = 'PREP'; m.round = 1;
  const ps = m.players.get('p1');
  ps.funds = 9999;
  ps.shop.level = shopLevel;
  const toasts = [];
  m.toast = (p, kind, text) => toasts.push(String(text));
  const cells = [...ps.deployMap()].filter(([, cls]) => cls === 'melee').map(([key]) => key);
  let i = 0;
  const idx = new Map();
  const put = (code, player = ps) => {
    const piece = player.newPiece('chess', code.startsWith('chess_') ? code : ID(code));
    const own = [...player.deployMap()].filter(([, cls]) => cls === 'melee').map(([key]) => key);
    const n = idx.get(player) || 0;
    idx.set(player, n + 1);
    player.board.set(own[n % own.length], piece);
    player.recompute();
    return piece;
  };
  if (activate) { put('oblvns'); put('mortis'); }
  return { m, ps, put, toasts };
}

const fill = (ps) => {
  for (let i = 0; i < ps.hand.length; i++) ps.hand[i] = ps.newPiece('item', 'chess_item_jibian_trophy');
  for (let i = 0; i < ps.temp.length; i++) ps.temp[i] = ps.newPiece('item', 'chess_item_jibian_trophy');
  ps.recompute();
};
const refresh = (ps, n) => { for (let i = 0; i < n; i++) assert.equal(ps.refresh().ok, true); };
const amorisPieces = (ps) => ps.allChess().filter((p) => String(p.id).startsWith('chess_zj_amoris'));

test('正常发放：连续 30 次刷新只在第 10/20/30 次各给一名，进度始终 0..9', (t) => {
  const { ps } = setup(t);
  const seen = [];
  for (let n = 1; n <= 30; n++) {
    assert.equal(ps.refresh().ok, true);
    assert.ok(progress(ps) >= 0 && progress(ps) < 10, `第 ${n} 次后进度 ${progress(ps)}`);
    if (progress(ps) === 0) seen.push(n);
  }
  console.log('发奖刷新:', JSON.stringify(seen), '| 若麦棋子数:', amorisPieces(ps).length);
  assert.deepEqual(seen, [10, 20, 30]);
  assert.ok(amorisPieces(ps).length >= 1);
});

test('两区全满且不能合成：只在第 10/20/30 次尝试并提示返还，库存不增加', (t) => {
  const { ps, m, toasts } = setup(t);
  fill(ps);
  const handBefore = ps.hand.filter(Boolean).length + ps.temp.filter(Boolean).length;
  for (let n = 1; n <= 30; n++) {
    assert.equal(ps.refresh().ok, true);
    assert.ok(progress(ps) >= 0 && progress(ps) < 10, `第 ${n} 次后进度 ${progress(ps)}`);
    // 只有周期点会尝试发放：非周期点不应新增返还提示
    if (![10, 20, 30].includes(n)) assert.equal(toasts.filter((x) => x.includes('返还')).length, [10, 20, 30].filter((k) => k < n).length);
  }
  const returns = toasts.filter((x) => x.includes('返还')).length;
  const handAfter = ps.hand.filter(Boolean).length + ps.temp.filter(Boolean).length;
  console.log('返还提示:', returns, '| 库存:', handBefore, '→', handAfter, '| 进度:', progress(ps));
  assert.equal(returns, 3, '只有 10/20/30 三次尝试');
  assert.equal(handAfter, handBefore, '实际库存不应增加');
});

test('旧计数迁移：10/20/100 → 归零，下一次合法刷新为 1；14 → 5', (t) => {
  for (const [old, want] of [[10, 1], [20, 1], [100, 1], [14, 5]]) {
    const { ps, toasts } = setup(t);
    ps.counters[KEY] = old;
    assert.equal(ps.refresh().ok, true);
    console.log(`旧 ${old} → 进度 ${progress(ps)}`);
    assert.equal(progress(ps), want, `旧计数 ${old}`);
    assert.equal(toasts.filter((x) => x.includes('返还')).length, 0);
  }
});

test('空卡池：周期仍结算，之后恢复库存也不会一刷一补', (t) => {
  const { ps, toasts } = setup(t, { shopLevel: 1 });
  refresh(ps, 20);
  assert.equal(progress(ps), 0, '第 20 次后仍是 0');
  assert.equal(toasts.filter((x) => x.includes('返还') || x.includes('获得')).length, 0);
  ps.shop.level = 2;
  assert.equal(ps.refresh().ok, true);
  assert.equal(progress(ps), 1, '恢复库存后从 1 重新计数，不补发');
});

test('事件过滤：未激活 / 普通模式 / 内部触发 / 刷新失败都不计入', (t) => {
  const inactive = setup(t, { activate: false }).ps;
  refresh(inactive, 5);
  assert.equal(progress(inactive), 0, '未激活盟约');

  const normal = setup(t, { normal: true }).ps;
  refresh(normal, 5);
  assert.equal(progress(normal), 0, '普通模式');

  const { m, ps } = setup(t);
  for (let i = 0; i < 10; i++) m.dispatch(ps, 'onRefresh', { trigger: true });
  assert.equal(progress(ps), 0, '内部触发刷新');

  ps.funds = 0;
  assert.ok(!ps.refresh().ok, '资金不足时刷新应失败');
  assert.equal(progress(ps), 0, '刷新失败不计数');
});

test('玩家隔离：一人满仓、一人有空位，进度与奖励互不影响', (t) => {
  const { m, ps, toasts, put } = setup(t, { multi: true });
  const p2 = m.players.get('p2');
  p2.funds = 9999; p2.shop.level = 2;
  put('oblvns', p2); put('mortis', p2);
  assert.equal(p2.bonds.mujicaShip && p2.bonds.mujicaShip.active, true, 'p2 也激活颂乐人偶');
  fill(ps);
  for (let i = 0; i < 10; i++) {
    assert.equal(ps.refresh().ok, true);
    assert.equal(p2.refresh().ok, true);
  }
  console.log('p1 进度', progress(ps), '| p2 进度', progress(p2), '| p2 棋子', amorisPieces(p2).length, '| 返还', toasts.filter((x) => x.includes('返还')).length);
  assert.equal(progress(ps), 0);
  assert.equal(progress(p2), 0);
  assert.equal(toasts.filter((x) => x.includes('返还')).length, 1, '只有满仓的 p1 提示返还');
  assert.ok(amorisPieces(p2).length >= 1, 'p2 正常拿到奖励');
});