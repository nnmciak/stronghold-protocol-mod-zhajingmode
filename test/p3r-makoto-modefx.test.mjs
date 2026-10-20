// 每个技能 × 每个形态：攻击起手 / 击中特效必须来自**当前模式**，不能串到别的技能。
// 运行（项目根）: node test/p3r-makoto-modefx.test.mjs
//
// 用户 2026-10-17：「刚刚二技能用了三技能的攻击特效」（实际是用了 **Default** 的）。
//
// 根因（我引入的）：`skillPlan` 会在没有形态时折进 `Default` 的普攻行；`_record` 又在有面具形态时折进
// 该模式的普攻行（`foldModeAttack`）。而 `attackFx` 用 `plan.attacks.find(...)` **只挑第一条** ——
// `Default` 那条永远排在前面 ⇒ 不管开哪个技能、在哪个形态，攻击起手永远播 Default 的挥击。
// 修法：`foldModeAttack` 给每条 attack 打上 `mode`；`attackFx` 只在当前模式的那些里挑；
// `_record` 顺手把不属于当前模式的摘掉。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const idx = JSON.parse(readFileSync(join(ROOT, 'public/assets/local/fx/index.json'), 'utf8'));
const { skillPlan, foldModeAttack, modeRecordOf, attackFx } = await import('../public/js/render/vfx/skills.js');
const { formModes } = await import('../public/js/render/vfx/talents.js');
const KEY = 'char_4217_makoto';

/** 复刻 `skillfx` 的 `perAttack(plan, form)`：按形态标只保留该形态那一批。 */
function perAttackLike(plan, form) {
  if (!plan || !Array.isArray(plan.attacks)) return plan;
  let list = plan.attacks.filter((a) => !a.when);
  // 判据与 skillfx 一致：`plan._forms` 里记了「已折过批次的形态」，在其中就用该形态的批次（可为空）
  const forms = plan._forms;
  if (forms instanceof Set && forms.has(form ?? null)) {
    return { ...plan, attacks: list.filter((a) => !('form' in a) || a.form === (form ?? null)) };
  }
  const hasForm = plan.attacks.some((a) => a && 'form' in a);
  if (hasForm) {
    const keep = list.filter((a) => !('form' in a) || a.form === (form ?? null));
    if (keep.length) list = keep;
  }
  return { ...plan, attacks: list };
}

/** 逐字复刻 `skillfx._foldAllForms`：把**每个形态**的批次都折进 plan（这是实战路径）。 */
function recordLike(skillId, _formAtRecord) {
  const plan = skillPlan(idx, KEY, skillId);
  const formMap = formModes(idx, KEY) || {};
  // 基准模式名要在折之前抓（foldModeAttack 会改写 plan.modeName）
  const baseName = plan.modeName || null;
  const seen = new Set();
  const folded = new Set();
  for (const form of [null, ...Object.keys(formMap)]) {
    const mode = modeRecordOf(idx, KEY, (form ? formMap[form] : null) || baseName);
    if (!mode || seen.has(mode.name)) continue;
    seen.add(mode.name);
    plan.formTag = form;
    foldModeAttack(plan, mode);
    folded.add(form);
  }
  delete plan.formTag;
  plan._forms = folded;
  return { plan };
}

/** 单位**处于** `formNow` 时该形态的**攻击集**（cast 键的并集）——`attackFx` 本身只返回一条，
 *  多条是语义上的并存（如 S1 的 start_01 / start_02 是两段起手），所以断言并集更准确。 */
function castsAt(skillId, formAtRecord, formNow) {
  const { plan } = recordLike(skillId, formAtRecord);
  const list = perAttackLike(plan, formNow).attacks;
  const out = [];
  for (const a of list) for (const e of [...(a.cast || []), ...(a.range || [])]) if (e?.key) out.push(e.key);
  return [...new Set(out)];
}

console.log('=== ① 形态 → 模式（formModes 推导）===');
const fm = formModes(idx, KEY) || {};
console.log('  %s', JSON.stringify(fm));
chk('doll1 → Stand_S1', fm.doll1 === 'Stand_S1');
chk('doll2 → Stand_S2', fm.doll2 === 'Stand_S2');
chk('doll3p1 → Stand_S3_1', fm.doll3p1 === 'Stand_S3_1');
chk('doll3p2 → Stand_S3_2', fm.doll3p2 === 'Stand_S3_2');

