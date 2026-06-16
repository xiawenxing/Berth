/**
 * Berth UI — vanilla JS, no framework
 * Functions: loadAll, renderSidebar, relativeTime, openTerminal, closeTerminal, pin, assign
 * View router: setMode('now'|'projects'|'sessions'), openProject(name), openTerminalFor(sessionId)
 */

// ── Icons & theme ────────────────────────────────────────────────────────────
/** Inline a lucide icon from the vendored sprite. `cls` adds extra classes. */
function icon(name, cls = '') {
  return `<svg class="icon ${cls}" aria-hidden="true"><use href="/vendor/lucide.svg#${name}"></use></svg>`;
}

/** Apply + persist the color theme ('light' | 'dark'). */
function setTheme(theme) {
  const light = theme === 'light';
  document.documentElement.classList.toggle('light', light);
  try { localStorage.setItem('berth-theme', light ? 'light' : 'dark'); } catch (_) {}
  const btn = document.getElementById('btn-theme');
  if (btn) btn.innerHTML = icon(light ? 'moon' : 'sun');
  applyTerminalThemeToAll();
}
function toggleTheme() {
  setTheme(document.documentElement.classList.contains('light') ? 'dark' : 'light');
}

// ── State ──────────────────────────────────────────────────────────────────
let allSessions = [];
let projects = [];
let allTodos = [];
let selectedId = null;
let activeMenu = null;
let currentMode = 'now'; // 'now' | 'projects' | 'sessions'
let editingSessionTitle = null; // { sessionId, previous, draft, selectAll, selectionStart, selectionEnd }
let editingTodoTitle = null;    // { id, previous, draft, projectName }
let renderingSidebar = false;

/**
 * Keep a fixed-position popover/menu fully visible near its anchor.
 * The element must be in the document before measuring.
 */
function positionFloatingPanel(panel, anchor, opts = {}) {
  const gap = opts.gap ?? 4;
  const margin = opts.margin ?? 8;
  const align = opts.align || 'start';
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const rect = anchor.getBoundingClientRect();

  panel.style.maxHeight = '';
  panel.style.overflowY = '';
  if (vh > 0) {
    const maxHeight = Math.max(120, vh - margin * 2);
    if (panel.offsetHeight > maxHeight) {
      panel.style.maxHeight = maxHeight + 'px';
      panel.style.overflowY = 'auto';
    }
  }

  const panelW = panel.offsetWidth;
  const panelH = panel.offsetHeight;
  const below = rect.bottom + gap;
  const above = rect.top - gap - panelH;
  const spaceBelow = vh - rect.bottom - gap - margin;
  const spaceAbove = rect.top - gap - margin;
  const preferAbove = panelH > spaceBelow && spaceAbove > spaceBelow;
  let top = preferAbove ? above : below;
  let left = align === 'end' ? rect.right - panelW : rect.left;

  const maxTop = Math.max(margin, vh - panelH - margin);
  const maxLeft = Math.max(margin, vw - panelW - margin);
  top = Math.min(Math.max(margin, top), maxTop);
  left = Math.min(Math.max(margin, left), maxLeft);

  panel.style.top = top + 'px';
  panel.style.left = left + 'px';
}

function projectById(id) {
  if (!id) return null;
  return projects.find(p => p.id === id || p.name === id) || null;
}
function projectLabel(idOrName) {
  const p = projectById(idOrName);
  return p ? p.name : (idOrName || '');
}
function todoProjectId(t) {
  if (!t) return null;
  if (t.projectId) return t.projectId;
  const p = projects.find(x => x.name === t.project);
  return p ? p.id : (t.project || null);
}
function todoProjectLabel(t) {
  return t ? (t.project || projectLabel(t.projectId) || '') : '';
}

// ── Terminal color themes ────────────────────────────────────────────────────
// Registry of available xterm color schemes (background/foreground/cursor +
// full 16-color ANSI palette). A future settings page will let users pick which
// scheme maps to light/dark mode; for now the mapping is fixed below.
const TERMINAL_THEMES = {
  // ── ② One — active default (pairs with the One UI scheme in tokens.css) ──
  'one-dark': {
    background: '#282c34', foreground: '#abb2bf', cursor: '#61afef',
    selectionBackground: 'rgba(62,68,81,0.6)',
    black: '#3f4451', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
    blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b',
    brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff',
  },
  'one-light': {
    background: '#fafafa', foreground: '#383a42', cursor: '#4078f2',
    selectionBackground: 'rgba(64,120,242,0.18)',
    black: '#383a42', red: '#e45649', green: '#50a14f', yellow: '#c18401',
    blue: '#4078f2', magenta: '#a626a4', cyan: '#0184bc', white: '#a0a1a7',
    brightBlack: '#696c77', brightRed: '#e45649', brightGreen: '#50a14f', brightYellow: '#c18401',
    brightBlue: '#4078f2', brightMagenta: '#a626a4', brightCyan: '#0184bc', brightWhite: '#2a2c32',
  },

  // ── Kept for the future settings page (not active yet) ──
  'github-dark': {
    background: '#0d1117', foreground: '#e6edf3', cursor: '#2f81f7',
    selectionBackground: 'rgba(56,139,253,0.25)',
    black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
    blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
    brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341',
    brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#ffffff',
  },
  'github-light': {
    background: '#ffffff', foreground: '#1f2328', cursor: '#0969da',
    selectionBackground: 'rgba(9,105,218,0.15)',
    black: '#24292f', red: '#cf222e', green: '#1a7f37', yellow: '#9a6700',
    blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
    brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#2da44e', brightYellow: '#bf8700',
    brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f',
  },
  'tokyo-night': {
    background: '#1a1b26', foreground: '#c0caf5', cursor: '#7aa2f7',
    selectionBackground: 'rgba(40,52,87,0.7)',
    black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
    blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
    brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68',
    brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5',
  },
  'tokyo-day': {
    background: '#e1e2e7', foreground: '#3760bf', cursor: '#2e7de9',
    selectionBackground: 'rgba(46,125,233,0.18)',
    black: '#b4b5b9', red: '#f52a65', green: '#587539', yellow: '#8c6c3e',
    blue: '#2e7de9', magenta: '#9854f1', cyan: '#007197', white: '#6172b0',
    brightBlack: '#a1a6c5', brightRed: '#f52a65', brightGreen: '#587539', brightYellow: '#8c6c3e',
    brightBlue: '#2e7de9', brightMagenta: '#9854f1', brightCyan: '#007197', brightWhite: '#3760bf',
  },
  'ink-dark': {        // 水墨（国风·暗）
    background: '#1c1a17', foreground: '#e8e0d0', cursor: '#d96a5e',
    selectionBackground: 'rgba(51,46,37,0.85)',
    black: '#2d2a24', red: '#d96a5e', green: '#8aa86b', yellow: '#d4a843',
    blue: '#6fa3b5', magenta: '#b08bb5', cyan: '#6fb5b0', white: '#c9bfa9',
    brightBlack: '#6b6253', brightRed: '#e07d72', brightGreen: '#9bb87d', brightYellow: '#e0b85a',
    brightBlue: '#82b3c4', brightMagenta: '#c09ec4', brightCyan: '#82c4bf', brightWhite: '#f0e9da',
  },
  'ink-light': {       // 宣纸（国风·亮）
    background: '#ece3d2', foreground: '#2b2620', cursor: '#9c3a32',
    selectionBackground: 'rgba(156,58,50,0.15)',
    black: '#2b2620', red: '#b33b32', green: '#5b7a4f', yellow: '#9c7a1a',
    blue: '#3a6b7e', magenta: '#8a5a83', cyan: '#4a8b8b', white: '#8a7e68',
    brightBlack: '#5a5040', brightRed: '#c0463c', brightGreen: '#6b8a5c', brightYellow: '#b8860b',
    brightBlue: '#4a7d92', brightMagenta: '#9c6a95', brightCyan: '#5a9b9b', brightWhite: '#2b2620',
  },
  'celadon-dark': {    // 黛色（国风·暗）
    background: '#15201e', foreground: '#d4e0db', cursor: '#5fb3a3',
    selectionBackground: 'rgba(41,59,55,0.85)',
    black: '#243430', red: '#d4736a', green: '#6cc0ab', yellow: '#d0a85a',
    blue: '#6a9bbf', magenta: '#a585b5', cyan: '#5fb3b3', white: '#b8c4bf',
    brightBlack: '#5a6b66', brightRed: '#e0857c', brightGreen: '#7fd0bb', brightYellow: '#dcb86a',
    brightBlue: '#7caccf', brightMagenta: '#b597c4', brightCyan: '#6fc4c4', brightWhite: '#e4ede9',
  },
  'celadon-light': {   // 青瓷（国风·亮）
    background: '#e0e9e2', foreground: '#233430', cursor: '#2f6d6a',
    selectionBackground: 'rgba(47,109,106,0.15)',
    black: '#233430', red: '#b5524a', green: '#3d8b7a', yellow: '#b08642',
    blue: '#2f5d7c', magenta: '#7a5a8a', cyan: '#3d8b8b', white: '#6f8279',
    brightBlack: '#4a5b56', brightRed: '#c25d54', brightGreen: '#4a9b8a', brightYellow: '#c09452',
    brightBlue: '#3a6d8c', brightMagenta: '#8a6a9a', brightCyan: '#4a9b9b', brightWhite: '#233430',
  },
};

/** Which scheme each color-mode uses. The settings page will make this user-configurable. */
const TERMINAL_THEME_BY_MODE = { light: 'one-light', dark: 'one-dark' };

/** Resolve the xterm theme object for the current light/dark mode. */
function currentTerminalTheme() {
  const mode = document.documentElement.classList.contains('light') ? 'light' : 'dark';
  return TERMINAL_THEMES[TERMINAL_THEME_BY_MODE[mode]];
}

/** Re-apply the current terminal theme to every live xterm instance (on theme toggle). */
function applyTerminalThemeToAll() {
  const theme = currentTerminalTheme();
  for (const entry of terminals.values()) {
    if (entry.term) entry.term.options.theme = theme;
  }
  paintTerminalBackdrop(theme);
}

/** Paint the surface behind the terminal (wrap + every instance) with the active terminal
 *  background, so the load/fit window and any sub-row remainder never flash black. This is the
 *  authoritative sync — the CSS var(--background) fallback only covers the first paint. */
function paintTerminalBackdrop(theme = currentTerminalTheme()) {
  const bg = theme.background;
  const wrap = document.getElementById('terminal-wrap');
  if (wrap) wrap.style.background = bg;
  for (const entry of terminals.values()) {
    if (entry.el) entry.el.style.background = bg;
  }
}

// ── Terminal pool ──────────────────────────────────────────────────────────
// Each entry: { sessionId, term, ws, fit, el, lastUsed }
const terminals = new Map();
const TERMINAL_POOL_MAX = 20;

/** The sessionId currently shown in the main pane (may differ from selectedId). */
let activeTerminalId = null;

// ── Live per-session activity (pushed from the server /status channel) ───────
// liveStatus: sessionId → 'running' | 'settled' (absent = no live PTY) — drives ONLY the spinner.
// The red dot is content-based (isUnread: last-message time vs lastSeen); a `settled` push carries the
// session's fresh last-message time, which is the only thing that can (re)light a row's dot.
let liveStatus = new Map();
let statusWs = null;
let statusRenderTimer = null;

// Sidebar section collapse state, persisted across re-renders (which rebuild the whole
// list on every session update). A key here = the user has collapsed that section.
// Default for every section is expanded; cwd groups beyond the first N get seeded as
// collapsed exactly once (see seenCwdGroups).
const collapsedSections = new Set();

// cwd groups we've already applied the "first N expanded, rest collapsed" default to,
// so a re-render never re-collapses (or re-expands) a group the user has since toggled.
const seenCwdGroups = new Set();

// Track which groups have their stale (>3d inactive) rows revealed via "Show more".
// Ephemeral — resets on reload.
const expandedStale = new Set();

// Track which todos are expanded (by id) so re-renders (e.g. after assignTask) keep them open
const expandedTodos = new Set();

// Workspace 会话 module: which cwd groups the user has collapsed (key = project name   cwd),
// persisted across re-renders. Default = expanded.
const wsCollapsedCwds = new Set();
const contextUpdatePending = new Set();

// 待办 status board: column order + accent colors, and the currently-expanded column.
// STATUS_ORDER / TODO_PRIORITIES are seeded with the defaults and refreshed from /api/settings
// (loadTaskFieldConfig) so the user can edit the vocabularies in the Settings page.
let STATUS_ORDER = ['待办', '进行中', '阻塞', '待验证', '已完成', '已取消'];
const STATUS_COLOR = {
  '待办': '#8b949e', '进行中': '#d29922', '阻塞': '#f85149',
  '待验证': '#39c5cf', '已完成': '#3fb950', '已取消': '#6e7681',
};
// Deterministic palette fallback for custom statuses not in STATUS_COLOR.
const STATUS_PALETTE = ['#8b949e', '#d29922', '#f85149', '#a371f7', '#39c5cf', '#3fb950', '#6e7681', '#db61a2', '#e3b341'];
function statusColor(s) {
  if (STATUS_COLOR[s]) return STATUS_COLOR[s];
  const i = STATUS_ORDER.indexOf(s);
  return STATUS_PALETTE[(i >= 0 ? i : 0) % STATUS_PALETTE.length];
}
let activeTodoStatus = null;

// AGENTS / BERTH_AGENT mirror the server's agent config (Settings → Agents). The launch pickers are
// rendered from the enabled agents instead of a hardcoded claude/codex/coco list.
let AGENTS = [
  { cli: 'claude', enabled: true, model: null },
  { cli: 'codex', enabled: true, model: null },
  { cli: 'coco', enabled: true, model: null },
];
let HEADLESS_CLIS = ['claude'];
let BERTH_AGENT = { cli: 'claude', model: 'claude-haiku-4-5' };
// CLIs whose fresh launch accepts a --model flag (coco has none). Mirrors the server's MODEL_FLAG_CLIS.
const MODEL_FLAG_CLIS = ['claude', 'codex'];

/** Enabled agents in display order (what the launch pickers offer). */
function enabledAgents() { return AGENTS.filter(a => a.enabled); }

/** Render the CLI radio group for a launch picker from the enabled agents (first = checked). */
function cliRadios(groupName) {
  const list = enabledAgents();
  if (!list.length) return '<span class="cli-radio-empty">无可用 agent（去设置启用）</span>';
  return list.map((a, i) =>
    `<label class="cli-radio"><input type="radio" name="${groupName}" value="${escHtml(a.cli)}"${i === 0 ? ' checked' : ''}> ${escHtml(a.cli)}</label>`
  ).join('');
}

/** Pull the user-configured status/priority vocabularies + agents from the server (falls back to defaults). */
async function loadTaskFieldConfig() {
  try {
    const cfg = await (await fetch('/api/settings')).json();
    if (Array.isArray(cfg.statuses) && cfg.statuses.length) STATUS_ORDER = cfg.statuses;
    if (Array.isArray(cfg.priorities) && cfg.priorities.length) TODO_PRIORITIES = cfg.priorities;
    if (cfg.agents) applyAgentConfig(cfg.agents);
  } catch (_) { /* keep defaults */ }
}

/** Adopt a server agent config payload into the live globals. */
function applyAgentConfig(agents) {
  if (Array.isArray(agents.list) && agents.list.length) AGENTS = agents.list;
  if (Array.isArray(agents.headlessClis)) HEADLESS_CLIS = agents.headlessClis;
  if (agents.berthAgentCli) BERTH_AGENT = { cli: agents.berthAgentCli, model: agents.berthAgentModel };
}

// ── Sidebar resize ─────────────────────────────────────────────────────────

function initSidebarResize() {
  const handle = document.getElementById('sidebar-resize-handle');
  const sidebar = document.getElementById('sidebar');
  if (!handle || !sidebar) return;

  // Restore saved width
  const saved = localStorage.getItem('berthSidebarWidth');
  if (saved) {
    const w = parseInt(saved, 10);
    if (w >= 220 && w <= 700) {
      sidebar.style.width = w + 'px';
    }
  }

  let dragging = false;
  let startX = 0;
  let startW = 0;

  handle.addEventListener('mousedown', e => {
    dragging = true;
    startX = e.clientX;
    startW = sidebar.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const delta = e.clientX - startX;
    const newW = Math.min(700, Math.max(220, startW + delta));
    sidebar.style.width = newW + 'px';
    // Trigger terminal reflow while dragging
    triggerTerminalResize();
  });

  document.addEventListener('mouseup', e => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const finalW = sidebar.getBoundingClientRect().width;
    localStorage.setItem('berthSidebarWidth', Math.round(finalW));
    triggerTerminalResize();
  });
}

// Floors for a plausible terminal size. fit.fit() can momentarily compute a sliver (~10 cols)
// while a view transition collapses the pane (Now→sessions, task-launch, workspace toggle).
// Shipping that to the PTY makes the agent hard-wrap its output at ~10 cols — and that
// scrollback can NEVER reflow, so the narrowness is permanent even after the pane widens again.
const MIN_TERM_COLS = 40;
const MIN_TERM_ROWS = 8;

/**
 * Fit the active terminal to its pane and push the size to the PTY — but only when the pane is
 * genuinely laid out. Skips (leaving the PTY at its last good size) when the element is hidden or
 * measures implausibly small, so a transient mis-measurement never shrinks the live PTY.
 * Returns true if a resize was sent.
 */
function fitAndResize(entry) {
  if (!entry || !entry.fit || !entry.el) return false;
  // Hidden / not laid out yet → don't measure; fit would yield a sliver.
  if (entry.el.offsetWidth < 50 || entry.el.offsetHeight < 50) return false;
  try {
    entry.fit.fit();
    const c = entry.term.cols, r = entry.term.rows;
    if (c < MIN_TERM_COLS || r < MIN_TERM_ROWS) return false;   // transient bad measurement — ignore
    if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(JSON.stringify({ t: 'r', c, r }));
    }
    return true;
  } catch (e) { return false; }
}

function triggerTerminalResize() {
  if (!activeTerminalId) return;
  fitAndResize(terminals.get(activeTerminalId));
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Format epoch seconds into a short relative string: 22m, 3h, 2d, 1w, 2mo
 */
function relativeTime(epochSec) {
  const delta = Math.floor(Date.now() / 1000) - epochSec;
  if (delta < 60) return 'now';
  if (delta < 3600) return Math.floor(delta / 60) + 'm';
  if (delta < 86400) return Math.floor(delta / 3600) + 'h';
  if (delta < 86400 * 7) return Math.floor(delta / 86400) + 'd';
  if (delta < 86400 * 30) return Math.floor(delta / (86400 * 7)) + 'w';
  if (delta < 86400 * 365) return Math.floor(delta / (86400 * 30)) + 'mo';
  return Math.floor(delta / (86400 * 365)) + 'y';
}

/** Shorten a cwd path: show last 2 segments */
function shortCwd(cwd) {
  if (!cwd) return '(no path)';
  const parts = cwd.replace(/\/$/, '').split('/').filter(Boolean);
  if (parts.length === 0) return '/';
  if (parts.length === 1) return '/' + parts[0];
  return parts.slice(-2).join('/');
}

/** Browser-side path key for UI-only matching/grouping. The server does realpath matching. */
function cwdKey(cwd) {
  if (!cwd) return '';
  let p = String(cwd).replace(/\/+$/, '') || '/';
  if (p.startsWith('/private/')) p = p.slice('/private'.length) || '/';
  return p.normalize ? p.normalize('NFC') : p;
}

/** Get display title for a session */
function displayTitle(s) {
  if (s.title && s.title.trim()) return s.title.trim();
  // No first-user-message title yet (e.g. a fresh launch the user hasn't prompted). Show 无标题
  // rather than the cwd basename — the cwd already shows on the row's meta line, so it'd be redundant.
  return '无标题';
}

/** True when a session has no real (first-user-message) title yet — used to dim its row label. */
function isUntitled(s) {
  return !(s && s.title && s.title.trim());
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const DONE_STATUSES = new Set(['已完成', '已取消']);

// ── Task DDL (本地截止日期; 'YYYY-MM-DD' or null) ──────────────────────────────
/** Local today as 'YYYY-MM-DD' (browser timezone — the user's day). */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** A local date 'YYYY-MM-DD' offset by `n` days from today. */
function offsetDayStr(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Whole days `ddl` is past `today` (>0 overdue, 0 today, <0 future). Both 'YYYY-MM-DD'. */
function ddlDaysOverdue(ddl, today) {
  const [y, m, d] = ddl.split('-').map(Number);
  const [Y, M, D] = today.split('-').map(Number);
  return Math.round((Date.UTC(Y, M - 1, D) - Date.UTC(y, m - 1, d)) / 86400000);
}
/** Chip HTML for a task's ddl (逾期 / 今日 / future MM-DD); '' when unset. */
function ddlChipHtml(t) {
  if (!t.ddl) return '';
  const over = ddlDaysOverdue(t.ddl, todayStr());
  if (over > 0) return `<span class="ddl-chip overdue" title="截止 ${escHtml(t.ddl)}">逾期 ${over} 天</span>`;
  if (over === 0) return `<span class="ddl-chip today" title="截止 ${escHtml(t.ddl)}">今日</span>`;
  return `<span class="ddl-chip future" title="截止 ${escHtml(t.ddl)}">${escHtml(t.ddl.slice(5))}</span>`;
}
/** Tasks due today or overdue (and not done/cancelled), sorted most-overdue → priority. */
function todayTodos(todos) {
  const today = todayStr();
  const rank = p => { const i = TODO_PRIORITIES.indexOf(p); return i < 0 ? 99 : i; };
  return todos
    .filter(t => t.ddl && t.ddl <= today && !DONE_STATUSES.has(t.status))
    .sort((a, b) => (a.ddl < b.ddl ? -1 : a.ddl > b.ddl ? 1 : rank(a.priority) - rank(b.priority)));
}

// Monotonic counter for client-minted fresh-launch terminal keys.
let newSessionCounter = 0;

// In-flight fresh launches whose real session id isn't in `allSessions` yet. Each renders as a
// placeholder row ("创建中…") in the sidebar — grouped under its target project/cwd — and is dropped
// the moment the real session surfaces (then the real row reattaches to the same live pty).
//   tempId -> { tempId, cli, cwd, projectId, todoKey, realId, bound, status, createdAt, knownIds }
const pendingLaunches = new Map();

/** Pseudo-session objects so pending launches flow through the normal sidebar grouping/rendering. */
function pendingPseudoSessions() {
  const now = Math.floor(Date.now() / 1000);
  return [...pendingLaunches.values()].map(p => ({
    sessionId: p.tempId,
    cli: p.cli,
    cwd: p.cwd,
    projectId: p.projectId,
    todoKey: p.todoKey,
    pinned: false,
    deleted: false,
    title: p.status === 'failed' ? '启动失败' : '创建中…',
    updatedAt: now,            // floats to the top of its group
    __pending: true,
    __status: p.status,
    // The placeholder's own sessionId is a client-side temp id ('new:N') the activity FSM never knows
    // about, so the spinner can't key off it. realId is the launch's activity key (the minted id for
    // claude/coco, the intent id for codex, from the __berth:launched frame) — let the row spin off it
    // so codex/coco (which surface a real row only well after IDLE_MS) still show "loading" from launch.
    __liveKey: p.realId || null,
  }));
}

/** Record a fresh-launch's real session id (from the server control frame) for exact correlation. */
function onLaunchIdentified(tempId, ctl) {
  const p = pendingLaunches.get(tempId);
  if (!p) return;
  p.realId = ctl.sessionId || null;
  p.bound = !!ctl.bound;
  // A refresh may already have ingested the session; try to associate immediately.
  if (reconcilePendingLaunches()) renderSidebar();
  // Even if the real session isn't ingested yet (codex/coco surface late), the placeholder now knows
  // its activity key — re-render so its spinner can light off the live 'running' state right away.
  else scheduleStatusRender();
}

/**
 * Match each pending launch to a now-ingested real session and hand the live terminal over to it.
 * Exact match by realId (claude/coco, bound) or, failing that, the newest same-cwd+cli session that
 * wasn't present at launch (codex / fallback). Mutates state only; returns true if anything changed.
 */
function reconcilePendingLaunches() {
  if (pendingLaunches.size === 0) return false;
  let changed = false;
  for (const [tempId, p] of pendingLaunches) {
    let realId = null;
    if (p.realId && allSessions.some(s => s.sessionId === p.realId)) {
      realId = p.realId;
    } else {
      const pendingCwd = cwdKey(p.cwd);
      const cand = allSessions.find(s => s.cli === p.cli && cwdKey(s.cwd) === pendingCwd && !p.knownIds.has(s.sessionId));
      if (cand) realId = cand.sessionId;
    }
    if (!realId) continue;
    associatePending(tempId, realId);
    changed = true;
  }
  return changed;
}

// Keep refreshing until every "创建中…" placeholder has matched its real session. The fixed
// post-launch refreshes (~launch+3.5s/+8s) are too short for a slow-starting CLI — notably coco,
// whose network/update check delays session.json well past that window — so without this the
// placeholder never flips to the real (titled) row. Stops as soon as nothing is pending, or after a cap.
let pendingPollTimer = null;
function ensurePendingReconcilePoll() {
  if (pendingPollTimer) return;
  const startedAt = Date.now();
  pendingPollTimer = setInterval(async () => {
    const stillWaiting = [...pendingLaunches.values()].some(p => p.status === 'launching');
    if (!stillWaiting || Date.now() - startedAt > 120000) {
      clearInterval(pendingPollTimer); pendingPollTimer = null; return;
    }
    try { await fetch('/api/refresh', { method: 'POST' }); await loadAll(); } catch (e) {}  // loadAll → reconcilePendingLaunches
  }, 4000);
}

/** Rekey the temp terminal entry onto its real session id and clear the placeholder. */
function associatePending(tempId, realId) {
  const entry = terminals.get(tempId);
  if (entry) {
    if (terminals.has(realId) && terminals.get(realId) !== entry) {
      // A real-id entry already exists (e.g. the user opened it): drop the duplicate temp one.
      disposeEntry(tempId);
    } else {
      entry.sessionId = realId;
      terminals.delete(tempId);
      terminals.set(realId, entry);
    }
  }
  if (activeTerminalId === tempId) activeTerminalId = realId;
  if (selectedId === tempId) selectedId = realId;
  // If this launch's terminal is the open one, keep it selected on the real id + fix the URL/header.
  if (activeTerminalId === realId) {
    selectedId = realId;
    const s = allSessions.find(x => x.sessionId === realId);
    const e = terminals.get(realId);
    if (s && e) updateTerminalHeader(s, e);
    if (location.hash.startsWith('#/sessions/')) setHash('#/sessions/' + encodeURIComponent(realId));
  }
  pendingLaunches.delete(tempId);
}

/** Mark a pending launch failed (ws errored/closed before its session surfaced) so the user can dismiss it. */
function markPendingFailed(tempId) {
  const p = pendingLaunches.get(tempId);
  if (!p || p.status === 'failed') return;
  p.status = 'failed';
  renderSidebar();
}

/** Remove a failed placeholder row and tear down its dead terminal entry. */
function dismissPending(tempId) {
  pendingLaunches.delete(tempId);
  disposeEntry(tempId);
  if (selectedId === tempId) selectedId = null;
  renderSidebar();
}

/** Activate the live (temp-keyed) terminal behind a placeholder row. */
function selectPending(tempId) {
  const entry = terminals.get(tempId);
  if (!entry) return;
  selectedId = tempId;
  document.querySelectorAll('.session-row').forEach(row => {
    row.classList.toggle('selected', row.dataset.id === tempId);
  });
  const p = pendingLaunches.get(tempId);
  const pseudo = pendingPseudoSessions().find(s => s.sessionId === tempId)
    || { sessionId: tempId, cli: p ? p.cli : '', cwd: p ? p.cwd : '', title: '创建中…' };
  activateEntry(entry, pseudo);
}

// ── Create-todo bar (⊕ 新建待办) ─────────────────────────────────────────────

// Create-todo bars are re-rendered by loadAll()/renderCurrentView(). Keep the
// in-flight lock and short-lived success notice outside renderCreateTodoBar so
// the nav-side composer cannot briefly become clickable again during refresh.
const createTodoBusyKeys = new Set();
const createTodoFeedbackByKey = new Map();

function createTodoStateKey(host, presetProject) {
  return host && host.id ? host.id : (presetProject ? `project:${presetProject}` : 'global');
}

function setCreateTodoStoredFeedback(key, cls, html, ttlMs) {
  const expiresAt = ttlMs ? Date.now() + ttlMs : 0;
  createTodoFeedbackByKey.set(key, { cls, html, expiresAt });
  if (ttlMs) {
    setTimeout(() => {
      const cur = createTodoFeedbackByKey.get(key);
      if (cur && cur.expiresAt === expiresAt) {
        createTodoFeedbackByKey.delete(key);
        const host = document.getElementById(key);
        const fb = host && host.querySelector('.create-todo-feedback');
        if (fb) fb.style.display = 'none';
      }
    }, ttlMs);
  }
}

function renderStoredCreateTodoFeedback(key, feedback) {
  const stored = createTodoFeedbackByKey.get(key);
  if (!stored) return;
  if (stored.expiresAt && stored.expiresAt <= Date.now()) {
    createTodoFeedbackByKey.delete(key);
    return;
  }
  feedback.style.display = 'block';
  feedback.className = `create-todo-feedback ${stored.cls}`;
  feedback.innerHTML = stored.html;
}

/**
 * Render the ⊕ 新建待办 input bar into a host element.
 * @param {HTMLElement} host   the .create-todo-bar container (cleared + rebuilt)
 * @param {string|null} presetProject  workspace project name to preset projectId, or null (Now)
 */
function renderCreateTodoBar(host, presetProject) {
  if (!host) return;
  const stateKey = createTodoStateKey(host, presetProject);
  const isNavCreate = host.classList.contains('nav-create');
  const inputHtml = isNavCreate
    ? '<textarea class="create-todo-input" rows="4" placeholder="新建任务…（⌘/Ctrl+回车提交，可粘贴图片）" autocomplete="off" spellcheck="false"></textarea>'
    : '<input class="create-todo-input" type="text" placeholder="新建任务…（⌘/Ctrl+回车提交，可粘贴图片）" autocomplete="off" spellcheck="false">';
  host.innerHTML = `
    ${inputHtml}
    <button class="create-todo-btn">${icon('plus')} 新建任务</button>
    <div class="create-todo-thumbs" style="display:none"></div>
    <div class="create-todo-feedback" style="display:none"></div>
  `;
  const input = host.querySelector('.create-todo-input');
  const btn = host.querySelector('.create-todo-btn');
  const feedback = host.querySelector('.create-todo-feedback');
  const thumbs = host.querySelector('.create-todo-thumbs');

  const idleButtonHtml = btn.innerHTML;
  renderStoredCreateTodoFeedback(stateKey, feedback);

  // Submit is single-flight per rendered bar: while a POST/refresh is in flight
  // the input, main button, and any confirmation chips are disabled. The busy
  // bit is stored outside this render so a loadAll() re-render cannot unlock it.
  const setSubmitting = (v) => {
    if (v) createTodoBusyKeys.add(stateKey);
    else createTodoBusyKeys.delete(stateKey);
    host.classList.toggle('is-submitting', v);
    host.setAttribute('aria-busy', v ? 'true' : 'false');
    input.disabled = v;
    btn.disabled = v;
    btn.classList.toggle('is-submitting', v);
    btn.innerHTML = v ? `${icon('loader')} 创建中…` : idleButtonHtml;
    feedback.querySelectorAll('button').forEach(b => { b.disabled = v; });
  };
  setSubmitting(createTodoBusyKeys.has(stateKey));

  const pendingImages = [];   // data URLs
  const renderThumbs = () => {
    thumbs.innerHTML = '';
    thumbs.style.display = pendingImages.length ? 'flex' : 'none';
    pendingImages.forEach((src, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'todo-thumb';
      wrap.innerHTML = `<img src="${src}"><button class="todo-thumb-x" title="移除">${icon('x')}</button>`;
      wrap.querySelector('.todo-thumb-x').addEventListener('click', () => { pendingImages.splice(i, 1); renderThumbs(); });
      thumbs.appendChild(wrap);
    });
  };

  input.addEventListener('paste', e => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    let handled = false;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (file) {
          handled = true;
          const reader = new FileReader();
          reader.onload = () => { pendingImages.push(reader.result); renderThumbs(); };
          reader.readAsDataURL(file);
        }
      }
    }
    if (handled) e.preventDefault();
  });

  const submit = () => {
    if (createTodoBusyKeys.has(stateKey)) return;
    const text = input.value.trim();
    if (!text && pendingImages.length === 0) return;
    const images = pendingImages.slice();
    postCreateTodo({ text, projectId: presetProject || undefined, images }, feedback, input, setSubmitting, stateKey);
    pendingImages.length = 0; renderThumbs();
  };

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', e => {
    // Plain Enter no longer submits — only ⌘+Enter (mac) / Ctrl+Enter submits.
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) submit();
    }
  });
}

