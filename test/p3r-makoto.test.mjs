// 结城理 阶5 kit 的实战验证
// 运行（项目根）: node test/p3r-makoto.test.mjs
// 关键：技能覆盖必须调引擎真实的 selectSkillSpec（kit.skills[id] → kit.skill）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const chess = JSON.parse(readFileSync(join(ROOT, 'data/chess.json'), 'utf8'));
const assets = JSON.parse(readFileSync(join(ROOT, 'data/assets.json'), 'utf8'));
const kits = await import('file:///' + join(ROOT, 'server/sim/content/kits/index.js').replace(/\\/g, '/'));
const content = await import('file:///' + join(ROOT, 'server/sim/content/index.js').replace(/\\/g, '/'));
const { validSpine } = await import('file:///' + join(ROOT, 'public/js/assets.js').replace(/\\/g, '/'));
const sd = await import('file:///' + join(ROOT, 'server/sim/simdata.js').replace(/\\/g, '/'));
const src = sd.getDefaultSource();

const CID = 'char_4217_makoto';
const IDS = ['chess_zj_60_5_a', 'chess_zj_60_5_b'];
console.log('selectSkillSpec 可用: %s', typeof content.selectSkillSpec);

console.log('\n=== ① 记录字段 ===');
for (const id of IDS) {
  const r = chess[id];
  chk(`${id} 存在`, !!r);
  if (!r) continue;
  console.log('     %s 阶%s 价%s rarity=%s %s/%s rangeId=%s', r.name, r.tier, r.price, r.rarity, r.profession, r.subProfessionId, r.rangeId);
  chk(`${id} 阶5/价4`, r.tier === 5 && r.price === 4);
  chk(`${id} 近战 dollkeeper`, r.position === 'MELEE' && r.subProfessionId === 'dollkeeper');
  chk(`${id} zhajing 进池`, r.zhajing === true);
  chk(`${id} 3 技能 / 2 天赋`, (r.skills || []).length === 3 && (r.talents || []).length === 2);
  // 精2满级：_a 无模组 = 纯基础值；_b 默认装着模组，stats 已含模组加成（见 test/p3r-modules.test.mjs）
  // ★ 2026-10-17：结城理的白值已恢复成**官方精三满**（2805/785/305），
  //   炸惊的膨胀交给 `allyScale`（hp×3/def×3/atk×2.5）。此前库里存的是已被抬高的 3005/825/305。
  const BASE = { maxHp: 2805, atk: 785, def: 305 };
  const base = r.statsBase ?? r.stats;
  const attr = r.modules?.[0]?.attr;
  const want = attr
    ? { maxHp: BASE.maxHp + (attr.maxHp ?? 0), atk: BASE.atk + (attr.atk ?? 0), def: BASE.def + (attr.def ?? 0) }
    : BASE;
  chk(`${id} 精2满级数值（hp${want.maxHp} atk${want.atk} def${want.def} cost16）`,
    r.stats.maxHp === want.maxHp && r.stats.atk === want.atk && r.stats.def === want.def && r.stats.cost === 16,
    JSON.stringify({ hp: r.stats.maxHp, atk: r.stats.atk, def: r.stats.def }));
  chk(`${id} statsBase 是官方白值（${BASE.maxHp}/${BASE.atk}/${BASE.def}）`,
    base.maxHp === BASE.maxHp && base.atk === BASE.atk && base.def === BASE.def,
    JSON.stringify({ hp: base.maxHp, atk: base.atk, def: base.def }));
}

console.log('\n=== ② 素材 ===');
const a = assets.chars[CID];
chk('有 chars 登记 + validSpine', !!a && validSpine(a?.spine?.front) && validSpine(a?.spine?.back));
chk('有 p3r 皮肤', !!a?.skins?.[`${CID}@p3r#1`]);

console.log('\n=== ③ 技能覆盖（调引擎真实选择器）===');
for (const id of IDS) {
  const r = chess[id];
  const sk = r.skills[r.backup.skillIndex];
  const built = kits.KITS[CID](sk.bb ?? {}, r, {});
  const covered = [];
  for (const s of r.skills) {
    let spec = null;
    if (typeof content.selectSkillSpec === 'function') {
      // 模拟一枚装了 s 的棋子
      const fake = { ...r, skill: s, backup: { ...r.backup, skillIndex: s.index } };
      try { spec = content.selectSkillSpec(built, s.bb ?? {}, fake, null); } catch (e) { spec = null; }
    }
    const ok = !!(spec && typeof spec === 'object' && Object.keys(spec).length);
    covered.push(`${s.skillId}${ok ? '✓' : '✗'}`);
  }
  console.log('     %s 装 %s → 三个技能解析: %s', id, sk.skillId, covered.join('  '));
  chk(`${id} 三个技能都能解析出 spec`, covered.every((x) => x.endsWith('✓')), covered.filter((x) => x.endsWith('✗')).join(','));
  console.log('     默认 spec 的键: %s', Object.keys(built.skill || {}).join(','));
}

