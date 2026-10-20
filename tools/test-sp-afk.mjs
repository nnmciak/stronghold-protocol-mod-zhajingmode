// test-sp-afk.mjs — 验证:机变阶段有玩家【完全不选】时,阶段仍会自动结束(不再卡死全房间)。
//
// 做法:人类座位照常开局,但【拦截 m.pickCard】—— 所有人类的选择一律丢弃(模拟掉线/AFK 的玩家),
// 然后看 SP_DRAFT 能否自己走出去。修前:spDone 永远为 false,阶段永远不结束。
//
// 用法: node test-sp-afk.mjs [seats] [humanSeats]

import path from 'node:path';

const ROOT = process.cwd();
const SEATS = Number(process.argv[2] || 8);
const HUMANS = Number(process.argv[3] || 4);

const { Match } = await import('file:///' + path.join(ROOT, 'server', 'match', 'Match.js').replace(/\\/g, '/'));
const { VirtualScheduler } = await import('file:///' + path.join(ROOT, 'server', 'match', 'scheduler.js').replace(/\\/g, '/'));
const { modeIdFor } = await import('file:///' + path.join(ROOT, 'shared', 'constants.js').replace(/\\/g, '/'));
const { loadData } = await import('file:///' + path.join(ROOT, 'server', 'data.js').replace(/\\/g, '/'));

const data = loadData();
const log = { info() {}, warn() {}, error() {}, debug() {} };
const sched = new VirtualScheduler({ instantCombat: true });

const seats = [];
const humanIds = [];
for (let i = 0; i < SEATS; i++) {
  const human = i < HUMANS;
  const playerId = (human ? 'hu_' : 'ai_') + i.toString(36).padStart(3, '0');
  if (human) humanIds.push(playerId);
  seats.push({ seat: i, playerId, name: human ? ('博士' + (i + 1)) : ('AI·' + (i + 1)),
               isBot: !human, connected: true, left: false });
}

const stats = {
  spEntries: 0,          // 进入机变几次
  spExits: 0,            // 机变被走完几次
  blockedHumanPicks: 0,  // 被丢弃的人类选择次数
  autoPicks: 0,          // 超时自动分配次数(靠 pickCard 被拦截后由定时器补上)
  maxSpVirtualSeconds: 0,
};

const m = new Match({
  roomCode: 'AFK', mode: 'coop', difficulty: 'NORMAL', modeId: modeIdFor('coop', 'NORMAL'),
  seats, seed: 4242, matchNo: 1, data, log,
  now: () => sched.now(), scheduler: sched,
  send: () => true, broadcast: () => {},
  onEnd: () => {},
  botRehearsal: 0,
  timerScale: 0.25,      // 计时缩小,让虚拟时间跑得快一些(16s → 4s)
});

// —— 拦截人类的选择:这就是"AFK 玩家"
let spEnterAt = 0;
const origPick = m.pickCard.bind(m);
m.pickCard = (ps, idx) => {
  if (ps && humanIds.includes(ps.playerId)) {
    if (m.phase === 'SP_DRAFT') { stats.blockedHumanPicks++; return 'OK'; }   // 假装成功,实际什么都不做
  }
  return origPick(ps, idx);
};

// —— 观察机变阶段的进出
const origEnterSp = m.enterSpDraft.bind(m);
m.enterSpDraft = () => {
  stats.spEntries++;
  spEnterAt = sched.now();
  return origEnterSp();
};
const origFinishSp = m.finishSpDraft.bind(m);
m.finishSpDraft = () => {
  stats.spExits++;
  stats.maxSpVirtualSeconds = Math.max(stats.maxSpVirtualSeconds, (sched.now() - spEnterAt) / 1000);
  return origFinishSp();
};

m.start();

// 驱动(与 smoke100 相同的方式)
let guard = 0;
while (!m.ended && guard++ < 400000) {
  const before = sched.executed;
  const nextAt = typeof sched.nextAt === 'function' ? sched.nextAt() : null;
  sched.advance(Math.max(50, nextAt == null ? 0 : (nextAt - sched.now()) + 1));
  if (typeof sched.nextAt === 'function' ? sched.nextAt() == null : sched.executed === before) break;
}

const spRemaining = (typeof m.spDone === 'function') ? m.spDone() : null;
const out = {
  seats: SEATS, humans: HUMANS,
  ended: m.ended,
  finalPhase: m.phase,
  spEntries: stats.spEntries,
  spExits: stats.spExits,
  blockedHumanPicks: stats.blockedHumanPicks,
  longestSpSeconds: Math.round(stats.maxSpVirtualSeconds),
  spDoneNow: spRemaining,
  schedErrors: sched.errors ? sched.errors.length : 0,
  matchErrors: (m.errors ? m.errors.length : 0),
};
console.log(JSON.stringify(out, null, 1));

// 判定:机变进过,而且每一次都退出去了 → 没有被 AFK 玩家拖住
const pass = out.spEntries > 0 && out.spExits === out.spEntries && out.ended;
console.log('');
console.log(pass
  ? '  PASS: 人类全程不选,机变阶段仍然每次都自动结束(超时兜底生效)'
  : `  FAIL: spEntries=${out.spEntries} spExits=${out.spExits} ended=${out.ended} —— 阶段没有自行结束`);
process.exit(pass ? 0 : 1);