console.log('\n=== ② ★ 真实场景：单位**部署在本体**（建记录时的形态 = null），之后进面具形态 ===');
console.log('   （这是实战路径：先部署、后开技，记录只建一次）');
const WANT = {
  '(本体)': ['makoto_attack_a_start_01', 'makoto_attack_b_start_01'],
  doll1: ['makoto_skill_01_start_01', 'makoto_skill_01_start_02'],
  doll2: ['makoto_skill_02_start_01'],
  doll3p1: ['makoto_skill_03_p1_start_a_01', 'makoto_skill_03_p1_start_b_01'],
  doll3p2: [],
};
for (const [label, want] of Object.entries(WANT)) {
  const formNow = label === '(本体)' ? null : label;
  const sid = 'skchr_makoto_2';
  const got = castsAt(sid, null, formNow).filter((k) => /^makoto_/.test(k));
  const ok = want.length ? want.every((w) => got.includes(w)) : got.length === 0;
  chk(`部署本体 → 现在是 ${label}，起手`, ok, got.join(', ') || '(无)');
  if (want.length && !ok) console.log('        期望含: %s', want.join(', '));
}

console.log('\n=== ③ 三个技能在 doll2 / doll3p1 下都要取到自己模式的起手（技能不同不影响，模式才是依据）===');
for (const sid of ['skchr_makoto_1', 'skchr_makoto_2', 'skchr_makoto_3']) {
  for (const [form, want] of [['doll2', 'makoto_skill_02_start_01'], ['doll3p1', 'makoto_skill_03_p1_start_a_01']]) {
    const got = castsAt(sid, null, form);
    chk(`${sid} @ ${form} → ${want}`, got.includes(want), got.join(', ') || '(无)');
  }
}

console.log('\n=== ④ ★ 回归：doll2 绝不能出现 Default / S3 / S1 的起手 ===');
{
  const bad = ['makoto_attack_a_start_01', 'makoto_attack_b_start_01', 'makoto_skill_03_p1_start_a_01',
    'makoto_skill_03_p1_start_b_01', 'makoto_skill_01_start_01', 'makoto_skill_01_start_02'];
  for (const sid of ['skchr_makoto_1', 'skchr_makoto_2', 'skchr_makoto_3']) {
    const got = castsAt(sid, null, 'doll2');
    const leaked = got.filter((k) => bad.includes(k));
    chk(`doll2 + ${sid} 没有串到别的模式`, leaked.length === 0, leaked.join(', ') || '干净');
  }
}

console.log('\n=== ⑤ ★ 回归：doll3p1 只出 S3 起手 ===');
for (const sid of ['skchr_makoto_1', 'skchr_makoto_2', 'skchr_makoto_3']) {
  const got = castsAt(sid, null, 'doll3p1');
  const ok = got.some((k) => /skill_03_p1_start/.test(k))
    && !got.some((k) => ['makoto_skill_02_start_01', 'makoto_attack_a_start_01', 'makoto_attack_b_start_01'].includes(k));
  chk(`doll3p1 + ${sid}`, ok, got.join(', ') || '(无)');
}

console.log('\n=== ⑥ 本体形态：Default 的挥击 + 击中（A / B 两组）===');
{
  const got = castsAt('skchr_makoto_2', null, null);
  chk('起手含挥击 A', got.includes('makoto_attack_a_start_01'), got.join(', '));
  chk('起手含挥击 B', got.includes('makoto_attack_b_start_01'), got.join(', '));
  const hitPlan = perAttackLike(recordLike('skchr_makoto_2', null).plan, null);
  const fx = attackFx(hitPlan, {});
  chk('击中给出两组', fx.hit.length === 2, JSON.stringify(fx.hit.map((g) => g.map((e) => e.key))));
}

console.log('\n=== ⑦ 每条 attack 的双标注（mode + form）===');
{
  const { plan } = recordLike('skchr_makoto_2', null);
  const tags = plan.attacks.map((a) => `${a.mode ?? '-'}/${a.form === undefined ? '通用' : (a.form ?? '本体')}`);
  console.log('  plan.attacks 标注: %s', JSON.stringify(tags));
  const withForm = plan.attacks.filter((a) => 'form' in a).map((a) => a.form);
  chk('每个形态各有一批（含本体 null）', withForm.includes(null) && withForm.includes('doll2') && withForm.includes('doll3p1'), JSON.stringify(withForm));
}

console.log('\n=== ⑧ 其它干员不受影响（没有形态标时行为不变）===');
for (const k of ['char_4218_aigis', 'char_498_inside']) {
  const sid = Object.keys(idx.units[k]?.skills || {})[0];
  if (!sid) continue;
  const p = skillPlan(idx, k, sid);
  const tagged = p.attacks.some((a) => a?.form !== undefined);
  const fx = attackFx(p, {});
  chk(`${k} 仍能取到攻击（${p.attacks.length} 条）`, !!fx, `形态标=${tagged}`);
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
