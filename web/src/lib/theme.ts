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
]

export const SCHEMES: Scheme[] = [...LIGHT, ...DARK]
export const LIGHT_SCHEMES = LIGHT
export const DARK_SCHEMES = DARK

const SCHEME_KEY = 'berth-scheme'
const DEFAULT_LIGHT = 'daylight'
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
