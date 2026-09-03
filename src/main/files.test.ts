/** A throwaway project: two watched directories, one file outside them both. */

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import type { Layout } from '@shared/api.js'
import { MAX_FILE_BYTES } from '@shared/api.js'
import { listWikiFiles, readWikiFile, watchTargets, writeWikiFile } from './files.js'

const layout: Layout = { wikiRoot: 'wiki/', journal: 'notes/', kind: 'software' }

const makeProject = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'wikiviewer-files-'))
  await mkdir(join(root, 'wiki'), { recursive: true })
  await mkdir(join(root, 'notes'), { recursive: true })
  await mkdir(join(root, 'wiki/archive'), { recursive: true })
  await writeFile(join(root, 'CLAUDE.md'), '- Wiki root: wiki/\n', 'utf8')
  await writeFile(join(root, 'wiki/00_state.md'), 'state\n', 'utf8')
  await writeFile(join(root, 'wiki/archive/01_old.md'), 'old\n', 'utf8')
  await writeFile(join(root, 'wiki/.hidden.md'), 'hidden\n', 'utf8')
  await mkdir(join(root, 'wiki/.git'), { recursive: true })
  await writeFile(join(root, 'wiki/.git/config'), '[core]\n', 'utf8')
  await writeFile(join(root, 'notes/2026-08-19_x.md'), 'journal\n', 'utf8')
  await writeFile(join(root, 'src.ts'), 'code\n', 'utf8')
  return root
}

let root = ''
beforeEach(async () => {
  root = await makeProject()
})

describe('listWikiFiles', () => {
  test('lists the wiki, the journal and CLAUDE.md — and nothing else', async () => {
    expect(await listWikiFiles(root, layout)).toEqual([
      'CLAUDE.md',
      'notes/2026-08-19_x.md',
      'wiki/00_state.md',
      'wiki/archive/01_old.md',
    ])
  })

  // `recursive: true` reports the *leaf* name, so filtering on it lists every
  // file inside `.git/` while hiding only the dotfiles at the top.
  test('nothing under a dotted directory is listed', async () => {
    expect(await listWikiFiles(root, layout)).not.toContain('wiki/.git/config')
  })

  test('a journal nested inside the wiki root lists each file once', async () => {
    const nested = { ...layout, journal: 'wiki/' }
    const files = await listWikiFiles(root, nested)
    expect(files).toEqual([...new Set(files)])
  })

  test('an AGENTS.md project lists its own agent file, not a CLAUDE.md it has not got', async () => {
    await writeFile(join(root, 'AGENTS.md'), '# agents\n', 'utf8')
    await rm(join(root, 'CLAUDE.md'))

    expect(await listWikiFiles(root, layout)).toContain('AGENTS.md')
    expect(await listWikiFiles(root, layout)).not.toContain('CLAUDE.md')
  })

  test('a project whose journal directory does not exist yet is still a project', async () => {
    expect(await listWikiFiles(root, { ...layout, journal: 'nowhere/' })).not.toContain('notes/2026-08-19_x.md')
  })
})

describe('watchTargets', () => {
  test('covers exactly what listWikiFiles reads, both agent spellings included', () => {
    // Both, unconditionally: a project that gains an `AGENTS.md` after the
    // watcher started must still see it appear.
    expect(watchTargets(root, layout)).toEqual([
      join(root, 'CLAUDE.md'),
      join(root, 'AGENTS.md'),
      join(root, 'wiki/'),
      join(root, 'notes/'),
    ])
  })
})

describe('readWikiFile', () => {
  test('returns the text with a stamp', async () => {
    const result = await readWikiFile(root, layout, 'wiki/00_state.md')
    expect(result.ok && result.value.text).toBe('state\n')
    expect(result.ok && result.value.sha).toMatch(/^[0-9a-f]{64}$/)
  })

  test('the sha is over the bytes, so two reads of an unchanged file agree', async () => {
    const first = await readWikiFile(root, layout, 'wiki/00_state.md')
    const second = await readWikiFile(root, layout, 'wiki/00_state.md')
    expect(first.ok && second.ok && first.value.sha).toBe(second.ok ? second.value.sha : '')
  })

  test.each([
    ['../../../etc/hosts', 'outside-project'],
    ['/etc/hosts', 'outside-project'],
    ['wiki/nothing.md', 'not-found'],
    // A directory is not a file the app reads, and the wiki root is not itself
    // *in* the wiki: both are refused before any `stat`.
    ['wiki', 'outside-project'],
    ['package.json', 'outside-project'],
    ['.git/config', 'outside-project'],
  ])('%s fails as %s', async (path, kind) => {
    const result = await readWikiFile(root, layout, path)
    expect(result.ok ? 'ok' : result.error.kind).toBe(kind)
  })

  // The third containment check: a symlink that leaves the project is a path
  // that *spells* as inside and *lands* outside.
  test('refuses a symlink that points out of the project', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'wikiviewer-outside-'))
    await writeFile(join(outside, 'secret.md'), 'secret\n', 'utf8')
    await symlink(join(outside, 'secret.md'), join(root, 'wiki/escape.md'))

    const result = await readWikiFile(root, layout, 'wiki/escape.md')
    expect(result.ok ? 'ok' : result.error.kind).toBe('outside-project')
  })

  test('refuses a file over the size cap without reading it', async () => {
    await writeFile(join(root, 'wiki/huge.md'), 'x'.repeat(MAX_FILE_BYTES + 1), 'utf8')
    const result = await readWikiFile(root, layout, 'wiki/huge.md')
    expect(result.ok ? 'ok' : result.error.kind).toBe('too-large')
  })

  // The cap is a ceiling, not a limit one byte below it.
  test('a file of exactly the cap is still read', async () => {
    await writeFile(join(root, 'wiki/big.md'), 'x'.repeat(MAX_FILE_BYTES), 'utf8')
    expect((await readWikiFile(root, layout, 'wiki/big.md')).ok).toBe(true)
  })

  // The app never rewrites a byte the user did not type (CLAUDE.md hard rule):
  // a CRLF file with a BOM and no trailing newline must survive a round trip.
  test('reads and writes are byte-faithful: BOM, CRLF and no trailing newline', async () => {
    const bytes = Buffer.from('\uFEFF# title\r\n\r\n- a\r\n- b', 'utf8')
    await writeFile(join(root, 'wiki/02_crlf.md'), bytes)

    const read = await readWikiFile(root, layout, 'wiki/02_crlf.md')
    expect(read.ok).toBe(true)
    if (!read.ok) return
    await writeWikiFile(root, layout, { path: 'wiki/02_crlf.md', text: read.value.text, baseSha: read.value.sha })

    expect(await readFile(join(root, 'wiki/02_crlf.md'))).toEqual(bytes)
  })
})

