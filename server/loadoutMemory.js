// server/loadoutMemory.js — 干员配装的服务端记忆（2026-10-18）。
//
// 为什么需要：配装（`room.loadout`：entries + 潜能/练度 ops + 卡池预选 bans）只存在浏览器的 localStorage 里，
// 而 localStorage 按 **origin** 隔离 —— 1服（thousandaki.top）和 2服（124.70.189.186）是两个 origin，
// 于是换个节点进游戏，配装全回到默认，玩家要重配一遍。
//
// 这里按【玩家名 + 档位】记：`{ 玩家名: { normal: {...}, zhajing: {...} } }`。
// 普通档与**炸惊档**各一份（客户端 `syncSetOf` 决定当前发的是哪一档，随 `room.loadout` 的 `mode` 上来）。
// 两台服务器之间再通过 `deploy/skins-sync.sh` 定期做并集（`/loadouts-export` + `/loadouts-sync`）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, '..', 'data', 'loadouts-by-name.json');

/** 两个档位。其它值一律当 normal。 */
export const MODES = Object.freeze(['normal', 'zhajing']);

let cache = null;

const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const modeOf = (m) => (m === 'zhajing' ? 'zhajing' : 'normal');
const nEntries = (rec) => (isMap(rec) && isMap(rec.entries) ? Object.keys(rec.entries).length : 0);

/** 把老格式 `{entries, ops, bans}` 或新格式 `{normal:{…}, zhajing:{…}}` 统一成新格式。 */
function normalizePlayer(v) {
  if (!isMap(v)) return null;
  if (isMap(v.entries)) return { normal: v, zhajing: null };     // 旧格式（只有普通档）
  const out = { normal: null, zhajing: null };
  for (const m of MODES) if (isMap(v[m])) out[m] = v[m];
  return out.normal || out.zhajing ? out : null;
}

function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const out = {};
    if (isMap(raw)) {
      for (const [name, v] of Object.entries(raw)) {
        const n = normalizePlayer(v);
        if (n) out[name] = n;
      }
    }
    cache = out;
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache), 'utf8');
  } catch {
    /* 记不住不影响本局 */
  }
}

/**
 * 这个名字在某一档上次的配装（null = 没有记录）。
 * @param {string} name
 * @param {'normal'|'zhajing'} [mode]
 * @returns {{ entries: Record<string, any>, ops?: Record<string, any>, bans?: any } | null}
 */
export function recallLoadout(name, mode = 'normal') {
  if (typeof name !== 'string' || !name) return null;
  const p = load()[name];
  const rec = p && p[modeOf(mode)];
  return nEntries(rec) ? rec : null;
}

/** 记住这个名字在某一档的配装（只接受非空 entries）。 */
export function rememberLoadout(name, mode, rec) {
  if (typeof name !== 'string' || !name) return;
  if (!nEntries(rec)) return;
  const all = load();
  const p = all[name] || { normal: null, zhajing: null };
  p[modeOf(mode)] = { entries: { ...rec.entries }, ops: isMap(rec.ops) ? { ...rec.ops } : {}, bans: rec.bans ?? null };
  all[name] = p;
  save();
}

/** 整份记忆（给联通同步用）。 */
export function exportLoadouts() {
  return { ...load() };
}

/**
 * 并入对端的一份：按玩家、按档位分别取并集；同一档 entries 更多的赢（相等保留本地）。
 * 兼容老格式（对端还是只记普通档的旧版本）。
 * @returns {number} 实际被改写的 (玩家, 档位) 数
 */
export function mergeLoadouts(map) {
  if (!isMap(map)) return 0;
  const all = load();
  let changed = 0;
  for (const [name, v] of Object.entries(map)) {
    if (typeof name !== 'string' || !name) continue;
    const src = normalizePlayer(v);
    if (!src) continue;
    const p = all[name] || { normal: null, zhajing: null };
    for (const m of MODES) {
      const inRec = src[m];
      if (!nEntries(inRec)) continue;
      if (nEntries(inRec) > nEntries(p[m])) {
        p[m] = { entries: { ...inRec.entries }, ops: isMap(inRec.ops) ? { ...inRec.ops } : {}, bans: inRec.bans ?? null };
        changed++;
      }
    }
    all[name] = p;
  }
  if (changed) save();
  return changed;
}
