// @vitest-environment happy-dom
/**
 * One bridge subscription per window, fanned out to the parts that own each
 * command — and let go when the window does. A hub that leaks is a ⌘K that
 * opens a palette in a window the reader closed.
 */

import { createRoot } from 'solid-js'
import { describe, expect, test } from 'vitest'
import type { Command } from '@shared/api.js'
import { fakeApi } from '../../../tests/support/api.js'
import { createCommandHub } from './commands.js'

describe('createCommandHub', () => {
  test('every listener sees every command, in order', () => {
    const fake = fakeApi({})
    const seen: Command[][] = [[], []]

    createRoot((dispose) => {
      const hub = createCommandHub(fake.api)
      hub.listen((command) => seen[0]?.push(command))
      hub.listen((command) => seen[1]?.push(command))

      fake.send({ kind: 'palette' })
      fake.send({ kind: 'back' })

      expect(seen[0]).toEqual([{ kind: 'palette' }, { kind: 'back' }])
      expect(seen[1]).toEqual(seen[0])
      dispose()
    })
  })

  test('one subscription on the bridge however many listeners there are', () => {
    createRoot((dispose) => {
      const fake = fakeApi({})
      const hub = createCommandHub(fake.api)
      hub.listen(() => undefined)
      hub.listen(() => undefined)

      expect(fake.listening().commands).toBe(1)

      dispose()
      expect(fake.listening().commands).toBe(0)
    })
  })

  test('a listener that disposes its own scope mid-delivery does not skip the next one', () => {
    const fake = fakeApi({})
    const seen: string[] = []

    createRoot((disposeOuter) => {
      const hub = createCommandHub(fake.api)

      createRoot((disposeInner) => {
        hub.listen(() => {
          seen.push('first')
          // Removes itself *and* everything else this scope registered, while
          // the hub is walking its set.
          disposeInner()
        })
      })
      hub.listen(() => seen.push('second'))

      fake.send({ kind: 'palette' })

      expect(seen).toEqual(['first', 'second'])
      disposeOuter()
    })
  })

  test('a command that arrives after a listener has gone reaches only the rest', () => {
    const fake = fakeApi({})
    const seen: string[] = []

    createRoot((disposeOuter) => {
      const hub = createCommandHub(fake.api)
      createRoot((disposeInner) => {
        hub.listen(() => seen.push('gone'))
        disposeInner()
      })
      hub.listen(() => seen.push('stays'))

      fake.send({ kind: 'forward' })

      expect(seen).toEqual(['stays'])
      disposeOuter()
    })
  })
})
