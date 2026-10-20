// server/http/websocket.js — the real-time side of the server:
//
//   * session wiring: SessionRegistry (reconnect tokens) → Lobby (rooms, server/lobby.js) → Network (the socket
//     protocol, server/net.js), built from the startServer() options (config.js decides which go where);
//   * WebSocket (ws) at /ws, maxPayload 64 KB, permessage-deflate from server/wsCompression.js (bounded, ON
//     unless SP_WS_COMPRESSION=off) → Network.handleConnection. Refused at the upgrade: any other path 404;
//     per-network socket limit for internet clients (maxConnectionsPerAddr, see net.js clientAddress;
//     local/LAN peers are exempt) 429; server full (maxConnections) or shutting down 503.

import { WebSocketServer } from 'ws';
import { Network, SessionRegistry, NET_DEFAULTS } from '../net.js';
import { Lobby } from '../lobby.js';
import { resolveWsCompression } from '../wsCompression.js';
import { splitUrl } from './common.js';
import { netOptionsFrom, lobbyOptionsFrom } from './config.js';

/** Inbound WebSocket frame limit (DESIGN §8). */
export const WS_MAX_PAYLOAD = 64 * 1024;

/**
 * The session stack of one server.
 * @param {{ MatchClass?: Function, seedFn?: () => number, [option: string]: any }} opts startServer() options
 * @param {{ data: object, log: object }} deps the game data the lobby's matches use, the logger
 * @returns {{ registry: SessionRegistry, lobby: Lobby, network: Network }}
 */
export function createSessionStack(opts, { data, log }) {
  const netOptions = netOptionsFrom(opts);
  const registry = new SessionRegistry({ reconnectWindowMs: netOptions.reconnectWindowMs ?? NET_DEFAULTS.reconnectWindowMs });
  const lobbyOptions = lobbyOptionsFrom(opts);
  const lobby = new Lobby({ registry, log, MatchClass: opts.MatchClass, getData: () => data, seedFn: opts.seedFn, options: lobbyOptions });
  const network = new Network({ registry, handler: lobby, log, options: netOptions });
  return { registry, lobby, network };
}

/**
 * Serve the WebSocket endpoint /ws on `server` (its 'upgrade' event).
 * @param {import('node:http').Server} server
 * @param {{ network: Network, log: object }} deps
 * @returns {WebSocketServer}
 */
export function attachWebSocket(server, { network, log }) {
  // permessage-deflate: the bounded option set of server/wsCompression.js, ON unless SP_WS_COMPRESSION=off.
  //
  // The change here is a MEMORY-bounding one. The previous settings kept the deflate window across messages
  // (`contextTakeover: true`, `level: 1`, zlib's default 15-bit window): the best ratio per CPU cycle, but that
  // sliding window is per-socket state that never shrinks, and it was tuned for a 100-seat room. At the
  // 2000-connection target this state, not the CPU, is what caps the process — hence `serverNoContextTakeover`,
  // a 12-bit window and `concurrencyLimit` (wsCompression.js carries the measurements behind each knob).
  //
  // `m.public` is the traffic that matters: a FULL room snapshot, measured at this build's 100 seats as 22 KB
  // minimum / 129 KB mean / 165 KB maximum per frame, sent ~3.4×/s — ~440 KB/s to EVERY client, and what pinned
  // the reported latency counter at its 9999 display cap. It is extremely repetitive JSON (one entry per player,
  // the same keys, many identical `bonds` records), so deflate still shrinks it several-fold, and the CPU is paid
  // ONCE per broadcast because `broadcastRoom` encodes a single frame and reuses it for every member
  // (server/lobby.js). Which types are deflated is the whitelist in wsCompression.js, applied at the send sites.
  const perMessageDeflate = resolveWsCompression(process.env.SP_WS_COMPRESSION || 'on');
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: WS_MAX_PAYLOAD,
    clientTracking: false,
    perMessageDeflate,
  });
  wss.on('connection', (ws, req) => network.handleConnection(ws, req));
  wss.on('error', (e) => log.error('[ws] server error', e));

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const parts = splitUrl(req.url || '/');
    const reject = (status, text) => {
      try { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { socket.destroy(); }
    };
    if (!parts || parts.rawPath !== '/ws') { reject(404, 'Not Found'); return; }
    const refused = network.admission(req);
    if (refused === 'per-address') { reject(429, 'Too Many Requests'); return; }
    if (refused) { reject(503, 'Service Unavailable'); return; }
    try {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } catch (e) {
      log.error('[ws] upgrade failed', e);
      socket.destroy();
    }
  });
  return wss;
}
