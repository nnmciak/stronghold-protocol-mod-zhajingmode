// 普攻的挥击 / 击中特效来自**模式的 attack**（`skillfx._record` + `skills.foldModeAttack` / `modeRecordOf`）。
// 运行（项目根）: node test/p3r-makoto-attackfx.test.mjs
//
// 用户 2026-10-17：「少了挥击和击中特效」，修完渲染崩溃后仍报「结城理没有挥击 / 击中特效」。
//
// 两层原因：
//   ① `plan.attacks` 只来自 `skill.abilities`（结城理三个技能预制体里 abilities 是空的），
//      而 `attachUses` 只认 `attach` 字段 —— 模式 attack 的键是 class/animKey/attackType/damageType/
//      node/emitters/cast/hit，**没有 attach**。于是他的普攻行一行都进不了 plan。
//   ② 修 ① 时用 `plan.modeName` 去找模式，**但结城理的技能 `mode` 是 null、`plan.modeName` 也是 null** ——
//      两个注入点都跳过。而他的本体形态正好是 `Default`，挥击/击中就挂在那里。
//      ⇒ `modeRecordOf` 必须能回落到 `Default`（本轮修的）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const idx = JSON.parse(readFileSync(join(ROOT, 'public/assets/local/fx/index.json'), 'utf8'));
const { skillPlan, foldModeAttack, modeRecordOf, attackFx } = await import('../public/js/render/vfx/skills.js');
const KEY = 'char_4217_makoto';
const u = idx.units[KEY];
const rows = (p) => ({
  cast: p.attacks.flatMap((a) => [...a.cast, ...a.range]).map((e) => e.key),
  hit: p.attacks.flatMap((a) => a.hit.flat()).map((e) => e.key),
});

// ─────────────────────────────────────── ① modeRecordOf 的回落
console.log('=== ① modeRecordOf 的回落（结城理的技能没有 mode）===');
const s2 = u.skills.skchr_makoto_2;
chk('结城理的技能记录里 mode 是 null', s2.mode == null, String(s2.mode));
const def = modeRecordOf(idx, KEY, null);
chk('★ 无模式名时回落到 Default', def?.name === 'Default', String(def?.name));
chk('★ 回落到的是「有 cast/hit 的那个模式」',
  ((def?.attack?.cast || []).length === 2 && (def?.attack?.hit || []).length === 2),
  `cast=${(def?.attack?.cast || []).length} hit=${(def?.attack?.hit || []).length}`);
chk('按名字取也能取到', modeRecordOf(idx, KEY, 'Stand_S3_1')?.name === 'Stand_S3_1');
chk('未知名字回落到 Default', modeRecordOf(idx, KEY, 'Nope')?.name === 'Default');
chk('不存在的单位返回 null', modeRecordOf(idx, 'char_nope', null) === null);

// ─────────────────────────────────────── ② skillPlan 自动注入了 Default 的普攻行
console.log('\n=== ② skillPlan（结城理）—— 自动注入，不需要手动调用 ===');
for (const sid of ['skchr_makoto_1', 'skchr_makoto_2', 'skchr_makoto_3']) {
  const p = skillPlan(idx, KEY, sid);
  const r = rows(p);
  chk(`${sid}：cast 含挥击 A`, r.cast.includes('makoto_attack_a_start_01'), r.cast.join(',') || '(空)');
  chk(`${sid}：cast 含挥击 B`, r.cast.includes('makoto_attack_b_start_01'), r.cast.join(',') || '(空)');
  chk(`${sid}：hit 含击中 A`, r.hit.includes('makoto_attack_a_hit_01'), r.hit.join(',') || '(空)');
  chk(`${sid}：hit 含击中 B`, r.hit.includes('makoto_attack_b_hit_01'), r.hit.join(',') || '(空)');
}

