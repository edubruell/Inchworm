/**
 * `core` over the fixture of everything `sample-wiki` deliberately is not:
 * malformed frontmatter, cap boundaries, CRLF, BOM, sub-folders, dates that are
 * not days, and CLAUDE.md blocks that must be refused
 * (`tests/fixtures/edge-cases/README.md`).
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, test } from 'vitest'
import { capFor, capStatus } from '@core/caps.js'
import { classify } from '@core/classify.js'
import { buildNavigation } from '@core/navigation.js'
import { parseNote } from '@core/note.js'
import { expectParsed } from './support/parsed.js'
import { parseClaudeBlock } from '@core/project.js'
import type { ProjectLayout } from '@core/project.js'

const ROOT = join(import.meta.dirname, 'fixtures/edge-cases')

const listFiles = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? listFiles(full) : [relative(ROOT, full).split(sep).join('/')]
  })

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')
const w = (name: string): string => `local_context/wiki/${name}`
const j = (name: string): string => `local_context/notes/${name}`

const claude = parseClaudeBlock(read('CLAUDE.md'))
if (!claude.ok) throw new Error('the edge-case CLAUDE.md must still carry a usable project block')
const layout: ProjectLayout = claude.value

const paths = listFiles(ROOT)
const kindOf = (path: string): string => classify(path, layout).kind
const noteAt = (path: string): ReturnType<typeof parseNote> => parseNote(read(path))
/** The same read, narrowed: every fixture file is within the parse budget. */
const parsedAt = (path: string): ReturnType<typeof expectParsed> => expectParsed(noteAt(path))
const capAt = (path: string): ReturnType<typeof capStatus> =>
  capStatus(noteAt(path).lineCount, capFor(classify(path, layout)))

describe('a CLAUDE.md that illustrates the block before declaring it', () => {
  test('the real block wins over the fenced example', () => {
    expect(layout).toEqual({ wikiRoot: 'local_context/wiki/', journal: 'local_context/notes/', kind: 'software' })
  })
})

describe('cap boundaries, at file level', () => {
  test('a register of exactly 100 lines is at its cap, not over it', () => {
    expect(capAt(w('tried.md'))).toEqual({ kind: 'near', lines: 100, cap: 100, fraction: 1 })
  })

  test('a state file of exactly 60 lines is at its cap, not over it', () => {
    expect(capAt(w('00_state.md'))).toEqual({ kind: 'near', lines: 60, cap: 60, fraction: 1 })
  })

  test('an empty file is zero lines, not one', () => {
    expect(noteAt(w('10_empty.md')).lineCount).toBe(0)
  })
})

describe('frontmatter states over real files', () => {
  test('05_broken.md is invalid — the state the sample wiki has no file for', () => {
    expect(parsedAt(w('05_broken.md')).frontmatter).toMatchObject({ kind: 'invalid' })
  })

  test('an empty `---/---` block is a placeholder, not a break', () => {
    expect(parsedAt(w('06_empty_header.md')).frontmatter).toEqual({
      kind: 'parsed',
      fields: { status: undefined, updated: undefined, links: [], covers: [] },
    })
  })

  test('a journal entry carries session-log frontmatter and no status', () => {
    const frontmatter = parsedAt(j('2026-08-19_session.md')).frontmatter
    expect(frontmatter).toMatchObject({ kind: 'parsed', fields: { status: undefined } })
  })

  test('a file with no frontmatter at all is absent, not invalid', () => {
    expect(parsedAt(w('10_empty.md')).frontmatter).toEqual({ kind: 'absent' })
  })
})

describe('bytes the parser must not trip over', () => {
  test('CRLF frontmatter parses, and its links are found', () => {
    const note = parsedAt(w('07_crlf.md'))
    expect(note.frontmatter).toMatchObject({ kind: 'parsed', fields: { status: { kind: 'active' } } })
    expect(note.links.map((link) => link.target)).toEqual(['06_empty_header'])
  })

  test('CRLF line counts match what a reader sees', () => {
    expect(noteAt(w('07_crlf.md')).lineCount).toBe(8)
  })

  test('a leading BOM does not hide the frontmatter', () => {
    expect(parsedAt(w('08_bom.md')).frontmatter).toMatchObject({ kind: 'parsed', fields: { status: { kind: 'active' } } })
  })
})

describe('paths that look like schema and are not', () => {
  test.each([
    ['a note in a wiki sub-folder', w('drafts/09_draft.md')],
    ['a journal entry in a sub-directory', j('sub/2026-08-19_nested.md')],
    ['a date-shaped name that is not a day', j('2026-02-30_notaday.md')],
    ['a non-markdown file', 'assets/diagram.txt'],
    ["the fixture's own README", 'README.md'],
  ])('%s is other', (_label, path) => {
    expect(kindOf(path)).toBe('other')
  })

  test('an archived register overflow is archive, not a register', () => {
    expect(kindOf(w('archive/decisions_2026-08.md'))).toBe('archive')
  })

  test('none of them reach the sidebar', () => {
    const shown = buildNavigation(paths, layout).flatMap((group) => group.entries.map((entry) => entry.path))
    for (const path of [w('drafts/09_draft.md'), j('sub/2026-08-19_nested.md'), 'assets/diagram.txt']) {
      expect(shown).not.toContain(path)
    }
  })
})

describe('CLAUDE.md blocks that must be refused, as whole files', () => {
  const errorFor = (project: string): string => {
    const parsed = parseClaudeBlock(readFileSync(join(import.meta.dirname, 'fixtures/broken-projects', project, 'CLAUDE.md'), 'utf8'))
    return parsed.ok ? 'accepted' : parsed.error.kind
  }

  test.each([
    ['no-block', 'no-wiki-root'],
    ['empty-value', 'no-wiki-root'],
    ['fenced-only', 'no-wiki-root'],
    ['absolute-root', 'unsafe-root'],
    ['escaping-root', 'unsafe-root'],
  ])('%s is refused with %s', (project, expected) => {
    expect(errorFor(project)).toBe(expected)
  })
})
