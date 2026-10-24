import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { createSharedDeflate, PRE_DEFLATED } from '../server/wsSharedDeflate.js';
import { resolveWsCompression } from '../server/wsCompression.js';

test('shared broadcast self-check does not race with private socket compression', { timeout: 15000 }, async (t) => {
  const options = resolveWsCompression('on');
  const shared = createSharedDeflate(options);
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, perMessageDeflate: options });
  let client;
  t.after(async () => {
    client?.terminate();
    for (const ws of server.clients) ws.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  await once(server, 'listening');

  const expected = new Set();
  const frames = Array.from({ length: 30 }, (_, i) => ({
    public: JSON.stringify({ t: 'm.public', i, padding: randomBytes(50000).toString('hex') }),
    private: JSON.stringify({ t: 'm.private', i, padding: randomBytes(30000).toString('hex') }),
  }));
  for (const frame of frames) { expected.add(frame.public); expected.add(frame.private); }
  let finish, fail;
  const receivedAll = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  server.on('connection', (ws) => {
    ws.on('error', fail);
    const real = shared.install(ws);
    const key = shared.keyFor(real);
    for (const frame of frames) {
      const data = Buffer.from(frame.public);
      shared.compress(key, data, real, (err, compressed) => {
        if (err) { fail(err); return; }
        if (compressed) data[PRE_DEFLATED] = compressed;
        ws.send(data, { compress: true, binary: false }, (error) => { if (error) fail(error); });
      });
      // Private frames use the socket's own Sender queue while the shared
      // compressor checks its first broadcast. Neither may touch the other's stream.
      ws.send(frame.private, { compress: true }, (error) => { if (error) fail(error); });
    }
  });
  client = new WebSocket(`ws://127.0.0.1:${server.address().port}`, { perMessageDeflate: true });
  client.on('error', fail);
  client.on('message', (data, isBinary) => {
    try {
      assert.equal(isBinary, false);
      assert.equal(expected.delete(data.toString()), true, 'each frame arrives intact exactly once');
      if (!expected.size) finish();
    } catch (err) { fail(err); }
  });
  await receivedAll;
  assert.deepEqual(shared.stats, { groups: 1, disabled: 0 });
});
