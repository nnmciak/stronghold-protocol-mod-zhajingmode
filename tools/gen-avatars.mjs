// 头像目录生成器 —— 写 data/avatars.json（头像系统的唯一数据源）。
// 五组素材，全部来自国服客户端（前四组是既有的官方素材，第五组由 tools/local-extract/extract.py 的
// playeravatar job 从本机客户端提取）：
//   char:   干员头像        assets.chars[charId].avatar
//   e2:     干员精英二头像   assets.chars[charId].avatarE2
//   skin:   皮肤头像        assets.chars[charId].skins[*].avatar
//   band:   策略分队图标     assets.bands[bandId]（按 data/bands.json 的 sortId 排序，新增分队自动进列表）
//   player: 官方个人头像     data/local-assets.json 的 playeravatar 组（默认 15 / 动态静态 8 / 特殊 / 活动）
// 输出：{ version, generated, count, src: {id: url}, items: [{ id, name, group, sub }] }
//   id 形如 char:char_003_kalts / e2:char_003_kalts / skin:char_003_kalts@sale#14 / band:band_amiya / player:avatar_def_01
// 用法：node gen-avatars.mjs [--write]
import fs from 'node:fs';
import path from 'node:path';

const A = 'C:/Users/陈洁楷/Desktop/100wei(beta0.1)/Stronghold-Protocol';
const WRITE = process.argv.includes('--write');
const rd = (p) => JSON.parse(fs.readFileSync(path.join(A, p), 'utf8'));

const assets = rd('data/assets.json');
const chess = rd('data/chess.json');
const backups = rd('data/backups.json');
const bands = rd('data/bands.json');
const local = rd('data/local-assets.json');

// ---- 干员名（chess.json 143 + backups.json units 90 覆盖全部 211）-------------------------------------
const names = new Map();   // charId → { name, rarity }
for (const c of Object.values(backups.units || {})) {
  if (c && c.charId) names.set(c.charId, { name: c.name || c.appellation || c.charId, rarity: c.rarity });
}
for (const c of Object.values(chess)) {
  if (!c || !c.charId || !c.name) continue;
  const cur = names.get(c.charId);
  if (!cur) names.set(c.charId, { name: c.name, rarity: c.rarity });
}
const nameOf = (cid) => names.get(cid)?.name || cid;

// ---- 个人头像的官方名字（PRTS 文件号与客户端 id 一一对应；client 自己的 name 表在 gamedata 里，未提取）----
const PLAYER_NAMES = {
  def_01: '符号', def_02: '档案室', def_03: '从此出', def_04: '注意大黑', def_05: '补充简历',
  def_06: '3min', def_07: 'Good Game', def_08: 'PRTS', def_09: '希望消逝', def_10: '请勿模仿',
  def_11: '晚餐', def_12: '禁止加班', def_13: '球体', def_14: '沙漠金币', def_15: 'WARNING',
  dyn_01: '组织', dyn_02: '情感', dyn_03: '褪色追忆', dyn_04: '兔兔许愿星',
  dyn_05: '很调皮的狗', dyn_06: '很好奇的猫', dyn_07: '坠入清醒', dyn_08: '凝视映像',
  dyn_09: '舟友的酒',   // 用户自备动图（2026-10-13，GIF 无音轨）
  special_01: '黎明前奏', special_02: '沙滩急救', special_03: '滨水守卫', special_04: '2022余韵切片',
  special_05: '导演的认可', special_06: '徘徊歧路', special_07: '寻火之叶', special_08: '2023余韵切片',
  special_09: '回眸一笑', special_10: '记事拾遗', special_11: '天外宫阙', special_12: '目的地',
  special_13: '白兔子', special_14: '口袋舰船', special_15: '防守', special_16: '进攻',
  special_17: '2024余韵切片', special_18: '祈望星光', special_19: '很酷，不聊天', special_20: '蝴蝶结交流会',
  special_21: '侦探组合', special_22: '尤里卡的梦', special_23: 'Wink——', special_24: '骷髅与少女心',
  special_25: '云上的天使', special_26: '沉默的人与蛋', special_27: '浇灌磐蟹', special_28: '惊骇盐风',
  special_29: '点墨奇思', special_30: '快赶走啦！', special_31: '蓄能', special_32: '这照片是你吗？',
  special_33: '咔！', special_34: '重岳故事', special_35: '兔兔小夜曲', special_36: '兔兔店员',
  special_37: '2025余韵切片', special_38: '特邀嘉宾', special_39: '共聚', special_40: '欢快咔咔',
  special_MissC: '女士的准许',
};

const src = {};
const items = [];
const push = (id, name, group, sub) => { items.push(sub ? { id, name, group, sub } : { id, name, group }); };

