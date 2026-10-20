// keyed 官方 prefab 实例（SkillFx._keyed）：一个实例被 kit 的报告**原地移动**，而不是每条报告重建一次。
// 运行（项目根）: node test/fx-keyed-instances.test.mjs
//
// 为什么（owner 2026-10-17）：「三技能的龙只有龙头」。赤刃明霄陈 S3 的波在 op-chen3.js 里每 0.12 s 发一条
//   battle.fx('chen3Wave', { x, y, fromX, fromY, dr, dc, id, skill })，而渲染层每条报告都新起一个官方 prefab
//   实例 ⇒ 什么都活不过 0.12 s ⇒ 粒子与拖尾永远累积不成龙身。
// 本测试不碰浏览器：用一个假的 FxWiring（playOn 记下 key / opts / 落点）直接驱动 SkillFx.simFx，验证
//   ① 第一条报告新建四个官方 prefab（loop + important + 我们的 track）
//   ② 第二条报告（fromX/fromY = 上一条的点）**不新建**，只把实例挪过去、按 dr/dc 转向
//   ③ fromX/fromY 离实例很远（重开一次技能）→ 新实例，旧的停掉（否则龙身会横穿整场）
//   ④ 报告没有 fromX/fromY → 每条都新建（= 原来的行为，其它干员的老路）
//   ⑤ kit 不再报告 → KEYED_HOLD_S 超时后实例自己停掉
//   ⑥ 其它绑定 / 其它干员 / 没有绑定：返回值与行为都不变（这是「不破坏别人」的保证）
//   ⑦ 官方素材一个都没装 → 返回 false，让 kinds.js 的自制月牙刃照旧播
//   ⑧ 数据侧：skchr_chen3_3.chen3Wave 绑定本身（四个 key、keyed/during/at、预载清单、FX_COVER 不含它）
//   ⑨ 四个 prefab 过真编译器（effect.compileEffect）—— 证明为什么必须自己接管 track 与 facing
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SkillFx } from '../public/js/render/vfx/skillfx.js';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const idx = JSON.parse(readFileSync(join(ROOT, 'public/assets/local/fx/index.json'), 'utf8'));
const has = (k) => !!idx.prefabs[String(k).toLowerCase()];

function makeFx() {
  const plays = [];
  const ofx = { active: true, time: 0, tier: 'full', lib: { has, def: () => null } };
  const w = {
    idx, ofx,
    playOn(key, v, o = {}) {
      const h = {
        key: String(key).toLowerCase(), v, o, alive: true, stopped: false, placeArgs: {},
        place(p) { Object.assign(this.placeArgs, p); return this; },
        stop() { this.stopped = true; this.alive = false; },
      };
      plays.push(h);
      return h;
    },
    view: (id) => (id === 7 ? { id: 7, x: 5, y: 5, z: 0 } : null),
    unitOf: () => null,
    formOf: () => null,
    opts: {},
    _dirIndex: () => 1,
  };
  const fx = new SkillFx(w);
  // the record `of()` would build for 赤刃明霄陈 with S3 (bypasses the index / plan resolution, which needs a battle)
  fx.units.set(7, {
    id: 7, v: { id: 7, x: 5, y: 5, z: 0 }, key: 'char_1050_chen3', skillId: 'skchr_chen3_3',
    plan: { kind: 'active', pulse: [], start: [], loop: [], range: [], attacks: [], cond: [], ready: [] },
    srec: { bb: {} }, on: true, startFrame: -1, offAt: -Infinity, ewin: null, loops: [], ready: [], slotLoops: [],
    enemy: [], enemySlots: 0,
  });
  return { fx, plays, ofx };
}

