/**
 * The exporter, over a throwaway project: what lands in the zip, what never
 * does, and what happens when the reader closes the dialog.
 */

import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { beforeEach, describe, expect, test } from 'vitest'
import type { ExportScope, Layout } from '@shared/api.js'
import { exportWiki, zipTime, type SaveDialog } from './export.js'
import { listWikiFiles } from './files.js'

const layout: Layout = { wikiRoot: 'wiki/', journal: 'notes/', kind: 'software' }

/**
 * One register with bytes that are **not** valid utf-8 (a lone 0x80), so a
 * bundle built by decoding and re-encoding is assertably different from one
 * that copies.
 */
const RAW = Buffer.from([0x64, 0x65, 0x63, 0x69, 0x64, 0x65, 0x64, 0x3a, 0x20, 0x80, 0x0a])

/** A known instant inside what a zip can represent, for the mtime assertions. */
const TOUCHED = Date.UTC(2026, 4, 17, 9, 30, 0)

const makeProject = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'inchworm-export-'))
  await mkdir(join(root, 'wiki/archive'), { recursive: true })
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'CLAUDE.md'), '- Wiki root: wiki/\n', 'utf8')
  await writeFile(join(root, 'README.md'), 'not memory\n', 'utf8')
  await writeFile(join(root, 'wiki/00_state.md'), '# state\n', 'utf8')
  await writeFile(join(root, 'wiki/01_scope.md'), '# scope\n', 'utf8')
  await writeFile(join(root, 'wiki/decisions.md'), RAW)
  // A file the schema has no name for. `classify` calls it `other`, and the
  // `everything` scope carries it anyway — that is the point of the scope.
  await writeFile(join(root, 'wiki/wikilog.md'), '# wikilog\n', 'utf8')
  await writeFile(join(root, 'wiki/archive/01_old.md'), '# old\n', 'utf8')
  await writeFile(join(root, 'notes/2026-08-19_kickoff.md'), '# kickoff\n', 'utf8')
  return root
}

let root = ''
let destination = ''
beforeEach(async () => {
  if (root !== '') await rm(root, { recursive: true, force: true })
  root = await makeProject()
  destination = join(root, 'bundle.zip')
})

/** The dialog, recording what it was offered and answering with a fixed path. */
const dialog = (
  answer: string | undefined,
): { readonly save: SaveDialog; readonly asked: string[]; readonly owners: (number | undefined)[] } => {
  const asked: string[] = []
  const owners: (number | undefined)[] = []
  return {
    asked,
    owners,
    save: (suggestedName: string, windowId: number | undefined) => {
      asked.push(suggestedName)
      owners.push(windowId)
      return Promise.resolve(answer)
    },
  }
}

const run = async (scope: ExportScope, save: SaveDialog, name = 'Sample'): ReturnType<typeof exportWiki> =>
  exportWiki(
    { dir: root, name, layout, files: await listWikiFiles(root, layout), scope, date: '2026-09-19', windowId: 7 },
    save,
  )

/** The zip as a map of entry name to bytes. */
const openBundle = async (path: string): Promise<Record<string, Uint8Array>> =>
  unzipSync(new Uint8Array(await readFile(path)))

describe('the whole wiki', () => {
  test('carries every file under the wiki root and the journal, under one folder', async () => {
    const { save } = dialog(destination)
    const result = await run('everything', save)
    expect(result.ok && result.value.kind === 'saved').toBe(true)
    expect(Object.keys(await openBundle(destination)).sort()).toEqual([
      'sample-wiki-2026-09-19/inchworm-export.md',
      'sample-wiki-2026-09-19/notes/2026-08-19_kickoff.md',
      'sample-wiki-2026-09-19/wiki/00_state.md',
      'sample-wiki-2026-09-19/wiki/01_scope.md',
      'sample-wiki-2026-09-19/wiki/archive/01_old.md',
      'sample-wiki-2026-09-19/wiki/decisions.md',
      'sample-wiki-2026-09-19/wiki/wikilog.md',
    ])
  })

  // The app never rewrites a byte the reader did not type — and an export is
  // still the app writing. A decode-and-re-encode would turn the lone 0x80 into
  // U+FFFD, which is three bytes and not the ones on disk.
  test('copies bytes rather than re-encoding them', async () => {
    const { save } = dialog(destination)
    await run('everything', save)
    const entry = (await openBundle(destination))['sample-wiki-2026-09-19/wiki/decisions.md']
    expect(Buffer.from(entry ?? new Uint8Array()).equals(RAW)).toBe(true)
  })

  test('reports how many files it wrote, where, and how big the file actually is', async () => {
    const { save } = dialog(destination)
    const result = await run('everything', save)
    expect(result).toMatchObject({ ok: true, value: { kind: 'saved', path: destination, files: 6 } })
    // Reported from the bytes written, not from their uncompressed total.
    const onDisk = (await readFile(destination)).byteLength
    expect(result.ok && result.value.kind === 'saved' && result.value.bytes).toBe(onDisk)
  })

  test('the dialog hangs off the window that asked', async () => {
    const { save, owners } = dialog(destination)
    await run('everything', save)
    expect(owners).toEqual([7])
  })
})

