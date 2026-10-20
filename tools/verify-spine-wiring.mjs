// tools/verify-spine-wiring.mjs — read-only self-check of the 下潜/离位 (Down) spine wiring.
//
//   node tools/verify-spine-wiring.mjs        (exit 0 = every assertion holds)
//
// Asserts, against the committed data/assets.json and the parsed .skel files:
//   1. `anims.attackDown` is consumed: every entry that declares one names a clip its skeleton really has (a skin whose
//      .skel was exported without the *Down* family must not inherit the base character's declaration).
//   2. 乌尔比安's front S3 opens on the 下潜 wind-up `Skill_3_Begin_Down` (the clip nothing could reach before), the
//      substitution is timing-neutral (same duration and same OnAttack times as the `Skill_3_Begin` it replaces), and
//      the `anims.skill` alias still equals `anims.skills[anims.skill.index]` for every model that has both.
//   3. char_4231_clemnt's `animations` duration tables equal the clip set of its own .skel (front and back).
//   4. The orphan clips each have a role: Skill_3_ReStart_A/_B -> skills[i].restart, Skill_2_Die -> skills[i].die,
//      Skill_3_Back -> skills[i].back — and every clip a role names exists in the skeleton that carries it, except the
//      pre-existing gaps recorded in tools/spine-wiring-baseline.json (that set may shrink, never grow).
//   5. The renderer really consumes all of it (public/js/render/spine.js / units.js reference each role).
//
// Timing is measured in the renderer's own terms (public/js/render/spine.js): dur = entry.animations[clip] ?? the
// .skel's own duration, and hit = entry.hits[clip][0] ?? dur * 0.5 (_hitTime). A 下潜 phase that would move that hit
// must be a reviewed exception: the ledger lists the places where the *client's* OnAttack data genuinely differs from
// the clip being replaced (伊芙利特 S2, 阿斯卡纶, svrash / ayer's down attack). Any new one fails.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSkel } from './assets/skel.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const urlToFile = (u) => path.join(ROOT, 'public', String(u).replace(/^\//, '').split('/').join(path.sep));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/spine-wiring-baseline.json'), 'utf8'));
const gapLedger = new Set(ledger.preexistingRoleClipGaps.items);
const timingLedger = new Map(ledger.reviewedTimingExceptions.items.map((t) => [`${t.entry}|${t.phase}|${t.downClip}|${t.plainClip}`, t]));

let fails = 0, checks = 0;
const ok = (label, extra = '') => { checks++; console.log(`  PASS  ${label}${extra ? '  — ' + extra : ''}`); };
const bad = (label, detail) => { checks++; fails++; console.log(`  FAIL  ${label}  — ${detail}`); };
const note = (label, detail = '') => { console.log(`  NOTE  ${label}${detail ? '  — ' + detail : ''}`); };
const section = (t) => console.log(`\n${t}`);

/** every spine entry of every model: [charId, label, entry] */
const entries = [];
for (const [charId, rec] of Object.entries(manifest.chars || {})) {
  for (const side of ['front', 'back']) if (rec.spine?.[side]) entries.push([charId, `${charId}/${side}`, rec.spine[side]]);
  for (const [skinId, sk] of Object.entries(rec.skins || {})) {
    for (const side of ['front', 'back']) if (sk.spine?.[side]) entries.push([charId, `skin:${skinId}/${side}`, sk.spine[side]]);
  }
}
const skelCache = new Map();
const skelOf = (e) => {
  const f = urlToFile(e.skel);
  if (!skelCache.has(f)) skelCache.set(f, fs.existsSync(f) ? parseSkel(fs.readFileSync(f)) : null);
  return skelCache.get(f);
};
/** every SkillClip of an entry, with a path label */
const skillClips = (e) => {
  const out = [];
  if (e.anims?.skill) out.push([`skill`, e.anims.skill]);
  for (const [i, c] of Object.entries(e.anims?.skills || {})) out.push([`skills.${i}`, c]);
  return out;
};
const phases = ['begin', 'loop', 'end', 'idle'];
const sameHits = (hits, a, b) => JSON.stringify(hits?.[a] ?? null) === JSON.stringify(hits?.[b] ?? null);
/** the renderer's own numbers for a clip (spine.js dur() / _hitTime()) */
const clipDur = (e, sk, clip) => {
  const d = e.animations?.[clip];
  if (typeof d === 'number' && d > 0) return d;
  const sd = sk?.durations?.[clip];
  return typeof sd === 'number' && sd > 0 ? sd : null;
};
const clipHit = (e, sk, clip) => {
  const d = clipDur(e, sk, clip);
  if (d == null) return null;
  const h = e.hits?.[clip];
  if (Array.isArray(h) && h.length && Number.isFinite(h[0])) return Math.min(Math.max(h[0], 0), d);
  return d * 0.5;
};

