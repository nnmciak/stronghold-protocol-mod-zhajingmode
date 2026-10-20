// 回归：新惊变「魔鬼鱼」（jibian_moguiyu）
//   卡面：稀有 / 阿戈尔图标 / 「获得一个精锐克莱门莎」/ 风味文本「遇见我是你的蝠鲼。」
//   行为：抽到即获得一名精锐克莱门莎（chess_zj_51_b）
// 运行（项目根）: node test/jibian-moguiyu.test.mjs
import fs from 'node:fs';
import { registerMeta } from '../server/sim/content/jibian.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
const chess = JSON.parse(fs.readFileSync(new URL('../data/chess.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
const chk = (l, c, e = '') => { if (c) { pass++; console.log('  ✓ %s %s', l, e); } else { fail++; console.log('  ✗ %s %s', l, e); } };

console.log('=== ① 卡面数据（两个炸惊模式都要有） ===');
for (const mid of ['mode_single_zhajing', 'mode_multi_zhajing']) {
  const pool = cfg.modes[mid].jibian.pool;
  const card = pool.find((x) => x.effectId === 'jibian_moguiyu');
  chk(`${mid} 有这张卡`, !!card);
  if (!card) continue;
  chk('  稀有度 = rare（稀有）', card.rarity === 'rare', card.rarity);
  chk('  图标盟约 = egirShip（阿戈尔）', card.bond === 'egirShip', String(card.bond));
  chk('  名称 = 魔鬼鱼', card.name === '魔鬼鱼', card.name);
  chk('  描述 = 获得一个精锐克莱门莎', card.desc === '获得一个精锐克莱门莎', card.desc);
  chk('  风味 = “遇见我是你的蝠鲼。”', card.flavor === '“遇见我是你的蝠鲼。”', card.flavor);
}

console.log('\n=== ② 处理器：抽到就发一个精锐克莱门莎 ===');
const reg = new Map();
registerMeta({ register: (k, h) => reg.set(k, h) });
const h = reg.get('jibian:jibian_moguiyu');
chk('已注册 jibian:jibian_moguiyu', !!h);

const granted = [];
const ctx = {
  source: { kind: 'effect' },        // justPicked 的判定：ref 上的钩子（不是 choice:<id>）
  chessRecord: (id) => (id === 'chess_zj_51_b' || id === 'chess_zj_51_a' ? chess[id] : null),
  grantChess: (id, opts) => { granted.push({ id, opts }); return true; },
  counter: () => 0, setCounter: () => {}, toast: () => {},
};
h.onChoicePick(ctx, { card: { id: 'jibian_moguiyu' } });
chk('发出的棋子 = chess_zj_51_b（精锐克莱门莎）', granted.length === 1 && granted[0].id === 'chess_zj_51_b',
  JSON.stringify(granted));
chk('不占商店池份数（requirePool: false）', !!granted[0] && granted[0].opts?.requirePool === false,
  JSON.stringify(granted[0]?.opts));

console.log('\n=== ③ 抽到别的卡时不会误发 ===');
const g2 = [];
const ctx2 = { ...ctx, grantChess: (id) => { g2.push(id); return true; } };
h.onChoicePick(ctx2, { card: { id: 'jibian_qishijingji' } });
chk('不是自己这张 → 不发', g2.length === 0, JSON.stringify(g2));

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