/**
 * POST /api/todos with the given body and render the result into `feedback`.
 * `presetProject` is implied by the body.projectId on the original submit; we keep
 * the original text around for re-POST flows (duplicate / needs-confirm chips).
 */
async function postCreateTodo(body, feedback, input, setSubmitting, stateKey) {
  if (stateKey && createTodoBusyKeys.has(stateKey)) return;
  if (setSubmitting) setSubmitting(true);
  if (stateKey) setCreateTodoStoredFeedback(stateKey, 'pending', '…提交中', 0);
  feedback.style.display = 'block';
  feedback.className = 'create-todo-feedback pending';
  feedback.textContent = '…提交中';
  let result;
  try {
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    result = await res.json();
    if (!res.ok) {
      feedback.className = 'create-todo-feedback error';
      feedback.textContent = '出错：' + (result && result.error ? result.error : res.statusText);
      if (stateKey) setCreateTodoStoredFeedback(stateKey, 'error', escHtml(feedback.textContent), 0);
      if (setSubmitting) setSubmitting(false);
      return;
    }
  } catch (err) {
    feedback.className = 'create-todo-feedback error';
    feedback.textContent = '网络错误：' + (err && err.message ? err.message : String(err));
    if (stateKey) setCreateTodoStoredFeedback(stateKey, 'error', escHtml(feedback.textContent), 0);
    if (setSubmitting) setSubmitting(false);
    return;
  } finally {
    // Unlock after the whole branch below finishes; for created tasks that includes
    // loadAll(), otherwise renderCurrentView() would recreate an enabled nav composer
    // before the success state is visible.
  }

  try {
    if (result.status === 'created') {
      feedback.className = 'create-todo-feedback ok';
      const proj = result.record && result.record.project ? result.record.project : '（无项目）';
      const title = result.record ? result.record.title : body.text;
      const okHtml = `${icon('circle-check')} 已建: ${escHtml(title)} → ${escHtml(proj)}`;
      if (stateKey) setCreateTodoStoredFeedback(stateKey, 'ok', okHtml, 4000);
      feedback.innerHTML = okHtml;
      if (input) input.value = '';
      await loadAll();
      // If a project workspace is open, re-render it so the new task shows up immediately.
      const wsTitle = document.getElementById('workspace-title');
      const wsProjectId = wsTitle ? wsTitle.dataset.projectId : null;
      if (document.getElementById('workspace-view').style.display !== 'none' && wsProjectId) {
        renderProjectSidebar(wsProjectId);
        renderWorkspace(wsProjectId);
      }
      return;
    }

    if (result.status === 'duplicate') {
      if (stateKey) createTodoFeedbackByKey.delete(stateKey);
      feedback.className = 'create-todo-feedback warn';
      feedback.innerHTML = `疑似已存在：<span class="dup-title">${escHtml(result.existing.title)}</span> `;
      const again = document.createElement('button');
      again.className = 'chip chip-action';
      again.textContent = '仍要新建';
      again.addEventListener('click', () => {
        postCreateTodo({ ...body, confirm: true }, feedback, input, setSubmitting, stateKey);
      });
      feedback.appendChild(again);
      return;
    }

    if (result.status === 'needs-confirm') {
      if (stateKey) createTodoFeedbackByKey.delete(stateKey);
      feedback.className = 'create-todo-feedback confirm';
      feedback.innerHTML = `<span class="confirm-label">选择项目：</span>`;
      const chipWrap = document.createElement('span');
      chipWrap.className = 'chip-row';

      for (const cand of (result.candidates || [])) {
        const chip = document.createElement('button');
        chip.className = 'chip chip-candidate';
        const pct = Math.round((cand.confidence || 0) * 100);
        chip.innerHTML = `${escHtml(cand.name)} <span class="chip-conf">${pct}%</span>`;
        chip.addEventListener('click', () => {
          postCreateTodo({ ...body, text: result.text, projectId: cand.name, confirm: true }, feedback, input, setSubmitting, stateKey);
        });
        chipWrap.appendChild(chip);
      }

      if (result.needNewProject) {
        const newName = result.suggestedNewName || result.text;
        const chip = document.createElement('button');
        chip.className = 'chip chip-newproject';
        chip.innerHTML = `${icon('plus')}新建项目「${escHtml(newName)}」`;
        chip.addEventListener('click', () => {
          postCreateTodo({ ...body, text: result.text, projectId: newName, confirm: true, createOption: true }, feedback, input, setSubmitting, stateKey);
        });
        chipWrap.appendChild(chip);
      }

      // Always offer a taskless (no-project) confirm so an ambiguous todo can still be filed.
      const noneChip = document.createElement('button');
      noneChip.className = 'chip chip-none';
      noneChip.innerHTML = `${icon('ban')} 无项目`;
      noneChip.addEventListener('click', () => {
        postCreateTodo({ ...body, text: result.text, projectId: undefined, confirm: true }, feedback, input, setSubmitting, stateKey);
      });
      chipWrap.appendChild(noneChip);

      feedback.appendChild(chipWrap);
      return;
    }

    // Unknown status — surface raw
    feedback.className = 'create-todo-feedback error';
    feedback.textContent = '未知响应：' + JSON.stringify(result);
    if (stateKey) setCreateTodoStoredFeedback(stateKey, 'error', escHtml(feedback.textContent), 0);
  } finally {
    if (setSubmitting) setSubmitting(false);
  }
}

// ── API calls ──────────────────────────────────────────────────────────────

async function loadAll() {
  const [sessRes, projRes, todoRes] = await Promise.all([
    fetch('/api/sessions'),
    fetch('/api/projects'),
    fetch('/api/todos'),
  ]);
  allSessions = await sessRes.json();
  syncLiveStatusFromSessions(allSessions);   // reconcile live status with the registry snapshot
  const pData = await projRes.json();
  projects = (pData.projects || []);
  const tData = await todoRes.json();
  allTodos = (tData.todos || []);

  // Hand any in-flight placeholder launches over to their now-ingested real sessions.
  reconcilePendingLaunches();

  // Re-render current view
  renderCurrentView();
  updateNavUnreadIndicators();
}

/** Reconcile liveStatus with the `activity` field on /api/sessions (the registry is the source of
 *  truth; the /status socket pushes faster deltas between loadAll calls). */
function syncLiveStatusFromSessions(sessions) {
  const next = new Map();
  for (const s of sessions) {
    if (s.activity === 'running' || s.activity === 'settled') next.set(s.sessionId, s.activity);
  }
  liveStatus = next;
}

/** Legacy compat: loadSessions used by refreshSessions */
async function loadSessions() {
  await loadAll();
}

async function pin(sessionId, on) {
  await fetch('/api/pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, on })
  });
  const s = allSessions.find(x => x.sessionId === sessionId);
  if (s) s.pinned = on;
  renderSidebar();
}

async function assign(sessionId, projectId) {
  await fetch('/api/attach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, projectId: projectId || null })
  });
  const s = allSessions.find(x => x.sessionId === sessionId);
  if (s) s.projectId = projectId || null;
  renderSidebar();
}

/**
 * Assign an EXISTING session to a task (edge), or detach it (todoKey null).
 * Optimistically updates local state (todo.sessions[] + session.todoKey) then re-renders
 * the workspace. `projectName`, when given, co-confirms the session under that project.
 */
async function assignTask(sessionId, todoKey, projectName) {
  try {
    await fetch('/api/edge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, todoKey: todoKey || null, projectId: projectName || undefined }),
    });
  } catch (e) { console.warn('[berth] assignTask failed', e); }

  // Remove this session from any todo's sessions[], then add to the target.
  for (const t of allTodos) {
    if (Array.isArray(t.sessions)) {
      const i = t.sessions.indexOf(sessionId);
      if (i >= 0) t.sessions.splice(i, 1);
    }
  }
  if (todoKey) {
    const tt = allTodos.find(t => t.id === todoKey);
    if (tt) { if (!Array.isArray(tt.sessions)) tt.sessions = []; tt.sessions.push(sessionId); }
  }
  const s = allSessions.find(x => x.sessionId === sessionId);
  if (s) { s.todoKey = todoKey || null; if (projectName) s.projectId = projectName; }

  // Re-render whatever view is visible (expanded tasks are preserved via expandedTodos).
  const wsVisible = document.getElementById('workspace-view').style.display !== 'none';
  if (wsVisible && projectName) renderWorkspace(projectName);
  else renderCurrentView();
}

/**
 * Call POST /api/sessions/:id/consolidate — Berth reads this session's transcript and updates its
 * linked task/project context file (appends a progress-log line, refreshes the status section).
 * @param {string} sessionId
 * @param {HTMLButtonElement|null} btn  the ⟳ button in a session row (may be null)
 */
async function consolidateSession(sessionId, btn) {
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  const stopHeartbeat = startAgentHeartbeat(btn);
  try {
    const res = await fetch('/api/sessions/' + encodeURIComponent(sessionId) + '/consolidate', { method: 'POST' });
    const d = await res.json().catch(() => ({ error: res.statusText }));
    if (!res.ok) { alert('刷新上下文失败: ' + contextAgentErrorText(d, res.statusText)); return; }
    const touched = [...(d.changed || []), ...(d.added || [])];
    alert('已刷新上下文' + (touched.length ? '：' + touched.join('、') : '（无新增进展）'));
  } catch (e) {
    alert('刷新上下文失败: ' + e.message);
  } finally {
    stopHeartbeat();
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  }
}

/**
 * Call POST /api/sessions/:id/title — AI-generate and persist a title.
 * Updates in-memory session, re-renders sidebar rows + header.
 * @param {string} sessionId
 * @param {HTMLButtonElement|null} rowBtn  the ✨ button in a session row (may be null)
 */
async function generateTitle(sessionId, rowBtn) {
  // Collect all buttons associated with this session so we can update them all
  const btns = [];
  if (rowBtn) btns.push(rowBtn);
  const headerBtn = document.getElementById('header-gen-title-btn');
  if (headerBtn && sessionId === selectedId) btns.push(headerBtn);

  // Loading state
  const origTexts = btns.map(b => b.textContent);
  btns.forEach(b => { b.textContent = '…'; b.disabled = true; b.classList.remove('error'); });
  const stopHeartbeat = startAgentHeartbeat(btns);

  try {
    const res = await fetch('/api/sessions/' + encodeURIComponent(sessionId) + '/title', { method: 'POST' });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({ error: res.statusText }));
      console.warn('[berth] generateTitle error:', errJson);
      // An auth/timeout block is actionable — tell the user how to fix it instead of a silent flash.
      if (errJson && errJson.blocked) alert('AI 标题失败: ' + contextAgentErrorText(errJson, res.statusText));
      btns.forEach((b, i) => { b.textContent = origTexts[i]; b.disabled = false; b.classList.add('error'); });
      // Flash error for 2s then restore
      setTimeout(() => btns.forEach(b => b.classList.remove('error')), 2000);
      return;
    }
    const data = await res.json();
    const newTitle = data.title;
    if (!newTitle) throw new Error('empty title response');

    updateSessionTitleLocal(sessionId, newTitle);

    // Restore button text
    btns.forEach((b, i) => { b.textContent = origTexts[i]; b.disabled = false; });
  } catch (err) {
    console.warn('[berth] generateTitle exception:', err);
    btns.forEach((b, i) => { b.textContent = origTexts[i]; b.disabled = false; b.classList.add('error'); });
    setTimeout(() => btns.forEach(b => b.classList.remove('error')), 2000);
  } finally {
    stopHeartbeat();
  }
}

async function generateProgressSummary(todoId, btn, noteEl) {
  const orig = btn.innerHTML;
  btn.innerHTML = '…'; btn.disabled = true; btn.classList.remove('error');
  const stopHeartbeat = startAgentHeartbeat(btn);
  try {
    const res = await fetch('/api/todos/' + encodeURIComponent(todoId) + '/progress-summary', { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.summary) {
      if (d && d.blocked) alert('生成进展摘要失败: ' + contextAgentErrorText(d, res.statusText));
      btn.innerHTML = orig; btn.disabled = false; btn.classList.add('error');
      setTimeout(() => btn.classList.remove('error'), 2000);
      return;
    }
    if (noteEl) noteEl.textContent = d.summary;
    const todo = allTodos.find(x => x.id === todoId);
    if (todo) todo.progress = d.summary;
    btn.innerHTML = orig; btn.disabled = false;
  } catch {
    btn.innerHTML = orig; btn.disabled = false; btn.classList.add('error');
    setTimeout(() => btn.classList.remove('error'), 2000);
  } finally {
    stopHeartbeat();
  }
}

function openTaskDoc(t) {
  if (t.detailDoc) { openDocEditor(t.detailDoc, t.title); return; }
  fetch('/api/context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'task', key: t.id, title: t.title }) })
    .then(r => r.json())
    .then(d => { if (d.ref) { t.detailDoc = d.ref; openDocEditor(d.ref, t.title); } })
    .catch(err => console.warn('[berth] openTaskDoc failed', err));
}

function updateSessionTitleLocal(sessionId, title) {
  const s = allSessions.find(x => x.sessionId === sessionId);
  if (s) s.title = title;
  if (sessionId === selectedId) {
    document.getElementById('main-title').textContent = displayTitle(s || { title });
  }
  rerenderSessionTitleViews();
}

function rerenderSessionTitleViews() {
  const sidebar = document.getElementById('sidebar');
  const sidebarVisible = sidebar && sidebar.style.display !== 'none';
  const listTop = document.getElementById('session-list')?.scrollTop || 0;
  if (sidebarVisible) renderSidebar();
  const list = document.getElementById('session-list');
  if (list) list.scrollTop = listTop;

  if (document.getElementById('now-view')?.style.display !== 'none') renderNow();
  if (document.getElementById('projects-view')?.style.display !== 'none') renderProjects();
  if (document.getElementById('workspace-view')?.style.display !== 'none') {
    const name = document.getElementById('workspace-title').dataset.projectId;
    if (name) renderWorkspace(name);
  }
}

async function saveSessionTitle(sessionId, title) {
  const res = await fetch('/api/sessions/' + encodeURIComponent(sessionId) + '/title', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  updateSessionTitleLocal(sessionId, data.title || title);
}

function startSessionTitleEdit(row, session) {
  if (!row || !session || session.__pending || session.deleted) return;
  const previous = session.title && session.title.trim() ? session.title.trim() : '';
  editingSessionTitle = { sessionId: session.sessionId, previous, draft: previous, selectAll: true, selectionStart: 0, selectionEnd: previous.length };
  mountSessionTitleInput(row, session);
}

function mountSessionTitleInput(row, session) {
  if (!row || !session || !editingSessionTitle || editingSessionTitle.sessionId !== session.sessionId) return;
  const titleEl = row.querySelector('.row-title');
  if (!titleEl) return;
  row.classList.add('editing-title');
  row.draggable = false;
  titleEl.classList.remove('untitled');
  titleEl.innerHTML = `<input class="row-title-input" type="text" value="${escHtml(editingSessionTitle.draft)}" placeholder="输入会话标题" spellcheck="false" autocomplete="off">`;
  const input = titleEl.querySelector('input');
  const shouldSelectAll = !!editingSessionTitle.selectAll;
  const selectionStart = editingSessionTitle.selectionStart;
  const selectionEnd = editingSessionTitle.selectionEnd;
  editingSessionTitle.selectAll = false;
  let done = false;
  const rememberSelection = () => {
    if (!editingSessionTitle || editingSessionTitle.sessionId !== session.sessionId) return;
    editingSessionTitle.selectionStart = input.selectionStart;
    editingSessionTitle.selectionEnd = input.selectionEnd;
  };
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const state = editingSessionTitle;
    editingSessionTitle = null;
    row.classList.remove('editing-title');
    row.draggable = true;
    const next = input.value.trim();
    if (!commit || !next || !state || next === state.previous) {
      renderSidebar();
      return;
    }
    titleEl.classList.add('saving');
    try {
      await saveSessionTitle(session.sessionId, next);
    } catch (e) {
      renderSidebar();
      alert('标题保存失败：' + (e && e.message ? e.message : String(e)));
    }
  };
  input.addEventListener('input', () => {
    if (editingSessionTitle && editingSessionTitle.sessionId === session.sessionId) editingSessionTitle.draft = input.value;
    rememberSelection();
  });
  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('mousedown', e => e.stopPropagation());
  input.addEventListener('keyup', rememberSelection);
  input.addEventListener('select', rememberSelection);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => {
    if (renderingSidebar || !input.isConnected) return;
    finish(true);
  });
  requestAnimationFrame(() => {
    if (!input.isConnected) return;
    input.focus();
    if (shouldSelectAll) {
      input.select();
    } else if (selectionStart != null && selectionEnd != null) {
      const max = input.value.length;
      input.setSelectionRange(Math.min(selectionStart, max), Math.min(selectionEnd, max));
    }
  });
}

function startHeaderSessionTitleEdit(session) {
  const titleEl = document.getElementById('main-title');
  if (!titleEl || !session || session.deleted || titleEl.classList.contains('editing-title')) return;
  const previous = session.title && session.title.trim() ? session.title.trim() : '';
  titleEl.classList.add('editing-title');
  titleEl.innerHTML = `<input class="main-title-input" type="text" value="${escHtml(previous)}" placeholder="输入会话标题" spellcheck="false" autocomplete="off">`;
  const input = titleEl.querySelector('input');
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    titleEl.classList.remove('editing-title');
    const next = input.value.trim();
    if (!commit || !next || next === previous) {
      titleEl.textContent = displayTitle(session);
      return;
    }
    try {
      await saveSessionTitle(session.sessionId, next);
    } catch (e) {
      titleEl.textContent = displayTitle(session);
      alert('标题保存失败：' + (e && e.message ? e.message : String(e)));
    }
  };
  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('mousedown', e => e.stopPropagation());
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

// ── Terminal Pool ──────────────────────────────────────────────────────────

/**
 * Dispose a terminal pool entry: close ws, dispose term, remove el, delete from map.
 */
function disposeEntry(sessionId, opts = {}) {
  const entry = terminals.get(sessionId);
  if (!entry) return;
  // LRU eviction (opts.kill) must actually END the agent, not just close the view — otherwise an
  // evicted session leaves a view-less PTY running forever (orphan). Send {t:'kill'} before closing
  // so the server's killPty runs. Only the eviction path passes kill; × close-view stays detach-only.
  if (opts.kill) {
    try { if (entry.ws && entry.ws.readyState === WebSocket.OPEN) entry.ws.send(JSON.stringify({ t: 'kill' })); } catch (e) {}
  }
  // Tear down the ResizeObserver + window resize listener stashed on the ws (set in
  // connectWsForEntry/connectFreshWs), else they leak on every LRU eviction / close.
  try { if (entry.ws && entry.ws._resizeObserver) entry.ws._resizeObserver.disconnect(); } catch (e) {}
  try { if (entry.ws && entry.ws._onResize) window.removeEventListener('resize', entry.ws._onResize); } catch (e) {}
  try { if (entry.ws) entry.ws.close(); } catch (e) {}
  try { entry.term.dispose(); } catch (e) {}
  try { entry.el.remove(); } catch (e) {}
  terminals.delete(sessionId);
  persistPoolMembership();
  if (activeTerminalId === sessionId) activeTerminalId = null;
}

// ── Warm cache: membership persistence, eviction policy, entry creation, preload queue ──────────

/** Persist the set of cached (real) session ids so a page reload can re-attach live ones (§rehydrate).
 *  Temp 'new:' launch keys are skipped — they're not resumable until reconcile assigns a real id. */
function persistPoolMembership() {
  try {
    const ids = [...terminals.keys()].filter(id => !id.startsWith('new:'));
    localStorage.setItem('berthPool', JSON.stringify(ids));
  } catch (e) {}
}

function sessionIsPinned(sessionId) {
  const s = allSessions.find(x => x.sessionId === sessionId);
  return !!(s && s.pinned);
}

/**
 * Choose which pooled entry to evict when at cap. Never evicts pinned or running sessions; among the
 * rest prefers warmed-but-never-viewed entries, then least-recently-used. Falls back to absolute LRU
 * only if every slot is protected (so opening a new session is never hard-blocked).
 */
function pickEvictionVictim(excludeId) {
  const protectedFn = sid => sessionIsPinned(sid) || liveStatus.get(sid) === 'running';
  let pool = [...terminals.entries()].filter(([sid]) => sid !== excludeId && !protectedFn(sid));
  if (pool.length === 0) pool = [...terminals.entries()].filter(([sid]) => sid !== excludeId);
  pool.sort((a, b) => {
    const aw = a[1].warmedOnly ? 0 : 1, bw = b[1].warmedOnly ? 0 : 1;
    if (aw !== bw) return aw - bw;            // never-viewed warm entries go first
    return a[1].lastUsed - b[1].lastUsed;      // then oldest
  });
  return pool.length ? pool[0][0] : null;
}

/** Evict (killing the victim's pty) if the pool is at capacity and we need a slot for `forId`. */
function evictIfFull(forId) {
  if (terminals.size < TERMINAL_POOL_MAX) return;
  const victim = pickEvictionVictim(forId);
  if (victim) disposeEntry(victim, { kill: true });
}

/**
 * The terminal stream is text-only, so an image paste can't ride through xterm's onData. Intercept
 * paste on the terminal element: if the clipboard holds an image, swallow it and ship the base64 to
 * the server (which saves it and types the file path into the CLI). Text pastes fall through to
 * xterm untouched. Capture phase so we run — and can stopPropagation — before xterm's own handler.
 */
function wireTerminalImagePaste(entry) {
  entry.el.addEventListener('paste', e => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    let file = null;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) { file = it.getAsFile(); break; }
    }
    if (!file) return;   // not an image → let xterm paste it as text
    e.preventDefault();
    e.stopPropagation();
    const reader = new FileReader();
    reader.onload = () => {
      const ws = entry.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: 'img', name: file.name || 'paste', d: reader.result }));
      }
    };
    reader.readAsDataURL(file);
  }, true);
}

