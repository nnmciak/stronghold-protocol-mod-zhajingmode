// S.E.E.S 版本三个新惊变的行为回归。
// 运行（项目根）: node test/sees-jibian.test.mjs
//
// 用户 2026-10-17 的 S.E.E.S.txt：
//   数万真言 史诗  你的干员开启技能所需的技力增加100%，但技能持续期间攻击力+300%
//   三月五日 传说  你获得一个精锐结城理
//   无下限术式 传说 你的所有干员获得99.9%的闪避
import { makeBattle, enemyRec } from './helpers/battleHarness.js';
import { registerMeta } from '../server/sim/content/jibian.js';

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

let seq = 0;
function make({ effects = [], chessId = 'chess_zj_60_5_b', skillIndex = 2, withEnemy = false } = {}) {
  const enemies = [], defs = { enemies: {} };
  if (withEnemy) {
    const k = 'js' + (seq++);
    enemies.push({ key: k, time: 0, route: { motion: 'WALK', start: [9, 7], end: [9, 7], checkpoints: [] } });
    defs.enemies[k] = enemyRec({ key: k, hp: 1e9, atk: 100, def: 0, speed: 0 });
  }
  const h = makeBattle({
    units: [{ chessId, skillIndex, row: 9, col: 6 }],
    enemies, defs, seed: 7, flags: { startOpCooldown: 0 },
    playerEffects: effects.map((id) => ({ key: 'jibian:' + id })),
    autoFinish: false, timeLimit: 600, captureNoisy: false,
  });
  const u = h.unit(chessId);
  h.step(1);
  h.b.emit('deploy', { unit: u, initial: true });
  h.step(3);
  return { h, u };
}

// ── ① 数万真言：技力需求 +100%
console.log('=== ① 数万真言：技力需求 ×2 ===');
{
  const plain = make({ chessId: 'chess_zj_60_5_b', skillIndex: 2 });
  const baseCost = plain.u.skill.baseSpCost ?? plain.u.skill.spCost;
  console.log('     基准 spCost = %s（baseSpCost %s）', plain.u.skill.spCost, baseCost);
  const carded = make({ effects: ['jibian_shuwanzhenyan'], chessId: 'chess_zj_60_5_b', skillIndex: 2 });
  const newCost = carded.u.skill.spCost;
  console.log('     带惊变 spCost = %s  spCostMul = %s', newCost, carded.u.skill.spCostMul);
  chk('★ 技力需求变成 2 倍', newCost === Math.floor(baseCost * 2), `${baseCost} → ${newCost}`);
}

// ── ② 数万真言：技能持续期间攻击力 +300%
console.log('\n=== ② 数万真言：技能期间攻击力 +300% ===');
{
  const { h, u } = make({ effects: ['jibian_shuwanzhenyan'], chessId: 'chess_zj_60_5_b', skillIndex: 2 });
  const KEY = 'jibian:shuwanzhenyan:atk';
  const before = u.s.atk;
  chk('开技前没有那个 buff', !u.findBuff(KEY));
  u.skill.sp = 0;
  u.skill.activate('manual', { free: true });
  h.step(3);
  const b = u.findBuff(KEY);
  chk('★ 技能期间 buff 在', !!b, JSON.stringify(b && b.mods));
  chk('★ mods.atkPct = 3（+300%）', b && b.mods && b.mods.atkPct === 3, JSON.stringify(b && b.mods));
  const during = u.s.atk;
  console.log('     攻击力 %s → %s（%.2f 倍）', Math.round(before), Math.round(during), during / before);
  chk('攻击力明显提高', during > before * 2, `${Math.round(before)} → ${Math.round(during)}`);
  // 结束
  h.run(25);
  chk('★ 技能结束后 buff 被撤掉', !u.findBuff(KEY));
}

// ── ③ 无下限术式：99.9% 物法闪避
console.log('\n=== ③ 无下限术式：99.9% 闪避 ===');
{
  const { u } = make({ effects: ['jibian_wuxiaxian'], chessId: 'chess_zj_60_5_b', skillIndex: 2 });
  const buffs = (u.buffs || []).filter((b) => b && typeof b.key === 'string' && b.key.startsWith('jibian:wuxiaxian'));
  console.log('     命中的 buff: %s', JSON.stringify(buffs.map((b) => ({ k: b.key, m: b.mods }))));
  chk('★ 身上挂了闪避 buff', buffs.length >= 1);
  const m = (buffs[0] && buffs[0].mods) || {};
  chk('★ dodgePhys = 0.999', Math.abs((m.dodgePhys ?? 0) - 0.999) < 1e-9, String(m.dodgePhys));
  chk('★ dodgeArts = 0.999', Math.abs((m.dodgeArts ?? 0) - 0.999) < 1e-9, String(m.dodgeArts));
  console.log('     单位结算后的闪避值: dodgePhys=%s dodgeArts=%s', u.s.dodgePhys ?? '(n/a)', u.s.dodgeArts ?? '(n/a)');
}

// ── ④ 三月五日：抽到时发一个精锐结城理
console.log('\n=== ④ 三月五日：发放精锐结城理 ===');
{
  const reg = { seen: {}, register(n, d) { this.seen[n] = d; }, has: () => false };
  registerMeta(reg);
  const H = reg.seen['jibian:jibian_sanyuewuri'];
  chk('处理器已注册', !!H);
  const granted = [];
  const ctx = {
    chessRecord: (id) => (id === 'chess_zj_60_5_b' ? { chessId: id } : null),
    grantChess: (id, opts) => { granted.push({ id, opts }); return true; },
  };
  H.onChoicePick ? null : null;
  // ON_PICK 挂在 onChoicePick 里，但需要 justPicked 的 source 条件；这里直接调它的实现体无法绕过，
  // 所以按 registerMeta 暴露的同一函数调用，并把 source 设成 effect（= 刚抽到这张卡）
  H.onChoicePick({ ...ctx, source: { kind: 'effect' } }, { card: { id: 'jibian_sanyuewuri' } });
  console.log('     grantChess 调用: %s', JSON.stringify(granted));
  chk('★ 发了 chess_zj_60_5_b（精锐结城理）', granted[0] && granted[0].id === 'chess_zj_60_5_b', JSON.stringify(granted[0]));
  chk('★ 用 requirePool:false（不占商店池份数）', granted[0] && granted[0].opts && granted[0].opts.requirePool === false);
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
