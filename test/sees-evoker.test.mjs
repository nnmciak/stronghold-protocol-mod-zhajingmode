// 验证「人格面具召唤器」(chess_item_sees_evoker_a)：戴它的成员，S.E.E.S 盟约效果是否真的翻倍
// 对比同一层数下：不戴 / 戴 summoner 的同一名 S.E.E.S 成员的 攻击力 与 攻速。
// 运行（项目根）: node test/sees-evoker.test.mjs
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

let seq = 0;
function setup(layers, items) {
  const E = 'ev' + (seq++);
  const h = makeBattle({
    units: [{ chessId: 'chess_zj_60_3_a', row: 9, col: 6, items }],   // 埃癸斯（S.E.E.S 成员）
    enemies: [{ key: E, time: 0, route: { motion: 'WALK', start: [3, 3], end: [3, 3], checkpoints: [] } }],
    defs: { enemies: { [E]: enemyRec({ key: E, hp: 1e9, atk: 0, def: 0, speed: 0 }) } },
    seed: 7,
    flags: { startOpCooldown: 0, layerGainsEnabled: true },
    bonds: { seesShip: { active: true, count: 2, layers } },
    autoFinish: false, timeLimit: 600, captureNoisy: false,
  });
  const u = h.unit('chess_zj_60_3_a');
  h.step(2);
  return { h, u };
}

const EVOKER = ['chess_item_sees_evoker_a'];
const layers = 200;
const plain = setup(layers, []);
const withEv = setup(layers, EVOKER);

const a0 = plain.u.s.atk, a1 = withEv.u.s.atk;
const s0 = plain.u.s.aspd, s1 = withEv.u.s.aspd;

console.log('=== 基础数据（200 层，埃癸斯） ===');
console.log('  不戴召唤器：ATK %s  ASPD %s', a0.toFixed(1), s0.toFixed(1));
console.log('  戴召唤器  ：ATK %s  ASPD %s', a1.toFixed(1), s1.toFixed(1));

chk('戴召唤器的攻击力明显更高', a1 > a0, `${a0.toFixed(1)} → ${a1.toFixed(1)}`);
chk('戴召唤器的攻速明显更高', s1 > s0, `${s0.toFixed(1)} → ${s1.toFixed(1)}`);

// 盟约给的是「攻击力 +b」（b = (10+0.25L)/100，200 层 ⇒ +60%），召唤器把 b 翻倍成 2b。
// 加成加算在 100% 之上，所以**相对倍率** = (1+2b)/(1+b) = 2.2/1.6 = 1.375（+37.5%），不是 +60%。
const b = (10 + 0.25 * layers) / 100;
const want = (1 + 2 * b) / (1 + b);
const got = a1 / a0;
const ratioAtk = got - 1;
console.log('  ATK 倍率 = %s（按 (1+2b)/(1+b) 应为 %s，b = %s）', got.toFixed(3), want.toFixed(3), b);
chk('翻倍语义正确（翻的是盟约那一份 b，不是最终攻击力）', Math.abs(got - want) < 0.01, `${got.toFixed(3)} vs ${want.toFixed(3)}`);

// 技力需求：每 100 层 -1，戴召唤器 ×2（200 层 ⇒ -4，但不能把消耗压到 0）
const sp0 = plain.u.skill?.spCost, sp1 = withEv.u.skill?.spCost;
console.log('  技力消耗：不戴 %s / 戴 %s', sp0, sp1);
chk('戴召唤器的技力消耗不高于不戴的', sp1 != null && sp0 != null && sp1 <= sp0, `${sp0} vs ${sp1}`);
chk('技力消耗没有被压到 0（技力条不会消失）', !(sp1 === 0), `spCost=${sp1}`);

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