/** Create a hidden pool entry (xterm + element) for sessionId, evicting first if at cap. Does NOT
 *  connect a WS or activate — callers do that. Shared by open + warm paths. */
function createPoolEntry(sessionId) {
  evictIfFull(sessionId);
  const termContainer = document.getElementById('terminal');
  const el = document.createElement('div');
  el.className = 'term-instance';
  el.style.display = 'none';
  el.style.background = currentTerminalTheme().background; // backdrop while xterm lays out — no black flash
  termContainer.appendChild(el);
  const term = new Terminal({
    theme: currentTerminalTheme(),
    fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    scrollback: 5000,
    allowTransparency: false,
    convertEol: false,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);
  const entry = { sessionId, term, ws: null, fit, el, lastUsed: Date.now(), warmedOnly: false };
  terminals.set(sessionId, entry);
  wireTerminalImagePaste(entry);
  persistPoolMembership();
  return entry;
}

/** Warm a session in the background: create a hidden entry + connect its WS, without activating it.
 *  No-ops if it's already pooled. Returns the entry (or null if the session is unknown). */
function warmSession(sessionId) {
  const existing = terminals.get(sessionId);
  if (existing) return existing;
  const session = allSessions.find(s => s.sessionId === sessionId);
  if (!session) return null;
  const entry = createPoolEntry(sessionId);
  entry.warmedOnly = true;
  requestAnimationFrame(() => connectWsForEntry(entry, session));
  return entry;
}

// Serial warm queue — the throttle: only one WS handshake (and thus at most one cold `--resume`) is
// in flight at a time. Each id waits for its WS to open/close (or an 8s cap) before the next starts.
const warmQueue = [];
let warming = false;
function enqueueWarm(ids) {
  for (const id of ids) {
    if (id && !id.startsWith('new:') && !terminals.has(id) && !warmQueue.includes(id)) warmQueue.push(id);
  }
  if (!warming) drainWarmQueue();
}
function drainWarmQueue() {
  const next = warmQueue.shift();
  if (next === undefined) { warming = false; return; }
  warming = true;
  if (terminals.has(next)) { drainWarmQueue(); return; }   // got opened in the meantime
  const entry = warmSession(next);
  if (!entry) { drainWarmQueue(); return; }
  const start = Date.now();
  const tick = () => {
    const ws = entry.ws;
    const settled = (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSED));
    if (settled || Date.now() - start > 8000) setTimeout(drainWarmQueue, 150);
    else setTimeout(tick, 120);
  };
  tick();
}

// Startup preload + cross-reload rehydrate. Runs once, after both the session list and the first
// /status snapshot are available (we need liveStatus to know which cached sessions are cheap to
// re-attach vs. would cold-resume).
let preloadDone = false;
let firstSnapSeen = false;
function maybePreloadAndRehydrate() {
  if (preloadDone || !firstSnapSeen) return;
  if (!allSessions || allSessions.length === 0) return;
  if (typeof selectPreloadSessions !== 'function') return;   // ESM helper not loaded yet — retry next snap
  preloadDone = true;
  // Read cached membership BEFORE warming (warming rewrites berthPool via persistPoolMembership).
  let cached = [];
  try { cached = JSON.parse(localStorage.getItem('berthPool') || '[]'); } catch (e) {}
  // Priority 5 (pinned → unread → recent) — may cold-resume, serially.
  const preload = selectPreloadSessions(allSessions, getLastSeen(), getUnreadEpoch(), 5, getManualUnread());
  // Rehydrate: previously-cached sessions that still have a LIVE pty → cheap re-attach only. Cold
  // cached sessions are NOT auto-resumed on reload (avoids a resume storm); they warm on click.
  const liveCached = cached.filter(id => liveStatus.has(id) && !preload.includes(id));
  enqueueWarm([...preload, ...liveCached]);
}

/**
 * Activate an existing terminal entry: hide all others, show this one, fit, focus.
 */
function activateEntry(entry, session) {
  // Hide all terminal instances
  for (const [sid, e] of terminals) {
    e.el.style.display = 'none';
  }
  // Show this one
  entry.el.style.display = 'block';
  entry.lastUsed = Date.now();
  activeTerminalId = entry.sessionId;

  // Update header
  updateTerminalHeader(session, entry);

  // Fit and focus. Double-rAF so the pane geometry has settled after the display flip before we
  // measure — otherwise the first frame can still read the old (collapsed) size.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fitAndResize(entry);
    if (editingSessionTitle) return;
    if (document.activeElement && document.activeElement.matches('input, textarea, [contenteditable="true"]')) return;
    try { entry.term.focus(); } catch (e) {}
  }));
}

/**
 * Update the terminal header for the given session and entry.
 */
function updateTerminalHeader(session, entry) {
  const titleEl = document.getElementById('main-title');
  titleEl.textContent = displayTitle(session);
  titleEl.title = '双击编辑标题';
  titleEl.ondblclick = () => startHeaderSessionTitleEdit(session);

  const metaEl = document.getElementById('main-meta');
  metaEl.innerHTML = `<span class="cli-badge ${escHtml(session.cli)}">${escHtml(session.cli)}</span>`;
  if (session.cwd) {
    metaEl.insertAdjacentHTML('beforeend', `<span style="margin-left:6px;color:var(--text-muted)">${escHtml(shortCwd(session.cwd))}</span>`);
  }

  // ✨ Generate-title button in header
  const existingGenBtn = document.getElementById('header-gen-title-btn');
  if (existingGenBtn) existingGenBtn.remove();
  const genBtn = document.createElement('button');
  genBtn.id = 'header-gen-title-btn';
  genBtn.className = 'btn-gen-title';
  genBtn.title = '用 AI 生成标题';
  genBtn.innerHTML = icon('sparkles');
  genBtn.addEventListener('click', () => generateTitle(session.sessionId));
  const mainHeader = document.getElementById('main-header');
  const statusBadge = document.getElementById('status-badge');
  mainHeader.insertBefore(genBtn, statusBadge);

  // ■ End-session (kill) button — actually stops the agent
  const existingKillBtn = document.getElementById('header-kill-btn');
  if (existingKillBtn) existingKillBtn.remove();
  const killBtn = document.createElement('button');
  killBtn.id = 'header-kill-btn';
  killBtn.className = 'btn-kill-terminal';
  killBtn.title = '结束会话（停止 agent 进程）';
  killBtn.innerHTML = icon('square');
  killBtn.addEventListener('click', () => killActiveTerminal());
  mainHeader.appendChild(killBtn);

  // × Close-view button — detaches; the agent keeps running in the background
  const existingCloseBtn = document.getElementById('header-close-btn');
  if (existingCloseBtn) existingCloseBtn.remove();
  const closeBtn = document.createElement('button');
  closeBtn.id = 'header-close-btn';
  closeBtn.className = 'btn-close-terminal';
  closeBtn.title = '关闭视图（agent 后台继续运行，点会话可重新接入）';
  closeBtn.innerHTML = icon('x');
  closeBtn.addEventListener('click', () => closeActiveTerminal());
  mainHeader.appendChild(closeBtn);

  // Update status badge from ws state
  updateStatusBadge(entry);
}

/**
 * Update the status badge based on the entry's ws state.
 */
function updateStatusBadge(entry) {
  const statusBadge = document.getElementById('status-badge');
  if (!statusBadge) return;
  if (!entry || !entry.ws) {
    statusBadge.textContent = '';
    statusBadge.className = '';
    return;
  }
  const rs = entry.ws.readyState;
  if (rs === WebSocket.CONNECTING) {
    statusBadge.textContent = 'connecting…';
    statusBadge.className = 'connecting';
  } else if (rs === WebSocket.OPEN) {
    statusBadge.textContent = 'connected';
    statusBadge.className = 'connected';
  } else {
    statusBadge.textContent = 'closed';
    statusBadge.className = 'disconnected';
  }
}

/**
 * Close the currently active terminal: dispose it and show empty state.
 */
function clearTerminalHeader() {
  showEmptyState();
  selectedId = null;
  document.querySelectorAll('.session-row').forEach(row => row.classList.remove('selected'));
  for (const id of ['header-gen-title-btn', 'header-kill-btn', 'header-close-btn']) {
    const b = document.getElementById(id); if (b) b.remove();
  }
  document.getElementById('main-title').textContent = 'Berth';
  document.getElementById('main-meta').innerHTML = '';
  const statusBadge = document.getElementById('status-badge');
  statusBadge.textContent = ''; statusBadge.className = '';
}

/** Close the VIEW: detach the socket but leave the agent running in the background. */
function closeActiveTerminal() {
  if (!activeTerminalId) return;
  disposeEntry(activeTerminalId);   // closes the ws (server keeps the pty alive)
  clearTerminalHeader();
}

/** End the session for real: tell the server to kill the pty, then drop the view. */
function killActiveTerminal() {
  if (!activeTerminalId) return;
  const entry = terminals.get(activeTerminalId);
  if (entry && entry.ws && entry.ws.readyState === WebSocket.OPEN) {
    try { entry.ws.send(JSON.stringify({ t: 'kill' })); } catch (e) {}
  }
  disposeEntry(activeTerminalId);
  clearTerminalHeader();
}

/**
 * Show the empty state placeholder.
 */
function showEmptyState() {
  const emptyEl = document.getElementById('empty-state');
  if (emptyEl) emptyEl.style.display = 'flex';
}

/**
 * Hide the empty state placeholder.
 */
function hideEmptyState() {
  const emptyEl = document.getElementById('empty-state');
  if (emptyEl) emptyEl.style.display = 'none';
}

/**
 * Open or activate a terminal for sessionId.
 * - If already in pool with live ws: activate instantly (no re-spawn).
 * - Otherwise: dispose stale entry if any, create fresh terminal + WS.
 * - LRU cap: evict oldest entry when pool exceeds TERMINAL_POOL_MAX.
 */
function openTerminalFor(sessionId) {
  // Switch to sessions mode for terminal context
  if (currentMode !== 'sessions') {
    setMode('sessions');
  }
  selectSession(sessionId);
}

/**
 * Core terminal open/activate logic (called by selectSession).
 */
function openTerminalForSession(sessionId) {
  const session = allSessions.find(s => s.sessionId === sessionId);
  if (!session) return;

  const wasUnread = markSeen(sessionId);   // clears it from the inbox / unread dots
  if (wasUnread) refreshUnreadUI();        // recompute aggregate (project/path/task) dots too
  hideEmptyState();

  const existing = terminals.get(sessionId);

  // Step 1: already pooled — reuse the terminal instance (this is the warm cache). Whether the WS is
  // open, connecting, or closed, we NEVER dispose+recreate (that would lose the rendered buffer = a
  // reload). Show the cached buffer immediately, then reconnect in place if the socket is dead.
  if (existing) {
    existing.warmedOnly = false;                 // user looked at it → no longer a throwaway warm slot
    existing.lastUsed = Date.now();
    activateEntry(existing, session);
    const rs = existing.ws ? existing.ws.readyState : WebSocket.CLOSED;
    if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) return;   // live view — nothing to do
    // Socket dead → reconnect on the SAME term. reset() first so the server's scrollback replay
    // doesn't duplicate the already-rendered buffer. Live pty → cheap re-attach; cold → resume.
    try { existing.term.reset(); } catch (e) {}
    requestAnimationFrame(() => connectWsForEntry(existing, session));
    return;
  }

  // Step 2: not pooled — create a fresh entry (evicting an idle slot if at cap), activate, connect.
  const entry = createPoolEntry(sessionId);
  activateEntry(entry, session);
  requestAnimationFrame(() => {
    try { entry.fit.fit(); } catch (e) {}
    connectWsForEntry(entry, session);
  });
}

/**
 * Connect a WebSocket for a pool entry.
 */
function connectWsForEntry(entry, session) {
  const statusBadge = document.getElementById('status-badge');

  const cols = entry.term.cols || 120;
  const rows = entry.term.rows || 30;
  const wsUrl = `ws://${location.host}/pty?sessionId=${encodeURIComponent(session.sessionId)}&cols=${cols}&rows=${rows}`;
  const ws = new WebSocket(wsUrl);
  entry.ws = ws;

  // Update badge immediately for this entry (only if it's active)
  if (activeTerminalId === entry.sessionId && statusBadge) {
    statusBadge.textContent = 'connecting…';
    statusBadge.className = 'connecting';
  }

  ws.onopen = () => {
    if (activeTerminalId === entry.sessionId && statusBadge) {
      statusBadge.textContent = 'connected';
      statusBadge.className = 'connected';
    }
  };

  ws.onmessage = e => {
    entry.term.write(e.data);
  };

  ws.onerror = () => {
    if (activeTerminalId === entry.sessionId && statusBadge) {
      statusBadge.textContent = 'error';
      statusBadge.className = 'disconnected';
    }
  };

  ws.onclose = () => {
    // Update badge only if this is the active terminal
    if (activeTerminalId === entry.sessionId && statusBadge) {
      if (statusBadge.className !== 'disconnected') {
        statusBadge.textContent = 'closed';
        statusBadge.className = 'disconnected';
      }
    }
    // Leave entry in map with closed ws — next click will trigger step 2 (dispose+recreate)
  };

  entry.term.onData(d => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'i', d }));
    }
  });

  // Handle resize (only fires fit on the active terminal's container)
  const resizeObserver = new ResizeObserver(() => {
    if (activeTerminalId !== entry.sessionId) return;
    fitAndResize(entry);
  });
  resizeObserver.observe(document.getElementById('terminal-wrap'));

  // Also handle window resize
  const onResize = () => {
    if (activeTerminalId !== entry.sessionId) return;
    fitAndResize(entry);
  };
  window.addEventListener('resize', onResize);

  // Store for cleanup
  ws._resizeObserver = resizeObserver;
  ws._onResize = onResize;
}

// ── Fresh-launch session (起会话 / 新建会话) ──────────────────────────────────

/** Track the currently-open launch popover so we can dismiss it. */
let activeLaunchPopover = null;

function closeLaunchPopover() {
  if (activeLaunchPopover) {
    if (activeLaunchPopover._onDocClick) {
      document.removeEventListener('mousedown', activeLaunchPopover._onDocClick);
    }
    try { activeLaunchPopover.remove(); } catch (e) {}
    activeLaunchPopover = null;
  }
}

/**
 * Gather candidate cwds for a launch popover.
 * - For a PROJECT (projectName set): the project's home cwd + its explicitly-added paths +
 *   cwds from sessions historically attributed to it — NOT every cwd on the machine.
 * - For a TASK (todoKey set): the task's session cwds first, then its project's cwds.
 * - Global (neither): every known cwd, most-recent first.
 * Returns { cwds, defaultCwd } (deduped; project home is the default + sorted first).
 */
function gatherCwds(projectName, todoKey) {
  const proj = projectName ? projectById(projectName) : null;
  const homeCwd = proj && proj.homeCwd ? proj.homeCwd : null;
  const storedPaths = proj && Array.isArray(proj.paths) ? proj.paths : [];

  const scored = new Map(); // cwd → max updatedAt (for ordering session-derived cwds)
  const consider = s => {
    if (!s.cwd) return;
    const prev = scored.get(s.cwd) || 0;
    if (s.updatedAt > prev) scored.set(s.cwd, s.updatedAt);
  };

  let taskCwds = [];
  if (todoKey) {
    const todo = allTodos.find(t => t.id === todoKey);
    const sessIds = todo && Array.isArray(todo.sessions) ? todo.sessions : [];
    for (const sid of sessIds) {
      const s = allSessions.find(x => x.sessionId === sid);
      if (s) { consider(s); if (s.cwd) taskCwds.push(s.cwd); }
    }
  }
  if (projectName) {
    for (const s of allSessions) if (s.projectId === projectName) consider(s);
  }
  if (!projectName && !todoKey) {
    for (const s of allSessions) consider(s);   // global
  }

  const sessionCwds = [...scored.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);

  // Order: home → stored paths → session-derived (deduped).
  const seen = new Set();
  const cwds = [];
  for (const c of [homeCwd, ...storedPaths, ...sessionCwds]) {
    if (c && !seen.has(c)) { seen.add(c); cwds.push(c); }
  }

  let defaultCwd = homeCwd || taskCwds[0] || cwds[0] || null;
  return { cwds, defaultCwd };
}

/** Persist a newly-picked path onto a project (so it shows next time), best-effort. */
function addProjectPathRemote(projectName, cwd) {
  if (!projectName || !cwd) return;
  const proj = projectById(projectName);
  if (proj) { if (!Array.isArray(proj.paths)) proj.paths = []; if (!proj.paths.includes(cwd)) proj.paths.push(cwd); }
  fetch('/api/projects/add-path', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: projectName, cwd }),
  }).catch(() => {});
}

/**
 * Ask the server to open a native macOS folder picker. Returns the chosen absolute path,
 * or null if cancelled / unavailable. (Browsers can't expose absolute paths themselves.)
 */
