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

// ── Light schemes ──────────────────────────────────────────────────────────
const LIGHT: Scheme[] = [
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

// ── Dark schemes ───────────────────────────────────────────────────────────
const DARK: Scheme[] = [
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
]

export const SCHEMES: Scheme[] = [...LIGHT, ...DARK]
export const LIGHT_SCHEMES = LIGHT
export const DARK_SCHEMES = DARK

const SCHEME_KEY = 'berth-scheme'
// Mirrors the chosen scheme's mode so the pre-paint script in index.html can pick
// the light/dark class without loading the scheme map (avoids a wrong-mode flash).
const MODE_KEY = 'berth-mode'
// Remembers the last scheme picked in each mode so the sun/moon toggle returns to it
// (rather than always snapping back to the mode's default).
const LAST_KEY: Record<Mode, string> = { light: 'berth-scheme-light', dark: 'berth-scheme-dark' }
const DEFAULT_LIGHT = 'mist'
const DEFAULT_DARK = 'deepspace'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function getScheme(): Scheme {
  const id = read(SCHEME_KEY)
  return SCHEMES.find((s) => s.id === id) ?? SCHEMES.find((s) => s.id === DEFAULT_LIGHT)!
}

/** The scheme to show for a mode: the last one picked in that mode, else the mode default. */
function schemeForMode(mode: Mode): Scheme {
  const pool = mode === 'dark' ? DARK : LIGHT
  const last = read(LAST_KEY[mode])
  const fallback = mode === 'dark' ? DEFAULT_DARK : DEFAULT_LIGHT
  return pool.find((s) => s.id === last) ?? pool.find((s) => s.id === fallback)!
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
    localStorage.setItem(MODE_KEY, scheme.mode)
    localStorage.setItem(LAST_KEY[scheme.mode], scheme.id)
  } catch {
    /* ignore */
  }
}

/** Toggle modes via the rail sun/moon button, restoring the last scheme used in the target mode. */
export function toggleMode(): Scheme {
  const next = schemeForMode(getScheme().mode === 'dark' ? 'light' : 'dark')
  applyScheme(next)
  return next
}

/** Apply the saved (or default) scheme on boot. */
export function initTheme() {
  applyScheme(getScheme())
}
