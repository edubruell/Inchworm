/**
 * Browser semantics for ⌘⌥← / ⌘⌥→: going back and then somewhere new drops the
 * forward tail, and the ends are no-ops that return the *same object*.
 */

import { describe, expect, test } from 'vitest'
import { NO_HISTORY, back, current, forward, visit } from './history.js'

const walk = (...paths: readonly string[]): ReturnType<typeof visit> =>
  paths.reduce((history, path) => visit(history, path), NO_HISTORY)

describe('an empty history', () => {
  test('has no current entry and goes nowhere', () => {
    expect(current(NO_HISTORY)).toBeUndefined()
    // Identity at the ends, so a no-op re-renders nothing.
    expect(back(NO_HISTORY)).toBe(NO_HISTORY)
    expect(forward(NO_HISTORY)).toBe(NO_HISTORY)
  })
})

describe('visiting', () => {
  test('the first visit is the current entry, with nowhere to go', () => {
    const history = visit(NO_HISTORY, 'a.md')

    expect(current(history)).toBe('a.md')
    expect(back(history)).toBe(history)
    expect(forward(history)).toBe(history)
  })

  test('re-visiting the current entry changes nothing at all', () => {
    const history = walk('a.md', 'b.md')

    // Identity, not equality: the watcher re-selects the open file constantly,
    // and a new object per event would re-run every memo that reads it.
    expect(visit(history, 'b.md')).toBe(history)
  })

  test('the same path twice apart is two entries, because the reader went there twice', () => {
    expect(walk('a.md', 'b.md', 'a.md').visited).toEqual(['a.md', 'b.md', 'a.md'])
  })
})

describe('back and forward', () => {
  test('back moves the cursor and leaves the trail', () => {
    const history = back(walk('a.md', 'b.md', 'c.md'))

    expect(current(history)).toBe('b.md')
    expect(history.visited).toEqual(['a.md', 'b.md', 'c.md'])
    expect(current(forward(history))).toBe('c.md')
  })

  test('forward undoes back', () => {
    const history = walk('a.md', 'b.md', 'c.md')

    expect(forward(back(history))).toEqual(history)
  })

  test('back at the oldest entry, forward at the newest: both stand still', () => {
    const oldest = back(back(walk('a.md', 'b.md')))
    expect(current(oldest)).toBe('a.md')
    expect(back(oldest)).toBe(oldest)

    const newest = walk('a.md', 'b.md')
    expect(forward(newest)).toBe(newest)
  })

  test('going back and then somewhere new drops the forward tail', () => {
    const history = visit(back(walk('a.md', 'b.md', 'c.md')), 'd.md')

    expect(history.visited).toEqual(['a.md', 'b.md', 'd.md'])
    expect(current(history)).toBe('d.md')
    expect(forward(history)).toBe(history)
  })
})

describe('the shapes a window actually produces', () => {
  test('re-visiting the current entry after going back keeps the forward tail', () => {
    const back1 = back(walk('a.md', 'b.md', 'c.md'))

    // The sidebar re-selects the open file on every watcher event; that must
    // not throw away where the reader can go forward to.
    expect(visit(back1, 'b.md')).toBe(back1)
    expect(current(forward(back1))).toBe('c.md')
  })

  test('history is unbounded by design: a long session is a long trail', () => {
    const long = Array.from({ length: 500 }, (_, index) => `n${String(index)}.md`).reduce(visit, NO_HISTORY)

    expect(long.visited).toHaveLength(500)
    expect(current(long)).toBe('n499.md')
  })
})
