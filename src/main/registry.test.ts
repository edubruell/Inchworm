/** A watcher that records what it was asked to watch and when it was closed. */

import { describe, expect, test } from 'vitest'
import { createRegistry, type WatchChange, type WatchProject } from './registry.js'
import type { OpenProject } from './project.js'

const layout = { wikiRoot: 'wiki/', journal: 'notes/', kind: 'software' } as const
const projectA: OpenProject = { dir: '/p/a', layout }
const projectB: OpenProject = { dir: '/p/b', layout }

const fakeWatch = (): {
  readonly watch: WatchProject
  readonly started: string[]
  readonly stopped: string[]
  readonly fire: (dir: string, change: WatchChange) => void
} => {
  const started: string[] = []
  const stopped: string[] = []
  const notifiers = new Map<string, (change: WatchChange) => void>()
  return {
    started,
    stopped,
    fire: (dir, change) => {
      notifiers.get(dir)?.(change)
    },
    watch: (project, notify) => {
      started.push(project.dir)
      notifiers.set(project.dir, notify)
      return () => {
        stopped.push(project.dir)
      }
    },
  }
}

describe('createRegistry', () => {
  test('the second window on a project does not start a second watcher', () => {
    const fake = fakeWatch()
    const registry = createRegistry(fake.watch)

    registry.attach(1, projectA)
    registry.attach(2, projectA)

    expect(fake.started).toEqual(['/p/a'])
    expect(registry.windowsOn('/p/a')).toEqual([1, 2])
  })

  // Closing one of two windows must leave the other's watcher alive.
  test('the watcher survives until the last window on the project closes', () => {
    const fake = fakeWatch()
    const registry = createRegistry(fake.watch)

    registry.attach(1, projectA)
    registry.attach(2, projectA)
    registry.detach(1)

    expect(fake.stopped).toEqual([])
    expect(registry.watching()).toEqual(['/p/a'])

    registry.detach(2)
    expect(fake.stopped).toEqual(['/p/a'])
    expect(registry.watching()).toEqual([])
  })

  test('projects are independent: closing one does not touch the other', () => {
    const fake = fakeWatch()
    const registry = createRegistry(fake.watch)

    registry.attach(1, projectA)
    registry.attach(2, projectB)
    registry.detach(1)

    expect(fake.stopped).toEqual(['/p/a'])
    expect(registry.watching()).toEqual(['/p/b'])
  })

  test('re-opening a project after the last window starts a fresh watcher', () => {
    const fake = fakeWatch()
    const registry = createRegistry(fake.watch)

    registry.attach(1, projectA)
    registry.detach(1)
    registry.attach(2, projectA)

    expect(fake.started).toEqual(['/p/a', '/p/a'])
  })

  // Not in the design — a window keeps its project for life — but an orphaned
  // watcher would never be closed again, so the refcount must survive it.
  test('re-attaching a window id releases the project it held', () => {
    const fake = fakeWatch()
    const registry = createRegistry(fake.watch)

    registry.attach(1, projectA)
    registry.attach(1, projectB)

    expect(fake.stopped).toEqual(['/p/a'])
    expect(registry.watching()).toEqual(['/p/b'])
  })

  test('detaching a window that was never attached is not a failure', () => {
    const fake = fakeWatch()
    const registry = createRegistry(fake.watch)
    expect(() => {
      registry.detach(99)
    }).not.toThrow()
    expect(fake.stopped).toEqual([])
  })

  test('projectFor answers only for attached windows', () => {
    const registry = createRegistry(fakeWatch().watch)
    registry.attach(1, projectA)
    expect(registry.projectFor(1)).toEqual(projectA)
    expect(registry.projectFor(2)).toBeUndefined()
  })

  test('changes reach every listener with the project they belong to', () => {
    const fake = fakeWatch()
    const registry = createRegistry(fake.watch)
    const seen: [string, WatchChange][] = []
    registry.onChange((project, change) => seen.push([project.dir, change]))
    registry.attach(1, projectA)

    fake.fire('/p/a', { kind: 'file', path: 'wiki/00_state.md' })

    expect(seen).toEqual([['/p/a', { kind: 'file', path: 'wiki/00_state.md' }]])
  })
})
