/** The two shapes that cost: many nested lines, and one very deep line. */

import { describe, expect, test } from 'vitest'
import { PARSE_BUDGET, checkParseBudget, nesting } from './budget.js'
import { parseNote } from './note.js'

const nestedList = (lines: number, indent = 2): string =>
  Array.from({ length: lines }, (_, i) => `${' '.repeat(i * indent)}- item`).join('\n')
// No space after the markers: CommonMark eats one space per `>`, so it counts
// toward the container prefix too — a fixture that adds one is off by one.
const deepQuote = (depth: number): string => `${'>'.repeat(depth)}deep`

const elapsed = (run: () => void): number => {
  const started = performance.now()
  run()
  return performance.now() - started
}

describe('nesting counts the container prefix, and only the prefix', () => {
  test('ordinary prose has no nesting at all', () => {
    expect(nesting('# title\n\nA sentence > with a greater-than in it.\n')).toEqual({ deepest: 0, total: 0 })
  })

  test('a `>` mid-line opens no container, so it is not counted', () => {
    expect(nesting('text > text')).toEqual({ deepest: 0, total: 0 })
  })

  test('the deepest line and the sum over lines are reported separately', () => {
    expect(nesting('  a\n      b\n  c')).toEqual({ deepest: 6, total: 10 })
  })

  test('a tab counts as four, because it costs about four times as much', () => {
    expect(nesting('\t\ta')).toEqual({ deepest: 8, total: 8 })
  })

  test('blockquote markers and indentation stack in the same run', () => {
    expect(nesting('  > > a')).toEqual({ deepest: 6, total: 6 })
  })

  test('the last line counts even without a trailing newline', () => {
    expect(nesting('a\n    b')).toEqual({ deepest: 4, total: 4 })
  })

  test('an empty text is not a special case', () => {
    expect(nesting('')).toEqual({ deepest: 0, total: 0 })
  })
})

describe('checkParseBudget refuses on the measure that broke, and names it', () => {
  test('real-shaped material passes', () => {
    expect(checkParseBudget('---\nstatus: active\n---\n\n# note\n\n- a\n  - b\n')).toBeUndefined()
  })

  test('one absurdly deep line is refused on `deepest`, not on size', () => {
    const refusal = checkParseBudget(deepQuote(PARSE_BUDGET.deepest + 1))
    expect(refusal).toEqual({
      kind: 'too-nested',
      measure: 'deepest',
      depth: PARSE_BUDGET.deepest + 1,
      limit: PARSE_BUDGET.deepest,
    })
  })

  test('many moderately nested lines are refused on `total`, which `deepest` alone would let through', () => {
    // 300 lines at depth 100: `deepest` is 100, far inside its limit, while the
    // work is 30 000 — the case a single depth limit cannot see.
    const text = Array.from({ length: 300 }, () => `${' '.repeat(100)}- item`).join('\n')
    expect(nesting(text).deepest).toBeLessThan(PARSE_BUDGET.deepest)
    expect(checkParseBudget(text)).toMatchObject({ kind: 'too-nested', measure: 'total' })
  })

  test('size is checked before shape, so a huge file never gets scanned', () => {
    const text = 'a'.repeat(PARSE_BUDGET.bytes + 1)
    expect(checkParseBudget(text)).toEqual({
      kind: 'too-large',
      bytes: PARSE_BUDGET.bytes + 1,
      limit: PARSE_BUDGET.bytes,
    })
  })

  test('a file exactly at each limit is admitted — the limit is a ceiling, not a fence', () => {
    expect(checkParseBudget('a'.repeat(PARSE_BUDGET.bytes))).toBeUndefined()
    expect(checkParseBudget(deepQuote(PARSE_BUDGET.deepest))).toBeUndefined()
  })

  test('the budget is overridable, so callers are not stuck with the default', () => {
    expect(checkParseBudget('    a', { bytes: 100, deepest: 2, total: 100 })).toMatchObject({ measure: 'deepest' })
  })
})

/**
 * The budget's whole promise is a number of milliseconds, so the number is what
 * gets asserted. Without the guard these two inputs take **tens of seconds** —
 * a 20 000-deep blockquote measured 292 ms, and it scales super-linearly, with
 * 2 MB of nested list measuring ~34 s. The bound below is deliberately loose
 * against a slow or loaded
 * machine: it is there to catch the guard being removed, which costs three
 * orders of magnitude, not to police a 20 % regression.
 */
describe('the budget bounds what C8 is actually about: wall-clock on the watcher path', () => {
  const BUDGET_MS = 250

  test.each([
    ['a 100 000-deep blockquote', deepQuote(100_000)],
    ['a 4 000-line nested list', nestedList(4_000)],
    ['a tab-nested list, ~4x worse per byte than spaces', nestedList(2_000, 1).replaceAll('  ', '\t')],
  ])('%s is refused rather than parsed, in well under the budget', (_shape, text) => {
    const state = parseNote(text)
    expect(state.kind).toBe('unparsed')
    expect(elapsed(() => void parseNote(text))).toBeLessThan(BUDGET_MS)
  })

  test('the worst shape the budget still admits also stays inside it', () => {
    // Exactly at the `total` limit, which measures ~59 ms —
    // the promise the numbers in PARSE_BUDGET are making.
    const text = Array.from({ length: 500 }, () => `${'>'.repeat(40)}x`).join('\n')
    expect(checkParseBudget(text)).toBeUndefined()
    expect(elapsed(() => void parseNote(text))).toBeLessThan(BUDGET_MS)
  })
})
