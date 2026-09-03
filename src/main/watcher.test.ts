/**
 * The one module that cannot be tested without a real filesystem, and the one
 * the promise rests on: touching a file from a terminal updates every window on
 * the project within a second. It is also where the two path vocabularies meet — chokidar
 * reports absolute paths, the renderer holds the project-relative ones
 * `listWikiFiles` produced, and a mismatch means nothing ever repaints.
 */

import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { OpenProject } from './project.js'
import type { WatchChange } from './registry.js'
import { watchProject } from './watcher.js'

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const project = async (dir?: string): Promise<OpenProject> => {
  const root = dir ?? (await mkdtemp(join(tmpdir(), 'wikiviewer-watch-')))
  await mkdir(join(root, 'wiki'), { recursive: true })
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'wiki/00_state.md'), 'state\n', 'utf8')
  return { dir: root, layout: { wikiRoot: 'wiki/', journal: 'notes/', kind: 'software' } }
}

const stops: (() => void)[] = []
const watch = (open: OpenProject, seen: WatchChange[]): void => {
  stops.push(
    watchProject(open, (change) => {
      seen.push(change)
    }),
  )
}

afterEach(() => {
  for (const stop of stops.splice(0)) stop()
})

describe('watchProject', () => {
  test('a content change names the file in project-relative form', async () => {
    const open = await project()
    const seen: WatchChange[] = []
    watch(open, seen)
    await settle(300)

    await writeFile(join(open.dir, 'wiki/00_state.md'), 'edited\n', 'utf8')
    await settle(900)

    expect(seen).toContainEqual({ kind: 'file', path: 'wiki/00_state.md' })
  })

  // The save path does not write the target: it writes a dot-prefixed temp file
  // and renames it over. Every other window re-reads only on a `file` change,
  // so if a rename arrived as unlink+add instead, an in-app save would repaint
  // the writing window and leave the others stale — and the whole suite would
  // still be green, because every other case here writes in place. Pinned after
  // the re-immersion pass named it as the one assumption nothing tested
  // (2026-09-02).
  test('a save through temp-then-rename is a change, not a disappearance', async () => {
    const open = await project()
    const seen: WatchChange[] = []
    watch(open, seen)
    await settle(300)

    const target = join(open.dir, 'wiki/00_state.md')
    const temp = join(open.dir, 'wiki/.00_state.md.tmp')
    await writeFile(temp, 'renamed in\n', 'utf8')
    await rename(temp, target)
    await settle(900)

    expect(seen).toContainEqual({ kind: 'file', path: 'wiki/00_state.md' })
    expect(seen).not.toContainEqual({ kind: 'files' })
  })

  test('a burst of appearances coalesces into one rebuild', async () => {
    const open = await project()
    const seen: WatchChange[] = []
    watch(open, seen)
    await settle(300)

    await writeFile(join(open.dir, 'wiki/01_a.md'), 'a\n', 'utf8')
    await writeFile(join(open.dir, 'wiki/02_b.md'), 'b\n', 'utf8')
    await writeFile(join(open.dir, 'notes/2026-08-19_x.md'), 'x\n', 'utf8')
    await settle(900)

    expect(seen.filter((change) => change.kind === 'files')).toHaveLength(1)
  })

  test('a deletion is an appearance-class change, not a content change', async () => {
    const open = await project()
    const seen: WatchChange[] = []
    watch(open, seen)
    await settle(300)

    await rm(join(open.dir, 'wiki/00_state.md'))
    await settle(900)

    expect(seen).toContainEqual({ kind: 'files' })
  })

  // The regex used to be applied to the absolute path, so every project under a
  // dotted directory — `~/.claude/projects/x` — was watched and never reported.
  test('a project under a dotted directory is still watched', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'wikiviewer-dot-'))
    const open = await project(join(parent, '.dotted'))
    const seen: WatchChange[] = []
    watch(open, seen)
    await settle(300)

    await writeFile(join(open.dir, 'wiki/00_state.md'), 'edited\n', 'utf8')
    await settle(900)

    expect(seen).toContainEqual({ kind: 'file', path: 'wiki/00_state.md' })
  })

  test('nothing is reported after the watcher is stopped', async () => {
    const open = await project()
    const seen: WatchChange[] = []
    const stop = watchProject(open, (change) => {
      seen.push(change)
    })
    await settle(300)
    stop()

    await writeFile(join(open.dir, 'wiki/00_state.md'), 'edited\n', 'utf8')
    await settle(900)

    expect(seen).toEqual([])
  })
})
