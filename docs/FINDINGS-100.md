# 100 人版可行性核查记录

> 对象:`sganggs/Stronghold-Protocol` v0.2.0 的工作副本 `_sp100/`。
> 方法:改 `MAX_SEATS` 后跑无头整局(虚拟时钟),而非静态推断。
> 结论:**座位数不是瓶颈**,不需要重写引擎;瓶颈在三个具体位置,已分别处理或标注待决。

## 1. 核查方法

v0.2.0 的 Release 包**剪掉了 `test/` 与 `tools/matchrun.mjs`**,上游自带的 headless 跑局工具无法使用,
因此新增了 `smoke100.mjs`,直接用 `Match` + `VirtualScheduler` 驱动:

- `VirtualScheduler({ instantCombat: true })`:虚拟时钟,**整局在毫秒级虚拟时间内跑完**,战斗同步步进;
- 全部座位用 AI(人类闲置会卡住准备阶段,见 §4.1);
- 探针:`sched.errors`(调度层异常)、`m.errors`(对局内异常)、峰值战场数与组成、RSS、墙钟耗时。

```powershell
# 基线
node smoke100.mjs 4 NORMAL
# 目标规模
node --max-old-space-size=8192 smoke100.mjs 100 NORMAL
```

## 2. 实测结果:座位数不是瓶颈

规模曲线(NORMAL,全 AI 座位,`botRehearsal=0`):

| 座位 | 跑完 | 峰值战场 | 存活 | 墙钟 | RSS | 调度异常 | 对局异常 |
|---|---|---|---|---|---|---|---|
| 4 | ✅ | 4 | 4 | 3.7 s | 285 MB | 0 | 0 |
| 8 | ✅ | 4 | 8 | 7.7 s | 312 MB | 0 | 0 |
| 16 | ✅ | 8 | 16 | 12.2 s | 312 MB | 0 | 0 |
| 32 | ✅ | **32** | 24 | 21.0 s | 412 MB | 0 | 0 |
| 64 | ✅ | 10 | 20 | 23.5 s | 467 MB | 0 | 0 |
| 100 | ✅ | 8 | 16 | 24.6 s | 488 MB | 0 | 0 |

要点:

- **六种规模全部跑完整局到 `RESULT`,调度层零异常**——这是最强的正确性信号;
- 峰值并发战场在 32 座时达到 **32 个**,引擎无碍(FieldRunner 本就锁步推进所有战场);
- 耗时增长**次线性**(4→100 座仅 6.7×):100 座下 **84% 座位中途淘汰**,战场自然收敛,
  "50 个战场同时开打"这个最坏场景**实测没有发生**;
- 席位组成探针证实配对逻辑正常:100 座 → 两两配对;收官时 16 个存活座位 → 8 个 `hidden` 战场,每场 2 人。

## 3. 已实施的改动

### 3.1 每人独立牌库(已实施并验证)

上游的池子是**全局共享**的:`SharedPool` 里每名干员 `cap` 份,谁买走就从 `left` 扣,买空即 `SOLD_OUT`。
第 6 阶**每名干员只有 5 份**,而合成精锐要吃 3 份——100 座下这是灾难性的(§2 首次实测:84% 座位被淘汰)。

实现方式是**复用上游早就留好的口子**:`PlayerState.poolOf(baseId)` 本来就是单一分派点
(上游用它把自选编队槽路由到玩家独立库存),只是默认落回 `m.pool`。现在:

- `server/match/player/rules.js`(新增)`PlayerRules` 方法容器,装在 `PlayerState` 方法链**最后**:
  - `pool()` —— 惰性构建并持有**本玩家自己的 `SharedPool`**,内容 = 同一份被禁名单 + 全量份数;
  - `poolOf()` —— 单一分派点,所有买/卖/合成/临时/淘汰的取用都走它;
  - `squad()` / `squadPeers()` / `inSameSquad()` —— 25 小队编制(§3.2)。
- `m.pool` **保留**为"权威目录":`audit.js`、`platform.js`、`invariants.js` 仍读它的 `entries`/`has`/`cap`,
  但它在本变体里**不再被取用任何份数**。
