// Multi-human bot-exec distribution test.
import { MatchClientCombat } from '../server/match/match/clientCombat.js';

function makeMatch(humanCount, multi = true) {
  const players = new Map();
  for (let i = 0; i < humanCount; i++) {
    players.set(`p${i}`, { playerId: `p${i}`, seat: i, isBot: false, left: false, connected: true });
  }
  for (let i = 0; i < 4; i++) {
    players.set(`ai${i}`, { playerId: `ai${i}`, seat: 10 + i, isBot: true, left: false, connected: true });
  }
  const m = Object.create(MatchClientCombat.prototype);
  Object.assign(m, { players, clientBots: true, clientBotsMulti: multi, _execLoad: new Map() });
  return m;
}

function run(humanCount, multi, fields) {
  const m = makeMatch(humanCount, multi);
  const picks = [];
  for (let i = 0; i < fields; i++) {
    const host = m.clientExecHost();
    if (!host) { picks.push('none'); continue; }
    picks.push(host);
    m._execLoad.set(host, m._execLoadOf(host) + 1);
  }
  const counts = {};
  for (const p of picks) if (p !== 'none') counts[p] = (counts[p] || 0) + 1;
  console.log(`  humans=${humanCount} multi=${multi} bots=${fields} =>`, picks.join(' '), '| per person:', JSON.stringify(counts));
  return { picks, counts };
}

let pass = 0, fail = 0;
const chk = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ok   ${label} ${extra}`); }
  else { fail++; console.log(`  FAIL ${label} ${extra}`); }
};

console.log('=== 1. solo room: host takes at most 12 ===');
{
  const { picks, counts } = run(1, true, 14);
  chk('first 12 go to host', picks.slice(0, 12).every((p) => p === 'p0'), JSON.stringify(counts));
  chk('13th/14th fall back to server', picks[12] === 'none' && picks[13] === 'none');
}

console.log('=== 2. 4 humans: round-robin, each <= 3 ===');
{
  const { picks, counts } = run(4, true, 14);
  const maxPer = Math.max(...Object.values(counts));
  chk('each person <= 3', maxPer <= 3, `max=${maxPer}`);
  chk('all 4 got some', Object.keys(counts).length === 4, JSON.stringify(counts));
  chk('beyond 4x3=12 goes back to server', picks.filter((p) => p === 'none').length === 2);
}

console.log('=== 3. multi-human with switch off: all server ===');
{
  const { picks } = run(4, false, 3);
  chk('nothing delegated', picks.every((p) => p === 'none'), picks.join(' '));
}

console.log('=== 4. disconnected player gets nothing ===');
{
  const m = makeMatch(3, true);
  m.players.get('p0').connected = false;
  const picks = [];
  for (let i = 0; i < 8; i++) {
    const h = m.clientExecHost();
    picks.push(h || 'none');
    if (h) m._execLoad.set(h, m._execLoadOf(h) + 1);
  }
  chk('p0 (disconnected) got nothing', !picks.includes('p0'), picks.join(' '));
}

console.log(`\nresult: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
