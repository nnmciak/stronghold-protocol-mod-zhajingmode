import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getData } from '../server/data.js';
import { Match } from '../server/match/Match.js';
import { shopColumns } from '../public/js/ui/gameLogic/shopLayout.js';

// 0.3.3 移植自检：商店布局分列 / 空栏位 / 整备区满时互换 / 装备图标按 URL 缓存
function setup(t, { multi = false } = {}) {
  const seats = (multi ? ['p1', 'p2'] : ['p1']).map((playerId, seat) => ({ seat, playerId, name: playerId, isBot: false, connected: true }));
  const m = new Match({ roomCode: 'V33', mode: multi ? 'coop' : 'solo', difficulty: 'ZHAJING',
    modeId: multi ? 'mode_multi_zhajing' : 'mode_single_zhajing', data: getData(), seed: 13, seats,
    send: () => true, broadcast: () => {}, onEnd: () => {} });
  t.after(() => m.dispose());
  m.phase = 'PREP'; m.round = 1;
  return { m, ps: m.players.get('p1') };
}

test('shopColumns：按 layout 分列，空装备槽留在装备列', () => {
  const chess = (id) => ({ kind: 'chess', id });
  const item = (id) => ({ kind: 'item', id });
  const withLayout = shopColumns({ layout: { chess: 3, item: 1 }, slots: [chess('a'), chess('b'), chess('c'), null] });
  assert.equal(withLayout.chessSlots.length, 3);
  assert.equal(withLayout.itemSlots.length, 1);
  assert.equal(withLayout.itemSlots[0].s, null, '空槽要留在装备列，不能混进干员列');

  const noLayout = shopColumns({ slots: [chess('a'), item('x'), null] });
  assert.equal(noLayout.layout, null);
  assert.equal(noLayout.chessSlots.length, 2);
  assert.equal(noLayout.itemSlots.length, 1);

  const noItems = shopColumns({ layout: { chess: 5, item: 0 }, slots: Array.from({ length: 5 }, () => null) });
  assert.equal(noItems.itemSlots.length, 0, '装备栏没开放时不应有装备列');
});

test('私有视图下发 shop.layout，且随调度中心升级更新', (t) => {
  const { m, ps } = setup(t);
  const view1 = ps.privateView();
  assert.deepEqual(view1.shop.layout, m.gd.shopSlots(ps.shop.level));
  ps.funds = 99;
  assert.equal(ps.levelUp().ok, true);
  const view2 = ps.privateView();
  assert.deepEqual(view2.shop.layout, m.gd.shopSlots(ps.shop.level), '升级后 layout 要跟着变');
  assert.ok(view2.shop.slots.length >= 3);
});

test('整备区满时，手里最后一张干员仍可与场上干员互换', (t) => {
  const { m, ps } = setup(t);
  const cells = [...ps.deployMap()].filter(([, cls]) => cls === 'melee').map(([k]) => k);
  const onBoard = ps.newPiece('chess', 'chess_char_5_02_a');
  ps.board.set(cells[0], onBoard);
  // 手牌填满，只留一个位置给要拖动的干员
  for (let i = 0; i < ps.hand.length; i++) ps.hand[i] = ps.newPiece('item', 'chess_item_jibian_trophy');
  const mover = ps.newPiece('chess', 'chess_char_1_01_a');
  ps.hand[0] = mover;
  ps.recompute();
  assert.equal(ps.hand.filter(Boolean).length, ps.hand.length, '手牌应已满');
  const [r, c] = cells[0].split(',').map(Number);
  const res = ps.move(mover.uid, { area: 'board', row: r, col: c, dir: 'RIGHT' });
  console.log('互换结果:', JSON.stringify(res), '| 手牌数:', ps.hand.filter(Boolean).length);
  assert.equal(res.ok, true, '整备区满时互换应被允许');
  assert.equal(ps.board.get(cells[0]).uid, mover.uid);
  assert.ok(ps.hand.some((p) => p && p.uid === onBoard.uid), '被换下的干员应回到手牌空出的那格');
});

test('装备图标按图片地址缓存（切版本/皮肤不会沿用旧图）', () => {
  const s = fs.readFileSync(new URL('../public/js/render/units.js', import.meta.url), 'utf8');
  const setIcon = s.slice(s.indexOf('  setIcon(url) {'), s.indexOf('  setIcon(url) {') + 900);
  assert.ok(setIcon.includes('itemTexture(url') || setIcon.includes("itemTexture(url || 'none'"), '贴图缓存键应是图片地址');
  assert.ok(!setIcon.includes('itemTexture(String(this.info.defId)'), '不能再用 defId 当缓存键');
});