describe('the curated bundle', () => {
  test('drops the journal, the archive and what the schema does not name', async () => {
    const { save, asked } = dialog(destination)
    await run('curated', save)
    expect(asked).toEqual(['sample-notes-2026-09-19.zip'])
    expect(Object.keys(await openBundle(destination)).sort()).toEqual([
      'sample-notes-2026-09-19/inchworm-export.md',
      'sample-notes-2026-09-19/wiki/00_state.md',
      'sample-notes-2026-09-19/wiki/01_scope.md',
      'sample-notes-2026-09-19/wiki/decisions.md',
      'sample-notes-2026-09-19/wiki/wikilog.md',
    ])
  })
})

describe('timestamps', () => {
  /*
   * The claim is that each entry carries its file's own mtime rather than the
   * moment it was packed. Stated as reproducibility, which is what it buys and
   * what a reader can check: two exports of an unchanged wiki are byte-for-byte
   * the same file. Stamping with `Date.now()` breaks this within a second.
   */
  test('two exports of an unchanged wiki are the same bytes', async () => {
    await utimes(join(root, 'wiki/00_state.md'), new Date(TOUCHED), new Date(TOUCHED))
    const second = join(root, 'again.zip')
    await run('everything', dialog(destination).save)
    await run('everything', dialog(second).save)
    expect((await readFile(destination)).equals(await readFile(second))).toBe(true)
  })

  // A zip cannot represent a date outside 1980–2099 and `zipSync` throws rather
  // than clamping. A note restored from a tarball carries an epoch mtime often
  // enough, and one of those used to fail the whole bundle — reported as
  // `unwritable`, which blamed a destination that was fine.
  test('a note whose mtime a zip cannot hold is still exported', async () => {
    await utimes(join(root, 'wiki/00_state.md'), new Date(0), new Date(0))
    const { save } = dialog(destination)
    const result = await run('everything', save)
    expect(result).toMatchObject({ ok: true, value: { kind: 'saved' } })
    expect(Object.keys(await openBundle(destination))).toContain('sample-wiki-2026-09-19/wiki/00_state.md')
  })

  test('zipTime clamps to what a zip can hold, and survives a nonsense value', () => {
    expect(zipTime(0)).toBeGreaterThan(Date.UTC(1979, 11, 31))
    expect(zipTime(Date.UTC(2200, 0, 1))).toBeLessThan(Date.UTC(2100, 0, 1))
    expect(zipTime(TOUCHED)).toBe(TOUCHED)
    expect(Number.isFinite(zipTime(Number.NaN))).toBe(true)
  })
})

describe('what never reaches a bundle', () => {
  // `exportPlan` decides from the layout, so the agent file and a source file
  // are not in the zip even though `listWikiFiles` lists the first of them.
  test('the agent file and everything outside the wiki root and journal', async () => {
    const { save } = dialog(destination)
    await run('everything', save)
    const names = Object.keys(await openBundle(destination))
    expect(names.some((name) => name.endsWith('CLAUDE.md'))).toBe(false)
    expect(names.some((name) => name.endsWith('README.md'))).toBe(false)
  })

  // The plan drops this one, so the read layer is never asked.
  test('a path outside the project, however it got into the list', async () => {
    const { save } = dialog(destination)
    const result = await exportWiki(
      {
        dir: root,
        name: 'Sample',
        layout,
        files: ['../../etc/passwd', '.git/config', 'wiki/00_state.md'],
        scope: 'everything',
        date: '2026-09-19',
        windowId: 1,
      },
      save,
    )
    expect(result.ok).toBe(true)
    expect(Object.keys(await openBundle(destination)).sort()).toEqual([
      'sample-wiki-2026-09-19/inchworm-export.md',
      'sample-wiki-2026-09-19/wiki/00_state.md',
    ])
  })

  /*
   * Containment in depth, and the three layers are separate claims.
   * `listWikiFiles` never lists a symlink at all; the plan refuses a path that
   * would be a dangerous zip entry; and `readWikiBytes` refuses one that
   * resolves outside the project even when it was handed over directly. The
   * last is this module's own claim — that the bundle goes through the same
   * four checks as the editor — and only a hand-built file list can reach it.
   */
  test('a symlinked wiki file is never even listed', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'inchworm-secret-'))
    await writeFile(join(outside, 'secret.md'), 'private\n', 'utf8')
    await symlink(join(outside, 'secret.md'), join(root, 'wiki/02_link.md'))
    expect(await listWikiFiles(root, layout)).not.toContain('wiki/02_link.md')
    await rm(outside, { recursive: true, force: true })
  })

  test('a symlink out of the project is refused by the read even if it reaches the plan', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'inchworm-secret-'))
    await writeFile(join(outside, 'secret.md'), 'private\n', 'utf8')
    await symlink(join(outside, 'secret.md'), join(root, 'wiki/02_link.md'))
    const { save } = dialog(destination)
    const result = await exportWiki(
      {
        dir: root,
        name: 'Sample',
        layout,
        files: ['wiki/02_link.md'],
        scope: 'everything',
        date: '2026-09-19',
        windowId: 1,
      },
      save,
    )
    expect(result).toMatchObject({ ok: false, error: { kind: 'unreadable' } })
    expect(!result.ok && result.error.kind === 'unreadable' && result.error.detail).toContain('outside-project')
    await expect(readFile(destination)).rejects.toThrow()
    await rm(outside, { recursive: true, force: true })
  })

  // `wiki/archive/` accepts any filename, so a traversal spelled through it
  // used to reach the read. The plan now refuses it, and no dialog opens.
  test('a traversal through the archive never reaches the read', async () => {
    const { save, asked } = dialog(destination)
    const result = await exportWiki(
      {
        dir: root,
        name: 'Sample',
        layout,
        files: ['wiki/archive/x/../../../../../etc/passwd'],
        scope: 'everything',
        date: '2026-09-19',
        windowId: 1,
      },
      save,
    )
    expect(result).toEqual({ ok: false, error: { kind: 'empty' } })
    expect(asked).toEqual([])
  })
})

