/**
 * `core` over the fixture that IS the schema spec
 * (`tests/fixtures/sample-wiki/README.md`). These tests read real files, which
 * is why they live here and not beside the modules: `src/core` may not import
 * `node:fs`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { classify } from '@core/classify.js'
import { capFor, capStatus } from '@core/caps.js'
import { backlinkIndex, buildLinkIndex, resolveLink } from '@core/links.js'
import { buildNavigation } from '@core/navigation.js'
import { parseNote } from '@core/note.js'
import { expectParsed } from './support/parsed.js'
import { listFiles } from './support/fixture.js'
import { parseClaudeBlock } from '@core/project.js'
import type { ProjectLayout } from '@core/project.js'

const ROOT = join(import.meta.dirname, 'fixtures/sample-wiki')

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

const paths = listFiles(ROOT)
const claude = parseClaudeBlock(read('CLAUDE.md'))
if (!claude.ok) throw new Error('the fixture CLAUDE.md must carry a project block')
const layout: ProjectLayout = claude.value

const index = buildLinkIndex(paths, layout)
const markdown = paths.filter((path) => path.endsWith('.md'))
// Narrowed at the source: no fixture file is anywhere near the parse budget,
// so a refusal here should fail the suite rather than empty these assertions.
const notes = markdown.map((path) => ({ path, note: expectParsed(parseNote(read(path))) }))

describe('the fixture is a valid llmwiki', () => {
  test('its CLAUDE.md declares both paths and the software kind', () => {
    expect(layout).toEqual({ wikiRoot: 'local_context/wiki/', journal: 'local_context/notes/', kind: 'software' })
  })

  test('every file in it has schema meaning — no strays', () => {
    const other = markdown.filter((path) => classify(path, layout).kind === 'other')
    expect(other).toEqual(['README.md'])
  })

  test('it carries every register the schema names', () => {
    const registers = markdown.flatMap((path) => {
      const kind = classify(path, layout)
      return kind.kind === 'register' ? [kind.register] : []
    })
    expect([...registers].sort()).toEqual(
      ['budgets', 'contentions', 'decisions', 'deletions', 'findings', 'gotchas', 'ideas', 'tried'].sort(),
    )
  })

  test('it carries all three note statuses', () => {
    const statuses = notes.flatMap(({ path, note }) =>
      classify(path, layout).kind === 'note' && note.frontmatter.kind === 'parsed'
        ? [note.frontmatter.fields.status]
        : [],
    )
    expect(statuses).toContainEqual({ kind: 'active' })
    expect(statuses).toContainEqual({ kind: 'proposal' })
    expect(statuses).toContainEqual({ kind: 'superseded', by: 4 })
  })

  test('no note in it has malformed frontmatter', () => {
    expect(notes.filter(({ note }) => note.frontmatter.kind === 'invalid')).toEqual([])
  })

  test('the registers carry no frontmatter, as the schema says', () => {
    const withHeader = notes.filter(
      ({ path, note }) => classify(path, layout).kind === 'register' && note.frontmatter.kind !== 'absent',
    )
    expect(withHeader).toEqual([])
  })
})

describe('caps over the fixture', () => {
  const statusOf = (path: string): ReturnType<typeof capStatus> =>
    capStatus(parseNote(read(path)).lineCount, capFor(classify(path, layout)))

  // The README documents these three bands; they are asserted so that editing
  // a fixture file cannot quietly remove an edge case.
  test('decisions.md is over its cap', () => {
    expect(statusOf('local_context/wiki/decisions.md')).toEqual({
      kind: 'over',
      lines: 103,
      cap: 100,
      fraction: 1.03,
    })
  })

  test('contentions.md is in the amber band', () => {
    expect(statusOf('local_context/wiki/contentions.md')).toMatchObject({ kind: 'near', lines: 83, cap: 100 })
  })

  test('00_state.md is well inside its cap', () => {
    expect(statusOf('local_context/wiki/00_state.md')).toMatchObject({ kind: 'ok', lines: 16, cap: 60 })
  })

  test('notes and journal entries are uncapped', () => {
    expect(statusOf('local_context/wiki/04_storage.md').kind).toBe('uncapped')
    expect(statusOf('local_context/notes/2026-08-17_kickoff.md').kind).toBe('uncapped')
  })
})

describe('links over the fixture', () => {
  const unresolved = notes.flatMap(({ path, note }) =>
    note.links.filter((link) => resolveLink(link.target, index).status === 'unresolved').map((link) => ({
      path,
      target: link.target,
    })),
  )

  /**
   * The load-bearing assertion of the whole fixture: the wiki illustrates its
   * own syntax inside code spans and fenced blocks, and a link extractor that
   * reads raw text reports those as dangling. Exactly
   * one link here is genuinely dangling, and it is deliberate.
   */
  test('exactly one link is dangling, and it is the deliberate one', () => {
    expect(unresolved).toEqual([{ path: 'local_context/wiki/00_state.md', target: '99_missing' }])
  })

  test('the illustrations in gotchas.md are not links at all', () => {
    const gotchas = notes.find(({ path }) => path.endsWith('gotchas.md'))
    expect(gotchas?.note.links).toEqual([])
  })

  test('anchors and labels survive the round trip', () => {
    const state = notes.find(({ path }) => path.endsWith('00_state.md'))?.note.links ?? []
    expect(state).toContainEqual(expect.objectContaining({ target: '04_storage', label: 'the storage note' }))
    // Named explicitly rather than folded over: `01_scope.md` carries its
    // anchored link in `links:`, not in the body, so an `every` over its body
    // links would pass by being empty.
    const decisions = notes.find(({ path }) => path.endsWith('decisions.md'))?.note.links ?? []
    expect(decisions).toContainEqual(expect.objectContaining({ target: 'contentions', anchor: 'C1' }))
  })

  test('a `links:` entry in frontmatter is not a body link, and contributes no backlink', () => {
    // 01_scope declares `links: [04_storage, decisions#2026-08-18]` and has no
    // body wikilink at all. The declared graph is deliberately not the link
    // graph; if that ever changes, this test is where it is decided.
    const scope = notes.find(({ path }) => path.endsWith('01_scope.md'))
    expect(scope?.note.links).toEqual([])
    expect(scope?.note.frontmatter).toMatchObject({
      kind: 'parsed',
      fields: { links: ['04_storage', 'decisions#2026-08-18'] },
    })
  })

  test('backlinks find the notes pointing at the superseding note', () => {
    const backlinks = backlinkIndex(
      notes.map(({ path, note }) => ({ path, links: note.links })),
      index,
    )
    const to04 = backlinks.get('local_context/wiki/04_storage.md') ?? []
    expect(to04.map((backlink) => backlink.from)).toContain('local_context/wiki/00_state.md')
    expect(to04.map((backlink) => backlink.from)).toContain('local_context/wiki/03_storage.md')
  })

  test('a link resolves to the note, never to its archived body', () => {
    expect(resolveLink('03_storage', index)).toEqual({
      status: 'resolved',
      path: 'local_context/wiki/03_storage.md',
    })
  })
})

describe('navigation over the fixture', () => {
  const groups = buildNavigation(paths, layout)
  const entries = (section: string): readonly string[] =>
    groups.find((group) => group.section === section)?.entries.map((entry) => entry.name) ?? []

  test('the sidebar reads in schema order', () => {
    expect(entries('state')).toEqual(['00_state.md'])
    expect(entries('notes')).toEqual(['01_scope.md', '02_design.md', '03_storage.md', '04_storage.md'])
    expect(entries('registers')).toEqual([
      'ideas.md',
      'decisions.md',
      'contentions.md',
      'findings.md',
      'gotchas.md',
      'tried.md',
      'budgets.md',
      'deletions.md',
    ])
    expect(entries('journal')).toEqual([
      // Same day: the path breaks the tie in the same direction as the date.
      '2026-08-18_storage_swap.md',
      '2026-08-18_registers_over_cap.md',
      '2026-08-17_kickoff.md',
    ])
    expect(entries('archive')).toEqual(['03_storage.md'])
  })

  test("the fixture's README is not in the tree", () => {
    expect(groups.flatMap((group) => group.entries.map((entry) => entry.name))).not.toContain('README.md')
  })
})
