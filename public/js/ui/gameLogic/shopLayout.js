// public/js/ui/gameLogic/shopLayout.js — 商店槽位的干员/装备分列（0.3.3 移植的纯逻辑）。
//
// 服务端在 `m.private.shop.layout` 下发 { chess, item }（PlayerViews），空槽没有 kind，
// 所以不能用 kind 反推列：第一期 5 级刚开放的装备栏是**空的**，按 kind 分会把它算进干员列。
// 没有 layout 的旧帧/假数据回退到旧的 kind 判定。

/** @returns {{ layout: {chess:number,item:number}|null, chessSlots: Array<{s:any,i:number}>, itemSlots: Array<{s:any,i:number}> }} */
export function shopColumns(shop) {
  const slots = Array.isArray(shop?.slots) ? shop.slots : [];
  const layout = Number.isInteger(shop?.layout?.chess) && Number.isInteger(shop?.layout?.item) ? shop.layout : null;
  const indexed = slots.map((s, i) => ({ s, i }));
  return {
    layout,
    chessSlots: indexed.filter(({ s, i }) => (layout ? i < layout.chess : !s || s.kind !== 'item')),
    itemSlots: indexed.filter(({ s, i }) => (layout ? i >= layout.chess && i < layout.chess + layout.item : s && s.kind === 'item')),
  };
}