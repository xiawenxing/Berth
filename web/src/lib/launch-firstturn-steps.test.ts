import { describe, expect, it } from 'vitest'
import {
  firstTurnSteps,
  BRACKETED_PASTE_READY,
  READY_QUIET_MS,
  RENDER_QUIET_MS,
  READY_FALLBACK_MS,
  ATTACH_FALLBACK_MS,
  type SubmitSignals,
} from './launch-firstturn-steps'

const sig = (o: Partial<SubmitSignals>): SubmitSignals => ({
  recentOutput: '',
  newOutputSinceStep: '',
  quietMs: 0,
  elapsedSinceStepMs: 0,
  ...o,
})

describe('firstTurnSteps — sequence shape', () => {
  it('text-only: paste then enter', () => {
    expect(firstTurnSteps({ hasImages: false, hasPrompt: true }).map((s) => s.emit)).toEqual(['paste', 'enter'])
  })
  it('image + prompt: images, paste, enter', () => {
    expect(firstTurnSteps({ hasImages: true, hasPrompt: true }).map((s) => s.emit)).toEqual(['images', 'paste', 'enter'])
  })
  it('image only: images then enter', () => {
    expect(firstTurnSteps({ hasImages: true, hasPrompt: false }).map((s) => s.emit)).toEqual(['images', 'enter'])
  })
  it('nothing to submit: empty', () => {
    expect(firstTurnSteps({ hasImages: false, hasPrompt: false })).toEqual([])
  })
})

describe('ready guard (step 0) — waits for marker AND idle, not the raw marker', () => {
  const ready = firstTurnSteps({ hasImages: false, hasPrompt: true })[0].ready
  it('marker present but NOT yet quiet → not ready (the live-verify failure)', () => {
    expect(ready(sig({ recentOutput: `boot ${BRACKETED_PASTE_READY}`, quietMs: 200 }))).toBe(false)
  })
  it('marker present AND quiet long enough → ready', () => {
    expect(ready(sig({ recentOutput: `boot ${BRACKETED_PASTE_READY}`, quietMs: READY_QUIET_MS }))).toBe(true)
  })
  it('quiet but marker never seen → not ready', () => {
    expect(ready(sig({ recentOutput: 'no marker', quietMs: READY_QUIET_MS + 500 }))).toBe(false)
  })
  it('fallback fires even without a clean marker/idle', () => {
    expect(ready(sig({ recentOutput: 'silent cli', elapsedSinceStepMs: READY_FALLBACK_MS }))).toBe(true)
  })
})

describe('attach guard (image → prompt) — waits for the [Image attach chip', () => {
  const attach = firstTurnSteps({ hasImages: true, hasPrompt: true })[1].ready
  it('no attach chip yet → hold the prompt (the reported bug)', () => {
    expect(attach(sig({ newOutputSinceStep: 'spinner redraw', quietMs: 800 }))).toBe(false)
  })
  it('attach chip rendered + quiet → release the prompt', () => {
    expect(attach(sig({ newOutputSinceStep: '[Image #1]', quietMs: RENDER_QUIET_MS }))).toBe(true)
  })
  it('attach fallback fires if the chip never shows', () => {
    expect(attach(sig({ elapsedSinceStepMs: ATTACH_FALLBACK_MS }))).toBe(true)
  })
})

describe('render guard (enter) — waits for the paste to settle', () => {
  const enter = firstTurnSteps({ hasImages: false, hasPrompt: true })[1].ready
  it('still rendering → hold Enter', () => {
    expect(enter(sig({ quietMs: 100 }))).toBe(false)
  })
  it('rendered + quiet → send Enter', () => {
    expect(enter(sig({ quietMs: RENDER_QUIET_MS }))).toBe(true)
  })
})