// ---------------------------------------------------------------- 1. attackDown
section('1. attackDown is wired to real clips (the role nothing used to consume)');
{
  let declared = 0, stale = 0;
  const staleList = [];
  for (const [, label, e] of entries) {
    const ad = e.anims?.attackDown;
    if (!ad || !ad.loop) continue;
    declared++;
    const sk = skelOf(e);
    if (!sk || !sk.animations.includes(ad.loop)) { stale++; staleList.push(`${label}:${ad.loop}`); }
  }
  if (stale) bad(`every declared attackDown names a clip its skeleton has`, `${stale}/${declared} stale: ${staleList.slice(0, 5).join(', ')}`);
  else ok(`every declared attackDown names a clip its skeleton has`, `${declared} models declare one, all present`);
  const consumed = entries.filter(([, , e]) => e.anims?.attackDown?.loop).length;
  if (consumed) ok('attackDown is a live role (the renderer can reach it)', `${consumed} models`);
  else bad('attackDown is a live role', 'no model declares one');
}

// ---------------------------------------------------------------- 2. Ulpian S3 + the skill alias
section('2. 乌尔比安 front S3 opens on Skill_3_Begin_Down (下潜起手), timing-neutral');
{
  const front = manifest.chars.char_4145_ulpia?.spine?.front;
  const back = manifest.chars.char_4145_ulpia?.spine?.back;
  const sk = front && skelOf(front);
  const s3 = front?.anims?.skills?.['2'];
  if (!s3) bad('char_4145_ulpia front has skills[2]', 'missing');
  else {
    if (s3.begin === 'Skill_3_Begin_Down') ok('skills[2].begin is Skill_3_Begin_Down', `plain was Skill_3_Begin`);
    else bad('skills[2].begin is Skill_3_Begin_Down', `got ${JSON.stringify(s3.begin)}`);
    if (sk && sk.animations.includes('Skill_3_Begin_Down')) ok('Skill_3_Begin_Down exists in his front .skel', `of ${sk.animations.length} clips`);
    else bad('Skill_3_Begin_Down exists in his front .skel', 'not found');
    if (s3.down?.begin === 'Skill_3_Begin_Down') ok('skills[2].down.begin agrees with skills[2].begin', 'no skill/skills divergence');
    else bad('skills[2].down.begin agrees with skills[2].begin', JSON.stringify(s3.down ?? null));
    if (front.anims?.skill && JSON.stringify(front.anims.skill) === JSON.stringify(s3)) ok('anims.skill === anims.skills[2] (the renderer may read either)');
    else bad('anims.skill === anims.skills[2]', 'diverged');
    // timing neutrality: the substitution cannot move a hit frame
    if (sk) {
      const d = sk.durations, h = sk.hits;
      const same = d['Skill_3_Begin_Down'] === d.Skill_3_Begin && sameHits(h, 'Skill_3_Begin_Down', 'Skill_3_Begin');
      if (same) ok('Skill_3_Begin_Down is timing-neutral', `dur ${d['Skill_3_Begin_Down']}s = Skill_3_Begin, hits ${JSON.stringify(h.Skill_3_Begin_Down ?? null)} = Skill_3_Begin`);
      else bad('Skill_3_Begin_Down is timing-neutral', `dur ${d['Skill_3_Begin_Down']} vs ${d.Skill_3_Begin}; hits ${JSON.stringify(h.Skill_3_Begin_Down)} vs ${JSON.stringify(h.Skill_3_Begin)}`);
    }
  }
  if (back && !back.anims?.skills?.['2']?.begin?.includes('Down')) ok('his Back model is untouched (no Skill_3_Begin_Down there)', 'the role fix is dropped for it');
  else if (back) bad('his Back model is untouched', 'a Down begin leaked into the Back skeleton');
}
{
  // manifest-wide: `anims.skill` is the primary skill's clip (skill.index), so it must be its `anims.skills[index]`
  const diverged = [], skipped = [];
  for (const [, label, e] of entries) {
    const a = e.anims?.skill, i = a?.index;
    if (!a || !Number.isInteger(i)) continue;
    const sib = e.anims?.skills?.[String(i)];
    if (!sib) { skipped.push(label); continue; }
    if (JSON.stringify(a) !== JSON.stringify(sib)) diverged.push(label);
  }
  if (diverged.length) bad('anims.skill === anims.skills[skill.index] everywhere it exists', `${diverged.length} diverged: ${diverged.slice(0, 5).join(', ')}`);
  else ok('anims.skill === anims.skills[skill.index] everywhere it exists', skipped.length ? `${skipped.length} models without a sibling key (${skipped.slice(0, 3).join(', ')}) skipped` : 'no skips');
}

