/**
 * The store is reactive but not visual, so it is tested in a reactive root with
 * no DOM: what matters here is which reads happen, which answers are kept, and
 * what the derived indexes say — the parts a component test would not reach.
 */

import { createRoot, createSignal } from 'solid-js'
import { describe, expect, test } from 'vitest'
import type { FileContent, FileError, ProjectEvent, ProjectSnapshot, WikiApi, Wire } from '@shared/api.js'
import { createNoteStore } from './noteStore.js'

const snapshot = (files: readonly string[]): ProjectSnapshot => ({
  dir: '/p',
  name: 'p',
  hue: 210,
  layout: { wikiRoot: 'wiki', journal: 'notes', kind: 'software' },
  files,
})

type Fake = {
  readonly api: WikiApi
  readonly reads: string[]
  readonly texts: Map<string, string>
  readonly settle: () => Promise<void>
  emit: (event: ProjectEvent) => void
  /** Set to hold every read until released, so a race can be staged. */
  gate?: ((path: string) => Promise<void>) | undefined
  /** Set to answer with a failure instead of bytes. */
  fail?: FileError | undefined
  /** Set to reject the promise outright — the bridge itself failing. */
  reject?: boolean | undefined
}

const fakeApi = (texts: Map<string, string>): Fake => {
  const reads: string[] = []
  const listeners = new Set<(event: ProjectEvent) => void>()
  const fake: Fake = {
    reads,
    texts,
    api: {
      pathForFile: () => '',
      chooseProject: () => Promise.reject(new Error('unused')),
      openProject: () => Promise.reject(new Error('unused')),
      listProjects: () => Promise.reject(new Error('unused')),
      currentProject: () => Promise.reject(new Error('unused')),
      setAccent: () => Promise.resolve(),
      getSettings: () => Promise.reject(new Error('unused')),
      setSettings: () => Promise.reject(new Error('unused')),
      onSettings: () => (): undefined => undefined,
      skillStatus: () => Promise.reject(new Error('unused')),
      readDebt: () => Promise.reject(new Error('unused')),
      installSkill: () => Promise.reject(new Error('unused')),
      writeFile: () => Promise.reject(new Error('unused')),
      openExternal: () => Promise.reject(new Error('unused')),
      readFile: async (path: string): Promise<Wire<FileContent, FileError>> => {
        reads.push(path)
        await fake.gate?.(path)
        if (fake.reject === true) throw new Error('bridge gone')
        if (fake.fail !== undefined) return { ok: false, error: fake.fail }
        const text = texts.get(path)
        if (text === undefined) throw new Error(`no fixture for ${path}`)
        return { ok: true, value: { path, text, sha: `sha:${text.length.toString()}`, mtimeMs: 0 } }
      },
      onProjectEvent: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      onCommand: () => () => undefined,
      startPty: () => Promise.reject(new Error('unused')),
      writePty: () => Promise.reject(new Error('unused')),
      resizePty: () => Promise.reject(new Error('unused')),
      killPty: () => Promise.reject(new Error('unused')),
      onPtyEvent: () => () => undefined,
    },
    settle: async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    },
    emit: (event) => {
      for (const listener of listeners) listener(event)
    },
  }
  return fake
}

const withStore = async (
  texts: Map<string, string>,
  files: readonly string[],
  body: (context: {
    readonly store: ReturnType<typeof createNoteStore>
    readonly fake: Fake
    readonly setProject: (next: ProjectSnapshot) => void
  }) => Promise<void>,
): Promise<void> => {
  const fake = fakeApi(texts)
  const [project, setProject] = createSignal(snapshot(files))
  let dispose = (): void => undefined
  const store = createRoot((disposer) => {
    dispose = disposer
    return createNoteStore(fake.api, project)
  })
  try {
    await fake.settle()
    await body({ store, fake, setProject })
  } finally {
    dispose()
  }
}

