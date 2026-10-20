// 盟约 ban 位 与 游戏内红叉 的一致性测试
// 运行（项目根）: node test/bond-ban-consistency.test.mjs
//
// 用户 2026-10-16 报告：「盟约 ban 位和游戏内点击盟约时显示的红叉好像不一致」。
// 实测确认两处独立缺陷：
//   ① 游戏内弹窗读 pub.bannedChess（比赛级随机抽）而非 priv.bannedChess（玩家自己的池子）
//   ② 炸惊池两套棋库 id 命名不同（chess_zj_* vs chess_char_*），红叉只按 id 精确匹配 → 一枚都不画
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const chess = JSON.parse(readFileSync(join(ROOT, 'data/chess.json'), 'utf8'));
const bondsRaw = JSON.parse(readFileSync(join(ROOT, 'data/bonds.json'), 'utf8'));
const bonds = Array.isArray(bondsRaw) ? bondsRaw : Object.values(bondsRaw);
const config = JSON.parse(readFileSync(join(ROOT, 'data/config.json'), 'utf8'));

const { bannedChessFor, drawPlayerBans } = await import('file:///' + join(ROOT, 'shared/banPick.js').replace(/\\/g, '/'));
const gb = await import('file:///' + join(ROOT, 'public/js/ui/gameLogic/bonds.js').replace(/\\/g, '/'));
const { matchInfoModel } = await import('file:///' + join(ROOT, 'public/js/ui/matchInfo.js').replace(/\\/g, '/'));

const bondOf = (id) => bonds.find((b) => b && b.bondId === id) || null;
const bondIds = bonds.map((b) => b.bondId).filter(Boolean);
const getChess = (id) => chess[id] ?? null;

console.log('=== ① id 命名分布（本 bug 的事实基础）===');
const allVis = new Set();
for (const b of bonds) for (const m of (b.visibleMembers || [])) allVis.add(m);
const zjIds = [...allVis].filter((x) => x.includes('_zj_'));
const chIds = [...allVis].filter((x) => /^chess_char_/.test(x));
console.log('  bonds.visibleMembers 去重 %d 个: chess_zj_* %d / chess_char_* %d', allVis.size, zjIds.length, chIds.length);
console.log('  其中在 chess.json 里查不到的: %d', [...allVis].filter((id) => !chess[id]).length);
chk('成员 id 全部能在 chess.json 里解析', [...allVis].every((id) => !!chess[id]));

// 找出「同一 charId 在两套棋库 id 不同」的成员 —— 这些正是红叉匹配不到的
const idAlias = new Map();   // visibleMembers id → 该 charId 在炸惊池里的 id
for (const id of chIds) {
  const cid = chess[id]?.charId;
  if (!cid) continue;
  const zj = Object.keys(chess).find((k) => chess[k].charId === cid && k.includes('_zj_'));
  if (zj) idAlias.set(id, zj);
}
console.log('  两套棋库 id 不同的成员: %d 个（这些在炸惊局必须靠 charId 才认得出）', idAlias.size);

