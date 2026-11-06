# dsh-plan-board

为 DSH（DeepSeek Harness）做的**计划看板**插件：把一个工作区的 `doc/plans/` 扫成看板，不用打开 Markdown、不用问「现在推进到哪」，一眼看出每个计划卡在哪一步、停了多久、文件头和 progress 是否对得上。

```text
① 方案/待评审 2 │ ② 实施中 0 │ ③ 待拍板/阻塞 2 │ ④ 待合入/CI 1 │ ⑤ 待发布 1 │ ⑥ 已归档 45
```

点卡片开**居中悬浮**的详情窗（窄屏自动收成一栏）：「详情」页是卡片式信息层次——顶部摘要条给出阶段、健康度、MR 和命中理由；左栏是计划自己的话（文件头状态原文按段落排版，最近 progress 排成时间线）；右栏是派生字段（键值对齐、不挤压），文件横跨整宽：计划文件一行，证据文件一条一行、每页 10 条可翻页。计划和证据**点开即看内容**，不必复制路径再去终端找；「沟通」页可以给这个计划的 Agent 留言并唤醒它。

## 特性

- **六个阶段列（含归档）**：① 方案/待评审 → ② 实施中 → ③ 待拍板/阻塞 → ④ 待合入/CI → ⑤ 待发布/观察窗 → ⑥ 已归档。
  列是**派生**的，不手工维护：从计划文件头那段引用（`> **当前状态（…）**：…`）和最近 3 条 progress 标题里读关键词。
- **「待拍板」排在「待合入」之前**：一个计划同时写「仍待用户授权」和 `opened` 时，瓶颈在等人拍板，不该显示成「快合入了」。
- **滞留分四档，按天算**：≤3 天正常、4–6 沉寂、7–8 滞留、≥9 停滞。计划推进是脉冲式的（单计划连续活跃天数中位数 1 天），小时级阈值只会天天报警。
- **「状态未对齐」是一等徽标**：文件头状态日期和最后 progress 日期差超过 1 天就报，**两个方向都报**——头比 progress 新说明 progress 没补，头比 progress 旧说明头状态未回写。
- **归档计划不染滞留色**：它们的时间戳只表示「归档多久了」，一片红会把真正在飞的停滞计划淹掉。
- **卡片直接显示最近进展**：保留最新一条 progress 的日期和标题，不必逐张打开抽屉；可按最近活动、停滞优先或标题排序。
- **筛选不藏结果**：仓、健康度、有 MR、状态未对齐和搜索可以组合，搜索也认仓路径与 MR 号；显示匹配数并可一键清除。视图、筛选与排序偏好会保留，搜索词仅留在当前会话。
- **归档可完整浏览**：归档列默认最多显示 6 张，可展开全部；任何筛选或搜索都会绕过这个展示上限，列头始终显示真实匹配总数。
- **三视图**：看板 / 时间线（活跃跨度 + progress 打卡 + 今天竖线）/ 节奏（工作区自己的节奏快照：逐日逐小时热力 + 输入与完成数双曲线 + 高频口令）。卡片和时间线条都支持 Enter / Space 打开，详情抽屉支持 Esc 关闭与焦点返回。
- **任务内沟通**：详情抽屉分「详情 / 沟通」两页。留言先记到看板（不打扰任何人），点「发送并唤醒 Agent」才把**所有待投递留言合并成一条消息**送进该计划的 DSH 会话——首次发送创建会话，之后复用同一条对话；Agent 用 `plan_board_comment_add` 把回复写回看板，卡片上有待投递/执行中的角标，抽屉里可直接「打开会话」。发送失败留言保持待投递，重试不会丢。
- **沟通检索**：第四个视图跨所有计划搜留言，也能一键筛出「还有哪些计划在等我回复」。底层是可删除重建的 SQLite 索引，索引坏了只是搜不到，留言一条都不会少。
- **文件即点即看**：抽屉里的计划和证据文件都是可点的——直接渲染内容（512KB 封顶并标注截断），路径仍可一键复制。查看走受围栏限制的只读路由：只认扫描结果里的文件名，且必须落在本工作区 `doc/plans/` 内，符号链接指向外面会被拒绝。
- **只看不改**：只读计划文件，不写回、不追加 progress、不改文件头。看板之外 `doc/plans/` 仍是唯一事实源；沟通记录单独存放，从不写进计划文件。
- 中英文案随 DSH locale 切换，样式只用 `--dsw-alias-*` 主题 token，明暗主题都跟随应用。

