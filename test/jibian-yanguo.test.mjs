// 回归：惊变「炎国游记」改版
//   立刻随机一个无视商店等级的【炎】干员 → 之后每过两回合再给一个
// 运行（项目根）: node test/jibian-yanguo.test.mjs
import fs from 'node:fs';
import { registerMeta } from '../server/sim/content/jibian.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
const bonds = JSON.parse(fs.readFileSync(new URL('../data/bonds.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

console.log('=== ① 卡面文案 ===');
for (const mid of ['mode_single_zhajing', 'mode_multi_zhajing']) {
  const card = cfg.modes[mid].jibian.pool.find((c) => c.effectId === 'jibian_yanguoyouji');
  chk(`${mid}：有新文案`, !!card && card.desc === '你立刻随机获得一个无视商店等级的【炎】盟约干员，之后每过两回合再次随机获得一个。',
    card ? card.desc : '缺卡');
}

console.log('\n=== ② 处理器：立刻发一个【炎】干员 ===');
const reg = new Map();
registerMeta({ register: (k, h) => reg.set(k, h) });
const pick = reg.get('jibian:jibian_yanguoyouji');
chk('已注册 jibian:jibian_yanguoyouji', !!pick);

function mkCtx(round, counter, rolls) {
  const log = { rolled: [], granted: [], counter: { ...counter } };
  return {
    round,
    source: { kind: 'effect' },
    log,
    rollChess: (opts) => { log.rolled.push(opts); return rolls.shift() ?? null; },
    grantChess: (id, opts) => { log.granted.push({ id, opts }); return true; },
    counter: (k) => log.counter[k] || 0,
    setCounter: (k, v) => { log.counter[k] = v; },
    toast: () => {},
  };
}

const c1 = mkCtx(1, {}, ['chess_zj_67_a']);
pick.onChoicePick(c1, { card: { id: 'jibian_yanguoyouji' } });
chk('抽到就发了一个', c1.log.granted.length === 1, JSON.stringify(c1.log.granted));
chk('rollChess 带 bond=yanShip + maxTier=6（无视商店等级）',
  c1.log.rolled[0]?.bond === 'yanShip' && c1.log.rolled[0]?.maxTier === 6, JSON.stringify(c1.log.rolled[0]));
chk('grantChess 不占池份数', c1.log.granted[0]?.opts?.requirePool === false, JSON.stringify(c1.log.granted[0]?.opts));
chk('记下了回合号 = 1', c1.log.counter['jibian:yanguoyouji:last'] === 1, JSON.stringify(c1.log.counter));

console.log('\n=== ③ 每过两回合再给一个 ===');
const hook = pick.onRoundStart ? pick : null;
chk('挂了 onRoundStart 钩子', !!hook);

function tick(round, counter, rolls) {
  const ctx = mkCtx(round, counter, rolls);
  pick.onRoundStart(ctx);
  return ctx;
}
const base = { 'jibian:yanguoyouji:last': 1 };
const r2 = tick(2, base, ['should-not-be-used']);
chk('第 2 回合（间隔 1）不发', r2.log.granted.length === 0 && r2.log.rolled.length === 0, JSON.stringify(r2.log.granted));
const r3 = tick(3, base, ['chess_zj_68_a']);
chk('第 3 回合（间隔 2）发一个', r3.log.granted.length === 1 && r3.log.granted[0].id === 'chess_zj_68_a', JSON.stringify(r3.log.granted));
chk('发完把回合号更新成 3', r3.log.counter['jibian:yanguoyouji:last'] === 3, JSON.stringify(r3.log.counter));
const r4 = tick(4, { 'jibian:yanguoyouji:last': 3 }, ['x']);
chk('第 4 回合（间隔 1）不发', r4.log.granted.length === 0);
const r5 = tick(5, { 'jibian:yanguoyouji:last': 3 }, ['chess_zj_69_a']);
chk('第 5 回合（间隔 2）再发一个', r5.log.granted.length === 1, JSON.stringify(r5.log.granted));

console.log('\n=== ④ 旧的「精锐奖励权重 ×2」已经删掉 ===');
const acq = fs.readFileSync(new URL('../server/match/player/acquire.js', import.meta.url), 'utf8');
chk('acquire.js 里没有 _jibianRewardBoost', !acq.includes('_jibianRewardBoost'));
chk('acquire.js 里没有 _isYanMember', !acq.includes('_isYanMember'));
chk('acquire.js 的 _rollRewardChess 只剩原始 roll', /_rollRewardChess\(tier, filter\) \{\s*\/\/[^]*?return this\.pool\(\)\.roll/.test(acq));

console.log('\n=== ⑤ 【炎】盟约存在 ===');
chk('bonds.json 有 yanShip', !!bonds.yanShip, bonds.yanShip?.name);

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