const wave = (o = {}) => ({ x: 5, y: 5, dr: 0, dc: 1, id: 7, skill: 'chen3:wave', ...o });
// 2026-10-17：生产绑定里去掉了 weapon_01（手部挂件，跟波飞不对且白烧渲染），这里跟着改成 3 个。
//   weapon 的 FollowMountPoint 断言（下面 184/186 行）保留 —— 那是 prefab 元数据的事实，与绑定无关。
const KEYS = ['chen3_skill_03_trail_01'];   // 2026-10-17：buff_L/R 移到 dash（贴在她身边），keyed 只剩 trail
const sorted = (a) => JSON.stringify([...a].sort());

console.log('=== ① 第一条报告：新建 4 个实例（绑定里的四个 prefab）===');
{
  const { fx, plays } = makeFx();
  const drew = fx.simFx('chen3Wave', 5, 5, wave({ fromX: 5, fromY: 5 }));
  chk('simFx 返回 true（自制特效让位）', drew === true);
  chk(`播了 ${KEYS.length} 个 handle`, plays.length === KEYS.length, `实际 ${plays.length}`);
  chk('key 正是绑定里的四个', sorted(plays.map((h) => h.key)) === sorted(KEYS), plays.map((h) => h.key).join(','));
  chk('全部 loop + important（不会被上限丢掉）', plays.every((h) => h.o.loop && h.o.important));
  chk('全部带 track（锚点由我们接管）', plays.every((h) => typeof h.o.track === 'function'));
  chk('全部播在 board 点（不是她身上）', plays.every((h) => h.v && h.v.id === 'fx:point' && h.v.x === 5 && h.v.y === 5));
  chk('keyed 表里 1 条', fx.keyed.size === 1);
}

console.log('\n=== ② 第二条报告（fromX/fromY = 上一次的点）：原地复用 ===');
{
  const { fx, plays, ofx } = makeFx();
  fx.simFx('chen3Wave', 5, 5, wave({ fromX: 5, fromY: 5 }));
  ofx.time = 0.12;
  const drew = fx.simFx('chen3Wave', 5.18, 5, wave({ x: 5.18, fromX: 5, fromY: 5 }));
  chk('返回 true', drew === true);
  chk(`没有新建 handle（共 ${KEYS.length} 个）`, plays.length === KEYS.length, `实际 ${plays.length}`);
  const k = fx.keyed.get('7|chen3Wave');
  chk('实例被移动到 x=5.18', !!k && Math.abs(k.st.x - 5.18) < 1e-9, k ? String(k.st.x) : 'no entry');
  chk('yaw = atan2(dr,dc) = 0（向右）', !!k && k.st.yaw === 0, k ? String(k.st.yaw) : '');
  chk('until 被顺延', !!k && k.until > 0.12);
  chk('track 把 handle 放到 Unity 坐标并清掉 mountRot', (() => {
    const fx0 = { anchor: [0, 0, 0], yaw: 1, mountRot: [0, 0, 0, 1] };
    k.hs[0].o.track(fx0);
    return Math.abs(fx0.anchor[0] - (5.18 - 10)) < 1e-9 && Math.abs(fx0.anchor[1] - (5 - 9)) < 1e-9 && fx0.anchor[2] === 0
      && fx0.yaw === 0 && fx0.mountRot === null;
  })());
  ofx.time = 0.24;
  fx.simFx('chen3Wave', 5.18, 5.18, wave({ x: 5.18, y: 5.18, fromX: 5.18, fromY: 5, dr: 1, dc: 0 }));
  chk('转向：dr=1,dc=0 → yaw=π/2', Math.abs(k.st.yaw - Math.PI / 2) < 1e-9, String(k.st.yaw));
}

