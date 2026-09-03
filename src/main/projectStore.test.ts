/**
 * The projects the app remembers, and the two rules that keep the file honest: a
 * file it could not read is moved aside rather than overwritten, and concurrent
 * writes do not interleave.
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { hueForPath, isPaletteHue } from '@core/hue.js'
import { createProjectStore, decodeStore, encodeStore, STORE_VERSION } from './projectStore.js'

const entry = (dir: string, hue: number, lastOpenedMs: number): string =>
  JSON.stringify({ version: STORE_VERSION, projects: [{ dir, hue, lastOpenedMs }] })

describe('decodeStore', () => {
  test('reads a well-formed file', () => {
    expect(decodeStore(entry('/p/a', 226, 5))).toEqual([{ dir: '/p/a', name: 'a', hue: 226, lastOpenedMs: 5 }])
  })

  // Losing a hue is an annoyance; refusing to start is not an option, so every
  // unusable shape decodes to "no projects yet" rather than throwing.
  test.each([
    ['', 'an empty file'],
    ['not json at all', 'garbage'],
    ['null', 'a null document'],
    ['[]', 'an array where an object belongs'],
    ['{"version":99,"projects":[]}', 'a version from the future'],
    ['{"projects":[]}', 'a file with no version'],
    [JSON.stringify({ version: STORE_VERSION, projects: [{ dir: '/p/a' }] }), 'an entry missing fields'],
    [JSON.stringify({ version: STORE_VERSION, projects: [{ dir: 4, hue: 1, lastOpenedMs: 1 }] }), 'a dir that is not a string'],
  ])('refuses %s (%s)', (text, _why: string) => {
    expect(decodeStore(text)).toEqual([])
  })

  test('a hue that is not on the palette falls back to the path hue', () => {
    const [project] = decodeStore(entry('/p/a', 41, 5))
    expect(project?.hue).toBe(hueForPath('/p/a'))
    expect(isPaletteHue(project?.hue ?? -1)).toBe(true)
  })
})

describe('encodeStore', () => {
  test('round-trips through decodeStore', () => {
    const projects = [{ dir: '/p/a', name: 'a', hue: 226, lastOpenedMs: 2 }]
    expect(decodeStore(encodeStore(projects))).toEqual(projects)
  })

  test('writes newest first, so the picker is', () => {
    const text = encodeStore([
      { dir: '/p/old', name: 'old', hue: 226, lastOpenedMs: 1 },
      { dir: '/p/new', name: 'new', hue: 265, lastOpenedMs: 9 },
    ])
    expect(decodeStore(text).map((p) => p.dir)).toEqual(['/p/new', '/p/old'])
  })

  test('the name is derived, not stored: it always follows the directory', () => {
    expect(JSON.parse(encodeStore([{ dir: '/p/a', name: 'stale', hue: 226, lastOpenedMs: 1 }]))).toEqual({
      version: STORE_VERSION,
      projects: [{ dir: '/p/a', hue: 226, lastOpenedMs: 1 }],
    })
  })
})

describe('createProjectStore', () => {
  let path = ''
  beforeEach(async () => {
    path = join(await mkdtemp(join(tmpdir(), 'wikiviewer-store-')), 'projects.json')
  })

  test('a missing file is an empty store, not a failure', async () => {
    const store = await createProjectStore(path)
    expect(store.list()).toEqual([])
  })

  test('the first open assigns the path hue and persists', async () => {
    const store = await createProjectStore(path)
    const summary = await store.remember('/p/a', 100)

    expect(summary).toEqual({ dir: '/p/a', name: 'a', hue: hueForPath('/p/a'), lastOpenedMs: 100 })
    expect(decodeStore(await readFile(path, 'utf8'))).toEqual([summary])
  })

  test('a second open keeps the hue the project already owns', async () => {
    const store = await createProjectStore(path)
    await store.remember('/p/a', 100)
    await store.setHue('/p/a', 330)

    expect((await store.remember('/p/a', 200)).hue).toBe(330)
    expect(store.list()).toHaveLength(1)
  })

  test('setHue on a project that was never opened changes nothing', async () => {
    const store = await createProjectStore(path)
    expect(await store.setHue('/p/unknown', 330)).toBeUndefined()
    expect(store.list()).toEqual([])
  })

  test('a store written by one instance is read by the next', async () => {
    const first = await createProjectStore(path)
    await first.remember('/p/a', 100)

    expect((await createProjectStore(path)).list()).toEqual(first.list())
  })

  test('a corrupt file on disk starts empty rather than throwing', async () => {
    await writeFile(path, '{ half a document', 'utf8')
    await expect(createProjectStore(path).then((store) => store.list())).resolves.toEqual([])
  })

  // An unreadable file may be the store of a *newer* app: it is moved aside on
  // the first write, never silently overwritten.
  test('a file it could not read is kept, not destroyed', async () => {
    await writeFile(path, JSON.stringify({ version: 99, projects: [{ dir: '/p/a', hue: 226, lastOpenedMs: 1 }] }))
    const store = await createProjectStore(path)
    await store.remember('/p/b', 1)

    expect(JSON.parse(await readFile(`${path}.unreadable`, 'utf8'))).toMatchObject({ version: 99 })
    expect(decodeStore(await readFile(path, 'utf8')).map((p) => p.dir)).toEqual(['/p/b'])
  })

  test('a valid but empty store is overwritten in place, not moved aside', async () => {
    await writeFile(path, encodeStore([]), 'utf8')
    const store = await createProjectStore(path)
    await store.remember('/p/a', 1)

    await expect(readFile(`${path}.unreadable`, 'utf8')).rejects.toThrow()
  })

  // Two windows changing an accent at the same moment shared one temp file, and
  // the loser's `rename` failed with ENOENT — which surfaced as a broadcast that
  // never happened, so no window repaints.
  test('concurrent writes all succeed and the last one is on disk', async () => {
    const store = await createProjectStore(path)
    await store.remember('/p/a', 1)

    const results = await Promise.allSettled([
      store.setHue('/p/a', 226),
      store.setHue('/p/a', 265),
      store.remember('/p/b', 2),
    ])

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled'])
    expect(decodeStore(await readFile(path, 'utf8')).map((p) => p.dir).sort()).toEqual(['/p/a', '/p/b'])
  })
})
