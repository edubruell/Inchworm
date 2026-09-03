/**
 * What debt is, and what the app may run to find out. The spawning itself is
 * `main/debt.test.ts`'s; this is the schema half — the checkers' record shapes,
 * and the containment the spawn list rests on.
 */

import { describe, expect, test } from 'vitest'
import { SKILL_FILES } from './skill.js'
import { CHECKERS, DEBT_KINDS, checkersAreShipped, orderDebt, sweepDebt, triggerDebt, type DebtItem } from './debt.js'

const FILES = ['local_context/wiki/findings.md', 'local_context/wiki/00_state.md', 'CLAUDE.md']

/**
 * The rows a reader found. The readers answer `undefined` for a checker that did
 * not answer at all — the distinction the section rests on, and asserted
 * directly where it matters; everywhere else this keeps the test about content.
 */
const found = (items: readonly DebtItem[] | undefined): readonly DebtItem[] => items ?? []

describe('the spawn list', () => {
  test('names only files this build ships', () => {
    expect(checkersAreShipped()).toBe(true)
    for (const name of CHECKERS) expect(SKILL_FILES.some((file) => file.source === name)).toBe(true)
  })

  test('is shorter than the manifest — a limit that lists everything is not one', () => {
    expect(CHECKERS.length).toBeLessThan(SKILL_FILES.length)
    // The two the sidebar does not ask, named so a future addition is deliberate.
    expect([...CHECKERS]).not.toContain('wiki-contentions.py')
    expect([...CHECKERS]).not.toContain('wiki-overdue.py')
  })
})

describe('the sweep sentinel', () => {
  const payload = {
    clean: false,
    debt: [
      { register: 'findings.md', line: 42, date: '2026-08-27', target: '05_plan#x', anchor: 'x', note: '05_plan.md', problem: 'no stamp for #x in 05_plan.md' },
    ],
    pending: [{ register: 'findings.md', line: 9, problem: 'pending: the note is not written yet' }],
    unanchored: [{ register: 'gotchas.md', line: 3 }],
    stale_count: 7,
  }

  test('reads debt, and resolves the register to a file the window lists', () => {
    expect(sweepDebt(payload, FILES)).toEqual([
      {
        kind: 'unstamped',
        label: 'findings.md:42',
        detail: 'no stamp for #x in 05_plan.md',
        path: 'local_context/wiki/findings.md',
      },
    ])
  })

  test('leaves pending, unanchored and the pre-window count alone', () => {
    // Each is explicitly *not* debt in the schema, and a section headed "not
    // written up" that listed them would cry wolf on every wiki predating the
    // sentinel — which is all of them.
    const items = found(sweepDebt(payload, FILES))
    expect(items).toHaveLength(1)
    expect(items.map((item) => item.label)).not.toContain('findings.md:9')
    expect(items.map((item) => item.label)).not.toContain('gotchas.md:3')
  })

  test('drops a row missing what a row is made of, rather than drawing an empty one', () => {
    expect(sweepDebt({ debt: [{ register: 'x.md' }, { problem: 'y' }, 7, null] }, FILES)).toEqual([])
  })

  test('a register the window does not list still shows, without a path', () => {
    const items = found(sweepDebt({ debt: [{ register: 'wikilog.md', line: 2, problem: 'p' }] }, FILES))
    expect(items[0]?.path).toBeUndefined()
    expect(items[0]?.label).toBe('wikilog.md:2')
  })

  test('a row with no line number is still a row', () => {
    const items = found(sweepDebt({ debt: [{ register: 'CLAUDE.md', problem: 'p' }] }, FILES))
    expect(items[0]?.label).toBe('CLAUDE.md')
    // A file the window lists at the root matches exactly, not by suffix.
    expect(items[0]?.path).toBe('CLAUDE.md')
  })

  test('an empty string is not a register, and not a problem', () => {
    expect(sweepDebt({ debt: [{ register: '', problem: 'p' }, { register: 'x.md', problem: '' }] }, FILES)).toEqual([])
  })

  test('a payload with no list is *unanswered*, not clean', () => {
    // The distinction the section rests on: `undefined` is "this checker did
    // not answer" and `[]` is "it answered, nothing is owed".
    expect(sweepDebt(undefined, FILES)).toBeUndefined()
    expect(sweepDebt({ debt: 'not a list' }, FILES)).toBeUndefined()
    expect(sweepDebt({ ok: false, note: 'not a directory', wiki: null }, FILES)).toBeUndefined()
    expect(sweepDebt({ clean: true, debt: [] }, FILES)).toEqual([])
  })

  test('“I found no wiki” is unanswered even when it comes with an empty list', () => {
    // `wiki-trigger.py` answers a folder with no CLAUDE.md as `{wiki: null,
    // note: "no CLAUDE.md", open: []}` — an empty list that means blind, not
    // clean, and the only payload where the two look alike.
    expect(triggerDebt({ wiki: null, note: 'no CLAUDE.md', open: [] }, FILES)).toBeUndefined()
    expect(sweepDebt({ ok: true, wiki: null, note: 'no CLAUDE.md' }, FILES)).toBeUndefined()
  })

  test('a basename two files share opens neither', () => {
    // A wiki `findings.md` and a journal one: opening the wrong file is worse
    // than opening none, so an ambiguous name gets no link at all.
    const both = ['local_context/wiki/findings.md', 'local_context/wiki/archive/findings.md']
    expect(found(sweepDebt({ debt: [{ register: 'findings.md', line: 1, problem: 'p' }] }, both))[0]?.path).toBeUndefined()
  })
})

