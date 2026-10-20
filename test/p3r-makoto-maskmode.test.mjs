// 结城理面具形态的**持续**特效（formModes → wiring.mode → talentfx 的 mode 绑定）。
// 运行（项目根）: node test/p3r-makoto-maskmode.test.mjs
//
// 用户 2026-10-17：「形态切换那一下有特效 但持续中没有」。
// 前者是 `substitute` 触发的 start 行（test/p3r-makoto-fx.test.mjs 覆盖），后者是**另一条断路**：
//   他的持续特效挂在 index `talents[-1]` 的 `when:'passive'` + `mode:'Stand_S*'` 节点上
//   （`makoto_skill_01/02/03_*_buff_01`），而 `TalentFx._inForce` 对 passive 走 `_modeOk` → `_modeName`
//   → `wiring.mode` 的**形态分支**。那条分支要 `formModes()` 给出一张 形态→模式 的表，而它此前对结城理返回
//   `{}`（只推导 `doll` 与重生两类），于是模式永远停在 `Default`，loop 行一次都不 in force。
//
// 修法（public/js/render/vfx/talents.js `formModes`）：技能号 N → `modes` 里第 N 个 `<前缀>_S*` 模式，
//   形态号同理取 `FORMS` 的声明序（两条序列一一对应，`modeVariant` 用的就是这个约定）。
//   另修 wiring.js：数据**显式绑定**的形态不再要求该模式有 `attack` 块（`Stand_S3_2`／俄耳甫斯是治疗形态，
//   `attack` 为 undefined，旧判定会退回 Default）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const idx = JSON.parse(readFileSync(join(ROOT, 'public/assets/local/fx/index.json'), 'utf8'));
const { formModes, talentBindings, bindable } = await import('../public/js/render/vfx/talents.js');
const { formMode } = await import('../public/js/render/vfx/skillfx.js');

const KEY = 'char_4217_makoto';
const u = idx.units[KEY];
const map = formModes(idx, KEY);

/** `wiring.mode` 的形态分支（wiring.js，去掉技能激活相关的上文）—— 逐字复刻判据。 */
function modeForForm(unit, m, form) {
  const modes = Array.isArray(unit?.modes) ? unit.modes : [];
  const fm = formMode(unit, form, m);
  if (fm) {
    const hit = modes.find((x) => x.name === fm);
    const explicit = !!m && Object.values(m).includes(fm);
    if (hit && (explicit || hit.attack || hit.combat)) return hit;
  }
  const named = modes.find((x) => typeof x?.name === 'string' && x.name.toLowerCase() === String(form).toLowerCase());
  return named || modes.find((x) => x.name === 'Default') || modes[0] || null;
}

// ─────────────────────────────────────── ① 形态 → 模式 的表
console.log('=== ① formModes 给出的表 ===');
console.log('  %s', JSON.stringify(map));
const WANT = { doll1: 'Stand_S1', doll2: 'Stand_S2', doll3p1: 'Stand_S3_1', doll3p2: 'Stand_S3_2' };
for (const [form, want] of Object.entries(WANT)) {
  chk(`${form} → ${want}`, map[form] === want, String(map[form]));
}

console.log('\n=== ② wiring.mode 的形态分支（含无 attack 的模式）===');
for (const [form, want] of Object.entries(WANT)) {
  const m = modeForForm(u, map, form);
  chk(`${form} 取到模式 ${want}`, m?.name === want, `${m?.name} attack=${!!m?.attack}`);
}
// 没进面具时必须退回 Default（否则本体也会套上面具的持续特效）
for (const form of [null, undefined, '', 'base', 'nope']) {
  const m = modeForForm(u, map, form);
  chk(`form=${JSON.stringify(form)} 退回 Default`, m?.name === 'Default', String(m?.name));
}

console.log('\n=== ③ 每个形态的持续特效（mode 绑定 + bindable）===');
const passive = talentBindings(idx, KEY, {}).filter((b) => b.when === 'passive' && b.mode);
chk('存在 when=passive 且带 mode 的绑定', passive.length > 0, String(passive.length));
const WANTKEY = {
  doll1: 'makoto_skill_01_buff_01',
  doll2: 'makoto_skill_02_buff_01',
  doll3p1: 'makoto_skill_03_p1_buff_01_l',
  doll3p2: 'makoto_skill_03_p2_buff_01',
};
for (const [form, key] of Object.entries(WANTKEY)) {
  const m = modeForForm(u, map, form);
  const binds = passive.filter((b) => b.mode === m?.name);
  const keys = binds.flatMap((b) => [...b.plan.loop, ...b.plan.start, ...b.plan.range]).map((e) => e.key);
  chk(`★ ${form} (${m?.name}) 播 ${keys.length} 个持续特效`, keys.includes(key), keys.join(','));
  chk(`  ↑ 绑定可播`, binds.every((b) => bindable(b).ok), binds.map((b) => bindable(b).reason).filter(Boolean).join(','));
}
// 这些持续特效预制体确实在库里
for (const k of Object.values(WANTKEY)) chk(`官方特效库有 ${k}`, !!idx.prefabs[k]);

console.log('\n=== ④ 回归：既有 傀儡师 的形态映射不变 ===');
for (const k of ['char_1023_ghost2', 'char_4016_kazema']) {
  if (!idx.units[k]) continue;
  const mm = formModes(idx, k);
  const m = modeForForm(idx.units[k], mm, 'doll');
  chk(`${k} 的 doll 仍取到 Stand`, m?.name === 'Stand', `${JSON.stringify(mm)} → ${m?.name}`);
}
// 没有任何这类映射的干员：表为空，且形态名兜底仍要求 attack/combat
const plainKey = Object.keys(idx.units).find((k) => k.startsWith('char_') && !Object.keys(formModes(idx, k)).length);
if (plainKey) {
  chk(`${plainKey} 的形态表为空（不误加映射）`, Object.keys(formModes(idx, plainKey)).length === 0);
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