describe('writeWikiFile', () => {
  const shaOf = async (path: string): Promise<string> => {
    const read = await readWikiFile(root, layout, path)
    return read.ok ? read.value.sha : ''
  }

  test('writes exactly the bytes given — no trailing newline, no reformatting', async () => {
    const baseSha = await shaOf('wiki/00_state.md')
    const result = await writeWikiFile(root, layout, { path: 'wiki/00_state.md', text: '# state', baseSha })

    expect(result.ok).toBe(true)
    expect(await readFile(join(root, 'wiki/00_state.md'), 'utf8')).toBe('# state')
  })

  // Both caps are byte caps, and this is the pair that says so: a document of
  // three-byte characters short enough to pass the write schema's code-unit
  // ceiling must still be refused, or the app writes a file it can never read
  // back (re-immersion 2026-09-02).
  test('the cap is bytes on the way in, as it is on the way out', async () => {
    const baseSha = await shaOf('wiki/00_state.md')
    const tooBig = '\u20AC'.repeat(MAX_FILE_BYTES / 2)
    expect(tooBig.length).toBeLessThan(MAX_FILE_BYTES)

    const refused = await writeWikiFile(root, layout, { path: 'wiki/00_state.md', text: tooBig, baseSha })
    expect(refused.ok ? undefined : refused.error.kind).toBe('too-large')
    expect(await readFile(join(root, 'wiki/00_state.md'), 'utf8')).not.toBe(tooBig)
  })

  // …and the other direction: three-byte characters just under the cap are a
  // legitimate note, not an attack, and must go through.
  test('a multi-byte document just under the cap is written', async () => {
    const baseSha = await shaOf('wiki/00_state.md')
    const fits = '\u20AC'.repeat(Math.floor(MAX_FILE_BYTES / 3))

    const written = await writeWikiFile(root, layout, { path: 'wiki/00_state.md', text: fits, baseSha })
    expect(written.ok).toBe(true)
  })

  test('a stale sha is a conflict, and the file on disk is untouched', async () => {
    const result = await writeWikiFile(root, layout, { path: 'wiki/00_state.md', text: 'clobbered', baseSha: 'stale' })

    expect(result.ok ? 'ok' : result.error.kind).toBe('conflict')
    expect(await readFile(join(root, 'wiki/00_state.md'), 'utf8')).toBe('state\n')
  })

  test('the conflict carries the sha on disk, so the renderer can offer the current text', async () => {
    const current = await shaOf('wiki/00_state.md')
    const result = await writeWikiFile(root, layout, { path: 'wiki/00_state.md', text: 'x', baseSha: 'stale' })
    expect(!result.ok && result.error.kind === 'conflict' && result.error.currentSha).toBe(current)
  })

  test('a new file is created only when the editor claims it did not exist', async () => {
    const created = await writeWikiFile(root, layout, { path: 'wiki/01_new.md', text: 'new\n', baseSha: '' })
    expect(created.ok).toBe(true)
    expect(await readFile(join(root, 'wiki/01_new.md'), 'utf8')).toBe('new\n')

    const collision = await writeWikiFile(root, layout, { path: 'wiki/01_new.md', text: 'again\n', baseSha: '' })
    expect(collision.ok ? 'ok' : collision.error.kind).toBe('conflict')
  })

  test('refuses to write outside the project', async () => {
    const result = await writeWikiFile(root, layout, { path: '../escaped.md', text: 'x', baseSha: '' })
    expect(result.ok ? 'ok' : result.error.kind).toBe('outside-project')
  })

  // Containment to the project *root* would leave the rest of the repository
  // writable to the renderer — a git hook is code that runs.
  test.each(['.git/hooks/post-commit', 'package.json', 'src/main.ts'])('refuses to write %s', async (path) => {
    const result = await writeWikiFile(root, layout, { path, text: 'pwned', baseSha: '' })
    expect(result.ok ? 'ok' : result.error.kind).toBe('outside-project')
  })

  test('a missing parent directory is not-found, not a stack trace', async () => {
    const result = await writeWikiFile(root, layout, { path: 'wiki/nested/deep/x.md', text: 'x', baseSha: '' })
    expect(result.ok ? 'ok' : result.error.kind).toBe('not-found')
  })
})
