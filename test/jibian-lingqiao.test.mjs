// Regression: jibian card "lingqiao" - rare, +80 layers of skillfulShip bond (no activation needed).
// It must exist in BOTH zhajing pools and use the skillfulShip bond icon.
// run: node test/jibian-lingqiao.test.mjs
import fs from 'node:fs';
import { registerMeta } from '../server/sim/content/jibian.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const cfg = read('../data/config.json');
const bonds = read('../data/bonds.json');
const assets = read('../data/assets.json');

let pass = 0, fail = 0;
const chk = (label, ok, extra = '') => {
  if (ok) { pass++; console.log('  ok   ' + label + ' ' + extra); }
  else { fail++; console.log('  FAIL ' + label + ' ' + extra); }
};

const POOLS = ['mode_single_zhajing', 'mode_multi_zhajing'];

console.log('=== 1. both zhajing pools carry the card ===');
for (const mode of POOLS) {
  const pool = (cfg && cfg.modes && cfg.modes[mode] && cfg.modes[mode].jibian && cfg.modes[mode].jibian.pool) || [];
  const card = pool.find((c) => c && c.effectId === 'jibian_lingqiao');
  chk(mode + ' has the card', !!card);
  if (!card) continue;
  chk('  name is 灵巧', card.name === '灵巧', card.name);
  chk('  rarity is rare', card.rarity === 'rare', card.rarity);
  chk('  bond is skillfulShip', card.bond === 'skillfulShip', card.bond);
  chk('  desc mentions +80 and no-activation', /\+80/.test(card.desc) && /无需激活/.test(card.desc), card.desc);
}

console.log('=== 2. icon resolves to the skillfulShip bond art ===');
{
  const url = (assets.bonds || {}).skillfulShip || '';
  chk('assets.bonds.skillfulShip exists', !!url, url);
  chk('bonds.skillfulShip is 灵巧', (bonds.skillfulShip || {}).name === '灵巧', (bonds.skillfulShip || {}).name);
}

console.log('=== 3. handler adds 80 layers of skillfulShip ===');
{
  const reg = { seen: {}, register(n, d) { this.seen[n] = d; }, has: () => false };
  registerMeta(reg);
  const h = reg.seen['jibian:jibian_lingqiao'];
  chk('registered jibian:jibian_lingqiao', !!h, h ? Object.keys(h).join(',') : '');
  // The hook needs a real EffectRef ctx (applyCard re-dispatches onChoicePick with ctx.source.kind === 'effect'),
  // so assert the authored call statically instead of faking the whole context.
  const src = fs.readFileSync(new URL('../server/sim/content/jibian.js', import.meta.url), 'utf8');
  chk('handler calls addLayers(skillfulShip, 80)',
    /jibian_lingqiao:\s*\(ctx\)\s*=>\s*ctx\.addLayers\('skillfulShip',\s*80/.test(src));
  chk('handler passes no requireActive', !/jibian_lingqiao:[^\n]*requireActive/.test(src));
}

console.log('\nresult: pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
