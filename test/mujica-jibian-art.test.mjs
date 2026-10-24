import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addMujicaJibianArt } from '../tools/import-mujica-jibian-art.mjs';
import { contentHash } from '../tools/assets/manifest.mjs';
import { resolveJibianArt } from '../public/js/ui/jibianArt.js';
import { resolveSpCard } from '../public/js/ui/choiceOverlay.js';
import { data } from '../public/js/data.js';
import { spectateEffects, spectateEffectsByPlayer } from '../public/js/battle/observe.js';
import { jibianCard, cardView, applyCard } from '../server/match/choices.js';
import { getData } from '../server/data.js';
import { Match } from '../server/match/Match.js';
import { MetaRegistry } from '../server/match/effectsMeta.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = JSON.parse(fs.readFileSync(path.join(root, 'data/assets.json'), 'utf8'));
const cards = [
  { effectId: 'jibian_yinhezhanjian', name: '银河战舰', rarity: 'epic', iconBond: 'mujicaShip', flavor: '“现在我们是一丘之貉了。”' },
  { effectId: 'jibian_yiwangnvshen', name: '遗忘女神', rarity: 'epic', flavor: '“你愿意将人生托付于我吗？”' },
  { effectId: 'jibian_duoshouyeshou', name: '多首野兽', rarity: 'legend', flavor: '你是多首的怪物' },
];
const source = {
  get: name => name === 'config' ? { modes: { mode_single_zhajing: { jibian: { pool: cards } } } } : null,
  lookup: () => null, list: () => [],
};

test('new card art reuses the original E2 face crops and transparent faction glyph', () => {
  const expected = [assets.bonds.mujicaShip, assets.chars.char_4182_oblvns.avatarE2, assets.chars.char_4183_mortis.avatarE2];
  cards.forEach((card, i) => {
    assert.equal(assets.items[card.effectId], expected[i]);
    const png = fs.readFileSync(path.join(root, 'public', expected[i]));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.ok(png.readUInt32BE(16) >= 180 && png.readUInt32BE(20) >= 180);
  });
});

test('art aliases rebuild deterministically and update the asset cache hash', () => {
  const copy = structuredClone(assets);
  for (const c of cards) delete copy.items[c.effectId];
  const result = addMujicaJibianArt(copy);
  assert.deepEqual(result, Object.fromEntries(cards.map(c => [c.effectId, assets.items[c.effectId]])));
  const { version, hash, generator, stats, ...body } = copy;
  assert.equal(hash, contentHash(body));
  addMujicaJibianArt(copy);
  assert.equal(copy.hash, hash);
});

test('draft and stored-effect IDs resolve to the same art, with whitening only on the faction glyph', () => {
  cards.forEach((card, i) => {
    const expected = resolveJibianArt(assets, card);
    assert.equal(expected.icon, assets.items[card.effectId]);
    assert.equal(expected.whiteGlyph, i === 0);
    for (const id of [`${card.effectId}#42`, `jibian:${card.effectId}`]) {
      assert.deepEqual(resolveJibianArt(assets, { id, iconBond: card.iconBond }), expected);
    }
  });
});

test('the real selection and owned-effect pipeline preserves the display-only glyph', t => {
  const m = new Match({
    roomCode: 'ART', mode: 'solo', difficulty: 'ZHAJING', modeId: 'mode_single_zhajing', seed: 3,
    data: getData(), registry: new MetaRegistry(),
    seats: [{ seat: 0, playerId: 'p1', name: 'art regression', isBot: false, connected: true }],
    send: () => true, broadcast: () => {}, onEnd: () => {},
  });
  t.after(() => m.dispose());
  m.phase = 'PREP'; m.round = 1;
  const ps = m.players.get('p1');
  for (const c of cards) {
    const card = jibianCard(m.gd, c);
    assert.equal(card.bond, null, 'art metadata does not add a gameplay bond restriction');
    assert.equal(cardView(card).iconBond, c.iconBond);
    applyCard(m, ps, { ...card, family: 'jibian' });
  }
  const effects = ps.effectsView().filter(e => e.jibian);
  assert.equal(effects.length, 3);
  effects.forEach((e, i) => {
    assert.equal(e.iconBond, cards[i].iconBond);
    assert.equal(resolveJibianArt(assets, e).icon, assets.items[cards[i].effectId]);
    assert.equal(e.rarity, cards[i].rarity);
    assert.equal(e.flavor, cards[i].flavor);
  });
  const watched = spectateEffects({ players: [ps.battleInput()] }, ['p1'], source);
  assert.deepEqual(watched.map(e => e.name), cards.map(c => c.name));
  assert.equal(watched[0].iconBond, 'mujicaShip');
});

test('selection rendering resolves all three cards without an effects.json record', async t => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, json: async () => String(url).endsWith('assets.json') ? assets : {} });
  t.after(() => { globalThis.fetch = previousFetch; });
  await data.loadAll('assets', 'effects', 'items', 'choices');
  cards.forEach((c, i) => {
    const view = resolveSpCard({ id: c.effectId, ...c }, 'jibian');
    assert.equal(view.icon, assets.items[c.effectId]);
    assert.equal(view.whiteGlyph, i === 0);
    assert.equal(view.flavor, c.flavor);
  });
});

test('spectating restores cards from battle refs and keeps different owners separate', () => {
  const spec = { modeId: 'mode_single_zhajing', players: [
    { playerId: 'p1', playerEffects: [{ id: 'jibian_yinhezhanjian#1', key: 'jibian:jibian_yinhezhanjian' }] },
    { playerId: 'p2', playerEffects: [{ id: 'jibian_duoshouyeshou#2', data: { effectId: 'jibian_duoshouyeshou' } }] },
    { playerId: 'p3', playerEffects: [] },
  ] };
  assert.equal(spectateEffects(spec, ['p1', 'p2'], source), undefined);
  const by = spectateEffectsByPlayer(spec, ['p1', 'p2', 'p3'], source);
  assert.equal(by.p1[0].name, '银河战舰');
  assert.equal(by.p1[0].iconBond, 'mujicaShip');
  assert.equal(by.p2[0].name, '多首野兽');
  assert.equal(by.p2[0].rarity, 'legend');
  assert.equal(by.p2[0].jibian, true);
  assert.equal(by.p2[0].flavor, '你是多首的怪物');
  assert.deepEqual(by.p3, []);
  assert.equal(by.p1.some(e => e.effectId === 'jibian_duoshouyeshou'), false);
});
