// 炸惊测试场：`SP_ZHAJING_SKIP_SP`（跳过惊变阶段）与 `SP_ZHAJING_CONFINE`（卡池限定干员）
// 运行（项目根）——**两个环境变量在模块加载时读，必须在启动前设好**：
//   SP_ZHAJING_SKIP_SP=1 SP_ZHAJING_CONFINE=char_4217_makoto,char_4218_aigis,char_4219_yukari,char_4220_kormr \
//     node test/zj-testground.test.mjs
// 不带变量运行 = 两个开关都关（本测试会按实际环境分别断言，两种都能过）。
//
// 用户 2026-10-17：「增加一个新的按钮让我进入没有惊变阶段的炸惊模拟，然后卡池只刷出这四个新干员」。
// 入口：大厅 → 选择模拟协议 → 「快速炸惊（测试场）」按钮（public/js/screens/lobby.js createTestMode）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const cfg = JSON.parse(readFileSync(join(ROOT, 'data/config.json'), 'utf8'));
const chess = JSON.parse(readFileSync(join(ROOT, 'data/chess.json'), 'utf8'));
const SKIP = !!String(process.env.SP_ZHAJING_SKIP_SP || '').trim();
const CONFINE = String(process.env.SP_ZHAJING_CONFINE || '').trim();

const { GameData } = await import('../server/match/gamedata.js');
const { confineFilter, cheatRollOpts, cheatEnabled } = await import('../server/match/player/cheat.js');

// ─────────────────────────────────────── ① 惊变阶段
console.log('=== ① 惊变阶段（SP_ZHAJING_SKIP_SP=%s）===', SKIP ? '1' : '未设');
const mode = cfg.modes.mode_single_zhajing;
chk('炸惊模式存在且难度为 ZHAJING', mode?.difficulty === 'ZHAJING', String(mode?.difficulty));
chk('原始 spPhaseKinds 有 9 个特殊回合', Object.keys(mode?.spPhaseKinds || {}).length === 9,
  String(Object.keys(mode?.spPhaseKinds || {}).length));

const gd = new GameData({ config: cfg }, 'mode_single_zhajing');
chk('gd 认得这是炸惊', gd.zhajing === true, String(gd.zhajing));
const ROUNDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const kinds = ROUNDS.map((r) => gd.spPhaseKind(r));
const special = kinds.filter(Boolean);
if (SKIP) {
  chk('★ 开关打开：12 个回合里 0 个特殊阶段（没有惊变）', special.length === 0, JSON.stringify(special));
} else {
  chk('开关关闭：特殊阶段仍是 9 个（行为与改动前一致）', special.length === 9, `${special.length}`);
}
// 无论开关如何，回合数与模式都不受影响
chk('回合表 spRounds 未被改动', JSON.stringify(mode.spRounds) === JSON.stringify([1, 2, 3, 4, 8, 9, 10, 11, 12]),
  JSON.stringify(mode.spRounds));

// ─────────────────────────────────────── ①b 敌方惊变（规则14，与"阶段"是两套机制）
console.log('\n=== ①b 敌方惊变（SP_ZHAJING_SKIP_SP=%s）===', SKIP ? '1' : '未设');
const ej = gd.enemyJibian();
if (SKIP) {
  chk('★ 开关打开：enemyJibian() 为 null（连敌方惊变一起跳过）', ej === null, String(ej));
} else {
  chk('开关关闭：配置读到敌方惊变（enabled + rounds）', !!ej && Array.isArray(ej.rounds),
    ej ? `rounds=${JSON.stringify(ej.rounds)} pool=${ej.pool.length}` : 'null');
}
// config 侧不该被改动（我们只改 gamedata 的返回值，不动数据）
chk('config 里 enemyJibian.enabled 仍是 true（数据未改）', mode.enemyJibian?.enabled === true,
  String(mode.enemyJibian?.enabled));

// ─────────────────────────────────────── ② 卡池限定
console.log('\n=== ② 卡池限定（SP_ZHAJING_CONFINE=%s）===', CONFINE || '未设');
const chessOf = (id) => chess[id] ?? null;
const f = confineFilter(chessOf);
if (CONFINE) {
  chk('confineFilter 已生效', typeof f === 'function');
  const pool = Object.entries(chess).filter(([, v]) => !v.isGolden && !v.isHidden);
  const passed = pool.filter(([id]) => f(id)).map(([id]) => id);
  const chars = new Set(pool.filter(([id]) => f(id)).map(([, v]) => v.charId));
  console.log('  放行: %s', passed.join(' '));
  chk('★ 只放行白名单里的干员', [...chars].every((c) => CONFINE.split(',').includes(c)), [...chars].join(','));
  chk('★ 放行数 = 白名单干员数（每人只放基础形态一枚）', passed.length === CONFINE.split(',').length,
    `${passed.length} vs ${CONFINE.split(',').length}`);
  chk('精锐被排除', f('chess_zj_60_5_b') === false, String(f('chess_zj_60_5_b')));
  chk('非白名单被排除', f('chess_zj_01_a') === false, String(f('chess_zj_01_a')));
  // 商店抽卡入口：cheatRollOpts 必须把 filter 传下去，否则限定不生效
  const opts = cheatRollOpts(null, chessOf, { testMode: true });
  chk('cheatRollOpts 带上了 filter', typeof opts.filter === 'function');
  const viaOpts = Object.keys(chess).filter((id) => !chess[id].isGolden && opts.filter(id));
  chk('★ 经商店抽卡入口后仍只有白名单', viaOpts.length === passed.length, `${viaOpts.length} vs ${passed.length}`);
} else {
  chk('未设变量：confineFilter 为 null（行为不变）', f === null, String(f));
  chk('未设变量：cheatRollOpts 不带 filter', !cheatRollOpts(null, chessOf, null).filter);
}

// ─────────────────────────────────────── ③ 测试模式与限定互不干扰
console.log('\n=== ③ 测试模式（外援测试模式 / SP_CHEAT）===');
chk('ps.testMode=true 时 cheatEnabled 为真', cheatEnabled({ testMode: true }) === true);
chk('ps.testMode 未开时为假（无 SP_CHEAT 时）', cheatEnabled({ testMode: false }) === (!!String(process.env.SP_CHEAT || '').trim()));
if (CONFINE) {
  // 限定优先于"只刷外援"：即使没有自选库存，filter 也该给出来
  const opts = cheatRollOpts(null, chessOf, { testMode: false });
  chk('★ 限定不依赖测试模式（未开测试模式也生效）', typeof opts.filter === 'function');
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
