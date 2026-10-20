#!/usr/bin/env node
// HTTP 层验证：项目当前用的两套皮肤资产在服务器上都能取到
// （带 ~hash 与不带两种 URL 都要能 200）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3000';
const assets = JSON.parse(readFileSync(join(ROOT, 'data/assets.json'), 'utf8'));

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };
const bare = (u) => String(u).replace(/^\/assets\/~[0-9a-f]+\//, '').replace(/^\/assets\//, '');

async function head(url) {
  try {
    const r = await fetch(BASE + url, { method: 'GET' });
    return { status: r.status, len: (await r.arrayBuffer()).byteLength };
  } catch (e) { return { status: 'ERR', err: String(e.message).slice(0, 50) }; }
}

const CASES = [
  ['char_4218_aigis', 'char_4218_aigis@p3r#1', '埃癸斯'],
  ['char_4219_yukari', 'char_4219_yukari@p3r#1', '岳羽由加莉'],
  ['char_4220_kormr', 'char_4220_kormr@p3r#1', '虎狼丸'],
  ['char_4217_makoto', 'char_4217_makoto@p3r#1', '结城理'],
];

for (const [cid, skinId, label] of CASES) {
  const s = assets.chars[cid]?.skins?.[skinId];
  if (!s) { chk(`${label} 有登记`, false); continue; }
  console.log('\n── %s %s ──' % (label, skinId));
  // avatar / portrait 用登记的 URL（带 hash）
  for (const [what, u] of [['avatar', s.avatar], ['portrait', s.portrait]]) {
    const a = await head(u);
    chk(`${what} 带 ~hash`, a.status === 200, `${a.status} ${a.len ?? ''}B`);
    const b = await head('/assets/' + bare(u));
    chk(`${what} 不带 ~hash`, b.status === 200, `${b.status} ${b.len ?? ''}B`);
  }
  // spine 三件套
  for (const side of ['front', 'back']) {
    const sp = s.spine?.[side];
    if (!sp) { chk(`spine.${side} 存在`, false); continue; }
    for (const [what, u] of [['skel', sp.skel], ['atlas', sp.atlas], ['tex', sp.textures?.[0]]]) {
      const a = await head(u);
      chk(`spine.${side}.${what}`, a.status === 200, `${a.status} ${a.len ?? ''}B`);
    }
  }
}

console.log('\n=== 汇总 ===');
console.log('  %s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
