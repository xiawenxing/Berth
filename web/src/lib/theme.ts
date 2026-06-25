// Theme system: a mode (light | dark) × a named color scheme, applied by writing
// the design tokens as inline CSS vars on <html>. Persisted in localStorage so the
// choice survives reload (and is applied pre-paint by the inline script in index.html).

export type Mode = 'light' | 'dark'

export interface Scheme {
  id: string
  name: string
  mode: Mode
  vars: Record<string, string>
}

const SHARED = {
  '--color-brand-foreground': '#ffffff',
  '--color-destructive-foreground': '#ffffff',
}

// ── Dark schemes ───────────────────────────────────────────────────────────
const DARK: Scheme[] = [
  {
    id: 'midnight', name: '午夜靛蓝', mode: 'dark',
    vars: {
      '--color-background': '#141b2e', '--color-foreground': '#b3bcd4', '--color-card': '#1f2940', '--color-card-foreground': '#c7cfe3',
      '--color-popover': '#283450', '--color-popover-foreground': '#c7cfe3', '--color-muted': '#2c3852', '--color-muted-foreground': '#8089a3',
      '--color-secondary': '#2c3852', '--color-accent': '#2c3852', '--color-accent-foreground': '#dbe1f0', '--color-border': '#3a4768',
      '--color-input': '#3a4768', '--color-ring': '#56b6ff', '--color-sidebar': '#101526', '--color-sidebar-accent': '#1f2940',
      '--color-canvas': '#0d1220', '--color-brand': '#56b6ff', '--color-success': '#7ed4a6', '--color-warning': '#f0c773',
      '--color-priority': '#e0a060', '--color-purple': '#b88cf0', '--color-destructive': '#f0707f', '--color-text-dim': '#6b7280',
      '--color-brand-foreground': '#0d1220',
    },
  },
  {
    id: 'deepspace', name: '深空 · 高分层', mode: 'dark',
    vars: {
      '--color-background': '#1b1e24', '--color-foreground': '#c2c7d0', '--color-card': '#2a2f3a', '--color-card-foreground': '#d6dae2',
      '--color-popover': '#323844', '--color-popover-foreground': '#d6dae2', '--color-muted': '#363c49', '--color-muted-foreground': '#8b93a3',
      '--color-secondary': '#363c49', '--color-accent': '#363c49', '--color-accent-foreground': '#e2e6ec', '--color-border': '#454d5d',
      '--color-input': '#454d5d', '--color-ring': '#61afef', '--color-sidebar': '#15171c', '--color-sidebar-accent': '#2a2f3a',
      '--color-canvas': '#101216', '--color-brand': '#61afef', '--color-success': '#98c379', '--color-warning': '#e5c07b',
      '--color-priority': '#d19a66', '--color-purple': '#c678dd', '--color-destructive': '#e06c75', '--color-text-dim': '#6b7280',
      '--color-brand-foreground': '#ffffff',
    },
  },
  {
    id: 'graphite', name: '石墨暖灰', mode: 'dark',
    vars: {
      '--color-background': '#1f1e1d', '--color-foreground': '#c8c4bd', '--color-card': '#2c2a28', '--color-card-foreground': '#ddd8d0',
      '--color-popover': '#353230', '--color-popover-foreground': '#ddd8d0', '--color-muted': '#3a3735', '--color-muted-foreground': '#968f86',
      '--color-secondary': '#3a3735', '--color-accent': '#3a3735', '--color-accent-foreground': '#e6e1d8', '--color-border': '#4b4640',
      '--color-input': '#4b4640', '--color-ring': '#e0a458', '--color-sidebar': '#191817', '--color-sidebar-accent': '#2c2a28',
      '--color-canvas': '#141312', '--color-brand': '#e0a458', '--color-success': '#a3c77d', '--color-warning': '#e5c07b',
      '--color-priority': '#d8965a', '--color-purple': '#c193d9', '--color-destructive': '#e08374', '--color-text-dim': '#7a736a',
      '--color-brand-foreground': '#1f1e1d',
    },
  },
  {
    id: 'oled', name: 'OLED 近黑', mode: 'dark',
    vars: {
      '--color-background': '#0a0c10', '--color-foreground': '#c4cad6', '--color-card': '#14181f', '--color-card-foreground': '#d6dbe4',
      '--color-popover': '#1b212b', '--color-popover-foreground': '#d6dbe4', '--color-muted': '#1e242e', '--color-muted-foreground': '#7f8794',
      '--color-secondary': '#1e242e', '--color-accent': '#1e242e', '--color-accent-foreground': '#e1e5ec', '--color-border': '#2a313c',
      '--color-input': '#2a313c', '--color-ring': '#67b3f0', '--color-sidebar': '#060709', '--color-sidebar-accent': '#14181f',
      '--color-canvas': '#000000', '--color-brand': '#67b3f0', '--color-success': '#7ed4a6', '--color-warning': '#f0c773',
      '--color-priority': '#e0a060', '--color-purple': '#b88cf0', '--color-destructive': '#f0707f', '--color-text-dim': '#5f6772',
      '--color-brand-foreground': '#06070a',
    },
  },
  {
    id: 'github-dark', name: 'GitHub 深', mode: 'dark',
    vars: {
      '--color-background': '#0d1117', '--color-foreground': '#c9d1d9', '--color-card': '#161b22', '--color-card-foreground': '#e6edf3',
      '--color-popover': '#1c2128', '--color-popover-foreground': '#e6edf3', '--color-muted': '#21262d', '--color-muted-foreground': '#8b949e',
      '--color-secondary': '#21262d', '--color-accent': '#21262d', '--color-accent-foreground': '#e6edf3', '--color-border': '#30363d',
      '--color-input': '#30363d', '--color-ring': '#58a6ff', '--color-sidebar': '#010409', '--color-sidebar-accent': '#161b22',
      '--color-canvas': '#010409', '--color-brand': '#58a6ff', '--color-success': '#3fb950', '--color-warning': '#d29922',
      '--color-priority': '#db6d28', '--color-purple': '#bc8cff', '--color-destructive': '#f85149', '--color-text-dim': '#6e7681',
      '--color-brand-foreground': '#0d1117',
    },
  },
  {
    id: 'vscode-dark', name: 'VSCode 暗', mode: 'dark',
    vars: {
      '--color-background': '#1e1e1e', '--color-foreground': '#cccccc', '--color-card': '#252526', '--color-card-foreground': '#d4d4d4',
      '--color-popover': '#2d2d30', '--color-popover-foreground': '#d4d4d4', '--color-muted': '#2d2d2d', '--color-muted-foreground': '#9d9d9d',
      '--color-secondary': '#2d2d2d', '--color-accent': '#37373d', '--color-accent-foreground': '#e0e0e0', '--color-border': '#3c3c3c',
      '--color-input': '#3c3c3c', '--color-ring': '#569cd6', '--color-sidebar': '#181818', '--color-sidebar-accent': '#252526',
      '--color-canvas': '#141414', '--color-brand': '#569cd6', '--color-success': '#89d185', '--color-warning': '#cca700',
      '--color-priority': '#d18616', '--color-purple': '#c586c0', '--color-destructive': '#f14c4c', '--color-text-dim': '#6e6e6e',
      '--color-brand-foreground': '#ffffff',
    },
  },
  {
    id: 'vangogh', name: '梵高星空', mode: 'dark',
    vars: {
      '--color-background': '#0f1a33', '--color-foreground': '#cdd6e8', '--color-card': '#16243f', '--color-card-foreground': '#dde4f0',
      '--color-popover': '#1d2d4d', '--color-popover-foreground': '#dde4f0', '--color-muted': '#21314f', '--color-muted-foreground': '#8491ab',
      '--color-secondary': '#21314f', '--color-accent': '#283a5c', '--color-accent-foreground': '#e4ebf5', '--color-border': '#324569',
      '--color-input': '#324569', '--color-ring': '#f0c04a', '--color-sidebar': '#0b1428', '--color-sidebar-accent': '#16243f',
      '--color-canvas': '#0a1124', '--color-brand': '#f0c04a', '--color-success': '#7bb88f', '--color-warning': '#e6a23c',
      '--color-priority': '#e09a4a', '--color-purple': '#9b8cf0', '--color-destructive': '#e8736f', '--color-text-dim': '#5f6c85',
      '--color-brand-foreground': '#1a1530',
    },
  },
  {
    id: 'codex', name: '墨绿 · Codex', mode: 'dark',
    vars: {
      '--color-background': '#131715', '--color-foreground': '#c9cfcb', '--color-card': '#1b201d', '--color-card-foreground': '#dbe0dc',
      '--color-popover': '#232825', '--color-popover-foreground': '#dbe0dc', '--color-muted': '#232825', '--color-muted-foreground': '#899389',
      '--color-secondary': '#232825', '--color-accent': '#2a302c', '--color-accent-foreground': '#e3e8e4', '--color-border': '#333b36',
      '--color-input': '#333b36', '--color-ring': '#19c37d', '--color-sidebar': '#0e1210', '--color-sidebar-accent': '#1b201d',
      '--color-canvas': '#0b0f0d', '--color-brand': '#19c37d', '--color-success': '#5fb87a', '--color-warning': '#e0b056',
      '--color-priority': '#d89a55', '--color-purple': '#a98cf0', '--color-destructive': '#ec6a5e', '--color-text-dim': '#6a736d',
      '--color-brand-foreground': '#07120c',
    },
  },
]