async function pickFolder(defaultPath) {
  try {
    const res = await fetch('/api/pick-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ default: defaultPath || '' }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.path ? data.path : null;
  } catch (e) { console.warn('[berth] pickFolder failed', e); return null; }
}

/**
 * Open a small launch popover anchored to `anchorEl`.
 * @param {HTMLElement} anchorEl
 * @param {{projectName: string|null, todoKey: string|null}} ctx
 * @param {string|null} cwdHint  preselect this cwd (e.g. launched from a cwd group)
 */
function openLaunchPopover(anchorEl, ctx, cwdHint) {
  closeLaunchPopover();

  let { cwds, defaultCwd } = gatherCwds(ctx.projectName, ctx.todoKey);
  if (cwdHint) {
    if (!cwds.includes(cwdHint)) cwds = [cwdHint, ...cwds];
    defaultCwd = cwdHint;   // honor the cwd the user launched from
  }

  const pop = document.createElement('div');
  pop.className = 'launch-popover';

  const cwdOptions = cwds.map(c =>
    `<option value="${escHtml(c)}"${c === defaultCwd ? ' selected' : ''}>${escHtml(shortCwd(c))}</option>`
  ).join('');

  pop.innerHTML = `
    <div class="launch-pop-title">${ctx.todoKey ? `${icon('play')} 起会话` : `${icon('plus')} 新建会话`}</div>
    <div class="launch-pop-row">
      <span class="launch-pop-label">CLI</span>
      ${cliRadios('lp-cli')}
    </div>
    <div class="launch-pop-row">
      <span class="launch-pop-label">cwd</span>
      <select class="launch-pop-cwd-select">
        ${cwdOptions}
        <option value="__custom__">（自定义路径…）</option>
      </select>
    </div>
    <div class="launch-pop-row launch-pop-custom" style="display:${cwds.length === 0 ? 'flex' : 'none'}">
      <input class="launch-pop-cwd-input" type="text" placeholder="绝对路径 /Users/…" value="${escHtml(defaultCwd || '')}" spellcheck="false">
      <button class="launch-pop-browse" title="选择文件夹">${icon('folder')}</button>
    </div>
    ${ctx.todoKey ? '' : `
    <div class="launch-pop-row">
      <span class="launch-pop-label">项目</span>
      <select class="launch-pop-proj">
        <option value="">（无）</option>
        ${projects.filter(p => !p.archived).map(p =>
          `<option value="${escHtml(p.id)}"${(p.id === ctx.projectName || p.name === ctx.projectName) ? ' selected' : ''}>${escHtml(p.name)}</option>`).join('')}
      </select>
    </div>`}
    <div class="launch-pop-actions">
      <button class="launch-pop-cancel">取消</button>
      <button class="launch-pop-go">起会话 ${icon('play')}</button>
    </div>
  `;

  document.body.appendChild(pop);
  activeLaunchPopover = pop;

  const select = pop.querySelector('.launch-pop-cwd-select');
  const customRow = pop.querySelector('.launch-pop-custom');
  const customInput = pop.querySelector('.launch-pop-cwd-input');
  const browseBtn = pop.querySelector('.launch-pop-browse');

  // Open the native folder picker; fill the input with the chosen absolute path.
  const browse = async () => {
    browseBtn.disabled = true; browseBtn.textContent = '…';
    const picked = await pickFolder(customInput.value.trim() || defaultCwd);
    browseBtn.disabled = false; browseBtn.innerHTML = icon('folder');
    if (picked) customInput.value = picked;
    customInput.focus();
  };
  browseBtn.addEventListener('click', browse);

  // If there were no cwds, force custom mode.
  if (cwds.length === 0) {
    select.value = '__custom__';
  }

  select.addEventListener('change', () => {
    if (select.value === '__custom__') {
      customRow.style.display = 'flex';
      customInput.focus();
      positionFloatingPanel(pop, anchorEl, { align: 'start' });
      browse();   // 选「自定义路径…」即打开文件夹选择
    } else {
      customRow.style.display = 'none';
      positionFloatingPanel(pop, anchorEl, { align: 'start' });
    }
  });

  const resolveCwd = () => {
    if (select.value === '__custom__') return customInput.value.trim();
    return select.value;
  };

  const projSel = pop.querySelector('.launch-pop-proj');   // present only when not task-scoped

  pop.querySelector('.launch-pop-cancel').addEventListener('click', closeLaunchPopover);
  pop.querySelector('.launch-pop-go').addEventListener('click', () => {
    const cliSel = pop.querySelector('input[name="lp-cli"]:checked');
    if (!cliSel) { alert('没有可用的 agent，请先在设置里启用'); return; }
    const cli = cliSel.value;
    const cwd = resolveCwd();
    if (!cwd) { customRow.style.display = 'flex'; customInput.focus(); return; }
    // A task implies its project; otherwise use the chosen 项目 (or the preset).
    const projectId = ctx.todoKey ? ctx.projectName : (projSel ? (projSel.value || null) : ctx.projectName);
    // Remember a freshly-typed/picked path on the project so it's offered next time.
    if (projectId && select.value === '__custom__') addProjectPathRemote(projectId, cwd);
    closeLaunchPopover();
    launchFreshSession({ cli, cwd, todoKey: ctx.todoKey, projectId });
  });

  positionFloatingPanel(pop, anchorEl, { align: 'start' });

  // Close on outside click / escape
  pop._onDocClick = e => {
    if (!pop.contains(e.target) && e.target !== anchorEl) closeLaunchPopover();
  };
  setTimeout(() => document.addEventListener('mousedown', pop._onDocClick), 0);
}

/**
 * Launch a fresh CLI session via the ?new=1 WS endpoint and wire up a terminal pane.
 * The server mints the real session id (claude/coco deterministic, codex on next refresh),
 * which we don't know client-side, so we key the pool entry by a temp `new:<n>` id and
 * schedule loadAll() so the attributed session surfaces in the lists.
 */
function launchFreshSession({ cli, cwd, todoKey, projectId, prompt }) {
  // Switch to sessions mode so the terminal pane is visible.
  if (currentMode !== 'sessions') setMode('sessions');

  const tempId = 'new:' + (++newSessionCounter);
  hideEmptyState();

  // LRU cap: evict an idle slot (killing its pty) if at limit — never a pinned/running one.
  evictIfFull(tempId);

  const termContainer = document.getElementById('terminal');
  const el = document.createElement('div');
  el.className = 'term-instance';
  el.style.display = 'none';
  termContainer.appendChild(el);

  const term = new Terminal({
    theme: currentTerminalTheme(),
    fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    scrollback: 5000,
    allowTransparency: false,
    convertEol: false,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);

  const entry = { sessionId: tempId, term, ws: null, fit, el, lastUsed: Date.now(), warmedOnly: false };
  terminals.set(tempId, entry);
  wireTerminalImagePaste(entry);

  // Synthetic session object so the header renders sensibly.
  const pseudoSession = {
    sessionId: tempId,
    cli,
    cwd,
    title: (todoKey ? '新会话 · ' : '新会话 · ') + shortCwd(cwd),
    updatedAt: Math.floor(Date.now() / 1000),
  };
  activeTerminalId = tempId;
  selectedId = tempId;
  activateEntry(entry, pseudoSession);

  // Surface an immediate "创建中…" placeholder in the left list, grouped under the target
  // project/cwd, snapshotting the current same-cwd+cli sessions so we can spot the new one later.
  pendingLaunches.set(tempId, {
    tempId, cli, cwd,
    projectId: projectId || null,
    todoKey: todoKey || null,
    realId: null,
    bound: false,
    status: 'launching',
    createdAt: Math.floor(Date.now() / 1000),
    knownIds: new Set(allSessions.filter(s => s.cli === cli && cwdKey(s.cwd) === cwdKey(cwd)).map(s => s.sessionId)),
  });
  renderSidebar();
  ensurePendingReconcilePoll();   // keep refreshing until this placeholder matches (slow clis like coco)

  requestAnimationFrame(() => {
    try { fit.fit(); } catch (e) {}
    connectFreshWs(entry, pseudoSession, { cli, cwd, todoKey, projectId, prompt });
  });
}

/**
 * Open the ?new=1 WS for a freshly-launched session entry (temp-keyed).
 * Mirrors connectWsForEntry's wiring but builds the fresh-launch URL and schedules
 * loadAll() on first data + after 3s to pick up the server-attributed real session.
 */
function connectFreshWs(entry, session, opts) {
  const statusBadge = document.getElementById('status-badge');
  const tempId = entry.sessionId;   // stable handle into pendingLaunches (entry.sessionId is rekeyed on associate)
  // Measure the real pane; clamp away tiny mis-measurements that happen during the Now→sessions
  // view switch (otherwise the PTY spawns ~10 cols and the agent wraps one word per line).
  try { entry.fit.fit(); } catch (e) {}
  const cols = Math.max(entry.term.cols || 0, 100);
  const rows = Math.max(entry.term.rows || 0, 24);

  const params = new URLSearchParams();
  params.set('new', '1');
  params.set('cli', opts.cli);
  params.set('cwd', opts.cwd);
  params.set('todoKey', opts.todoKey || '');
  params.set('projectId', opts.projectId || '');
  if (opts.prompt) params.set('prompt', opts.prompt);
  params.set('cols', String(cols));
  params.set('rows', String(rows));
  const wsUrl = `ws://${location.host}/pty?${params.toString()}`;

  const ws = new WebSocket(wsUrl);
  entry.ws = ws;

  if (activeTerminalId === entry.sessionId && statusBadge) {
    statusBadge.textContent = 'launching…';
    statusBadge.className = 'connecting';
  }

  let refreshedOnData = false;
  // Re-scan on the SERVER (the new session's jsonl must be picked up) then reload the lists.
  const scheduleRefresh = delay => setTimeout(() => {
    fetch('/api/refresh', { method: 'POST' }).then(() => loadAll()).catch(() => {});
  }, delay);

  ws.onopen = () => {
    if (activeTerminalId === entry.sessionId && statusBadge) {
      statusBadge.textContent = 'connected';
      statusBadge.className = 'connected';
    }
    // Layout is settled now — re-fit and push the true pane size to the PTY so the agent
    // renders at the correct width (the initial spawn size can be too small mid view-switch).
    setTimeout(() => fitAndResize(entry), 150);
    // The new session is attributed server-side around launch; refresh shortly after.
    scheduleRefresh(3000);
  };

  ws.onmessage = e => {
    // Berth control frames (sent before any pty output) carry the real session id for correlation.
    if (typeof e.data === 'string' && e.data.startsWith('{"__berth"')) {
      try {
        const ctl = JSON.parse(e.data);
        if (ctl.__berth === 'launched') { onLaunchIdentified(tempId, ctl); return; }
      } catch (_) { /* not a control frame — fall through to terminal */ }
    }
    entry.term.write(e.data);
    if (!refreshedOnData) {
      refreshedOnData = true;
      // First data means the CLI is alive; refresh a couple of times as the jsonl gets written.
      scheduleRefresh(1500);
      scheduleRefresh(6000);
    }
  };

  ws.onerror = () => {
    if (activeTerminalId === entry.sessionId && statusBadge) {
      statusBadge.textContent = 'error';
      statusBadge.className = 'disconnected';
    }
    if (pendingLaunches.has(tempId)) markPendingFailed(tempId);
  };

  ws.onclose = () => {
    if (activeTerminalId === entry.sessionId && statusBadge) {
      if (statusBadge.className !== 'disconnected') {
        statusBadge.textContent = 'closed';
        statusBadge.className = 'disconnected';
      }
    }
    // Closed before the session was associated → the launch never produced a session.
    if (pendingLaunches.has(tempId)) markPendingFailed(tempId);
  };

  // After the user submits their first line, the backend can derive a real title from that first
  // user message — but only on a re-scan. Debounce a refresh on Enter until a title appears, so the
  // row goes 无标题 → <query text> without the user having to hit refresh. Stops once titled.
  let titleRefreshTimer = null;
  let titleSettled = false;
  const scheduleTitleRefresh = () => {
    if (titleSettled) return;
    clearTimeout(titleRefreshTimer);
    titleRefreshTimer = setTimeout(async () => {
      try { await fetch('/api/refresh', { method: 'POST' }); await loadAll(); } catch (_) {}
      const real = allSessions.find(s => s.sessionId === entry.sessionId);
      if (real && real.title && real.title.trim()) titleSettled = true;
    }, 2500);
  };

  entry.term.onData(d => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'i', d }));
    }
    if (!titleSettled && /[\r\n]/.test(d)) scheduleTitleRefresh();
  });

  const resizeObserver = new ResizeObserver(() => {
    if (activeTerminalId !== entry.sessionId) return;
    fitAndResize(entry);
  });
  resizeObserver.observe(document.getElementById('terminal-wrap'));

  const onResize = () => {
    if (activeTerminalId !== entry.sessionId) return;
    fitAndResize(entry);
  };
  window.addEventListener('resize', onResize);

  ws._resizeObserver = resizeObserver;
  ws._onResize = onResize;
}

// ── View Router ────────────────────────────────────────────────────────────

/**
 * Switch main mode: 'now' | 'projects' | 'sessions'
 * Hides terminal view when switching away — does NOT dispose terminals.
 */
// ── Hash routing: the URL (#/…) is the source of truth for the current view ──────
//   #/now · #/projects · #/project/<id> · #/sessions · #/sessions/<sessionId>
// `routing` suppresses hash writes while we're applying a hash; `currentRoute` lets the
// hashchange that our own setHash triggers be a no-op (so a click renders the view once).
let routing = false;
let currentRoute = null;

function setHash(h) {
  if (routing) return;
  if (location.hash === h) { currentRoute = h; return; }
  currentRoute = h;          // mark applied so the resulting hashchange skips re-render
  location.hash = h;
}

/** Switch the view to match location.hash. Idempotent; called on load + back/forward. */
function applyRoute() {
  const h = location.hash || '#/now';
  if (h === currentRoute) return;        // already showing this route
  currentRoute = h;
  routing = true;
  try {
    const parts = h.replace(/^#\/?/, '').split('/');
    const view = parts[0] || 'now';
    if (view === 'project' && parts[1]) {
      const projName = decodeURIComponent(parts.slice(1).join('/'));
      setMode('projects');
      const proj = projectById(projName) || projects.find(p => p.name === projName);
      if (proj) openProject(proj.id);
    } else if (view === 'sessions') {
      setMode('sessions');
      if (parts[1]) {
        const sid = decodeURIComponent(parts[1]);
        if (allSessions.some(s => s.sessionId === sid)) selectSession(sid);
      }
    } else if (view === 'projects') {
      setMode('projects');
    } else if (view === 'settings') {
      setMode('settings');
    } else {
      setMode('now');
    }
  } finally { routing = false; }
}

function setMode(mode) {
  currentMode = mode;

  // Update nav highlighting
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.mode === mode);
  });

  // Show/hide sidebar (only for sessions mode)
  const sidebarVisible = mode === 'sessions';
  document.getElementById('sidebar').style.display = sidebarVisible ? 'flex' : 'none';
  document.getElementById('sidebar-resize-handle').style.display = sidebarVisible ? 'block' : 'none';

  // Show/hide views
  document.getElementById('terminal-view').style.display = (mode === 'sessions') ? 'flex' : 'none';
  document.getElementById('now-view').style.display = (mode === 'now') ? 'flex' : 'none';
  document.getElementById('projects-view').style.display = (mode === 'projects') ? 'flex' : 'none';
  const settingsView = document.getElementById('settings-view');
  if (settingsView) settingsView.style.display = (mode === 'settings') ? 'flex' : 'none';
  document.getElementById('workspace-view').style.display = 'none';

  // Render appropriate content
  if (mode === 'now') renderNow();
  if (mode === 'projects') renderProjects();
  if (mode === 'sessions') renderSidebar();
  if (mode === 'settings') renderSettings();
  updateNavUnreadIndicators();

  setHash('#/' + mode);
}

/**
 * Open a project workspace in the main pane.
 */
function openProject(name) {
  const proj = projectById(name) || projects.find(p => p.name === name);
  if (!proj) return;
  const projectId = proj.id;
  // Hide other views
  document.getElementById('terminal-view').style.display = 'none';
  document.getElementById('now-view').style.display = 'none';
  document.getElementById('projects-view').style.display = 'none';
  document.getElementById('workspace-view').style.display = 'flex';

  const titleEl = document.getElementById('workspace-title');
  titleEl.textContent = proj.name;
  titleEl.dataset.projectId = projectId;
  const projectMenuBtn = document.getElementById('ws-project-menu-btn');
  if (projectMenuBtn) {
    projectMenuBtn.onclick = e => {
      e.stopPropagation();
      openProjectEditMenu(e.currentTarget, proj);
    };
  }

  // ⊕ 新建待办 bar preset to this project
  renderCreateTodoBar(document.getElementById('ws-create-todo'), projectId);

  // ＋ 新建会话 button (taskless, project-bound). Re-bind each open to capture `name`.
  const newSessBtn = document.getElementById('ws-new-session-btn');
  if (newSessBtn) {
    newSessBtn.onclick = e => {
      e.stopPropagation();
      openLaunchPopover(e.currentTarget, { projectName: projectId, todoKey: null });
    };
  }

  renderProjectSidebar(projectId);
  renderWorkspace(projectId);
  setHash('#/project/' + encodeURIComponent(projectId));
}

function renderCurrentView() {
  if (currentMode === 'now') renderNow();
  else if (currentMode === 'projects') renderProjects();
  else if (currentMode === 'sessions') renderSidebar();
}

function setNavUnreadDot(mode, on) {
  const el = document.querySelector(`.nav-item[data-mode="${mode}"]`);
  if (!el) return;
  let dot = el.querySelector('.nav-unread-dot');
  if (on && !dot) {
    dot = document.createElement('span');
    dot.className = 'nav-unread-dot';
    dot.title = '有未读会话';
    el.appendChild(dot);
  } else if (!on && dot) {
    dot.remove();
  }
}

function updateNavUnreadIndicators() {
  const seen = getLastSeen();
  const unreadSessions = allSessions.filter(s => rowIsUnread(s, seen));
  const anyUnread = unreadSessions.length > 0;
  setNavUnreadDot('now', anyUnread);
  setNavUnreadDot('sessions', anyUnread);
  setNavUnreadDot('projects', unreadSessions.some(s => s.projectId));
}

/** Re-render the current view so unread dots (rows AND aggregate header/project/task
 *  dots) recompute after a session is marked seen, preserving the sidebar scroll. */
function refreshUnreadUI() {
  const list = document.getElementById('session-list');
  const top = list ? list.scrollTop : 0;
  const projectList = document.getElementById('project-list');
  const projectTop = projectList ? projectList.scrollTop : 0;
  // The workspace view isn't driven by currentMode, so re-render it directly when it's the one showing.
  const wsVisible = document.getElementById('workspace-view').style.display !== 'none';
  if (wsVisible) {
    const name = document.getElementById('workspace-title').dataset.projectId;
    if (name) {
      renderProjectSidebar(name);
      renderWorkspace(name);
    }
  } else {
    renderCurrentView();
  }
  const list2 = document.getElementById('session-list');
  if (list2) list2.scrollTop = top;
  const projectList2 = document.getElementById('project-list');
  if (projectList2) projectList2.scrollTop = projectTop;
  updateNavUnreadIndicators();
}

// ── Shared todo-row session UX (used by both Now 进行中待办 and the workspace 待办) ──

/** Resolve a todo's linked sessions + expand flags. */
function todoExpandInfo(t) {
  const linked = (Array.isArray(t.sessions) ? t.sessions : [])
    .map(id => allSessions.find(x => x.sessionId === id)).filter(Boolean);
  const hasNote = !!t.progress;
  const hasDoc = !!t.detailDoc;
  const seen = getLastSeen();
  const running = linked.some(rowIsRunning);
  const unread = linked.some(s => rowIsUnread(s, seen));
  return { linked, hasNote, hasDoc, running, unread, hasExpand: linked.length > 0 || hasNote || hasDoc };
}

/** HTML snippet (count badge + ▾ hint) to splice into a todo row before the 起会话 button. */
function todoRowExtrasHtml(info) {
  return aggGlyph(info.running, info.unread, '该任务下', info.linked)
       + (info.linked.length ? `<span class="todo-sess-count" title="已关联 ${info.linked.length} 个会话">${icon('link-2')} ${info.linked.length}</span>` : '')
       + (info.hasExpand ? `<span class="todo-expand-hint" title="点击任务展开会话/进展">${icon('chevron-down')}</span>` : '');
}

/** A workspace 待办 card for a status board column (no status chip — the column is the status). */
function buildWorkspaceTodoItem(t, projectName) {
  const item = document.createElement('div');
  item.className = 'todo-item';
  item.dataset.todoId = t.id;
  const priorityClass = (t.priority || 'p?').toLowerCase().replace(/\s+/g, '');
  const info = todoExpandInfo(t);
  const row = document.createElement('div');
  row.className = 'todo-row' + (info.hasExpand ? ' expandable' : '');
  row.dataset.todoId = t.id;
  row.innerHTML = `
    <span class="priority-chip priority-${escHtml(priorityClass)}">${escHtml(t.priority || '—')}</span>
    ${ddlChipHtml(t)}
    <span class="todo-title">${escHtml(t.title)}</span>
    <span class="todo-row-break"></span>
    ${todoRowExtrasHtml(info)}
    <button class="launch-sess-btn primary" title="新建一个会话">${icon('play')} 起会话</button>
  `;
  item.appendChild(row);
  wireTodoRow(t, item, row, projectName, info);
  makeTodoDraggable(item, t);
  return item;
}

/** Make a task card draggable so it can be dropped on a status column to change 状态. */
function makeTodoDraggable(el, t) {
  el.draggable = true;
  el.addEventListener('dragstart', e => {
    if (editingTodoTitle && editingTodoTitle.id === t.id) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/berth-todo', t.id);
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
}

/** Wire a status column as a drop target: dropping a task card here sets its 状态 to `status`. */
function wireStatusDrop(col, status, projectName) {
  col.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('text/berth-todo')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    col.classList.add('col-drop-target');
  });
  col.addEventListener('dragleave', e => {
    if (!col.contains(e.relatedTarget)) col.classList.remove('col-drop-target');
  });
  col.addEventListener('drop', e => {
    if (![...e.dataTransfer.types].includes('text/berth-todo')) return;
    e.preventDefault();
    col.classList.remove('col-drop-target');
    const rid = e.dataTransfer.getData('text/berth-todo');
    const t = allTodos.find(x => x.id === rid);
    if (t && t.status !== status) setTodoStatus(t, status, projectName);
  });
}

/**
 * 任务 status board. The active column is wide(ish) and shows full task rows; the others are
 * narrower stacked cards (header on top, a name-only task list below). Click a stacked card to
 * activate it (the board re-renders, preserving expand state). Active status persists.
 */
function buildTodoBoard(projTodos, name) {
  const byStatus = new Map();
  for (const t of projTodos) {
    if (!byStatus.has(t.status)) byStatus.set(t.status, []);
    byStatus.get(t.status).push(t);
  }
  const cols = STATUS_ORDER.filter(s => byStatus.has(s));
  for (const s of byStatus.keys()) if (!cols.includes(s)) cols.push(s);  // unknown statuses last

  let active = activeTodoStatus;
  if (!active || !cols.includes(active)) active = cols.includes('进行中') ? '进行中' : cols[0];
  activeTodoStatus = active;

  const board = document.createElement('div');
  board.className = 'todo-board';

  for (const status of cols) {
    const items = byStatus.get(status);
    const isActive = status === active;
    const col = document.createElement('div');
    col.className = 'todo-col ' + (isActive ? 'active' : 'stacked');
    col.style.setProperty('--col-accent', statusColor(status));

    const head = document.createElement('div');
    head.className = 'todo-col-head';
    head.innerHTML = `<span class="todo-col-dot"></span><span class="todo-col-name">${escHtml(status)}</span><span class="todo-col-count">${items.length}</span>`;
    col.appendChild(head);

    const body = document.createElement('div');
    body.className = 'todo-col-body';
    if (isActive) {
      for (const t of items) body.appendChild(buildWorkspaceTodoItem(t, name));
    } else {
      for (const t of items) {
        const r = document.createElement('div');
        r.className = 'todo-mini';
        r.textContent = t.title;
        r.title = t.title;
        makeTodoDraggable(r, t);
        body.appendChild(r);
      }
    }
    col.appendChild(body);

    // Drop a task card here → change its 状态 to this column's status.
    wireStatusDrop(col, status, name);

    if (!isActive) {
      col.addEventListener('click', () => {
        activeTodoStatus = status;
        board.replaceWith(buildTodoBoard(projTodos, name));
      });
    }
    board.appendChild(col);
  }
  return board;
}

/**
 * Wire a todo row: 起会话 menu, drag-drop (session→task), and click-to-expand showing the
 * task's linked sessions (+ 进展 note). `item` wraps `row` and receives the expand panel.
 */
function wireTodoRow(t, item, row, projectName, info) {
  const launchBtn = row.querySelector('.launch-sess-btn');
  if (launchBtn) launchBtn.addEventListener('click', e => {
    e.stopPropagation();
    openLaunchPopover(e.currentTarget, { projectName, todoKey: t.id });
  });

  // ⋯ edit menu (改名 / 优先级 / 删除). Injected here so every wireTodoRow site gets it without
  // touching each row template; placed before 起会话 so the launch button stays right-most.
  const menuBtn = document.createElement('button');
  menuBtn.className = 'todo-menu-btn';
  menuBtn.title = '更多（改名 / 优先级 / 删除）';
  menuBtn.innerHTML = icon('ellipsis');
  menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    openTodoEditMenu(e.currentTarget, t, projectName);
  });
  if (launchBtn) row.insertBefore(menuBtn, launchBtn); else row.appendChild(menuBtn);

  const titleEl = row.querySelector('.todo-title, .now-row-title');
  if (titleEl) {
    titleEl.title = '双击编辑任务名称';
    titleEl.addEventListener('dblclick', e => {
      e.stopPropagation();
      startTodoTitleEdit(t, projectName);
    });
  }

  row.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('text/berth-session')) return;
    e.preventDefault(); row.classList.add('drop-target');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
  row.addEventListener('drop', e => {
    row.classList.remove('drop-target');
    const sid = e.dataTransfer.getData('text/berth-session');
    if (!sid) return;
    e.preventDefault();
    expandedTodos.add(t.id);   // reveal the just-associated session after re-render
    assignTask(sid, t.id, projectName);
  });

  if (editingTodoTitle && editingTodoTitle.id === t.id) mountTodoTitleInput(row, t, projectName);

  if (!info.hasExpand) return;
  const exp = document.createElement('div');
  exp.className = 'todo-expand';
  const startOpen = expandedTodos.has(t.id);   // restore prior expand state across re-renders
  exp.style.display = startOpen ? '' : 'none';
  row.classList.toggle('expanded', startOpen);
  item.classList.toggle('expanded', startOpen);

  let ensureLogTail = null;
  if (info.hasNote || info.hasDoc) {
    const pane = document.createElement('div');
    pane.className = 'todo-note-pane';
    const note = document.createElement('div');
    note.className = 'todo-note';
    note.textContent = info.hasNote ? t.progress : '';
    pane.appendChild(note);

    if (info.hasDoc) {
      const actions = document.createElement('div');
      actions.className = 'todo-note-actions';
      actions.innerHTML = `
        <button class="btn-summarize-progress" title="用 AI 生成进展摘要">${icon('sparkles')}</button>
        <button class="btn-open-doc" title="打开上下文文档">${icon('file-text')}</button>
      `;
      actions.querySelector('.btn-summarize-progress').addEventListener('click', e => {
        e.stopPropagation();
        generateProgressSummary(t.id, e.currentTarget, note);
      });
      actions.querySelector('.btn-open-doc').addEventListener('click', e => {
        e.stopPropagation();
        openTaskDoc(t);
      });
      pane.appendChild(actions);
    }
    exp.appendChild(pane);

    // Lazy-fetch the B-tail the first time this task is expanded with no A snapshot.
    let logTailLoaded = false;
    ensureLogTail = () => {
      if (logTailLoaded || info.hasNote || !info.hasDoc) return;
      logTailLoaded = true;
      fetch('/api/todos/' + encodeURIComponent(t.id) + '/progress')
        .then(r => r.json())
        .then(d => {
          if (d.summary) { note.textContent = d.summary; return; }
          const tail = Array.isArray(d.logTail) ? d.logTail : [];
          note.textContent = tail.length
            ? tail.map(en => (en.date ? en.date + ': ' : '') + en.text).join('\n')
            : '暂无进展';
        })
        .catch(() => { note.textContent = '暂无进展'; });
    };
    if (startOpen) ensureLogTail();
  }

  if (info.linked.length) {
    const sl = document.createElement('div');
    sl.className = 'todo-linked-list';
    for (const s of info.linked) {
      const sr = document.createElement('div');
      sr.className = 'todo-linked-row';
      const tt = displayTitle(s);
      const sub = (s.cwd ? escHtml(shortCwd(s.cwd)) + ' · ' : '') + relativeTime(s.updatedAt);
      sr.innerHTML = `
        ${statusGlyph(s)}
        <span class="cli-badge ${escHtml(s.cli)}">${escHtml(s.cli)}</span>
        <div class="todo-linked-main">
          <div class="todo-linked-title" title="${escHtml(tt)}">${escHtml(tt)}</div>
          <div class="todo-linked-sub">${sub}</div>
        </div>
        <span class="todo-linked-open" title="打开会话">${icon('play')}</span>
        <button class="todo-linked-remove" title="移出该任务">${icon('x')}</button>
      `;
      sr.addEventListener('click', e => {
        if (e.target.closest('.todo-linked-remove')) return;
        openTerminalFor(s.sessionId);
      });
      sr.querySelector('.todo-linked-remove').addEventListener('click', e => {
        e.stopPropagation();
        assignTask(s.sessionId, null, projectName);   // detach, keep in project
      });
      sl.appendChild(sr);
    }
    exp.appendChild(sl);
  }

  item.appendChild(exp);
  row.addEventListener('click', e => {
    if (e.target.closest('.launch-sess-btn')) return;
    const isOpen = exp.style.display !== 'none';
    exp.style.display = isOpen ? 'none' : '';
    row.classList.toggle('expanded', !isOpen);
    item.classList.toggle('expanded', !isOpen);
    if (isOpen) expandedTodos.delete(t.id); else expandedTodos.add(t.id);
    if (!isOpen && ensureLogTail) ensureLogTail();
  });
}

function startTodoTitleEdit(t, projectName) {
  if (!t) return;
  const previous = t.title && t.title.trim() ? t.title.trim() : '';
  editingTodoTitle = { id: t.id, previous, draft: previous, projectName };
  rerenderTodosView(projectName);
  requestAnimationFrame(() => {
    const input = document.querySelector(`.todo-title-input[data-todo-id="${CSS.escape(t.id)}"]`);
    if (input) { input.focus(); input.select(); }
  });
}

function mountTodoTitleInput(row, t, projectName) {
  const titleEl = row.querySelector('.todo-title, .now-row-title');
  if (!titleEl || !editingTodoTitle || editingTodoTitle.id !== t.id) return;
  row.classList.add('editing-title');
  const draft = editingTodoTitle.draft;
  titleEl.innerHTML = `<input class="todo-title-input" data-todo-id="${escHtml(t.id)}" type="text" value="${escHtml(draft)}" placeholder="输入任务名称" spellcheck="false" autocomplete="off">`;
  const input = titleEl.querySelector('input');
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const state = editingTodoTitle;
    editingTodoTitle = null;
    const next = input.value.trim();
    if (!commit || !next || !state || next === state.previous) {
      rerenderTodosView(projectName);
      return;
    }
    await renameTodo(t, next, projectName);
  };
  input.addEventListener('input', () => {
    if (editingTodoTitle && editingTodoTitle.id === t.id) editingTodoTitle.draft = input.value;
  });
  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('mousedown', e => e.stopPropagation());
  input.addEventListener('dblclick', e => e.stopPropagation());
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

