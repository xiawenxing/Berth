// Ordered-priority → color, via the approved 升温·经紫 ramp (warm garnet at the highest priority
// → midnight indigo at the lowest, along a short warm→cool path through violet — no muddy
// yellow-green). It works for ANY number of user-configured priority levels: sample the ramp at
// t = rank/(total-1). The bar uses the seed color; the chip bg/fg are derived at fixed lightness
// targets so the small chip text stays ≥AA at every level. Light/dark is resolved by CSS
// light-dark() (theme.ts sets color-scheme on <html>), so colors auto-switch without re-render.

type Seed = { L: number; C: number; H: number }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const okStr = (L: number, C: number, H: number) =>
  `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${(((H % 360) + 360) % 360).toFixed(1)})`

// Bar seed at ramp position t∈[0,1] (0 = highest priority). Chroma is front-loaded so only the
// top end carries strong warmth; the low end fades to a faint cool slate. Separate L/H tuned per
// theme (a bar must be darker to read on white, lighter to read on the midnight card).
const lightSeed = (t: number): Seed => ({ L: lerp(0.5, 0.67, t), C: 0.026 + (0.132 - 0.026) * Math.pow(1 - t, 1.15), H: 18 - 123 * t })
const darkSeed = (t: number): Seed => ({ L: lerp(0.66, 0.5, t), C: 0.022 + (0.128 - 0.022) * Math.pow(1 - t, 1.15), H: 14 - 122 * t })

// Chip bg/fg at FIXED lightness per theme → reliable contrast regardless of the level's hue.
const chip = (s: Seed, dark: boolean) =>
  dark
    ? { bg: okStr(0.33, Math.min(s.C * 0.5, 0.05), s.H), fg: okStr(0.82, Math.min(s.C * 0.75, 0.1), s.H) }
    : { bg: okStr(0.955, Math.min(s.C, 0.045), s.H), fg: okStr(0.42, Math.min(s.C * 0.95, 0.12), s.H) }

/** Resolve a priority value to its rank within the ordered config list (0 = highest).
 *  Unknown/empty values fall to the lowest rank so an untagged task never "screams". */
export function priorityRank(priority: string | undefined, priorities: string[]): { rank: number; total: number } {
  const total = Math.max(priorities.length, 1)
  const i = priority ? priorities.indexOf(priority) : -1
  return { rank: i < 0 ? total - 1 : i, total }
}

export interface PriorityColors {
  bar: string
  chipBg: string
  chipFg: string
}

/** Sample the ramp for a given rank/total → CSS color strings (each a light-dark() pair). */
export function priorityColors(rank: number, total: number): PriorityColors {
  const t = total <= 1 ? 0 : Math.min(Math.max(rank, 0), total - 1) / (total - 1)
  const L = lightSeed(t)
  const D = darkSeed(t)
  const cl = chip(L, false)
  const cd = chip(D, true)
  return {
    bar: `light-dark(${okStr(L.L, L.C, L.H)}, ${okStr(D.L, D.C, D.H)})`,
    chipBg: `light-dark(${cl.bg}, ${cd.bg})`,
    chipFg: `light-dark(${cl.fg}, ${cd.fg})`,
  }
}
