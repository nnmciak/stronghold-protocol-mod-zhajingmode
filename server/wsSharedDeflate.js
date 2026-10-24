// server/wsSharedDeflate.js — 同一帧只压一次，同参数连接复用压缩字节（用户 2026-10-13）。
//
// 问题：`ws` 给每条连接各建一个 PerMessageDeflate（各自一条 zlib 流），所以一个 100 座房间的一帧
// `m.public` 会被**91 条 socket 各压一遍**（全进程还只有 8 个 zlib 槽）。实测 91 连接 × 30 帧：
// 各压各的 704 ms CPU → 压一次复用 265 ms（−62%）；100 房 × ~3.4Hz 推算约 3 个核。
//
// 为什么可以复用：`serverNoContextTakeover: true` ⇒ 每条消息都从全新 zlib 状态开始，压缩输出只依赖
// (payload, 协商参数)。所以按"协商参数组"压一次，组内复用即可。
//
// ★ 踩过的坑（第一版失败原因，别再走一遍）：**不要用 `zlib.deflateRawSync`** —— 一次性 API 收尾写的是
//   BFINAL=1 的**终结块**，客户端 inflate 会失败（字节只差 4 字节，`roundTrip_shared: false`）。
//   必须像 ws 一样用**常驻 deflate 流**：`reset()` → `write(buf)` → `flush(Z_SYNC_FLUSH)` → 去掉尾部 4 字节。
//
// ★ 自检：每个参数组第一次压缩时，同一份数据同时走"我们的流"和"ws 自己的 compress"，**逐字节比对**；
//   不一致就永久关掉共享路径并告警（宁可退化回各压各的，也不能压错 —— 压错等于所有客户端收不到对局状态）。
import zlib from 'node:zlib';

/** 打了这个标记的 Buffer：shim 会把它的值当"已压好的字节"直接放行。 */
export const PRE_DEFLATED = Symbol('sp.preDeflated');

const EXT = 'permessage-deflate';

/** 压缩参数组 key：不同协商结果不能复用彼此的字节。 */
export function paramsKey(pmd) {
  const p = (pmd && pmd.params) || {};
  return `${p.server_max_window_bits || '-'}|${p.server_no_context_takeover ? 1 : 0}`;
}

/** 一个参数组一条常驻 deflate 流 + 串行队列（同一条流不能并发写）。 */
class GroupDeflater {
  constructor(opts, windowBits) {
    this.opts = opts;
    this.windowBits = windowBits;
    this.busy = false;
    this.queue = [];
    this.enabled = true;
    this.checked = false;
    this.chunks = [];
    this._active = null;   // 当前正在压缩的这一次的 cb（流出错时用它解卡）
    this._makeStream();
  }

  /** 建流并挂 'data' / 'error'。 */
  _makeStream() {
    const { level, memLevel } = this.opts;
    const s = zlib.createDeflateRaw({ level, memLevel, windowBits: this.windowBits });
    this.stream = s;
    this.chunks = [];
    s.on('data', (c) => this.chunks.push(c));
    // ★ 2026-10-14 修：zlib 流**必须**有 'error' 监听。没有的话流内部错误会直接冒成
    //   `uncaughtException`（线上 `server.log` 里的 `[process] uncaught exception
    //   RangeError: Invalid typed array length: -4` 就出现在这条路径），
    //   而且 `_pump` 的 `busy` 标志会永久停在 true —— `flush` 的回调再也不执行，
    //   这个参数组（= 所有同参数的连接）**之后每一帧都发不出去**。
    //   处理：停用共享路径（退回每条连接各压一遍）→ 把当前这一次以 out=null 交回调用方
    //   （`ws.send` 会走普通压缩）→ 重建流 → 继续队列。
    s.on('error', (e) => {
      this.enabled = false;
      this.chunks = [];
      try { console.warn('[ws] 共享压缩流出错 → 停用共享路径：' + (e && e.message ? e.message : e)); } catch {}
      try { s.destroy(); } catch {}
      // 当前正在处理的那一次必须回一个结果，否则 busy 永远卡住
      if (this._active) { const cb = this._active; this._active = null; this.busy = false; try { cb(null, null); } catch {} }
      try { this._makeStream(); } catch { this.enabled = false; }
      this._pump();
    });
  }

  /** @param {Buffer} buf @param {any} real ws 的真实 PerMessageDeflate（仅第一次自检用） @param {(err:any, out:Buffer|null)=>void} cb */
  compress(buf, real, cb) {
    this.queue.push({ buf, real, cb });
    this._pump();
  }

