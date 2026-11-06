/**
 * Browser half of the plan board.
 *
 * Registers one global sidebar row and one `main` panel. The panel draws three
 * views of the same scan: a kanban by stage, a timeline of plan activity, and the
 * workspace's own rhythm snapshot. A drawer shows one plan's derived fields and
 * the raw status block they came from.
 *
 * Everything visible comes from the plugin's own read-only host routes
 * (`index.js`); the panel never parses files itself. Styling uses only the
 * host's `--dsw-alias-*` theme tokens so light and dark both follow the app.
 */
window.__ModuleLoader__.load({
	id: '@local/dsh-plan-board',
	factory: (require) => {
		const React = require('react');
		const h = React.createElement;

		/** Client locale namespace owned by this plugin. */
		const NS = 'dsh-plan-board';
		/** `main` panel key and `sidebar.panellist` id; the same string on purpose. */
		const PANEL_ID = 'plan-board';
		/**
		 * Where a workspace the user picked explicitly is remembered.
		 *
		 * `.v2` on purpose: `v1` was written by the first release, which also
		 * persisted its auto-pick. That stale value pointed at a workspace with no
		 * live plans, so the panel kept reopening onto a blank board. Auto-picks are
		 * no longer stored; the new key simply ignores the old one.
		 */
		const STORE_KEY = 'dsh-plan-board.workspace.v2';
		/** View preferences only; search text deliberately remains session-local. */
		const PREFS_KEY = 'dsh-plan-board:view.v1';
		/** Client context captured at apply time, for lazily resolved runtime services. */
		let ctxRef = { get: () => undefined };

		/** Number of archived cards shown before the reader explicitly expands all. */
		const ARCHIVED_SHOWN = 6;
		/** Evidence files per page. */
		const EVIDENCE_PAGE_SIZE = 10;

		/** Column accent colours; the only literal colours in the file, used as dots. */
		const STAGE_HUE = {
			design: '#8b5cf6',
			doing: '#4d8dff',
			blocked: '#f2616b',
			ci: '#f0a92e',
			release: '#22d3ee',
			archived: '#3ecf8e',
		};

		const zh = {
			'nav': '计划看板',
			'title': '计划看板',
						'subtitle': '读 doc/plans/ 派生看板；不回写计划文件',
			'view.board': '看板',
			'view.timeline': '时间线',
			'view.cadence': '节奏',
			'view.talk': '沟通检索',
			'search.placeholder': '搜全部计划的留言…',
			'search.empty': '没有匹配的留言',
			'search.unavailable': '沟通检索索引不可用（留言本身不受影响）：{reason}',
			'search.pending': '待我处理 {n}',
			'search.all': '全部',
			'search.scope.workspace': '本工作区',
			'search.scope.all': '所有工作区',
			'search.pendingOnly': '只看待投递',
			'search.hits': '{n} 条结果',
			'search.openPlan': '打开计划',
			'search.delivered': '已投递',
			'search.pendingTag': '待投递',
			'search.archived': '已归档',
			'action.refresh': '刷新',
			'action.refreshing': '刷新中…',
			'action.close': '关闭',
			'action.expand': '展开',
			'action.collapse': '收成窄条',
			'action.expandAll': '展开全部（其余 {n} 条）',
			'action.showLess': '仅显示最近 {n} 条',
			'action.clearFilters': '清除筛选',
			'action.copy': '复制',
			'action.copied': '已复制',
			'action.copyFailed': '复制失败',
			'filter.allRepos': '全部仓',
			'filter.repo': '仓库',
			'filter.health': '健康度',
			'filter.hasMr': '有 MR',
			'filter.mismatch': '状态未对齐 {n}',
			'filter.stalled': '停滞',
			'filter.warning': '滞留',
			'filter.ok': '正常',
			'filter.search': '搜索标题、slug、仓或 MR…',
			'filter.workspace': '选择工作区',
			'sort.title': '列内排序',
			'sort.updated': '最近活动',
			'sort.stalled': '停滞优先',
			'sort.planTitle': '标题',
			'count.live': '在飞',
			'count.archived': '已归档',
			'count.today': '今日有进展',
			'count.matches': '匹配 {shown} / {total}',
			'health.ok': '正常',
			'health.idle': '沉寂',
			'health.warn': '滞留',
			'health.error': '停滞',
			'health.archived': '已归档',
			'idle.progress': '按最后 progress 计算',
			'idle.header': '按文件头状态日期计算',
			'idle.mtime': '仅按文件 mtime 计算，不代表已有进展',
			'idle.unknown': '还没有可用于计算的日期',
			'stage.design': '① 方案 / 待评审',
			'stage.doing': '② 实施中',
			'stage.blocked': '③ 待拍板 / 阻塞',
			'stage.ci': '④ 待合入 / CI',
			'stage.release': '⑤ 待发布 / 观察窗',
			'stage.archived': '⑥ 已归档',
			'stageHint.design': '文件头写着待评审、未动代码',
			'stageHint.doing': '其余在飞计划，包含没有 progress 记录的一次性计划',
			'stageHint.blocked': '等你决策：授权、拍板、阻塞项',
			'stageHint.ci': 'MR 已提、等 CI 或等评审',
			'stageHint.release': '已合入，等发布、灰度、观察窗或验收',
			'stageHint.archived': '位于 doc/plans/done/',
			'reason.matched': '命中「{phrase}」',
			'reason.fallback': '无状态关键词，按在飞处理',
			'reason.archived': '位于 doc/plans/done/',
			'card.archived': '归档 {n}d',
			'card.idle': '{n} 天',
			'card.latest': '最新进展',
			'card.progress': '{n} 条 progress',
			'card.mismatch': '状态未对齐',
			'panel.derived': '派生字段',
			'panel.stage': '阶段',
			'panel.reason': '命中理由',
			'panel.health': '健康度',
			'panel.healthValue': '{health}（{n} 天）',
			'panel.mismatchProgress': 'progress 没补（文件头比最后 progress 新 {n} 天）',
			'panel.mismatchHeader': '头状态未回写（落后最后 progress {n} 天）',
			'panel.headerDate': '文件头状态日期',
			'panel.lastProgress': '最后 progress',
			'panel.progressCount': 'progress 条数',
			'panel.mtime': '文件 mtime',
			'panel.mismatch': '一致性',
			'panel.headerBlock': '文件头状态行',
			'panel.mr': 'MR',
			'panel.recent': '最近 progress',
			'panel.files': '文件位置',
			'panel.noMr': '该计划文件里没有 MR 链接',
			'panel.noProgress': '没有 progress.md，或还没有带日期的条目',
			'panel.evidence': '证据目录',
			'panel.loading': '正在读取计划详情…',
			'empty.column': '—',
			'empty.doing': '当前没有实施中的计划',
			'empty.noMatches': '没有符合当前筛选条件的计划',
			'empty.noWorkspace': '还没有已登记的工作区',
			'empty.noPlans': '这个工作区的 doc/plans/ 下没有计划文件',
			'cadence.missing': '未找到节奏快照',
			'cadence.missingHint': '在工作区运行 doc/plans/evidence/plan-board-plugin/scripts/mine.mjs 生成后即可读取。',
			'cadence.stale': '快照已 {n} 天未更新',
			'cadence.heat': '按小时 × 日期热力',
			'cadence.heatHint': '颜色深浅 = 当日该小时的真实用户输入条数。',
			'cadence.weekly': '按周：输入数 vs 完成计划数',
			'cadence.weeklyHint': '两条线必须分开看——完成数不能当投入强度。',
			'cadence.legendPrompts': '用户输入',
			'cadence.legendDone': '完成计划',
			'cadence.prompts': '用户输入',
			'cadence.activeDays': '活跃天数',
			'cadence.vocab': '高频口令',
			'cadence.facts': '节奏结论',
			'timeline.hint': '活跃跨度与 progress 打卡；今天是右侧红线。',
			'timeline.today': '今天',
			'error.load': '读取失败：{message}',
			'error.workspace': '这个工作区不可用。',
			'disc.tabDetail': '详情',
			'disc.tabDiscussion': '沟通',
			'disc.title': '沟通',
			'panel.planFile': '计划文件',
			'panel.evidenceCount': '证据文件（{n}）',
			'panel.tabContent': '计划内容',
			'panel.tabFiles': '文件',
			'action.prevPage': '上一页',
			'action.nextPage': '下一页',
			'action.pageInfo': '第 {page}/{total} 页 · {from}–{to}，共 {n} 个',
			'view.file': '查看',
			'view.fileOpen': '查看内容',
			'view.fileLoading': '读取中…',
			'view.fileTruncated': '文件较大，仅显示前 {n} KB',
			'view.copyPath': '复制路径',
			'view.backToPlan': '返回详情',
			'disc.hint': '留言先记录在看板；「发送并唤醒」才会把待投递留言送进该计划的 DSH 会话。',
			'disc.openSession': '打开会话 ↗',
			'disc.session': '关联会话 {id}',
			'disc.noSession': '还没有关联会话，首次发送会创建',
			'disc.bound': '已关联会话',
			'disc.pending': '{n} 条待投递',
			'disc.running': 'Agent 执行中…',
			'disc.empty': '还没有沟通记录。有需要拍板或补充的信息可以写在下面。',
			'disc.placeholder': '给这个计划留一条消息…',
			'disc.comment': '仅留言',
			'disc.deliver': '发送并唤醒 Agent',
			'disc.sending': '发送中…',
			'disc.sent': '已发送 {n} 条留言',
			'disc.saved': '留言已记录',
			'disc.notice': '{message}',
			'disc.archived': '已归档计划不再唤醒 Agent',
			'disc.unavailable': '当前运行时不支持任务会话',
			'disc.authorUser': '我',
			'disc.authorAgent': 'Agent',
			'disc.authorSystem': '系统',
			'disc.authorAgentId': 'Agent · {id}',
			'disc.jumpOpened': '已打开会话',
			'disc.jumpArchived': '会话已归档：{id}',
			'disc.jumpMissing': '会话不存在：{id}',
			'disc.jumpUnavailable': '当前界面不支持跳转会话',
			'wip.full': '已到 WIP 上限',
		};

		const en = {
			'disc.tabDetail': 'Details',
			'disc.tabDiscussion': 'Conversation',
			'disc.title': 'Conversation',
			'panel.planFile': 'Plan file',
			'panel.evidenceCount': 'Evidence files ({n})',
			'panel.tabContent': 'Plan',
			'panel.tabFiles': 'Files',
			'action.prevPage': 'Previous page',
			'action.nextPage': 'Next page',
			'action.pageInfo': 'Page {page}/{total} · {from}–{to} of {n}',
			'view.file': 'View',
			'view.fileOpen': 'View content',
			'view.fileLoading': 'Loading…',
			'view.fileTruncated': 'Large file; showing the first {n} KB',
			'view.copyPath': 'Copy path',
			'view.backToPlan': 'Back to details',
			'disc.hint': 'Messages are kept on the board first; "Send & wake" is what delivers them to the plan\'s DSH session.',
			'disc.openSession': 'Open session ↗',
			'disc.session': 'Session {id}',
			'disc.noSession': 'No session yet — the first send creates one',
			'disc.bound': 'Session bound',
			'disc.pending': '{n} pending',
			'disc.running': 'Agent is working…',
			'disc.empty': 'No messages yet. Ask for a decision or add context below.',
			'disc.placeholder': 'Leave a message for this plan…',
			'disc.comment': 'Comment only',
			'disc.deliver': 'Send & wake agent',
			'disc.sending': 'Sending…',
			'disc.sent': 'Sent {n} message(s)',
			'disc.saved': 'Comment saved',
			'disc.notice': '{message}',
			'disc.archived': 'Archived plans are not woken',
			'disc.unavailable': 'This runtime has no task sessions',
			'disc.authorUser': 'You',
			'disc.authorAgent': 'Agent',
			'disc.authorSystem': 'System',
			'disc.authorAgentId': 'Agent · {id}',
			'disc.jumpOpened': 'Session opened',
			'disc.jumpArchived': 'Session is archived: {id}',
			'disc.jumpMissing': 'Session does not exist: {id}',
			'disc.jumpUnavailable': 'This UI cannot open sessions',
			'nav': 'Plan Board',
			'title': 'Plan Board',
						'subtitle': 'Derived from doc/plans/; plan files are never rewritten',
			'view.board': 'Board',
			'view.timeline': 'Timeline',
			'view.cadence': 'Cadence',
			'view.talk': 'Conversations',
			'search.placeholder': 'Search comments across every plan…',
			'search.empty': 'No matching comments',
			'search.unavailable': 'The conversation search index is unavailable (comments are unaffected): {reason}',
			'search.pending': 'Needs me {n}',
			'search.all': 'All',
			'search.scope.workspace': 'This workspace',
			'search.scope.all': 'All workspaces',
			'search.pendingOnly': 'Undelivered only',
			'search.hits': '{n} result(s)',
			'search.openPlan': 'Open plan',
			'search.delivered': 'Delivered',
			'search.pendingTag': 'Pending',
			'search.archived': 'Archived',
			'action.refresh': 'Refresh',
			'action.refreshing': 'Refreshing…',
			'action.close': 'Close',
			'action.expand': 'Expand',
			'action.collapse': 'Collapse',
			'action.expandAll': 'Show all ({n} more)',
			'action.showLess': 'Show latest {n}',
			'action.clearFilters': 'Clear filters',
			'action.copy': 'Copy',
			'action.copied': 'Copied',
			'action.copyFailed': 'Copy failed',
			'filter.allRepos': 'All repos',
			'filter.repo': 'Repository',
			'filter.health': 'Health',
			'filter.hasMr': 'Has MR',
			'filter.mismatch': 'Out of sync {n}',
			'filter.stalled': 'Stalled',
			'filter.warning': 'Slowing',
			'filter.ok': 'Healthy',
			'filter.search': 'Search title, slug, repo or MR…',
			'filter.workspace': 'Choose workspace',
			'sort.title': 'Sort within columns',
			'sort.updated': 'Recent activity',
			'sort.stalled': 'Most stalled',
			'sort.planTitle': 'Title',
			'count.live': 'live',
			'count.archived': 'archived',
			'count.today': 'moved today',
			'count.matches': '{shown} / {total} matches',
			'health.ok': 'ok',
			'health.idle': 'quiet',
			'health.warn': 'slowing',
			'health.error': 'stalled',
			'health.archived': 'archived',
			'idle.progress': 'Based on the latest progress entry',
			'idle.header': 'Based on the header status date',
			'idle.mtime': 'Based only on file mtime; this is not proof of progress',
			'idle.unknown': 'No date available yet',
			'stage.design': '① Design / review',
			'stage.doing': '② In implementation',
			'stage.blocked': '③ Decision / blocked',
			'stage.ci': '④ Merge / CI',
			'stage.release': '⑤ Release / observation',
			'stage.archived': '⑥ Archived',
			'stageHint.design': 'The header says review is pending or code has not started',
			'stageHint.doing': 'Other live plans, including one-off plans without progress entries',
			'stageHint.blocked': 'Waiting for a decision, authorization, or blocker resolution',
			'stageHint.ci': 'MR opened; waiting for CI or review',
			'stageHint.release': 'Merged; waiting for release, rollout, observation, or acceptance',
			'stageHint.archived': 'Located under doc/plans/done/',
			'reason.matched': 'Matched “{phrase}”',
			'reason.fallback': 'No status phrase; treated as live',
			'reason.archived': 'Located under doc/plans/done/',
			'card.archived': '{n}d archived',
			'card.idle': '{n}d',
			'card.latest': 'Latest progress',
			'card.progress': '{n} entries',
			'card.mismatch': 'out of sync',
			'panel.derived': 'Derived fields',
			'panel.stage': 'Stage',
			'panel.reason': 'Why',
			'panel.health': 'Health',
			'panel.healthValue': '{health} ({n}d)',
			'panel.mismatchProgress': 'Progress log is missing updates (header is {n}d newer)',
			'panel.mismatchHeader': 'Header was not updated ({n}d behind latest progress)',
			'panel.headerDate': 'Header status date',
			'panel.lastProgress': 'Last progress',
			'panel.progressCount': 'Progress entries',
			'panel.mtime': 'File mtime',
			'panel.mismatch': 'Consistency',
			'panel.headerBlock': 'Status block',
			'panel.mr': 'MR',
			'panel.recent': 'Recent progress',
			'panel.files': 'Files',
			'panel.noMr': 'No MR link in this plan file',
			'panel.noProgress': 'No progress.md, or no dated entries yet',
			'panel.evidence': 'Evidence',
			'panel.loading': 'Loading plan details…',
			'empty.column': '—',
			'empty.doing': 'Nothing in implementation',
			'empty.noMatches': 'No plans match the current filters',
			'empty.noWorkspace': 'No registered workspace yet',
			'empty.noPlans': 'No plan files under this workspace’s doc/plans/',
			'cadence.missing': 'No cadence snapshot',
			'cadence.missingHint': 'Run doc/plans/evidence/plan-board-plugin/scripts/mine.mjs in the workspace to produce one.',
			'cadence.stale': 'Snapshot is {n} days old',
			'cadence.heat': 'By hour × date',
			'cadence.heatHint': 'Colour depth = real user prompts in that hour of that day.',
			'cadence.weekly': 'Weekly: prompts vs plans finished',
			'cadence.weeklyHint': 'Read the two lines separately — finished plans are not effort.',
			'cadence.legendPrompts': 'Prompts',
			'cadence.legendDone': 'Finished',
			'cadence.prompts': 'Prompts',
			'cadence.activeDays': 'Active days',
			'cadence.vocab': 'Short commands',
			'cadence.facts': 'Cadence findings',
			'timeline.hint': 'Active span and progress pings; today is the red line.',
			'timeline.today': 'Today',
			'error.load': 'Load failed: {message}',
			'error.workspace': 'This workspace is unavailable.',
			'wip.full': 'At the WIP limit',
		};

		const CSS = `
.pb-root{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;width:100%;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13.5px;line-height:1.6;
  container-type:inline-size}
.pb-head{flex:none;display:flex;flex-direction:column;gap:12px;
  padding:12px clamp(12px,2.5cqi,24px);border-bottom:1px solid var(--dsw-alias-border-l1)}
.pb-headbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-width:0}
.pb-titlewrap{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;min-width:0}
.pb-title{font-size:15px;font-weight:650;margin:0;white-space:nowrap}
.pb-counts{display:flex;gap:12px;font-size:12px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}
.pb-counts b{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-weight:600}
.pb-countmatch b{color:var(--dsw-alias-brand-primary)}
.pb-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pb-filterbar{display:flex;flex-direction:column;gap:8px}
.pb-frow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.pb-reposel{max-width:230px}
.pb-searchbox{flex:1 1 260px;min-width:180px;max-width:420px}
.pb-seg{display:inline-flex;align-items:center;background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:2px;gap:2px}
.pb-segbtn{font:inherit;font-size:12px;border:0;background:none;color:var(--dsw-alias-label-secondary);
  padding:4px 11px;border-radius:6px;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s}
.pb-segbtn:hover{color:var(--dsw-alias-label-primary)}
.pb-segbtn[data-on='true']{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);
  box-shadow:0 1px 2px #0000001a}
.pb-spacer{flex:1}
.pb-tabs{display:flex;gap:2px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);
  border-radius:9px;padding:3px}
.pb-tabs button{font:inherit;font-size:12.5px;font-weight:500;border:0;background:none;
  color:var(--dsw-alias-label-secondary);padding:5px 14px;border-radius:7px;cursor:pointer;
  white-space:nowrap;transition:background .12s,color .12s}
.pb-tabs button:hover{color:var(--dsw-alias-label-primary)}
/* The active tab must be unmistakable. It cannot rely on a "raised surface":
   in the light theme --dsw-alias-bg-layer-1 and -2 both resolve to #fff, so a
   layer swap is invisible. A brand tint plus a brand hairline works in both
   themes without depending on those two tokens differing. */
.pb-tabs button[data-on='true']{
  background:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-bg-base);font-weight:600}
.pb-chip{font:inherit;font-size:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-secondary);padding:3px 10px;border-radius:999px;cursor:pointer}
.pb-chip[data-on='true']{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.pb-select,.pb-input{font:inherit;font-size:12.5px;background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:7px;padding:4px 9px}
.pb-input{width:220px}
.pb-input::placeholder{color:var(--dsw-alias-label-secondary)}
.pb-root button:focus-visible,.pb-root input:focus-visible,.pb-root select:focus-visible,
.pb-card:focus-visible,.pb-tl-bar:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pb-root button:disabled{opacity:.55;cursor:default}
.pb-ghost{font:inherit;font-size:12.5px;background:none;border:1px solid var(--dsw-alias-border-l2);
  color:var(--dsw-alias-label-secondary);padding:5px 12px;border-radius:7px;cursor:pointer;white-space:nowrap;
  transition:background .12s,color .12s,border-color .12s}
.pb-ghost:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary)}
.pb-ghost:disabled{opacity:.6}
.pb-main{flex:1;min-height:0;overflow:auto}
.pb-board{display:flex;gap:11px;padding:13px clamp(12px,2.5cqi,24px) 40px;align-items:flex-start;min-height:100%}
.pb-col{flex:0 0 250px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);
  border-radius:12px;display:flex;flex-direction:column;max-height:calc(100% - 8px)}
.pb-col[data-wip='warn']{border-color:var(--dsw-alias-state-warn-primary)}
.pb-col[data-wip='error']{border-color:var(--dsw-alias-state-error-primary)}
.pb-col[data-collapsed='true']{flex:0 0 130px}
.pb-colhead{display:flex;align-items:center;gap:7px;padding:9px 11px 7px;
  border-bottom:1px solid var(--dsw-alias-border-l1)}
.pb-colhead .pb-dot{width:7px;height:7px;border-radius:50%;flex:none}
.pb-colhead .pb-coltitle{font-size:12.5px;font-weight:640}
.pb-colhead .pb-coln{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);
  background:var(--dsw-alias-bg-layer-2);border-radius:999px;padding:1px 8px;font-variant-numeric:tabular-nums}
.pb-col[data-wip='warn'] .pb-coln{color:var(--dsw-alias-state-warn-primary)}
.pb-col[data-wip='error'] .pb-coln{color:var(--dsw-alias-state-error-primary)}
.pb-colbody{display:flex;flex-direction:column;gap:8px;padding:9px;overflow-y:auto}
.pb-card{position:relative;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);
  border-radius:9px;padding:9px 10px 8px 12px;cursor:pointer;transition:border-color .14s}
.pb-card:hover{border-color:var(--dsw-alias-border-l2)}
.pb-card[data-selected='true']{border-color:var(--dsw-alias-brand-primary)}
.pb-card .pb-bar{position:absolute;left:0;top:8px;bottom:8px;width:2.5px;border-radius:2px}
.pb-card .pb-name{font-size:12.5px;font-weight:600;line-height:1.4;margin:0 0 4px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pb-card .pb-slug{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:10px;
  color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pb-latest{display:flex;align-items:baseline;gap:6px;margin-top:6px;font-size:11px;line-height:1.45;
  color:var(--dsw-alias-label-secondary)}
.pb-latest-date{flex:none;color:var(--dsw-alias-brand-primary);font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:10px}
.pb-latest-text{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pb-card .pb-row{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:5px;font-size:11px;
  color:var(--dsw-alias-label-secondary)}
.pb-badge{font-size:10px;border-radius:4px;padding:1px 5px;border:1px solid var(--dsw-alias-border-l2);
  color:var(--dsw-alias-label-secondary);white-space:nowrap}
.pb-badge[data-tone='error']{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.pb-badge[data-tone='warn']{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.pb-badge[data-tone='ok']{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.pb-badge[data-tone='brand']{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.pb-mr{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:10px;color:var(--dsw-alias-brand-primary);
  background:var(--dsw-alias-bg-base);border-radius:4px;padding:1px 5px}
.pb-empty{text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px;padding:14px 0}
.pb-more{font:inherit;font-size:11.5px;background:none;border:1px dashed var(--dsw-alias-border-l2);
  color:var(--dsw-alias-label-secondary);border-radius:7px;padding:6px;cursor:pointer;margin:0 9px 9px}
.pb-more:hover{color:var(--dsw-alias-label-primary)}
.pb-colactions{display:flex;flex-wrap:wrap;gap:6px;margin:0 9px 9px}
.pb-colactions .pb-more{margin:0;flex:1 1 auto}
.pb-filterempty{display:flex;flex-direction:column;align-items:center;gap:10px;margin:60px auto;padding:24px;
  color:var(--dsw-alias-label-secondary);text-align:center}
.pb-tl{padding:18px clamp(12px,2.5cqi,24px) 60px}
.pb-tl-hint{color:var(--dsw-alias-label-secondary);font-size:11.5px;margin-bottom:10px}
.pb-tl-row{display:grid;grid-template-columns:230px 1fr;gap:12px;align-items:center;padding:4px 0}
.pb-tl-row:hover{background:var(--dsw-alias-bg-layer-1)}
.pb-tl-name{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  color:var(--dsw-alias-label-secondary)}
.pb-tl-track{position:relative;height:20px}
.pb-tl-bar{position:absolute;top:7px;height:6px;border-radius:3px;background:var(--dsw-alias-brand-primary);
  opacity:.55;cursor:pointer}
.pb-tl-bar[data-done='true']{background:var(--dsw-alias-state-success-primary);opacity:.4}
.pb-tl-pt{position:absolute;top:8.5px;width:3px;height:3px;border-radius:50%;
  background:var(--dsw-alias-label-primary);opacity:.55}
.pb-tl-axis{display:grid;grid-template-columns:230px 1fr;gap:12px;margin-top:6px}
.pb-tl-ticks{position:relative;height:18px;border-top:1px solid var(--dsw-alias-border-l1)}
.pb-tl-tick{position:absolute;top:3px;font-size:10px;color:var(--dsw-alias-label-secondary);
  transform:translateX(-50%);white-space:nowrap}
.pb-tl-today{position:absolute;top:0;bottom:0;width:1px;background:var(--dsw-alias-state-error-primary);opacity:.6}
.pb-tl-today-l{position:absolute;top:-15px;font-size:10px;color:var(--dsw-alias-state-error-primary);
  transform:translateX(-50%)}
.pb-cad{padding:20px clamp(12px,2.5cqi,28px) 60px;max-width:1180px}
.pb-cad h3{font-size:13px;font-weight:640;margin:24px 0 4px}
.pb-cad h3:first-child{margin-top:0}
.pb-cad .pb-hint{color:var(--dsw-alias-label-secondary);font-size:11.5px;margin-bottom:10px}
.pb-kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:9px}
.pb-kvc{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);
  border-radius:9px;padding:10px 12px}
.pb-kvc .pb-k{font-size:11px;color:var(--dsw-alias-label-secondary)}
.pb-kvc .pb-v{font-size:19px;font-weight:640;font-variant-numeric:tabular-nums;margin-top:2px}
.pb-kvc .pb-v small{font-size:11px;color:var(--dsw-alias-label-secondary);font-weight:400;margin-left:4px}
.pb-heat{display:grid;gap:3px}
.pb-heat .pb-hd{font-size:10px;color:var(--dsw-alias-label-secondary);text-align:right;padding-right:5px;
  line-height:17px;font-variant-numeric:tabular-nums}
.pb-heat .pb-hc{font-size:9px;color:var(--dsw-alias-label-secondary);text-align:center;line-height:14px}
.pb-heat .pb-cell{height:17px;border-radius:3px;background:var(--dsw-alias-bg-layer-2)}
.pb-heat .pb-cell[data-s='1']{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,transparent)}
.pb-heat .pb-cell[data-s='2']{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 42%,transparent)}
.pb-heat .pb-cell[data-s='3']{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 66%,transparent)}
.pb-heat .pb-cell[data-s='4']{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 92%,transparent)}
.pb-legend{display:flex;gap:14px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:6px}
.pb-legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;vertical-align:middle}
.pb-wbars{display:flex;gap:10px;align-items:flex-end;height:120px;padding-top:12px}
.pb-wcol{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end}
.pb-wstack{display:flex;gap:2px;align-items:flex-end;width:100%;justify-content:center;height:100%}
.pb-wbar{width:9px;border-radius:2px 2px 0 0}
.pb-wbar[data-k='prompts']{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 72%,transparent)}
.pb-wbar[data-k='done']{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 72%,transparent)}
.pb-wl{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.pb-vocab{display:flex;flex-wrap:wrap;gap:6px}
.pb-vocab .pb-v{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);
  border-radius:7px;padding:4px 9px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.pb-vocab .pb-v b{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;margin-left:5px}
.pb-note{border-left:2px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1);
  border-radius:0 8px 8px 0;padding:8px 12px;font-size:12px;color:var(--dsw-alias-label-secondary);margin:8px 0}
.pb-note b{color:var(--dsw-alias-label-primary)}
.pb-drawer{position:fixed;z-index:40;left:50%;top:50%;transform:translate(-50%,-50%);
  width:min(860px,92vw);max-height:min(88vh,900px);
  display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);
  border:1px solid var(--dsw-alias-border-l2);border-radius:14px;overflow:hidden;
  box-shadow:0 24px 60px #0007,0 2px 8px #0003}
.pb-drawer[data-mode='viewer']{width:min(1020px,94vw);height:min(86vh,860px);max-height:86vh}
.pb-dhead{display:flex;align-items:flex-start;gap:10px;padding:15px 20px 13px;
  border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.pb-dhead .pb-dt{font-size:14px;font-weight:640;line-height:1.4}
.pb-dhead .pb-ds{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:10.5px;
  color:var(--dsw-alias-label-secondary);margin-top:3px}
.pb-dx{margin-left:auto;background:none;border:0;color:var(--dsw-alias-label-secondary);font-size:18px;
  line-height:1;cursor:pointer;padding:0 4px}
.pb-dbody{flex:1;min-height:0;overflow:auto;padding:22px 26px 32px}

/* --- summary: the one thing to read first --- */
/* --- derived-field strip: label above value, wraps into columns --- */
.pb-strip{display:flex;flex-wrap:wrap;gap:0;margin-bottom:18px;
  border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;
  background:var(--dsw-alias-bg-layer-1)}
/* flex-grow fills the last row exactly: no empty trailing cell. */
.pb-cell{display:flex;flex-direction:column;gap:2px;padding:9px 14px;
  flex:1 1 150px;min-width:0;border-left:1px solid var(--dsw-alias-border-l1)}
.pb-cell:first-child{border-left:0}
.pb-cellk{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;line-height:1.5}
.pb-cellv{font-size:12.5px;font-weight:550;line-height:1.5;overflow-wrap:break-word;word-break:break-word}

/* --- second-level tabs: underline style, clearly subordinate to the pills --- */
.pb-subtabs{display:flex;gap:2px;flex-wrap:wrap;margin:0 0 16px;
  border-bottom:1px solid var(--dsw-alias-border-l1)}
.pb-subtab{font:inherit;font-size:12.5px;font-weight:500;background:none;border:0;cursor:pointer;
  color:var(--dsw-alias-label-secondary);padding:8px 14px 9px;position:relative;
  display:inline-flex;align-items:center;gap:6px;border-radius:7px 7px 0 0;transition:color .12s}
.pb-subtab:hover{color:var(--dsw-alias-label-primary)}
.pb-subtab[data-on='true']{color:var(--dsw-alias-brand-primary);font-weight:600}
.pb-subtab[data-on='true']::after{content:'';position:absolute;left:10px;right:10px;bottom:-1px;
  height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-brand-primary)}
.pb-subcount{font-size:10.5px;font-weight:600;background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-secondary);border-radius:999px;padding:0 6px;line-height:16px}
.pb-subtab[data-on='true'] .pb-subcount{color:var(--dsw-alias-brand-primary)}
/* Facts view: derived fields on the left, files on the right. */
@media(max-width:900px){}

.pb-summary{padding:16px 18px;margin-bottom:20px;border-radius:12px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}
.pb-summary-badges{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pb-summary-reason{margin-top:10px;font-size:12.5px;color:var(--dsw-alias-label-secondary);
  line-height:1.7;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}

/* --- section cards --- */
.pb-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);
  border-radius:12px;padding:16px 18px;margin-bottom:16px}
.pb-card:last-child{margin-bottom:0}
.pb-card > .pb-st{display:flex;align-items:center;gap:10px;
  font-size:11px;color:var(--dsw-alias-label-secondary);letter-spacing:.06em;
  text-transform:uppercase;font-weight:600;margin-bottom:12px}

/* --- derived facts: label/value rows, never squeezed --- */

/* --- files --- */
.pb-filegroup+.pb-filegroup{margin-top:16px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l1)}
.pb-filelabel{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:6px;letter-spacing:.02em}
.pb-pathrow{display:flex;align-items:center;gap:10px;flex-wrap:nowrap;min-width:0;
  border-bottom:1px solid var(--dsw-alias-border-l1)}
.pb-pathrow+.pb-pathrow{margin-top:6px}
.pb-pathrow .pb-openrow{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:10px;font:inherit;
  text-align:left;background:none;border:0;border-radius:7px;
  color:var(--dsw-alias-label-primary);padding:9px 10px;margin-left:-10px;cursor:pointer;
  transition:background .12s}
.pb-pathrow .pb-openrow:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}
.pb-pathrow .pb-fname{flex:1;min-width:0;font-size:12px;font-family:var(--ds-font-family-code,ui-monospace,monospace);
  overflow-wrap:anywhere;word-break:normal;line-height:1.5}
.pb-iconbtn{flex:0 0 auto;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;
  background:none;border:1px solid transparent;border-radius:6px;color:var(--dsw-alias-label-secondary);
  cursor:pointer;padding:0;opacity:0;transition:opacity .12s,background .12s,color .12s}
/* Reserved, not zero-width: the row must not shift when the icon appears. */
.pb-pathrow:hover .pb-iconbtn,
.pb-pathrow:focus-within .pb-iconbtn,
.pb-iconbtn:focus-visible{opacity:1}
.pb-iconbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.pb-iconbtn[data-error='true']{color:var(--dsw-alias-state-error-primary);opacity:1}
.pb-pathrow[data-copied='true'] .pb-iconbtn{color:var(--dsw-alias-state-success-primary)}
/* Touch and narrow screens have no hover: keep the action always visible. */
@media(hover:none){.pb-iconbtn{opacity:.75}}

/* --- files: one per row, paginated so a long list never floods the page --- */
.pb-files{display:flex;flex-direction:column}
.pb-files .pb-pathrow{margin:0;padding:0}
.pb-files .pb-pathrow+.pb-pathrow{margin-top:2px}
.pb-files .pb-pathrow .pb-openrow{padding:8px 11px;flex:1 1 auto}
.pb-files .pb-pathrow .pb-fname{font-size:12px;white-space:normal}
.pb-filescard .pb-filegroup+.pb-filegroup{margin-top:14px;padding-top:12px}
@media(max-width:900px){}

.pb-pathrow{display:flex;align-items:center;gap:8px;padding:0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.pb-pathrow button{flex:1;min-width:0;display:flex;align-items:center;gap:8px;font:inherit;text-align:left;
  background:none;border:0;color:var(--dsw-alias-label-secondary);padding:7px 0;cursor:pointer}
.pb-pathrow button:hover{color:var(--dsw-alias-brand-primary)}
.pb-pathrow .pb-fname{flex:1;min-width:0;overflow-wrap:anywhere;font-size:12px;
  font-family:var(--ds-font-family-code,ui-monospace,monospace)}
/* --- prose: the plan's own words, readable at last --- */
.pb-prose{display:flex;flex-direction:column;gap:14px}
.pb-para{margin:0;font-size:13px;line-height:1.85;color:var(--dsw-alias-label-primary);
  overflow-wrap:break-word;word-break:break-word}
.pb-para+.pb-para{margin-top:0}
.pb-prose .pb-para code{background:var(--dsw-alias-bg-layer-2);padding:1px 5px;border-radius:4px;
  font-size:11.5px;font-family:var(--ds-font-family-code,ui-monospace,monospace)}
.pb-prose .pb-para a{color:var(--dsw-alias-brand-primary);text-decoration:none}
.pb-prose .pb-para a:hover{text-decoration:underline}
.pb-muted{color:var(--dsw-alias-label-secondary);font-size:12.5px}

/* --- progress: a real timeline, not dashed rows --- */
.pb-timeline{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0}
.pb-tl-item{display:grid;grid-template-columns:96px 1fr;gap:14px;padding:10px 0;
  border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12.5px;line-height:1.7}
.pb-tl-item:last-child{border-bottom:0;padding-bottom:0}
.pb-tl-item:first-child{padding-top:0}
.pb-tl-date{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;
  color:var(--dsw-alias-brand-primary);white-space:nowrap;padding-top:1px}
.pb-tl-text{min-width:0;color:var(--dsw-alias-label-primary);overflow-wrap:break-word;word-break:break-word}
.pb-tl-text code{background:var(--dsw-alias-bg-layer-2);padding:1px 4px;border-radius:3px;font-size:11px}
@media(max-width:560px){.pb-tl-item{grid-template-columns:1fr;gap:2px}}
.pb-fileview{display:flex;flex-direction:column;height:100%;min-height:0}
.pb-filebar{display:flex;align-items:center;gap:10px;padding:4px 0 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.pb-filebar code{flex:1;min-width:0;font-size:11.5px;color:var(--dsw-alias-label-secondary);
  font-family:var(--ds-font-family-code,ui-monospace,monospace);overflow-wrap:anywhere}
.pb-filetext{margin:0;padding:12px 0 0;overflow:auto;flex:1;min-height:0;
  font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;line-height:1.7;
  white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}
.pb-mrl{display:flex;gap:7px;flex-wrap:wrap}
.pb-mrl a{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;
  color:var(--dsw-alias-brand-primary);text-decoration:none;background:var(--dsw-alias-bg-layer-2);
  border-radius:5px;padding:3px 8px}
.pb-scrim{position:fixed;inset:0;background:#00000059;z-index:39}
.pb-error{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);
  border-radius:8px;padding:10px 12px;font-size:12.5px;margin:14px}
.pb-loading{color:var(--dsw-alias-label-secondary);font-size:12.5px;padding:18px}
.pb-dback{margin-left:auto;display:flex;gap:6px;align-items:center}
.pb-dback .pb-tab{font:inherit;font-size:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-secondary);border-radius:6px;padding:3px 10px;cursor:pointer}
.pb-dback .pb-tab[data-on='true']{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.pb-badge-dot{display:inline-block;min-width:16px;padding:0 4px;margin-left:4px;border-radius:999px;font-size:10px;
  line-height:15px;text-align:center;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.pb-card .pb-badge-dot[data-run='true']{background:var(--dsw-alias-state-warn-primary)}
.pb-disc{display:flex;flex-direction:column;gap:10px}
.pb-disc-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.pb-disc-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.pb-disc-meta button{font:inherit;font-size:11.5px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-brand-primary);border-radius:6px;padding:2px 8px;cursor:pointer}
.pb-msgs{display:flex;flex-direction:column;gap:8px;max-height:42vh;overflow:auto;padding-right:2px}
.pb-msg{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 11px;font-size:12.5px;line-height:1.65;
  white-space:pre-wrap;overflow-wrap:anywhere;background:var(--dsw-alias-bg-layer-1)}
.pb-msg[data-author='user']{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,var(--dsw-alias-border-l1))}
.pb-msg[data-author='agent']{background:var(--dsw-alias-bg-layer-2)}
.pb-msg[data-author='system']{border-style:dashed;color:var(--dsw-alias-label-secondary);font-size:11.5px}
.pb-msg-head{display:flex;gap:8px;align-items:baseline;font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-bottom:3px}
.pb-msg-head b{color:var(--dsw-alias-label-primary);font-size:11px;font-weight:600}
.pb-msg-head .pb-unread{color:var(--dsw-alias-brand-primary)}
.pb-composer{display:flex;flex-direction:column;gap:6px}
.pb-composer textarea{font:inherit;font-size:12.5px;line-height:1.6;min-height:72px;resize:vertical;
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;
  color:var(--dsw-alias-label-primary);padding:8px 10px}
.pb-composer-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pb-composer-row .pb-notice{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.pb-composer-row .pb-notice[data-tone='error']{color:var(--dsw-alias-state-error-primary)}
.pb-search{padding:14px clamp(12px,2.5cqi,24px) 40px;display:flex;flex-direction:column;gap:10px}
.pb-searchbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pb-searchinput{width:min(420px,60vw)}
.pb-hit{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:9px 12px;
  background:var(--dsw-alias-bg-layer-1)}
.pb-hithead{display:flex;gap:9px;align-items:baseline;flex-wrap:wrap;margin-bottom:4px}
.pb-hitplan{font:inherit;font-size:11.5px;font-family:var(--ds-font-family-code,ui-monospace,monospace);
  background:none;border:0;padding:0;color:var(--dsw-alias-brand-primary);cursor:pointer;text-decoration:underline}
.pb-hitmeta{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.pb-hitbody{font-size:12.5px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}
@media(max-width:760px){.pb-tl-row,.pb-tl-axis{grid-template-columns:120px 1fr}}
`;

		/**
		 * Interpolate `{name}` placeholders in a locale string.
		 * @param {string} template - text.
		 * @param {Record<string, unknown>} [params] - values.
		 * @returns {string} text.
		 */
		function interpolate(template, params) {
			if (params === undefined) return template;
			return template.replace(/\{(\w+)\}/g, (whole, key) => (key in params ? String(params[key]) : whole));
		}

		/** Read and validate persisted view preferences without trusting storage. */
		function readBoardPreferences() {
			const fallback = {
				view: 'board', sort: 'updated', repo: '', health: '', hasMr: false,
				mismatchOnly: false, archivedOpen: false,
			};
			try {
				const saved = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? 'null');
				if (saved === null || typeof saved !== 'object') return fallback;
				return {
					view: ['board', 'timeline', 'cadence', 'talk'].includes(saved.view) ? saved.view : fallback.view,
					sort: ['updated', 'stalled', 'title'].includes(saved.sort) ? saved.sort : fallback.sort,
					repo: typeof saved.repo === 'string' ? saved.repo : '',
					health: ['', 'error', 'warn', 'idle', 'ok'].includes(saved.health) ? saved.health : '',
					hasMr: saved.hasMr === true,
					mismatchOnly: saved.mismatchOnly === true,
					archivedOpen: saved.archivedOpen === true,
				};
			} catch {
				return fallback;
			}
		}

		/** Latest activity date used only for ordering; mtime is not called progress. */
		function latestCardDate(card) {
			const dates = [card.lastProgressDate, card.headerStatusDate,
				typeof card.fileMtime === 'string' ? card.fileMtime.slice(0, 10) : null]
				.filter((date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date));
			return dates.length === 0 ? '' : dates.sort()[dates.length - 1];
		}

		/** Apply the board filters and one deterministic, non-mutating column sort. */
		function selectCards(cards, filters, sort) {
			const query = filters.query.trim().toLowerCase();
			const filtered = cards.filter((card) => {
				if (filters.repo !== '' && !(card.repositories ?? []).includes(filters.repo)) return false;
				if (filters.health !== '' && card.health !== filters.health) return false;
				if (filters.hasMr && (card.mergeRequests ?? []).length === 0) return false;
				if (filters.mismatchOnly && (card.archived === true || card.headerMismatch !== true)) return false;
				if (query !== '') {
					const merges = (card.mergeRequests ?? []).map((merge) => `${merge.repo} !${merge.num} ${merge.num}`).join(' ');
					const hay = `${card.title} ${card.slug} ${(card.repositories ?? []).join(' ')} ${merges}`.toLowerCase();
					if (!hay.includes(query)) return false;
				}
				return true;
			});
			const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
				|| a.slug.localeCompare(b.slug);
			const byUpdated = (a, b) => latestCardDate(b).localeCompare(latestCardDate(a)) || byTitle(a, b);
			if (sort === 'title') return filtered.sort(byTitle);
			if (sort === 'stalled') {
				const rank = { error: 0, warn: 1, idle: 2, ok: 3, archived: 4 };
				return filtered.sort((a, b) => (rank[a.health] ?? 5) - (rank[b.health] ?? 5)
					|| (b.idleDays ?? -1) - (a.idleDays ?? -1) || byUpdated(a, b));
			}
			return filtered.sort(byUpdated);
		}

		/** Search and other filters must never hide a match behind the archive cap. */
		function limitArchivedCards(cards, filtering, showAll) {
			return filtering || showAll ? cards : cards.slice(0, ARCHIVED_SHOWN);
		}

		/** Date-only UTC axis with at least 14 days, anchored at the latest date. */
		function timelineWindow(dates, today) {
			const valid = dates.filter((date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
				.filter((date) => Number.isFinite(Date.parse(`${date}T00:00:00Z`))).sort();
			if (valid.length === 0) valid.push(today);
			const latest = valid[valid.length - 1];
			const endTime = Date.parse(`${latest}T00:00:00Z`);
			const firstTime = Date.parse(`${valid[0]}T00:00:00Z`);
			const startTime = Math.min(firstTime, endTime - 14 * 86_400_000);
			return { startTime, endTime, span: endTime - startTime };
		}

		/** Translate stable host reason shapes while leaving unknown future reasons intact. */
		function formatStageReason(detail, tr) {
			if (detail.stage === 'archived') return tr('reason.archived');
			if (detail.stageReason === '无状态关键词，按在飞处理') return tr('reason.fallback');
			const match = /^命中「(.+)」$/.exec(detail.stageReason ?? '');
			return match === null ? detail.stageReason : tr('reason.matched', { phrase: match[1] });
		}

		/**
		 * Window one list into a fixed-size page.
		 *
		 * Clamps the requested index so a page left over from a longer list can
		 * never render an empty page.
		 * @param {number} total - item count.
		 * @param {number} requested - requested page index.
		 * @param {number} [size] - page size.
		 * @returns {{ page: number, pages: number, from: number, to: number, items: number[] }} window.
		 */
		function paginate(total, requested, size = EVIDENCE_PAGE_SIZE) {
			const count = Math.max(0, Number(total) || 0);
			const pages = Math.max(1, Math.ceil(count / size));
			const page = Math.min(Math.max(0, Number(requested) || 0), pages - 1);
			const start = page * size;
			const end = Math.min(start + size, count);
			const items = [];
			for (let index = start; index < end; index += 1) items.push(index);
			return { page, pages, from: count === 0 ? 0 : start + 1, to: end, items };
		}

		/**
		 * Fetch one board route.
		 * @param {string} route - route name under `/plan-board/`.
		 * @param {string} workspace - absolute workspace path.
		 * @param {Record<string, string>} [extra] - extra query parameters.
		 * @returns {Promise<any>} parsed payload.
		 */
		function fetchRoute(route, workspace, extra) {
			const query = new URLSearchParams({ path: workspace, ...(extra ?? {}) });
			return fetch(`plan-board/${route}?${query.toString()}`, {
				headers: { accept: 'application/json' },
				cache: 'no-store',
			}).then(async (response) => {
				const body = await response.json().catch(() => null);
				if (!response.ok) {
					throw new Error(body?.error ?? `HTTP ${response.status}`);
				}
				return body;
			});
		}

		/**
		 * POST one board route with a bounded JSON body.
		 * @param {string} route - route name under `/plan-board/`.
		 * @param {string} workspace - absolute workspace path.
		 * @param {Record<string, string>} params - query parameters.
		 * @param {Record<string, unknown>} body - JSON body.
		 * @returns {Promise<any>} parsed payload.
		 */
		function postRoute(route, workspace, params, body) {
			const query = new URLSearchParams({ path: workspace, ...params });
			return fetch(`plan-board/${route}?${query.toString()}`, {
				method: 'POST',
				headers: { accept: 'application/json', 'content-type': 'application/json' },
				body: JSON.stringify(body),
				cache: 'no-store',
			}).then(async (response) => {
				const payload = await response.json().catch(() => null);
				if (!response.ok) {
					throw new Error(payload?.message ?? payload?.error ?? `HTTP ${response.status}`);
				}
				return payload;
			});
		}

		/**
		 * Open a conversation in the GUI's own session view. Resolved lazily on
		 * every click: `uiWorkspace` is the navigation owner, and the older
		 * `sessions.open` selector is only used while that runtime still ships it.
		 * @param {{ get: Function }} ctx - client context.
		 * @param {string} sessionId - bound session.
		 * @returns {Promise<'opened' | 'archived' | 'missing' | 'unavailable'>} outcome.
		 */
		async function jumpToSession(ctx, sessionId) {
			const read = (name) => {
				try {
					return ctx?.get?.(name);
				} catch {
					return undefined;
				}
			};
			const sessions = read('sessions');
			const ui = read('uiWorkspace');
			try {
				if (typeof ui?.openSession === 'function') {
					ui.openSession(sessionId);
					return 'opened';
				}
				if (typeof sessions?.open === 'function') {
					sessions.open(sessionId);
					return 'opened';
				}
				if (sessions?.list?.getSnapshot === undefined) return 'unavailable';
				if (sessions.list.getSnapshot().byId?.[sessionId] === undefined) {
					await sessions.refresh?.();
					if (sessions.list.getSnapshot().byId?.[sessionId] === undefined) return 'missing';
				}
				const archived = read('workspaces')?.list?.getSnapshot?.().archivedSessionIds ?? [];
				return archived.includes(sessionId) ? 'archived' : 'unavailable';
			} catch {
				return 'unavailable';
			}
		}

		/**
		 * Render a plan's status block with the only inline markdown that appears
		 * there: **bold**, `code`, and [text](href).
		 * @param {string} text - one status line.
		 * @returns {import('react').ReactNode[]} nodes.
		 */
		function inlineMarkdown(text) {
			const nodes = [];
			const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
			let last = 0;
			let match;
			let index = 0;
			while ((match = pattern.exec(text)) !== null) {
				if (match.index > last) nodes.push(text.slice(last, match.index));
				index += 1;
				if (match[1] !== undefined) {
					nodes.push(h('b', { key: `b${index}` }, match[1]));
				} else if (match[2] !== undefined) {
					nodes.push(h('code', { key: `c${index}` }, match[2]));
				} else {
					nodes.push(h('a', {
						key: `a${index}`,
						href: match[4],
						target: '_blank',
						rel: 'noreferrer',
						style: { color: 'var(--dsw-alias-brand-primary)' },
					}, match[3]));
				}
				last = match.index + match[0].length;
			}
			if (last < text.length) nodes.push(text.slice(last));
			return nodes;
		}

		/**
		 * Health tone for a card badge.
		 * @param {string} health - level.
		 * @returns {string} tone name.
		 */
		function healthTone(health) {
			if (health === 'error') return 'error';
			if (health === 'warn') return 'warn';
			if (health === 'ok') return 'ok';
			return '';
		}

		/**
		 * One plan card.
		 * @param {{ card: object, onOpen: (slug: string) => void, tr: Function, selected: string | null }} props -
		 *   card, opener, translator, selected slug.
		 * @returns {import('react').ReactElement} card element.
		 */
		function PlanCard({ card, onOpen, tr, selected, discussion }) {
			const flagged = discussion?.pending > 0 || discussion?.running === true;
			const tone = card.archived === true ? '' : healthTone(card.health);
			const hue = tone === 'error' ? 'var(--dsw-alias-state-error-primary)'
				: tone === 'warn' ? 'var(--dsw-alias-state-warn-primary)'
					: tone === 'ok' ? 'var(--dsw-alias-state-success-primary)'
						: 'var(--dsw-alias-border-l2)';
			const latest = (card.recentProgress ?? [])[(card.recentProgress ?? []).length - 1];
			return h('div', {
				className: 'pb-card',
				'data-selected': String(selected === card.slug),
				onClick: () => onOpen(card.slug),
				role: 'button',
				tabIndex: 0,
				'aria-label': card.title,
				onKeyDown: (event) => {
					if (event.target !== event.currentTarget) return;
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						onOpen(card.slug);
					}
				},
			}, [
				h('span', { key: 'bar', className: 'pb-bar', style: { background: hue } }),
				h('div', { key: 'name', className: 'pb-name', title: card.title }, card.title),
				h('div', { key: 'slug', className: 'pb-slug', title: card.slug }, card.slug),
				card.archived !== true && latest !== undefined
					? h('div', { key: 'latest', className: 'pb-latest', title: `${latest.date} ${latest.heading}` }, [
						h('span', { key: 'd', className: 'pb-latest-date' }, latest.date.slice(5)),
						h('span', { key: 't', className: 'pb-latest-text' }, latest.heading),
					])
					: null,
				h('div', { key: 'row', className: 'pb-row' }, [
					card.archived === true
						? h('span', { key: 'h', className: 'pb-badge' }, tr('card.archived', { n: card.archivedDays ?? '?' }))
						: h('span', {
							key: 'h',
							className: 'pb-badge',
							'data-tone': tone,
							title: tr(`idle.${card.idleSource ?? 'unknown'}`),
						}, `${tr(`health.${card.health}`)} ${tr('card.idle', { n: card.idleDays ?? '?' })}`),
					card.headerMismatch === true
						? h('span', { key: 'm', className: 'pb-badge', 'data-tone': 'warn' }, tr('card.mismatch'))
						: null,
					card.archived === true
						? null
						: h('span', { key: 'p', className: 'pb-badge' }, tr('card.progress', { n: card.progressCount })),
					flagged
						? h('span', {
							key: 'disc', className: 'pb-badge-dot', 'data-run': String(discussion?.running === true),
							title: discussion?.running === true
								? tr('disc.running')
								: tr('disc.pending', { n: discussion?.pending ?? 0 }),
						}, discussion?.running === true ? '…' : String(discussion?.pending ?? 0))
						: null,
				]),
				(card.mergeRequests ?? []).length > 0
					? h('div', { key: 'mr', className: 'pb-row' },
						card.mergeRequests.slice(0, 3).map((merge, index) =>
							h('span', { key: `mr${index}`, className: 'pb-mr' }, `!${merge.num}`)))
					: null,
				(card.repositories ?? []).length > 0
					? h('div', { key: 'repos', className: 'pb-row' }, [
						h('span', { key: 'r', className: 'pb-badge', 'data-tone': 'brand' },
							card.repositories.slice(0, 2).join(' · ')),
						card.repositories.length > 2
							? h('span', { key: 'n', className: 'pb-badge' }, `+${card.repositories.length - 2}`)
							: null,
					])
					: null,
			]);
		}

		/**
		 * Board view: one column per stage. Filtering and sorting happen once above
		 * this view; archive expansion only limits rendering, never the real count.
		 */
		function BoardView({ board, cards, tr, onOpen, selected, filtering, archivedOpen,
			archivedShowAll, toggleArchived, toggleArchivedAll, onClearFilters, discussionFlags }) {
			if (filtering && cards.length === 0) {
				return h('div', { className: 'pb-filterempty' }, [
					h('span', { key: 't' }, tr('empty.noMatches')),
					h('button', { key: 'b', type: 'button', className: 'pb-more', onClick: onClearFilters },
						tr('action.clearFilters')),
				]);
			}
			return h('div', { className: 'pb-board' }, board.wip.columns.map((column) => {
				const items = cards.filter((card) => card.stage === column.key);
				const archived = column.key === 'archived';
				const collapsed = archived && !filtering && !archivedOpen;
				if (collapsed) {
					return h('div', { key: column.key, className: 'pb-col', 'data-collapsed': 'true' }, [
						h('div', { key: 'head', className: 'pb-colhead' }, [
							h('span', { key: 'd', className: 'pb-dot', style: { background: STAGE_HUE[column.key] } }),
							h('span', { key: 't', className: 'pb-coltitle' }, tr(`stage.${column.key}`)),
							h('span', { key: 'n', className: 'pb-coln' }, items.length),
						]),
						h('button', {
							key: 'more',
							type: 'button',
							className: 'pb-more',
							onClick: toggleArchived,
							'aria-expanded': false,
						}, `${tr('action.expand')} ${items.length}`),
					]);
				}
				const shown = archived ? limitArchivedCards(items, filtering, archivedShowAll) : items;
				return h('div', {
					key: column.key,
					className: 'pb-col',
					'data-wip': column.wip,
				}, [
					h('div', { key: 'head', className: 'pb-colhead' }, [
						h('span', { key: 'd', className: 'pb-dot', style: { background: STAGE_HUE[column.key] } }),
						h('span', { key: 't', className: 'pb-coltitle', title: tr(`stageHint.${column.key}`) }, tr(`stage.${column.key}`)),
						h('span', { key: 'n', className: 'pb-coln' }, items.length),
					]),
					h('div', { key: 'body', className: 'pb-colbody' }, shown.length === 0
						? h('div', { className: 'pb-empty' },
							column.key === 'doing' ? tr('empty.doing') : tr('empty.column'))
						: shown.map((card) => h(PlanCard, {
							key: card.slug, card, tr, onOpen, selected,
							discussion: discussionFlags?.[card.slug],
						}))),
					archived && !filtering
						? h('div', { key: 'actions', className: 'pb-colactions' }, [
							items.length > ARCHIVED_SHOWN
								? h('button', { key: 'all', type: 'button', className: 'pb-more', onClick: toggleArchivedAll },
									archivedShowAll
										? tr('action.showLess', { n: ARCHIVED_SHOWN })
										: tr('action.expandAll', { n: items.length - ARCHIVED_SHOWN }))
								: null,
							h('button', {
								key: 'collapse', type: 'button', className: 'pb-more', onClick: toggleArchived,
								'aria-expanded': true,
							}, tr('action.collapse')),
						])
						: null,
				]);
			}));
		}

		/**
		 * Timeline view: one row per plan, bars spanning first→last progress.
		 * @param {{ board: object, tr: Function, onOpen: Function, today: string }} props - inputs.
		 * @returns {import('react').ReactElement} view.
		 */
		function TimelineView({ board, tr, onOpen, today }) {
			const rows = board.cards
				.filter((card) => card.firstProgressDate !== null || card.headerStatusDate !== null)
				.sort((a, b) => (a.archived === b.archived
					? latestCardDate(b).localeCompare(latestCardDate(a)) || a.slug.localeCompare(b.slug)
					: a.archived ? 1 : -1));
			if (rows.length === 0) {
				return h('div', { className: 'pb-loading' }, tr('empty.noPlans'));
			}
			const dates = rows.flatMap((card) => [card.firstProgressDate, card.lastProgressDate,
				card.headerStatusDate, today]).filter(Boolean);
			// Move the axis start back for short ranges instead of only enlarging the
			// denominator. A single-day plan now gets a real 14-day axis and today
			// remains on the right, with ticks across the whole window.
			const { startTime: t0, endTime: t1, span } = timelineWindow(dates, today);
			const pct = (date) => ((Date.parse(`${date}T00:00:00Z`) - t0) / span) * 100;

			const ticks = [];
			const cursor = new Date(t0);
			while (cursor.getTime() <= t1) {
				const x = ((cursor.getTime() - t0) / span) * 100;
				ticks.push({ x, label: `${cursor.getUTCMonth() + 1}/${cursor.getUTCDate()}` });
				cursor.setUTCDate(cursor.getUTCDate() + 7);
			}
			const todayX = pct(today);

			return h('div', { className: 'pb-tl' }, [
				h('div', { key: 'hint', className: 'pb-tl-hint' }, tr('timeline.hint')),
				...rows.map((card) => {
					const from = card.firstProgressDate ?? card.headerStatusDate ?? today;
					const to = card.lastProgressDate ?? card.headerStatusDate ?? from;
					const left = Math.max(0, Math.min(100, pct(from)));
					const right = Math.max(left, Math.min(100, pct(to)));
					const width = Math.max(right - left, Math.min(0.8, 100 - left));
					return h('div', { key: `row-${card.slug}`, className: 'pb-tl-row' }, [
						h('div', { key: 'n', className: 'pb-tl-name', title: card.slug }, card.title),
						h('div', { key: 't', className: 'pb-tl-track' }, [
							h('div', {
								key: 'bar',
								className: 'pb-tl-bar',
								'data-done': String(card.archived === true),
								style: { left: `${left}%`, width: `${width}%` },
								title: `${card.slug}  ${from} → ${to}  (${card.progressCount})`,
								onClick: () => onOpen(card.slug),
								role: 'button',
								tabIndex: 0,
								'aria-label': card.title,
								onKeyDown: (event) => {
									if (event.key === 'Enter' || event.key === ' ') {
										event.preventDefault();
										onOpen(card.slug);
									}
								},
							}),
							...card.recentProgress.map((entry, index) => h('div', {
								key: `pt${index}`,
								className: 'pb-tl-pt',
								style: { left: `${pct(entry.date)}%` },
								title: `${entry.date} ${entry.heading}`,
							})),
						]),
					]);
				}),
				h('div', { key: 'axis', className: 'pb-tl-axis' }, [
					h('div', { key: 'sp' }),
					h('div', { key: 'ticks', className: 'pb-tl-ticks' }, [
						h('div', { key: 'today', className: 'pb-tl-today', style: { left: `${todayX}%` } }),
						h('div', { key: 'todayl', className: 'pb-tl-today-l', style: { left: `${todayX}%` } },
							tr('timeline.today')),
						...ticks.map((tick, index) => h('div', {
							key: `tk${index}`,
							className: 'pb-tl-tick',
							style: { left: `${tick.x}%` },
						}, tick.label)),
					]),
				]),
			]);
		}

		/**
		 * Cadence view: the workspace's own rhythm snapshot.
		 * @param {{ cadence: any, board: object, tr: Function }} props - inputs.
		 * @returns {import('react').ReactElement} view.
		 */
		function CadenceView({ cadence, board, tr }) {
			if (cadence === null) return h('div', { className: 'pb-loading' }, '…');
			if (cadence.found !== true) {
				return h('div', { className: 'pb-cad' }, [
					h('h3', { key: 't' }, tr('cadence.missing')),
					h('div', { key: 'hint', className: 'pb-hint' }, tr('cadence.missingHint')),
				]);
			}
			if (cadence.error !== undefined) {
				return h('div', { key: 'e', className: 'pb-error' }, cadence.error);
			}
			const nodes = [];
			if (cadence.stale === true) {
				nodes.push(h('div', { key: 'stale', className: 'pb-note' },
					tr('cadence.stale', { n: cadence.ageDays ?? '?' })));
			}
			nodes.push(h('div', { key: 'kv', className: 'pb-kv' }, [
				h('div', { key: 'a', className: 'pb-kvc' }, [
					h('div', { key: 'k', className: 'pb-k' }, tr('count.today')),
					h('div', { key: 'v', className: 'pb-v' }, board.counts.progressedToday),
				]),
				h('div', { key: 'b', className: 'pb-kvc' }, [
					h('div', { key: 'k', className: 'pb-k' }, tr('cadence.prompts')),
					h('div', { key: 'v', className: 'pb-v' }, cadence.totalInputs ?? '—'),
				]),
				h('div', { key: 'c', className: 'pb-kvc' }, [
					h('div', { key: 'k', className: 'pb-k' }, tr('cadence.activeDays')),
					h('div', { key: 'v', className: 'pb-v' }, cadence.activeDays ?? '—'),
				]),
				h('div', { key: 'd', className: 'pb-kvc' }, [
					h('div', { key: 'k', className: 'pb-k' }, tr('count.live')),
					h('div', { key: 'v', className: 'pb-v' }, board.counts.live,
						h('small', { key: 's' }, `/${board.wip.limit}`)),
				]),
			]));

			if ((cadence.heat ?? []).length > 0) {
				const max = cadence.heatMax || 1;
				const columns = `52px repeat(${cadence.hours.length},minmax(0,1fr))`;
				const cells = [h('div', { key: 'corner', className: 'pb-hd' })];
				cadence.hours.forEach((hour) => cells.push(h('div', {
					key: `h${hour}`,
					className: 'pb-hc',
				}, String(hour).padStart(2, '0'))));
				cadence.heat.forEach((row) => {
					cells.push(h('div', { key: `d-${row.date}`, className: 'pb-hd' }, row.date.slice(5)));
					row.cells.forEach((value, index) => {
						const step = value === 0 ? 0
							: value <= max * 0.15 ? 1
								: value <= max * 0.35 ? 2
									: value <= max * 0.65 ? 3 : 4;
						cells.push(h('div', {
							key: `c-${row.date}-${index}`,
							className: 'pb-cell',
							'data-s': String(step),
							title: `${row.date} ${String(cadence.hours[index]).padStart(2, '0')}:00 — ${value}`,
						}));
					});
				});
				nodes.push(h('h3', { key: 'heath' }, tr('cadence.heat')));
				nodes.push(h('div', { key: 'heathint', className: 'pb-hint' }, tr('cadence.heatHint')));
				nodes.push(h('div', {
					key: 'heat',
					className: 'pb-heat',
					style: { gridTemplateColumns: columns, maxWidth: `${Math.max(560, cadence.heat.length * 26)}px` },
				}, cells));
			}

			if ((cadence.weekly ?? []).length > 0) {
				const maxPrompts = Math.max(1, ...cadence.weekly.map((week) => week.prompts));
				const maxDone = Math.max(1, ...cadence.weekly.map((week) => week.donePlans));
				nodes.push(h('h3', { key: 'wh' }, tr('cadence.weekly')));
				nodes.push(h('div', { key: 'whint', className: 'pb-hint' }, tr('cadence.weeklyHint')));
				nodes.push(h('div', { key: 'wl', className: 'pb-legend' }, [
					h('span', { key: 'p' }, [
						h('i', { key: 'i', style: { background: 'var(--dsw-alias-brand-primary)' } }),
						tr('cadence.legendPrompts'),
					]),
					h('span', { key: 'd' }, [
						h('i', { key: 'i', style: { background: 'var(--dsw-alias-state-success-primary)' } }),
						tr('cadence.legendDone'),
					]),
				]));
				nodes.push(h('div', { key: 'wb', className: 'pb-wbars' }, cadence.weekly.map((week) =>
					h('div', { key: week.isoWeek, className: 'pb-wcol' }, [
						h('div', { key: 's', className: 'pb-wstack' }, [
							h('div', {
								key: 'p',
								className: 'pb-wbar',
								'data-k': 'prompts',
								style: {
									height: `${(week.prompts / maxPrompts) * 100}%`,
									minHeight: week.prompts > 0 ? '2px' : '0',
								},
								title: `${week.isoWeek} prompts ${week.prompts}`,
							}),
							h('div', {
								key: 'd',
								className: 'pb-wbar',
								'data-k': 'done',
								style: {
									height: `${(week.donePlans / maxDone) * 100}%`,
									minHeight: week.donePlans > 0 ? '2px' : '0',
								},
								title: `${week.isoWeek} finished ${week.donePlans}`,
							}),
						]),
						h('div', { key: 'l', className: 'pb-wl' }, week.isoWeek.replace(/^\d{4}-/, '')),
					]))));
			}

			if ((cadence.facts ?? []).length > 0) {
				nodes.push(h('h3', { key: 'fh' }, tr('cadence.facts')));
				cadence.facts.forEach((fact, index) => nodes.push(h('div', {
					key: `f${index}`,
					className: 'pb-note',
				}, [h('b', { key: 'b' }, `${fact.conclusion}：`), fact.evidence])));
			}
			if ((cadence.vocab ?? []).length > 0) {
				nodes.push(h('h3', { key: 'vh' }, tr('cadence.vocab')));
				nodes.push(h('div', { key: 'v', className: 'pb-vocab' }, cadence.vocab.slice(0, 14).map((entry, index) =>
					h('div', { key: `vc${index}`, className: 'pb-v' }, [
						entry.label,
						h('b', { key: 'n' }, entry.count),
					]))));
			}
			return h('div', { className: 'pb-cad' }, nodes);
		}

		/**
		 * The plan's conversation with its DSH agent.
		 *
		 * Two explicit user actions: "comment only" records to the board store and
		 * wakes nothing; "send & wake" delivers every pending comment as ONE user
		 * message to the bound session (creating one on first use). A failed send
		 * keeps the comments pending so the retry cannot lose text.
		 * @param {{ detail: any, workspace: string, tr: Function, onPendingChange: Function }} props - inputs.
		 * @returns {import('react').ReactElement} conversation panel.
		 */
		function DiscussionPanel({ detail, workspace, tr, onPendingChange, onSession }) {
			const slug = detail.slug;
			const [state, setState] = React.useState({ loading: true, data: null, error: null });
			const [draft, setDraft] = React.useState('');
			const [busy, setBusy] = React.useState(null);
			const [notice, setNotice] = React.useState(null);
			const requestRef = React.useRef(0);

			const load = React.useCallback(() => {
				const request = ++requestRef.current;
				fetchRoute('discussion', workspace, { slug })
					.then((payload) => {
						if (request !== requestRef.current) return;
						setState({ loading: false, data: payload, error: null });
						onPendingChange(payload.pending ?? 0, payload.running === true);
					})
					.catch((cause) => {
						if (request !== requestRef.current) return;
						setState({ loading: false, data: null, error: cause instanceof Error ? cause.message : String(cause) });
					});
			}, [workspace, slug, onPendingChange]);

			React.useEffect(() => {
				load();
				return () => {
					requestRef.current += 1;
				};
			}, [load]);

			const data = state.data;
			const running = data?.running === true;

			// A delivered turn settles on the host; poll only while it does, so the
			// agent reply shows up without the reader having to refresh the board.
			React.useEffect(() => {
				if (!running) return undefined;
				const timer = setInterval(load, 3000);
				return () => clearInterval(timer);
			}, [running, load]);

			const submit = (action) => {
				const text = draft.trim();
				if (busy !== null) return;
				if (action === 'deliver' && !running && data?.available === false) return;
				if (text === '' && !(action === 'deliver' && (data?.pending ?? 0) > 0)) return;
				setBusy(action);
				setNotice(null);
				postRoute('discussion', workspace, { slug }, { action, body: text })
					.then((payload) => {
						if (action === 'deliver') {
							setDraft('');
							setState({ loading: false, data: payload.discussion ?? data, error: null });
							onPendingChange(payload.discussion?.pending ?? 0, payload.discussion?.running === true);
							setNotice({ tone: 'ok', text: tr('disc.sent', { n: payload.count ?? 0 }) });
						} else {
							setDraft('');
							setState({ loading: false, data: payload, error: null });
							onPendingChange(payload.pending ?? 0, payload.running === true);
							setNotice({ tone: 'ok', text: tr('disc.saved') });
						}
					})
					.catch((cause) => {
						setNotice({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause) });
					})
					.finally(() => setBusy(null));
			};

			const jump = async () => {
				if (data?.sessionId === undefined || data.sessionId === null) return;
				const outcome = await jumpToSession(ctxRef.current, data.sessionId);
				if (outcome === 'opened') {
					onSession?.(data.sessionId);
					setNotice({ tone: 'ok', text: tr('disc.jumpOpened') });
					return;
				}
				setNotice({
					tone: 'error',
					text: tr(outcome === 'archived' ? 'disc.jumpArchived'
						: outcome === 'missing' ? 'disc.jumpMissing' : 'disc.jumpUnavailable',
					{ id: String(data.sessionId).slice(0, 12) }),
				});
			};

			const messages = h('div', {
				key: 'msgs', className: 'pb-msgs', role: 'log', 'aria-live': 'polite',
			}, data === null || data.comments.length === 0
				? [h('div', { key: 'empty', className: 'pb-disc-hint' }, tr('disc.empty'))]
				: data.comments.map((comment) => h('div', {
					key: comment.id, className: 'pb-msg', 'data-author': comment.author,
				}, [
					h('div', { key: 'head', className: 'pb-msg-head' }, [
						h('b', { key: 'who' }, tr(comment.author === 'user' ? 'disc.authorUser'
							: comment.author === 'agent' ? 'disc.authorAgent' : 'disc.authorSystem')),
						h('span', { key: 'when' }, new Date(comment.createdAt).toLocaleString()),
						comment.author === 'user' && comment.deliveredAt === undefined
							? h('span', { key: 'pending', className: 'pb-unread' }, tr('disc.pending', { n: 1 }))
							: null,
					]),
					h('div', { key: 'body' }, comment.body),
				])));

			return h('div', { key: 'disc', className: 'pb-sec', 'data-kind': 'discussion' }, [
				h('div', { key: 'st', className: 'pb-st' }, tr('disc.title')),
				h('div', { key: 'wrap', className: 'pb-disc' }, [
					h('div', { key: 'hint', className: 'pb-disc-hint' }, tr('disc.hint')),
					state.loading
						? h('div', { key: 'loading', className: 'pb-loading' }, tr('panel.loading'))
						: null,
					state.error !== null
						? h('div', { key: 'err', className: 'pb-error' }, state.error)
						: null,
					data !== null
						? h('div', { key: 'meta', className: 'pb-disc-meta' }, [
							h('span', { key: 's' }, data.sessionId === null
								? tr('disc.noSession')
								: tr('disc.session', { id: String(data.sessionId).slice(0, 12) })),
							data.sessionId !== null
								? h('button', { key: 'j', type: 'button', onClick: jump }, tr('disc.openSession'))
								: null,
							data.pending > 0
								? h('span', { key: 'p', style: { color: 'var(--dsw-alias-brand-primary)' } },
									tr('disc.pending', { n: data.pending }))
								: null,
							running ? h('span', { key: 'r', style: { color: 'var(--dsw-alias-state-warn-primary)' } },
								tr('disc.running')) : null,
						])
						: null,
					messages,
					h('div', { key: 'composer', className: 'pb-composer' }, [
						h('textarea', {
							key: 'ta',
							value: draft,
							placeholder: tr('disc.placeholder'),
							'aria-label': tr('disc.placeholder'),
							maxLength: 4000,
							disabled: detail.archived === true,
							onChange: (event) => setDraft(event.target.value),
							onKeyDown: (event) => {
								if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
									event.preventDefault();
									submit('deliver');
								}
							},
						}),
						h('div', { key: 'row', className: 'pb-composer-row' }, [
							h('button', {
								key: 'c', type: 'button', className: 'pb-ghost',
								disabled: busy !== null || draft.trim() === '' || detail.archived === true,
								onClick: () => submit('comment'),
							}, busy === 'comment' ? tr('disc.sending') : tr('disc.comment')),
							h('button', {
								key: 'd', type: 'button', className: 'pb-ghost',
								'data-on': 'true',
								disabled: busy !== null
									|| detail.archived === true
									|| (draft.trim() === '' && (data?.pending ?? 0) === 0)
									|| (running === false && data?.available === false),
								title: data?.available === false ? tr('disc.unavailable') : undefined,
								onClick: () => submit('deliver'),
							}, busy === 'deliver' ? tr('disc.sending')
								: tr('disc.deliver')),
							detail.archived === true
								? h('span', { key: 'a', className: 'pb-notice' }, tr('disc.archived'))
								: null,
							notice !== null
								? h('span', { key: 'n', className: 'pb-notice', 'data-tone': notice.tone }, notice.text)
								: null,
						]),
					]),
				]),
			]);
		}

		/**
		 * Read-only viewer for one plan or evidence file.
		 *
		 * Replaces "copy this path and go find it yourself": the content is one
		 * click away, served by the host's confined `/plan-board/file` route, and
		 * the path is still copyable for anyone who needs it in a terminal.
		 * @param {{ workspace: string, slug: string, kind: string, name: string, tr: Function, onClose: Function }} props - inputs.
		 * @returns {import('react').ReactElement} viewer body.
		 */
		function FileViewer({ workspace, slug, kind, name, tr, onClose }) {
			const [state, setState] = React.useState({ loading: true, data: null, error: null });
			const requestRef = React.useRef(0);

			React.useEffect(() => {
				const request = ++requestRef.current;
				const params = { kind, slug, ...(kind === 'evidence' ? { name } : {}) };
				fetchRoute('file', workspace, params)
					.then((payload) => {
						if (request === requestRef.current) setState({ loading: false, data: payload, error: null });
					})
					.catch((cause) => {
						if (request === requestRef.current) {
							setState({ loading: false, data: null, error: cause instanceof Error ? cause.message : String(cause) });
						}
					});
				return () => {
					requestRef.current += 1;
				};
			}, [workspace, slug, kind, name]);

			if (state.loading) {
				return h('div', { className: 'pb-loading' }, tr('view.fileLoading'));
			}
			if (state.error !== null) {
				return h('div', { className: 'pb-error' }, state.error);
			}
			const data = state.data;
			return h('div', { className: 'pb-fileview' }, [
				h('div', { key: 'bar', className: 'pb-filebar' }, [
					h('code', { key: 'p', title: data.file }, data.file),
					h('button', {
						key: 'b', type: 'button', className: 'pb-ghost', onClick: onClose,
					}, tr('view.backToPlan')),
				]),
				data.truncated === true
					? h('div', { key: 't', className: 'pb-note' }, tr('view.fileTruncated', { n: 512 }))
					: null,
				h('pre', { key: 'text', className: 'pb-filetext' }, data.text),
			]);
		}

		/**
		 * Cross-plan conversation search backed by the derived SQLite index.
		 *
		 * This is the one view the JSON store cannot serve cheaply: hits are
		 * ranked by recency across every plan, and `mode=pending` answers "which
		 * plans are waiting on me". When the index is unavailable the panel says
		 * so and keeps working — the comments themselves live in the JSON truth.
		 * @param {{ workspace: string, tr: Function, onOpen: Function, onPendingChange: Function }} props - inputs.
		 * @returns {import('react').ReactElement} view.
		 */
		function SearchView({ workspace, tr, onOpen, onPendingChange }) {
			const [query, setQuery] = React.useState('');
			const [scopeAll, setScopeAll] = React.useState(true);
			const [pendingOnly, setPendingOnly] = React.useState(false);
			const [state, setState] = React.useState({ loading: true, data: null, error: null });
			const requestRef = React.useRef(0);
			const [debounced, setDebounced] = React.useState('');

			// Typing must not fire a query per keystroke.
			React.useEffect(() => {
				const timer = setTimeout(() => setDebounced(query), 220);
				return () => clearTimeout(timer);
			}, [query]);

			const load = React.useCallback(() => {
				const request = ++requestRef.current;
				const params = {
					q: debounced,
					scope: scopeAll ? 'all' : 'workspace',
					...(pendingOnly ? { pending: '1' } : {}),
				};
				const search = new URLSearchParams({ path: workspace, ...params });
				fetch(`plan-board/search?${search.toString()}`, {
					headers: { accept: 'application/json' },
					cache: 'no-store',
				})
					.then(async (response) => {
						const body = await response.json().catch(() => null);
						if (!response.ok) throw new Error(body?.message ?? `HTTP ${response.status}`);
						return body;
					})
					.then((payload) => {
						if (request !== requestRef.current) return;
						setState({ loading: false, data: payload, error: null });
					})
					.catch((cause) => {
						if (request !== requestRef.current) return;
						setState({ loading: false, data: null, error: cause instanceof Error ? cause.message : String(cause) });
					});
			}, [workspace, debounced, scopeAll, pendingOnly]);

			React.useEffect(() => {
				load();
				return () => {
					requestRef.current += 1;
				};
			}, [load]);

			const data = state.data;
			const rows = data?.rows ?? [];
			const unavailable = data !== null && data.available === false;

			return h('div', { className: 'pb-search' }, [
				h('div', { key: 'bar', className: 'pb-searchbar' }, [
					h('input', {
						key: 'q',
						className: 'pb-input pb-searchinput',
						value: query,
						placeholder: tr('search.placeholder'),
						'aria-label': tr('search.placeholder'),
						onChange: (event) => setQuery(event.target.value),
					}),
					h('button', {
						key: 'scope', type: 'button', className: 'pb-chip',
						'data-on': String(scopeAll), 'aria-pressed': scopeAll,
						onClick: () => setScopeAll((value) => !value),
					}, scopeAll ? tr('search.scope.all') : tr('search.scope.workspace')),
					h('button', {
						key: 'pending', type: 'button', className: 'pb-chip',
						'data-on': String(pendingOnly), 'aria-pressed': pendingOnly,
						onClick: () => setPendingOnly((value) => !value),
					}, tr('search.pendingOnly')),
					data !== null && data.available === true
						? h('span', { key: 'n', className: 'pb-hint' }, tr('search.hits', { n: rows.length }))
						: null,
				]),
				unavailable
					? h('div', { key: 'na', className: 'pb-note' },
						tr('search.unavailable', { reason: data.reason ?? '—' }))
					: null,
				state.loading ? h('div', { key: 'l', className: 'pb-loading' }, tr('panel.loading')) : null,
				state.error !== null
					? h('div', { key: 'e', className: 'pb-error' }, state.error)
					: null,
				data !== null && data.available === true && rows.length === 0
					? h('div', { key: 'empty', className: 'pb-loading' }, tr('search.empty'))
					: null,
				rows.map((row, index) => h('div', {
					key: row.id ?? `r${index}`, className: 'pb-hit',
				}, [
					h('div', { key: 'head', className: 'pb-hithead' }, [
						h('button', {
							key: 'open', type: 'button', className: 'pb-hitplan',
							onClick: () => {
								onPendingChange?.(row.slug, { pending: 0, running: false });
								onOpen(row.slug);
							},
						}, row.slug),
						h('span', { key: 'who', className: 'pb-hitmeta' },
							tr(row.author === 'user' ? 'disc.authorUser'
								: row.author === 'agent' ? 'disc.authorAgent' : 'disc.authorSystem')),
						h('span', { key: 'when', className: 'pb-hitmeta' },
							new Date(row.created_at ?? row.createdAt ?? 0).toLocaleString()),
						row.delivered_at === null || row.delivered_at === undefined
							? h('span', { key: 'p', className: 'pb-badge', 'data-tone': 'warn' }, tr('search.pendingTag'))
							: h('span', { key: 'd', className: 'pb-hitmeta' }, tr('search.delivered')),
					]),
					h('div', { key: 'body', className: 'pb-hitbody' }, row.body),
				])),
			]);
		}

		/**
		 * One plan's drawer.
		 * @param {{ detail: any, tr: Function, onClose: Function }} props - inputs.
		 * @returns {import('react').ReactElement | null} drawer.
		 */
		function PlanDrawer({ detail, tr, onClose, workspace, onPendingChange, onSession }) {
			const closeRef = React.useRef(null);
			const [copyState, setCopyState] = React.useState({ path: null, error: false });
			const [tab, setTab] = React.useState('detail');
			/** Which slice of the detail page is showing: the plan's words, or its facts. */
			const [detailTab, setDetailTab] = React.useState('content');
			/** `{ kind, name }` of the file open in the viewer, or null for the plain drawer. */
			const [viewing, setViewing] = React.useState(null);
			const [evidencePage, setEvidencePage] = React.useState(0);
			const [pending, setPending] = React.useState({ count: 0, running: false });
			// The panel owns a new closure on every render, so a dependency on it would
			// re-fetch the conversation in a loop; the slug is what actually changes.
			const reportRef = React.useRef(onPendingChange);
			reportRef.current = onPendingChange;
			const reportPending = React.useCallback((count, running) => {
				setPending({ count, running });
				reportRef.current?.(detail?.slug ?? '', { pending: count, running });
			}, [detail?.slug]);
			React.useEffect(() => {
				setViewing(null);
				setDetailTab('content');
				setEvidencePage(0);
				setCopyState({ path: null, error: false });
				// Missing counts leave the conversation signal alone; a real reply or a
				// queued comment always repaints it.
				if (detail?.pending !== undefined || detail?.running !== undefined) {
					setPending({ count: detail.pending ?? 0, running: detail.running === true });
				}
				if (detail !== null) closeRef.current?.focus();
			}, [detail?.slug]);
			if (detail === null) return null;
			const tabBar = (detail.loading === true || detail.error !== undefined) ? null : h('div', {
				key: 'tabs', className: 'pb-dback', role: 'tablist',
			}, [
				...[
					['detail', tr('disc.tabDetail')],
					['discussion', tr('disc.tabDiscussion')],
				].map(([key, label]) => h('button', {
					key, type: 'button', role: 'tab', className: 'pb-tab',
					'data-on': String(tab === key), 'aria-selected': tab === key,
					onClick: () => setTab(key),
				}, [label, key === 'discussion' && (pending.count > 0 || pending.running)
					? h('span', {
						key: 'dot', className: 'pb-badge-dot', 'data-run': String(pending.running),
					}, pending.running ? '…' : String(pending.count))
					: null])),
			]);

			const trapFocus = (event) => {
				if (event.key !== 'Tab') return;
				const items = [...event.currentTarget.querySelectorAll('button:not(:disabled),a[href],[tabindex="0"]')];
				const first = items[0];
				const last = items[items.length - 1];
				if (first === undefined || last === undefined) return;
				if (event.shiftKey && document.activeElement === first) {
					event.preventDefault();
					last.focus();
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault();
					first.focus();
				}
			};
			const frame = (title, slug, body, controls, mode) => h('div', {
				className: 'pb-drawer', role: 'dialog', 'aria-modal': 'true',
				'data-mode': mode ?? 'detail',
				'aria-labelledby': 'pb-drawer-title', onKeyDown: trapFocus,
			}, [
				h('div', { key: 'head', className: 'pb-dhead' }, [
					h('div', { key: 'txt' }, [
						h('div', { key: 't', className: 'pb-dt', id: 'pb-drawer-title' }, title),
						slug !== null ? h('div', { key: 's', className: 'pb-ds' }, slug) : null,
					]),
					controls ?? null,
					h('button', {
						key: 'x', type: 'button', className: 'pb-dx', onClick: onClose,
						title: 'Esc', 'aria-label': tr('action.close'), ref: closeRef,
					}, '×'),
				]),
				h('div', { key: 'body', className: 'pb-dbody' }, body),
			]);
			if (detail.loading === true) {
				return frame(detail.slug, null, [h('div', { key: 'loading', className: 'pb-loading' }, tr('panel.loading'))], tabBar);
			}
			if (detail.error !== undefined) {
				return frame(detail.slug ?? '', null, [h('div', { key: 'e', className: 'pb-error' }, detail.error)], tabBar);
			}

			const copyPath = async (path) => {
				try {
					if (typeof navigator === 'undefined' || navigator.clipboard?.writeText === undefined) {
						throw new Error('clipboard unavailable');
					}
					await navigator.clipboard.writeText(path);
					setCopyState({ path, error: false });
				} catch {
					setCopyState({ path, error: true });
				}
			};
			/**
			 * One clickable file row: the name opens the viewer, the small button
			 * copies the path for anyone who wants it in a terminal.
			 */
			/**
			 * One file row.
			 *
			 * The row's primary action is "open"; copying the path is secondary and
			 * appears on hover/focus only. Twenty identical "复制路径" labels made the
			 * list look like a wall of buttons, and the reserved action column keeps
			 * the rows from shifting when the affordance appears.
			 */
			const pathRow = (path, view) => {
				const name = path.split('/').pop();
				const copied = copyState.path === path;
				const failed = copied && copyState.error;
				return h('div', { key: path, className: 'pb-pathrow', 'data-copied': String(copied) }, [
					h('button', {
						key: 'v', type: 'button', className: 'pb-openrow', title: tr('view.fileOpen'),
						onClick: () => setViewing(view),
					}, h('span', { key: 'n', className: 'pb-fname' }, name)),
					h('button', {
						key: 'c',
						type: 'button',
						className: 'pb-iconbtn',
						title: failed ? tr('action.copyFailed') : tr('view.copyPath'),
						'aria-label': failed ? tr('action.copyFailed') : tr('view.copyPath'),
						'data-error': String(failed),
						onClick: () => copyPath(path),
					}, copied && !failed
						? h('svg', { key: 'ok', viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': true },
							h('path', {
								d: 'M3.5 8.5l3 3 6-6.5', stroke: 'currentColor', 'stroke-width': 1.6,
								'stroke-linecap': 'round', 'stroke-linejoin': 'round',
							}))
						: h('svg', { key: 'cp', viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': true }, [
							h('rect', {
								key: 'a', x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.6,
								stroke: 'currentColor', 'stroke-width': 1.3,
							}),
							h('path', {
								key: 'b', d: 'M10.5 5.5v-1a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4.5v4A1.5 1.5 0 0 0 4 10h1',
								stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round',
							}),
						])),
				]);
			};
			const tone = healthTone(detail.health);
			const mismatch = detail.headerMismatch === true && typeof detail.headerLag === 'number'
				? tr(detail.headerLag > 0 ? 'panel.mismatchProgress' : 'panel.mismatchHeader',
					{ n: Math.abs(detail.headerLag) })
				: null;
			const rows = [
				[tr('panel.stage'), tr(`stage.${detail.stage}`)],
				[tr('panel.reason'), formatStageReason(detail, tr)],
				[tr('panel.health'), tr('panel.healthValue', {
					health: tr(`health.${detail.health}`), n: detail.idleDays ?? '?',
				})],
				[tr('panel.headerDate'), detail.headerStatusDate ?? '—'],
				[tr('panel.lastProgress'), detail.lastProgressDate ?? '—'],
				[tr('panel.progressCount'), String(detail.progressCount)],
				[tr('panel.mtime'), typeof detail.fileMtime === 'string' ? detail.fileMtime.slice(0, 10) : '—'],
			];
			if (mismatch !== null) rows.push([tr('panel.mismatch'), mismatch]);
			const planPath = `doc/plans/${detail.file}`;
			// Layout: a summary strip across the top (what this plan is and where it
			// stands), then two columns — the plan's own words on the left, the
			// derived/operational facts and files on the right. On a narrow window
			// the grid collapses to one column.
			const summary = h('div', { key: 'summary', className: 'pb-summary' }, [
				h('div', { key: 'badges', className: 'pb-summary-badges' }, [
					h('span', {
						key: 'stage', className: 'pb-badge', 'data-tone': 'brand',
					}, tr(`stage.${detail.stage}`)),
					h('span', {
						key: 'health',
						className: 'pb-badge',
						'data-tone': detail.archived === true ? '' : tone,
					}, tr('panel.healthValue', {
						health: tr(`health.${detail.health}`), n: detail.idleDays ?? '?',
					})),
					(detail.mergeRequests ?? []).map((merge, index) => h('a', {
						key: `m${index}`, className: 'pb-badge', 'data-tone': 'brand',
						href: `https://git.woa.com/${merge.repo}/-/merge_requests/${merge.num}`,
						target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none' },
					}, `!${merge.num}`)),
					mismatch !== null
						? h('span', { key: 'mm', className: 'pb-badge', 'data-tone': 'warn' }, tr('card.mismatch'))
						: null,
				]),
				h('div', { key: 'reason', className: 'pb-summary-reason' }, formatStageReason(detail, tr)),
			]);

			// Derived fields are meta, not content: a wrap-friendly strip across the
			// top keeps them visible without spending a column on seven short pairs.
			const derivedStrip = h('div', { key: 'derived', className: 'pb-strip' },
				rows.map(([key, value], index) => h('div', { key: `r${index}`, className: 'pb-cell' }, [
					h('span', { key: 'k', className: 'pb-cellk' }, key),
					h('span', {
						key: 'v', className: 'pb-cellv',
						style: key === tr('panel.health') && tone !== ''
							? { color: `var(--dsw-alias-state-${tone === 'error' ? 'error' : tone === 'warn' ? 'warn' : 'success'}-primary)` }
							: {},
					}, value),
				])));

			const progressCard = h('div', { key: 'prog', className: 'pb-card' }, [
				h('div', { key: 'st', className: 'pb-st' }, tr('panel.recent')),
				(detail.recentProgress ?? []).length === 0
					? h('div', { key: 'none', className: 'pb-para pb-muted' }, tr('panel.noProgress'))
					: h('ol', { key: 'list', className: 'pb-timeline' },
						detail.recentProgress.slice().reverse().map((entry, index) => h('li', {
							key: `p${index}`, className: 'pb-tl-item',
						}, [
							h('span', { key: 'd', className: 'pb-tl-date' }, entry.date),
							h('span', { key: 'h', className: 'pb-tl-text' }, inlineMarkdown(entry.heading)),
						]))),
			]);

			// Files span both columns: a narrow rail turns every long evidence file
			// name into three wrapped lines. A wide grid of chips reads far better.
			const evidence = detail.evidence ?? [];
			const window_ = paginate(evidence.length, evidencePage);
			const pageItems = window_.items.map((index) => evidence[index]);
			const filesCard = h('div', { key: 'files', className: 'pb-card pb-filescard' }, [
				h('div', { key: 'st', className: 'pb-st' }, tr('panel.files')),
				h('div', { key: 'plan', className: 'pb-filegroup' }, [
					h('div', { key: 'l', className: 'pb-filelabel' }, tr('panel.planFile')),
					pathRow(planPath, { kind: 'plan', name: detail.file }),
				]),
				evidence.length > 0
					? h('div', { key: 'evidence', className: 'pb-filegroup' }, [
						h('div', { key: 'l', className: 'pb-filelabel' }, tr('panel.evidenceCount', { n: evidence.length })),
						h('div', { key: 'grid', className: 'pb-files' }, pageItems.map((entry) => pathRow(
							`${detail.evidenceDir}/${entry}`,
							{ kind: 'evidence', name: entry },
						))),
						window_.pages > 1
							? h('div', { key: 'pager', className: 'pb-pager' }, [
								h('button', {
									key: 'prev', type: 'button', className: 'pb-pagebtn',
									disabled: window_.page === 0,
									'onClick': () => setEvidencePage(page - 1),
									'aria-label': tr('action.prevPage'),
								}, '‹'),
								h('span', { key: 'info', className: 'pb-pageinfo' },
									tr('action.pageInfo', {
										page: window_.page + 1,
										total: window_.pages,
										from: window_.from,
										to: window_.to,
										n: evidence.length,
									})),
								h('button', {
									key: 'next', type: 'button', className: 'pb-pagebtn',
									disabled: window_.page >= window_.pages - 1,
									'onClick': () => setEvidencePage(page + 1),
									'aria-label': tr('action.nextPage'),
								}, '›'),
							])
							: null,
					])
					: null,
			]);

			const headerCard = (detail.headerLines ?? []).length > 0
				? h('div', { key: 'block', className: 'pb-card' }, [
					h('div', { key: 'st', className: 'pb-st' }, tr('panel.headerBlock')),
					h('div', { key: 'lines', className: 'pb-prose' }, detail.headerLines.map((line, index) => h('p', {
						key: `l${index}`, className: 'pb-para',
					}, inlineMarkdown(line)))),
				])
				: null;

			// The detail page is split rather than scrolled: "content" holds the plan's
			// own words (long prose, dated progress), "facts" holds derived fields
			// and files. Both are short enough to read without hunting.
			const detailTabs = h('div', { key: 'subtabs', className: 'pb-subtabs', role: 'tablist' }, [
				...[
					['content', tr('panel.tabContent'), (detail.recentProgress ?? []).length],
					['files', tr('panel.tabFiles'), (detail.evidence ?? []).length],
				].map(([key, label, count]) => h('button', {
					key, type: 'button', role: 'tab', className: 'pb-subtab',
					'data-on': String(detailTab === key), 'aria-selected': detailTab === key,
					onClick: () => setDetailTab(key),
				}, [label, count !== null && count > 0
					? h('span', { key: 'c', className: 'pb-subcount' }, String(count))
					: null])),
			]);

			// Each tab owns the full width. Splitting them into shared columns left
			// one side empty on "content" and squeezed the file list on "facts".
			const detailBody = [
				summary,
				derivedStrip,
				detailTabs,
				detailTab === 'files' ? filesCard : [headerCard, progressCard],
			];
			const body = viewing !== null
				? [h(FileViewer, {
					key: `v-${viewing.kind}-${viewing.name}`,
					workspace,
					slug: detail.slug,
					kind: viewing.kind,
					name: viewing.name,
					tr,
					onClose: () => setViewing(null),
				})]
				: tab === 'discussion'
					? [h(DiscussionPanel, {
						key: 'discussion',
						detail,
						workspace,
						tr,
						onPendingChange: reportPending,
						onSession,
					})]
					: detailBody;
			return frame(
				viewing === null ? detail.title : viewing.name,
				viewing === null ? detail.slug : `${detail.slug} · ${viewing.kind}`,
				body,
				tabBar,
				viewing === null ? 'detail' : 'viewer',
			);
		}

		/**
		 * Panel body: header controls, the three views, and the drawer.
		 * @param {{ t?: Function }} props - slot props.
		 * @returns {import('react').ReactElement} panel.
		 */
		function PlanBoardPanel({ t }) {
			const tr = React.useCallback((key, params) => {
				if (typeof t === 'function') return t(key, params);
				return interpolate(zh[key] ?? key, params);
			}, [t]);

			const [workspaces, setWorkspaces] = React.useState(null);
			const [workspace, setWorkspace] = React.useState(() => {
				try {
					return window.localStorage.getItem(STORE_KEY) ?? '';
				} catch {
					return '';
				}
			});
			const [board, setBoard] = React.useState(null);
			const [error, setError] = React.useState(null);
			const [initialPrefs] = React.useState(readBoardPreferences);
			const [view, setView] = React.useState(initialPrefs.view);
			const [sort, setSort] = React.useState(initialPrefs.sort);
			const [repo, setRepo] = React.useState(initialPrefs.repo);
			const [health, setHealth] = React.useState(initialPrefs.health);
			const [hasMr, setHasMr] = React.useState(initialPrefs.hasMr);
			const [mismatchOnly, setMismatchOnly] = React.useState(initialPrefs.mismatchOnly);
			const [query, setQuery] = React.useState('');
			const [archivedOpen, setArchivedOpen] = React.useState(initialPrefs.archivedOpen);
			const [archivedShowAll, setArchivedShowAll] = React.useState(false);
			const [detail, setDetail] = React.useState(null);
			const [discussionFlags, setDiscussionFlags] = React.useState({});
			// Stable identity: the conversation polls while an agent runs, and a new
			// callback per render would re-render every card on every tick.
			const reportDiscussionFlags = React.useCallback((slug, next) => {
				setDiscussionFlags((prev) => {
					const current = prev[slug];
					if (current?.pending === next.pending && current?.running === next.running) return prev;
					return { ...prev, [slug]: next };
				});
			}, []);
			const [cadence, setCadence] = React.useState(null);
			const [reloadKey, setReloadKey] = React.useState(0);
			const [refreshing, setRefreshing] = React.useState(false);
			const detailRequest = React.useRef(0);
			const detailReturnFocus = React.useRef(null);

			React.useEffect(() => {
				try {
					window.localStorage.setItem(PREFS_KEY, JSON.stringify({
						view, sort, repo, health, hasMr, mismatchOnly, archivedOpen,
					}));
				} catch {
					// Storage is an enhancement; private mode must not break the board.
				}
			}, [view, sort, repo, health, hasMr, mismatchOnly, archivedOpen]);

			// Workspace list comes from the host; the panel is global, so it cannot
			// read a session's cwd the way a conversation-scoped entry can.
			React.useEffect(() => {
				let disposed = false;
				fetch('plan-board/workspaces', { headers: { accept: 'application/json' }, cache: 'no-store' })
					.then((response) => (response.ok ? response.json() : []))
					.then((list) => {
						if (disposed) return;
						const items = Array.isArray(list) ? list : [];
						setWorkspaces(items);
						setWorkspace((current) => {
							const remembered = items.find((item) => item.path === current);
							// A remembered choice wins only while it still has plans being
							// worked on; an all-archived workspace opens empty and reads as
							// a broken panel rather than as "nothing in flight".
							if (remembered !== undefined && remembered.live > 0) return current;
							// Otherwise open the workspace with the most live plans.
							return items[0]?.path ?? '';
						});
					})
					.catch(() => {
						if (!disposed) setWorkspaces([]);
					});
				return () => {
					disposed = true;
				};
			}, []);

			React.useEffect(() => {
				if (workspace === '') {
					setRefreshing(false);
					return undefined;
				}
				let disposed = false;
				setError(null);
				fetchRoute('board', workspace, { refresh: String(reloadKey) })
					.then((payload) => {
						if (disposed) return;
						setBoard(payload);
						setRefreshing(false);
					})
					.catch((cause) => {
						if (disposed) return;
						setError(cause instanceof Error ? cause.message : String(cause));
						setRefreshing(false);
					});
				return () => {
					disposed = true;
				};
			}, [workspace, reloadKey]);

			React.useEffect(() => {
				if (workspace === '' || view !== 'cadence') return undefined;
				let disposed = false;
				fetchRoute('cadence', workspace, { refresh: String(reloadKey) })
					.then((payload) => {
						if (!disposed) setCadence(payload);
					})
					.catch(() => {
						if (!disposed) setCadence({ found: false });
					});
				return () => {
					disposed = true;
				};
			}, [workspace, view, reloadKey]);

			const openPlan = React.useCallback((slug) => {
				if (workspace === '') return;
				const request = ++detailRequest.current;
				detailReturnFocus.current = typeof document === 'undefined' ? null : document.activeElement;
				setDetail({ slug, loading: true });
				fetchRoute('plan', workspace, { slug })
					.then((payload) => {
						if (request === detailRequest.current) setDetail(payload);
					})
					.catch((cause) => {
						if (request === detailRequest.current) {
							setDetail({ slug, error: cause instanceof Error ? cause.message : String(cause) });
						}
					});
			}, [workspace]);

			const closePlan = React.useCallback(() => {
				detailRequest.current += 1;
				setDetail(null);
				const target = detailReturnFocus.current;
				detailReturnFocus.current = null;
				if (target !== null && typeof target.focus === 'function') target.focus();
			}, []);

			React.useEffect(() => {
				// A response from the previous workspace must never reopen its drawer.
				detailRequest.current += 1;
				setDetail(null);
				setArchivedShowAll(false);
			}, [workspace]);

			React.useEffect(() => () => {
				detailRequest.current += 1;
			}, []);

			React.useEffect(() => {
				if (detail === null) return undefined;
				const onKey = (event) => {
					if (event.key === 'Escape') closePlan();
				};
				window.addEventListener('keydown', onKey);
				return () => window.removeEventListener('keydown', onKey);
			}, [detail !== null, closePlan]);

			const repos = React.useMemo(() => {
				if (board === null) return [];
				const set = new Set();
				for (const card of board.cards) {
					for (const entry of card.repositories ?? []) set.add(entry);
				}
				return [...set].sort();
			}, [board]);
			const activeRepo = repo !== '' && repos.includes(repo) ? repo : '';
			React.useEffect(() => {
				if (repo !== '' && activeRepo === '') setRepo('');
			}, [repo, activeRepo]);
			const visibleCards = React.useMemo(() => (board === null ? [] : selectCards(board.cards, {
				repo: activeRepo, health, hasMr, mismatchOnly, query,
			}, sort)), [board, activeRepo, health, hasMr, mismatchOnly, query, sort]);
			const hasFilters = activeRepo !== '' || health !== '' || hasMr || mismatchOnly || query.trim() !== '';
			const clearFilters = React.useCallback(() => {
				setRepo('');
				setHealth('');
				setHasMr(false);
				setMismatchOnly(false);
				setQuery('');
			}, []);
			const toggleArchived = React.useCallback(() => {
				setArchivedOpen((open) => !open);
				setArchivedShowAll(false);
			}, []);

			const healthLevels = ['error', 'warn', 'ok'];
			const repoLabel = (entry) => {
				// Colliding last segments are the reason chips read as duplicates:
				// show the shortest suffix that is unique among the candidates.
				const parts = entry.split('/');
				for (let take = 1; take <= parts.length; take += 1) {
					const candidate = parts.slice(-take).join('/');
					const hits = repos.filter((other) => other === entry
						? other.split('/').slice(-take).join('/') === candidate
						: other.endsWith(`/${candidate}`) || other === candidate);
					if (hits.length === 1) return candidate;
				}
				return entry;
			};

			const header = h('div', { key: 'head', className: 'pb-head' }, [
				h('div', { key: 'bar', className: 'pb-headbar' }, [
					h('div', { key: 'title', className: 'pb-titlewrap' }, [
						h('h2', { key: 't', className: 'pb-title' }, tr('title')),
						board !== null
							? h('div', { key: 'counts', className: 'pb-counts' }, [
								h('span', { key: 'l' }, [tr('count.live'), ' ', h('b', { key: 'b' }, board.counts.live)]),
								h('span', { key: 'a' }, [tr('count.archived'), ' ', h('b', { key: 'b' }, board.counts.archived)]),
								h('span', { key: 't' }, [tr('count.today'), ' ', h('b', { key: 'b' }, board.counts.progressedToday)]),
								hasFilters && view === 'board'
									? h('span', { key: 'm', className: 'pb-countmatch' },
										tr('count.matches', { shown: visibleCards.length, total: board.cards.length }))
									: null,
							])
							: null,
					]),
					h('div', { key: 'spacer', className: 'pb-spacer' }),
					h('div', { key: 'tools', className: 'pb-tools' }, [
						(workspaces ?? []).length > 1
							? h('select', {
								key: 'ws',
								className: 'pb-select',
								value: workspace,
								title: tr('filter.workspace'),
								'aria-label': tr('filter.workspace'),
								onChange: (event) => {
									const chosen = event.target.value;
									// Only an explicit pick is remembered; an auto-pick must
									// never outlive the reason it was chosen.
									try {
										window.localStorage.setItem(STORE_KEY, chosen);
									} catch {
										// Private mode: the choice just does not persist.
									}
									detailRequest.current += 1;
									setDetail(null);
									setBoard(null);
									setCadence(null);
									setError(null);
									setRepo('');
									setArchivedShowAll(false);
									setRefreshing(false);
									setWorkspace(chosen);
								},
							}, workspaces.map((item) => h('option', {
								key: item.path,
								value: item.path,
							}, `${item.title ?? item.path}（${item.live ?? 0}+${item.archived ?? 0}）`)))
							: null,
						h('div', { key: 'tabs', className: 'pb-tabs', role: 'tablist' }, [
							...[
								['board', 'view.board'],
								['timeline', 'view.timeline'],
								['cadence', 'view.cadence'],
								['talk', 'view.talk'],
							].map(([key, label]) => h('button', {
								key, type: 'button', role: 'tab', 'aria-selected': view === key,
								'data-on': String(view === key), onClick: () => setView(key),
							}, tr(label))),
						]),
						h('button', {
							key: 'reload', type: 'button', className: 'pb-ghost', disabled: refreshing,
							title: tr('action.refresh'),
							onClick: () => {
								setRefreshing(true);
								setReloadKey((value) => value + 1);
							},
						}, tr(refreshing ? 'action.refreshing' : 'action.refresh')),
					]),
				]),
				view === 'board'
					? h('div', { key: 'filters', className: 'pb-filterbar' }, [
						h('div', { key: 'row1', className: 'pb-frow' }, [
							h('select', {
								key: 'repo',
								className: 'pb-select pb-reposel',
								value: activeRepo,
								'aria-label': tr('filter.repo'),
								title: tr('filter.repo'),
								onChange: (event) => setRepo(event.target.value),
							}, [
								h('option', { key: 'all', value: '' }, tr('filter.allRepos')),
								...repos.map((entry) => h('option', { key: entry, value: entry }, repoLabel(entry))),
							]),
							h('div', { key: 'health', className: 'pb-seg', role: 'group', 'aria-label': tr('filter.health') },
								healthLevels.map((level) => h('button', {
									key: level,
									type: 'button',
									className: 'pb-segbtn',
									'data-on': String(health === level),
									'aria-pressed': health === level,
									onClick: () => setHealth(health === level ? '' : level),
								}, tr(`filter.${level === 'error' ? 'stalled' : level === 'warn' ? 'warning' : 'ok'}`)))),
							h('button', {
								key: 'mr', type: 'button', className: 'pb-chip', 'data-on': String(hasMr),
								'aria-pressed': hasMr, onClick: () => setHasMr(!hasMr),
							}, tr('filter.hasMr')),
							h('button', {
								key: 'mismatch', type: 'button', className: 'pb-chip', 'data-on': String(mismatchOnly),
								'aria-pressed': mismatchOnly, onClick: () => setMismatchOnly(!mismatchOnly),
							}, tr('filter.mismatch', { n: board?.counts.mismatched ?? 0 })),
						]),
						h('div', { key: 'row2', className: 'pb-frow' }, [
							h('input', {
								key: 'q', className: 'pb-input pb-searchbox', placeholder: tr('filter.search'),
								'aria-label': tr('filter.search'), value: query, spellCheck: false,
								onChange: (event) => setQuery(event.target.value),
							}),
							h('select', {
								key: 'sort', className: 'pb-select', value: sort, title: tr('sort.title'),
								'aria-label': tr('sort.title'), onChange: (event) => setSort(event.target.value),
							}, [
								h('option', { key: 'updated', value: 'updated' }, tr('sort.updated')),
								h('option', { key: 'stalled', value: 'stalled' }, tr('sort.stalled')),
								h('option', { key: 'title', value: 'title' }, tr('sort.planTitle')),
							]),
							h('div', { key: 'spacer', className: 'pb-spacer' }),
							hasFilters
								? h('button', { key: 'clear', type: 'button', className: 'pb-chip', onClick: clearFilters },
									tr('action.clearFilters'))
								: null,
						]),
					])
					: null,
			]);

			const body = error !== null
				? h('div', { key: 'err', className: 'pb-error' }, tr('error.load', { message: error }))
				: workspaces !== null && workspaces.length === 0
					? h('div', { key: 'nows', className: 'pb-loading' }, tr('empty.noWorkspace'))
					: board === null
						? h('div', { key: 'loading', className: 'pb-loading' }, '…')
						: board.cards.length === 0
							? h('div', { key: 'noplans', className: 'pb-loading' }, tr('empty.noPlans'))
							: h('div', { key: 'main', className: 'pb-main', role: 'tabpanel' }, [
								view === 'board'
									? h(BoardView, {
									key: 'b',
									board,
									cards: visibleCards,
									tr,
									onOpen: openPlan,
									selected: detail?.slug ?? null,
									filtering: hasFilters,
									archivedOpen,
									archivedShowAll,
									toggleArchived,
									toggleArchivedAll: () => setArchivedShowAll((value) => !value),
									onClearFilters: clearFilters,
									discussionFlags,
								})
									: null,
								view === 'timeline'
									? h(TimelineView, { key: 't', board, tr, onOpen: openPlan, today: board.today })
									: null,
								view === 'cadence'
									? h(CadenceView, { key: 'c', cadence, board, tr })
									: null,
								view === 'talk'
									? h(SearchView, {
										key: 'sv',
										workspace,
										tr,
										onOpen: openPlan,
										onPendingChange: reportDiscussionFlags,
									})
									: null,
							]);

			return h('div', { className: 'pb-root' }, [
				header,
				body,
				detail !== null ? h('div', { key: 'scrim', className: 'pb-scrim', onClick: closePlan }) : null,
				h(PlanDrawer, {
					key: 'drawer',
					detail,
					tr,
					onClose: closePlan,
					workspace,
					onPendingChange: reportDiscussionFlags,
					onSession: () => closePlan(),
				}),
			]);
		}

		/** Services this client half needs. */
		const inject = ['slots', 'locale'];

		/**
		 * Client entry: dictionaries, styles, sidebar row and `main` panel.
		 * @param {import('@deepseek-ai/cordis').Context} ctx - client context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plan-board: dictionaries');
			ctx.effect(() => {
				const tag = document.createElement('style');
				tag.dataset.plugin = '@local/dsh-plan-board';
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return () => tag.remove();
			}, 'dsh-plan-board: styles');

			const t = ctx.locale.bind(NS);

			// The panel renders for one dispatched key; the panellist owner draws the
			// sidebar row and dispatches this same key, so no navigation code is needed.
			ctxRef = typeof ctx.get === 'function' ? ctx : { get: () => undefined };
			ctx.slots.inject('main', () => ctx.slots.register({
				name: 'main',
				key: PANEL_ID,
				locale: NS,
				inject: () => ({ t }),
			}, PlanBoardPanel));

			ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
				name: 'sidebar.panellist',
				id: PANEL_ID,
				order: 22,
				label: () => t('nav'),
				locale: NS,
			}, (owner = {}) => h('svg', {
				width: owner.size ?? 16,
				height: owner.size ?? 16,
				viewBox: '0 0 64 64',
				fill: 'none',
				'aria-hidden': true,
				style: { display: 'block' },
			}, [
				h('rect', { key: 'a', x: 12, y: 16, width: 11, height: 32, rx: 3, fill: 'currentColor', opacity: 0.55 }),
				h('rect', { key: 'b', x: 26.5, y: 16, width: 11, height: 22, rx: 3, fill: 'currentColor', opacity: 0.8 }),
				h('rect', { key: 'c', x: 41, y: 16, width: 11, height: 13, rx: 3, fill: 'currentColor' }),
			])));
		}

		return { inject, apply };
	},
});
