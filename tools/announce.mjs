// tools/announce.mjs — 全服公告的命令行入口(在服务器上直接跑,本机来源不需要 token)。
//
// 用法(在服务器上,项目根目录):
//   node tools/announce.mjs "服务器将于 5 分钟后关闭维护"                 → info 级,常驻直到玩家关闭
//   node tools/announce.mjs -l warn "服务器将于 5 分钟后关闭"             → warn 级(琥珀色)
//   node tools/announce.mjs -l error -t 300 "服务器即将关闭,请结束当前对局" → 重要级,300 秒后自动消失
//   node tools/announce.mjs --clear                                      → 撤回当前公告
//
// 为什么走 HTTP 而不是直接 import lobby:公告的作用域是**正在运行的那个进程**。另起一个 node 只会创建一份新的
// Lobby 空对象,一个人也通知不到。所以这里 POST 到本机端口,由服务进程自己广播。
//
// 鉴权:服务端信任**本机回环**来源(运维在机器上通过 SSH 操作,SSH 本身就是认证),所以在本机跑本脚本不需要任何
// token。只有从别的机器调用时才要 `SP_ANNOUNCE_TOKEN`(见 server/http/routes.js)。
//
// 端口取自 PORT(默认 3000)。

const argv = process.argv.slice(2);
const flag = (name, hasValue = false) => {
  const i = argv.indexOf(name);
  if (i < 0) return hasValue ? null : false;
  if (!hasValue) { argv.splice(i, 1); return true; }
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v ?? null;
};

const clear = flag('--clear') || flag('-c');
const level = flag('-l', true) || flag('--level', true) || 'info';
const ttlRaw = flag('-t', true) || flag('--ttl', true);
const port = Number(process.env.PORT) || 3000;
const token = (process.env.SP_ANNOUNCE_TOKEN || '').trim();
const text = argv.join(' ').trim();

if (!clear && !text) {
  console.error('用法: node tools/announce.mjs [-l info|warn|error] [-t 秒] "公告内容"');
  console.error('      node tools/announce.mjs --clear          # 撤回当前公告');
  process.exit(2);
}

const body = clear ? { clear: true } : { text, level };
if (!clear && ttlRaw != null) {
  const t = Number(ttlRaw);
  if (!Number.isFinite(t) || t <= 0) { console.error('-t 需要一个正整数秒数'); process.exit(2); }
  body.ttlSec = Math.floor(t);
}

const res = await fetch(`http://127.0.0.1:${port}/announce`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
}).catch((e) => { console.error(`连不上 http://127.0.0.1:${port} —— 服务在跑吗? (${e.message})`); process.exit(1); });

const out = await res.json().catch(() => null);
if (!res.ok || !out || out.ok !== true) {
  console.error(`失败 (HTTP ${res.status}): ${out && out.error ? out.error : '未知错误'}`);
  if (res.status === 403) console.error('提示:本机来源本应免 token —— 确认你是在服务器上跑本脚本,且 PORT 指向该服务。');
  if (res.status === 401) console.error('提示:从别的机器调用需要 SP_ANNOUNCE_TOKEN,且要与服务端一致。');
  process.exit(1);
}
if (out.cleared) console.log(`已撤回公告,通知了 ${out.sent} 个连接`);
else if (out.notice) console.log(`已广播给 ${out.sent} 个连接 [${out.notice.level}${out.notice.ttlSec ? `, ${out.notice.ttlSec}s` : ''}]: ${out.notice.text}`);
else console.log(`已处理,通知了 ${out.sent} 个连接`);