// ---------------------------------------------------------------- 3. clemnt
section('3. char_4231_clemnt duration tables equal its own .skel clip set');
for (const side of ['front', 'back']) {
  const e = manifest.chars.char_4231_clemnt?.spine?.[side];
  const sk = e && skelOf(e);
  if (!e || !sk) { bad(`clemnt ${side}`, 'entry or skeleton missing'); continue; }
  const a = JSON.stringify(Object.entries(e.animations || {}).sort());
  const b = JSON.stringify(Object.entries(sk.durations || {}).sort());
  if (a === b) ok(`clemnt ${side}: animations === .skel clip set`, `${Object.keys(sk.durations).length} clips`);
  else {
    const ak = Object.keys(e.animations || {}), bk = Object.keys(sk.durations);
    bad(`clemnt ${side}: animations === .skel clip set`, `missing ${bk.filter((k) => !ak.includes(k)).join(',') || '-'}; extra ${ak.filter((k) => !bk.includes(k)).join(',') || '-'}`);
  }
}

// ---------------------------------------------------------------- 4. orphan clips, clip existence, timing
section('4. every orphan clip has a role, and every named clip exists');
{
  const want = [
    ['Skill_3_ReStart_A', 'restart'],
    ['Skill_3_ReStart_B', 'restart'],
    ['Skill_2_Die', 'die'],
    ['Skill_3_Back', 'back'],
  ];
  for (const [clip, role] of want) {
    const holders = [];
    for (const [charId, label, e] of entries) {
      for (const [p, c] of skillClips(e)) {
        const has = role === 'restart' ? Array.isArray(c.restart) && c.restart.includes(clip) : c[role] === clip;
        if (has) holders.push(`${label}:${p}`);
      }
    }
    if (holders.length) ok(`${clip} -> ${role}`, `${holders.length} role(s), e.g. ${holders.slice(0, 3).join(', ')}`);
    else bad(`${clip} -> ${role}`, 'no role names it');
  }

  // every clip any role names must exist in that entry's skeleton — except the ledger's pre-existing gaps
  const missing = new Set(), resolved = new Set(gapLedger), namedSeen = [];
  let named = 0;
  for (const [, label, e] of entries) {
    const sk = skelOf(e);
    if (!sk) continue;
    for (const [p, c] of skillClips(e)) {
      const tests = [];
      for (const k of phases) tests.push([`${p}.${k}`, c[k]]);
      for (const k of phases) tests.push([`${p}.down.${k}`, c.down?.[k]]);
      tests.push([`${p}.back`, c.back], [`${p}.die`, c.die]);
      for (const [i, n] of (c.restart || []).entries()) tests.push([`${p}.restart[${i}]`, n]);
      for (const [where, n] of tests) {
        if (n == null) continue;
        named++;
        if (sk.animations.includes(n)) continue;
        const key = `${label}|${where}=${n}`;
        missing.add(key);
        if (!gapLedger.has(key)) namedSeen.push(key);
        resolved.delete(key);
      }
    }
  }
  if (namedSeen.length) bad('no clip named by a role is missing from its .skel beyond the reviewed ledger', `${namedSeen.length} new: ${namedSeen.slice(0, 5).join(', ')}`);
  else ok('no clip named by a role is missing from its .skel beyond the reviewed ledger', `${named} role clips checked, ${missing.size} known pre-existing gap(s)`);
  if (resolved.size) note(`ledger gaps resolved (${resolved.size}) — tools/spine-wiring-baseline.json can shrink`, `${[...resolved].slice(0, 4).join(', ')}${resolved.size > 4 ? ' …' : ''}`);

  // 下潜/离位 timing neutrality, in the renderer's terms (dur + first hit), skill phases and attackDown alike
  const unexpected = [], staleExceptions = new Set(timingLedger.keys());
  let pairs = 0;
  const compare = (label, phase, dn, pl, e, sk) => {
    pairs++;
    const dd = clipDur(e, sk, dn), pd = clipDur(e, sk, pl), dh = clipHit(e, sk, dn), ph = clipHit(e, sk, pl);
    if (dd === pd && dh === ph) return;
    const key = `${label}|${phase}|${dn}|${pl}`;
    const known = timingLedger.get(key);
    staleExceptions.delete(key);
    if (!known || known.down.dur !== dd || known.down.hit !== dh || known.plain.dur !== pd || known.plain.hit !== ph) {
      unexpected.push(`${label} ${phase}: ${dn}(dur ${dd} hit ${dh}) vs ${pl}(dur ${pd} hit ${ph})`);
    }
  };
  for (const [, label, e] of entries) {
    const sk = skelOf(e);
    if (!sk) continue;
    for (const [p, c] of skillClips(e)) {
      if (!c.down) continue;
      for (const k of phases) if (c.down[k] && c[k]) compare(label, `${p}.${k}`, c.down[k], c[k], e, sk);
    }
    const ad = e.anims?.attackDown, at = e.anims?.attack;
    if (ad?.loop && at?.loop && sk.animations.includes(ad.loop) && sk.animations.includes(at.loop)) compare(label, 'attackDown.loop', ad.loop, at.loop, e, sk);
  }
  if (unexpected.length) bad('every 下潜 substitution keeps the strike frame (or is a reviewed exception)', `${unexpected.length} new: ${unexpected.slice(0, 4).join(' | ')}`);
  else ok('every 下潜 substitution keeps the strike frame (or is a reviewed exception)', `${pairs} pairs compared, ${timingLedger.size} reviewed exception(s)`);
  if (staleExceptions.size) note(`ledger timing exceptions no longer applicable (${staleExceptions.size}) — the ledger can shrink`, [...staleExceptions].slice(0, 3).join(', '));
}