- 改为走玩家池的取用点:`economy.js` 商店抽卡(2 处)、`acquire.js` 奖励池、`choices.js` 盟约干员、
  `spDraft.js` `rollPool`(新增 `pool` 选项)、`effectsMeta.js` `rollChess`/`grantChess`、`bot.js` 的四处 AI 评估。
- `invariants.js` 的守恒式从**全局**改为**每玩家**:每个玩家的 `left + 持有 == cap`,且份数上限必须等于目录的 `cap`。

**实测验证**(100 座的独立性命探针,比对同一干员在 100 个玩家各自池子里的剩余份数):

```
chess_char_5_01_a (cap 8):  7×6  8×94     at cap 94/100, empty 0
chess_char_6_01_a (cap 5):  3×1 4×15 5×84 at cap 84/100, empty 0
chess_char_3_01_a (cap 18): 15×4 18×96    at cap 96/100, empty 0
```

**只有真正买了牌的人份数下降**,绝大多数保持满份。共享池下这里会是一片接近 `0` 的分布。

### 3.2 25 小队编制(已实施)

`shared/squads.js`(新增,纯 ESM):`SQUAD_SIZE = 4`,座位按序四人一组 → 100 座 = 25 队;
`squadIndex` / `squadMembers` / `sameSquad` / `squadCount`。`PlayerRules.squad()` / `squadPeers()` 暴露给规则层。

### 3.3 其余三处

| # | 位置 | 改动 | 依据 |
|---|---|---|---|
| 1 | `shared/constants.js` | `MAX_SEATS = 4` → `100` | 全仓仅 11 处引用,匹配层对座位数**零断言** |
| 2 | `server/index.js` | `SP_COMBAT=server` **硬拒绝启动** | 单局峰值 CPU ≈ 25–90 s,而一回合墙钟仅 15–30 s |
| 3 | `sim/constants.js` + `battle/spawns.js` | 活敌上限 → `aliveEnemyCap(players) = max(600, 1500 × 战场人数)` | 100 座实测触发 `MAX_ALIVE_ENEMIES=600` 2 次;**修正**:600 是在**单人**棋盘上被顶到的,故基础值也需抬升 |
| 4 | `lobby.js` `addBot` | 放宽为**任一在座人类**可加 AI(踢人仍限房主) | 100 座房间需要填 99 个 AI;上游为 host-only |

### 3.4 首领血量:原版线性膨胀(已修复并验证)

目标要求"首领血量按原版线性膨胀"。**上游代码里它并没有真正线性**——探针在血池构造瞬间测到:

```
修复前  32 座位 NORMAL: bloodPoint=400000 × alive=32 => expect 12800000, got maxHp=1600000  ⚠️
```

根因在 `gamedata.js bossPoolShareOf`:

```js
const full = Math.max(1, Math.floor(pick('aliveFull', 4)));   // ← 4
const alive = Math.min(full, Math.floor(n));                  // ← 32 被夹到 4
if (flag('perPlayer', true)) return pick('coop', 1) * alive;  // ← 乘以 4
```

`data/config.json` 的 `bossHpScale.aliveFull = 4` 是那个原始 4 人封顶值,`Math.min` 把 32 人夹成 4 人,
于是 100 座的血池和 4 座一样大。改为:

```json
"bossHpScale": { "perPlayer": true, "coop": 1, "aliveFull": 100, "aliveScaling": false, ... }
```

修复后(构造瞬间实测):

```
final  R14 boss_2 NORMAL: bloodPoint=400000 × alive=32 => 12800000  = maxHp  ✅
hidden R15 boss_8 NORMAL: bloodPoint=937500 × alive=32 => 30000000  = maxHp  ✅
```

**注意**:`data/` 是 `tools/build-data.mjs` 的生成物(该工具不在 Release 包里),重建会覆盖这个改动。
上方注释已写进 `formula` 字段,重建前需要同步改生成器。


### 3.5 取消限伤(已实施并验证)

