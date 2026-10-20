// 三位 P3R 干员的模组验证
// 运行（项目根）: node test/p3r-modules.test.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const chess = JSON.parse(readFileSync(join(ROOT, 'data/chess.json'), 'utf8'));
const assets = JSON.parse(readFileSync(join(ROOT, 'data/assets.json'), 'utf8'));
const lr = await import('file:///' + join(ROOT, 'shared/loadoutRecord.js').replace(/\\/g, '/'));

const CASES = [
  ['char_4217_makoto', '结城理', 'chess_zj_60_5_b', 'uniequip_002_makoto', 'PUM-Y', 'pum-y', { maxHp: 200, atk: 18, def: 18 }],
  ['char_4218_aigis', '埃癸斯', 'chess_zj_60_3_b', 'uniequip_002_aigis', 'BRK-X', 'brk-x', { maxHp: 35, atk: 35, def: 12 }],
  ['char_4219_yukari', '岳羽由加莉', 'chess_zj_60_4_b', 'uniequip_002_yukari', 'RAN-X', 'ran-x', { maxHp: 120, atk: 36, def: 10 }],
];

console.log('=== ① 记录结构 ===');
for (const [cid, name, key, mid, tn, ti, attr] of CASES) {
  const r = chess[key];
  chk(`${name} 有 modules`, Array.isArray(r?.modules) && r.modules.length === 1);
  const m = r?.modules?.[0] ?? {};
  chk(`${name} uniEquipId 正确`, m.uniEquipId === mid, m.uniEquipId);
  chk(`${name} typeName/typeIcon`, m.typeName === tn && m.typeIcon === ti, `${m.typeName}/${m.typeIcon}`);
  chk(`${name} level=1（tier5 惯例）`, m.level === 1);
  chk(`${name} attr 与官方一致`, JSON.stringify(m.attr) === JSON.stringify(attr), JSON.stringify(m.attr));
  chk(`${name} 当前装备 module 指向它`, r?.module?.id === mid && r.module.active === true);
  chk(`${name} 有 statsBase（未装模组基线）`, !!r?.statsBase);
  chk(`${name} 有 traitBase / talentsBase`, !!r?.traitBase && Array.isArray(r?.talentsBase));
  chk(`${name} isDefault=true`, m.isDefault === true);
  // _a 不应有模组
  const aKey = key.replace(/_b$/, '_a');
  chk(`${name} 的 _a 没有模组（惯例）`, !chess[aKey]?.modules && !chess[aKey]?.module);
}

console.log('\n=== ② 模组图标在 assets（按类型，键是小写 typeIcon）===');
for (const [, name, , , , ti] of CASES) {
  const url = assets.modules?.[ti];
  chk(`${name} 图标 modules['${ti}']`, typeof url === 'string' && url.includes(`module/${ti}.png`), url ?? '(缺)');
}
// 键必须与使用者的 typeIcon 一致（loadout.js:138 直接拿 rec.typeIcon 查表）。
// 注意：项目里既有小写键（pum-y）也有大写键（WAH-Y、dec-X），各自与使用者的 typeIcon 对齐 —— 不是 bug。
const iconUsers = new Map();
for (const [ck, rec] of Object.entries(chess)) {
  for (const m of (rec.modules || [])) {
    if (!iconUsers.has(m.typeIcon)) iconUsers.set(m.typeIcon, []);
    iconUsers.get(m.typeIcon).push(ck);
  }
}
const misaligned = [...iconUsers.entries()].filter(([ti]) => !assets.modules?.[ti]).map(([ti, us]) => `${ti}(${us[0]})`);
chk('每个棋子的 typeIcon 都能在 modules 表里查到', misaligned.length === 0, misaligned.slice(0, 4).join(', '));
chk('既有 pum-y 未被破坏', typeof assets.modules['pum-y'] === 'string');

console.log('\n=== ③ composeStats：面板加成真的加上了 ===');
for (const [cid, name, key, mid, , , attr] of CASES) {
  const rec = chess[key];
  const base = rec.statsBase ?? rec.stats;
  const composed = lr.composeStats(base, rec.modules[0].attr);
  const ok = Object.entries(attr).every(([f, v]) => composed[f] === base[f] + v);
  console.log('     %s: %s → %s', name,
    JSON.stringify({ hp: base.maxHp, atk: base.atk, def: base.def }),
    JSON.stringify({ hp: composed.maxHp, atk: composed.atk, def: composed.def }));
  chk(`${name} 加成 = statsBase + attr`, ok);
  chk(`${name} maxHp 涨了`, composed.maxHp > base.maxHp, `+${composed.maxHp - base.maxHp}`);
}

