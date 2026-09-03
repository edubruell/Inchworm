/**
 * The one function that turns a path into schema meaning, and therefore the one
 * place a schema change can quietly stop matching. Case folding, depth and the
 * two agent-file spellings are the cases that bite.
 */

import { describe, expect, test } from 'vitest'
import type { ProjectLayout } from './project.js'
import { classify } from './classify.js'

const layout: ProjectLayout = {
  wikiRoot: 'local_context/wiki/',
  journal: 'local_context/notes/',
  kind: 'software',
}

const w = (name: string): string => `local_context/wiki/${name}`
const j = (name: string): string => `local_context/notes/${name}`

describe('classify', () => {
  test('the read-first file is its own kind', () => {
    expect(classify(w('00_state.md'), layout)).toEqual({ kind: 'state' })
  })

  test.each([
    ['01_scope.md', 1, 'scope'],
    ['04_storage.md', 4, 'storage'],
    ['12_technology_research.md', 12, 'technology_research'],
  ])('%s is note %i', (name, number, topic) => {
    expect(classify(w(name), layout)).toEqual({ kind: 'note', number, topic })
  })

  test.each(['ideas', 'decisions', 'contentions', 'findings', 'gotchas', 'tried', 'budgets', 'deletions'])(
    '%s.md is a register',
    (register) => {
      expect(classify(w(`${register}.md`), layout)).toEqual({ kind: 'register', register })
    },
  )

  test('anything under archive/ is archive, at any depth', () => {
    expect(classify(w('archive/03_storage.md'), layout)).toEqual({ kind: 'archive' })
    expect(classify(w('archive/2025/decisions_q1.md'), layout)).toEqual({ kind: 'archive' })
  })

  test.each([
    ['2026-08-18_storage_swap.md', '2026-08-18', 'storage_swap'],
    ['2026-01-02_a.md', '2026-01-02', 'a'],
    ['2026-01-02.md', '2026-01-02', ''],
  ])('%s is a journal entry', (name, date, slug) => {
    expect(classify(j(name), layout)).toEqual({ kind: 'journal', date, slug })
  })

  test('CLAUDE.md is the project block only at the root', () => {
    expect(classify('CLAUDE.md', layout)).toEqual({ kind: 'claudeMd' })
    expect(classify('vendor/CLAUDE.md', layout)).toEqual({ kind: 'other' })
  })

  // Every one of these would be a false badge in the sidebar.
  test.each([
    ['a note in a sub-folder', w('drafts/07_idea.md')],
    ['a one-digit number', w('1_scope.md')],
    ['a register-like name that is not one', w('notes.md')],
    ['a non-markdown file', w('diagram.png')],
    ['an undated journal file', j('scratch.md')],
    ['a file outside both trees', 'src/core/note.ts'],
    ['README at the root', 'README.md'],
  ])('%s is other', (_label, path) => {
    expect(classify(path, layout)).toEqual({ kind: 'other' })
  })

  test('the wiki root may be the project root itself', () => {
    const flat: ProjectLayout = { wikiRoot: '', journal: 'notes/', kind: 'research' }
    expect(classify('00_state.md', flat)).toEqual({ kind: 'state' })
  })

  describe('paths the schema does not mean (M1 review, `findings` 2026-08-19)', () => {
    test('a journal sub-directory is not the journal, exactly as a wiki sub-folder is not the wiki', () => {
      expect(classify(j('sub/2026-08-19_x.md'), layout)).toEqual({ kind: 'other' })
    })

    test.each([[j('2026-13-45_bad.md')], [j('2026-02-30_nope.md')], [j('0000-00-00_x.md')]])(
      '%s has the shape of a date but is not a day',
      (path) => {
        expect(classify(path, layout)).toEqual({ kind: 'other' })
      },
    )

    test('a real leap day is a journal entry', () => {
      expect(classify(j('2028-02-29_leap.md'), layout)).toMatchObject({ kind: 'journal', date: '2028-02-29' })
    })
  })

  describe('case folding on a case-insensitive filesystem', () => {
    test.each([
      [w('Decisions.md'), 'decisions'],
      [w('DECISIONS.MD'), 'decisions'],
      [w('Gotchas.md'), 'gotchas'],
    ])('%s is the %s register — macOS says it is the same file', (path, register) => {
      expect(classify(path, layout)).toEqual({ kind: 'register', register })
    })

    test.each([[w('00_State.md')], [w('00_STATE.MD')]])('%s is the state file', (path) => {
      expect(classify(path, layout)).toEqual({ kind: 'state' })
    })

    test('claude.md is CLAUDE.md', () => {
      expect(classify('claude.md', layout)).toEqual({ kind: 'claudeMd' })
    })

    test(w('Archive/ is the archive'), () => {
      expect(classify(w('Archive/01_scope.md'), layout)).toEqual({ kind: 'archive' })
    })

    test('a note keeps the capitalisation of its topic, which is shown', () => {
      expect(classify(w('03_Storage_Format.md'), layout)).toEqual({
        kind: 'note',
        number: 3,
        topic: 'Storage_Format',
      })
    })
  })
})