`shared/constants.js` 的 `BOSS_HIT_LIMIT` 已由 `300000` 改为 **`Infinity`**(注释本就写明 `0 / Infinity = off`,
判定函数 `leaderHitCancelled` 以 `!(BOSS_HIT_LIMIT > 0)` 短路,所以无需改任何逻辑)。

实测 4 座:`BOSS_HIT_LIMIT=Infinity cancelledHits=0`,0 违规 0 错误——即原本实战中就没有触发过限伤,
这个改动**移除的是机制本身,不是一个正在生效的约束**。

一个需要你知情的**连带影响**:`leaderHitCancelled` 同时作用于**我方承受**的伤害("传递"给领袖的损失也按一次 hit 计),
所以取消限伤后,**首领对我方的超大单发也不再被取消**。


### 3.6 独立牌库对局面的影响(重要)

同一份 AI、同一难度,只改牌库口径:

| 指标 | 共享池(首次实测) | 独立牌库(本次) |
|---|---|---|
| 存活座位 | **16 / 100** | **100 / 100** |
| teamLp | 112 | 2458 |
| 峰值并发战场 | 8 | **100**(每人一张 `normal` 战场) |
| 墙钟 | 24.6 s | 64.6 s |
| 出战消息数 | 455 | 1372 |

两个结论:

1. **独立牌库直接决定了 100 座能不能玩**:共享池下 AI 买不到牌、棋盘羸弱,84% 被淘汰;
   独立后全员能满配,全员活到收官。
2. **峰值并发战场从"收敛到 8"变成"实打实的 100 个"**——上一轮"50 个战场的最坏情况没有发生"这个结论
   是**共享池的副产物**(人被淘汰了),独立牌库下它发生了。耗时随之从 24.6 s 涨到 64.6 s。



### 3.7 独立牌库的连带后果:隐秘核心必然触发

实测 32 座:隐秘核心门槛检查 `layerSum=10073 > threshold=1200`,**每局都会进入隐秘核心**。
原因是独立牌库让 32/100 人都能拿满配干员,盟约层数是逐玩家累加的(门槛按"所有玩家已激活盟约总层数"算)。
这是"人人满配"的必然结果,不是 bug——但意味着 100 座下**隐秘核心是常规流程而非可选挑战**,
且首领血量膨胀(§3.5)与它是同一套平衡账。


### 3.8 联防:阶段 1「队内兜底」的规则层(已完成并验证)

设计(用户规则):两阶段**有限转交**——

```
阶段1 队内兜底:4 人中无漏者按 units > activeBond > standing > seat 取前 2 人 → 打本队自己的漏怪
阶段2 跨队兜底:阶段1 仍未拦住的漏怪 → 按「剩余实力」挑一个他队接手 → 再没兜住 → 结算扣 LP(不再传)
```

本轮实现的是**阶段 1 的规划层**([server/match/unite100.mjs](server/match/unite100.mjs)):

- `squadsOf(m)` —— 按小队分组存活玩家;
- `planUniteBySquad(m, results)` —— **每队一个联防计划**:仅当该队「有漏怪」且「有无漏者」时开联防;
  helper **只从本队无漏者中选**(≤ `gd.unite.maxHelpers`),沿用上游排序
  `unitsOnField > activeBond > standingUnits > seat`——**"状态良好"是排序词条,不是门槛**;
  漏怪按来源玩家路由,未知敌人键计为 `notReentered`。

**为什么单独写聚焦测试**:实测整局里,绝大多数轮次要么全员完美、要么全员有漏,联防根本不触发,
所以按小队分组的逻辑**无法靠跑整局覆盖**。`unite100.mjs --test` 用合成战斗结果直接驱动它,28 项断言全部通过:

```
✅ 只有漏怪小队开联防          ✅ helper 只来自本队(8 座交叉场景验证不混入)
✅ 每队 ≤ 2 人                 ✅ 漏怪按来源玩家路由
✅ 无perfect成员 ⇒ 不联防      ✅ 全员完美 ⇒ 不联防
✅ 未知敌人键 ⇒ notReentered   ✅ 100 座 25 队:恰好 4 个漏怪队各自成计划,互不混合
```

**执行层(本轮完成)**:联防从**单战场**改为**每小队一个战场、同一时间线锁步推进**。