for (const [zhajing, label] of [[true, '炸惊池'], [false, '普通池']]) {
  console.log('\n' + '='.repeat(70));
  console.log('  %s  %s', label, zhajing ? '（bug ② 的现场）' : '（对照）');
  console.log('='.repeat(70));

  const visible = Object.keys(chess).filter((id) => (zhajing ? chess[id].zhajing === true : (chess[id].visible === true && chess[id].zhajing !== true)));
  const ZJ_KEY = Object.keys(config.modes || {}).find((k) => k.includes('zhajing'));
  const mode = config.modes?.[ZJ_KEY] || null;
  const modeInactive = new Set(Array.isArray(mode?.inactiveBondIds) ? mode.inactiveBondIds : []);
  const quota = (config.bans && config.bans[zhajing ? 'ZHAJING' : 'NORMAL']) || { core: 2, addon: 2 };

  // 玩家 ban 满配额
  const pick = bondIds.filter((b) => bondOf(b)?.isCore).slice(0, quota.core)
    .concat(bondIds.filter((b) => !bondOf(b)?.isCore).slice(0, quota.addon));
  const denied = drawPlayerBans({ entry: { bonds: pick, favorites: [], fill: true }, quota, bondIds, bondOf, modeInactive, rng: () => 0.5 });
  const bannedChess = bannedChessFor({ visibleChess: visible, chess: getChess, disabled: denied, modeInactive });
  console.log('  玩家 ban 的盟约: %s', pick.join(' '));
  console.log('  服务端 bannedChess: %d 枚', bannedChess.length);

  // ── 服务端规则自洽 ──────────────────────────────────────────────────────
  const off = new Set([...denied, ...modeInactive]);
  const wrong = bannedChess.filter((id) => {
    const bs = Array.isArray(chess[id]?.bonds) ? chess[id].bonds : [];
    return !(bs.length > 0 && bs.every((x) => off.has(x)));
  });
  const missed = visible.filter((id) => {
    const bs = Array.isArray(chess[id]?.bonds) ? chess[id].bonds : [];
    return bs.length > 0 && bs.every((x) => off.has(x)) && !bannedChess.includes(id);
  });
  chk('服务端：被剔除棋子的全部盟约都 off', wrong.length === 0, wrong.slice(0, 3).join(','));
  chk('服务端：应剔除的一枚不漏', missed.length === 0, missed.slice(0, 3).join(','));

  // ── 缺陷 ② ：bannedPerBond 的 charId 回退 ──────────────────────────────
  const perBondNew = gb.bannedPerBond(bonds, bannedChess, getChess);
  const perBondOld = gb.bannedPerBond(bonds, bannedChess);          // 不传 getChess = 旧行为
  const sumNew = [...perBondNew.values()].reduce((a, b) => a + b, 0);
  const sumOld = [...perBondOld.values()].reduce((a, b) => a + b, 0);
  console.log('\n  ── 缺陷② 红徽章计数 ──');
  console.log('     修前（只精确匹配）合计: %d', sumOld);
  console.log('     修后（含 charId 回退）合计: %d', sumNew);

  // 逐盟约核对：徽章数必须等于「成员里真被剔除的数目」。
  // 真值的算法必须与实现同口径：成员 id → charId → banned 里同 charId 的记录 id。
  // （banned 装的是**记录 id**，charId 从不在里面 —— 直接 banned.has(charId) 会恒为 false，
  //   这正是我第一版 isOff 写错、以及本测试第一版期望值算错的地方。）
  const bannedSet = new Set(bannedChess);
  const cidOf = (id) => { const c = getChess(id)?.charId; return typeof c === 'string' ? c : null; };
  const truthOff = (memberId) => {
    if (bannedSet.has(memberId)) return true;
    const cid = cidOf(memberId);
    if (!cid) return false;
    for (const k of bannedSet) if (k !== memberId && cidOf(k) === cid) return true;
    return false;
  };
  let mismatch = 0, sample = 0;
  for (const b of bonds) {
    const members = Array.isArray(b.visibleMembers) ? b.visibleMembers : [];
    const truth = members.filter(truthOff).length;
    const got = perBondNew.get(b.bondId) ?? 0;
    if (got !== truth) { mismatch++; if (sample++ < 3) console.log('     ✗ %s 徽章=%d 实际=%d', b.bondId, got, truth); }
  }
  chk('修后：每个盟约的红徽章数 == 成员里真被剔除数', mismatch === 0, `${mismatch} 个不符`);

  if (zhajing) {
    chk('★ 炸惊局修后红徽章不再为 0（bug ② 的回归）', sumNew > 0, `修前 ${sumOld} → 修后 ${sumNew}`);
    chk('★ 炸惊局确实存在别名成员（本 bug 的触发条件）', idAlias.size > 0, `${idAlias.size} 个`);
  } else {
    chk('普通池不受影响（id 本来就同一套）', sumNew === sumOld, `${sumOld} → ${sumNew}`);
  }

  // ── 缺陷 ① ：弹窗/面板的 ban 来源 ──────────────────────────────────────
  console.log('\n  ── 缺陷① ban 列表来源 ──');
  // 构造 pub（比赛级随机抽）与 priv（玩家自己的池子）**不同**的场景
  const matchLevel = bannedChessFor({
    visibleChess: visible, chess: getChess,
    disabled: drawPlayerBans({ entry: {}, quota, bondIds, bondOf, modeInactive, rng: () => 0.1 }),
    modeInactive,
  });
  const priv = { bannedChess, deniedBonds: denied, board: [], hand: [], temp: [] };
  const pub = { bannedChess: matchLevel, disabledBonds: [...denied, ...modeInactive], drawnDisabledBonds: [...denied], modeId: ZJ_KEY };
  chk('构造：比赛级与玩家自己的 ban 列表确实不同', JSON.stringify(matchLevel) !== JSON.stringify(bannedChess),
    `比赛级 ${matchLevel.length} 枚 vs 玩家 ${bannedChess.length} 枚`);

  const model = matchInfoModel(pub, { bonds, chess: getChess, mode, priv });
  chk('★ matchInfo 模型读的是玩家自己的 ban 列表',
    JSON.stringify(model.banned.slice().sort()) === JSON.stringify(bannedChess.slice().sort()),
    `模型 ${model.banned.length} 枚`);

  // 游戏内弹窗的 banned 来源（复刻 game.js 的 popBanned 逻辑）
  const popBanned = Array.isArray(priv?.bannedChess) ? priv.bannedChess : Array.isArray(pub?.bannedChess) ? pub.bannedChess : [];
  chk('★ 盟约弹窗读的是玩家自己的 ban 列表',
    JSON.stringify(popBanned.slice().sort()) === JSON.stringify(bannedChess.slice().sort()),
    `${popBanned.length} 枚`);
  chk('★ 弹窗不再读比赛级列表（bug ① 的回归）',
    JSON.stringify(popBanned.slice().sort()) !== JSON.stringify(matchLevel.slice().sort()));

  // BondPopup 的红叉：bondMembers 的 banned 字段
  console.log('\n  ── BondPopup 红叉（bondMembers.banned）──');
  let bmOk = 0, bmBad = 0;
  for (const b of bonds) {
    const rows = gb.bondMembers(b, priv, popBanned, getChess, () => null);
    for (const r of rows) {
      const truth = truthOff(r.id);
      if (!!r.banned === truth) bmOk++; else { bmBad++; if (bmBad <= 3) console.log('     ✗ %s(%s) banned=%s 实际=%s', r.id, r.name, r.banned, truth); }
    }
  }
  chk('修后：bondMembers 的 banned 与真值一致', bmBad === 0, `${bmOk} 对 / ${bmBad} 错`);

  // ── id 一致性：成员 id 与 charId 两套都要认 ────────────────────────────
  if (idAlias.size) {
    const [visId, zjId] = [...idAlias][0];
    const bs = bonds.filter((b) => (b.visibleMembers || []).includes(visId));
    if (bs.length) {
      const per = gb.bannedPerBond(bs, [zjId], getChess);
      const n = [...per.values()].reduce((a, b) => a + b, 0);
      chk(`★ 只 ban 了 ${zjId}，成员写了 ${visId} 也应认出`, n > 0, `徽章 ${n}`);
    }
  }
}

console.log('\n' + '='.repeat(70));
console.log('  %s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
console.log('='.repeat(70));
process.exit(fail ? 1 : 0);
