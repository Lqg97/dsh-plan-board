# dsh-plan-board

为 DSH（DeepSeek Harness）做的**计划看板**插件：把一个工作区的 `doc/plans/` 扫成看板，不用打开 Markdown、不用问「现在推进到哪」，一眼看出每个计划卡在哪一步、停了多久、文件头和 progress 是否对得上。

```text
① 方案/待评审 2 │ ② 实施中 0 │ ③ 待拍板/阻塞 2 │ ④ 待合入/CI 1 │ ⑤ 待发布 1 │ ⑥ 已归档 45
```

点卡片右侧开抽屉：派生字段连同**命中理由**、文件头状态原文、MR 链接、最近 progress、文件位置。

## 特性

- **三个阶段列 + 归档**：① 方案/待评审 → ② 实施中 → ③ 待拍板/阻塞 → ④ 待合入/CI → ⑤ 待发布/观察窗 → ⑥ 已归档。
  列是**派生**的，不手工维护：从计划文件头那段引用（`> **当前状态（…）**：…`）和最近 3 条 progress 标题里读关键词。
- **「待拍板」排在「待合入」之前**：一个计划同时写「仍待用户授权」和 `opened` 时，瓶颈在等人拍板，不该显示成「快合入了」。
- **滞留分四档，按天算**：≤3 天正常、4–6 沉寂、7–8 滞留、≥9 停滞。计划推进是脉冲式的（单计划连续活跃天数中位数 1 天），小时级阈值只会天天报警。
- **「状态未对齐」是一等徽标**：文件头状态日期和最后 progress 日期差超过 1 天就报，**两个方向都报**——头比 progress 新说明 progress 没补，头比 progress 旧说明头状态未回写。
- **归档计划不染滞留色**：它们的时间戳只表示「归档多久了」，一片红会把真正在飞的停滞计划淹掉。
- **三视图**：看板 / 时间线（活跃跨度 + progress 打卡 + 今天竖线）/ 节奏（工作区自己的节奏快照：逐日逐小时热力 + 输入与完成数双曲线 + 高频口令）。
- **只看不改**：只读计划文件，不写回、不追加 progress、不改文件头。看板之外 `doc/plans/` 仍是唯一事实源。
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
| `doc/plans/evidence/<slug>/` | 证据目录，抽屉里显示子项数 |

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

看板响应缓存 15 秒，`cache-control: no-store`，路由返回 403 / 404 / 500 而不是抛错。

## 开发

```bash
node --test test/*.test.mjs        # 20 个用例，含真实工作区对账
DSH_PLAN_BOARD_TEST_WORKSPACE=/path/to/workspace node --test test/*.test.mjs
```

目录：

```
index.js               Host 路由与工作区围栏
src/scan-plans.mjs     计划文件与 progress 解析（纯函数）
src/stage-rules.mjs    阶段/健康度/一致性派生（纯函数）
src/board.mjs          三个视图的载荷组装
client.js              sidebar 入口 + main 面板 + 三视图 + 抽屉
test/board.test.mjs    派生规则 + 真实工作区对账（§4.1.1 校准表）
test/route.test.mjs    路由围栏、方法守卫、载荷形状
```

## 已知边界

- 阶段靠关键词匹配，不是语义理解：计划文件里用词跑出词表就会落到 ② 实施中（兜底列），卡片上的「命中理由」正是为了让人一眼看出它凭什么在这一列。
- 看板是全局面板，不带会话上下文；工作区列表来自 host 的 workspace registry，不是当前会话的 cwd。
- 节奏视图读的是离线快照，超过 7 天会在页顶提示；实时算需要解压全部对话记录，不适合放在面板渲染路径上。

## License

MIT