上游只建一个战场、分段做收尾:

```js
// 上游 unitePhase.js
this.fields = [{ fieldId: 'u', kind: 'unite', players: plan.helpers..., battle, live: true }];
const res = runner.resultOf(this.fields[0]);       // 只取第 0 个
```

现在 `startUnite(plans)` 接受**按小队的计划数组**,每队一个战场(`u<squad>`),全部交给**同一个 `FieldRunner`**:

- `FieldRunner` 本来就锁步推进所有战场,且 `_finish()` 只在**所有**战场都不 live 时触发——
  所以"**队内等待完毕后等待其他小队**"这个语义**免费获得**,无需多阶段状态机;
- 客户端路径同理:`clientCombat.js:218` 的守卫是 `this.fields.some(f => f.cc && !f.done)` 才不收尾,
  即**等所有小队战场都完成**;
- 收尾时把各战场结果用 `combineUniteResults(plans, results)` 合并成 `settle()` 消费的单个 `(plan, result)`
  (合并 `helpers`/`leakers`/`leaked`/`notReentered`,`perPlayer` 按 playerId 并集,`unspawned` 求和);
- 每个战场的种子改为 `u:<round>:<fieldId>`,避免 25 个战场抽到同一组波次;
- `_uniteOpts(plan, limit, fieldId)` 的 `fieldId` 参与战场身份。

**审计同步改造**(顺带成为一次独立的隔离性校验):`audit.js` 的联防断言从"全局"改为**逐小队**,
并新增两条硬断言——**每队的 helper 与 leaker 都必须属于该队**,以及**不得出现重复小队**。

实测:
- 4 座 / 16 座 HARD:**0 违规 0 错误**,16 座归因出现 `UNITE@R7` 且峰值战场为 `unite:1p`(单辅路径);
- 100 座:见下方记录。

**阶段 2 的实现方式(已修正)**:联防只有**一轮战场**;阶段 2 在那一轮的收尾钩子里**原子完成**,不再发起第二轮联防。

早先的实现把阶段 2 做成"再发起一轮联防",引入了**重入时序缺陷**:一份转交计划会被**当成阶段 1 重算**,
把别队漏怪并进计费里。诊断数据(`_finishUniteClient` 的调用轨迹)显示根因是**两处叠加**:

1. `startUnite` 里无条件写了 `this.uniteRound = 1`,把阶段 2 设置的 `uniteRound = 2` 覆盖回 1;
2. 阶段 2 在收尾钩子的调用栈内递归发起新一轮,而**该轮的收尾钩子可能先于 `later(0)` 回调触发**,
   于是那批转交计划被当作阶段 1 再算一遍。

修正后的阶段 2 流程(单次同步完成):

```
阶段1 收尾 → 每队 takeUnhandled 切出未兜住的敌人
           → planRelayBySquad 按剩余实力为每个转出队挑一个接收队(每队最多接一次)
           → relayPlanFor:接收队派自己的无漏成员,敌人与计费仍归转出方
           → _relayHeld:接收队按自身实力(standing + units)挡下一部分
           → 挡不住的直接并入结算,计费给「原始漏怪玩家」
```

即**没有第三轮**:接收队再失手,漏怪就此结算扣 LP(用户规则)。重入时序问题从结构上消失。

全规模验证(0 违规 0 错误):

| 座位 | 难度 | 结果 |
|---|---|---|
| 4 / 8 / 16 / 32 / 64 / 100 | NORMAL | ✅ |
| 16 / 100 | HARD / ABYSS | ✅ |

**仍未收敛(非阻塞)**:`_uniteLeft` / `statusOf` 仍以单计划视角读 `this.unitePlan`(= 第一个小队),
多小队下这两个**展示值**可能显示别队的数字;不影响结算。




### 3.9 阶段 2「跨队兜底」的设计(已定,未实现)

- 落点:**按剩余实力挑一个他队接手**(不是固定下一队,也不是环形);
- 次数:**只转交一轮**——接手队再没兜住则直接结算扣 LP(用户规则:"第二波也没兜住时,漏怪就此结算扣 LP");
- 因此不存在无限传递/死循环的问题(只有两阶段)。



