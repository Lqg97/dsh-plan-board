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
		/** Where the chosen workspace is remembered between sessions. */
		const STORE_KEY = 'dsh-plan-board.workspace';

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
			'subtitle': '读工作区的 doc/plans/，不改写任何文件',
			'view.board': '看板',
			'view.timeline': '时间线',
			'view.cadence': '节奏',
			'action.refresh': '刷新',
			'action.close': '关闭',
			'action.expand': '展开',
			'action.collapse': '收成窄条',
			'filter.allRepos': '全部仓',
			'filter.hasMr': '有 MR',
			'filter.stalled': '停滞',
			'filter.warning': '滞留',
			'filter.ok': '正常',
			'filter.search': '搜索计划…',
			'count.live': '在飞',
			'count.archived': '已归档',
			'count.today': '今日有进展',
			'health.ok': '正常',
			'health.idle': '沉寂',
			'health.warn': '滞留',
			'health.error': '停滞',
			'health.archived': '已归档',
			'card.archived': '归档 {n}d',
			'card.idle': '{n} 天',
			'card.progress': '{n} 条 progress',
			'card.mismatch': '状态未对齐',
			'panel.derived': '派生字段',
			'panel.stage': '阶段',
			'panel.reason': '命中理由',
			'panel.health': '健康度',
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
			'empty.column': '—',
			'empty.doing': '当前没有实施中的计划',
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
			'cadence.vocab': '高频口令',
			'cadence.facts': '节奏结论',
			'timeline.hint': '活跃跨度与 progress 打卡；今天是右侧红线。',
			'timeline.today': '今天',
			'error.load': '读取失败：{message}',
			'error.workspace': '这个工作区不可用。',
			'wip.full': '已到 WIP 上限',
		};

		const en = {
			'nav': 'Plan Board',
			'title': 'Plan Board',
			'subtitle': "Reads the workspace's doc/plans/; writes nothing",
			'view.board': 'Board',
			'view.timeline': 'Timeline',
			'view.cadence': 'Cadence',
			'action.refresh': 'Refresh',
			'action.close': 'Close',
			'action.expand': 'Expand',
			'action.collapse': 'Collapse',
			'filter.allRepos': 'All repos',
			'filter.hasMr': 'Has MR',
			'filter.stalled': 'Stalled',
			'filter.warning': 'Slowing',
			'filter.ok': 'Healthy',
			'filter.search': 'Search plans…',
			'count.live': 'live',
			'count.archived': 'archived',
			'count.today': 'moved today',
			'health.ok': 'ok',
			'health.idle': 'quiet',
			'health.warn': 'slowing',
			'health.error': 'stalled',
			'health.archived': 'archived',
			'card.archived': '{n}d archived',
			'card.idle': '{n}d',
			'card.progress': '{n} entries',
			'card.mismatch': 'out of sync',
			'panel.derived': 'Derived fields',
			'panel.stage': 'Stage',
			'panel.reason': 'Why',
			'panel.health': 'Health',
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
			'empty.column': '—',
			'empty.doing': 'Nothing in implementation',
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
.pb-head{flex:none;display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  padding:12px clamp(12px,2.5cqi,24px);border-bottom:1px solid var(--dsw-alias-border-l1)}
.pb-title{font-size:15px;font-weight:650;margin:0}
.pb-sub{color:var(--dsw-alias-label-secondary);font-size:11.5px;margin-left:8px}
.pb-counts{display:flex;gap:13px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.pb-counts b{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.pb-spacer{flex:1}
.pb-tabs{display:flex;gap:2px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);
  border-radius:8px;padding:2px}
.pb-tabs button{font:inherit;font-size:12.5px;border:0;background:none;color:var(--dsw-alias-label-secondary);
  padding:4px 13px;border-radius:6px;cursor:pointer}
.pb-tabs button[data-on='true']{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.pb-filters{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.pb-chip{font:inherit;font-size:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-secondary);padding:3px 10px;border-radius:999px;cursor:pointer}
.pb-chip[data-on='true']{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.pb-select,.pb-input{font:inherit;font-size:12.5px;background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:7px;padding:4px 9px}
.pb-input{width:170px}
.pb-input::placeholder{color:var(--dsw-alias-label-secondary)}
.pb-ghost{font:inherit;font-size:12.5px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);
  color:var(--dsw-alias-label-secondary);padding:4px 11px;border-radius:7px;cursor:pointer}
.pb-ghost:hover{color:var(--dsw-alias-label-primary)}
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
.pb-drawer{position:fixed;top:0;right:0;bottom:0;width:min(470px,92vw);z-index:40;
  display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);
  border-left:1px solid var(--dsw-alias-border-l2);box-shadow:0 0 30px #0006}
.pb-dhead{display:flex;align-items:flex-start;gap:10px;padding:14px 16px;
  border-bottom:1px solid var(--dsw-alias-border-l1)}
.pb-dhead .pb-dt{font-size:14px;font-weight:640;line-height:1.4}
.pb-dhead .pb-ds{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:10.5px;
  color:var(--dsw-alias-label-secondary);margin-top:3px}
.pb-dx{margin-left:auto;background:none;border:0;color:var(--dsw-alias-label-secondary);font-size:18px;
  line-height:1;cursor:pointer;padding:0 4px}
.pb-dbody{flex:1;overflow:auto;padding:14px 16px 40px}
.pb-sec{margin-bottom:18px}
.pb-sec .pb-st{font-size:11px;color:var(--dsw-alias-label-secondary);letter-spacing:.06em;
  text-transform:uppercase;margin-bottom:7px}
.pb-dkv{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;font-size:12.5px}
.pb-dkv .pb-k{color:var(--dsw-alias-label-secondary)}
.pb-dline{font-size:12.5px;color:var(--dsw-alias-label-secondary);padding:5px 0;
  border-bottom:1px solid var(--dsw-alias-border-l1);line-height:1.65;overflow-wrap:anywhere}
.pb-dline:last-child{border-bottom:0}
.pb-dline b{color:var(--dsw-alias-label-primary)}
.pb-dline code{background:var(--dsw-alias-bg-layer-2);padding:0 4px;border-radius:3px;font-size:11px;
  font-family:var(--ds-font-family-code,ui-monospace,monospace)}
.pb-dline .pb-code{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px}
.pb-dline .pb-d{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:10.5px;
  color:var(--dsw-alias-brand-primary);margin-right:8px}
.pb-mrl{display:flex;gap:7px;flex-wrap:wrap}
.pb-mrl a{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;
  color:var(--dsw-alias-brand-primary);text-decoration:none;background:var(--dsw-alias-bg-layer-2);
  border-radius:5px;padding:3px 8px}
.pb-scrim{position:fixed;inset:0;background:#00000059;z-index:39}
.pb-error{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);
  border-radius:8px;padding:10px 12px;font-size:12.5px;margin:14px}
.pb-loading{color:var(--dsw-alias-label-secondary);font-size:12.5px;padding:18px}
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
		function PlanCard({ card, onOpen, tr, selected }) {
			const tone = card.archived === true ? '' : healthTone(card.health);
			const hue = tone === 'error' ? 'var(--dsw-alias-state-error-primary)'
				: tone === 'warn' ? 'var(--dsw-alias-state-warn-primary)'
					: tone === 'ok' ? 'var(--dsw-alias-state-success-primary)'
						: 'var(--dsw-alias-border-l2)';
			return h('div', {
				className: 'pb-card',
				'data-selected': String(selected === card.slug),
				onClick: () => onOpen(card.slug),
				role: 'button',
				tabIndex: 0,
				onKeyDown: (event) => {
					if (event.key === 'Enter' || event.key === ' ') onOpen(card.slug);
				},
			}, [
				h('span', { key: 'bar', className: 'pb-bar', style: { background: hue } }),
				h('div', { key: 'name', className: 'pb-name' }, card.title),
				h('div', { key: 'slug', className: 'pb-slug' }, card.slug),
				h('div', { key: 'row', className: 'pb-row' }, [
					card.archived === true
						? h('span', { key: 'h', className: 'pb-badge' }, tr('card.archived', { n: card.archivedDays ?? '?' }))
						: h('span', {
							key: 'h',
							className: 'pb-badge',
							'data-tone': tone,
						}, `${tr(`health.${card.health}`)} ${tr('card.idle', { n: card.idleDays ?? '?' })}`),
					card.headerMismatch === true
						? h('span', { key: 'm', className: 'pb-badge', 'data-tone': 'warn' }, tr('card.mismatch'))
						: null,
					card.archived === true
						? null
						: h('span', { key: 'p', className: 'pb-badge' }, tr('card.progress', { n: card.progressCount })),
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
		 * Board view: one column per stage.
		 * @param {{ board: object, tr: Function, onOpen: Function, selected: string | null,
		 *   repo: string, health: string, hasMr: boolean, query: string, archivedOpen: boolean,
		 *   toggleArchived: Function }} props - view inputs.
		 * @returns {import('react').ReactElement} view.
		 */
		function BoardView({ board, tr, onOpen, selected, repo, health, hasMr, query, archivedOpen, toggleArchived }) {
			const cards = board.cards.filter((card) => {
				if (repo !== '' && !(card.repositories ?? []).includes(repo)) return false;
				if (health !== '' && card.health !== health) return false;
				if (hasMr && (card.mergeRequests ?? []).length === 0) return false;
				if (query !== '') {
					const hay = `${card.title} ${card.slug}`.toLowerCase();
					if (!hay.includes(query.toLowerCase())) return false;
				}
				return true;
			});
			const SHOWN = 6;
			return h('div', { className: 'pb-board' }, board.wip.columns.map((column) => {
				const items = cards.filter((card) => card.stage === column.key);
				const collapsed = column.key === 'archived' && !archivedOpen;
				if (collapsed) {
					return h('div', { key: column.key, className: 'pb-col', 'data-collapsed': 'true' }, [
						h('div', { key: 'head', className: 'pb-colhead' }, [
							h('span', { key: 'd', className: 'pb-dot', style: { background: STAGE_HUE[column.key] } }),
							h('span', { key: 't', className: 'pb-coltitle' }, column.label),
							h('span', { key: 'n', className: 'pb-coln' }, items.length),
						]),
						h('button', {
							key: 'more',
							type: 'button',
							className: 'pb-more',
							onClick: toggleArchived,
						}, `${tr('action.expand')} ${items.length}`),
					]);
				}
				const shown = column.key === 'archived' && items.length > SHOWN ? items.slice(0, SHOWN) : items;
				return h('div', {
					key: column.key,
					className: 'pb-col',
					'data-wip': column.wip,
				}, [
					h('div', { key: 'head', className: 'pb-colhead' }, [
						h('span', { key: 'd', className: 'pb-dot', style: { background: STAGE_HUE[column.key] } }),
						h('span', { key: 't', className: 'pb-coltitle', title: column.hint }, column.label),
						h('span', { key: 'n', className: 'pb-coln' }, items.length),
					]),
					h('div', { key: 'body', className: 'pb-colbody' }, shown.length === 0
						? h('div', { className: 'pb-empty' },
							column.key === 'doing' ? tr('empty.doing') : tr('empty.column'))
						: shown.map((card) => h(PlanCard, { key: card.slug, card, tr, onOpen, selected }))),
					column.key === 'archived'
						? h('button', { key: 'more', type: 'button', className: 'pb-more', onClick: toggleArchived },
							tr('action.collapse'))
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
				.sort((a, b) => (a.archived === b.archived ? 0 : a.archived ? 1 : -1))
				.slice(0, 60);
			const dates = rows.flatMap((card) => [card.firstProgressDate, card.lastProgressDate,
				card.headerStatusDate, today]).filter(Boolean).sort();
			const start = dates[0] ?? today;
			const end = dates[dates.length - 1] ?? today;
			const t0 = Date.parse(`${start}T00:00:00`);
			const t1 = Date.parse(`${end}T00:00:00`);
			const span = Math.max(t1 - t0, 86_400_000);
			const pct = (date) => ((Date.parse(`${date}T00:00:00`) - t0) / span) * 100;

			const ticks = [];
			const cursor = new Date(t0);
			while (cursor.getTime() <= t1) {
				const x = ((cursor.getTime() - t0) / span) * 100;
				if (x >= 0 && x <= 100) {
					ticks.push({ x, label: `${cursor.getMonth() + 1}/${cursor.getDate()}` });
				}
				cursor.setDate(cursor.getDate() + 7);
			}
			const todayX = pct(today);

			return h('div', { className: 'pb-tl' }, [
				h('div', { key: 'hint', className: 'pb-tl-hint' }, tr('timeline.hint')),
				...rows.map((card) => {
					const from = card.firstProgressDate ?? card.headerStatusDate ?? start;
					const to = card.lastProgressDate ?? card.headerStatusDate ?? from;
					const left = pct(from);
					const width = Math.max(pct(to) - left, 0.8);
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
							}),
							...card.recentProgress.map((entry, index) => h('div', {
								key: `pt${index}`,
								className: 'pb-tl-pt',
								style: { left: `${pct(entry.date)}%` },
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
					h('div', { key: 'k', className: 'pb-k' }, 'prompts'),
					h('div', { key: 'v', className: 'pb-v' }, cadence.totalInputs ?? '—'),
				]),
				h('div', { key: 'c', className: 'pb-kvc' }, [
					h('div', { key: 'k', className: 'pb-k' }, 'active days'),
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
						h('div', { key: 'l', className: 'pb-wl' }, week.isoWeek.replace('2026-', '')),
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
		 * One plan's drawer.
		 * @param {{ detail: any, tr: Function, onClose: Function }} props - inputs.
		 * @returns {import('react').ReactElement | null} drawer.
		 */
		function PlanDrawer({ detail, tr, onClose }) {
			if (detail === null) return null;
			if (detail.error !== undefined) {
				return h('div', { className: 'pb-drawer' }, [
					h('div', { key: 'h', className: 'pb-dhead' }, [
						h('div', { key: 't', className: 'pb-dt' }, detail.slug ?? ''),
						h('button', { key: 'x', type: 'button', className: 'pb-dx', onClick: onClose }, '×'),
					]),
					h('div', { key: 'e', className: 'pb-error' }, detail.error),
				]);
			}
			const tone = healthTone(detail.health);
			const rows = [
				[tr('panel.stage'), detail.stageLabel],
				[tr('panel.reason'), detail.stageReason],
				[tr('panel.health'), `${tr(`health.${detail.health}`)}（${detail.idleDays ?? '?'} 天）`],
				[tr('panel.headerDate'), detail.headerStatusDate ?? '—'],
				[tr('panel.lastProgress'), detail.lastProgressDate ?? '—'],
				[tr('panel.progressCount'), String(detail.progressCount)],
				[tr('panel.mtime'), detail.fileMtime !== null ? detail.fileMtime.slice(0, 10) : '—'],
			];
			if (detail.mismatch !== null) rows.push([tr('panel.mismatch'), detail.mismatch]);
			return h('div', { className: 'pb-drawer' }, [
				h('div', { key: 'head', className: 'pb-dhead' }, [
					h('div', { key: 'txt' }, [
						h('div', { key: 't', className: 'pb-dt' }, detail.title),
						h('div', { key: 's', className: 'pb-ds' }, detail.slug),
					]),
					h('button', { key: 'x', type: 'button', className: 'pb-dx', onClick: onClose, title: 'Esc' }, '×'),
				]),
				h('div', { key: 'body', className: 'pb-dbody' }, [
					h('div', { key: 'derived', className: 'pb-sec' }, [
						h('div', { key: 'st', className: 'pb-st' }, tr('panel.derived')),
						h('div', { key: 'kv', className: 'pb-dkv' }, rows.flatMap(([key, value], index) => [
							h('div', { key: `k${index}`, className: 'pb-k' }, key),
							h('div', {
								key: `v${index}`,
								style: index === 2 && tone !== '' ? { color: `var(--dsw-alias-state-${tone === 'error' ? 'error' : tone === 'warn' ? 'warn' : 'success'}-primary)` } : {},
							}, value),
						])),
					]),
					(detail.headerLines ?? []).length > 0
						? h('div', { key: 'block', className: 'pb-sec' }, [
							h('div', { key: 'st', className: 'pb-st' }, tr('panel.headerBlock')),
							...detail.headerLines.map((line, index) => h('div', {
								key: `l${index}`,
								className: 'pb-dline',
							}, inlineMarkdown(line))),
						])
						: null,
					h('div', { key: 'mr', className: 'pb-sec' }, [
						h('div', { key: 'st', className: 'pb-st' }, tr('panel.mr')),
						(detail.mergeRequests ?? []).length === 0
							? h('div', { key: 'none', className: 'pb-dline' }, tr('panel.noMr'))
							: h('div', { key: 'list', className: 'pb-mrl' }, detail.mergeRequests.map((merge, index) =>
								h('a', {
									key: `m${index}`,
									href: `https://git.woa.com/${merge.repo}/-/merge_requests/${merge.num}`,
									target: '_blank',
									rel: 'noreferrer',
								}, `${merge.repo.split('/').pop()} !${merge.num}`))),
					]),
					h('div', { key: 'prog', className: 'pb-sec' }, [
						h('div', { key: 'st', className: 'pb-st' }, tr('panel.recent')),
						(detail.recentProgress ?? []).length === 0
							? h('div', { key: 'none', className: 'pb-dline' }, tr('panel.noProgress'))
							: detail.recentProgress.slice().reverse().map((entry, index) => h('div', {
								key: `p${index}`,
								className: 'pb-dline',
							}, [h('span', { key: 'd', className: 'pb-d' }, entry.date), entry.heading])),
					]),
					h('div', { key: 'files', className: 'pb-sec' }, [
						h('div', { key: 'st', className: 'pb-st' }, tr('panel.files')),
						h('div', { key: 'f', className: 'pb-dline pb-code' }, `doc/plans/${detail.file}`),
						detail.evidenceDir !== null
							? h('div', { key: 'e', className: 'pb-dline pb-code' },
								`${detail.evidenceDir}（${(detail.evidence ?? []).length} 项）`)
							: null,
					]),
				]),
			]);
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
			const [view, setView] = React.useState('board');
			const [repo, setRepo] = React.useState('');
			const [health, setHealth] = React.useState('');
			const [hasMr, setHasMr] = React.useState(false);
			const [query, setQuery] = React.useState('');
			const [archivedOpen, setArchivedOpen] = React.useState(false);
			const [detail, setDetail] = React.useState(null);
			const [cadence, setCadence] = React.useState(null);
			const [reloadKey, setReloadKey] = React.useState(0);

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
							if (current !== '' && items.some((item) => item.path === current)) return current;
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
				if (workspace === '') return undefined;
				try {
					window.localStorage.setItem(STORE_KEY, workspace);
				} catch {
					// Private mode: the choice just does not persist.
				}
				let disposed = false;
				setError(null);
				fetchRoute('board', workspace)
					.then((payload) => {
						if (!disposed) setBoard(payload);
					})
					.catch((cause) => {
						if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
					});
				return () => {
					disposed = true;
				};
			}, [workspace, reloadKey]);

			React.useEffect(() => {
				if (workspace === '' || view !== 'cadence') return undefined;
				let disposed = false;
				fetchRoute('cadence', workspace)
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
				setDetail({ slug });
				fetchRoute('plan', workspace, { slug })
					.then((payload) => setDetail(payload))
					.catch((cause) => setDetail({ slug, error: cause instanceof Error ? cause.message : String(cause) }));
			}, [workspace]);

			const closePlan = React.useCallback(() => setDetail(null), []);

			React.useEffect(() => {
				if (detail === null) return undefined;
				const onKey = (event) => {
					if (event.key === 'Escape') setDetail(null);
				};
				window.addEventListener('keydown', onKey);
				return () => window.removeEventListener('keydown', onKey);
			}, [detail]);

			const repos = React.useMemo(() => {
				if (board === null) return [];
				const set = new Set();
				for (const card of board.cards) {
					for (const entry of card.repositories ?? []) set.add(entry);
				}
				return [...set].sort();
			}, [board]);

			const header = h('div', { key: 'head', className: 'pb-head' }, [
				h('div', { key: 'title' }, [
					h('h2', { key: 't', className: 'pb-title' }, tr('title')),
					h('span', { key: 's', className: 'pb-sub' }, tr('subtitle')),
				]),
				board !== null
					? h('div', { key: 'counts', className: 'pb-counts' }, [
						h('span', { key: 'l' }, [tr('count.live'), ' ', h('b', { key: 'b' }, board.counts.live)]),
						h('span', { key: 'a' }, [tr('count.archived'), ' ', h('b', { key: 'b' }, board.counts.archived)]),
						h('span', { key: 't' }, [tr('count.today'), ' ', h('b', { key: 'b' }, board.counts.progressedToday)]),
					])
					: null,
				h('div', { key: 'spacer', className: 'pb-spacer' }),
				(workspaces ?? []).length > 1
					? h('select', {
						key: 'ws',
						className: 'pb-select',
						value: workspace,
						onChange: (event) => setWorkspace(event.target.value),
					}, workspaces.map((item) => h('option', { key: item.path, value: item.path }, item.title ?? item.path)))
					: null,
				h('div', { key: 'tabs', className: 'pb-tabs' }, [
					h('button', { key: 'b', type: 'button', 'data-on': String(view === 'board'), onClick: () => setView('board') }, tr('view.board')),
					h('button', { key: 't', type: 'button', 'data-on': String(view === 'timeline'), onClick: () => setView('timeline') }, tr('view.timeline')),
					h('button', { key: 'c', type: 'button', 'data-on': String(view === 'cadence'), onClick: () => setView('cadence') }, tr('view.cadence')),
				]),
				view === 'board'
					? h('div', { key: 'filters', className: 'pb-filters' }, [
						h('button', { key: 'all', type: 'button', className: 'pb-chip', 'data-on': String(repo === ''), onClick: () => setRepo('') }, tr('filter.allRepos')),
						...repos.map((entry) => h('button', {
							key: entry,
							type: 'button',
							className: 'pb-chip',
							'data-on': String(repo === entry),
							onClick: () => setRepo(repo === entry ? '' : entry),
						}, entry.split('/').pop())),
						...['error', 'warn', 'ok'].map((level) => h('button', {
							key: level,
							type: 'button',
							className: 'pb-chip',
							'data-on': String(health === level),
							onClick: () => setHealth(health === level ? '' : level),
						}, tr(`filter.${level === 'error' ? 'stalled' : level === 'warn' ? 'warning' : 'ok'}`))),
						h('button', {
							key: 'mr',
							type: 'button',
							className: 'pb-chip',
							'data-on': String(hasMr),
							onClick: () => setHasMr(!hasMr),
						}, tr('filter.hasMr')),
						h('input', {
							key: 'q',
							className: 'pb-input',
							placeholder: tr('filter.search'),
							value: query,
							onChange: (event) => setQuery(event.target.value),
						}),
					])
					: null,
				h('button', { key: 'reload', type: 'button', className: 'pb-ghost', onClick: () => setReloadKey((value) => value + 1) }, tr('action.refresh')),
			]);

			const body = error !== null
				? h('div', { key: 'err', className: 'pb-error' }, tr('error.load', { message: error }))
				: workspaces !== null && workspaces.length === 0
					? h('div', { key: 'nows', className: 'pb-loading' }, tr('empty.noWorkspace'))
					: board === null
						? h('div', { key: 'loading', className: 'pb-loading' }, '…')
						: board.cards.length === 0
							? h('div', { key: 'noplans', className: 'pb-loading' }, tr('empty.noPlans'))
							: h('div', { key: 'main', className: 'pb-main' }, [
								view === 'board'
									? h(BoardView, {
										key: 'b',
										board,
										tr,
										onOpen: openPlan,
										selected: detail?.slug ?? null,
										repo,
										health,
										hasMr,
										query,
										archivedOpen,
										toggleArchived: () => setArchivedOpen((value) => !value),
									})
									: null,
								view === 'timeline'
									? h(TimelineView, { key: 't', board, tr, onOpen: openPlan, today: board.today })
									: null,
								view === 'cadence'
									? h(CadenceView, { key: 'c', cadence, board, tr })
									: null,
							]);

			return h('div', { className: 'pb-root' }, [
				header,
				body,
				detail !== null ? h('div', { key: 'scrim', className: 'pb-scrim', onClick: closePlan }) : null,
				h(PlanDrawer, { key: 'drawer', detail, tr, onClose: closePlan }),
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
			/** Set once `layout` arrives; the sidebar row needs it to switch panels. */
			let layout = null;
			ctx.inject(['layout'], (scoped) => {
				layout = scoped.layout;
			});

			// The panel renders for one dispatched key; the sidebar row selects it.
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
