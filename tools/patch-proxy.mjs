// patch-proxy.mjs — WS 中继：浏览器连 3200 → 转发到 3100，并给服务端下行的 m.public 帧打补丁。
// 目的只有一个：把「第二联防阶段 + 场上两人都触发谢拉格」这个**极难自然凑出来**的条件强行造出来，
// 用来验证真正跑在浏览器里的那条音效链路（screens/game.js → uniteFreezeCue → audio.freeze → Web Audio）。
//
// 补丁内容（只改下行 public 帧，上行一字不动）：
//   * pub.unite.round = 2                （伪装成阶段 2 跨队兜底）
//   * pub.unite.helpers = [所有玩家]      （伪装成"两人上场"）
//   * pub.fields[] 里联防/作战战场的 players = [所有玩家]
//   * pub.players[].bonds 里补一条 kjeragShip active  （伪装成两人都触发谢拉格）
//
// 用法：node patch-proxy.mjs [listenPort] [targetPort]
import { createServer, request as httpRequest } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const LISTEN = Number(process.argv[2] || 3200);
const TARGET = Number(process.argv[3] || 3100);

/** 给一帧 m.public 打条件补丁。 */
export function patchPublic(msg) {
  if (!msg || msg.t !== 'm.public') return msg;
  const ids = (Array.isArray(msg.players) ? msg.players : []).map((p) => p && p.playerId).filter((x) => typeof x === 'string');
  // 注意：`pub.unite` 只在真正的联防阶段里才存在（server/match/match/views.js），所以在打补丁的这场
  // 测试里要**无条件造出来** —— 否则客户端读到 round = 0，阶段 2 的判定永远进不去。
  if (!msg.unite || typeof msg.unite !== 'object') msg.unite = { helpers: [], leakers: [] };
  msg.unite.round = 2;
  msg.unite.helpers = ids.slice();
  if (!Array.isArray(msg.unite.leakers)) msg.unite.leakers = [];
  for (const f of Array.isArray(msg.fields) ? msg.fields : []) {
    if (f && (f.kind === 'unite' || f.kind === 'normal')) f.players = ids.slice();
  }
  for (const p of Array.isArray(msg.players) ? msg.players : []) {
    if (!p || typeof p !== 'object') continue;
    const list = Array.isArray(p.bonds) ? p.bonds : (p.bonds = []);
    const hit = list.find((b) => b && b.bondId === 'kjeragShip');
    if (hit) { hit.active = true; hit.layers = Math.max(1, Number(hit.layers) || 0); }
    else list.push({ bondId: 'kjeragShip', count: 6, active: true, tier: 2, layers: 2 });
  }
  return msg;
}

/** 一帧文本（或 Buffer）→ 打过补丁的文本；不是 JSON / 不是 public 就原样返回。 */
export function patchFrame(data) {
  let s;
  try { s = typeof data === 'string' ? data : Buffer.from(data).toString('utf8'); } catch { return data; }
  if (!s || s[0] !== '{') return data;
  let m;
  try { m = JSON.parse(s); } catch { return data; }
  if (!m || m.t !== 'm.public') return data;
  return JSON.stringify(patchPublic(m));
}

// HTTP 也一起转发：浏览器是从这个 origin 载入页面的（WS 代理只拦帧，页面本身还得能加载）。
const http = createServer((req, res) => {
  const up = httpRequest(
    { host: '127.0.0.1', port: TARGET, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${TARGET}` } },
    (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); },
  );
  up.on('error', () => { try { res.writeHead(502); res.end('proxy error'); } catch { /* ignore */ } });
  req.pipe(up);
});
const wss = new WebSocketServer({ server: http });
let seen = 0;

wss.on('connection', (client, req) => {
  const up = new WebSocket(`ws://127.0.0.1:${TARGET}${req.url || '/'}`);
  const queue = [];
  up.on('open', () => { for (const q of queue) up.send(q); queue.length = 0; });
  up.on('message', (data, isBinary) => {
    const out = isBinary ? data : patchFrame(data.toString());
    if (!isBinary) { try { if (JSON.parse(out).t === 'm.public') seen++; } catch { /* ignore */ } }
    if (client.readyState === WebSocket.OPEN) client.send(out);
  });
  up.on('close', () => { try { client.close(); } catch { /* ignore */ } });
  up.on('error', () => { try { client.close(); } catch { /* ignore */ } });
  client.on('message', (data, isBinary) => {
    const s = isBinary ? data : data.toString();
    if (up.readyState === WebSocket.OPEN) up.send(s); else queue.push(s);
  });
  client.on('close', () => { try { up.close(); } catch { /* ignore */ } });
  client.on('error', () => { try { up.close(); } catch { /* ignore */ } });
});

http.listen(LISTEN, '127.0.0.1', () => console.log(`[patch-proxy] ${LISTEN} → ${TARGET} (public 帧已打补丁) · 已补丁 public 帧 ${seen}`));
setInterval(() => console.log(`[patch-proxy] 已补丁 public 帧 ${seen}`), 20000);
