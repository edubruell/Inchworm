/**
 * "When was this last open", as a phrase. Given its `now` rather than reading a
 * clock, so the grain is assertable and no case passes only until midnight.
 */

import { describe, expect, test } from 'vitest'
import { sinceLabel } from './time.js'

const NOW = 1_700_000_000_000
const ago = (ms: number): string => sinceLabel(NOW - ms, NOW)

describe('sinceLabel', () => {
  test.each([
    [0, 'just now'],
    [59_000, 'just now'],
    [60_000, '1 min ago'],
    [59 * 60_000, '59 min ago'],
    [60 * 60_000, '1 h ago'],
    [90 * 60_000, '1 h ago'],
    [23 * 3_600_000, '23 h ago'],
    [24 * 3_600_000, '1 d ago'],
    [6 * 86_400_000, '6 d ago'],
    [7 * 86_400_000, '1 w ago'],
    [29 * 86_400_000, '4 w ago'],
    [40 * 86_400_000, '1 mo ago'],
    [300 * 86_400_000, '9 mo ago'],
    [400 * 86_400_000, '1 y ago'],
    [1000 * 86_400_000, '2 y ago'],
  ])('%d ms ago reads as %s', (elapsed, expected) => {
    expect(ago(elapsed)).toBe(expected)
  })

  // A folder synced from a machine whose clock runs ahead has a *future*
  // timestamp; "in -3 minutes" is worse than saying nothing happened yet.
  test('a timestamp in the future is now, not a negative count', () => {
    expect(sinceLabel(NOW + 86_400_000, NOW)).toBe('just now')
  })

  test('the boundaries never round up into the next unit', () => {
    // One millisecond short of a week is still days, not "0 w ago".
    expect(ago(7 * 86_400_000 - 1)).toBe('6 d ago')
    expect(ago(3_600_000 - 1)).toBe('59 min ago')
  })
})
