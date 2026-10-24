import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { getDefaultRegistry } from '../server/match/effectsMeta.js';

const m = new Match({ roomCode:'HVE', mode:'solo', difficulty:'ZHAJING', modeId:'mode_single_zhajing', seed: 5,
  data: getData(), registry: getDefaultRegistry(),
  seats: [{ seat: 0, playerId: 'p1', name: 't', isBot: false, connected: true }], send: () => true, broadcast: () => {}, onEnd: () => {} });
m.phase='PREP'; m.round=15;
m.enemyJibianCards = ['ejibian_hidden_song', 'ejibian_ruzhiceshi', 'ejibian_tongxingzheng'];
const ps = m.players.get('p1');
const view = ps.effectsView().filter((e) => e && e.enemy);
for (const e of view) console.log('-', e.id, '|', e.name, '|', e.rarity, '|', String(e.desc || '').slice(0, 24));
const song = view.find((e) => e.id === 'ejibian_hidden_song');
assert.ok(song, '隐秘卡要出现在已选列表');
assert.equal(song.name, '甜美歌喉');
assert.equal(song.rarity, 'hidden');
assert.ok(song.desc && song.desc.length > 4, '要有描述');
console.log('PASS');
m.dispose();