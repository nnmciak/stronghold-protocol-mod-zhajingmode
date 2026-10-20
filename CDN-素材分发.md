# 素材 CDN 分发（已回退 · 素材走本机）

> **当前状态：已关闭。** 2026-10-10 回退，所有素材由本机发出。
> 回退原因：CDN 从本机网络实测过慢，比本机自己发还慢。

## 为什么回退（实测数据）

从这台机器（厦门电信）拉 CDN 素材，两个域名 `weishucdn` / `weishucdn2` 表现一致：

| 素材 | 大小 | 实测吞吐 | TTFB |
| --- | --- | --- | --- |
| 干员头像 | 55 KB | 43–77 KB/s | 0.5–1.0 s |
| spine 贴图 | 87 KB | 84–115 KB/s | 0.25–0.48 s |
| BGM | 1.8 MB | 132–510 KB/s | 0.5–0.9 s |
| BGM | 2.7 MB | 133–379 KB/s | 0.5–0.9 s |

2.7 MB 的 BGM 要 **7–20 秒**。同一批文件从本机源站取是毫秒级。
两个域名一样慢，说明是整条 Cloudflare 链路的问题，不是某个域名坏了。

## 现在是什么状态

三张清单 `/data/assets.json`、`local-assets.json`、`emotes.json` **原样从磁盘发出**，
响应体与磁盘文件逐字节一致，素材全部由本机提供（走本机上行带宽）。

改写代码**原样保留**，默认关闭，随时可以再开。

## 怎么重新开启

CDN 链路修好后，设环境变量再重启即可：

```powershell
$env:SP_ASSET_CDN = 'https://weishucdn.jiangjiangze.icu'
node server/index.js
```

想彻底关掉：`$env:SP_ASSET_CDN = 'off'`（这也是现在的默认值，不设就是关）。

## 改了什么

| 文件 | 状态 |
| --- | --- |
| `server/http/assetCdn.js` | 新增。默认 `DEFAULT_BASE = 'off'`，模块惰性 |
| `server/http/static.js` | 改动 3 处：import、创建实例、`serveFile` 前挂钩 |
| `server/http/static.js.bak-before-cdn` | 改动前的备份 |
| `tools/verify-asset-cdn.mjs` | 验收脚本 |
| `.cache/cdn-verified.json` | 上次开启时的 HEAD 探测缓存（现在没用，重新开启会复用） |

回退只需把 `DEFAULT_BASE` 改回 CDN 地址，或设 `SP_ASSET_CDN`。

## 开启时的规则（留档）

客户端拿素材地址的**唯一**入口是上面三张清单，所以只在**响应层**改写它们就够了 ——
磁盘文件一个字节不动（`server/index.js` 与 pack registry 会读它们做校验，
`tools/fetch-assets.mjs` 还会原地重写，改文件会破坏这两件事）。

对每条 `/assets/…`、`/fonts/…`：

- CDN 上确实有 → 改成 `https://weishucdn.jiangjiangze.icu<路径>?v=<token>`
- CDN 上没有 → 原样保留本机路径，继续走上行带宽

「确实有」的判定要两级，因为公开索引是**滞后**的：实测 1872 条索引里没有的路径中，
**1294 条其实在线**（约 178 MiB）。所以启动先拉 `api.json` + `tree.json`，
其余后台并发 HEAD 探测，结果缓存进 `.cache/cdn-verified.json`。

spine 的 `.atlas` 用相对路径找同目录贴图，目录被拆两边会渲染失败 ——
实测 1159 个 spine 目录没有一个混用，逐文件规则保持了这一点。

开启时的效果：14177 条素材路径中 13599 条（95.9%）走 CDN，578 条（约 132.8 MiB）走本机。

## 验收

```powershell
# 回退后：三张清单应与磁盘文件逐字节一致，且不含任何 CDN 地址
node tools/verify-asset-cdn.mjs http://127.0.0.1:3000 http://59.57.233.35:3000
```

开启状态下响应头会带 `X-Asset-CDN: <走CDN数>cdn/<留本机数>local`；关闭后没有这个头。
