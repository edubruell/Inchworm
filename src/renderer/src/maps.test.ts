/**
 * The property both stores depend on and neither would notice losing: the
 * input map is untouched and the answer is a *different object*. Solid compares
 * signals by identity, so an in-place `set` or `delete` would leave every
 * subscriber unrepainted while the data was, technically, correct.
 */

import { describe, expect, test } from 'vitest'
import { withKey, withoutKey } from './maps.js'

describe('withKey', () => {
  test('answers a new map, leaving the original alone', () => {
    const before = new Map([['a', 1]])

    const after = withKey(before, 'b', 2)

    expect(after).not.toBe(before)
    expect([...after]).toEqual([
      ['a', 1],
      ['b', 2],
    ])
    expect([...before]).toEqual([['a', 1]])
  })

  test('replaces a key that is already there, in place in the order', () => {
    const after = withKey(
      new Map([
        ['a', 1],
        ['b', 2],
      ]),
      'a',
      9,
    )

    expect([...after]).toEqual([
      ['a', 9],
      ['b', 2],
    ])
  })
})

describe('withoutKey', () => {
  test('answers a new map without the key, leaving the original alone', () => {
    const before = new Map([
      ['a', 1],
      ['b', 2],
    ])

    const after = withoutKey(before, 'a')

    expect(after).not.toBe(before)
    expect([...after]).toEqual([['b', 2]])
    expect(before.has('a')).toBe(true)
  })

  /**
   * A key that was never there still costs a new map. The callers guard with
   * `current.has(path)` for exactly this reason — the identity change would
   * otherwise repaint a pane over a deletion that did not happen.
   */
  test('a key that is not there is not an error, but is still a new map', () => {
    const before = new Map([['a', 1]])

    const after = withoutKey(before, 'zzz')

    expect(after).not.toBe(before)
    expect([...after]).toEqual([['a', 1]])
  })
})
