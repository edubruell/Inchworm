/**
 * The drawer's two edges: never so tall that the window loses its title bar,
 * never so short that a pane holds less than a prompt and its answer.
 */

import { describe, expect, it } from 'vitest'
import {
  DRAWER_DEFAULT,
  DRAWER_HEADROOM,
  DRAWER_MIN,
  DRAWER_SPLIT,
  DRAWER_STEP,
  clampDrawer,
  drawerFull,
  drawerSplit,
} from './drawer.js'

describe('clampDrawer', () => {
  it('leaves an ordinary height alone', () => {
    expect(clampDrawer(400, 900)).toBe(400)
  })

  it('refuses a drawer too short to hold a prompt and its answer', () => {
    expect(clampDrawer(10, 900)).toBe(DRAWER_MIN)
    expect(clampDrawer(-500, 900)).toBe(DRAWER_MIN)
  })

  it('keeps the title bar on screen however far the pointer travels', () => {
    expect(clampDrawer(10_000, 900)).toBe(900 - DRAWER_HEADROOM)
  })

  it('gives a short window a cramped drawer, never an inverted one', () => {
    expect(clampDrawer(500, 100)).toBe(DRAWER_MIN)
  })

  it('rounds, because a fractional pixel height is a blurred hairline', () => {
    expect(clampDrawer(320.6, 900)).toBe(321)
  })

  it('answers with the minimum rather than NaN when the arithmetic went wrong', () => {
    expect(clampDrawer(Number.NaN, 900)).toBe(DRAWER_MIN)
  })

  it('treats an unbounded drag as the ceiling, not as a slip', () => {
    expect(clampDrawer(Number.POSITIVE_INFINITY, 900)).toBe(900 - DRAWER_HEADROOM)
    expect(clampDrawer(Number.NEGATIVE_INFINITY, 900)).toBe(DRAWER_MIN)
  })

  it('opens at the height it shipped as, and that height is legal', () => {
    expect(clampDrawer(DRAWER_DEFAULT, 900)).toBe(DRAWER_DEFAULT)
    expect(DRAWER_STEP).toBeGreaterThan(0)
  })
})

describe('the three presets', () => {
  it('splits the window 70/30, the note keeping the larger share', () => {
    expect(drawerSplit(900)).toBe(270)
    expect(DRAWER_SPLIT).toBeLessThan(0.5)
  })

  it('takes the whole window but the title bar, so the window is still a window', () => {
    expect(drawerFull(900)).toBe(900 - DRAWER_HEADROOM)
  })

  it('orders as hide < split < full, at every window size worth having', () => {
    for (const viewport of [400, 700, 900, 1600, 2400]) {
      expect(drawerSplit(viewport)).toBeLessThanOrEqual(drawerFull(viewport))
      expect(drawerSplit(viewport)).toBeGreaterThanOrEqual(DRAWER_MIN)
    }
  })

  it('gives a window too short to split a legal drawer anyway', () => {
    expect(drawerSplit(200)).toBe(DRAWER_MIN)
    expect(drawerFull(60)).toBe(DRAWER_MIN)
  })
})
