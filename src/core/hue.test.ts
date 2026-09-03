/**
 * Project identity as one number. The palette has to stay clear of the status
 * family and clear of itself — neighbouring hues nobody can tell apart are the
 * failure this file exists to prevent.
 */

import { describe, expect, test } from 'vitest'
import { chromaFor, GRAPHITE, GRAPHITE_CHROMA, hueForPath, isPaletteHue, PALETTE } from './hue.js'

describe('hueForPath', () => {
  test('always lands on the curated palette', () => {
    const paths = ['/a', '/Users/x/projects/wikiviewer', 'relative/path', '', 'ünïcode/påth']
    for (const path of paths) expect(isPaletteHue(hueForPath(path))).toBe(true)
  })

  test('is stable — the same project is the same colour on every launch', () => {
    expect(hueForPath('/Users/x/projects/wikiviewer')).toBe(hueForPath('/Users/x/projects/wikiviewer'))
  })

  test('ignores trailing slashes, which a folder picker adds inconsistently', () => {
    expect(hueForPath('/a/b/')).toBe(hueForPath('/a/b'))
    expect(hueForPath('/a/b//')).toBe(hueForPath('/a/b'))
  })

  test('separates the projects a user actually has open side by side', () => {
    const siblings = ['/p/alpha', '/p/beta', '/p/gamma', '/p/delta']
    expect(new Set(siblings.map(hueForPath)).size).toBeGreaterThan(1)
  })

  // The identity family must never be mistakable for the status family, which
  // owns amber and red.
  test('the palette excludes the warm band, and the mustard one past it', () => {
    // Past 85° is the status family's; up to 135° is where the identity ramp's
    // fixed lightness turns every hue to mustard (see `hue.ts`).
    for (const hue of PALETTE) expect(hue >= 135).toBe(true)
  })

  test('every palette hue is reachable', () => {
    const seen = new Set(Array.from({ length: 400 }, (_, i) => hueForPath(`/p/project-${String(i)}`)))
    expect(seen.size).toBe(PALETTE.length)
  })

  // The lookup in hueForPath is total only while these two agree.
  test('the palette has exactly the seven positions the index type names', () => {
    expect(PALETTE).toHaveLength(7)
  })

  test('isPaletteHue rejects a hue the picker never offers', () => {
    expect(isPaletteHue(30)).toBe(false)
    expect(isPaletteHue(95)).toBe(false)
  })

  /**
   * The complaint this palette answers: three neighbouring greens that no
   * reader could tell apart. 30° is the floor a re-spread must keep, and it is
   * asserted so the next hue added has to earn its place.
   */
  test('no two colours sit within 35° of each other', () => {
    const colours = [...PALETTE].filter((hue) => hue !== GRAPHITE).sort((a, b) => a - b)
    for (const [index, hue] of colours.entries()) {
      const next = colours[index + 1]
      if (next !== undefined) expect(next - hue).toBeGreaterThanOrEqual(35)
    }
  })

  test('the graphite slot is the only one with its chroma drained', () => {
    expect(chromaFor(GRAPHITE)).toBe(GRAPHITE_CHROMA)
    expect(GRAPHITE_CHROMA).toBeLessThan(0.2)
    for (const hue of PALETTE) if (hue !== GRAPHITE) expect(chromaFor(hue)).toBe(1)
  })

  test('graphite is on the palette, so the picker offers it and main accepts it', () => {
    expect(isPaletteHue(GRAPHITE)).toBe(true)
  })
})