// ── Now View ───────────────────────────────────────────────────────────────

// ── Unread tracking (per browser) ────────────────────────────────────────────
// Baseline epoch: the first time this browser ever evaluates unread state, we
// stamp "now". Only activity AFTER that point counts as unread — so adopting the
// feature does NOT light up every pre-existing session; only sessions that get
// new activity / interaction (or are freshly created) afterwards do.
function getUnreadEpoch() {
  let v = localStorage.getItem('berthUnreadEpoch');
  if (v === null) {
    v = String(Math.floor(Date.now() / 1000));
    try { localStorage.setItem('berthUnreadEpoch', v); } catch (e) {}
  }
  return parseInt(v, 10) || 0;
}
function getLastSeen() {
  try { return JSON.parse(localStorage.getItem('berthLastSeen') || '{}'); } catch (e) { return {}; }
}
function getManualUnread() {
  try { return JSON.parse(localStorage.getItem('berthManualUnread') || '{}'); } catch (e) { return {}; }
}
function setManualUnreadMap(m) {
  try { localStorage.setItem('berthManualUnread', JSON.stringify(m)); } catch (e) {}
}
/** Mark a session read (now). Returns true if it had been unread (so the UI knows to refresh). */
function markSeen(sessionId) {
  if (!sessionId || sessionId.startsWith('new:')) return false;
  const m = getLastSeen();
  const s = allSessions.find(x => x.sessionId === sessionId);
  const wasUnread = s ? isUnread(s, m) : false;
  m[sessionId] = Math.max(Math.floor(Date.now() / 1000), s?.updatedAt || 0);
  try { localStorage.setItem('berthLastSeen', JSON.stringify(m)); } catch (e) {}
  const manual = getManualUnread();
  if (manual[sessionId]) {
    delete manual[sessionId];
    setManualUnreadMap(manual);
  }
  return wasUnread;
}
function markSessionRead(sessionId) {
  markSessionsRead([sessionId]);
}
function markSessionUnread(sessionId) {
  markSessionsUnread([sessionId]);
}
function cleanSessionIds(ids) {
  return [...new Set((ids || []).filter(id => typeof id === 'string' && id && !id.startsWith('new:')))];
}
function markSessionsRead(ids) {
  ids = cleanSessionIds(ids);
  if (ids.length === 0) return;
  const m = getLastSeen();
  const manual = getManualUnread();
  const now = Math.floor(Date.now() / 1000);
  for (const id of ids) {
    const s = allSessions.find(x => x.sessionId === id);
    m[id] = Math.max(now, s?.updatedAt || 0);
    delete manual[id];
  }
  try { localStorage.setItem('berthLastSeen', JSON.stringify(m)); } catch (e) {}
  setManualUnreadMap(manual);
  refreshUnreadUI();
}
function markSessionsUnread(ids) {
  ids = cleanSessionIds(ids);
  if (ids.length === 0) return;
  const manual = getManualUnread();
  for (const id of ids) manual[id] = 1;
  setManualUnreadMap(manual);
  refreshUnreadUI();
}
function handleUnreadToggleClick(e) {
  const btn = e.target.closest && e.target.closest('.unread-toggle');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  let ids = [];
  if (btn.dataset.sessionId) ids = [btn.dataset.sessionId];
  else if (btn.dataset.sessionIds) {
    try { ids = JSON.parse(btn.dataset.sessionIds); } catch (_) { ids = []; }
  }
  if (btn.dataset.unreadAction === 'read') markSessionsRead(ids);
  else markSessionsUnread(ids);
}
/** A session is "unread" if it has activity after the baseline epoch that you haven't opened since. */
function isUnread(s, seen) {
  if (!s || s.deleted) return false;
  const manual = getManualUnread();
  if (manual[s.sessionId]) return true;
  seen = seen || getLastSeen();
  return s.updatedAt > getUnreadEpoch() && s.updatedAt > (seen[s.sessionId] || 0);
}
/** The key the activity FSM tracks this row under — a pending placeholder spins off its launch's
 *  activity key (__liveKey), every other row off its own sessionId. */
function liveKeyOf(s) { return s.__liveKey || s.sessionId; }
/** Is this session actively producing output right now (→ live spinner)? */
function rowIsRunning(s) { return liveStatus.get(liveKeyOf(s)) === 'running'; }
/** Should this row show a red "needs your attention" dot? Combines the live settle signal with the
 *  durable unread model; never for the session you're currently looking at. */
function rowIsUnread(s, seen) {
  const id = s.sessionId;
  if (s.__pending) return false;                         // a brand-new "创建中…" placeholder is never unread
  if (activeTerminalId === id) return false;
  if (liveStatus.get(liveKeyOf(s)) === 'running') return false;   // actively working → spinner, not a dot
  // The red dot is purely CONTENT-based: a new real message since you last opened the session
  // (isUnread = updatedAt > lastSeen, where updatedAt is the last-message time). Repaints, resizes
  // and resume control-records never add a message, so they can never re-light it. A live `settled`
  // event only REFRESHES s.updatedAt (pushed from the server), it doesn't itself mark a row unread.
  return isUnread(s, seen);
}
function unreadToggleHtml(ids, unread, label, extraClass = '') {
  ids = cleanSessionIds(ids);
  if (ids.length === 0) return '';
  const action = unread ? 'read' : 'unread';
  const title = unread ? `${label}标为已读` : `${label}标为未读`;
  return `<button type="button" class="unread-dot unread-toggle ${unread ? 'on' : ''} ${extraClass}" data-unread-action="${action}" data-session-ids="${escHtml(JSON.stringify(ids))}" title="${escHtml(title)}" aria-label="${escHtml(title)}"></button>`;
}
/** Per-row indicator: spinner while running, red dot when there's unseen activity, else an invisible
 *  same-size clickable slot so titles stay aligned and can be marked unread on hover. */
function statusGlyph(s) {
  if (rowIsRunning(s)) return '<span class="row-spinner on" title="运行中…"></span>';
  const unread = rowIsUnread(s);
  const title = unread ? '标为已读' : '标为未读';
  return `<button type="button" class="unread-dot unread-toggle ${unread ? 'on' : ''}" data-session-id="${escHtml(s.sessionId)}" data-unread-action="${unread ? 'read' : 'unread'}" title="${title}" aria-label="${title}"></button>`;
}
/** Inline aggregate glyph for project cards / task rows: spinner if running, red dot if unread, else nothing. */
function aggGlyph(running, unread, label, sessions = []) {
  if (running) return `<span class="row-spinner on" title="${label}有会话运行中"></span>`;
  return unreadToggleHtml(sessions.map(s => s.sessionId), unread, label, '');
}
/** Status-only aggregate marker for project navigation lists: communicates state, no bulk action. */
function projectListStatusGlyph(running, unread) {
  if (running) return '<span class="row-spinner on pli-status" title="该项目有会话运行中"></span>';
  if (unread) return '<span class="unread-dot on pli-status" title="该项目有未读会话"></span>';
  return '';
}
/** Aggregate header indicator: spinner if any child is running, else a red dot if any holds unseen activity. */
function unreadHeaderDot(sessions) {
  if (sessions.some(rowIsRunning)) return '<span class="row-spinner on header-dot" title="该分组有会话运行中"></span>';
  const seen = getLastSeen();
  const unread = sessions.some(s => rowIsUnread(s, seen));
  return unreadToggleHtml(sessions.map(s => s.sessionId), unread, '该分组下', 'header-dot');
}
/** Recent sessions with new activity you haven't viewed in Berth since (self-clearing on open). */
function computeInbox() {
  const seen = getLastSeen();
  return allSessions
    .filter(s => isUnread(s, seen))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 20);
}

// ── ▷ 新建会话 composer ───────────────────────────────────────────────────────
function renderNowComposer() {
  const host = document.getElementById('now-composer');
  if (!host) return;
  const { cwds, defaultCwd } = gatherCwds(null, null);
  const cwdOpts = cwds.slice(0, 40)
    .map(c => `<option value="${escHtml(c)}"${c === defaultCwd ? ' selected' : ''}>${escHtml(shortCwd(c))}</option>`).join('');
  const projOpts = projects.filter(p => !p.archived)
    .map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('');

  host.innerHTML = `
    <textarea class="composer-input" placeholder="描述你想让 agent 做什么 —— 然后选 agent / 目录 / 项目，点「起会话」…" spellcheck="false"></textarea>
    <div class="composer-controls">
      <span class="composer-label">Agent</span>
      ${cliRadios('composer-cli')}
      <span class="composer-divider"></span>
      <span class="composer-label">目录</span>
      <select class="composer-cwd">${cwdOpts}<option value="__custom__">（自定义…）</option></select>
      <button class="composer-browse" title="选择文件夹">${icon('folder')}</button>
      <span class="composer-label">项目</span>
      <select class="composer-proj"><option value="">（无）</option>${projOpts}</select>
      <button class="composer-go">${icon('play')} 起会话</button>
    </div>
  `;

  const input = host.querySelector('.composer-input');
  const cwdSel = host.querySelector('.composer-cwd');
  const projSel = host.querySelector('.composer-proj');

  // Rebuild the cwd dropdown scoped to the selected project (home + paths + history; or all if none).
  const rebuildCwds = () => {
    const { cwds, defaultCwd } = gatherCwds(projSel.value || null, null);
    cwdSel.innerHTML = cwds.slice(0, 60)
      .map(c => `<option value="${escHtml(c)}"${c === defaultCwd ? ' selected' : ''}>${escHtml(shortCwd(c))}</option>`).join('')
      + '<option value="__custom__">（自定义…）</option>';
  };
  projSel.addEventListener('change', rebuildCwds);

  const ensureCwdOption = picked => {
    if (!picked) return;
    if (![...cwdSel.options].some(o => o.value === picked)) {
      cwdSel.insertBefore(new Option(shortCwd(picked), picked), cwdSel.firstChild);
    }
    cwdSel.value = picked;
    if (projSel.value) addProjectPathRemote(projSel.value, picked);   // remember on the project
  };
  host.querySelector('.composer-browse').addEventListener('click', async () => {
    ensureCwdOption(await pickFolder(cwdSel.value === '__custom__' ? '' : cwdSel.value));
  });
  cwdSel.addEventListener('change', async () => {
    if (cwdSel.value === '__custom__') {
      const picked = await pickFolder('');
      if (picked) ensureCwdOption(picked); else cwdSel.selectedIndex = 0;
    }
  });

  host.querySelector('.composer-go').addEventListener('click', () => {
    const cliSel = host.querySelector('input[name="composer-cli"]:checked');
    if (!cliSel) { alert('没有可用的 agent，请先在设置里启用'); return; }
    const cli = cliSel.value;
    const cwd = cwdSel.value === '__custom__' ? '' : cwdSel.value;
    if (!cwd) { cwdSel.focus(); return; }
    const projectId = projSel.value || null;
    const prompt = input.value.trim();
    launchFreshSession({ cli, cwd, todoKey: null, projectId, prompt });
    input.value = '';
  });
  // Cmd/Ctrl+Enter sends
  input.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); host.querySelector('.composer-go').click(); }
  });
}

function renderNow() {
  // ▷ 新建会话 composer at the top
  renderNowComposer();

  const container = document.getElementById('now-content');
  container.innerHTML = '';

  // ── 📥 Inbox: 未读（最近有新活动、你还没在 Berth 里看过的会话）
  const inbox = computeInbox();
  const inboxSection = buildNowSection(`${icon('inbox')} 收件箱${inbox.length ? ' · ' + inbox.length : ''}`, inbox.length === 0 ? null : inbox, s => {
    const row = document.createElement('div');
    row.className = 'now-row session-clickable inbox-row';
    const t = displayTitle(s);
    row.innerHTML = `
      ${statusGlyph(s)}
      <span class="cli-badge ${escHtml(s.cli)}">${escHtml(s.cli)}</span>
      <span class="now-row-title" title="${escHtml(t)}">${escHtml(t)}</span>
      <span class="now-row-meta">${s.cwd ? escHtml(shortCwd(s.cwd)) : ''}</span>
      ${s.projectId ? `<span class="now-row-meta project-tag">${escHtml(projectLabel(s.projectId))}</span>` : ''}
      <span class="now-row-time">${relativeTime(s.updatedAt)}</span>
    `;
    row.addEventListener('click', () => openTerminalFor(s.sessionId));
    return row;
  }, '（暂无未读会话 — 都看过了）');
  container.appendChild(inboxSection);

  // ── 📌 Pinned sessions
  const pinned = allSessions.filter(s => s.pinned);
  const pinnedSection = buildNowSection(`${icon('pin')} 置顶`, pinned.length === 0 ? null : pinned, item => {
    const s = item;
    const row = document.createElement('div');
    row.className = 'now-row session-clickable';
    const t = displayTitle(s);
    row.innerHTML = `
      ${statusGlyph(s)}
      <span class="cli-badge ${escHtml(s.cli)}">${escHtml(s.cli)}</span>
      <span class="now-row-title" title="${escHtml(t)}">${escHtml(t)}</span>
      <span class="now-row-meta">${s.cwd ? escHtml(shortCwd(s.cwd)) : ''}</span>
      <span class="now-row-time">${relativeTime(s.updatedAt)}</span>
    `;
    row.addEventListener('click', () => openTerminalFor(s.sessionId));
    return row;
  }, '（暂无置顶会话）');
  container.appendChild(pinnedSection);

  // ── ⏳ 今日待处理任务（ddl ≤ 今天，逾期排前；状态非已完成/已取消）
  const dueToday = todayTodos(allTodos);
  const todoSection = buildNowSection(`${icon('hourglass')} 今日待处理任务`, dueToday.length === 0 ? null : dueToday, item => {
    const t = item;
    const info = todoExpandInfo(t);
    const wrap = document.createElement('div');
    wrap.className = 'now-todo-item';
    wrap.dataset.todoId = t.id;
    const row = document.createElement('div');
    row.className = 'now-row' + (info.hasExpand ? ' expandable' : '');
    row.dataset.todoId = t.id;
    row.innerHTML = `
      ${ddlChipHtml(t)}
      <span class="status-chip ${todoStatusClass(t.status)}">${escHtml(t.status || '—')}</span>
      <span class="priority-chip priority-${escHtml((t.priority || 'P?').toLowerCase())}">${escHtml(t.priority || '—')}</span>
      <span class="now-row-title">${escHtml(t.title)}</span>
      ${aggGlyph(info.running, info.unread, '该任务下', info.linked)}
      ${info.linked.length ? `<span class="todo-sess-count" title="已关联 ${info.linked.length} 个会话">${icon('link-2')} ${info.linked.length}</span>` : ''}
      <span class="now-row-meta project-tag">${escHtml(todoProjectLabel(t))}</span>
      ${info.hasExpand ? `<span class="todo-expand-hint" title="点击展开会话/进展">${icon('chevron-down')}</span>` : ''}
      <button class="launch-sess-btn" title="新建一个会话">${icon('play')} 起会话</button>
    `;
    wrap.appendChild(row);
    wireTodoRow(t, wrap, row, todoProjectId(t), info);
    return wrap;
  }, '（今日无待处理任务）');
  container.appendChild(todoSection);

  // ── 🕑 最近会话 (top 15 by updatedAt)
  const recent = [...allSessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 15);
  const recentSection = buildNowSection(`${icon('clock')} 最近会话`, recent.length === 0 ? null : recent, item => {
    const s = item;
    const row = document.createElement('div');
    row.className = 'now-row session-clickable';
    const t = displayTitle(s);
    row.innerHTML = `
      ${statusGlyph(s)}
      <span class="cli-badge ${escHtml(s.cli)}">${escHtml(s.cli)}</span>
      <span class="now-row-title" title="${escHtml(t)}">${escHtml(t)}</span>
      <span class="now-row-meta">${s.cwd ? escHtml(shortCwd(s.cwd)) : ''}</span>
      ${s.projectId ? `<span class="now-row-meta project-tag">${escHtml(projectLabel(s.projectId))}</span>` : ''}
      <span class="now-row-time">${relativeTime(s.updatedAt)}</span>
    `;
    row.addEventListener('click', () => openTerminalFor(s.sessionId));
    return row;
  }, '（暂无会话）');
  container.appendChild(recentSection);
}

function buildNowSection(title, items, buildRow, emptyMsg) {
  const section = document.createElement('div');
  section.className = 'now-section';

  const hdr = document.createElement('div');
  hdr.className = 'now-section-header';
  hdr.innerHTML = title;   // title may contain an icon() SVG; our own controlled strings only
  section.appendChild(hdr);

  if (!items || items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'now-empty';
    empty.textContent = emptyMsg;
    section.appendChild(empty);
  } else {
    for (const item of items) {
      section.appendChild(buildRow(item));
    }
  }

  return section;
}

// ── Projects View ──────────────────────────────────────────────────────────

/** Compute the rollup stats for a project. */
function projectSummary(proj) {
  const projTodos = allTodos.filter(t => todoProjectId(t) === proj.id);
  const total = projTodos.length;
  const done = projTodos.filter(t => DONE_STATUSES.has(t.status)).length;
  const inProgress = projTodos.filter(t => t.status === '进行中').length;
  const seen = getLastSeen();
  const projSessions = allSessions.filter(s => s.projectId === proj.id);
  const running = projSessions.some(rowIsRunning);
  const unread = projSessions.some(s => rowIsUnread(s, seen));
  return { total, done, open: total - done, inProgress, sessions: projSessions.length, sessionRows: projSessions, running, unread };
}

// Feishu 项目领域 option hues are color *names* (Red/Purple/Gray/…), not numeric CSS
// hues — feeding them straight into hsl() collapses the accent border. Map to real colors.
const PROJ_HUE_COLORS = {
  Red: '#e5484d', Orange: '#f76b15', Yellow: '#f5b800', Lime: '#99d52a',
  Green: '#30a46c', Turquoise: '#12a594', Wathet: '#46a5e0', Blue: '#3b82f6',
  Carmine: '#e93d82', Purple: '#8e4ec6', Gray: '#8b8d98',
};
function projAccentColor(hue) {
  return PROJ_HUE_COLORS[hue] || 'var(--brand)';
}

function buildProjectCard(proj) {
  const sum = projectSummary(proj);
  const card = document.createElement('div');
  card.className = 'project-card' + (proj.archived ? ' archived' : '');
  card.style.setProperty('--proj-accent', projAccentColor(proj.hue));
  card.innerHTML = `
    <button class="project-menu-btn" title="项目操作">${icon('ellipsis')}</button>
    <div class="project-card-name">${aggGlyph(sum.running, sum.unread, '该项目下', sum.sessionRows)}${escHtml(proj.name)}</div>
    <div class="project-card-stats">
      <span class="proj-stat" title="进行中任务">${icon('hourglass')} <strong>${sum.inProgress}</strong> 进行中</span>
      <span class="proj-stat" title="任务总数">共 <strong>${sum.total}</strong> 任务 · ${sum.open} 未完</span>
      <span class="proj-stat" title="关联会话">${icon('square-terminal')} <strong>${sum.sessions}</strong> 会话</span>
    </div>
  `;
  card.querySelector('.project-menu-btn').addEventListener('click', e => {
    e.stopPropagation();
    openProjectEditMenu(e.currentTarget, proj);
  });
  card.addEventListener('click', () => openProject(proj.id));
  return card;
}

function renderProjects() {
  const container = document.getElementById('projects-content');
  container.innerHTML = '';

  if (projects.length === 0) {
    container.innerHTML = `<div class="now-empty" style="padding:32px;display:flex;flex-direction:column;align-items:center;gap:12px">
      <span>（暂无项目）</span>
      <button class="btn-new-session" id="projects-empty-new-btn">${icon('folder-plus')} 新建项目</button>
    </div>`;
    container.querySelector('#projects-empty-new-btn').addEventListener('click', () => openCreateProjectDialog());
    return;
  }

  const q = (document.getElementById('project-search')?.value || '').trim().toLowerCase();

  // When searching, surface matching tasks (click → open their project).
  if (q) {
    const matches = allTodos.filter(t => (t.title || '').toLowerCase().includes(q)).slice(0, 40);
    const sec = document.createElement('div');
    sec.className = 'projects-section';
    sec.innerHTML = `<div class="projects-section-title">匹配的任务 <span class="ps-count">${matches.length}</span></div>`;
    if (matches.length === 0) {
      sec.innerHTML += '<div class="now-empty">（无匹配任务）</div>';
    } else {
      const list = document.createElement('div');
      list.className = 'task-search-list';
      for (const t of matches) {
        const row = document.createElement('div');
        row.className = 'task-search-row';
        row.innerHTML = `
          <span class="status-chip ${todoStatusClass(t.status)}">${escHtml(t.status)}</span>
          <span class="priority-chip priority-${escHtml((t.priority || 'p?').toLowerCase())}">${escHtml(t.priority || '—')}</span>
          <span class="task-search-title">${escHtml(t.title)}</span>
          <span class="now-row-meta project-tag">${escHtml(todoProjectLabel(t) || '（无项目）')}</span>
        `;
        const pid = todoProjectId(t);
        if (pid) row.addEventListener('click', () => openProject(pid));
        list.appendChild(row);
      }
      sec.appendChild(list);
    }
    container.appendChild(sec);
  }

  const match = p => !q || p.name.toLowerCase().includes(q);
  const active = projects.filter(p => !p.archived && match(p));
  const archived = projects.filter(p => p.archived && match(p));

  // 活跃项目
  const activeSec = document.createElement('div');
  activeSec.className = 'projects-section';
  activeSec.innerHTML = `<div class="projects-section-title">活跃项目 <span class="ps-count">${active.length}</span></div>`;
  const activeGrid = document.createElement('div');
  activeGrid.className = 'projects-grid';
  if (active.length === 0) activeGrid.innerHTML = '<div class="now-empty">（暂无活跃项目）</div>';
  else active.forEach(p => activeGrid.appendChild(buildProjectCard(p)));
  activeSec.appendChild(activeGrid);
  container.appendChild(activeSec);

  // 已归档项目 (collapsed by default)
  if (archived.length > 0) {
    const archSec = document.createElement('div');
    archSec.className = 'projects-section';
    const hdr = document.createElement('div');
    hdr.className = 'projects-section-title collapsible collapsed';
    hdr.innerHTML = `<span class="ps-chevron">${icon('chevron-down')}</span>已归档项目 <span class="ps-count">${archived.length}</span>`;
    const archGrid = document.createElement('div');
    archGrid.className = 'projects-grid collapsed';
    archived.forEach(p => archGrid.appendChild(buildProjectCard(p)));
    hdr.addEventListener('click', () => {
      const collapsed = hdr.classList.toggle('collapsed');
      archGrid.classList.toggle('collapsed', collapsed);
    });
    archSec.appendChild(hdr);
    archSec.appendChild(archGrid);
    container.appendChild(archSec);
  }
}

/** The switchable project list shown beside an open project workspace. */
function renderProjectSidebar(currentName) {
  const list = document.getElementById('project-list');
  if (!list) return;
  list.innerHTML = '';

  const buildItem = proj => {
    const sum = projectSummary(proj);
    const item = document.createElement('div');
    item.className = 'project-list-item' + (proj.id === currentName ? ' current' : '');
    item.innerHTML = `
      <div class="pli-name"><span class="pli-title">${escHtml(proj.name)}</span>${projectListStatusGlyph(sum.running, sum.unread)}</div>
      <div class="pli-stats">${icon('hourglass')}${sum.inProgress} · ${sum.open}未完 · ${icon('link-2')}${sum.sessions}</div>
    `;
    item.addEventListener('click', () => openProject(proj.id));
    return item;
  };

  const group = (title, arr) => {
    if (arr.length === 0) return;
    const h = document.createElement('div');
    h.className = 'project-list-group';
    h.textContent = `${title} (${arr.length})`;
    list.appendChild(h);
    arr.forEach(p => list.appendChild(buildItem(p)));
  };
  group('活跃', projects.filter(p => !p.archived));
  group('已归档', projects.filter(p => p.archived));
}

async function archiveProject(name, on) {
  try {
    const res = await fetch('/api/projects/archive', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: name, on }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || ('HTTP ' + res.status));
  } catch (e) { alert('项目归档失败：' + e.message); return; }
  const p = projectById(name);
  if (p) p.archived = on;
  renderProjects();
  if (document.getElementById('workspace-view').style.display !== 'none') {
    renderProjectSidebar(document.getElementById('workspace-title').dataset.projectId);
  }
}

function renderProjectSurfaces(projectId) {
  renderProjects();
  if (document.getElementById('workspace-view').style.display !== 'none') {
    const titleEl = document.getElementById('workspace-title');
    const currentId = titleEl?.dataset.projectId;
    if (currentId === projectId) {
      const p = projectById(projectId);
      if (p) {
        titleEl.textContent = p.name;
        renderWorkspace(projectId);
      } else {
        setMode('projects');
      }
    }
    renderProjectSidebar(currentId);
  }
  updateNavUnreadIndicators();
}

