/**
 * The contract itself: the channel allow-list is enumerable, and the shapes on
 * either side of the bridge are the same shapes.
 */

import { describe, expect, test } from 'vitest'
import { CHANNEL, EVENT } from './api.js'

describe('CHANNEL', () => {
  test('every channel string is distinct — a collision would silently share a handler', () => {
    const channels = [...Object.values(CHANNEL), ...Object.values(EVENT)]
    expect(new Set(channels).size).toBe(channels.length)
  })

  test('every channel is namespaced, so a bare string cannot collide with one', () => {
    for (const channel of [...Object.values(CHANNEL), ...Object.values(EVENT)]) {
      expect(channel).toMatch(/^[a-z]+:[a-zA-Z]+$/)
    }
  })

  // The event channel is main → renderer; if it ever appears in CHANNEL, the
  // "registers exactly these" assertion quietly starts allowing a handler on it.
  test('CHANNEL and EVENT do not overlap', () => {
    const invokable = new Set<string>(Object.values(CHANNEL))
    for (const channel of Object.values(EVENT)) expect(invokable.has(channel)).toBe(false)
  })
})