// ---------------------------------------------------------------- 5. renderer consumption
section('5. the renderer consumes every role (no dead mapping left)');
{
  const spine = fs.readFileSync(path.join(ROOT, 'public/js/render/spine.js'), 'utf8');
  const units = fs.readFileSync(path.join(ROOT, 'public/js/render/units.js'), 'utf8');
  const has = (src, re) => re.test(src);
  const tests = [
    ['spine.js reads anims.attackDown', () => has(spine, /roles\.attackDown/)],
    ['spine.js reads a skill clip\'s `down` family', () => has(spine, /sk\.down|_downRoles/)],
    ['spine.js reads a skill clip\'s `back`', () => has(spine, /sk\.back/)],
    ['spine.js reads a skill clip\'s `restart`', () => has(spine, /sk\.restart/)],
    ['spine.js reads a skill clip\'s `die`', () => has(spine, /sk\.die/)],
    ['spine.js exposes setDownStance (the 下潜/离位 switch)', () => has(spine, /setDownStance\(/)],
    ['spine.js exposes restartSkill (【离位后重入】)', () => has(spine, /restartSkill\(/)],
    ['units.js drives setDownStance from the redeploy-under-skill signal', () => has(units, /setDownStance\(/) && has(units, /flags & UF\.SKILL/)],
    ['units.js calls restartSkill on a re-entry', () => has(units, /restartSkill\(\)/)],
  ];
  for (const [label, fn] of tests) { if (fn()) ok(label); else bad(label, 'no reference found'); }
}

console.log(`\n${fails ? 'FAILED' : 'OK'}: ${checks - fails}/${checks} assertions passed`);
process.exit(fails ? 1 : 0);