// ─────────────────────────────────────── ③ attackFx 的分组（A / B 两套普攻动画）
console.log('\n=== ③ attackFx 的分组（播放时按命中次数选组）===');
{
  const p = skillPlan(idx, KEY, 'skchr_makoto_2');
  const fx = attackFx(p, {});
  chk('★ hit 给出两组（A / B 各一组）', fx.hit.length === 2, JSON.stringify(fx.hit.map((g) => g.map((e) => e.key))));
  chk('  第一组是 a 的击中', fx.hit[0]?.some((e) => e.key === 'makoto_attack_a_hit_01'),
    JSON.stringify(fx.hit[0]?.map((e) => e.key)));
  chk('  第二组是 b 的击中', fx.hit[1]?.some((e) => e.key === 'makoto_attack_b_hit_01'),
    JSON.stringify(fx.hit[1]?.map((e) => e.key)));
  chk('★ cast 含两个挥击', fx.cast.filter((e) => /makoto_attack_[ab]_start_01/.test(e.key)).length === 2,
    JSON.stringify(fx.cast.map((e) => e.key)));
}

// ─────────────────────────────────────── ④ 面具形态的 cast（它没有 hit，走 Ability0 光环）
console.log('\n=== ④ 面具形态的普攻 cast（都挂在子能力下，见 ⑤）===');
// 实测数据：S1 → skill_01_start_01 + _02；S2 → skill_02_start_01；S3P1 → _p1_start_a + _b；S3P2 → 无（治疗形态）
for (const [modeName, wants] of [
  ['Stand_S1', ['makoto_skill_01_start_01', 'makoto_skill_01_start_02']],
  ['Stand_S2', ['makoto_skill_02_start_01']],
  ['Stand_S3_1', ['makoto_skill_03_p1_start_a_01', 'makoto_skill_03_p1_start_b_01']],
  ['Stand_S3_2', []],
]) {
  const p = skillPlan(idx, KEY, 'skchr_makoto_2');
  const before = rows(p).cast.length;
  const n = foldModeAttack(p, u.modes.find((m) => m.name === modeName));
  const r = rows(p);
  if (wants.length) {
    // 只断言「该有的都有了」+「非 no-op」：行数取决于数据（一条 cast 可以带多个 effects、子能力的 cast/hit 都会算），
    // 手数行数容易数错（本轮就数错过两次），不值得为它写死一个数字。
    chk(`${modeName} 注入了行（非 no-op）`, n > 0, String(n));
    for (const w of wants) chk(`  ↑ 含 ${w}`, r.cast.includes(w), r.cast.join(','));
  } else {
    chk(`${modeName}（数据无攻击行）是 no-op`, n === 0 && rows(p).cast.length === before, String(n));
  }
}

// ─────────────────────────────────────── ⑤ 子能力的攻击也要收集（埃癸斯 S2 的 Emit / Kick 在 abilities 下）
console.log('\n=== ⑤ 子能力的攻击也要收集（不只 mode.attack 一层）===');
{
  const aigis = idx.units.char_4218_aigis;
  const m = (aigis.modes || []).find((x) => (x.attack?.abilities || []).length);
  if (m) {
    const sid = Object.keys(aigis.skills || {})[0] || 'skchr_aigis_1';
    const p = skillPlan(idx, 'char_4218_aigis', sid);
    const n = foldModeAttack(p, m);
    chk(`${m.name} 的子能力攻击被收到行`, n > 0, `${n} 行`);
  } else {
    console.log('  · 埃癸斯没有「攻击挂在 abilities 下」的模式，跳过');
  }
}

// ─────────────────────────────────────── ⑥ 预制体在库里
console.log('\n=== ⑥ 挥击/击中特效预制体在官方库里 ===');
for (const k of ['makoto_attack_a_start_01', 'makoto_attack_a_hit_01', 'makoto_attack_b_start_01', 'makoto_attack_b_hit_01']) {
  chk(`库里有 ${k}`, !!idx.prefabs[k]);
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
