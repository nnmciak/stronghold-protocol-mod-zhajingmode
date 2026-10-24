import test from 'node:test';
import assert from 'node:assert/strict';
import { FxLibrary } from '../public/js/render/vfx/library.js';
import { assetFetch } from '../public/js/render/assetFallback.js';

test('stable FX metadata URLs revalidate through assetFetch while prefab payloads retain normal caching', async () => {
  const skin = 'char_4185_amoris@avemujica#1';
  const key = 'amoris_attack_01_hit_01_avemujica#1';
  const list = { groups: {
    fx: { index: { path: '/assets/local/fx/index.json' }, textures: { path: '/assets/local/fx/textures.json' } },
    'fx/prefabs': { [key]: { path: '/assets/local/fx/prefabs/amoris-costume.json' } },
  } };
  const freshIndex = { format: 'fx-index', version: 3, units: { [skin]: {} }, mujicaSkinMaps: { [skin]: { projectiles: {} } } };
  const freshTextures = { textures: { 'amoris-costume': { wrap: 'clamp' } } };
  const requests = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url, cache: init.cache });
    const path = String(url).split('?')[0];
    // Simulate the browser's previously cached, pre-Mujica metadata at these
    // unchanged URLs. Only an explicit validation observes the installed patch.
    const json = path.endsWith('/index.json') ? (init.cache === 'no-cache' ? freshIndex : { format: 'fx-index', version: 3, units: {} })
      : path.endsWith('/textures.json') ? (init.cache === 'no-cache' ? freshTextures : { textures: {} })
      : { format: 'fx-prefab', key, nodes: [] };
    return { ok: true, json: async () => json };
  };
  try {
    const lib = new FxLibrary({ list, fetch: (url, init) => assetFetch(url, init) });
    assert.equal((await lib.index()).mujicaSkinMaps[skin], freshIndex.mujicaSkinMaps[skin]);
    assert.deepEqual(await lib.texInfo(), freshTextures.textures);
    assert.equal((await lib.descriptor(key)).key, key);
    assert.deepEqual(requests.map(r => r.cache), ['no-cache', 'no-cache', undefined]);
    assert.ok(requests.every(r => r.url.endsWith('?o=1')), 'metadata validation preserves the existing origin/CDN selection');
    // Per-view memoization still prevents repeated metadata transfers.
    await lib.index(); await lib.texInfo(); await lib.descriptor(key);
    assert.equal(requests.length, 3);
  } finally { globalThis.fetch = savedFetch; }
});

test('FX metadata validation survives an origin failure and the existing CDN retry', async () => {
  const requests = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url, cache: init.cache });
    return url.includes('?o=1') ? { ok: false, status: 503 } : { ok: true, json: async () => ({ version: 3, units: { current: {} } }) };
  };
  try {
    const lib = new FxLibrary({ list: { groups: {
      fx: { index: { path: '/fx-cache-retry/index.json' } }, 'fx/prefabs': { test: { path: '/unused.json' } },
    } }, fetch: (url, init) => assetFetch(url, init) });
    assert.ok((await lib.index()).units.current);
    assert.deepEqual(requests, [
      { url: '/fx-cache-retry/index.json?o=1', cache: 'no-cache' },
      { url: '/fx-cache-retry/index.json', cache: 'no-cache' },
    ]);
  } finally { globalThis.fetch = savedFetch; }
});