## 要求

- DSH（DeepSeek Harness）桌面版，含 `main` 槽与 `sidebar.panellist` 槽。
- 目标工作区里要有 `doc/plans/*.md`（做看板）与可选的 `doc/plans/done/*.md`（归档列）。
- 节奏视图额外需要一份快照文件 `doc/plans/evidence/plan-board-plugin/cadence-data.json`；没有时该页显示指引而不是空图。

## 安装

插件是「本地目录 bundle」，把仓库克隆到任意位置后安装：

```bash
# 把目录路径喂给 plugin_manager 的 install_bundle
plugin_manager action=install_bundle target=/absolute/path/to/dsh-plan-board
```

安装后左侧栏出现「计划看板」图标，点它切到看板主面板。卸载：`plugin_manager action=remove_bundle target=@local/dsh-plan-board`。

## 工作区约定

看板读的是**计划文件的固定形状**——工作区按 `doc/plans/` 的既有规范写，插件不用配置就能认：

| 位置 | 用途 |
| --- | --- |
| `doc/plans/<slug>.md` | 在飞计划；文件头那段 `>` 引用即状态块 |
| `doc/plans/done/<slug>.md` | 已归档计划，进第 ⑥ 列 |
| `doc/plans/evidence/<slug>/progress.md` | 进度；只认行首 `## YYYY-MM-DD` 的条目 |
| `doc/plans/evidence/<slug>/` | 证据目录，抽屉里逐项列出并复制相对路径 |

状态块的两种写法都认：

```markdown
> **当前状态（2026-11-04 18:00）**：方案待评审，未动代码。
> 2026-11-04 已确认自动撤销 MR !1520 合入，本地分支已清理。
```

## 接口

Host 半身只提供只读路由，全部走连接信任校验并把读取限制在已登记工作区内：

| 路由 | 作用 |
| --- | --- |
| `GET /plan-board/workspaces` | 列出含 `doc/plans/` 的已登记工作区 |
| `GET /plan-board/board?path=<绝对路径>` | 看板：列、卡片、计数 |
| `GET /plan-board/plan?path=…&slug=…` | 单个计划详情，slug 必须在扫描结果内 |
| `GET /plan-board/cadence?path=…` | 节奏快照摘要，缺失时返回 `found:false` 与指引 |
| `GET /plan-board/discussion?path=…&slug=…` | 该计划的沟通记录、待投递数、关联会话与执行状态 |
| `POST /plan-board/discussion?path=…&slug=…` | `{action:'comment'}` 仅记留言；`{action:'deliver'}` 投递待发留言并唤醒 Agent（已归档计划拒绝） |
| `GET /plan-board/search?path=…&q=…` | 跨计划搜留言；`mode=pending` 列还有待投递留言的计划；索引不可用时返回 `available:false` 而不是报错 |
| `GET /plan-board/file?path=…&kind=plan\|evidence&slug=…&name=…` | 只读查看一个计划或证据文件；只服务扫描结果内、且落在 `doc/plans/` 下的文本文件 |

看板与节奏响应缓存 15 秒，`cache-control: no-store`。点击「刷新」会附加递增的 `refresh` 参数，强制重读并替换对应工作区的缓存；后续普通读取仍复用 TTL 缓存。路由返回 403 / 404 / 500 而不是抛错。

## 开发

```bash
node --test test/*.test.mjs        # 派生规则、路由与客户端视图模型回归
DSH_PLAN_BOARD_TEST_WORKSPACE=/path/to/workspace node --test test/*.test.mjs
```

目录：

