import { describe, expect, test } from 'vitest'
import { MANIFEST_FILE, bundleStem, exportPlan, manifest } from './export.js'
import type { ProjectLayout } from './project.js'

const layout: ProjectLayout = { wikiRoot: 'local_context/wiki/', journal: 'local_context/notes/', kind: 'software' }

/** One of each kind `classify` knows, plus three it does not name. */
const FILES = [
  'CLAUDE.md',
  'README.md',
  'local_context/wiki/00_state.md',
  'local_context/wiki/01_scope.md',
  'local_context/wiki/decisions.md',
  // `wikilog.md` is written by the skill and is not in `schema.ts:REGISTERS`,
  // so `classify` calls it `other` — the file the kind-based plan used to drop.
  'local_context/wiki/wikilog.md',
  'local_context/wiki/decisions_table.md',
  'local_context/wiki/drafts/09_draft.md',
  'local_context/wiki/diagram.png',
  'local_context/wiki/archive/03_storage.md',
  'local_context/notes/2026-08-17_kickoff.md',
  'local_context/notes/2026-08-18b_registers.md',
] as const

describe('exportPlan', () => {
  test('the whole wiki is every file under the wiki root or the journal', () => {
    expect(exportPlan(FILES, layout, 'everything')).toEqual([
      'local_context/wiki/00_state.md',
      'local_context/wiki/01_scope.md',
      'local_context/wiki/decisions.md',
      'local_context/wiki/wikilog.md',
      'local_context/wiki/decisions_table.md',
      'local_context/wiki/drafts/09_draft.md',
      'local_context/wiki/diagram.png',
      'local_context/wiki/archive/03_storage.md',
      'local_context/notes/2026-08-17_kickoff.md',
      'local_context/notes/2026-08-18b_registers.md',
    ])
  })

  // The bug this scope was re-cut to fix: selecting by `classify`'s five kinds
  // dropped every file the schema does not name, while the manifest went on
  // calling the bundle the whole wiki.
  test('the whole wiki carries files the schema has no name for', () => {
    const plan = exportPlan(FILES, layout, 'everything')
    expect(plan).toContain('local_context/wiki/wikilog.md')
    expect(plan).toContain('local_context/wiki/decisions_table.md')
    expect(plan).toContain('local_context/wiki/drafts/09_draft.md')
    expect(plan).toContain('local_context/wiki/diagram.png')
  })

  // A layout `parseClaudeBlock` accepts and `listWikiFiles` supports. Selecting
  // by kind lost the *entire* journal here, because `classify` matches the wiki
  // root first and every entry came back `other`.
  test('a journal declared inside the wiki root still carries its entries', () => {
    const nested: ProjectLayout = { wikiRoot: 'local_context/', journal: 'local_context/notes/', kind: 'software' }
    const files = ['local_context/wiki/00_state.md', 'local_context/notes/2026-08-17_kickoff.md']
    expect(exportPlan(files, nested, 'everything')).toEqual(files)
  })

  test('the curated bundle drops the journal, the archive and what the schema does not name', () => {
    expect(exportPlan(FILES, layout, 'curated')).toEqual([
      'local_context/wiki/00_state.md',
      'local_context/wiki/01_scope.md',
      'local_context/wiki/decisions.md',
    ])
  })

  // The agent file is tracked in git and arrives with the repository, so a copy
  // in the bundle would only ever be a second and staler one.
  test('the agent file and the rest of the repository are in neither bundle', () => {
    for (const scope of ['everything', 'curated'] as const) {
      const plan = exportPlan(FILES, layout, scope)
      expect(plan).not.toContain('CLAUDE.md')
      expect(plan).not.toContain('README.md')
    }
  })

  // A backslash is an ordinary character in a POSIX filename and a separator to
  // a long line of Windows extractors — and `curated` exists to be sent to
  // someone else, on Windows.
  test('a path that would be a dangerous zip entry is refused, not rewritten', () => {
    const nasty = [
      'local_context/wiki/archive/..\\..\\..\\evil.md',
      'local_context/wiki/00_state.md',
    ]
    expect(exportPlan(nasty, layout, 'everything')).toEqual(['local_context/wiki/00_state.md'])
  })

  // Two exports of an unchanged wiki have to produce the same list, or the
  // bundles cannot be diffed against each other — which is the whole point of
  // handing one to someone else.
  test('the given order is kept', () => {
    const reversed = [...FILES].reverse()
    expect(exportPlan(reversed, layout, 'everything')).toEqual([...exportPlan(FILES, layout, 'everything')].reverse())
  })

  test('a project with nothing in scope plans nothing', () => {
    expect(exportPlan(['CLAUDE.md'], layout, 'curated')).toEqual([])
  })
})

describe('bundleStem', () => {
  test('names the project, the scope and the day', () => {
    expect(bundleStem('Inchworm', 'everything', '2026-09-19')).toBe('inchworm-wiki-2026-09-19')
    expect(bundleStem('Inchworm', 'curated', '2026-09-19')).toBe('inchworm-notes-2026-09-19')
  })

  test('a folder name with spaces and punctuation becomes one filename', () => {
    expect(bundleStem('My Project (2026)!', 'curated', '2026-09-19')).toBe('my-project-2026-notes-2026-09-19')
  })

  // A name of nothing but punctuation would otherwise produce `-wiki-<date>.zip`.
  test('a name that slugs to nothing falls back', () => {
    expect(bundleStem('···', 'everything', '2026-09-19')).toBe('project-wiki-2026-09-19')
  })
})

describe('manifest', () => {
  const note = manifest({
    project: 'Inchworm',
    scope: 'curated',
    date: '2026-09-19',
    layout,
    paths: ['local_context/wiki/00_state.md'],
  })

  test('says what the bundle is, where it came from and how to put it back', () => {
    expect(note).toContain('# Inchworm — llmwiki export')
    expect(note).toContain('2026-09-19')
    expect(note).toContain('`local_context/wiki/`')
    expect(note).toContain('`local_context/notes/`')
    expect(note).toContain('copy the folders next to this file into the repository root')
  })

  test('lists every file it carries, and counts them', () => {
    expect(note).toContain('- Files: 1')
    expect(note).toContain('- `local_context/wiki/00_state.md`')
  })

  test('the two scopes describe themselves differently', () => {
    const whole = manifest({ project: 'Inchworm', scope: 'everything', date: '2026-09-19', layout, paths: [] })
    expect(whole).toContain('journal')
    expect(note).toContain('No journal, no archive.')
  })

  // The literal, not a property of it: a rename would otherwise leave this
  // green while every bundle in the wild carried a differently named manifest.
  test('the manifest has one name, and it is markdown', () => {
    expect(MANIFEST_FILE).toBe('inchworm-export.md')
  })
})