console.log('\n=== ③ 报告里 fromX/fromY 离实例很远（重开一次技能）：新实例，旧的停掉 ===');
{
  const { fx, plays, ofx } = makeFx();
  fx.simFx('chen3Wave', 5, 5, wave({ fromX: 5, fromY: 5 }));
  const old = [...plays];
  ofx.time = 0.12;
  fx.simFx('chen3Wave', 2, 8, wave({ x: 2, y: 8, fromX: 2, fromY: 8 }));
  chk(`新建了 ${KEYS.length} 个（共 ${KEYS.length * 2}）`, plays.length === KEYS.length * 2, `实际 ${plays.length}`);
  chk('旧的 4 个都停掉', old.every((h) => h.stopped));
  const k = fx.keyed.get('7|chen3Wave');
  chk('表里仍只有 1 条，且是新位置', fx.keyed.size === 1 && Math.abs(k.st.x - 2) < 1e-9);
}

console.log('\n=== ④ 报告没有 fromX/fromY（kit 不报运动）：每条都新建（= 原来的行为）===');
{
  const { fx, plays, ofx } = makeFx();
  fx.simFx('chen3Wave', 5, 5, wave({}));
  ofx.time = 0.12;
  fx.simFx('chen3Wave', 5.18, 5, wave({ x: 5.18 }));
  chk(`两条报告各建 ${KEYS.length} 个（共 ${KEYS.length * 2}）`, plays.length === KEYS.length * 2, `实际 ${plays.length}`);
}

console.log('\n=== ⑤ 超时：kit 不再报告 → 实例自己停掉 ===');
{
  const { fx, plays, ofx } = makeFx();
  fx.simFx('chen3Wave', 5, 5, wave({ fromX: 5, fromY: 5 }));
  ofx.time = 0.4;
  fx.sync([{ id: 7, x: 5, y: 5, z: 0, alive: true }]);
  chk('0.4 s 时还活着', fx.keyed.size === 1 && !plays.some((h) => h.stopped));
  ofx.time = 0.7;
  fx.sync([{ id: 7, x: 5, y: 5, z: 0, alive: true }]);
  chk('0.7 s（> KEYED_HOLD_S）后停掉并清表', fx.keyed.size === 0 && plays.every((h) => h.stopped));
}

console.log('\n=== ⑥ 退回原行为：其它绑定 / 其它干员完全照旧 ===');
{
  const { fx, plays } = makeFx();
  // chen3 S3 的 slash（at: 'target'）仍然走 _bound：命中点在目标身上
  const drew = fx.simFx('slash', 3, 3, { x: 3, y: 3, id: 7, n: 1, skill: 'chen3:wave', target: 99 });
  chk('slash 返回 true', drew === true);
  chk('slash 播 chen3_skill_03_hit_01', plays.length === 1 && plays[0].key === 'chen3_skill_03_hit_01', plays.map((h) => h.key).join(','));
  chk('slash 没有进 keyed 表', fx.keyed.size === 0);
  chk('未绑定的 kind 返回 false（自制照旧）', fx.simFx('chen3Wave2', 5, 5, wave({})) === false);
}
{
  // 换成别的干员（没有 chen3Wave 绑定）：不接管
  const { fx } = makeFx();
  fx.units.set(7, { ...fx.units.get(7), skillId: 'skchr_makoto_1' });
  chk('别的技能没有此绑定 → false', fx.simFx('chen3Wave', 5, 5, wave({ fromX: 5, fromY: 5 })) === false);
  chk('keyed 表仍空', fx.keyed.size === 0);
}

console.log('\n=== ⑦ 官方素材缺失：退回自制（false），不登记实例 ===');
{
  const { fx, plays, ofx } = makeFx();
  ofx.lib.has = (k) => has(k) && !String(k).toLowerCase().startsWith('chen3_skill_03_buff');
  const drew = fx.simFx('chen3Wave', 5, 5, wave({ fromX: 5, fromY: 5 }));
  chk('仍有 2 个装好的 prefab：接管（true）', drew === true, `plays=${plays.length}`);
  const { fx: fx2 } = makeFx();
  fx2.w.ofx.lib.has = () => false;
  chk('一个都没装：false（自制月牙刃照旧）', fx2.simFx('chen3Wave', 5, 5, wave({ fromX: 5, fromY: 5 })) === false);
  chk('keyed 表空', fx2.keyed.size === 0);
}

