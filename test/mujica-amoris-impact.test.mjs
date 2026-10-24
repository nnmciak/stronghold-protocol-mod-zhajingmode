import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';
import { FxWiring } from '../public/js/render/vfx/wiring.js';
import { strike } from '../server/sim/content/kits/shared/mujica.js';
import { UF } from '../shared/constants.js';
import { FxSim } from '../public/js/render/fx/simfx.js';

const index = JSON.parse(fs.readFileSync(new URL('../public/assets/local/fx/index.json', import.meta.url)));
const charId = 'char_4185_amoris';
const skins = [charId, `${charId}@avemujica#1`];
const sequences = [
  ['projectile_chr_amoris'],
  ['projectile_chr_amoris_s1_1', 'projectile_chr_amoris_s1_2', 'projectile_chr_amoris_s1_2'],
  [1, 2, 2, 2, 1, 2, 2, 2].map(n => `projectile_chr_amoris_s2_${n}`),
];

function scenario(mode, present) {
  const eid = 'enemy_amoris_fx_test';
  const h = makeBattle({
    units: [{ chessId: 'chess_zj_amoris_b', row: 10, col: 7, skillIndex: mode === 2 ? 1 : 0, uid: 1 }],
    enemies: present ? [{ key: eid, time: 0, route: { motion: 'WALK', start: [10, 8], end: [10, 8], checkpoints: [] } }] : [],
    defs: { enemies: { [eid]: enemyRec({ key: eid, hp: 1e8, atk: 0, def: 0, res: 0, speed: 0 }) } },
    flags: { dpInit: 1000, startOpCooldown: 0 }, timeLimit: 20, seed: 728,
    autoFinish: false, captureNoisy: true,
  });
  h.step();
  const u = h.allies()[0];
  u.skill.setTrigger('MANUAL');
  if (mode) {
    h.run(0.8); // Finish the ordinary attack already in progress.
    assert.equal(u.skill.activate('test', { free: true }), true);
    h.events.length = 0;
    h.run(2.8);
  } else h.run(0.8);
  assert.deepEqual([...h.b._errKeys], []);
  return h;
}

function renderer(skin, mode = 0) {
  const plays = [];
  const source = { id: 1, x: 7, y: 10, z: 0.42, dir: 'RIGHT', alive: true,
    flags: mode > 0 ? UF.SKILL : 0, info: { id: 1, spine: charId, skin, skillIndex: mode === 2 ? 1 : 0 } };
  const wiring = new FxWiring({ active: true, time: 0,
    ctx: { heightAt: () => 0 },
    lib: { has: key => !!index.prefabs[key], def: () => ({ isLoop: false }) },
  }, { record: () => ({ charId, skill: { skillId: `skchr_amoris_${mode === 2 ? 2 : 1}` } }), view: id => id === 1 ? source : null });
  wiring.idx = index;
  wiring.playOn = (key, point, options) => {
    const handle = { key, alive: true, stop() { this.alive = false; } };
    plays.push({ key, point, options });
    return handle;
  };
  wiring._fly = () => assert.fail('a tile hammer impact must not also fly a target-bound projectile');
  wiring._followUps = () => assert.fail('multi-strike follow-ups are individually emitted by the simulation');
  return { wiring, source, plays };
}

