/**
 * Every case below is within the parse budget, so an `unparsed` result is a
 * test failure and not a branch to handle — asserting that here keeps the
 * narrowing out of twenty individual tests without hiding it.
 */

import { describe, expect, test } from 'vitest'
import type { ParsedNote } from './note.js'
import { parseNote } from './note.js'

const parse = (text: string): ParsedNote => {
  const state = parseNote(text)
  if (state.kind === 'unparsed') throw new Error(`unexpectedly unparsed: ${state.refusal.kind}`)
  return state
}

const note = `---
status: superseded-by-04
updated: 2026-08-18
links: [04_storage]
---

# 03 — storage (superseded)

Superseded by [[04_storage]]; the body moved to \`archive/03_storage.md\`.

## Why
Because \`[[not_a_link]]\` is only an illustration.
`

describe('parseNote', () => {
  test('reads frontmatter, headings, links and the title in one pass', () => {
    const parsed = parse(note)
    expect(parsed.frontmatter).toEqual({
      kind: 'parsed',
      fields: {
        status: { kind: 'superseded', by: 4 },
        updated: '2026-08-18',
        links: ['04_storage'],
        covers: [],
      },
    })
    expect(parsed.headings).toEqual([
      { depth: 1, text: '03 — storage (superseded)', line: 7 },
      { depth: 2, text: 'Why', line: 11 },
    ])
    expect(parsed.links.map((link) => link.target)).toEqual(['04_storage'])
    expect(parsed.title).toBe('03 — storage (superseded)')
    expect(parsed.lineCount).toBe(12)
  })

  // Registers carry no frontmatter: half the schema, so it is a state and not
  // an error.
  test('a register has absent frontmatter and still parses', () => {
    const parsed = parse('# gotchas\n\n- a trap (2026-08-18)\n')
    expect(parsed.frontmatter).toEqual({ kind: 'absent' })
    expect(parsed.title).toBe('gotchas')
  })

  test('malformed frontmatter is reported, and the body still parses', () => {
    const parsed = parse('---\nstatus: done\n---\n\n# title\n\n[[a]]\n')
    expect(parsed.frontmatter).toMatchObject({ kind: 'invalid', error: { kind: 'field', field: 'status' } })
    expect(parsed.title).toBe('title')
    expect(parsed.links).toHaveLength(1)
  })

  test('inline markup in a heading is flattened for the outline rail', () => {
    const parsed = parse('## the `capStatus` **rule**\n')
    expect(parsed.headings[0]?.text).toBe('the capStatus rule')
  })

  test('a note with no h1 has no title rather than a wrong one', () => {
    expect(parse('## second level only\n').title).toBeUndefined()
  })

  test('an empty file parses to an empty note', () => {
    const parsed = parse('')
    expect(parsed).toMatchObject({ frontmatter: { kind: 'absent' }, headings: [], links: [], lineCount: 0 })
  })

  test('line count matches wc -l, which is the unit the caps use', () => {
    expect(parse('a\nb\nc\n').lineCount).toBe(3)
    expect(parse('a\nb\nc').lineCount).toBe(3)
  })
})

describe('a file the parse budget refuses', () => {
  const pathological = `${'>'.repeat(50_000)} deep`

  test('comes back as a state, not a throw — parseNote is still total', () => {
    const state = parseNote(pathological)
    expect(state).toMatchObject({ kind: 'unparsed', refusal: { kind: 'too-nested', measure: 'deepest' } })
  })

  test('still reports its line count, because the cap gauge is a wc -l and not a parse', () => {
    const state = parseNote(`${'  '.repeat(1) + 'a'}\n${'>'.repeat(50_000)} deep\n`)
    expect(state.kind).toBe('unparsed')
    expect(state.lineCount).toBe(2)
  })

  test('the budget is a parameter, so a caller can be stricter than the default', () => {
    const state = parseNote('# fine\n', { bytes: 3, deepest: 10, total: 10 })
    expect(state).toMatchObject({ kind: 'unparsed', refusal: { kind: 'too-large', limit: 3 } })
  })
})

describe('parseNote is total even when the pipeline is not', () => {
  test('a shape the budget admits but the parser cannot take is refused, not thrown', () => {
    // Driven through the budget parameter, because the shipped `PARSE_BUDGET`
    // is calibrated to refuse this first. What is under test is the arm behind
    // it: since `remark-gfm` joined the pipeline the parse itself can overflow
    // the stack, and the budget reads line prefixes only, so it cannot promise
    // it never will.
    const permissive = { bytes: 10_000_000, deepest: 1_000_000, total: 1_000_000 }
    const note = parseNote(`${'> '.repeat(20_000)}x`, permissive)
    expect(note.kind).toBe('unparsed')
    expect(note.kind === 'unparsed' ? note.refusal.kind : undefined).toBe('stack')
  })

  test('a real note is unaffected', () => {
    expect(parseNote('# Title\n\n- a\n- b\n').kind).toBe('parsed')
  })
})