async function renameProjectRemote(proj) {
  const next = (prompt('项目新名称', proj.name) || '').trim();
  if (!next || next === proj.name) return;
  const prevName = proj.name;
  proj.name = next;
  for (const t of allTodos) if (todoProjectId(t) === proj.id || t.project === prevName) t.project = next;
  for (const s of allSessions) if (s.projectId === proj.id || s.project === prevName) s.project = next;
  renderProjectSurfaces(proj.id);
  try {
    const res = await fetch('/api/projects/' + encodeURIComponent(proj.id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    if (d.project?.name) proj.name = d.project.name;
    renderProjectSurfaces(proj.id);
  } catch (e) {
    proj.name = prevName;
    for (const t of allTodos) if (todoProjectId(t) === proj.id || t.project === next) t.project = prevName;
    for (const s of allSessions) if (s.projectId === proj.id || s.project === next) s.project = prevName;
    renderProjectSurfaces(proj.id);
    alert('项目重命名失败：' + e.message);
  }
}

async function deleteProjectRemote(proj) {
  if (!confirm(`确定删除项目「${proj.name}」？任务和会话会保留，但会清除项目归属。`)) return;
  const prevProjects = projects.slice();
  const prevTodos = allTodos.map(t => ({ ref: t, projectId: t.projectId, project: t.project }));
  const prevSessions = allSessions.map(s => ({ ref: s, projectId: s.projectId, project: s.project }));
  projects = projects.filter(p => p.id !== proj.id);
  for (const t of allTodos) if (todoProjectId(t) === proj.id || t.project === proj.name) { t.projectId = null; t.project = null; }
  for (const s of allSessions) if (s.projectId === proj.id || s.project === proj.name) { s.projectId = null; s.project = null; }
  renderProjectSurfaces(proj.id);
  try {
    const res = await fetch('/api/projects/' + encodeURIComponent(proj.id), { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || ('HTTP ' + res.status));
  } catch (e) {
    projects = prevProjects;
    for (const x of prevTodos) { x.ref.projectId = x.projectId; x.ref.project = x.project; }
    for (const x of prevSessions) { x.ref.projectId = x.projectId; x.ref.project = x.project; }
    renderProjectSurfaces(proj.id);
    alert('项目删除失败：' + e.message);
  }
}

// ── Markdown context doc editor (edit + live preview + save) ──────────────────
let docState = { ref: null, baseMtime: null, dirty: false };

function setDocStatus(text, cls) {
  const s = document.getElementById('doc-modal-status');
  s.innerHTML = text;   // callers pass our own controlled strings (may include an icon() SVG)
  s.className = 'doc-modal-status' + (cls ? ' ' + cls : '');
}

function renderDocPreview() {
  const preview = document.getElementById('doc-preview');
  const md = document.getElementById('doc-editor').value;
  try { preview.innerHTML = window.marked ? window.marked.parse(md) : escHtml(md); }
  catch (e) { preview.textContent = '(预览失败) ' + e.message; return; }
  // Embedded images are note-relative (e.g. `assets/x.png`). Resolve each against the doc's OWN
  // directory (tasks/<id>/ or projects/<name>/) and serve via the asset endpoint.
  const dir = docDirOf(docState.ref);
  preview.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || '';
    if (!/^(https?:|data:|blob:|\/)/i.test(src)) {
      const rel = src.replace(/^\.\//, '');
      img.src = '/api/doc-asset?path=' + encodeURIComponent(dir ? dir + '/' + rel : rel);
    }
  });
}

/** The root-relative directory of a doc ref (handles plain refs and obsidian-wrapped file= refs). */
function docDirOf(ref) {
  if (!ref) return '';
  let path = ref;
  const m = ref.match(/[?&]file=([^&\]\)\s"']+)/);
  if (m) { try { path = decodeURIComponent(m[1]); } catch { path = m[1]; } }
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash) : '';
}

function openDocEditor(ref, title) {
  const modal = document.getElementById('doc-modal');
  const editor = document.getElementById('doc-editor');
  const obs = document.getElementById('doc-open-obsidian');
  document.getElementById('doc-modal-title').textContent = title || ref;
  // ref may be a markdown-wrapped link; pull out the bare obsidian:// URL for the ↗ button.
  const obsMatch = ref && ref.match(/obsidian:\/\/[^\]\)\s"']+/);
  obs.href = obsMatch ? obsMatch[0] : '#';
  obs.style.display = obsMatch ? '' : 'none';
  editor.value = ''; editor.disabled = true;
  document.getElementById('doc-preview').innerHTML = '';
  setDocStatus('加载中…', '');
  modal.style.display = 'flex';

  fetch('/api/doc?path=' + encodeURIComponent(ref))
    .then(r => r.json().then(d => ({ ok: r.ok, d })))
    .then(({ ok, d }) => {
      if (!ok) { setDocStatus('打开失败: ' + (d.error || ''), 'error'); return; }
      docState = { ref, baseMtime: d.mtime, dirty: false };
      editor.disabled = false;
      editor.value = d.content;
      renderDocPreview();
      setDocStatus('已加载', '');
      editor.focus();
    })
    .catch(e => setDocStatus('打开失败: ' + e.message, 'error'));
}

async function saveDoc() {
  if (!docState.ref) return;
  const editor = document.getElementById('doc-editor');
  const saveBtn = document.getElementById('doc-save-btn');
  saveBtn.disabled = true; setDocStatus('保存中…', '');
  try {
    const res = await fetch('/api/doc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: docState.ref, content: editor.value, baseMtime: docState.baseMtime }),
    });
    const d = await res.json();
    if (res.status === 409) {
      docState.baseMtime = d.mtime;  // adopt disk mtime; a second 保存 click will overwrite
      setDocStatus(`${icon('triangle-alert')} 文件已被外部修改（如 Obsidian）。再次点「保存」会覆盖外部改动。`, 'error');
    } else if (!res.ok) {
      setDocStatus('保存失败: ' + (d.error || res.statusText), 'error');
    } else {
      docState.baseMtime = d.mtime; docState.dirty = false;
      setDocStatus(`${icon('circle-check')} 已保存`, 'ok');
    }
  } catch (e) { setDocStatus('保存失败: ' + e.message, 'error'); }
  saveBtn.disabled = false;
}

function closeDocEditor() {
  if (document.getElementById('doc-modal').style.display === 'none') return;
  if (docState.dirty && !confirm('有未保存的修改，确定关闭？')) return;
  document.getElementById('doc-modal').style.display = 'none';
  docState = { ref: null, baseMtime: null, dirty: false };
}

// ── Project Workspace ──────────────────────────────────────────────────────

/**
 * Context section, grouped by task. Project context sits on top; each task gets a "▸ 任务名"
 * subheading with its own context-doc row. Every context row carries an inline "＋补充" button.
 */
function buildContextSection(name, projTodos) {
  const sec = document.createElement('div');
  sec.className = 'ws-section';
  sec.innerHTML = `<div class="ws-section-title">${icon('paperclip')} 上下文</div>`;

  // Rows live in a height-capped, scrollable body so a project with many tasks doesn't push the
  // 会话 section off-screen. The section title above stays fixed.
  const body = document.createElement('div');
  body.className = 'ws-section-scroll';

  // Project context (top).
  body.appendChild(buildContextRow({
    label: '项目上下文', cls: 'proj', kind: 'project', key: name, title: name,
  }));

  // One group per task.
  for (const t of projTodos) {
    const grp = document.createElement('div');
    grp.className = 'ctx-group-title';
    grp.textContent = '▸ ' + t.title;
    body.appendChild(grp);
    body.appendChild(buildContextRow({
      label: '任务上下文', cls: 'task', kind: 'task', key: t.id, title: t.title,
    }));
  }
  sec.appendChild(body);
  return sec;
}

/** One clickable context-doc row (opens the doc, lazily creating it) + its inline supplement control. */
function buildContextRow(opts) {
  const wrap = document.createElement('div');
  wrap.className = 'ctx-row-wrap';
  const row = document.createElement('div');
  row.className = 'doc-link ctx-row';
  row.innerHTML = `<span class="doc-link-icon">${icon('file-text')}</span>` +
    `<span class="doc-link-title ${opts.cls === 'proj' ? 'ctx-proj' : ''}">${escHtml(opts.label)}</span>`;
  // Open the doc on click (lazily create via /api/context if it doesn't exist yet).
  row.addEventListener('click', async () => {
    try {
      const r = await fetch('/api/context', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: opts.kind, key: opts.key, title: opts.title }),
      });
      const d = await r.json();
      if (!r.ok) { alert('打开上下文失败: ' + (d.error || r.statusText)); return; }
      openDocEditor(d.ref, opts.title + ' — ' + opts.label);
    } catch (e) { alert('打开上下文失败: ' + e.message); }
  });
  addSupplementButton(row, opts);
  wrap.appendChild(row);
  return wrap;
}

/**
 * Add a "＋补充" button to a context row. Clicking toggles an inline panel: a textarea for
 * prompt/data/info, then POSTs to /api/context/update so the backend agent folds it into the doc.
 * Result shows which sections changed + a revert link.
 */
function addSupplementButton(row, opts) {
  const stateKey = contextSupplementKey(opts);
  const btn = document.createElement('button');
  btn.className = 'ctx-supplement-btn';
  btn.dataset.contextKey = stateKey;
  applyContextSupplementButtonState(btn, contextUpdatePending.has(stateKey));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();                                    // don't trigger the row's open-doc click
    if (contextUpdatePending.has(stateKey)) return;
    const wrap = row.parentElement;
    const existing = wrap.querySelector('.ctx-supplement-panel');
    if (existing) { existing.remove(); return; }            // toggle off
    const panel = buildSupplementPanel(opts);
    wrap.appendChild(panel);
    panel.querySelector('textarea').focus();
  });
  row.appendChild(btn);
}

function contextSupplementKey(opts) {
  return opts.kind + ':' + opts.key;
}

function contextAgentErrorText(data, fallback) {
  // Auth/timeout/other blocks carry an actionable hint (e.g. "运行 `claude login` 后重试") — prefer it.
  if (data && data.blocked && data.hint) return data.hint;
  return (data && data.error) || fallback || 'unknown error';
}

/**
 * After a silent delay, hint on the given button(s) that the internal agent may be blocked on auth —
 * so a long wait is never silent. Returns a canceller to call in `finally`.
 */
function startAgentHeartbeat(btns, ms = 15000) {
  const list = (Array.isArray(btns) ? btns : [btns]).filter(Boolean);
  const origTitles = list.map(b => b.getAttribute('title'));
  const timer = setTimeout(() => {
    list.forEach(b => { b.title = '仍在处理…内部 agent 可能需要重新登录（claude login / codex login）'; });
  }, ms);
  return () => {
    clearTimeout(timer);
    list.forEach((b, i) => { if (origTitles[i] == null) b.removeAttribute('title'); else b.title = origTitles[i]; });
  };
}

function applyContextSupplementButtonState(btn, busy) {
  btn.disabled = busy;
  btn.classList.toggle('loading', busy);
  btn.title = busy ? 'agent 正在更新这份上下文…' : '补充上下文：给 agent 一些信息，它据此更新这份上下文';
  btn.innerHTML = busy ? `${icon('loader')} 更新中…` : `${icon('plus')} 补充`;
}

function applyContextSupplementPanelState(panel, busy) {
  panel.classList.toggle('is-updating', busy);
  panel.setAttribute('aria-busy', busy ? 'true' : 'false');
  const input = panel.querySelector('.ctx-supplement-input');
  if (input) input.disabled = busy;
  panel.querySelectorAll('.todo-thumb-x').forEach(b => { b.disabled = busy; });
  const send = panel.querySelector('.ctx-supplement-send');
  if (!send) return;
  if (!send.dataset.idleHtml) send.dataset.idleHtml = send.innerHTML;
  send.disabled = busy;
  send.classList.toggle('loading', busy);
  send.innerHTML = busy ? `${icon('loader')} 更新中…` : send.dataset.idleHtml;
}

function setContextSupplementBusy(stateKey, busy) {
  if (busy) contextUpdatePending.add(stateKey);
  else contextUpdatePending.delete(stateKey);
  document.querySelectorAll('.ctx-supplement-btn').forEach(btn => {
    if (btn.dataset.contextKey === stateKey) applyContextSupplementButtonState(btn, busy);
  });
  document.querySelectorAll('.ctx-supplement-panel').forEach(panel => {
    if (panel.dataset.contextKey === stateKey) applyContextSupplementPanelState(panel, busy);
  });
}

function buildSupplementPanel(opts) {
  const stateKey = contextSupplementKey(opts);
  const panel = document.createElement('div');
  panel.className = 'ctx-supplement-panel';
  panel.dataset.contextKey = stateKey;
  panel.innerHTML = `
    <textarea class="ctx-supplement-input" placeholder="告诉 agent 要补充/修正什么…（⌘/Ctrl+回车提交，可粘贴图片）"></textarea>
    <div class="create-todo-thumbs ctx-supplement-thumbs" style="display:none"></div>
    <div class="ctx-supplement-actions">
      <span class="ctx-supplement-status"></span>
      <button class="ctx-supplement-send">${icon('arrow-right')} 让 agent 更新</button>
    </div>`;
  const input = panel.querySelector('.ctx-supplement-input');
  const send = panel.querySelector('.ctx-supplement-send');
  const statusEl = panel.querySelector('.ctx-supplement-status');
  const thumbs = panel.querySelector('.ctx-supplement-thumbs');
  const pendingImages = [];

  const renderThumbs = () => {
    thumbs.innerHTML = '';
    thumbs.style.display = pendingImages.length ? 'flex' : 'none';
    pendingImages.forEach((src, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'todo-thumb';
      wrap.innerHTML = `<img src="${src}"><button class="todo-thumb-x" title="移除">${icon('x')}</button>`;
      wrap.querySelector('.todo-thumb-x').addEventListener('click', () => { pendingImages.splice(i, 1); renderThumbs(); });
      thumbs.appendChild(wrap);
    });
    applyContextSupplementPanelState(panel, contextUpdatePending.has(stateKey));
  };

  input.addEventListener('paste', e => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    let handled = false;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (file) {
          handled = true;
          const reader = new FileReader();
          reader.onload = () => { pendingImages.push(reader.result); renderThumbs(); };
          reader.readAsDataURL(file);
        }
      }
    }
    if (handled) e.preventDefault();
  });

  applyContextSupplementPanelState(panel, contextUpdatePending.has(stateKey));
  const submit = async () => {
    if (contextUpdatePending.has(stateKey)) return;
    const userInput = input.value.trim();
    if (!userInput && pendingImages.length === 0) { statusEl.textContent = '先写点要补充的内容，或粘贴图片'; return; }
    const images = pendingImages.slice();
    setContextSupplementBusy(stateKey, true); statusEl.textContent = 'agent 更新中…';
    try {
      const r = await fetch('/api/context/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: opts.kind, key: opts.key, userInput, images }),
      });
      const d = await r.json();
      if (!r.ok) { statusEl.textContent = '失败: ' + contextAgentErrorText(d, r.statusText); return; }
      renderSupplementResult(panel, opts, d);
    } catch (e) { statusEl.textContent = '失败: ' + e.message; }
    finally { setContextSupplementBusy(stateKey, false); }
  };
  send.addEventListener('click', submit);
  input.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
  });
  return panel;
}

/** After a successful update: show changed sections + 查看全文 / 回滚此次. */
function renderSupplementResult(panel, opts, d) {
  const touched = [...(d.changed || []), ...(d.added || [])];
  const summary = touched.length ? '已更新：' + touched.join('、') : '无实质改动';
  panel.innerHTML =
    `<div class="ctx-supplement-done">✅ ${escHtml(summary)}</div>` +
    `<div class="ctx-supplement-links">` +
    `<a class="ctx-link-open">查看全文</a>` +
    (d.commit ? ` · <a class="ctx-link-revert">回滚此次</a>` : '') +
    `</div>`;
  panel.querySelector('.ctx-link-open').addEventListener('click', () => openDocEditor(d.ref, opts.title + ' — ' + opts.label));
  const revert = panel.querySelector('.ctx-link-revert');
  if (revert) revert.addEventListener('click', async () => {
    if (!confirm('回滚此次 agent 更新？')) return;
    const r = await fetch('/api/doc/revert', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commit: d.commit }),
    });
    const rd = await r.json();
    panel.querySelector('.ctx-supplement-done').textContent = r.ok ? '↩ 已回滚' : '回滚失败: ' + (rd.error || r.statusText);
  });
}

function renderWorkspace(name) {
  const container = document.getElementById('workspace-content');
  container.innerHTML = '';

  const projTodos = allTodos.filter(t => todoProjectId(t) === name);
  const projSessions = allSessions.filter(s => s.projectId === name);

  const total = projTodos.length;
  const done = projTodos.filter(t => DONE_STATUSES.has(t.status)).length;
  const inProgressCount = projTodos.filter(t => t.status === '进行中').length;

  // Newest attached session time
  let newestActivity = null;
  if (projSessions.length > 0) {
    newestActivity = Math.max(...projSessions.map(s => s.updatedAt));
  }

  // ── Header / Rollup
  const header = document.createElement('div');
  header.className = 'workspace-header';

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  header.innerHTML = `
    <div class="workspace-rollup">
      <div class="rollup-row">
        <span class="rollup-label">任务进展</span>
        <span class="rollup-val">${done} / ${total}</span>
        <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
        <span class="rollup-pct">${pct}%</span>
      </div>
      <div class="rollup-row">
        <span class="rollup-label">进行中</span>
        <span class="rollup-val amber">${inProgressCount}</span>
        <span class="rollup-label" style="margin-left:16px">最近活动</span>
        <span class="rollup-val">${newestActivity ? relativeTime(newestActivity) : '—'}</span>
      </div>
    </div>
  `;
  container.appendChild(header);

  // ── Section 1: 任务 (status board) ──
  const todoSection = document.createElement('div');
  todoSection.className = 'ws-section';
  todoSection.innerHTML = `<div class="ws-section-title">${icon('list-checks')} 任务</div>`;

  if (projTodos.length === 0) {
    todoSection.innerHTML += '<div class="ws-empty">（该项目暂无任务）</div>';
  } else {
    todoSection.appendChild(buildTodoBoard(projTodos, name));
  }
  container.appendChild(todoSection);

  // ── Section 2: 上下文 (grouped by task — layout C)
  container.appendChild(buildContextSection(name, projTodos));

  // ── Section 3: 会话 (nested under tasks)
  const sessSection = document.createElement('div');
  sessSection.className = 'ws-section';
  sessSection.innerHTML = `<div class="ws-section-title">${icon('square-terminal')} 会话</div>`;

  // Helper: render one session row (clickable → open terminal)
  const buildWsSessionRow = s => {
    const row = document.createElement('div');
    row.className = 'ws-session-row';
    row.draggable = true;
    const wst = displayTitle(s);
    // When this session is already linked to a task, surface it as a tag on the row (and let the
    // button double as a "change/detach" affordance) instead of a generic "▾ 任务".
    const linkedTask = s.todoKey ? projTodos.find(t => t.id === s.todoKey) : null;
    const taskBtnHtml = linkedTask
      ? `<button class="ws-sess-task-btn linked" title="已关联任务：${escHtml(linkedTask.title)}（点击修改或移出）">${icon('link-2')}<span class="ws-task-tag-label">${escHtml(linkedTask.title)}</span></button>`
      : `<button class="ws-sess-task-btn" title="归到某个任务（或移出）">${icon('chevron-down')} 任务</button>`;
    row.innerHTML = `
      <span class="ws-drag-grip" title="拖到上方某个任务即可归属">⠿</span>
      ${statusGlyph(s)}
      <span class="cli-badge ${escHtml(s.cli)}">${escHtml(s.cli)}</span>
      <span class="ws-sess-title" title="${escHtml(wst)}">${escHtml(wst)}</span>
      <span class="ws-sess-meta">${s.cwd ? escHtml(shortCwd(s.cwd)) : ''}</span>
      <span class="ws-sess-time">${relativeTime(s.updatedAt)}</span>
      <button class="ws-sess-ctx-btn" title="刷新上下文（让 Berth 读本会话并更新任务/项目上下文文件）">${icon('refresh-cw')}</button>
      ${taskBtnHtml}
    `;
    row.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/berth-session', s.sessionId);
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('click', e => {
      if (e.target.closest('.ws-sess-task-btn')) return;
      if (e.target.closest('.ws-sess-ctx-btn')) return;
      openTerminalFor(s.sessionId);
    });
    row.querySelector('.ws-sess-task-btn').addEventListener('click', e => {
      e.stopPropagation();
      openTaskMenu(e.currentTarget, s, projTodos, name);
    });
    row.querySelector('.ws-sess-ctx-btn').addEventListener('click', e => {
      e.stopPropagation();
      consolidateSession(s.sessionId, e.currentTarget);
    });
    return row;
  };

  // Group ALL of this project's sessions by cwd directory (task association is shown at the
  // task level now). Rows stay draggable + carry the ▾ 任务 button so you can still assign.
  const sessList = document.createElement('div');
  sessList.className = 'ws-session-list';

  if (projSessions.length === 0) {
    sessSection.innerHTML += '<div class="ws-empty">（还没有会话归到这个项目；用上面的「＋ 新建会话」或「▷ 起会话」起一个，或去「全部会话」里归属过来）</div>';
  } else {
    const cwdMap = new Map();
    for (const s of projSessions) {
      const key = s.cwd || '__no_cwd__';
      if (!cwdMap.has(key)) cwdMap.set(key, []);
      cwdMap.get(key).push(s);
    }
    // Sort cwd groups by most-recent session in each.
    const sortedCwds = [...cwdMap.entries()].sort((a, b) =>
      Math.max(...b[1].map(s => s.updatedAt)) - Math.max(...a[1].map(s => s.updatedAt)));

    for (const [cwd, sessions] of sortedCwds) {
      const collapseKey = name + ' ' + cwd;
      const collapsed = wsCollapsedCwds.has(collapseKey);
      const grpHdr = document.createElement('div');
      grpHdr.className = 'ws-task-header ws-cwd-collapsible' + (collapsed ? ' collapsed' : '');
      const label = cwd === '__no_cwd__' ? '(无 cwd)' : shortCwd(cwd);
      const full = cwd === '__no_cwd__' ? '(no cwd)' : cwd;
      grpHdr.innerHTML = `
        <span class="ws-task-icon">${icon('chevron-right')}</span>
        <span class="ws-task-title" title="${escHtml(full)}">${escHtml(label)}</span>
        ${unreadHeaderDot(sessions)}
        <span class="ws-task-count">${sessions.length}</span>
      `;
      // Rows for this group live in their own wrapper so the header can toggle them.
      const grpRows = document.createElement('div');
      grpRows.className = 'ws-cwd-rows';
      if (collapsed) grpRows.style.display = 'none';
      [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).forEach(s => {
        grpRows.appendChild(buildWsSessionRow(s));
      });
      grpHdr.addEventListener('click', () => {
        const nowCollapsed = !wsCollapsedCwds.has(collapseKey);
        if (nowCollapsed) wsCollapsedCwds.add(collapseKey); else wsCollapsedCwds.delete(collapseKey);
        grpHdr.classList.toggle('collapsed', nowCollapsed);
        grpRows.style.display = nowCollapsed ? 'none' : '';
      });
      sessList.appendChild(grpHdr);
      sessList.appendChild(grpRows);
    }
    sessSection.appendChild(sessList);
  }
  container.appendChild(sessSection);
}

function todoStatusClass(status) {
  if (status === '进行中') return 'status-inprogress';
  if (status === '已完成') return 'status-done';
  if (status === '已取消') return 'status-cancelled';
  if (status === '阻塞') return 'status-blocked';
  if (status === '待验证') return 'status-verifying';
  return 'status-todo';
}

// ── Session row builder ────────────────────────────────────────────────────

// Compose icon (pencil) used for "new session" affordances on group headers.
const COMPOSE_SVG = icon('pencil');
// Folder-plus icon for "create project".
const COMPOSE_NEWPROJ_SVG = icon('folder-plus');

/** Modal to create a new project: name + pick a home directory (folder picker). */
function openCreateProjectDialog() {
  closeMenu();
  const back = document.createElement('div');
  back.className = 'cp-backdrop';
  back.innerHTML = `
    <div class="cp-box">
      <div class="cp-title">新建项目</div>
      <label class="cp-field"><span>项目名</span>
        <input class="cp-name" type="text" placeholder="例如 Berth" spellcheck="false" autocomplete="off"></label>
      <label class="cp-field"><span>主目录</span>
        <span class="cp-cwd-wrap"><input class="cp-cwd" type="text" placeholder="选择文件夹…" spellcheck="false">
        <button class="cp-browse" title="选择文件夹">${icon('folder')}</button></span></label>
      <div class="cp-feedback" style="display:none"></div>
      <div class="cp-actions"><button class="cp-cancel">取消</button><button class="cp-go">创建</button></div>
    </div>`;
  document.body.appendChild(back);
  const nameEl = back.querySelector('.cp-name');
  const cwdEl = back.querySelector('.cp-cwd');
  const fb = back.querySelector('.cp-feedback');
  const close = () => back.remove();

  back.querySelector('.cp-browse').addEventListener('click', async () => {
    const p = await pickFolder(cwdEl.value.trim());
    if (p) cwdEl.value = p;
  });
  back.querySelector('.cp-cancel').addEventListener('click', close);
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.querySelector('.cp-go').addEventListener('click', async () => {
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }
    fb.style.display = 'block'; fb.className = 'cp-feedback'; fb.textContent = '创建中…';
    try {
      const res = await fetch('/api/projects/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cwd: cwdEl.value.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) { fb.className = 'cp-feedback error'; fb.textContent = '失败：' + (d.error || res.statusText); return; }
      close();
      await fetch('/api/projects?force=1');   // bust server cache
      await loadAll();
    } catch (e) { fb.className = 'cp-feedback error'; fb.textContent = '失败：' + e.message; }
  });
  nameEl.focus();
}

/**
 * Add a hover ✎ (compose) button to a sidebar section header → open the launch popover.
 * `ctx` is passed to openLaunchPopover (projectName/todoKey); `cwdHint` preselects the cwd.
 */
