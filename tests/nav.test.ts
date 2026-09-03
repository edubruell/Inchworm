/**
 * The demo script's presentation logic (`scripts/format.ts`). It renders the only strings a human
 * reads — the cap badge and the status label. Coverage does not measure this
 * file (`vitest.config.ts` includes `src/core/**` only), so these assertions are
 * the whole safety net.
 */

import { describe, expect, test } from 'vitest'
import { parseNote } from '@core/note.js'
import type { WikiFileKind } from '@core/classify.js'
import { badge, statusLabel } from '../scripts/format.js'

const REGISTER: WikiFileKind = { kind: 'register', register: 'decisions' }
const NOTE: WikiFileKind = { kind: 'note', number: 3, topic: 'storage' }
const JOURNAL: WikiFileKind = { kind: 'journal', date: '2026-08-19', slug: 'x' }

describe('badge', () => {
  test.each([
    ['uncapped', { kind: 'uncapped', lines: 42 } as const, '42ℓ'],
    ['ok', { kind: 'ok', lines: 16, cap: 60, fraction: 16 / 60 } as const, '16/60'],
    ['near', { kind: 'near', lines: 83, cap: 100, fraction: 0.83 } as const, '83/100  ← near cap'],
    ['over', { kind: 'over', lines: 103, cap: 100, fraction: 1.03 } as const, '103/100  ← over cap'],
  ])('renders %s', (_label, status, expected) => {
    expect(badge(status)).toBe(expected)
  })
})

describe('statusLabel', () => {
  test('malformed frontmatter is shouted, because it is the one thing to fix', () => {
    expect(statusLabel(parseNote('---\nstatus: [active\n---\n'), NOTE)).toBe('BROKEN FRONTMATTER')
  })

  test('an empty header is not malformed and says nothing', () => {
    expect(statusLabel(parseNote('---\n---\n\n# t\n'), NOTE)).toBe('')
  })

  test('a register carrying no frontmatter is normal, not broken', () => {
    expect(statusLabel(parseNote('# decisions\n'), REGISTER)).toBe('register')
  })

  test('a journal entry with session-log frontmatter reads as a session log', () => {
    expect(statusLabel(parseNote('---\ndate: 2026-08-19\nkind: session\n---\n'), JOURNAL)).toBe('session log')
  })

  test.each([
    ['active', 'active'],
    ['proposal', 'proposal'],
    ['superseded-by-04', 'superseded-by-4'],
  ])('a status of %s renders as %s', (status, expected) => {
    expect(statusLabel(parseNote(`---\nstatus: ${status}\n---\n`), NOTE)).toBe(expected)
  })
})

describe('a file over the parse budget is reported, not skipped', () => {
  test('the label names the measure and both numbers, so the reader can act on it', () => {
    const label = statusLabel(parseNote('>'.repeat(50_000)), NOTE)
    expect(label).toContain('UNPARSED')
    expect(label).toContain('deepest')
    expect(label).toContain('50000')
  })

  test('an oversized file says so in characters, not in nesting', () => {
    const label = statusLabel(parseNote('a'.repeat(200_000)), NOTE)
    expect(label).toContain('UNPARSED')
    expect(label).toContain('200000')
  })
})