```
index.js               Host 路由与工作区围栏
src/scan-plans.mjs     计划文件与 progress 解析（纯函数）
src/stage-rules.mjs    阶段/健康度/一致性派生（纯函数）
src/board.mjs          三个视图的载荷组装
src/discussion.mjs     沟通记录存储（原子写）+ 留言投递与回流
src/dsh-session.mjs    DSH 会话适配：复用 / 恢复 / 新建并绑定工作区
src/discussion-index.mjs 派生 SQLite 索引：跨计划搜索与待办收件箱（可删可重建）
client.js              sidebar 入口 + main 面板 + 三视图 + 抽屉（详情/沟通）
test/board.test.mjs    派生规则 + 真实工作区对账（§4.1.1 校准表）
test/client.test.mjs   客户端筛选、排序、归档、时间线与键盘回归
test/discussion.test.mjs 留言去重、合并投递、失败保留与 Agent 回流
test/session.test.mjs  会话复用、跨工作区拒绝、归档与不可恢复降级
test/index.test.mjs    索引重建、损坏容错、待办查询与 JSON 事实源约束
test/route.test.mjs    路由围栏、方法守卫、刷新缓存与载荷形状
```

## 沟通记录存放

沟通记录与计划一对一带会话绑定，存在 `$DSH_HOME/plan-board/discussions.json`（默认 `~/.dsh/plan-board/discussions.json`），同目录临时文件 + `fsync` + rename 原子写入。文件格式不认识时明确报错并保留原文件，不会用空记录覆盖。

### 沟通检索：派生索引，可删可重建

旁边还有一份 `discussions.index.sqlite`，**不是事实源**：

```text
discussions.json          ← 事实源：可读、可 grep、可手工修
discussions.index.sqlite  ← 派生物：随时可删，下次查询自动从 JSON 重建
```

这个分界和 DSH 自己一致：会话日志存成 `.jsonl.zstd` 文件，`node:sqlite` 只用来建可重建的搜索索引。所以：

- **删掉索引文件不会丢任何留言**，下一次查询会重建；
- **索引写失败不影响留言**：JSON 提交在先，索引只做投影，失败时搜索降级为不可用并给出原因；
- 索引文件 schema 用 `PRAGMA user_version` 版本化，版本不符直接重建而不是盲目迁移；
- `node:sqlite` 是实验特性，仅在真正用到搜索时才惰性加载。

索引存在的原因不是性能（实测 2000 条留言追加也只要 12ms），而是 JSON 做不到的两件事：**跨计划搜索**和**「还有哪些计划在等我回复」的收件箱查询**。

会话与接口（对照本机 DSH 真实 API，不是参考实现的私有形状）：

- 会话创建走 `agents.create({ sessionId, meta: { cwd }, setup })`，恢复走 `agents.resume({ resumeSessionId, setup })`；`setup(agentCtx, agent)` 由运行时在发布前调用。
- 预设组合用 `agentPresets.resolve(id)` + `agentPresets.mount(agentCtx, id)`（运行时没有 `defaultPresetId` / `get()`）；预设不可用时退化为无预设会话，不会让首次发送失败。
- 每个计划独占一条会话：会话 → 计划 的绑定决定 Agent 回复写回哪个计划，两个计划不会共用一条会话。
- 可选服务一律通过 `ctx.get(name)` 读取；直接读未声明的服务会抛错，缺服务时功能降级而不是整个插件失效。

投递规则（与参考实现一致）：

- 只有**用户**留言会被投递；Agent 回复与系统提示只入记录。
- N 条待投递留言合并成**一条**用户消息，避免在会话里刷成一排气泡。
- 已投递的留言不会被重复发送；关掉面板再点一次「发送」不会重发。
- 发送失败（运行时不可用、会话不可恢复等）留言保持待投递，可重试。
- 关联会话若已属于别的工作区，直接拒绝投递，不会把消息送进错误的项目。

## 已知边界

- 阶段靠关键词匹配，不是语义理解：计划文件里用词跑出词表就会落到 ② 实施中（兜底列），卡片上的「命中理由」正是为了让人一眼看出它凭什么在这一列。
- 看板是全局面板，不带会话上下文；工作区列表来自 host 的 workspace registry，不是当前会话的 cwd。
- 节奏视图读的是离线快照，超过 7 天会在页顶提示；实时算需要解压全部对话记录，不适合放在面板渲染路径上。

## License

MIT