function addSectionLaunchBtn(sectionEl, ctx, cwdHint) {
  const hdr = sectionEl.querySelector('.section-header');
  if (!hdr) return;
  const btn = document.createElement('button');
  btn.className = 'proj-launch-btn';
  btn.title = '在此新建会话';
  btn.innerHTML = COMPOSE_SVG;
  btn.addEventListener('click', e => {
    e.stopPropagation();   // don't toggle the section
    openLaunchPopover(e.currentTarget, ctx, cwdHint);
  });
  const count = hdr.querySelector('.section-count');
  hdr.insertBefore(btn, count);   // sits just left of the count
}

/** Make a sidebar section a drop target: dropping a dragged session assigns it to `projectId` (null = detach). */
function makeSessionDropTarget(sectionEl, projectId) {
  sectionEl.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('text/berth-session')) return;
    e.preventDefault();
    sectionEl.classList.add('proj-drop-target');
  });
  sectionEl.addEventListener('dragleave', e => {
    if (!sectionEl.contains(e.relatedTarget)) sectionEl.classList.remove('proj-drop-target');
  });
  sectionEl.addEventListener('drop', e => {
    sectionEl.classList.remove('proj-drop-target');
    const sid = e.dataTransfer.getData('text/berth-session');
    if (!sid) return;
    e.preventDefault();
    assign(sid, projectId);
  });
}

function buildRow(s) {
  if (s.__pending) return buildPendingRow(s);
  const div = document.createElement('div');
  div.className = 'session-row' + (s.deleted ? ' deleted' : '') + (s.sessionId === selectedId ? ' selected' : '');
  div.dataset.id = s.sessionId;
  div.draggable = true;
  div.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/berth-session', s.sessionId);
    e.dataTransfer.effectAllowed = 'move';
    div.classList.add('dragging');
  });
  div.addEventListener('dragend', () => div.classList.remove('dragging'));

  const title = displayTitle(s);
  const deletedIcon = s.deleted ? icon('ban') + ' ' : '';

  div.innerHTML = `
    ${statusGlyph(s)}
    <div class="row-info">
      <div class="row-title${isUntitled(s) ? ' untitled' : ''}" title="${escHtml(title)}">${deletedIcon}${escHtml(title)}</div>
      <div class="row-meta">
        <span class="cli-badge ${escHtml(s.cli)}">${escHtml(s.cli)}</span>
        ${s.cwd ? `<span class="cwd-text">${escHtml(shortCwd(s.cwd))}</span>` : ''}
      </div>
    </div>
    <span class="row-time">${relativeTime(s.updatedAt)}</span>
    <div class="row-actions">
      <button class="action-btn btn-gen-title" title="用 AI 生成标题">${icon('sparkles')}</button>
      <button class="action-btn pin-btn ${s.pinned ? 'pinned' : ''}" title="${s.pinned ? 'Unpin' : 'Pin'}">${icon('pin')}</button>
      <button class="action-btn menu-btn" title="More…">${icon('ellipsis')}</button>
    </div>
  `;

  // Click row → open terminal
  div.addEventListener('click', e => {
    if (e.target.closest('.row-actions') || e.target.closest('.row-title-input')) return;
    selectSession(s.sessionId);
  });

  div.querySelector('.row-title').addEventListener('dblclick', e => {
    e.stopPropagation();
    startSessionTitleEdit(div, s);
  });

  // Generate-title button
  div.querySelector('.btn-gen-title').addEventListener('click', e => {
    e.stopPropagation();
    generateTitle(s.sessionId, e.currentTarget);
  });

  // Pin button
  div.querySelector('.pin-btn').addEventListener('click', e => {
    e.stopPropagation();
    pin(s.sessionId, !s.pinned);
  });

  // Menu button
  div.querySelector('.menu-btn').addEventListener('click', e => {
    e.stopPropagation();
    openMenu(e.currentTarget, s);
  });

  if (editingSessionTitle && editingSessionTitle.sessionId === s.sessionId) mountSessionTitleInput(div, s);

  return div;
}

/** A placeholder row for a fresh launch whose real session hasn't surfaced yet ("创建中…" / "启动失败"). */
function buildPendingRow(s) {
  const failed = s.__status === 'failed';
  const active = s.sessionId === selectedId || s.sessionId === activeTerminalId;
  const div = document.createElement('div');
  div.className = 'session-row pending' + (failed ? ' failed' : '') + (active ? ' selected' : '');
  div.dataset.id = s.sessionId;
  div.innerHTML = `
    <span class="pending-spinner${failed ? ' failed' : ''}">${failed ? icon('triangle-alert') : ''}</span>
    <div class="row-info">
      <div class="row-title">${failed ? '启动失败' : '创建中…'}</div>
      <div class="row-meta">
        <span class="cli-badge ${escHtml(s.cli)}">${escHtml(s.cli)}</span>
        ${s.cwd ? `<span class="cwd-text">${escHtml(shortCwd(s.cwd))}</span>` : ''}
      </div>
    </div>
    ${failed
      ? `<div class="row-actions"><button class="action-btn pending-dismiss" title="移除">${icon('x')}</button></div>`
      : '<span class="row-time">…</span>'}
  `;
  div.addEventListener('click', e => {
    if (e.target.closest('.pending-dismiss')) return;
    if (failed) return;          // a failed launch has no live terminal to open
    selectPending(s.sessionId);
  });
  const dismiss = div.querySelector('.pending-dismiss');
  if (dismiss) dismiss.addEventListener('click', e => { e.stopPropagation(); dismissPending(s.sessionId); });
  return div;
}

// ── Dropdown menu ──────────────────────────────────────────────────────────

function closeMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

function openMenu(anchor, session) {
  closeMenu();

  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';

  // Project assignment items
  const currentProjectId = session.projectId;
  const projItems = [
    ...projects.map(p => ({
      id: p.id,
      label: p.name,
      active: currentProjectId === p.id
    })),
    { id: null, label: '无归属 (detach)', active: currentProjectId === null, cls: 'detach' }
  ];

  let html = '<div class="menu-section">Assign to project</div>';
  for (const p of projItems) {
    html += `<div class="menu-item ${p.active ? 'active' : ''} ${p.cls || ''}" data-project-id="${p.id === null ? '__null__' : escHtml(p.id)}">${p.id === null ? icon('ban') + ' ' : ''}${escHtml(p.label)}</div>`;
  }
  menu.innerHTML = html;

  menu.querySelectorAll('.menu-item[data-project-id]').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      const raw = item.dataset.projectId;
      const projectId = raw === '__null__' ? null : raw;
      assign(session.sessionId, projectId);
      closeMenu();
    });
  });

  document.body.appendChild(menu);
  positionFloatingPanel(menu, anchor, { align: 'end' });
  activeMenu = menu;

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', closeMenu, { once: true });
  }, 0);
}

/**
 * Dropdown to assign a session to one of `projTodos` (a project's tasks) or detach (无任务).
 */
function openTaskMenu(anchor, session, projTodos, projectName) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';

  const currentTask = session.todoKey || null;
  let html = '<div class="menu-section">归到任务</div>';
  if (projTodos.length === 0) {
    html += '<div class="menu-item" style="color:var(--text-dim);pointer-events:none">（该项目暂无任务）</div>';
  }
  for (const t of projTodos) {
    const active = currentTask === t.id;
    html += `<div class="menu-item ${active ? 'active' : ''}" data-todo="${escHtml(t.id)}">${active ? icon('check') : '<span class="menu-check-pad"></span>'}${escHtml(t.title)}</div>`;
  }
  html += `<div class="menu-item detach ${currentTask === null ? 'active' : ''}" data-todo="__null__">${currentTask === null ? icon('check') : icon('ban')} 无任务</div>`;
  menu.innerHTML = html;

  menu.querySelectorAll('.menu-item[data-todo]').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      const raw = item.dataset.todo;
      assignTask(session.sessionId, raw === '__null__' ? null : raw, projectName);
      closeMenu();
    });
  });

  document.body.appendChild(menu);
  positionFloatingPanel(menu, anchor, { align: 'end' });
  activeMenu = menu;
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
}

function openProjectEditMenu(anchor, proj) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';
  menu.innerHTML = `
    <div class="menu-section">项目</div>
    <div class="menu-item" data-act="rename">${icon('pencil')} 重命名</div>
    <div class="menu-item" data-act="archive">${proj.archived ? icon('archive-restore') + ' 取消归档' : icon('archive') + ' 归档项目'}</div>
    <div class="menu-item detach" data-act="delete">${icon('trash-2')} 删除项目</div>
  `;
  menu.querySelector('[data-act="rename"]').addEventListener('click', e => {
    e.stopPropagation();
    closeMenu();
    renameProjectRemote(proj);
  });
  menu.querySelector('[data-act="archive"]').addEventListener('click', e => {
    e.stopPropagation();
    closeMenu();
    archiveProject(proj.id, !proj.archived);
  });
  menu.querySelector('[data-act="delete"]').addEventListener('click', e => {
    e.stopPropagation();
    closeMenu();
    deleteProjectRemote(proj);
  });
  document.body.appendChild(menu);
  positionFloatingPanel(menu, anchor, { align: 'end' });
  activeMenu = menu;
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
}

// ── Task edit menu (改名 / 优先级 / 删除) ──────────────────────────────────────

let TODO_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];   // refreshed from /api/settings (loadTaskFieldConfig)

/** Re-render whichever view currently shows tasks, preserving expand state. Mirrors assignTask. */
function rerenderTodosView(projectName) {
  const wsVisible = document.getElementById('workspace-view').style.display !== 'none';
  if (wsVisible && projectName) renderWorkspace(projectName);
  else renderCurrentView();
}

function openTodoEditMenu(anchor, t, projectName) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';

  let html = '<div class="menu-section">状态</div>';
  for (const s of STATUS_ORDER) {
    html += `<div class="menu-item ${t.status === s ? 'active' : ''}" data-status="${escHtml(s)}">`
          + `<span class="menu-status-dot" style="background:${statusColor(s)}"></span>${escHtml(s)}</div>`;
  }
  html += '<div class="menu-section">优先级</div><div class="menu-prio-row">';
  for (const p of TODO_PRIORITIES) {
    html += `<span class="menu-prio priority-${p.toLowerCase()} ${t.priority === p ? 'active' : ''}" data-prio="${p}">${p}</span>`;
  }
  html += '</div><div class="menu-section">截止日期</div>';
  html += `<div class="menu-item ${t.ddl === todayStr() ? 'active' : ''}" data-act="ddl-today">${icon('hourglass')} 今日处理</div>`;
  html += `<label class="menu-item ddl-later" data-act="ddl-later">${icon('clock')} later…`
        + `<input type="date" class="ddl-date-input" value="${escHtml(t.ddl || offsetDayStr(1))}"></label>`;
  if (t.ddl) html += `<div class="menu-item detach" data-act="ddl-clear">${icon('x')} 清除日期</div>`;
  html += '<div class="menu-section">操作</div>';
  html += `<div class="menu-item" data-act="rename">${icon('pencil')} 改名</div>`;
  html += `<div class="menu-item detach" data-act="delete">${icon('trash-2')} 删除任务</div>`;
  menu.innerHTML = html;

  menu.querySelector('[data-act="ddl-today"]').addEventListener('click', e => {
    e.stopPropagation();
    setTodoDdl(t, todayStr(), projectName);
    closeMenu();
  });
  const dateInput = menu.querySelector('.ddl-date-input');
  dateInput.addEventListener('click', e => e.stopPropagation());   // don't bubble to the menu's outside-click closer
  dateInput.addEventListener('change', e => {
    e.stopPropagation();
    if (e.target.value) setTodoDdl(t, e.target.value, projectName);
    closeMenu();
  });
  const clearEl = menu.querySelector('[data-act="ddl-clear"]');
  if (clearEl) clearEl.addEventListener('click', e => {
    e.stopPropagation();
    setTodoDdl(t, null, projectName);
    closeMenu();
  });

  menu.querySelectorAll('.menu-item[data-status]').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    setTodoStatus(t, el.dataset.status, projectName);
    closeMenu();
  }));
  menu.querySelectorAll('.menu-prio').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    setTodoPriority(t, el.dataset.prio, projectName);
    closeMenu();
  }));
  menu.querySelector('[data-act="rename"]').addEventListener('click', e => {
    e.stopPropagation();
    closeMenu();
    startTodoTitleEdit(t, projectName);
  });
  menu.querySelector('[data-act="delete"]').addEventListener('click', e => {
    e.stopPropagation();
    closeMenu();
    if (confirm(`确定删除任务「${t.title}」？此操作不可撤销。`)) deleteTodoRemote(t, projectName);
  });

  document.body.appendChild(menu);
  positionFloatingPanel(menu, anchor, { align: 'end' });
  activeMenu = menu;
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
}

async function patchTodo(id, body) {
  const res = await fetch('/api/todos/' + encodeURIComponent(id), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || ('HTTP ' + res.status));
}

async function setTodoPriority(t, priority, projectName) {
  if (t.priority === priority) return;
  const prev = t.priority;
  t.priority = priority;                       // optimistic
  rerenderTodosView(projectName);
  try { await patchTodo(t.id, { priority }); }
  catch (e) { t.priority = prev; rerenderTodosView(projectName); alert('优先级修改失败：' + e.message); }
}

async function setTodoStatus(t, status, projectName) {
  if (t.status === status) return;
  const prev = t.status;
  t.status = status;                           // optimistic
  // Surface the moved card in its new column so the change is visible after re-render.
  activeTodoStatus = status;
  rerenderTodosView(projectName);
  try { await patchTodo(t.id, { status }); }
  catch (e) { t.status = prev; rerenderTodosView(projectName); alert('状态修改失败：' + e.message); }
}

async function setTodoDdl(t, ddl, projectName) {
  const next = ddl || null;
  if ((t.ddl ?? null) === next) return;
  const prev = t.ddl ?? null;
  t.ddl = next;                                // optimistic
  rerenderTodosView(projectName);
  try { await patchTodo(t.id, { ddl: next }); }
  catch (e) { t.ddl = prev; rerenderTodosView(projectName); alert('截止日期修改失败：' + e.message); }
}

async function renameTodo(t, title, projectName) {
  const prev = t.title;
  t.title = title;                             // optimistic
  rerenderTodosView(projectName);
  try { await patchTodo(t.id, { title }); }
  catch (e) { t.title = prev; rerenderTodosView(projectName); alert('改名失败：' + e.message); }
}

async function deleteTodoRemote(t, projectName) {
  const idx = allTodos.indexOf(t);
  if (idx >= 0) allTodos.splice(idx, 1);       // optimistic
  rerenderTodosView(projectName);
  try {
    const res = await fetch('/api/todos/' + encodeURIComponent(t.id), { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || ('HTTP ' + res.status));
  } catch (e) {
    if (idx >= 0) allTodos.splice(idx, 0, t);  // rollback
    rerenderTodosView(projectName);
    alert('删除失败：' + e.message);
  }
}

// ── Selection ──────────────────────────────────────────────────────────────

function selectSession(id) {
  selectedId = id;
  // Update selected highlight (opening also marks it seen → refreshUnreadUI clears its dot).
  document.querySelectorAll('.session-row').forEach(row => {
    row.classList.toggle('selected', row.dataset.id === id);
  });

  openTerminalForSession(id);
  setHash('#/sessions/' + encodeURIComponent(id));
}

// ── Sidebar renderer ───────────────────────────────────────────────────────

function renderSidebar() {
  const query = document.getElementById('search').value.trim().toLowerCase();
  const list = document.getElementById('session-list');
  renderingSidebar = true;

  try {
    let filtered = allSessions;
    if (query) {
      filtered = allSessions.filter(s =>
        (s.title || '').toLowerCase().includes(query) ||
        (s.cwd || '').toLowerCase().includes(query) ||
        s.cli.toLowerCase().includes(query)
      );
    }

    // In-flight launches render as "创建中…" placeholder rows at the top of their target group.
    // Always shown (a brand-new launch shouldn't vanish behind an active search filter).
    filtered = pendingPseudoSessions().concat(filtered);

    // Update count
    document.getElementById('session-count').textContent = filtered.length + (query ? ' / ' + allSessions.length : '');

    list.innerHTML = '';

    // ── Pinned section ──
    const pinned = filtered.filter(s => s.pinned);
    if (pinned.length > 0) {
      list.appendChild(buildSection('pinned', 'Pinned', pinned, collapsedSections.has('pinned'), 'pinned-section'));
    }

    // ── Projects section ──
    // Group matching sessions by project…
    const projMap = new Map();
    for (const s of filtered) {
      if (s.projectId !== null) {
        if (!projMap.has(s.projectId)) projMap.set(s.projectId, []);
        projMap.get(s.projectId).push(s);
      }
    }
    // …then fold in every non-archived project that has NO sessions, so the Projects栏目
    // always lists all existing projects (each still offers ✎ new-session). When searching,
    // suppress the empty ones so the section stays scoped to matches.
    const projOrder = [...projMap.keys()];   // projects-with-sessions keep their session-encounter order
    if (!query) {
      const empties = projects
        .filter(p => !p.archived && !projMap.has(p.id))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      for (const p of empties) { projMap.set(p.id, []); projOrder.push(p.id); }
    }

    // Always render the Projects header when not searching so the 新建项目 affordance is reachable
    // even with zero projects — mirrors how 无归属 always exposes 导入目录.
    if (projMap.size > 0 || !query) {
      const projWrap = document.createElement('div');
      projWrap.className = 'projects-group';

      const projCollapsed = collapsedSections.has('projects-top');
      const hdr = document.createElement('div');
      hdr.className = 'section-header' + (projCollapsed ? ' collapsed' : '');
      hdr.dataset.sectionKey = 'projects-top';
      hdr.innerHTML = `<span class="section-chevron">${icon('chevron-down')}</span><span class="section-title" style="color:var(--purple)">${icon('folder')} Projects</span><button class="proj-create-btn" title="新建项目">${COMPOSE_NEWPROJ_SVG}</button>${unreadHeaderDot([...projMap.values()].flat())}<span class="section-count">${[...projMap.values()].reduce((a,b) => a + b.length, 0)}</span>`;
      projWrap.appendChild(hdr);
      hdr.querySelector('.proj-create-btn').addEventListener('click', e => {
        e.stopPropagation();
        openCreateProjectDialog();
      });

      const body = document.createElement('div');
      body.className = 'section-body' + (projCollapsed ? ' collapsed' : '');

      // toggle projects group (state persisted across re-renders)
      wireSectionToggle(hdr, body, 'projects-top');

      if (projOrder.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'import-dir-hint';
        hint.innerHTML = `${icon('folder-plus')} 还没有项目 · <button class="import-dir-link">新建项目</button>`;
        hint.querySelector('.import-dir-link').addEventListener('click', openCreateProjectDialog);
        body.appendChild(hint);
      }

      for (const projId of projOrder) {
        const sessions = projMap.get(projId);
        const sub = buildSection('proj:' + projId, projectLabel(projId), sessions, collapsedSections.has('proj:' + projId), 'project-section');
        makeSessionDropTarget(sub, projId);   // drop a session here → assign to this project
        addSectionLaunchBtn(sub, { projectName: projId, todoKey: null });   // ✎ new session for this project
        body.appendChild(sub);
      }
      projWrap.appendChild(body);
      list.appendChild(projWrap);
    }

    // ── 无归属 section: group by cwd ──
    // Always render the header (when not searching) so the 导入目录 affordance is reachable even when
    // empty — that's how the session list is seeded under the directory-import model.
    const ungrouped = filtered.filter(s => s.projectId === null);
    if (ungrouped.length > 0 || !query) {
      const cwdMap = new Map();
      for (const s of ungrouped) {
        const key = s.cwd || '__no_cwd__';
        if (!cwdMap.has(key)) cwdMap.set(key, []);
        cwdMap.get(key).push(s);
      }

      // Sort cwd groups by most recent session in each group
      const sortedCwds = [...cwdMap.entries()].sort((a, b) => {
        const aMax = Math.max(...a[1].map(s => s.updatedAt));
        const bMax = Math.max(...b[1].map(s => s.updatedAt));
        return bMax - aMax;
      });

      const ugCollapsed = collapsedSections.has('ungrouped-top');
      const ungroupedWrap = document.createElement('div');
      const ugHdr = document.createElement('div');
      ugHdr.className = 'section-header' + (ugCollapsed ? ' collapsed' : '');
      ugHdr.dataset.sectionKey = 'ungrouped-top';
      ugHdr.innerHTML = `<span class="section-chevron">${icon('chevron-down')}</span><span class="section-title">${icon('ban')} 无归属</span>${unreadHeaderDot(ungrouped)}<span class="section-count">${ungrouped.length}</span>`;
      // 导入目录 button (like 新建项目's cwd) — adds a session-import root, then re-scans.
      const importBtn = document.createElement('button');
      importBtn.className = 'proj-launch-btn';
      importBtn.title = '导入目录（扫描该目录下的会话）';
      importBtn.innerHTML = icon('folder-input');
      importBtn.addEventListener('click', e => { e.stopPropagation(); importSessionDir(); });
      ugHdr.insertBefore(importBtn, ugHdr.querySelector('.section-count'));
      ungroupedWrap.appendChild(ugHdr);
      makeSessionDropTarget(ungroupedWrap, null);   // drop here → detach (move to 无归属)

      const ugBody = document.createElement('div');
      ugBody.className = 'section-body' + (ugCollapsed ? ' collapsed' : '');
      wireSectionToggle(ugHdr, ugBody, 'ungrouped-top');

      // Show first 5 cwd groups expanded, rest collapsed
      const INITIAL_EXPANDED = 5;

      if (ungrouped.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'import-dir-hint';
        hint.innerHTML = `${icon('folder-input')} 还没有导入会话目录 · <button class="import-dir-link">导入目录</button>`;
        hint.querySelector('.import-dir-link').addEventListener('click', importSessionDir);
        ugBody.appendChild(hint);
      }

      sortedCwds.forEach(([cwd, sessions], idx) => {
        const groupKey = 'cwd:' + cwd;
        // Apply the "first N expanded, rest collapsed" default exactly once per group;
        // after that the user's own toggles (in collapsedSections) are authoritative.
        if (!seenCwdGroups.has(groupKey)) {
          seenCwdGroups.add(groupKey);
          if (idx >= INITIAL_EXPANDED) collapsedSections.add(groupKey);
        }
        const collapsed = collapsedSections.has(groupKey);
        const label = cwd === '__no_cwd__' ? '(no cwd)' : shortCwd(cwd);
        const section = buildSection(groupKey, label, sessions, collapsed, '');
        if (cwd !== '__no_cwd__') addSectionLaunchBtn(section, { projectName: null, todoKey: null }, cwd);  // ✎ new session in this cwd
        ugBody.appendChild(section);
      });

      ungroupedWrap.appendChild(ugBody);
      list.appendChild(ungroupedWrap);
    }

    // When searching with no match, show a plain message. When NOT searching and empty, the 无归属
    // section already renders the 导入目录 hint, so don't add a redundant "No sessions" line.
    if (filtered.length === 0 && query) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:20px;text-align:center;color:var(--text-dim);font-size:12px;';
      empty.textContent = 'No sessions match "' + query + '"';
      list.appendChild(empty);
    }
  } finally {
    renderingSidebar = false;
  }
}

function buildSection(key, title, sessions, collapsed, extraClass) {
  const wrap = document.createElement('div');
  wrap.className = 'section ' + extraClass;

  const hdr = document.createElement('div');
  hdr.className = 'section-header' + (collapsed ? ' collapsed' : '');
  hdr.dataset.sectionKey = key;
  hdr.innerHTML = `<span class="section-chevron">${icon('chevron-down')}</span><span class="section-title">${key === 'pinned' ? icon('pin') + ' ' : ''}${escHtml(title)}</span>${unreadHeaderDot(sessions)}<span class="section-count">${sessions.length}</span>`;
  wrap.appendChild(hdr);

  const body = document.createElement('div');
  body.className = 'section-body' + (collapsed ? ' collapsed' : '');

  // Tuck overflow rows behind "Show more" (keep 3-6 rows on screen by recency/activity).
  // Pinned rows are exempt — a pin is an explicit "always show me".
  const split = (key !== 'pinned' && typeof window.splitGroupRows === 'function')
    ? window.splitGroupRows(sessions, Math.floor(Date.now() / 1000))
    : { visible: sessions, stale: [] };

  for (const s of split.visible) {
    body.appendChild(buildRow(s));
  }

  if (split.stale.length > 0) {
    const expanded = expandedStale.has(key);

    const staleWrap = document.createElement('div');
    staleWrap.className = 'stale-rows' + (expanded ? '' : ' collapsed');
    for (const s of split.stale) staleWrap.appendChild(buildRow(s));
    body.appendChild(staleWrap);

    const more = document.createElement('div');
    more.className = 'show-more';
    more.textContent = expanded ? 'Show less' : `Show more (${split.stale.length})`;
    more.addEventListener('click', e => {
      e.stopPropagation();
      const nowExpanded = !expandedStale.has(key);
      if (nowExpanded) expandedStale.add(key); else expandedStale.delete(key);
      staleWrap.classList.toggle('collapsed', !nowExpanded);
      more.textContent = nowExpanded ? 'Show less' : `Show more (${split.stale.length})`;
    });
    body.appendChild(more);
  }

  wireSectionToggle(hdr, body, key);

  wrap.appendChild(body);
  return wrap;
}

/** Wire a section header so clicking it toggles collapse AND persists the new state
 * (keyed by `key`) in collapsedSections, so a re-render restores it. */
function wireSectionToggle(hdr, body, key) {
  hdr.addEventListener('click', () => {
    const willCollapse = !hdr.classList.contains('collapsed');
    if (willCollapse) collapsedSections.add(key);
    else collapsedSections.delete(key);
    toggleSection(hdr, body);
  });
}

function toggleSection(hdr, body) {
  const isCollapsed = hdr.classList.contains('collapsed');
  hdr.classList.toggle('collapsed', !isCollapsed);
  body.classList.toggle('collapsed', !isCollapsed);
}