describe('the ways out', () => {
  test('a closed dialog writes nothing and is not a failure', async () => {
    const { save, asked } = dialog(undefined)
    const result = await run('everything', save)
    expect(result).toEqual({ ok: true, value: { kind: 'cancelled' } })
    expect(asked).toEqual(['sample-wiki-2026-09-19.zip'])
    await expect(readFile(destination)).rejects.toThrow()
  })

  // Refused before a dialog opens: asking where to put a bundle and then
  // saying there is nothing to put in it is the wrong order to find out.
  test('a scope that matches nothing never opens the dialog', async () => {
    const { save, asked } = dialog(destination)
    const result = await exportWiki(
      { dir: root, name: 'Sample', layout, files: ['CLAUDE.md'], scope: 'curated', date: '2026-09-19', windowId: 1 },
      save,
    )
    expect(result).toEqual({ ok: false, error: { kind: 'empty' } })
    expect(asked).toEqual([])
  })

  test('a file that vanished between the list and the read names itself, and nothing is written', async () => {
    const { save } = dialog(destination)
    const files = await listWikiFiles(root, layout)
    await rm(join(root, 'wiki/01_scope.md'))
    const result = await exportWiki(
      { dir: root, name: 'Sample', layout, files, scope: 'everything', date: '2026-09-19', windowId: 1 },
      save,
    )
    expect(result).toMatchObject({ ok: false, error: { kind: 'unreadable' } })
    expect(!result.ok && result.error.kind === 'unreadable' && result.error.detail).toContain('wiki/01_scope.md')
    await expect(readFile(destination)).rejects.toThrow()
  })

  test('a destination that cannot be written comes back as itself', async () => {
    const { save } = dialog(join(root, 'no-such-folder', 'bundle.zip'))
    const result = await run('everything', save)
    expect(result).toMatchObject({ ok: false, error: { kind: 'unwritable' } })
  })

  test('exporting over an earlier bundle replaces it', async () => {
    await writeFile(destination, 'last week\n', 'utf8')
    const { save } = dialog(destination)
    await run('curated', save)
    expect(Object.keys(await openBundle(destination))).toContain('sample-notes-2026-09-19/wiki/00_state.md')
  })

  // The write is a temp file and a rename, so a destination that refuses the
  // rename leaves whatever was there untouched rather than truncated.
  test('a write that cannot land leaves what was there alone, and no stray temp file', async () => {
    const asDirectory = join(root, 'held.zip')
    await mkdir(asDirectory)
    await writeFile(join(asDirectory, 'inside.txt'), 'still here\n', 'utf8')
    const { save } = dialog(asDirectory)
    const result = await run('everything', save)
    expect(result).toMatchObject({ ok: false, error: { kind: 'unwritable' } })
    expect(await readFile(join(asDirectory, 'inside.txt'), 'utf8')).toBe('still here\n')
    const strays = (await listWikiFiles(root, layout)).filter((path) => path.includes('.tmp'))
    expect(strays).toEqual([])
  })
})

describe('the manifest', () => {
  test('is at the root of the bundle and lists what is in it', async () => {
    const { save } = dialog(destination)
    await run('curated', save)
    const entry = (await openBundle(destination))['sample-notes-2026-09-19/inchworm-export.md']
    const text = Buffer.from(entry ?? new Uint8Array()).toString('utf8')
    expect(text).toContain('# Sample — llmwiki export')
    expect(text).toContain('- `wiki/00_state.md`')
    expect(text).not.toContain('- `notes/2026-08-19_kickoff.md`')
  })
})
