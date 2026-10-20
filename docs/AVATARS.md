# 头像系统（个人名片头像）

> 用户 2026-10-12：`头像素材源于国服客户端，同时保留每个策略分队作为头像的可能性`。

## 是什么

玩家在**标题页代号旁的名片**上点头像 → 打开头像选择器 → 选一个 → 存本地并随 `hello` 发给服务端；
房间座位卡、对局内名单（分队选人 / 结算 / 观战 / 队伍面板）、大厅自己那张卡都会显示它。

## 素材（全部来自国服客户端）

| 组 | id 前缀 | 数量 | 来源 |
| --- | --- | --- | --- |
| 干员头像 | `char:` | 211 | `public/assets/char/avatar/<charId>.png` |
| 精英二头像 | `e2:` | 195 | `…/<charId>_2.png` |
| 皮肤头像 | `skin:` | 274 | `public/assets/char/skin_avatar/<charId>_<group>_<n>.png` |
| 策略分队 | `band:` | 40 | `public/assets/band/<bandId>.png`（按 `data/bands.json` 的 `sortId`；新增分队自动进列表） |
| 官方个人头像 | `player:` | 198 | `public/assets/local/playeravatar/`（本机客户端提取） |

官方个人头像 = 客户端 `spritepack/ui_player_avatar_list_h2_0.ab` 的全表（截图里那个「名片形象」界面就是
`ui/pages/avatar_page.ab`）：默认 15（`avatar_def_*`）、动态头像 8 的**静态帧**（`avatar_dyn_*`）、
特殊获取 86（`avatar_special_*`）、活动头像 89（`avatar_activity_*`）。

* 动效本身在 `arts/dynavatars_0.ab`，那是 UI 动画 + 粒子，不是图片；客户端自己在多数场合也回落静态版，
  所以这里只用静态帧。要在网页里真放动效，得把这套动画重放一遍（独立一件事）。
* `player:` 的中文名取 PRTS 的文件号对应关系（默认 15 / 动态 8 / 特殊 1-40 + 女士的准许）；
  活动头像与更靠后的特殊头像暂时显示为「活动 XX」「特殊 NN」——客户端自己的 name 表还没提取。

## 数据流

```
tools/local-extract/extract.py  --only playeravatar     # 从本机客户端提取 198 张 → public/assets/local/playeravatar/
_garrison-list/gen-avatars.mjs --write                 # 汇总成 data/avatars.json（918 条：src + items）
shared/avatars.js                                      # id 方案 / 校验 / 解析（服务端与浏览器共用）
```

`data/avatars.json`：`{ version, count, counts, src: { id: url }, items: [{ id, name, group, sub }] }`。

## 线上协议

只有 `hello` 带一个**不透明 id**（`shared/avatars.js isAvatarId`），**永远不传 URL**——恶意客户端塞不进任意图片地址：

```
C2S hello { name, avatar?: 'band:band_amiya' | null, token?, version? }
S2C welcome { …, avatar }                 // 服务端记住的那个（null = 未设置）
S2C room.state.seats[i].avatar            // 房间席位
S2C m.public.players[i].avatar            // 对局内（未设置时不带这个字段，不占字节）
```

* 字段**可选**：改名重发的 `hello` 不带 `avatar`，服务端保持原值；显式 `null` 才是清除。
* 非法 id 由 `validateC2S` 拒掉（`ERR.BAD_MSG`），服务端值不变。
* 服务端只存 id：`server/net.js`（`Session.avatar`，hello 时写入）→ `server/lobby.js`（席位 / 观战席 / `room.state`）
  → `server/match/PlayerState.js` 与 `match/views.js`（广播）。

## 客户端

| 文件 | 作用 |
| --- | --- |
| `public/js/ui/avatarPicker.js` | 选择器：5 个页签 + 搜索 + 懒加载网格 +「当前预览 / 清除头像 / 确认应用」 |
| `public/js/screens/title.js` | 名片头像按钮（`setAvatar()`：存 localStorage + `net.setAvatar`） |
| `public/js/net.js` | `identity.loadAvatar/saveAvatar`、`net.setAvatar`、hello 组装 |
| `public/js/data.js` | 登记 `avatars: 'avatars.json'` |
| `public/js/ui/components.js` `AvatarFrame` | 房间座位卡 / 大厅名片的方框头像（`src` 解析不到就回落字形） |
| `public/js/ui/gameComponents.js` `PlayerAvatar` | 局内头像：**自选头像 > 所选分队图标 > 字形/机器人** |

样式：`public/css/components.css` 末尾的 `.title-avatar` / `.avpick*` / `.avcell*`。

## 验收

```
node _garrison-list/verify-avatars.mjs        # 51 项：目录 / id 校验 / 会话·席位·视图 / 接线
node _garrison-list/verify-avatars-e2e.mjs    # 10 项：真服务器 + 真 WebSocket（hello → welcome → room.state）
```

## 重做/更新

游戏更新后：`python tools/local-extract/extract.py --only playeravatar`（把新头像提出来）→
`node _garrison-list/gen-avatars.mjs --write`（重算目录）。`extract.py` 的 `playeravatar` job 已登记在 `JOBS` 里。