/** Expand or collapse every section/sub-section in the sidebar tree. */
function setAllSidebarSections(collapse) {
  document.querySelectorAll('#session-list .section-header').forEach(hdr => {
    const body = hdr.nextElementSibling;
    if (!body || !body.classList.contains('section-body')) return;
    hdr.classList.toggle('collapsed', collapse);
    body.classList.toggle('collapsed', collapse);
    // Persist so the next re-render restores this bulk state.
    const key = hdr.dataset.sectionKey;
    if (key) { if (collapse) collapsedSections.add(key); else collapsedSections.delete(key); }
  });
}

let sidebarCollapsed = false;
/** One button, two states: expand-all ⇄ collapse-all. ▾ = expanded (click to collapse). */
function toggleAllSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  setAllSidebarSections(sidebarCollapsed);
  const btn = document.getElementById('sidebar-toggle-all');
  if (btn) {
    btn.innerHTML = icon(sidebarCollapsed ? 'chevron-right' : 'chevron-down');
    btn.title = sidebarCollapsed ? '展开全部' : '收起全部';
  }
}

// ── Refresh ────────────────────────────────────────────────────────────────

// Sync local sessions into Berth: re-scan the imported directories (NOT every CLI session).
async function refreshSessions() {
  const btn = document.getElementById('btn-sync-sessions');
  if (btn) btn.classList.add('spinning');
  try {
    await fetch('/api/refresh', { method: 'POST' });
    await loadAll();
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

// Import a directory into the 无归属 bucket (like 新建项目's cwd): pick a folder, register it as a
// session-import root, then re-scan so its sessions surface. Returns true if a directory was added.
async function importSessionDir() {
  const path = await pickFolder();
  if (!path) return false;
  try {
    const res = await fetch('/api/session-dirs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: path }),
    });
    if (!res.ok) { alert('导入目录失败'); return false; }
    await loadAll();
    return true;
  } catch (e) { console.warn('[berth] importSessionDir failed', e); alert('导入目录失败'); return false; }
}

// ── Settings: data sources + docs root ──────────────────────────────────────

async function renderSettings() {
  const root = document.getElementById('settings-content');
  if (!root) return;
  root.innerHTML = '<div class="settings-loading">加载中…</div>';
  let sources = [], docsRoot = '', statuses = STATUS_ORDER, priorities = TODO_PRIORITIES, caps = {};
  let agentsCfg = { list: AGENTS, berthAgentCli: BERTH_AGENT.cli, berthAgentModel: BERTH_AGENT.model, headlessClis: HEADLESS_CLIS };
  try {
    const [sRes, cfgRes, capRes] = await Promise.all([fetch('/api/data-sources'), fetch('/api/settings'), fetch('/api/capabilities')]);
    sources = (await sRes.json()).sources || [];
    const cfg = await cfgRes.json();
    docsRoot = cfg.docsRoot || '';
    if (Array.isArray(cfg.statuses) && cfg.statuses.length) statuses = cfg.statuses;
    if (Array.isArray(cfg.priorities) && cfg.priorities.length) priorities = cfg.priorities;
    if (cfg.agents) { agentsCfg = cfg.agents; applyAgentConfig(cfg.agents); }
    caps = (await capRes.json().catch(() => ({}))).adapters || {};
  } catch (e) {
    root.innerHTML = '<div class="settings-error">加载设置失败：' + escHtml(String(e)) + '</div>';
    return;
  }
  // Integrations whose host tooling isn't installed on this machine — surfaced so they can be skipped.
  const unavailable = Object.entries(caps).filter(([, c]) => c && c.available === false);

  // Friendly type names; the auto-derived config stays opaque (stashed on data-config, never shown).
  const kindLabel = (k) => ({ 'feishu-bitable': '飞书多维表格', 'meego': 'Meego' }[k] || k);
  const cardFor = (s) => `
    <div class="settings-card" data-src="${escHtml(s.id)}" data-kind="${escHtml(s.kind)}" data-config="${escHtml(JSON.stringify(s.config || {}))}" data-label="${escHtml(s.label || s.id)}">
      <div class="settings-card-head">
        <strong>${escHtml(s.label || s.id)}</strong>
        <span class="badge">${escHtml(kindLabel(s.kind))}</span>
        <span class="settings-spacer"></span>
        <label class="settings-inline">启用 <input type="checkbox" data-field="enabled" ${s.enabled ? 'checked' : ''}></label>
        <button class="btn btn-sm settings-del" title="删除数据源">${icon('trash-2')}</button>
      </div>
      <div class="settings-row">
        <label>拉取
          <select data-field="pullMode">
            <option value="manual" ${s.pullMode === 'manual' ? 'selected' : ''}>手动</option>
            <option value="auto" ${s.pullMode === 'auto' ? 'selected' : ''}>自动(刷新时)</option>
          </select>
        </label>
        <label>推送
          <select data-field="pushMode">
            <option value="manual" ${s.pushMode === 'manual' ? 'selected' : ''}>手动</option>
            <option value="auto" ${s.pushMode === 'auto' ? 'selected' : ''}>自动(编辑时)</option>
          </select>
        </label>
        <span class="settings-spacer"></span>
        <button class="btn btn-sm settings-save">保存</button>
      </div>
    </div>`;

  root.innerHTML = `
    <div class="settings-section">
      <h3>文档目录 (docsRoot)</h3>
      <p class="settings-hint">Berth 持有的 Markdown 详情/进展文档所在目录。可指向你的文档根目录，或留默认 <code>~/.berth/docs</code>。</p>
      <div class="settings-row">
        <input id="settings-docsroot" class="input" type="text" value="${escHtml(docsRoot)}" placeholder="/abs/path/to/docs">
        <button id="settings-docsroot-save" class="btn btn-sm">保存</button>
      </div>
    </div>
    <div class="settings-section">
      <h3>任务字段</h3>
      <p class="settings-hint">任务的状态与优先级取值（每行一个，按顺序排列；第一项为新建任务的默认值）。状态顺序也决定看板列的顺序。</p>
      <div class="settings-row settings-fields-row">
        <label class="settings-field-col">状态
          <textarea id="settings-statuses" class="settings-config" spellcheck="false" rows="7">${escHtml(statuses.join('\n'))}</textarea>
        </label>
        <label class="settings-field-col">优先级
          <textarea id="settings-priorities" class="settings-config" spellcheck="false" rows="7">${escHtml(priorities.join('\n'))}</textarea>
        </label>
      </div>
      <div class="settings-card-actions"><button id="settings-fields-save" class="btn btn-sm">保存</button></div>
    </div>
    <div class="settings-section">
      <h3>智能体 (Agents)</h3>
      <p class="settings-hint">启动会话时可选的 agent，以及每个 agent 的默认模型（仅 claude / codex 支持指定模型；coco 无该参数）。停用的 agent 不会出现在起会话的选择列表里。</p>
      <div id="settings-agents">
        ${agentsCfg.list.map(a => `
          <div class="settings-row settings-agent-row" data-cli="${escHtml(a.cli)}">
            <label class="settings-inline"><input type="checkbox" data-field="enabled" ${a.enabled ? 'checked' : ''}> <strong>${escHtml(a.cli)}</strong></label>
            <span class="settings-spacer"></span>
            <label class="settings-inline">默认模型
              <input class="input" type="text" data-field="model" spellcheck="false"
                value="${escHtml(a.model || '')}"
                placeholder="${MODEL_FLAG_CLIS.includes(a.cli) ? '（留空＝CLI 默认）' : '不支持'}"
                ${MODEL_FLAG_CLIS.includes(a.cli) ? '' : 'disabled'}>
            </label>
          </div>`).join('')}
      </div>
      <h3 class="settings-subhead">Berth 管理 agent</h3>
      <p class="settings-hint">Berth 内部用于自动生成会话标题、任务归类的无头 agent。当前仅支持可无头运行的 CLI（${escHtml(agentsCfg.headlessClis.join(' / '))}）。</p>
      <div class="settings-row">
        <label class="settings-inline">CLI
          <select id="settings-berth-cli">
            ${agentsCfg.headlessClis
              .filter(c => agentsCfg.list.find(a => a.cli === c && a.enabled))
              .map(c => `<option value="${escHtml(c)}" ${c === agentsCfg.berthAgentCli ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
          </select>
        </label>
        <label class="settings-inline">模型
          <input id="settings-berth-model" class="input" type="text" spellcheck="false" value="${escHtml(agentsCfg.berthAgentModel || '')}" placeholder="留空＝该 CLI 默认模型">
        </label>
      </div>
      <div class="settings-card-actions"><button id="settings-agents-save" class="btn btn-sm">保存</button></div>
    </div>
    <div class="settings-section">
      <div class="settings-section-head"><h3>数据源</h3><button id="settings-add-src" class="btn btn-sm">${icon('plus')} 新增数据源</button></div>
      <p class="settings-hint">外部表格 / Meego 作为<strong>可选</strong>数据源插件。核心功能（会话、任务、文档）不依赖它们。所有连接参数（表 id、字段映射等）都存在这里，不写死在代码里。</p>
      ${unavailable.length ? `<p class="settings-hint">本机不可用的集成：${unavailable.map(([k, c]) => `<code>${escHtml(k)}</code>（${escHtml(c.reason || '所需工具未安装')}）`).join('；')}</p>` : ''}
      <div id="settings-sources">${sources.map(cardFor).join('') || '<div class="settings-empty">尚未配置数据源。</div>'}</div>
    </div>`;

  document.getElementById('settings-docsroot-save').onclick = async (e) => {
    const v = document.getElementById('settings-docsroot').value.trim();
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docsRoot: v }) });
    flashBtnText(e.currentTarget, '已保存');
  };
  document.getElementById('settings-fields-save').onclick = async (e) => {
    const btn = e.currentTarget;
    const parse = (id) => document.getElementById(id).value.split('\n').map(s => s.trim()).filter(Boolean);
    const body = { statuses: parse('settings-statuses'), priorities: parse('settings-priorities') };
    const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { alert('保存失败：' + (j.error || res.statusText)); return; }
    await loadTaskFieldConfig();   // refresh the live vocabularies used across views
    flashBtnText(btn, '已保存');
  };
  // Switching the management-agent CLI clears the model field — a claude model name won't work for
  // codex (and vice-versa); empty means "that CLI's own default".
  const berthCliSel = document.getElementById('settings-berth-cli');
  if (berthCliSel) berthCliSel.onchange = () => { document.getElementById('settings-berth-model').value = ''; };
  document.getElementById('settings-agents-save').onclick = async () => {
    const list = Array.from(document.querySelectorAll('#settings-agents .settings-agent-row')).map(row => {
      const cli = row.dataset.cli;
      const modelEl = row.querySelector('[data-field="model"]');
      const model = MODEL_FLAG_CLIS.includes(cli) && modelEl.value.trim() ? modelEl.value.trim() : null;
      return { cli, enabled: row.querySelector('[data-field="enabled"]').checked, model };
    });
    const berthCliEl = document.getElementById('settings-berth-cli');
    const body = { agents: {
      list,
      berthAgentModel: document.getElementById('settings-berth-model').value.trim(),   // 留空＝该 CLI 默认
      ...(berthCliEl && berthCliEl.value ? { berthAgentCli: berthCliEl.value } : {}),
    } };
    const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { alert('保存失败：' + (j.error || res.statusText)); return; }
    if (j.agents) applyAgentConfig(j.agents);   // refresh the live launch pickers immediately
    renderSettings();   // re-render so the berth-cli dropdown reflects newly enabled/disabled agents (also the visible save confirmation)
  };
  document.getElementById('settings-add-src').onclick = () => openDataSourceModal();

  root.querySelectorAll('.settings-card').forEach(card => {
    const id = card.dataset.src;
    card.querySelector('.settings-save').onclick = (e) => saveDataSourceCard(card, id, e.currentTarget);
    card.querySelector('.settings-del').onclick = async () => {
      if (!confirm('删除数据源 ' + id + '？（本地的任务数据不受影响，仅断开此外部源）')) return;
      await fetch('/api/data-sources/' + encodeURIComponent(id), { method: 'DELETE' });
      renderSettings();
    };
  });
}

async function saveDataSourceCard(card, id, btn) {
  const get = (f) => card.querySelector(`[data-field="${f}"]`);
  // Config was auto-derived on connect and is stashed (hidden) on the card — preserve it verbatim.
  let config = {};
  try { config = JSON.parse(card.dataset.config || '{}'); } catch {}
  const body = {
    id, kind: card.dataset.kind, label: card.dataset.label,
    config, pullMode: get('pullMode').value, pushMode: get('pushMode').value, enabled: get('enabled').checked,
  };
  const res = await fetch('/api/data-sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok) flashBtnText(btn, '已保存'); else alert('保存失败');
}

// Add-data-source modal: pick a type, paste the URL, let Berth parse + introspect + connect. The
// derived config is hidden — the user never hand-edits ids/field maps.
function openDataSourceModal() {
  const modal = document.getElementById('datasource-modal');
  document.getElementById('datasource-url').value = '';
  setDataSourceError('');
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('datasource-url').focus(), 30);
}
function closeDataSourceModal() { document.getElementById('datasource-modal').style.display = 'none'; }
function setDataSourceError(msg) {
  const el = document.getElementById('datasource-error');
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

async function connectDataSource() {
  const kind = document.getElementById('datasource-kind').value;
  const url = document.getElementById('datasource-url').value.trim();
  const btn = document.getElementById('datasource-connect-btn');
  if (!url) { setDataSourceError('请粘贴数据源地址。'); return; }
  setDataSourceError('');
  btn.disabled = true; const prev = btn.textContent; btn.textContent = '连接中…';
  try {
    const res = await fetch('/api/data-sources/connect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, url }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setDataSourceError(j.error || '连接失败'); return; }
    closeDataSourceModal();
    await renderSettings();
  } catch (e) {
    setDataSourceError('连接失败：' + (e && e.message ? e.message : e));
  } finally {
    btn.disabled = false; btn.textContent = prev;
  }
}

// ── Sync + conflict resolution ───────────────────────────────────────────────

function flashSyncLabel(text) {
  const label = document.getElementById('sync-label');
  if (!label) return;
  const prev = label.textContent;
  label.textContent = text;
  setTimeout(() => { label.textContent = prev; }, 1800);
}

// Briefly flash a button's own label (used for Settings saves, whose feedback must show on the
// settings page — the shared sync-label now lives in the project workspace header).
function flashBtnText(btn, text) {
  if (!btn) return;
  const prev = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = prev; }, 1500);
}

function updateConflictBadge(conflicts) {
  const badge = document.getElementById('sync-conflict-badge');
  if (!badge) return;
  const n = (conflicts || []).length;
  badge.style.display = n ? 'inline-flex' : 'none';
  badge.textContent = String(n);
}

async function refreshConflictBadge() {
  try { const r = await fetch('/api/conflicts'); updateConflictBadge((await r.json()).conflicts); } catch (_) {}
}

// Sync local tasks/projects with external data sources. direction: 'pull' (external→Berth),
// 'push' (Berth→external), or null/undefined for both. Buttons live on the project workspace page.
async function doSync(direction) {
  const btn = document.getElementById(direction === 'pull' ? 'btn-pull' : direction === 'push' ? 'btn-push' : 'btn-pull');
  if (btn) btn.classList.add('spinning');
  try {
    const qs = direction === 'pull' || direction === 'push' ? `?direction=${direction}` : '';
    const res = await fetch('/api/sync' + qs, { method: 'POST' });
    const j = await res.json();
    if (!res.ok) { flashSyncLabel('同步失败'); }
    else if (direction === 'pull') { flashSyncLabel(`↓${j.pulled ?? 0}`); }
    else if (direction === 'push') { flashSyncLabel(`↑${j.pushed ?? 0}`); }
    else { flashSyncLabel(`↑${j.pushed ?? 0} ↓${j.pulled ?? 0}`); }
    updateConflictBadge(j.conflicts);
    await loadAll();
    if ((j.conflicts || []).length) openConflictModal(j.conflicts);
  } catch (e) {
    flashSyncLabel('同步失败');
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

const CONFLICT_FIELDS = [['title', '标题'], ['status', '状态'], ['priority', '优先级'], ['project', '项目'], ['progress', '进展'], ['detailDoc', '详情文档']];

function openConflictModal(conflicts) {
  const modal = document.getElementById('conflict-modal');
  renderConflictBody(conflicts);
  modal.style.display = 'flex';
}
function closeConflictModal() { document.getElementById('conflict-modal').style.display = 'none'; }

function renderConflictBody(conflicts) {
  const body = document.getElementById('conflict-modal-body');
  document.getElementById('conflict-count').textContent = (conflicts.length || 0) + ' 个待解决';
  if (!conflicts.length) { body.innerHTML = '<div class="settings-empty">没有冲突 🎉</div>'; return; }
  const rowFor = (c) => {
    const b = c.berth || {}, e = c.external || {};
    const fieldRows = CONFLICT_FIELDS
      .filter(([k]) => JSON.stringify(b[k] ?? null) !== JSON.stringify(e[k] ?? null))
      .map(([k, label]) => `<tr><td class="cf-k">${label}</td><td class="cf-b">${escHtml(String(b[k] ?? '—'))}</td><td class="cf-e">${escHtml(String(e[k] ?? '—'))}</td></tr>`)
      .join('');
    return `<div class="conflict-item" data-cid="${escHtml(c.id)}">
      <div class="conflict-item-head">${escHtml(b.title || e.title || c.entityId)} <span class="badge">${escHtml(c.sourceId)}</span></div>
      <table class="conflict-table"><thead><tr><th></th><th>Berth(本地)</th><th>外部</th></tr></thead><tbody>${fieldRows}</tbody></table>
      <div class="conflict-actions">
        <button class="btn btn-sm conflict-pick" data-side="berth">用 Berth 覆盖外部</button>
        <button class="btn btn-sm conflict-pick" data-side="external">用 外部 覆盖 Berth</button>
      </div>
    </div>`;
  };
  body.innerHTML = conflicts.map(rowFor).join('');
  body.querySelectorAll('.conflict-item').forEach(item => {
    const cid = item.dataset.cid;
    item.querySelectorAll('.conflict-pick').forEach(btn => {
      btn.onclick = () => resolveConflictRow(cid, btn.dataset.side);
    });
  });
}

async function resolveConflictRow(id, side) {
  try {
    const res = await fetch('/api/conflicts/' + encodeURIComponent(id) + '/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side }),
    });
    const j = await res.json();
    updateConflictBadge(j.conflicts);
    renderConflictBody(j.conflicts || []);
    await loadAll();
    if (!(j.conflicts || []).length) closeConflictModal();
  } catch (e) { alert('解决冲突失败：' + e.message); }
}

// ── Init ───────────────────────────────────────────────────────────────────

function init() {
  // Sidebar resize drag handle
  initSidebarResize();
  document.addEventListener('click', handleUnreadToggleClick, true);

  // Nav mode switching
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => setMode(el.dataset.mode));
  });

  // Back button in workspace
  document.getElementById('btn-back-projects').addEventListener('click', () => {
    setMode('projects');
  });

  // Global ⊕ 新建待办 bar in the left nav (always visible, AI classifies the project)
  renderCreateTodoBar(document.getElementById('nav-create-todo'), null);

  // ＋ 新建会话 from the sessions sidebar (taskless, unassigned → lands in 无归属)
  const sidebarNewSess = document.getElementById('sidebar-new-session-btn');
  if (sidebarNewSess) {
    sidebarNewSess.addEventListener('click', e => {
      e.stopPropagation();
      openLaunchPopover(e.currentTarget, { projectName: null, todoKey: null });
    });
  }

  // Single toggle button: expand-all ⇄ collapse-all the sidebar tree
  document.getElementById('sidebar-toggle-all').addEventListener('click', toggleAllSidebar);

  // Project / task search (in the 项目 view)
  document.getElementById('project-search').addEventListener('input', () => renderProjects());
  document.getElementById('projects-new-btn').addEventListener('click', () => openCreateProjectDialog());

  // Search (matches title / cwd path / cli — see renderSidebar)
  document.getElementById('search').addEventListener('input', () => {
    renderSidebar();
  });

  // Sync-sessions button (re-scan imported dirs) — on the session list page
  const syncSessBtn = document.getElementById('btn-sync-sessions');
  if (syncSessBtn) syncSessBtn.addEventListener('click', refreshSessions);

  // Pull / Push buttons (tasks/projects ↔ external data sources) — on the project workspace page
  const pullBtn = document.getElementById('btn-pull');
  if (pullBtn) pullBtn.addEventListener('click', () => doSync('pull'));
  const pushBtn = document.getElementById('btn-push');
  if (pushBtn) pushBtn.addEventListener('click', () => doSync('push'));
  const conflictClose = document.getElementById('conflict-modal-close');
  if (conflictClose) conflictClose.addEventListener('click', closeConflictModal);
  const conflictModal = document.getElementById('conflict-modal');
  if (conflictModal) conflictModal.addEventListener('mousedown', e => { if (e.target.id === 'conflict-modal') closeConflictModal(); });
  refreshConflictBadge();

  // Add-data-source modal
  const dsClose = document.getElementById('datasource-modal-close');
  if (dsClose) dsClose.addEventListener('click', closeDataSourceModal);
  const dsModal = document.getElementById('datasource-modal');
  if (dsModal) dsModal.addEventListener('mousedown', e => { if (e.target.id === 'datasource-modal') closeDataSourceModal(); });
  const dsConnect = document.getElementById('datasource-connect-btn');
  if (dsConnect) dsConnect.addEventListener('click', connectDataSource);
  const dsUrl = document.getElementById('datasource-url');
  if (dsUrl) dsUrl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); connectDataSource(); } });

  // Theme toggle (reflects the pre-paint class set in index.html)
  setTheme(document.documentElement.classList.contains('light') ? 'light' : 'dark');
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);

  // Close menu / launch popover / doc editor on escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMenu(); closeLaunchPopover(); closeDocEditor(); closeDataSourceModal(); }
  });

  // ── Markdown doc editor wiring ──
  let docPreviewTimer = null;
  const docEditor = document.getElementById('doc-editor');
  docEditor.addEventListener('input', () => {
    docState.dirty = true;
    clearTimeout(docPreviewTimer);
    docPreviewTimer = setTimeout(renderDocPreview, 150);
  });
  docEditor.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveDoc(); }
  });
  document.getElementById('doc-save-btn').addEventListener('click', saveDoc);
  document.getElementById('doc-modal-close').addEventListener('click', closeDocEditor);
  document.getElementById('doc-modal').addEventListener('mousedown', e => {
    if (e.target.id === 'doc-modal') closeDocEditor();   // click the backdrop
  });

  // Set up initial state: Now mode, sidebar hidden
  document.getElementById('sidebar').style.display = 'none';
  document.getElementById('sidebar-resize-handle').style.display = 'none';
  document.getElementById('terminal-view').style.display = 'none';
  document.getElementById('now-view').style.display = 'flex';
  document.getElementById('projects-view').style.display = 'none';
  document.getElementById('workspace-view').style.display = 'none';

  // Back/forward + manual URL edits → re-apply the view.
  window.addEventListener('hashchange', applyRoute);

  // Open the always-on live-status channel (spinner / red dot for every session, even backgrounded).
  connectStatusWs();

  // Load the user-configured status/priority vocabularies, then all data, then apply the URL's route
  // (restores view + open session terminal). Once sessions are in hand, try preload/rehydrate.
  loadTaskFieldConfig()
    .then(loadAll)
    .then(() => { applyRoute(); maybePreloadAndRehydrate(); });
}

// ── Live status channel ──────────────────────────────────────────────────────
/** One always-on WebSocket to /status; reconnects with backoff. Drives the in-list spinner/red dot
 *  for every session from server-side PTY activity — independent of which terminals are open. */
function connectStatusWs() {
  let backoff = 500;
  const open = () => {
    let ws;
    try { ws = new WebSocket(`ws://${location.host}/status`); }
    catch { setTimeout(open, backoff); backoff = Math.min(backoff * 2, 10000); return; }
    statusWs = ws;
    ws.onopen = () => { backoff = 500; };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'snap') {
        liveStatus = new Map((m.sessions || []).map(x => [x.sessionId, x.state]));
        firstSnapSeen = true;                  // now we know which sessions have live PTYs
        maybePreloadAndRehydrate();            // preload + cross-reload rehydrate (runs once)
      } else if (m.t === 'act') {
        if (m.state === 'exited') liveStatus.delete(m.sessionId);
        else {
          liveStatus.set(m.sessionId, m.state);
          if (m.state === 'settled') {
            // A turn finished: adopt the server's fresh last-message time so the red dot reflects
            // real content (a repaint-only settle pushes an unchanged time → no dot).
            if (typeof m.updatedAt === 'number') {
              const s = allSessions.find(x => x.sessionId === m.sessionId);
              if (s) s.updatedAt = m.updatedAt;
            }
            if (activeTerminalId === m.sessionId) markSeen(m.sessionId);   // you're watching it finish
          }
        }
      } else if (m.t === 'rekey') {
        if (liveStatus.has(m.from)) { liveStatus.set(m.to, liveStatus.get(m.from)); liveStatus.delete(m.from); }
      } else return;
      scheduleStatusRender();
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
    ws.onclose = () => { statusWs = null; setTimeout(open, backoff); backoff = Math.min(backoff * 2, 10000); };
  };
  open();
}

/** Coalesce bursts of status deltas into a single re-render of the current view (preserves scroll).
 *  Deltas are low-frequency (deduped to state changes, ~2 per turn), so a full render is fine. */
function scheduleStatusRender() {
  if (statusRenderTimer) return;
  statusRenderTimer = setTimeout(() => { statusRenderTimer = null; refreshUnreadUI(); }, 150);
}

document.addEventListener('DOMContentLoaded', init);