for (const mode of [0, 1, 2]) for (const present of [false, true]) {
  test(`Amoris ${mode ? `S${mode}` : 'normal'} ${present ? 'enemy hit' : 'empty tile'} renders each timed original impact once in both costumes`, () => {
    const h = scenario(mode, present), u = h.allies()[0];
    const impacts = h.eventsOf('fx').filter(e => e[1] === 'mujicaImpact');
    assert.deepEqual(impacts.map(e => e[4].projectile), sequences[mode]);
    assert.equal(h.eventsOf('fx').some(e => e[1] === 'aoe' && e[4].id === u.id), false, 'no yellow generic explosion');
    if (present || mode < 2) assert.ok(impacts.every(e => e[2] === 8 && e[3] === 10));
    else assert.ok(impacts.every(e => u.rangeKeySet.has(e[3] * 21 + e[2])));
    for (const skin of skins) {
      const { wiring, source, plays } = renderer(skin, mode);
      const foe = { id: 2, x: 8, y: 10, isEnemy: true, alive: true };
      const target = present ? foe : source; // actual atk protocol's self sentinel
      assert.equal(wiring.castStart(source, target, 'none', { skillOn: mode > 0 }), true);
      assert.equal(wiring.attack(source, target, 'none', 0, true), true);
      assert.equal(wiring.melee.size, 0);
      assert.equal(wiring.flights.size, 0);
      assert.notEqual(wiring.lastTarget(source.id), source, 'an empty-tile attack never targets its owner');
      assert.ok(plays.some(p => p.key.includes('_start_')), 'retain original hammer cast effects');
      assert.ok(plays.every(p => p.key.includes(mode ? `_skill_0${mode}_start_` : '_attack_01_start_')), 'casts keep the selected attack mode');
      assert.ok(plays.every(p => !p.key.includes('_hit_')), 'attack animation does not duplicate impact');
      plays.length = 0;
      const warmKeys = wiring.keysFor([source], false);
      for (const event of impacts) {
        const extra = { ...event[4], id: source.id };
        assert.equal(wiring.simFx(event[1], event[2], event[3], extra), true, 'official FX suppress procedural fallback');
        const pk = index.mujicaSkinMaps[skin]?.projectiles?.[extra.projectile] || extra.projectile;
        const keys = index.projectiles[pk].onReached;
        const emitted = plays.splice(0);
        assert.deepEqual(emitted.map(p => p.key), keys);
        assert.equal(emitted.length, 1, 'one original explosion per real strike');
        for (const p of emitted) {
          assert.ok(warmKeys.includes(p.key), 'impact is included in battle preload');
          assert.equal(p.key.endsWith('_avemujica#1'), skin.includes('@'));
          assert.deepEqual([p.point.x, p.point.y, p.point.z], [event[2], event[3], 0], 'impact uses the struck tile ground, including random S2 tiles');
        }
      }
    }
  });
}

test('shared strikes without an explicit original projectile retain their prior effects and damage', () => {
  const fx = [], damage = [], target = { x: 8, y: 10 };
  const b = { dealDamage: (...args) => damage.push(args), enemiesInRadius: () => [], emit() {}, fx: (...args) => fx.push(args) };
  const u = { id: 1, s: { atk: 100, atkScaleMul: 1 }, skill: { id: 'skchr_mortis_2', active: true } };
  strike(b, u, target, 1.5, { type: 'arts', attackId: 3 });
  assert.equal(damage.length, 1);
  assert.equal(damage[0][2].amount, 150);
  assert.equal(fx[0][0], 'aoe');
  assert.equal(fx[0][1].projectile, undefined);
});

test('disabled or unavailable original effects use the same costume-coloured tile blast for empty and enemy hits', () => {
  for (const skin of skins) for (const availability of ['ready', 'disabled', 'missing']) {
    const { wiring, source, plays } = renderer(skin);
    if (availability === 'disabled') wiring.ofx.active = false;
    if (availability === 'missing') wiring.ofx.lib.has = () => false;
    const blasts = [];
    const fallback = Object.create(FxSim.prototype);
    fallback.ctx = { view: id => id === source.id ? source : null, cam: () => ({ project: () => ({ x: 0, y: 0, s: 1 }) }) };
    fallback._groundZ = () => 0;
    fallback.explosion = (...args) => blasts.push(args);
    for (const target of [undefined, 2]) {
      const extra = { id: source.id, target, radius: 1.5, projectile: 'projectile_chr_amoris' };
      const official = wiring.simFx('mujicaImpact', 7, 10, extra);
      if (!official) fallback.simFx('mujicaImpact', 7, 10, extra);
    }
    if (availability === 'ready') {
      assert.equal(plays.length, 2);
      assert.equal(blasts.length, 0, 'a successful official impact must not also draw the simplified blast');
    } else {
      assert.equal(plays.length, 0);
      assert.equal(blasts.length, 2);
      assert.deepEqual(blasts[0], blasts[1], 'enemy presence cannot change fallback colour or shape');
      assert.deepEqual(blasts[0].slice(0, 5), [7, 10, 0, 1.5, skin.includes('@') ? 0xc77dff : 0xff7676]);
    }
  }
});