## 4. 发现的卡点

### 4.1 人类闲置会卡死准备阶段(已验证)

`server/match/match/prep.js:101`:

```js
const allReady = () => { const alive = this.alivePlayers(); return alive.length > 0 && alive.every((p) => p.ready); };
```

并且 `infra.js:66` 的 `soloUntimed = isSolo || loneHuman`,其中 `loneHuman` 指**恰好 1 个人类**。
两者叠加的后果:

- **恰好 1 个人类 + N 个 AI** → 准备阶段**没有计时器**,而 AI 会 ready、那个人类不会 → **整局卡死**;
- 0 个人类(全 AI)或 ≥ 2 个人类 → 有计时器,`prepDeadline()` 会强制 ready,正常推进。

100 人版**必须消除这个组合**,否则"1 个测试者 + 99 AI"这种最常见的调试方式根本进不了对局。

### 4.2 接入限额(部署层,可配置)

| 限额 | 默认 | 100 座的影响 |
|---|---|---|
| `net.js:56` `maxConnectionsPerAddr` | **64** | 同一出口 IP 超过 64 个客户端**直接 429**;本地/局域网豁免 |
| `lobby.js:112` `maxRoomsPerAddr` | 16 | 可经环境变量覆盖 |
| `lobby.js:113` `maxMatchesPerAddr` | 8 | 可经环境变量覆盖 |

`maxConnections: 2000` 与 `maxSessions: 20000` 对 100 人无压力。

### 4.3 UI 会渲染 100 张座位卡

`public/js/screens/room.js:33` 的 `normalizeSeats` 把座位补到 `MAX_SEATS` 并逐个渲染。
功能上不会崩,但 100 张卡需要重新设计布局。

### 4.4 机变阶段:已改为「每小队独立、25 队并发」(已实施并验证)

原版是**一局一次、全场共享 6 张卡**(PRTS 原文:「联机模式中,决策变为每个玩家进行 6 选 1,每个玩家有 16 秒的决策时间,
首个玩家为 30 秒」)。100 座下这是缺口:6 张卡 vs 100 人 → **94 人空手**。

按设计决定改为:**每小队各发 6 张、队内 4 人分、25 队完全独立并发、队内等待完毕后再等其他小队**。

实现(`server/match/match/spDraft.js`):

- `m.sp` 由**单个对象**改为**按小队索引的数组**;`enterSpDraft` 为每个小队各调一次 `generateDraft`
  (rng 显式传入 → 固定种子仍可复现),`order` = 本队存活成员;
- 每队独立推进:`startSpTurn(s)` / `scheduleSpBot(s)` / `_applyCard(ps, s, idx)` 全部带上本队 draft;
- 阶段结束条件是 **`spDone()`**——所有小队都选完("队内等待完毕后等待其他小队");
- **卡池不再公开广播**:`views.js` 的 `m.public.sp` 只留公开进度(family / name / 谁在选),
  本队的 6 张卡走**每人私密视图** `m.private.sp`(`PlayerViews.privateView`);
  客户端从 `priv?.sp` 读取(原来是 `pub?.sp`);
- 合作局**不设计时器**:25 个并发时钟无法共用客户端倒计时读的单一 `m.deadline`。

验证(100 座,带审计):

| 指标 | 改前(全局 6 张) | 改后(每队 6 张) |
|---|---|---|
| 审计违规 | 3(机变假阳性放宽后) | **0** |
| 存活座位 | 16 / 100 | **100 / 100** |
| teamLp | 2458 | 2941 |
| 峰值战场 | 8 | **50** |
| 审计检查数 | 30130 | 31551 |

4 座位为 0 违规,即改动没有破坏上游的小规模行为。

### 4.4.1 顺带发现的上游 bug:`attachAudit` 的包装器吞掉实参

`audit.js` 的 `wrap(obj, name, around)` 以 `orig()`(无参)调用原方法。上游所有被包装的方法恰好都**无参**,
所以一直没暴露;而 100 座变体里 `startSpTurn(s)` 带了参数,于是骨架被静默传入 `undefined`,
表现为**机变在第一个回合卡死**(机器人永远不动)。