console.log('\n=== ⑧ 数据侧：绑定真的挂上了 skchr_chen3_3 ===');
{
  const { FX_BINDINGS, bindingKeys, coverOf } = await import('../public/js/render/vfx/skills.js');
  const b = FX_BINDINGS.skchr_chen3_3?.chen3Wave;
  chk('FX_BINDINGS.skchr_chen3_3.chen3Wave 存在', !!b);
  chk('owner = id, keyed = true, during = true, at = point',
    !!b && b.owner === 'id' && b.keyed === true && b.during === true && b.at === 'point');
  chk('四个 key 都对', !!b && sorted(b.keys.map((k) => k.toLowerCase())) === sorted(KEYS), b ? b.keys.join(',') : '');
  const pk = bindingKeys(idx, 'skchr_chen3_3');
  chk('四个 key 都在预载清单里（bindingKeys）', KEYS.every((k) => pk.includes(k)), pk.join(','));
  chk('FX_COVER 不含 chen3Wave（自制兜底保留）', coverOf('skchr_chen3_3', 'chen3Wave') === false);
  chk('四个 prefab 在 index.json 里都在', KEYS.every((k) => !!idx.prefabs[k]));
}

console.log('\n=== ⑨ 四个 prefab 过真编译器：为什么需要 track / facing ===');
{
  const { compileEffect } = await import('../public/js/render/vfx/effect.js');
  const { FxWiring } = await import('../public/js/render/vfx/wiring.js');
  const defOf = (k) => compileEffect(JSON.parse(readFileSync(join(ROOT, 'public/assets/local/fx/prefabs', k + '.json'), 'utf8')), {});
  // 2026-10-17：keyed 通道现在只播 trail，但下面几条断言还在检查 buff_L/R 与 weapon 的
  //   prefab 元数据（holdByOwner / switchable / follow）—— 它们与「绑定里放了什么」无关，
  //   所以把三件也编译进来，只是不计入 KEYS 的那套计数断言。
  const defs = Object.fromEntries([...KEYS, 'chen3_skill_03_buff_l_01', 'chen3_skill_03_buff_r_01', 'chen3_skill_03_weapon_01'].map((k) => [k, defOf(k)]));
  for (const k of KEYS) chk(`${k} 能编译且是循环 prefab`, !!defs[k] && defs[k].n > 0 && defs[k].loops === true, defs[k] ? `n=${defs[k].n} loops=${defs[k].loops}` : 'null');
  // 2026-10-17：weapon_01 已从生产绑定里去掉，但这些断言要证明的是「为什么必须接管 track」——
  //   现在这条理由由 buff_L/R 的 `_holdByOwner` 承载，weapon 的 FollowMountPoint 作为旁证单独编译检查。
  const weaponDef = defOf('chen3_skill_03_weapon_01');
  chk('weapon 有 FollowMountPoint（旁证：官方 prefab 会自己钉在主人身上）', !!weaponDef.follow);
  const blDef = defOf('chen3_skill_03_buff_l_01'), brDef = defOf('chen3_skill_03_buff_r_01');
  chk('buff_L/R 都 _holdByOwner（所以它们会自动贴在她身边，不进 keyed）',
    blDef.holdByOwner === true && brDef.holdByOwner === true);
  chk('四个都没有 rotateType（官方不会自己转向 → yaw 由 track 给）', KEYS.every((k) => defs[k].rotateType === 0));
  chk('trail 是 ProjectileEffect（mainYaw = π/2，美术朝 +row）',
    !!defs.chen3_skill_03_trail_01.proj && Math.abs(defs.chen3_skill_03_trail_01.mainYaw - Math.PI / 2) < 1e-9);
  chk('四个都没有 OnPlayEmitter（不会互相重复生成）', KEYS.every((k) => defs[k].onPlay.length === 0));
  const sw = defs.chen3_skill_03_buff_l_01.switchable;
  const variant = FxWiring.prototype._variant;
  chk('buff_L 有 SwitchableRightEffect → buff_R', !!sw && sw.right === 'chen3_skill_03_buff_r_01');
  chk('面向右（facing:1）时会被换成 buff_R', variant.call({}, sw, { facing: 1 }, { left: false, back: false }) === 'chen3_skill_03_buff_r_01');
  chk('facing:-1（_keyed 传的）时保持 buff_L', variant.call({}, sw, { facing: -1 }, { left: true, back: false }) === null);
}

