// server/wsCompression.js — bounded WebSocket compression (SP_WS_COMPRESSION=on|off, default **on**).
//
// (2026-10-13: 默认值早已由 server/http/websocket.js 的调用点改成 on —— 那句 "default off" 是旧文案，改回一致。
//  关闭时按老办法：`SP_WS_COMPRESSION=off` 启动。共享压缩壳见 server/wsSharedDeflate.js。)
//
// Why opt-in: permessage-deflate trades CPU and a little latency for bandwidth, and the two only pay off on a link
// that is actually narrow. Battle frames (snapshots, events, field/damage pushes) are repetitive and dominate the
// byte count, so they are the only types compressed; everything else — credentials, hello/welcome, control and
// request/response traffic — stays uncompressed, which also keeps small frames from growing.
//
// Direction: this whitelist governs the SERVER's outbound frames only (send → sendRaw passes `compress`, ws.send
// applies it). The client's own outbound frames are not filtered here — `clientNoContextTakeover` is an extension
// negotiation parameter (it bounds the client's deflate context), NOT a per-message switch, and the 512-byte
// threshold is likewise the server's. So the accurate statement is "the server compresses these types on the way
// out", not "these types are compressed in both directions".
//
// The bounds matter as much as the ratio: no context takeover on either side (so a long-lived socket cannot grow
// unbounded state), a 12-bit window, a 512-byte threshold, 8 concurrent deflates and level 6 with memLevel 5 —
// the settings this project measured on a live server, not zlib's defaults. (12 rather than 9: the small window was
// tuned for the ~250-byte battle frames, but `m.public` is ~4.6 KB and a 512-byte window cannot reach its repeated
// bond/status blocks — measured 3.36x at 9 vs 4.94x at 12, and it is now 98% of the bytes a seat receives.)
const OPTIONS = Object.freeze({
  threshold: 512,
  serverNoContextTakeover: true,
  clientNoContextTakeover: true,
  serverMaxWindowBits: 12,
  concurrencyLimit: 8,
  zlibDeflateOptions: Object.freeze({ level: 6, memLevel: 5 }),
});

/** The `perMessageDeflate` value for a mode string: `false`, or the bounded option set. */
export function resolveWsCompression(mode = 'off') {
  if (mode === 'off') return false;
  if (mode === 'on') return OPTIONS;
  throw new TypeError('SP_WS_COMPRESSION must be on or off');
}

/** Message types worth compressing: the repetitive, high-volume traffic. `m.public` is the match's public
 *  state broadcast — by measurement 98% of everything a seat receives, and its JSON is highly repetitive
 *  (bond lists, the fields' progress, the per-player status block), so it compresses ~4x. `m.private` is the
 *  per-player view (shop / hand / board), sent only when it changed.
 *
 *  `b.start` is listed for SIZE, not frequency: it is a one-shot battle spec sent once per (seat, field) — 5.9 KB
 *  at R1, up to ~105 KB for a 联防 relay field — and it goes out per recipient (`sendTo`, not `broadcastRoom`),
 *  so one 50-seat room serialises that spec once per seat. Measured on the relay spec: 75,321 → 3,403 B (22.1x).
 *  Compression only: `b.start` must NEVER join `isDroppable` (net.js) — a dropped b.start means that seat never
 *  receives its field, so it has to arrive no matter how congested the socket is. */
export function isCompressibleType(type) {
  return type === 'b.snap' || type === 'b.ev' || type === 'm.field'
    || type === 'm.public' || type === 'm.private' || type === 'm.result' || type === 'b.start';
}
