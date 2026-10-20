// server/skinsMemory.js — 皮肤记录的服务端记忆（用户 2026-10-13）。
//
// 为什么需要：皮肤选择原本只存在浏览器的 localStorage 里，而 localStorage 是按【访问地址(origin)】隔离的
// （localhost:3000 与 127.0.0.1:3000 是两套）。换地址或换浏览器后本地为空，客户端把空表发上来，服务端就把
// 原来记住的清掉 —— 结果所有皮肤变回默认。这里按【玩家名】记一份，收到空表时把它回传，于是换地址也能拿回来。
//
// 只在新选择非空时覆盖；文件很小（一个玩家几十条），所以同步写盘即可。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, '..', 'data', 'skins-by-name.json');

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const d = JSON.parse(raw);
    cache = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
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
    /* 记不住不影响本局：只是下次换浏览器会回落到默认 */
  }
}

/** 这个名字上次记住的皮肤（null = 没有记录）。 */
export function recallSkins(name) {
  if (typeof name !== 'string' || !name) return null;
  const m = load()[name];
  return m && typeof m === 'object' && !Array.isArray(m) ? m : null;
}

/** 记住这个名字的皮肤选择（只接受非空对象）。 */
export function rememberSkins(name, skins) {
  if (typeof name !== 'string' || !name) return;
  if (!skins || typeof skins !== 'object' || Array.isArray(skins)) return;
  if (!Object.keys(skins).length) return;
  load()[name] = { ...skins };
  save();
}

// ---- 双服联通（2026-10-18）---------------------------------------------------------------------------
// 皮肤记忆原本只按【服务器】记一份，两个节点各有一份 —— 同一个玩家从 1服换到 2服，
// 那边的 origin 不一样（localStorage 是空的），服务端也没有他的记录，于是皮肤全回到默认。
// 下面两个函数给 `GET /skins-export` 与 `POST /skins-sync` 用，让两台的记忆定期做**并集**。

/** 整份记忆的浅拷贝（导出给对端）。 */
export function exportSkins() {
  return { ...load() };
}

/**
 * 并入对端的一份记忆：按玩家取并集，同一玩家**键更多的赢**（相等时保留本地，避免两台来回抖动）。
 * 只加不减 —— 玩家在对面删掉的皮肤选择会被重新并回来，换来的是"两边永远看得到同一套"。
 * @param {Record<string, Record<string, string>>} map
 * @returns {number} 实际被改写的玩家数
 */
export function mergeSkins(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return 0;
  const all = load();
  let changed = 0;
  for (const [name, v] of Object.entries(map)) {
    if (typeof name !== 'string' || !name) continue;
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const cur = all[name];
    const curN = cur && typeof cur === 'object' && !Array.isArray(cur) ? Object.keys(cur).length : -1;
    const inN = Object.keys(v).length;
    if (inN > curN) { all[name] = { ...v }; changed++; }
  }
  if (changed) save();
  return changed;
}