已修:`wrap` 现在转发全部实参(`orig(...args)`)。**这是上游潜在的脆弱点**——任何将来带参数的被包装方法都会中招。



## 5. 规则 ↔ 代码对照

### 5.1 队内兜底:几乎就是现有逻辑

| 设计规则 | 代码现状 | 差距 |
|---|---|---|
| 无漏怪者才有兜底资格 | `unite.js` `planUnite`:`perfects` = `r.perfect !== false` 且无计漏 | 一致 |
| 2 人无漏 → 2 人兜底 | `helperOrder(...).slice(0, m.gd.unite.maxHelpers)` | **`maxHelpers` 2 → 4** |
| 1 人无漏 → 1 人兜底 | `uniteStageId(gd, 1)` → `escaped_single` | 一致 |
| 无人无漏 → 直接进第二波 | `planUnite` 返回 `null`(无 perfect 即不开联防) | 概念一致,第二波不存在 |
| 兜底者"状态良好" | `helperStats` 已算 `standing`(存活干员数)并参与排序 | **只排序,无硬门槛** |

硬约束(审计层会拦):

```js
// server/match/audit.js:406
if (helpers.length > gd.unite.maxHelpers) fail(`${helpers.length} 联防 helpers (max ${gd.unite.maxHelpers})`);
```

`helperOrder` 的确定性排序:`units > activeBond > standing > seat`(对)> `units > activeBond > layers > standing > seat`(对内)。

### 5.2 联防地图几何

```json
// data/config.json
"unite": { "maxHelpers": 2, "templates": { "1": "act1autochess_escaped_single", "2": "act1autochess_escaped_multi" } }
```

`escaped_multi` 是 **21 列宽**的合并地图:两个半场在 col 10 拼接,右半场 `colOffset = 8`
(`unite.js:159`),右半场入口在 col 18。4 人同时联防**现有模板装不下**,需要新地图数据 + 新模板档位。

### 5.3 跨分队兜底

现联防敌人模型是**漏怪之并集**(`unite.js`:`Enemies = the union of every leaker's counted leaks`),
LP 记账按"漏怪归属的源玩家"结算(`Battle._bountyPayee`)。
`PHASE` 中**只有一个 `UNITE` 阶段**,"第二层兜底"需要新增阶段。

### 5.4 已定项

- **首领血量**:沿用原版线性膨胀(`bossHpScale.perPlayer = true`),即 `bloodPoint × 存活人数`;
- **取消限伤**:`shared/constants.js` `BOSS_HIT_LIMIT = 300000`
  (注释已写明 `0 / Infinity = off`),语义是"单发 ≥ 阈值则整次作废",只作用于 boss/hidden 的领袖本体;
  胄的无人机 2% 直扣已标 `noHitLimit`,不走此限。

## 6. 待决问题

在规则层动工前必须确定:

1. **3 或 4 人都无漏时,队内兜底上几人?**(建议仍取 2 人,沿用现有排序以保证确定性与 golden 可复现)
2. **"状态良好"是否做成硬门槛?**(建议做:例如存活干员数为 0 者取消资格;阈值待定)
3. **25 个小队的串联拓扑**:
   - 环形(1→2→…→25→1)还是链式(末端无下一队)?
   - 传给固定下一队,还是按剩余实力挑选?
   - 第二波也没兜住时:就此结算扣 LP,还是继续传(是否设最大轮数)?
   - 环形时如何**防死循环**?
4. **`aliveEnemyCap` 的系数**是否接受 1500/人(现取值,已消除 100 座的 spawn 拒绝)。
5. **机变阶段 6 张卡怎么分给 100 人?**(§4.4)三个方向:按人数放大卡数、只让部分人参与、或改成别的发放方式。
   这条不只是一张卡的事——机变卡(悬赏 / 策略 / 特质)会显著影响局面强度,和首领血量膨胀是同一套平衡账。

## 7. 尚未验证

