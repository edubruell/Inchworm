/**
 * What a note's header may say, and — more to the point — what a malformed one
 * comes back as. A field error names its field, because the reader has to be able
 * to find it.
 */

import { describe, expect, test } from 'vitest'
import { parseFrontmatter, parseStatus } from './frontmatter.js'

describe('parseStatus', () => {
  test.each([
    ['active', { kind: 'active' }],
    ['proposal', { kind: 'proposal' }],
    ['superseded-by-04', { kind: 'superseded', by: 4 }],
    ['superseded-by-12', { kind: 'superseded', by: 12 }],
    ['  superseded-by-7  ', { kind: 'superseded', by: 7 }],
  ])('%s parses to %o', (raw, expected) => {
    expect(parseStatus(raw)).toEqual({ ok: true, value: expected })
  })

  test.each([['superseded'], ['superseded-by-'], ['done'], [42], [undefined], [null]])(
    '%s is a field error, not a silent default',
    (raw) => {
      const parsed = parseStatus(raw)
      expect(parsed.ok).toBe(false)
      expect(!parsed.ok && parsed.error).toMatchObject({ kind: 'field', field: 'status' })
    },
  )
})

describe('parseFrontmatter', () => {
  test('reads a full note header', () => {
    const parsed = parseFrontmatter(`status: active
updated: 2026-08-18
links: [01_scope, decisions#2026-08-18]
covers: ["src/**", "package.json"]`)
    expect(parsed).toEqual({
      ok: true,
      value: {
        status: { kind: 'active' },
        updated: '2026-08-18',
        links: ['01_scope', 'decisions#2026-08-18'],
        covers: ['src/**', 'package.json'],
      },
    })
  })

  // yaml resolves an unquoted date to a Date; the schema is a string of bytes
  // and the app never reformats what the author typed.
  test('an unquoted date comes back as the YYYY-MM-DD the author wrote', () => {
    const parsed = parseFrontmatter('status: active\nupdated: 2026-08-18')
    expect(parsed.ok && parsed.value.updated).toBe('2026-08-18')
    const quoted = parseFrontmatter('status: active\nupdated: "2026-08-18"')
    expect(quoted.ok && quoted.value.updated).toBe('2026-08-18')
  })

  // Journal entries are the schema's other frontmatter: a session log carries
  // date/kind/outcome and no status, and that is valid, not broken.
  test('session-log frontmatter parses, with no status', () => {
    const parsed = parseFrontmatter('date: 2026-08-18\nkind: build\noutcome: it runs')
    expect(parsed.ok && parsed.value.status).toBeUndefined()
  })

  test('a malformed status is still a field error', () => {
    const parsed = parseFrontmatter('status: done')
    expect(!parsed.ok && parsed.error).toMatchObject({ kind: 'field', field: 'status' })
  })

  test('absent lists are empty, not missing', () => {
    const parsed = parseFrontmatter('status: proposal')
    expect(parsed.ok && parsed.value).toEqual({
      status: { kind: 'proposal' },
      updated: undefined,
      links: [],
      covers: [],
    })
  })

  test.each([
    ['links: not-a-list\nstatus: active', 'links'],
    ['covers: 3\nstatus: active', 'covers'],
    ['links: [1, 2]\nstatus: active', 'links'],
    ['status: active\nupdated: 3', 'updated'],
  ])('%j reports which field is wrong', (text, field) => {
    const parsed = parseFrontmatter(text)
    expect(!parsed.ok && parsed.error).toMatchObject({ kind: 'field', field })
  })

  test('malformed YAML is a typed failure, not a throw', () => {
    const parsed = parseFrontmatter('status: [active\n')
    expect(!parsed.ok && parsed.error.kind).toBe('yaml')
  })

  test.each([['- a\n- b'], ['just a string']])('%j is not a mapping', (text) => {
    const parsed = parseFrontmatter(text)
    expect(!parsed.ok && parsed.error.kind).toBe('not-a-mapping')
  })

  test.each([[''], ['   \n'], ['# only a comment']])(
    '%j is an empty header, not a broken one — it must not go red in the viewer',
    (text) => {
      const parsed = parseFrontmatter(text)
      expect(parsed.ok && parsed.value).toEqual({ status: undefined, updated: undefined, links: [], covers: [] })
    },
  )

  test('a status is trimmed before every comparison, not just the superseded one', () => {
    for (const raw of ['active ', ' active', 'proposal\t', ' superseded-by-3 ']) {
      expect(parseStatus(raw).ok).toBe(true)
    }
  })

  test('superseded-by takes a note number, not a twenty-digit float', () => {
    expect(parseStatus('superseded-by-99999999999999999999').ok).toBe(false)
    expect(parseStatus('superseded-by-007')).toEqual({ ok: true, value: { kind: 'superseded', by: 7 } })
  })
})