describe('createNoteStore', () => {
  test('reads every file in the project once and parses it', async () => {
    const texts = new Map([
      ['wiki/00_state.md', '---\nstatus: active\n---\n\n# State\n\nsee [[02_arch]]\n'],
      ['wiki/02_arch.md', '# Arch\n'],
    ])
    await withStore(texts, [...texts.keys()], async ({ store, fake }) => {
      expect(fake.reads.sort()).toEqual(['wiki/00_state.md', 'wiki/02_arch.md'])
      expect(store.get('wiki/02_arch.md')?.note.kind).toBe('parsed')
      await Promise.resolve()
    })
  })

  test('a file added to the project is read; one removed is dropped', async () => {
    const texts = new Map([
      ['wiki/00_state.md', '# State\n'],
      ['wiki/decisions.md', '# Decisions\n'],
    ])
    await withStore(texts, ['wiki/00_state.md'], async ({ store, fake, setProject }) => {
      expect(fake.reads).toEqual(['wiki/00_state.md'])

      setProject(snapshot(['wiki/00_state.md', 'wiki/decisions.md']))
      await fake.settle()
      expect(fake.reads).toEqual(['wiki/00_state.md', 'wiki/decisions.md'])

      setProject(snapshot(['wiki/decisions.md']))
      await fake.settle()
      expect(store.get('wiki/00_state.md')).toBeUndefined()
      // Only the two reads so far: a file already held is not re-read when the
      // list changes around it.
      expect(fake.reads).toEqual(['wiki/00_state.md', 'wiki/decisions.md'])
    })
  })

  test('a file deleted and written again is read again', async () => {
    const texts = new Map([['wiki/00_state.md', '# State\n']])
    await withStore(texts, ['wiki/00_state.md'], async ({ fake, setProject }) => {
      setProject(snapshot([]))
      await fake.settle()
      setProject(snapshot(['wiki/00_state.md']))
      await fake.settle()
      expect(fake.reads).toEqual(['wiki/00_state.md', 'wiki/00_state.md'])
    })
  })

  test('a watcher event for one file re-reads exactly that file', async () => {
    const texts = new Map([
      ['wiki/00_state.md', '# State\n'],
      ['wiki/decisions.md', '# Decisions\n'],
    ])
    await withStore(texts, [...texts.keys()], async ({ store, fake }) => {
      texts.set('wiki/00_state.md', '# State\n\nnew line\n')
      fake.emit({ kind: 'file', dir: '/p', path: 'wiki/00_state.md' })
      await fake.settle()
      expect(fake.reads.filter((path) => path === 'wiki/00_state.md')).toHaveLength(2)
      expect(fake.reads.filter((path) => path === 'wiki/decisions.md')).toHaveLength(1)
      expect(store.get('wiki/00_state.md')?.text).toContain('new line')
    })
  })

  test('an event for another project is ignored', async () => {
    const texts = new Map([['wiki/00_state.md', '# State\n']])
    await withStore(texts, ['wiki/00_state.md'], async ({ fake }) => {
      fake.emit({ kind: 'file', dir: '/other', path: 'wiki/00_state.md' })
      await fake.settle()
      expect(fake.reads).toHaveLength(1)
    })
  })

  test('an out-of-order reply never overwrites a newer read', async () => {
    const texts = new Map([['wiki/00_state.md', 'first\n']])
    const releases: (() => void)[] = []
    await withStore(texts, [], async ({ store, fake, setProject }) => {
      // Both reads are held open, then released oldest-last: without the ticket
      // the stale answer would land last and win.
      fake.gate = () => new Promise<void>((resolve) => releases.push(resolve))
      setProject(snapshot(['wiki/00_state.md']))
      await fake.settle()
      texts.set('wiki/00_state.md', 'second\n')
      fake.emit({ kind: 'file', dir: '/p', path: 'wiki/00_state.md' })
      await fake.settle()
      expect(releases).toHaveLength(2)

      releases[1]?.()
      await fake.settle()
      releases[0]?.()
      await fake.settle()
      expect(store.get('wiki/00_state.md')?.text).toBe('second\n')
    })
  })

  test('backlinks and link resolution follow the files that are loaded', async () => {
    const texts = new Map([
      ['wiki/00_state.md', '# State\n\nsee [[02_arch]] and [[ghost]]\n'],
      ['wiki/02_arch.md', '# Arch\n'],
    ])
    await withStore(texts, [...texts.keys()], async ({ store }) => {
      expect(store.resolve('02_arch')).toEqual({ status: 'resolved', path: 'wiki/02_arch.md' })
      expect(store.resolve('ghost')).toEqual({ status: 'unresolved' })
      expect(store.backlinksTo('wiki/02_arch.md')).toEqual([
        { from: 'wiki/00_state.md', line: 3, label: undefined },
      ])
      expect(store.backlinksTo('wiki/00_state.md')).toEqual([])
      await Promise.resolve()
    })
  })

  describe('failure paths', () => {
    test('a refused read is reported as a sentence and cleared by a later success', async () => {
      const texts = new Map([['wiki/00_state.md', '# State\n']])
      await withStore(texts, [], async ({ store, fake, setProject }) => {
        fake.fail = { kind: 'not-found' }
        setProject(snapshot(['wiki/00_state.md']))
        await fake.settle()
        expect(store.failure('wiki/00_state.md')).toBe('That file is no longer there.')

        fake.fail = undefined
        fake.emit({ kind: 'file', dir: '/p', path: 'wiki/00_state.md' })
        await fake.settle()
        expect(store.failure('wiki/00_state.md')).toBeUndefined()
        expect(store.get('wiki/00_state.md')?.text).toBe('# State\n')
      })
    })

    test('a rejected read says so instead of leaving a blank pane', async () => {
      const texts = new Map([['wiki/00_state.md', '# State\n']])
      await withStore(texts, [], async ({ store, fake, setProject }) => {
        fake.reject = true
        setProject(snapshot(['wiki/00_state.md']))
        await fake.settle()
        expect(store.failure('wiki/00_state.md')).toContain('could not reach')
        expect(store.get('wiki/00_state.md')).toBeUndefined()
      })
    })

    test('a failed re-read drops the body it can no longer vouch for', async () => {
      const texts = new Map([['wiki/00_state.md', '# State\n']])
      await withStore(texts, ['wiki/00_state.md'], async ({ store, fake }) => {
        expect(store.get('wiki/00_state.md')?.text).toBe('# State\n')
        fake.fail = { kind: 'not-found' }
        fake.emit({ kind: 'file', dir: '/p', path: 'wiki/00_state.md' })
        await fake.settle()
        // Otherwise the pane shows a failure banner over bytes that are not on
        // disk, presented as the note.
        expect(store.get('wiki/00_state.md')).toBeUndefined()
        expect(store.failure('wiki/00_state.md')).toBe('That file is no longer there.')
      })
    })
  })

  describe('files that move while a read is in flight', () => {
    test('a reply for a file that left the project is discarded', async () => {
      const texts = new Map([['wiki/00_state.md', '# State\n']])
      const releases: (() => void)[] = []
      await withStore(texts, [], async ({ store, fake, setProject }) => {
        fake.gate = () => new Promise<void>((resolve) => releases.push(resolve))
        setProject(snapshot(['wiki/00_state.md']))
        await fake.settle()
        setProject(snapshot([]))
        await fake.settle()
        releases[0]?.()
        await fake.settle()
        expect(store.get('wiki/00_state.md')).toBeUndefined()
      })
    })

    test('a file deleted and re-created mid-flight is read again', async () => {
      const texts = new Map([['wiki/00_state.md', 'first\n']])
      const releases: (() => void)[] = []
      await withStore(texts, [], async ({ store, fake, setProject }) => {
        fake.gate = () => new Promise<void>((resolve) => releases.push(resolve))
        setProject(snapshot(['wiki/00_state.md']))
        await fake.settle()
        setProject(snapshot([]))
        await fake.settle()
        texts.set('wiki/00_state.md', 'second\n')
        setProject(snapshot(['wiki/00_state.md']))
        await fake.settle()
        expect(fake.reads).toHaveLength(2)

        // The first read answers last, with bytes that are two edits old.
        releases[1]?.()
        releases[0]?.()
        await fake.settle()
        expect(store.get('wiki/00_state.md')?.text).toBe('second\n')
      })
    })

    test('a watcher event naming a path the project does not list is ignored', async () => {
      const texts = new Map([['wiki/00_state.md', '# State\n']])
      await withStore(texts, ['wiki/00_state.md'], async ({ fake }) => {
        fake.emit({ kind: 'file', dir: '/p', path: '../outside.md' })
        await fake.settle()
        expect(fake.reads).toEqual(['wiki/00_state.md'])
      })
    })

    test('a listener stops firing once the window is disposed', async () => {
      const texts = new Map([['wiki/00_state.md', '# State\n']])
      const fake = fakeApi(texts)
      const [project] = createSignal(snapshot(['wiki/00_state.md']))
      const dispose = createRoot((disposer) => {
        createNoteStore(fake.api, project)
        return disposer
      })
      await fake.settle()
      dispose()
      fake.emit({ kind: 'file', dir: '/p', path: 'wiki/00_state.md' })
      await fake.settle()
      expect(fake.reads).toHaveLength(1)
    })
  })
})
