// 虎狼丸卫戍特质「<战斗中>部署后不占用可部署位置」回归。
// 运行（项目根）: node test/kormr-deploy-slot.test.mjs
//
// 用户 2026-10-17：「给他一个卫戍特质：<战斗中>部署后不占用可部署位置
//                  即这个干员可以不受最大人数限制（常为 8）」
//
// 实现：
//   · 数据 `data/garrisons.json` 新增 `garrison_zj_60_2_c`，`bb.no_deploy_slot = 1`
//   · `chess_zj_60_2_a / _b` 的 `garrisonIds` 挂上它
//   · `server/match/player/placement.js` 的 BOARD_FULL 判定放行带该标记的干员
//     （只放行"是否算占位"这一个判断，`deployCount` 本身不变）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

const cfg = JSON.parse(readFileSync(join(ROOT, 'data/config.json'), 'utf8'));
const GID = 'garrison_zj_60_2_c';
const KEY = 'no_deploy_slot';

const { GameData } = await import('../server/match/gamedata.js');
const { getData } = await import('../server/data.js');
const { noDeploySlot } = await import('../server/match/player/placement.js');

// 与 Match.js 同款：`new GameData(this.data, modeId)`，其中 data 由 data.js 一次性载入全部表
const data = getData();
const gd = new GameData(data, 'mode_single_zhajing');

console.log('=== ① 数据层：特质词条 ===');
{
  const g = gd.garrison(GID);
  chk('特质存在', !!g, GID);
  chk('文案 = 用户口径（含部署时叠层）', g?.desc === '<战斗中>部署后不占用可部署位置；<部署时>使自身已激活盟约+3', JSON.stringify(g?.desc));
  chk('机器可读标记 bb.no_deploy_slot = 1', Number(g?.bb?.[KEY]) === 1, JSON.stringify(g?.bb));
  chk('eventType = IN_BATTLE（<战斗中>）', g?.eventType === 'IN_BATTLE', String(g?.eventType));
  chk('eventTypeDesc = 作战能力', g?.eventTypeDesc === '作战能力', String(g?.eventTypeDesc));
}

console.log('\n=== ② 数据层：虎狼丸挂上了它 ===');
{
  for (const cid of ['chess_zj_60_2_a', 'chess_zj_60_2_b']) {
    const rec = gd.chess(cid);
    chk(`${cid} 存在`, !!rec);
    // ★ 2026-10-17（用户：「哪个不是天赋是卫戍特质 虎狼丸的你修改一下」）：精锐 `_b` 现在挂 `_d`
    //   —— 同样的「不占位」，但部署时叠层是 +6 而不是 +3（同 garrison_106_a/_b 的 4/8 写法）。
    const want = cid.endsWith('_b') ? 'garrison_zj_60_2_d' : GID;
    chk(`${cid} garrisonIds 含 ${want}`, Array.isArray(rec?.garrisonIds) && rec.garrisonIds.includes(want),
      JSON.stringify(rec?.garrisonIds));
  }
}

console.log('\n=== ③ 判定函数：虎狼丸 true、别人 false ===');
{
  const kormr = { kind: 'chess', id: 'chess_zj_60_2_a' };
  chk('虎狼丸（普通）→ true', noDeploySlot(gd, kormr) === true);
  chk('虎狼丸（精锐）→ true', noDeploySlot(gd, { kind: 'chess', id: 'chess_zj_60_2_b' }) === true);

  for (const [cid, nm] of [['chess_zj_60_5_a', '结城理'], ['chess_zj_60_3_a', '埃癸斯'], ['chess_zj_60_4_a', '岳羽由加莉'], ['chess_zj_01_a', '能天使']]) {
    chk(`${nm} → false（不受影响）`, noDeploySlot(gd, { kind: 'chess', id: cid }) === false);
  }
  chk('非棋子（token）→ false', noDeploySlot(gd, { kind: 'token', id: 'chess_zj_60_2_a' }) === false);
  chk('缺参数不抛异常', noDeploySlot(null, null) === false && noDeploySlot(gd, null) === false);
}

console.log('\n=== ④ 放行点确实接在 BOARD_FULL 判定上 ===');
{
  const src = readFileSync(join(ROOT, 'server/match/player/placement.js'), 'utf8');
  // 2026-10-17：判定被重构成「先算 exempt 再判」，并加了一条临时诊断日志，
  // 所以这里不再匹配一整行，而是分别验证三件事都还在。
  // 2026-10-17（用户录屏：「部署虎狼丸后拿其他干员拖动替换，突破部署上限」）：
  //   人数检查从 `deployCount >= deployCap` 改成「扣掉被替换者后仍超上限」的投影判定，
  //   并且**不再**只包在"目标不是棋子"的分支里 —— 替换路径也必须查，否则「虎狼丸→普通干员」
  //   净额 +1 却不检查，反复替换就能铺满棋盘。
  chk('人数上限判定仍在（投影式）',
    /const projected = this\.deployCount - \(occCounted \? 1 : 0\)/.test(src)
    && /projected >= this\.deployCap/.test(src)
    && /return fail\(ERR\.BOARD_FULL\)/.test(src));
  chk('上限判定被 noDeploySlot 放行（两条路径都查）',
    /const occCounted = !!occ && occ\.kind === 'chess' && !noDeploySlot\(this\.gd, occ\)/.test(src)
    && /&& !noDeploySlot\(this\.gd, piece\)\) return fail\(ERR\.BOARD_FULL\)/.test(src));
  // 2026-10-17（用户：「我在剩余1的时候放了它会变成0…可以改成不吃那个人数吗」）：
  //   deployCount 的行为**改了** —— 不占位的干员不计入。这里改为验证新语义。
  const basics = readFileSync(join(ROOT, 'server/match/player/basics.js'), 'utf8');
  chk('deployCount 仍然是个 getter', /get deployCount\(\) \{/.test(basics));
  chk('deployCount 会排除不占位干员（读 no_deploy_slot）',
    /no_deploy_slot/.test(basics) && /garrisonIds/.test(basics));
}

console.log('\n%s', fail ? `★ ${fail} 项失败 / ${pass} 通过` : `✓ 全部 ${pass} 项通过`);
process.exit(fail ? 1 : 0);
