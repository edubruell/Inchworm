/**
 * Schema order, never alphabetical — asserted, because it is the kind of order a
 * later `sort` quietly replaces. The palette's filter is here too: ranked, not
 * fuzzy.
 */

import { describe, expect, test } from 'vitest'
import type { ProjectLayout } from './project.js'
import { buildNavigation, filterEntries, jumpTargets } from './navigation.js'

const layout: ProjectLayout = { wikiRoot: 'wiki/', journal: 'notes/', kind: 'software' }

// Deliberately in an order no sidebar should show them in.
const paths = [
  'wiki/tried.md',
  'wiki/12_late_note.md',
  'notes/2026-08-17_kickoff.md',
  'wiki/00_state.md',
  'wiki/archive/03_storage.md',
  'wiki/decisions.md',
  'notes/2026-08-18_swap.md',
  'wiki/02_design.md',
  'wiki/ideas.md',
  'CLAUDE.md',
  'src/core/note.ts',
  'wiki/diagram.png',
]

const groups = buildNavigation(paths, layout)
const names = (section: string): readonly string[] =>
  groups.find((group) => group.section === section)?.entries.map((entry) => entry.name) ?? []

describe('buildNavigation', () => {
  test('always returns the five schema sections, in read order', () => {
    expect(groups.map((group) => group.section)).toEqual(['state', 'notes', 'registers', 'journal', 'archive'])
  })

  test('notes are ordered by number, not alphabetically', () => {
    expect(names('notes')).toEqual(['02_design.md', '12_late_note.md'])
  })

  test('registers are in schema order, not alphabetically', () => {
    expect(names('registers')).toEqual(['ideas.md', 'decisions.md', 'tried.md'])
  })

  test('the journal is newest first', () => {
    expect(names('journal')).toEqual(['2026-08-18_swap.md', '2026-08-17_kickoff.md'])
  })

  test('state and archive land in their own sections', () => {
    expect(names('state')).toEqual(['00_state.md'])
    expect(names('archive')).toEqual(['03_storage.md'])
  })

  // The five sections are fixed; anything else has no home and is not invented one.
  test('files with no schema meaning are left out', () => {
    const shown = groups.flatMap((group) => group.entries.map((entry) => entry.path))
    expect(shown).not.toContain('CLAUDE.md')
    expect(shown).not.toContain('src/core/note.ts')
    expect(shown).not.toContain('wiki/diagram.png')
  })

  test('entries carry the classification, so the sidebar never re-derives it', () => {
    const notes = groups.find((group) => group.section === 'notes')?.entries ?? []
    expect(notes[0]?.kind).toEqual({ kind: 'note', number: 2, topic: 'design' })
  })

  test('an empty project still has its five sections', () => {
    expect(buildNavigation([], layout).map((group) => group.entries)).toEqual([[], [], [], [], []])
  })

  test('two entries that sort equal fall back to the path, so the order is total', () => {
    const ties = buildNavigation(['wiki/archive/b.md', 'wiki/archive/a.md'], layout)
    expect(ties.find((group) => group.section === 'archive')?.entries.map((entry) => entry.path)).toEqual([
      'wiki/archive/a.md',
      'wiki/archive/b.md',
    ])
  })

  test('journal entries on the same day fall back to the path, newest name first', () => {
    const sameDay = buildNavigation(['notes/2026-08-18_a.md', 'notes/2026-08-18_b.md'], layout)
    expect(sameDay.find((group) => group.section === 'journal')?.entries.map((entry) => entry.name)).toEqual([
      '2026-08-18_b.md',
      '2026-08-18_a.md',
    ])
  })
})

describe('jumpTargets', () => {
  const targets = jumpTargets(paths, layout)

  test('is the sidebar in schema order, with CLAUDE.md at the end', () => {
    expect(targets.map((entry) => entry.path)).toEqual([
      ...groups.flatMap((group) => group.entries.map((entry) => entry.path)),
      'CLAUDE.md',
    ])
  })

  test('a project without a CLAUDE.md simply has none', () => {
    expect(jumpTargets(['wiki/00_state.md'], layout).map((entry) => entry.path)).toEqual(['wiki/00_state.md'])
  })

  test('CLAUDE.md carries its classification, so the palette shows the same cap as the header', () => {
    expect(targets.at(-1)?.kind).toEqual({ kind: 'claudeMd' })
  })
})

describe('filterEntries', () => {
  const entries = jumpTargets(paths, layout)
  const matched = (query: string): readonly string[] => filterEntries(entries, query).map((entry) => entry.name)

  test('an empty query is the whole list, in schema order', () => {
    expect(filterEntries(entries, '   ')).toEqual(entries)
  })

  test('a name that starts with the query outranks one that merely contains it', () => {
    // `de` is also inside `design`, `ideas` and `CLAUDE` — the prefix wins.
    expect(matched('de')[0]).toBe('decisions.md')
    expect(matched('de')).toContain('02_design.md')
    expect(matched('ate')[0]).toBe('00_state.md')
  })

  test('the path matches too, so a journal entry is reachable by its folder', () => {
    expect(matched('notes/')).toEqual(['2026-08-18_swap.md', '2026-08-17_kickoff.md'])
  })

  test('case does not matter', () => {
    expect(matched('CLAUDE')).toEqual(['CLAUDE.md'])
    expect(matched('claude')).toEqual(['CLAUDE.md'])
  })

  test('no match is an empty list, not the whole list', () => {
    expect(matched('zzz')).toEqual([])
  })

  test('ties keep schema order rather than sorting alphabetically', () => {
    // Both are `.md` by path only; the sidebar order is what decides.
    expect(matched('.md')).toEqual(entries.map((entry) => entry.name))
  })
})