console.log('\n=== ④ 实战：真打一局 ===');
const E = 'enemy_makoto';
const h = makeBattle({
  units: [{ chessId: 'chess_zj_60_5_a', row: 9, col: 6 }],
  enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [9, 8], end: [9, 8], checkpoints: [] } }],
  defs: { enemies: { [E]: enemyRec({ key: E, hp: 120000, atk: 120, speed: 0, range: 1 }) } },
  seed: 7, flags: { startOpCooldown: 0 },
  hooks: ['skillStart', 'skillEnd', 'damaged', 'fatal'], autoFinish: false, timeLimit: 60, captureNoisy: true,
});
const u = h.unit('chess_zj_60_5_a');
h.step(1);
console.log('  单位: %s (%s)  血%s 攻%s 防%s', u?.def?.name, u?.defId, u?.s?.maxHp, u?.s?.atk, u?.s?.def);
console.log('  技能: %s   实现: %s', u?.skill?.id, u?.skill?.spec?.kind ?? u?.skill?.kind ?? '(无 kind)');
chk('部署成功', !!u && u.deployed);
chk('技能已装配', !!u?.skill);
chk('dollkeeper 替身机制已装（trait.doll 或 dollDuration）',
  !!(u?.profile?.dollDuration || u?.trait?.doll !== undefined || u?.mem?.doll),
  `dollDuration=${u?.profile?.dollDuration} trait.doll=${u?.trait?.doll}`);

// 开技能（免费）
const cast = u.skill.activate('test', { free: true });
console.log('  activate() → %s', cast);
h.step(2);
const started = h.hooksOf('skillStart').filter((x) => x.unit === u);
console.log('  skillStart 事件: %d 次', started.length);
chk('技能能开启', cast === true);
chk('skillStart 已发出', started.length > 0);
console.log('  替身状态: makotoMask=%s  doll=%s', u.mem?.makotoMask, u.trait?.doll);

// 打一会儿看有没有输出
const e0 = h.enemies()[0];
const t0 = e0?.stats?.taken ?? 0;
h.run(12);
const dealt = (e0?.stats?.taken ?? 0) - t0;
console.log('  12 秒内造成伤害 %s（敌人剩余血 %s/%s）', Math.round(dealt), Math.round(e0?.hp), e0?.s?.maxHp);
chk('能造成伤害', dealt > 0, String(Math.round(dealt)));

// 致命伤 → 替身
console.log('\n  ── 致命伤应触发替身（切换而非撤退）──');
console.log('  受伤前: hp=%s/%s', Math.round(u.hp), Math.round(u.s.maxHp));
u.hp = 1;
h.b.dealDamage(e0, u, { amount: 99999, type: 'phys' }, {});
h.step(2);
const fatalEv = h.hooksOf('fatal').filter((x) => x.unit === u);
console.log('  fatal 事件: %d 次', fatalEv.length);
console.log('  致命伤后: alive=%s hp=%s/%s deployed=%s removed=%s', u.alive, Math.round(u.hp), Math.round(u.s.maxHp), u.deployed, u.removed);
console.log('  替身 buff/flags: doll=%s dollSwitching=%s mask=%s', u.trait?.doll, u.trait?.dollSwitching, u.mem?.makotoMask);
chk('致命伤后没有撤退（仍在场）', !u.removed, `removed=${u.removed}`);
chk('进入了替身状态', !!(u.trait?.doll || u.mem?.makotoMask),
  `doll=${u.trait?.doll} mask=${u.mem?.makotoMask}`);
// PRTS 傀儡师特性：切换重设生命至最大值。此处 maxHp 也随天赋 +35% 涨了（2805 → 3787）
chk('替身满血（hp == maxHp，且远高于被设成的 1）', u.hp === u.s.maxHp && u.hp > 100,
  `${Math.round(u.hp)}/${Math.round(u.s.maxHp)}`);
chk('天赋 +35% 生命值生效（maxHp > 官方白值 2805）', u.s.maxHp > 2805,
  `${Math.round(u.s.maxHp)} = 2805 × 1.35 = ${Math.round(2805 * 1.35)}`);

// 继续跑，结算
h.runToEnd ? h.runToEnd(20) : h.run(20);
const res = h.result();
console.log('\n  结算: %s', JSON.stringify({ time: +h.b.time.toFixed(1), over: res?.over, win: res?.win }));

console.log('\n=== ⑤ 各阶构成 ===');
const zj = Object.entries(chess).filter(([, v]) => v.zhajing === true);
const byTier = {};
for (const [, v] of zj) byTier[v.tier] = (byTier[v.tier] || 0) + 1;
console.log('     炸惊池 %d 个: %s', zj.length, JSON.stringify(byTier));
for (const [cid2, nm] of [['char_4220_kormr', '虎狼丸'], ['char_4219_yukari', '岳羽由加莉'], ['char_4218_aigis', '埃癸斯'], [CID, '结城理']]) {
  const rows = zj.filter(([, v]) => v.charId === cid2).map(([k, v]) => `${k}(阶${v.tier}价${v.price})`);
  console.log('     %-10s %s', nm, rows.join(' '));
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