// ---- 干员 / 精英二 ------------------------------------------------------------------------------------
const charIds = Object.keys(assets.chars).filter((cid) => assets.chars[cid] && assets.chars[cid].avatar);
const rank = (cid) => nameOf(cid).localeCompare(nameOf(cid), 'zh-Hans-CN');
charIds.sort((a, b) => (names.get(b)?.rarity ?? 0) - (names.get(a)?.rarity ?? 0) || rank(a, b));
for (const cid of charIds) {
  const c = assets.chars[cid];
  src[`char:${cid}`] = c.avatar;
  push(`char:${cid}`, nameOf(cid), 'char');
  if (c.avatarE2) { src[`e2:${cid}`] = c.avatarE2; push(`e2:${cid}`, nameOf(cid), 'e2'); }
}
// ---- 皮肤（按干员归组；同一干员下按皮肤 key 排序）------------------------------------------------------
let skinCount = 0;
for (const cid of charIds) {
  const skins = Object.entries(assets.chars[cid].skins || {}).filter(([, s]) => s && s.avatar);
  skins.sort(([a], [b]) => a.localeCompare(b));
  for (const [key, s] of skins) {
    src[`skin:${key}`] = s.avatar;
    push(`skin:${key}`, `${nameOf(cid)}·${s.name || key}`, 'skin', s.group || undefined);
    skinCount++;
  }
}
// ---- 策略分队（按官方 sortId；只收有图标的，新增分队自动出现）--------------------------------------------
const bandList = Object.values(bands).filter((b) => b && b.bandId && assets.bands[b.bandId]);
bandList.sort((a, b) => (a.sortId ?? 999) - (b.sortId ?? 999) || String(a.bandId).localeCompare(String(b.bandId)));
for (const b of bandList) { src[`band:${b.bandId}`] = assets.bands[b.bandId]; push(`band:${b.bandId}`, b.name || b.bandId, 'band'); }
// ---- 官方个人头像（本地客户端提取）--------------------------------------------------------------------
const paGroup = (local.groups && local.groups.playeravatar) || {};
const paPath = (v) => (typeof v === 'string' ? v : v && (v.path || v.url)) || null;
const paKeys = Object.keys(paGroup);
const paKind = (k) => (/^avatar_def_/.test(k) ? '默认' : /^avatar_dyn_/.test(k) ? '动态' : /^avatar_special_/.test(k) ? '特殊' : '活动');
const paName = (k) => {
  const tail = k.replace(/^avatar_/, '');
  if (PLAYER_NAMES[tail]) return PLAYER_NAMES[tail];
  const m = /^(def|dyn|special)_(\d+)$/.exec(tail);
  if (m) return `${{ def: '默认', dyn: '动态', special: '特殊' }[m[1]]} ${m[2]}`;
  if (tail === 'special_MissC') return '女士的准许';
  const act = /^activity_(.+)$/.exec(tail);
  return act ? `活动 ${act[1]}` : tail;
};
const paOrder = (k) => ({ '默认': 0, '动态': 1, '特殊': 2, '活动': 3 }[paKind(k)] ?? 9);
paKeys.sort((a, b) => paOrder(a) - paOrder(b) || a.localeCompare(b, undefined, { numeric: true }));
for (const k of paKeys) {
  const p = paPath(paGroup[k]);
  if (!p) continue;
  // 动态头像（用户 2026-10-13）：国服客户端里 dyn_01–04/07/08 是 spine、dyn_05/06 是序列帧；
  // 我们在 public/assets/local/playeravatar/dyn/ 下放了合成好的 gif（序列帧那两张），有就用 gif。
  const preferDynGif = (id, url) => { const m = /avatar_dyn_(\d+)/.exec(id); if (!m) return url;
    const gif = `/assets/local/playeravatar/dyn/avatar_dyn_${m[1]}.gif`;
    return fs.existsSync(path.join(A, 'public', gif)) ? gif : url; };
  src[`player:${k}`] = preferDynGif(k, p);
  push(`player:${k}`, paName(k), 'player', paKind(k));
}

const out = {
  version: 1,
  generated: new Date().toISOString().slice(0, 10),
  source: 'official CN client assets (char/avatar, char/skin_avatar, band/, local/playeravatar)',
  count: items.length,
  counts: {
    char: charIds.length,
    e2: items.filter((i) => i.group === 'e2').length,
    skin: skinCount,
    band: bandList.length,
    player: paKeys.length,
  },
  src,
  items,
};
const text = JSON.stringify(out);
console.log(`头像目录: ${items.length} 条（干员 ${out.counts.char} / 精英二 ${out.counts.e2} / 皮肤 ${out.counts.skin} / 分队 ${out.counts.band} / 个人头像 ${out.counts.player}）  ${(text.length / 1024).toFixed(0)} KB`);
const missing = items.filter((i) => !src[i.id]);
if (missing.length) console.log(`!! 没有 src 的条目: ${missing.length}`);
const dupes = items.length - new Set(items.map((i) => i.id)).size;
if (dupes) console.log(`!! 重复 id: ${dupes}`);
if (WRITE) {
  const p = path.join(A, 'data/avatars.json');
  if (fs.existsSync(p) && !fs.existsSync(p + '.bak')) fs.copyFileSync(p, p + '.bak');
  fs.writeFileSync(p, text);
  console.log(`已写入 ${p}（备份 *.bak）`);
} else console.log('(dry-run) 加 --write 才落盘');