- **真实浏览器 100 客户端**:本轮只做了服务端与引擎层;100 个客户端的 WS 带宽与浏览器端 Spine 渲染未测。
  上游性能 PR(#198)只测到 2 人联防,同屏单位峰值 15–20 个。
- **UI 在 100 座下的可用性**(§4.3)。
- **美术素材**:`public/assets` 未下载(本轮不需要);视觉验证前需 `npm run assets`。

## 8. 机变阶段的三个独立缺陷(2026-10-07 用户实机报告后修复)

用户在**双人同队**的实机对局中报告"两个人都没法选牌"。逐项查出**三个互相独立**的原因 —— 前两个都是 100 座改造引入的:

### 8.1 AI 轮次被全局定时器取消(只有最后一个小队会出手)

`startSpTurn` 用 `this._turnTimer` / `this._turnToken` 这对**全局单例**,而 `enterSpDraft` 会**为 25 个小队各调一次**它:

```js
for (const d of live) this.startSpTurn(d);   // 每次调用都 cancel 掉上一个小队的定时器
```

→ 只有最后一个排程的小队 AI 会出手,其余 24 个小队的 AI 永远等不到回合。而机变在联机下**本就没有时限**(25 个并发倒计时无法共用一个客户端读的 deadline),所以表现为**永久卡在「AI 正在决策…」**。

**修法**:定时器与令牌改为每小队独立(`s._botTimer` / `s._botToken`)。

### 8.2 队友的私密帧没有刷新(同队第二个真人点不动)

机变选牌界面是从 **`m.private`** 构建的(因为小队的卡池不能向全房间广播),而客户端 `choiceOverlay.cardPickable` 的判据是:

```js
const myTurn = solo || sp.turnPid === myId;
```

服务端 `_applyCard` 只调了 `markPrivate(ps)` —— **只标脏出手的那个人**。于是同队其他成员的 `m.private` 里 `sp.turn` 仍是旧值,`turnPid !== myId` → **所有卡都点不动**。第一个真人选完后,第二个真人就锁死了。

**修法**:新增 `_spMarkSquad(s)`,在轮次变化的每个出口把**整个小队**的私密帧标脏(`_sendPrivate` 按 payload 去重,无变化时不产生流量)。

### 8.3 这两点为什么没被之前的测试发现

测试驱动器直接调用**服务端** `m.pickCard(ps, idx)`,**绕过了客户端判定**,所以 8.2 完全处于盲区;而驱动器原先只有"全 AI 座位"一种模式,AI 自己会出手,**掩盖了 8.1**。

**补上的验证手段**:
- 驱动器支持 `humanSeats` 参数与"替真人出手"(简报页、准备、机变三段);
- 加装**私密帧新鲜度探针**:挂 `_sendPrivate` 记录每个玩家最后收到的 `sp`,出手后强制 `flush` 再断言"下一个该出手的人,他的帧里的 turn 就是他"。

**A/B 证据**(16 座 / 4 真人,6 次检查):

| | 陈旧帧 |
|---|---|
| 修复启用 | **0** |
| 修复禁用 | **6**(例如 `hu_000` 的帧仍是 `turn=hu_003`) |

回归:10 种配置(0/2/4/8/20 真人 × NORMAL/HARD)全部 `ended=true`、0 违规、0 错误、0 陈旧帧。

## 9. 阶段 2 还原为「第二轮战场」(2026-10-08)

### 9.1 之前为什么没有战场

阶段 2（跨队串联兜底）原先是**收尾钩子里的一次同步原子结算** —— 按实力挑接收队、按接收队实力挡下一部分、
挡不住的结算给原始漏怪玩家。规则是对的，但**玩家看不到任何战场画面**：漏怪被"隔空"处理掉了。

改成第二轮战场的尝试**曾经失败**，症状是审计报 `relay plan of squad N bills a player outside the relaying squad M`：
某队战场先结束时收尾钩子触发一次、全部战场结束时又触发一次，第二次把**转交计划当成阶段 1 重算**，
于是别队的漏怪被并进了计费。当时的结论是"从收尾钩子里再发起一轮联防会重入"，于是改成原子结算回避了这个时序问题。

### 9.2 真正的根因：审计包装器丢参数

这次还原时才发现，当年的重入有**两个**原因，而其中一个是我自己的测试工具引入的：

```js
// server/match/audit.js（修前）
wrap(m, 'startUnite', function (orig, planArg) {   // ← 只声明一个形参
  ...
  const r = orig(planArg);                          // ← 第二个参数 round 被丢掉
```

`wrap` 的实现本身是 `function wrapped(...args) { return around.call(this, orig.bind(this), ...args); }`，
参数**传进来了**，但这个包装器只声明了 `planArg`，调用时又只转发 `planArg`。
于是 `startUnite(list, 2)` 到达真实方法时变成 `startUnite(list)`，`round` 取默认值 **1**：

```js
this.uniteRound = Number.isInteger(round) && round > 0 ? round : 1;   // 永远是 1
```

后果：阶段 2 的战场结束后，收尾钩子看到 `uniteRound === 1`，**又去规划下一轮** —— 这正是当年那个"无界重入"。
换句话说：**原子结算回避的是一个被测试工具放大/掩盖的问题**，而不是规则本身的缺陷。

**修法**：包装器完整转发 `orig(planArg, round)`。已扫描全部 `wrap()` 包装器，确认没有同类漏参
（`startSpTurn` 用的是 `orig(...args)`，不是漏参）。这已经是同一模式第二次出现 —— 第一次是 `startSpTurn` 的
`orig()` 完全不带参数（`audit.js` 的 "startSpTurn takes the squad's draft, so the original arguments MUST be
forwarded" 注释即那次修复）。

### 9.3 现在的实现

`config.unite.relayBattlefield`（**默认 true**）：

| | 阶段 1 | 阶段 2 |
|---|---|---|
| `true`（默认） | 每队一个战场（`u<squad>`），队内兜底 | **每个接收队一个战场**（`r<squad>`），打完才结算 |
| `false` | 同上 | 原子结算（旧行为，保留为回退） |

实现要点：

* `_enterRelayBattlefield` 用 `relayPlanFor` 造出接收方的计划（**保留每个转交敌人的 `sourcePlayerId`**，
  所以再次漏掉的敌人仍然计费给**最初漏怪的人**），然后 `later(0)` 推迟一轮再启动 —— 不在收尾钩子的调用栈里起战场。
* **两道重入守卫**：`uniteRound !== 1` 时只结算不再规划；`_phase1Driven` 记录"本轮已规划过"，无论钩子触发几次都只规划一次。
* `_finishRelayBattlefield` 把**阶段 1 的结果合并回来**（`combineUniteResults`），所以阶段 1 的漏怪永远不会因为
  阶段 2 的存在而丢失。
* 字段 id 用 `r` 前缀，与阶段 1 的 `u<squad>` 不可能冲突。

### 9.4 实测

两种模式 × 多种规模的整局回归（`SMOKE_RELAY=1` 强制开启，默认已是开启）：

| 配置 | 原子模式 | 第二轮战场 |
|---|---|---|
| 16 座 NORMAL | ended ✓ auditV 0 | ended ✓ auditV 0 |
| 100 座 NORMAL | ended ✓ peakF 50 | ended ✓ peakF 50 |
| 100 座 HARD | ended ✓ peakF 100 | ended ✓ **peakF 29** |
| 100 座 / 4 真人 | ended ✓ | ended ✓ |
| 100 座 / 20 真人 | — | ended ✓ |

HARD 的峰值战场数从 100 降到 29，说明阶段 2 确实成了**独立的一轮**（不再与阶段 1 的战场叠在一起）。
聚焦测试 73/73 通过。

### 9.5 教训

1. **测试工具的包装层会改变被测对象的行为**。`attachAudit` 是 instance-level 包装，它丢一个参数就能让
   "阶段 2" 永远退回阶段 1 —— 而症状看起来像规则 bug。以后给方法加参数时，**必须回头检查包装器是否转发它**。
2. 当年"因为重入所以放弃"的结论下得太早：重入的**一半原因在测试工具里**。先查清楚重入从哪来，
   再决定要不要绕开。