console.log('\n=== ④ composeTalents：天赋变化 ===');
for (const [cid, name, key] of CASES) {
  const rec = chess[key];
  const changes = rec.modules[0].talentChanges ?? [];
  const composed = lr.composeTalents(rec.talentsBase, changes);
  console.log('     %s: %d 条变化 → 天赋 %d 条', name, changes.length, composed.length);
  for (const c of changes) {
    console.log('        index=%s bb=%s', c.talentIndex, JSON.stringify(c.bb));
  }
  if (!changes.length) { chk(`${name} 无天赋变化（只有特性/面板）`, true); continue; }
  for (const c of changes) {
    if (c.talentIndex >= 0) {
      const got = composed.find((t) => t.index === c.talentIndex);
      const merged = got && Object.entries(c.bb).every(([k, v]) => got.bb[k] === v);
      chk(`${name} talentChanges 合入 index=${c.talentIndex}`, !!merged, got ? JSON.stringify(got.bb) : '(找不到)');
      chk(`${name} 该天赋标记 fromModule`, got?.fromModule === true);
    } else {
      const got = composed.find((t) => t.index === c.talentIndex);
      chk(`${name} 新增天赋 index=${c.talentIndex}`, !!got, got ? JSON.stringify(got.bb) : '(找不到)');
    }
  }
  // 未被模组「替换」的原天赋必须逐字保留（index<0 是新增，走 push 分支，不动原天赋）。
  const baseTalents = rec.talentsBase ?? rec.talents;
  const replacedIdx = new Set(changes.filter((c) => c.talentIndex >= 0).map((c) => c.talentIndex));
  let keptOk = 0, keptBad = 0;
  for (const bt of baseTalents) {
    if (replacedIdx.has(bt.index)) continue;
    const got = composed.find((t) => t.index === bt.index);
    if (got && got.name === bt.name && JSON.stringify(got.bb ?? {}) === JSON.stringify(bt.bb ?? {})) keptOk++;
    else { keptBad++; console.log('        ✗ index=%s 未保留: %s', bt.index, JSON.stringify(got?.bb)); }
  }
  chk(`${name} 未被替换的原天赋逐字保留`, keptBad === 0, `保留 ${keptOk} 条`);
  // index<0 的变化必须在合成结果里出现
  for (const c of changes.filter((x) => x.talentIndex < 0)) {
    const got = composed.find((t) => t.index === c.talentIndex);
    chk(`${name} 新增天赋 index=${c.talentIndex} 已加入`, !!got, got ? JSON.stringify(got.bb) : '(找不到)');
  }
}

console.log('\n=== ⑤ loadoutRecord：默认 loadout 的加成已烘进 stats ===');
for (const [cid, name, key, mid] of CASES) {
  const rec = chess[key];
  const lo = lr.resolveRecordLoadout(rec, { moduleId: mid, skillIndex: rec.backup.skillIndex });
  console.log('     %s: skillIndex=%s moduleId=%s isDefault=%s moduleIsDefault=%s', name, lo?.skillIndex, lo?.moduleId, lo?.isDefault, lo?.moduleIsDefault);
  const composed = lr.loadoutRecord(rec, lo);
  // ★ 默认 loadout 会**原样返回**记录（`if (lo.isDefault) return rec0`），所以加成必须在 `stats` 里烘好。
  //   这正是第一版漏掉的地方：只写 statsBase+attr 时，精英版的实际属性是纯基础值（少了加成）。
  chk(`${name} 记录自带加成（默认装备）`, rec.stats.maxHp === rec.statsBase.maxHp + rec.modules[0].attr.maxHp,
    `${rec.stats.maxHp} vs ${rec.statsBase.maxHp}+${rec.modules[0].attr.maxHp}`);
  chk(`${name} loadoutRecord 默认时返回原记录`, composed === rec || composed.stats.maxHp === rec.stats.maxHp);
  // 显式传 moduleId 时 stats 仍是含加成的那份
  chk(`${name} 战斗记录 stats 含加成`, composed.stats.maxHp === rec.statsBase.maxHp + rec.modules[0].attr.maxHp,
    `${composed.stats.maxHp}`);
  if (rec.modules[0].traitOverride) {
    const traitOk = composed.trait?.desc === rec.modules[0].traitOverride.desc || composed.trait?.bb?.max_hp === 0.2;
    chk(`${name} trait 已是 traitOverride`, traitOk, String(composed.trait?.desc ?? '').slice(0, 40));
  }
}

console.log('\n=== ⑥ 实战：装上模组的结城理打一局 ===');
const E = 'enemy_mod';
const h = makeBattle({
  units: [{ chessId: 'chess_zj_60_5_b', row: 9, col: 6 }],
  enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [9, 8], end: [9, 8], checkpoints: [] } }],
  defs: { enemies: { [E]: enemyRec({ key: E, hp: 120000, atk: 0, speed: 0 }) } },
  seed: 7, flags: { startOpCooldown: 0 }, hooks: ['damaged', 'fatal'], autoFinish: false, timeLimit: 60, captureNoisy: true,
});
const u = h.unit('chess_zj_60_5_b');
h.step(1);
h.b.emit('deploy', { unit: u, initial: true });
console.log('  单位: %s  血%s 攻%s 防%s', u?.def?.name, u?.s?.maxHp, u?.s?.atk, u?.s?.def);
const base = chess.chess_zj_60_5_b.statsBase;
chk('血量 = 基线 3005 + 模组 200', u.s.maxHp === base.maxHp + 200, `${u.s.maxHp}`);
chk('攻击 = 基线 825 + 模组 18', u.s.atk === base.atk + 18, `${u.s.atk}`);
chk('防御 = 基线 305 + 模组 18', u.s.def === base.def + 18, `${u.s.def}`);
u.skill.activate('test', { free: true });
h.step(1);
const t0 = h.enemies()[0].stats?.taken ?? 0;
h.run(12);
const dealt = (h.enemies()[0].stats?.taken ?? 0) - t0;
console.log('  12 秒造成伤害 %s', Math.round(dealt));
chk('装上模组后仍能造成伤害', dealt > 0, String(Math.round(dealt)));
// 致命伤 → 替身，生命值应为 1.35 倍（无模组时）—— 模组的天赋变化为空，所以仍是 1.35
console.log('  替身加成: hpMul 应来自天赋 max_hp_t1 = %s', chess.chess_zj_60_5_b.talents[0].bb.max_hp_t1);
u.hp = 1;
h.b.dealDamage(h.enemies()[0], u, { amount: 99999, type: 'phys' }, {});
h.step(2);
console.log('  致命伤后: hp=%s/%s doll=%s', Math.round(u.hp), Math.round(u.s.maxHp), u.trait?.doll);
chk('致命伤进替身且满血', !u.removed && u.hp === u.s.maxHp, `${Math.round(u.hp)}/${Math.round(u.s.maxHp)}`);

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