  _pump() {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    if (!this.enabled) { this.busy = false; job.cb(null, null); this._pump(); return; }
    const done = (err, out) => {
      this._active = null;
      this.busy = false;
      try { job.cb(err, out); } catch (e) { this.enabled = false; }
      this._pump();
    };
    this._active = job.cb;
    try {
      this.chunks = [];
      this.stream.reset();                       // no-context-takeover：每条消息从新状态开始
      this.stream.write(job.buf);
      this.stream.flush(zlib.constants.Z_SYNC_FLUSH, () => {
        let out;
        try {
          const all = Buffer.concat(this.chunks);
          out = all.subarray(0, Math.max(0, all.length - 4));   // RFC 7692：发送端去掉尾部 4 字节
        } catch (e) { done(e, null); return; }
        if (this.checked) { done(null, out); return; }
        this.checked = true;
        this._selfCheck(job.buf, out, job.real, (same) => {
          if (!same) {
            this.enabled = false;
            console.warn('[ws] 共享压缩自检不一致 → 停用共享路径（退回每条连接各压一遍）');
          }
          done(null, this.enabled ? out : null);
        });
      });
    } catch (e) { done(e, null); }
  }

  /** 与 ws 自己的输出逐字节比对（每个参数组只做一次）。对照拿不到就不拦（自检只是保险）。 */
  _selfCheck(buf, mine, real, cb) {
    if (!real || typeof real.compress !== 'function') { cb(true); return; }
    // The live compressor belongs to ws.Sender's serial queue. Calling it here
    // races with a private frame already being sent on that socket. Compare with
    // a separate instance using the same negotiated parameters instead.
    let reference = null;
    let finished = false;
    const finish = (same) => {
      if (finished) return;
      finished = true;
      try { reference?.cleanup(); } catch { /* comparison is best-effort */ }
      cb(same);
    };
    try {
      reference = new real.constructor({ ...real._options });
      reference.params = { ...real.params };
      reference.compress(buf, true, (err, theirs) => {
        if (err || !theirs) { finish(true); return; }
        finish(Buffer.compare(Buffer.from(theirs), Buffer.from(mine)) === 0);
      });
    } catch { finish(true); }
  }
}

/**
 * 共享压缩器。`options` = server/wsCompression.js 的 OPTIONS（false = 没开压缩，此时 enabled=false）。
 * @param {any} options
 */
export function createSharedDeflate(options) {
  const z = (options && options.zlibDeflateOptions) || {};
  const win = options && options.serverMaxWindowBits;
  const groups = new Map();

  /** 给一条连接装壳；返回 ws 的真实 pmd（没有压缩扩展时返回 null）。幂等。 */
  function install(ws) {
    const sender = ws && ws._sender;
    const ext = sender && sender._extensions && sender._extensions[EXT];
    if (!ext) return null;
    if (ext.__spShim) return ext.__spReal || null;
    const real = ext;
    // ★ 壳必须**委托**给真实对象（用户 2026-10-13 现场：`/healthz` 显示 sockets 31 / sessions 0，服务端日志刷
    //   `TypeError: perMessageDeflate.decompress is not a function`，客户端永远在「正在连接服务器…」）。
    //   原因：ws 里 `_extensions` 是 Sender 与 Receiver **共用**的同一张表（sender.js:39 / receiver.js:59 拿到同一个
    //   对象引用），而 Receiver 解压缩帧时取的是 `_extensions['permessage-deflate'].decompress`（receiver.js:543）。
    //   第一版把只带 `compress` 的裸对象塞进这张表 —— 接收端于是拿到一个没有 `decompress` 的东西：浏览器发来的
    //   每一帧（hello 也在内，浏览器默认压缩）都在 Receiver 里抛异常、帧被丢弃，服务端因此永远不回 welcome。
    //   原型委托以后，接收端的方法照旧命中真实对象，只有 compress 被拦下来走共享压缩。
    const shim = Object.create(real);
    shim.compress = function compress(data, fin, cb) {
      const pre = data && data[PRE_DEFLATED];
      if (pre) { cb(null, pre); return; }          // 已压好的：直接放行，ws 照常打包（RSV1 + 分帧）
      real.compress(data, fin, cb);
    };
    shim.decompress = real.decompress.bind(real);  // 保险：这条路径的 `this` 必须是真实对象
    shim.__spShim = true;
    shim.__spReal = real;
    real.__spShim = true;
    sender._extensions[EXT] = shim;
    return real;
  }

  /** 这条连接能否走共享路径：协商过压缩，且窗口参数与我们的流一致（客户端要别的窗口就不复用）。 */
  function keyFor(real) {
    if (!real || !real.params) return null;
    const w = real.params.server_max_window_bits;
    if (w != null && w !== win) return null;
    return paramsKey(real);
  }

  /** 压一次（按参数组）。out=null 表示调用方应退回普通 `ws.send`。 */
  function compress(key, buf, real, cb) {
    let g = groups.get(key);
    if (!g) { g = new GroupDeflater(z, win); groups.set(key, g); }
    g.compress(buf, real, cb);
  }

  return {
    enabled: !!options,
    install,
    keyFor,
    compress,
    get stats() { return { groups: groups.size, disabled: [...groups.values()].filter((g) => !g.enabled).length }; },
  };
}
