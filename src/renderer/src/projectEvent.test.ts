/**
 * How a window reacts to a project event — and, the part worth a test, how it
 * reacts to one for another project: not at all.
 */

import { describe, expect, test } from 'vitest'
import type { ProjectEvent, ProjectSnapshot } from '@shared/api.js'
import { applyProjectEvent } from './projectEvent.js'

const snapshot: ProjectSnapshot = {
  dir: '/p/a',
  name: 'a',
  hue: 210,
  layout: { wikiRoot: 'wiki/', journal: 'notes/', kind: 'software' },
  files: ['wiki/00_state.md'],
}

const other: ProjectEvent = { kind: 'accent', dir: '/p/b', hue: 330 }

describe('applyProjectEvent', () => {
  test('a files event replaces the whole list', () => {
    const next = applyProjectEvent(snapshot, { kind: 'files', dir: '/p/a', files: ['wiki/01_new.md'] })
    expect(next.files).toEqual(['wiki/01_new.md'])
  })

  test('an accent event changes only the hue', () => {
    expect(applyProjectEvent(snapshot, { kind: 'accent', dir: '/p/a', hue: 330 })).toEqual({ ...snapshot, hue: 330 })
  })

  test('a content change leaves the snapshot alone — the open file re-reads instead', () => {
    expect(applyProjectEvent(snapshot, { kind: 'file', dir: '/p/a', path: 'wiki/00_state.md' })).toBe(snapshot)
  })

  // Main only broadcasts to the windows on a project; this is the second line,
  // and the one a component could not be asked about.
  test('an event for another project changes nothing', () => {
    expect(applyProjectEvent(snapshot, other)).toBe(snapshot)
    expect(applyProjectEvent(snapshot, { kind: 'files', dir: '/p/b', files: [] })).toBe(snapshot)
  })
})
