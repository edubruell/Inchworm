/**
 * The accessibility floor, asserted where it is decided.
 * Every case here is the same question: could a reader who sees no colour still
 * tell what this row is saying?
 */

import { describe, expect, test } from 'vitest'
import type { CapStatus } from '@core/caps.js'
import { capStatus } from '@core/caps.js'
import { PRESETS } from '@shared/api.js'
import {
  capLabel,
  capRole,
  capTitle,
  contentionsLabel,
  presetLabel,
  presetShade,
  statusGlyph,
  statusLabel,
  unsavedLabel,
} from './signals.js'

const cap = (lines: number, limit: number | undefined): CapStatus => capStatus(lines, limit)

describe('a cap breach is a word, not a colour', () => {
  test.each([
    ['over', cap(105, 100), 'alert', 'over'],
    ['near', cap(90, 100), 'status', 'near cap'],
  ])('%s cap announces itself', (_name, status, role, word) => {
    expect(capRole(status)).toBe(role)
    expect(capLabel(status, true)).toContain(word)
  })

  test('a file with room announces nothing — a live region per row is noise', () => {
    expect(capRole(cap(10, 100))).toBeUndefined()
    expect(capRole(cap(10, undefined))).toBeUndefined()
  })

  test('the short form still carries the breach', () => {
    expect(capLabel(cap(105, 100), false)).toBe('105/100 over')
    expect(capLabel(cap(90, 100), false)).toBe('90/100')
  })

  test('an uncapped file reports its length and says the cap does not apply', () => {
    expect(capLabel(cap(240, undefined), true)).toBe('240 lines')
    expect(capTitle(cap(240, undefined))).toContain('no cap')
    expect(capTitle(cap(48, 60))).toBe('48 of 60 lines')
  })
})

describe('a status is a glyph and a word, never a hue alone', () => {
  test.each([
    [{ kind: 'active' } as const, '⬤', 'active'],
    [{ kind: 'proposal' } as const, '◐', 'proposal'],
    [{ kind: 'superseded', by: 4 } as const, '○', 'superseded by 4'],
  ])('%o', (status, glyph, label) => {
    expect(statusGlyph(status)).toBe(glyph)
    expect(statusLabel(status)).toBe(label)
  })

  test('the three glyphs are distinguishable from each other', () => {
    const glyphs = [statusGlyph({ kind: 'active' }), statusGlyph({ kind: 'proposal' }), statusGlyph({ kind: 'superseded', by: 1 })]
    expect(new Set(glyphs).size).toBe(3)
  })
})

describe('contentionsLabel', () => {
  test('zero is shown, not hidden: "none open" is a real state of a project', () => {
    expect(contentionsLabel(0)).toBe('no open contentions')
  })

  test('one is singular', () => {
    expect(contentionsLabel(1)).toBe('1 open contention')
  })

  test('more than one is a count and a noun, never a bare dot', () => {
    expect(contentionsLabel(7)).toBe('7 open contentions')
  })
})

describe('unsavedLabel', () => {
  test('counts files, and keeps the singular singular', () => {
    expect(unsavedLabel(1)).toBe('1 unsaved file')
    expect(unsavedLabel(3)).toBe('3 unsaved files')
  })
})

describe('the terminal presets', () => {
  test('every pane has a name, so the shades are never the only difference', () => {
    for (const preset of PRESETS) expect(presetLabel(preset).length).toBeGreaterThan(0)
    expect(new Set(PRESETS.map(presetLabel)).size).toBe(PRESETS.length)
  })

  test('the agent is the loudest and a plain shell is neutral — one hue, three shades', () => {
    expect(presetShade('agent')).toBe('loud')
    expect(presetShade('shell')).toBe('none')
  })
})