console.log('\n=== ⑩ 实测：被移动的实例真的长出身体（真实粒子模拟，不碰 GL）===');
// 判据不是"总粒子数"，而是**一个实例自己**能铺多长：眼睛看到的是每个实例的形状。
// 每 0.12 s 重建一次时，任何实例都活不过 0.12 s —— buff_l 这时才 2 粒、weapon 甚至 0 粒（连龙头都还没出生），
// 而同一个实例被移动 1.2 s 后，它的粒子已经拖出 1.9～4.1 tiles 的身体。
{
  const { compileEffect, Effect } = await import('../public/js/render/vfx/effect.js');
  const SPEED = 1.5, EVERY = 0.12, DT = 1 / 60, HOLD = 0.6;
  const defOf = (k) => compileEffect(JSON.parse(readFileSync(join(ROOT, 'public/assets/local/fx/prefabs', k + '.json'), 'utf8')), {});
  const spreadOf = (e) => {
    let min = Infinity, max = -Infinity, n = 0;
    for (let i = 0; i < e.def.n; i++) {
      const s = e.sys[i];
      if (!s) continue;
      for (let k = 0; k < s.count; k++) { const bx = s.worldPos(k, [0, 0, 0])[0] + 10; if (bx < min) min = bx; if (bx > max) max = bx; n++; }
    }
    return { spread: n ? max - min : 0, n };
  };
  const run = (key, keyed) => {
    const def = defOf(key);
    const st = { x: 5, y: 5, z: 0, yaw: 0 };
    const track = (fx) => { fx.anchor[0] = st.x - 10; fx.anchor[1] = st.y - 9; fx.anchor[2] = -st.z; fx.yaw = st.yaw; };
    const live = [];
    let now = 0;
    const spawn = () => { const e = new Effect(def, { seed: 4242 }); e.track = track; e.place({ pos: [st.x - 10, st.y - 9, 0], yaw: 0 }); e.born = now; live.push(e); return e; };
    let newest = spawn();
    let since = 0, t = 0;
    while (t < 1.2 - 1e-9) {
      t += DT; now = t; since += DT;
      if (since >= EVERY - 1e-9) { since = 0; st.x += SPEED * EVERY; if (!keyed) newest = spawn(); }
      for (const e of live) e.update(DT);
      // `_bound` stops each instance one hold after it started — the old path keeps ~5 of them alive
      if (!keyed) for (let i = live.length - 1; i >= 0; i--) if (t - live[i].born > HOLD) { live[i].stop(); live.splice(i, 1); }
    }
    return { live: live.length, ...spreadOf(newest) };
  };
  for (const key of ['chen3_skill_03_trail_01', 'chen3_skill_03_buff_l_01']) {
    const a = run(key, true), b = run(key, false);
    chk(`${key}：移动的实例只有一个`, a.live === 1, `live=${a.live}`);
    chk(`${key}：它自己铺开的长度 ≥ 3× 重建的那条`, a.spread >= 3 * b.spread,
      `${a.spread.toFixed(2)} vs ${b.spread.toFixed(2)} tiles`);
    chk(`${key}：它自己的粒子 ≥ 3× 重建的那条`, a.n >= 3 * Math.max(1, b.n), `${a.n} vs ${b.n} 粒`);
  }
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
