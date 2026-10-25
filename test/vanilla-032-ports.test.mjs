import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 0.3.2 移植自检：战斗/观战期间屏幕常亮
test('设备模块提供 Wake Lock，并在战斗阶段启用', () => {
  const dev = fs.readFileSync(new URL('../public/js/ui/device.js', import.meta.url), 'utf8');
  assert.match(dev, /export function installScreenWakeLock/);
  assert.match(dev, /export function useScreenWakeLock/);
  assert.match(dev, /wakeLock\.request\('screen'\)/);
  const main = fs.readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /useScreenWakeLock\(combatActive\)/);
  assert.match(main, /isCombatPhase\(s\.match\?\.public\?\.phase\)/);
});
// 0.3.2 移植自检：干员调配按真实阶段画精英图标 + 行内空白选人
test('干员调配使用 PromotionIcon（真实 status.phase），行内空白可点选', () => {
  const gc = fs.readFileSync(new URL('../public/js/ui/gameComponents.js', import.meta.url), 'utf8');
  assert.match(gc, /export function PromotionIcon/);
  const lo = fs.readFileSync(new URL('../public/js/screens/loadout.js', import.meta.url), 'utf8');
  assert.match(lo, /phase=\$\{chess\.status\?\.phase\}/);
  assert.match(lo, /closest\?\.\('button, select, input'\)/);
});

// 2026-10-26（owner）：商店栏半透明取消
test('商店栏恢复完全不透明', () => {
  const css = fs.readFileSync(new URL('../public/css/screens/game-shop.css', import.meta.url), 'utf8');
  assert.ok(!/--shop-alpha\s*:/.test(css), '半透明变量定义应已移除');
  assert.ok(!/opacity: var\(--shop-alpha\)/.test(css));
});

test('点空白关闭盟约弹层（0.3.2 移植）', () => {
  const g = fs.readFileSync(new URL('../public/js/screens/game.js', import.meta.url), 'utf8');
  assert.match(g, /closest\?\.\('\.bpop, \.bslot, \.dbond'\)/);
  assert.match(g, /setBondOpen\(null\)/);
});

test('HUD：普通模式保留右侧 buff 栏（炸惊隐藏），下面/左边把手删除', () => {
  const g = fs.readFileSync(new URL('../public/js/screens/game.js', import.meta.url), 'utf8');
  assert.match(g, /gm__effects/, '普通模式仍要渲染效果列');
  assert.match(g, /import \{ EffectsList \}/);
  assert.match(g, /includes\('zhajing'\)/, '效果列要按炸惊模式条件隐藏');
  const c = fs.readFileSync(new URL('../public/js/ui/collapsePanels.js', import.meta.url), 'utf8');
  assert.ok(!c.includes("id: 'detail'") && !c.includes("id: 'shopbar'"), '下面/左边的把手应已移除');
  assert.match(c, /id: 'effects'/, '右侧效果列把手要保留（普通模式用）');
  assert.match(c, /id: 'bonds'/);
  assert.match(c, /REMOVED = \['detail', 'shopbar'\]/);
});