// ── Light schemes ──────────────────────────────────────────────────────────
const LIGHT: Scheme[] = [
  {
    id: 'daylight', name: '云白', mode: 'light',
    vars: {
      '--color-background': '#f6f8fb', '--color-foreground': '#1f2733', '--color-card': '#ffffff', '--color-card-foreground': '#1f2733',
      '--color-popover': '#ffffff', '--color-popover-foreground': '#1f2733', '--color-muted': '#eef1f6', '--color-muted-foreground': '#6b7689',
      '--color-secondary': '#eef1f6', '--color-accent': '#e9edf3', '--color-accent-foreground': '#1f2733', '--color-border': '#dde3ec',
      '--color-input': '#dde3ec', '--color-ring': '#2f6fed', '--color-sidebar': '#eef1f6', '--color-sidebar-accent': '#e3e8f1',
      '--color-canvas': '#eef1f6', '--color-brand': '#2f6fed', '--color-success': '#2a9d63', '--color-warning': '#b9831b',
      '--color-priority': '#c2730a', '--color-purple': '#7a37b8', '--color-destructive': '#dc4338', '--color-text-dim': '#97a1b0',
      '--color-brand-foreground': '#ffffff',
    },
  },
  {
    id: 'warmpaper', name: '暖纸', mode: 'light',
    vars: {
      '--color-background': '#faf8f4', '--color-foreground': '#3a3530', '--color-card': '#fffdf9', '--color-card-foreground': '#3a3530',
      '--color-popover': '#fffdf9', '--color-popover-foreground': '#3a3530', '--color-muted': '#f0ece4', '--color-muted-foreground': '#8a8275',
      '--color-secondary': '#f0ece4', '--color-accent': '#eae5db', '--color-accent-foreground': '#3a3530', '--color-border': '#e2dccf',
      '--color-input': '#e2dccf', '--color-ring': '#c2730a', '--color-sidebar': '#f3efe8', '--color-sidebar-accent': '#eae5db',
      '--color-canvas': '#f3efe8', '--color-brand': '#b9690c', '--color-success': '#5a9216', '--color-warning': '#b9831b',
      '--color-priority': '#c2730a', '--color-purple': '#843a96', '--color-destructive': '#cf4032', '--color-text-dim': '#a89f90',
      '--color-brand-foreground': '#ffffff',
    },
  },
  {
    id: 'mist', name: '薄雾青', mode: 'light',
    vars: {
      '--color-background': '#f3f7f7', '--color-foreground': '#23383a', '--color-card': '#ffffff', '--color-card-foreground': '#23383a',
      '--color-popover': '#ffffff', '--color-popover-foreground': '#23383a', '--color-muted': '#e6eeee', '--color-muted-foreground': '#5f7577',
      '--color-secondary': '#e6eeee', '--color-accent': '#dde9e9', '--color-accent-foreground': '#23383a', '--color-border': '#d2e0e0',
      '--color-input': '#d2e0e0', '--color-ring': '#0f8f9b', '--color-sidebar': '#e8f0f0', '--color-sidebar-accent': '#dbe9e9',
      '--color-canvas': '#e8f0f0', '--color-brand': '#0f8f9b', '--color-success': '#2a9d63', '--color-warning': '#b9831b',
      '--color-priority': '#c2730a', '--color-purple': '#7a37b8', '--color-destructive': '#dc4338', '--color-text-dim': '#90a5a6',
      '--color-brand-foreground': '#ffffff',
    },
  },
  {
    id: 'github-light', name: 'GitHub 浅', mode: 'light',
    vars: {
      '--color-background': '#ffffff', '--color-foreground': '#1f2328', '--color-card': '#ffffff', '--color-card-foreground': '#1f2328',
      '--color-popover': '#ffffff', '--color-popover-foreground': '#1f2328', '--color-muted': '#f6f8fa', '--color-muted-foreground': '#59636e',
      '--color-secondary': '#f6f8fa', '--color-accent': '#eaeef2', '--color-accent-foreground': '#1f2328', '--color-border': '#d1d9e0',
      '--color-input': '#d1d9e0', '--color-ring': '#0969da', '--color-sidebar': '#f6f8fa', '--color-sidebar-accent': '#eaeef2',
      '--color-canvas': '#f6f8fa', '--color-brand': '#0969da', '--color-success': '#1a7f37', '--color-warning': '#9a6700',
      '--color-priority': '#bc4c00', '--color-purple': '#8250df', '--color-destructive': '#cf222e', '--color-text-dim': '#818b98',
      '--color-brand-foreground': '#ffffff',
    },
  },
  {
    id: 'claude-clay', name: '暖陶 · Claude', mode: 'light',
    vars: {
      '--color-background': '#f5f1eb', '--color-foreground': '#3d3a34', '--color-card': '#fbf8f3', '--color-card-foreground': '#3d3a34',
      '--color-popover': '#fbf8f3', '--color-popover-foreground': '#3d3a34', '--color-muted': '#ece6dd', '--color-muted-foreground': '#7a7468',
      '--color-secondary': '#ece6dd', '--color-accent': '#e6dfd3', '--color-accent-foreground': '#3d3a34', '--color-border': '#ddd5c8',
      '--color-input': '#ddd5c8', '--color-ring': '#c15f3c', '--color-sidebar': '#efe9e0', '--color-sidebar-accent': '#e6dfd3',
      '--color-canvas': '#efe9e0', '--color-brand': '#c15f3c', '--color-success': '#5a9216', '--color-warning': '#b9831b',
      '--color-priority': '#c2730a', '--color-purple': '#8a5cc4', '--color-destructive': '#cf4032', '--color-text-dim': '#a89f90',
      '--color-brand-foreground': '#ffffff',
    },
  },
  {
    id: 'monet', name: '莫奈睡莲', mode: 'light',
    vars: {
      '--color-background': '#e9efe9', '--color-foreground': '#34403c', '--color-card': '#f5f8f3', '--color-card-foreground': '#34403c',
      '--color-popover': '#f5f8f3', '--color-popover-foreground': '#34403c', '--color-muted': '#dde7df', '--color-muted-foreground': '#61716a',
      '--color-secondary': '#dde7df', '--color-accent': '#d6e3da', '--color-accent-foreground': '#34403c', '--color-border': '#cad9ce',
      '--color-input': '#cad9ce', '--color-ring': '#4f8a8b', '--color-sidebar': '#e1eae1', '--color-sidebar-accent': '#d6e3da',
      '--color-canvas': '#e1eae1', '--color-brand': '#4f8a8b', '--color-success': '#5e9a5a', '--color-warning': '#c79a3e',
      '--color-priority': '#c2730a', '--color-purple': '#8268a8', '--color-destructive': '#cf5a52', '--color-text-dim': '#93a298',
      '--color-brand-foreground': '#ffffff',
    },
  },
  {
    id: 'hokusai', name: '北斋 · 神奈川', mode: 'light',
    vars: {
      '--color-background': '#f0ebe0', '--color-foreground': '#1f2d3d', '--color-card': '#f8f4ea', '--color-card-foreground': '#1f2d3d',
      '--color-popover': '#f8f4ea', '--color-popover-foreground': '#1f2d3d', '--color-muted': '#e6dfce', '--color-muted-foreground': '#6a6253',
      '--color-secondary': '#e6dfce', '--color-accent': '#dcd4c0', '--color-accent-foreground': '#1f2d3d', '--color-border': '#d2c9b3',
      '--color-input': '#d2c9b3', '--color-ring': '#1b4f72', '--color-sidebar': '#ebe5d6', '--color-sidebar-accent': '#dcd4c0',
      '--color-canvas': '#ebe5d6', '--color-brand': '#1b4f72', '--color-success': '#4f7a3a', '--color-warning': '#b07d1a',
      '--color-priority': '#b5651d', '--color-purple': '#5d4a7a', '--color-destructive': '#b23a2e', '--color-text-dim': '#a89e88',
      '--color-brand-foreground': '#ffffff',
    },
  },
]