describe('the trigger checker', () => {
  const payload = {
    clean: false,
    open: [
      { trigger: 'payload', kind: 'unfiled', path: 'payload/incoming/v3_back', date: null, detail: 'no RETURN.txt — landed by hand?' },
      { trigger: 'payload', kind: 'unswept', path: 'payload/incoming/20260826d', date: '2026-08-26', detail: 'RETURN.txt is still marked unswept' },
      { trigger: 'journal', kind: 'unlinked', path: 'local_context/wiki/00_state.md', date: '2026-08-27', detail: 'named nowhere in the wiki or journal' },
    ],
    stale: 21,
  }

  test('labels a row with the leaf, and keeps the path in the detail', () => {
    // Artefacts of one trigger share a folder, so a full path truncates every
    // row to the same `payload/incom…`.
    const items = found(triggerDebt(payload, FILES))
    expect(items.map((item) => [item.kind, item.label])).toEqual([
      ['unfiled', 'v3_back'],
      ['unswept', '20260826d'],
      ['unlinked', '00_state.md'],
    ])
    expect(items[0]?.detail).toBe('payload/incoming/v3_back — no RETURN.txt — landed by hand?')
  })

  test('a leaf with no folder above it is its own label', () => {
    expect(found(triggerDebt({ open: [{ kind: 'unfiled', path: 'RETURN.txt', detail: 'd' }] }, FILES))[0]?.label).toBe('RETURN.txt')
  })

  test('an artefact outside the wiki has no path to open, and is still shown', () => {
    const items = found(triggerDebt(payload, FILES))
    expect(items[0]?.path).toBeUndefined()
    expect(items[2]?.path).toBe('local_context/wiki/00_state.md')
  })

  test('the pre-cutoff backlog is never debt', () => {
    // Backlog is not debt is the rule that keeps this section from burying a
    // project the day it is switched on.
    expect(triggerDebt({ open: [], stale: 21 }, FILES)).toEqual([])
  })

  test('a kind this build has never heard of is still debt', () => {
    // The installed checker may be newer than the app reading it; the one thing
    // it must not do is vanish.
    const items = found(triggerDebt({ open: [{ kind: 'unbraided', path: 'x/y', detail: 'd' }] }, FILES))
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('unlinked')
  })
})

describe('order', () => {
  test('is by kind, and stable inside one', () => {
    const items = [
      { kind: 'unlinked' as const, label: 'b', detail: '' },
      { kind: 'unstamped' as const, label: 'a', detail: '' },
      { kind: 'unlinked' as const, label: 'c', detail: '' },
    ]
    expect(orderDebt(items).map((item) => item.label)).toEqual(['a', 'b', 'c'])
  })

  test('keeps every item — ordering is not filtering', () => {
    const items = DEBT_KINDS.map((kind) => ({ kind, label: kind, detail: '' }))
    expect(orderDebt(items)).toHaveLength(DEBT_KINDS.length)
  })
})
