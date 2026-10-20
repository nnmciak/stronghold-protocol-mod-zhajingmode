// 由加莉 S1「龙卷箭」的爆炸特效 → 官方命中 prefab（FX_BINDINGS）
// 运行（项目根）: node test/p3r-yukari-fx.test.mjs
//
// 用户 2026-10-17：「一技能的爆炸特效是没的」。
// 根因：kit 发的是 `battle.fx('blink', { x, y, id, skill: 'yukari:burst' })` ——
//   **`blink` 根本不是 `FX_KINDS` 里的 kind**（kinds.js 只有 slash / aoe / buff …），
//   而 `fxSpec` 的兜底 `FX_GUESS` 又把 'blink' 指回 'blink' 自己 ⇒ `FX_KINDS['blink']` 仍是 undefined
//   ⇒ 解构 undefined ⇒ **完全不画**。这就是"爆炸特效没有"的根因。
//
// 修法（public/js/render/vfx/skills.js 的 FX_BINDINGS）：给 skchr_yukari_1 / _2 挂官方 prefab。
//   官方 S1 的 hit/trail 特效在 `index.json` 里是**悬空**的（只被 refs 列出、没有任何 ability 引用），
//   所以计划表永远播不到，必须由 FX_BINDINGS 挂。
//
// ★ 键必须是 **fx kind**（'blink' / 'slash' / 'buff'），不是 `extra.skill`：
//   `skillfx.js:1035` 查的是 `FX_BINDINGS[U.skillId]?.[kind]`。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const idx = JSON.parse(readFileSync(join(ROOT, 'public/assets/local/fx/index.json'), 'utf8'));
const skSrc = readFileSync(join(ROOT, 'public/js/render/vfx/skills.js'), 'utf8');
const kindsSrc = readFileSync(join(ROOT, 'public/js/render/fx/kinds.js'), 'utf8');

// 从源码里抓 FX_BINDINGS 的由加莉条目（客户端模块依赖 pixi，不能直接 import）
const grab = (re) => skSrc.match(re)?.[1] ?? null;
const y1 = grab(/skchr_yukari_1:\s*Object\.freeze\(\{([\s\S]*?)\n\s*\}\),/);
const y2 = grab(/skchr_yukari_2:\s*Object\.freeze\(\{([\s\S]*?)\n\s*\}\),/);

console.log('=== ① 绑定存在，且键是 fx kind（不是 extra.skill）===');
{
  chk('skchr_yukari_1 有绑定', !!y1);
  chk('skchr_yukari_2 有绑定', !!y2);
  chk('★ 键是 blink（fx kind）', /(^|\s)blink:\s*binding\(/.test(y1 || ''), y1?.match(/(\w+):\s*binding\(/g)?.join(' '));
  chk('★ 键是 slash（fx kind）', /(^|\s)slash:\s*binding\(/.test(y1 || ''));
  chk('键不是 extra.skill（yukari:burst / yukari:arrow）', !/'yukari:(burst|arrow|mirror|trigger)':\s*binding\(/.test(skSrc));
  chk('skchr_yukari_2 的键是 buff', /(^|\s)buff:\s*binding\(/.test(y2 || ''));
}

console.log('\n=== ② 绑到的官方 prefab 已安装且在 index 里 ===');
{
  // 绑定的 keys
  const keysOf = (block) => [...(block || '').matchAll(/keys:\s*\[([^\]]*)\]/g)]
    .flatMap((m) => m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean));
  const all = [...new Set([...keysOf(y1), ...keysOf(y2)])];
  chk('解析出 keys', all.length > 0, all.join(', '));
  const prefabs = idx.prefabs || idx.prefab || {};
  const prefabKeys = Object.keys(prefabs);
  for (const k of all) {
    chk(`${k} 在 index.prefabs 里`, prefabKeys.includes(k), prefabKeys.includes(k) ? '' : '★ 缺');
  }
}

console.log('\n=== ③ 官方素材确实悬空（证实必须由 FX_BINDINGS 挂）===');
{
  const u = idx.units?.char_4219_yukari;
  chk('index 里有 char_4219_yukari', !!u);
  const blob = JSON.stringify(u);
  for (const n of ['yukari_skill_01_hit_01', 'yukari_skill_01_trail_1']) {
    const cnt = blob.split(n).length - 1;
    chk(`${n} 几乎没有被引用（×${cnt}）`, cnt <= 2, cnt <= 2 ? '⇒ 计划表播不到，靠 FX_BINDINGS' : '★ 其实有引用');
  }
  chk('对照：start_01 被引用（正常播）', blob.split('yukari_skill_01_start_01').length - 1 > 1);
}

console.log('\n=== ④ 根因复核：blink 确实不是合法 kind ===');
{
  chk('kinds.js 的 FX_KINDS 里没有 blink', !/^\s{2}blink\s*:/m.test(kindsSrc));
  chk('FX_GUESS 的兜底表把 blink 指回 blink（自指 ⇒ 仍是 undefined）',
    /blink:\s*'blink'/.test(kindsSrc));
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
