/**
 * The skeleton a new register entry starts from, and where it goes: at the
 * bottom, from the template, with not one byte of the file rewritten.
 */

import { describe, expect, test } from 'vitest'
import { appendEntry, entryTemplate, isAppendable, isTagName, nextMarker, tagInsertion } from './templates.js'

describe('isAppendable', () => {
  test('the block-shaped registers are, and the two table-shaped ones are not', () => {
    expect(isAppendable('contentions')).toBe(true)
    expect(isAppendable('gotchas')).toBe(true)
    // A row appended after the prose that follows the table is a broken file,
    // so there is no affordance rather than a wrong one.
    expect(isAppendable('budgets')).toBe(false)
    expect(isAppendable('deletions')).toBe(false)
  })
})

describe('nextMarker', () => {
  test('counts from the highest marker, not from how many entries there are', () => {
    // C8 is resolved and still holds its number: the next one is C9, not C4.
    expect(nextMarker(['C1 — a', 'C2 — b', 'C8 — c (RESOLVED 2026-08-19)'], 'C')).toBe(9)
  })

  test('an empty register starts at one', () => {
    expect(nextMarker([], 'C')).toBe(1)
    expect(nextMarker(['not a marker'], 'I')).toBe(1)
  })

  test('the letter is anchored, so `I3` does not answer for `C`', () => {
    expect(nextMarker(['I3 — an idea'], 'C')).toBe(1)
    expect(nextMarker(['I3 — an idea'], 'I')).toBe(4)
  })

  test('a marker that is a prefix of a longer word is not a marker', () => {
    expect(nextMarker(['C1x — not one'], 'C')).toBe(1)
  })
})

describe('entryTemplate', () => {
  test('a numbered register gets the next number in its heading', () => {
    const template = entryTemplate('contentions', { date: '2026-08-20', headings: ['C1 — a', 'C2 — b'] })
    expect(template).toContain('## C3 —')
    expect(template).toContain('**Resolves when:**')
    expect(template).toContain('**Fallback:**')
  })

  test('a dated register gets the date it was handed, never one it read from a clock', () => {
    expect(entryTemplate('findings', { date: '2026-08-20', headings: [] })).toContain('## [2026-08-20]')
    expect(entryTemplate('tried', { date: '2026-08-20', headings: [] })).toContain('## [2026-08-20] Tried')
    expect(entryTemplate('gotchas', { date: '2026-08-20', headings: [] })).toContain('(context, 2026-08-20)')
  })

  test('decisions carries all five lines the register format requires', () => {
    const template = entryTemplate('decisions', { date: '2026-08-20', headings: [] }) ?? ''
    for (const field of ['Ruling', 'Why', 'Rejected', 'Expect', 'Touches']) {
      expect(template).toContain(`**${field}:**`)
    }
  })

  test('ideas is numbered and carries its status ladder', () => {
    expect(entryTemplate('ideas', { date: '2026-08-20', headings: ['I7 — x'] })).toContain('## I8 —')
  })

  test('a table-shaped register has no template at all', () => {
    expect(entryTemplate('budgets', { date: '2026-08-20', headings: [] })).toBeUndefined()
    expect(entryTemplate('deletions', { date: '2026-08-20', headings: [] })).toBeUndefined()
  })

  test('the placeholders are left in, so an unfilled entry looks unfinished', () => {
    expect(entryTemplate('findings', { date: '2026-08-20', headings: [] })).toContain('<fact>')
  })
})

describe('appendEntry', () => {
  test('an entry lands at the bottom, one blank line down', () => {
    expect(appendEntry('# register\n\n## one\n', '## two').text).toBe('# register\n\n## one\n\n## two\n')
  })

  test('no byte of the file is rewritten — trailing blank lines survive', () => {
    const existing = '## one\n\n\n\n'
    const { text } = appendEntry(existing, '## two')
    expect(text.startsWith(existing)).toBe(true)
    expect(text).toBe('## one\n\n\n\n## two\n')
  })

  test('a file with no trailing newline gets one, plus the blank line', () => {
    expect(appendEntry('## one', '## two').text).toBe('## one\n\n## two\n')
  })

  test('an empty register takes the entry alone', () => {
    expect(appendEntry('', '## one')).toEqual({ text: '## one\n', from: 0 })
  })

  test('`from` points at the first character of what was added', () => {
    const existing = '## one\n'
    const { text, from } = appendEntry(existing, '## two')
    expect(text.slice(from)).toBe('## two\n')
  })
})

describe('tagInsertion — a note left for the agent', () => {
  test('with no selection, the caret lands between the tags', () => {
    const { insert, caret } = tagInsertion('eddy', '')

    expect(insert).toBe('<eddy></eddy>')
    expect(insert.slice(0, caret)).toBe('<eddy>')
  })

  test('a selection is wrapped, and the caret follows it rather than replacing it', () => {
    const { insert, caret, to } = tagInsertion('eddy', 'check this')

    expect(insert).toBe('<eddy>check this</eddy>')
    expect(insert.slice(0, caret)).toBe('<eddy>check this')
    expect(to).toBe(insert.length)
  })

  test('the name is the one the reader set, and nothing else about the shape changes', () => {
    expect(tagInsertion('ebr', '').insert).toBe('<ebr></ebr>')
  })
})

describe('isTagName', () => {
  test.each(['eddy', 'ebr', 'note-to-self', 'a', 'A1_b'])('%s is a tag name', (name) => {
    expect(isTagName(name)).toBe(true)
  })

  test.each(['', ' ', '1st', 'has space', 'sla/sh', '<eddy>', 'ä', 'x'.repeat(33)])(
    '%s is not',
    (name) => {
      expect(isTagName(name)).toBe(false)
    },
  )
})