export const SCHEMES: Scheme[] = [...LIGHT, ...DARK]
export const LIGHT_SCHEMES = LIGHT
export const DARK_SCHEMES = DARK

const SCHEME_KEY = 'berth-scheme'
const DEFAULT_LIGHT = 'mist'
const DEFAULT_DARK = 'midnight'

export function getScheme(): Scheme {
  let id: string | null = null
  try {
    id = localStorage.getItem(SCHEME_KEY)
  } catch {
    /* ignore */
  }
  return SCHEMES.find((s) => s.id === id) ?? SCHEMES.find((s) => s.id === DEFAULT_LIGHT)!
}

/** Apply a scheme: set the html mode class + write its token vars inline (overrides @theme/css). */
export function applyScheme(scheme: Scheme) {
  const html = document.documentElement
  html.classList.toggle('dark', scheme.mode === 'dark')
  html.classList.toggle('light', scheme.mode === 'light')
  // Drives CSS light-dark() (used by the priority color ramp) so it tracks the chosen mode.
  html.style.colorScheme = scheme.mode
  for (const [k, v] of Object.entries({ ...SHARED, ...scheme.vars })) html.style.setProperty(k, v)
  try {
    localStorage.setItem(SCHEME_KEY, scheme.id)
  } catch {
    /* ignore */
  }
}

/** Toggle between the last-used light and dark scheme (the rail sun/moon button). */
export function toggleMode(): Scheme {
  const cur = getScheme()
  const next = cur.mode === 'dark' ? LIGHT.find((s) => s.id === DEFAULT_LIGHT)! : DARK.find((s) => s.id === DEFAULT_DARK)!
  applyScheme(next)
  return next
}

/** Apply the saved (or default) scheme on boot. */
export function initTheme() {
  applyScheme(getScheme())
}
