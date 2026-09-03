/**
 * The app's own preferences: what is refused on the way in from the sheet, and
 * what is repaired on the way out of a file nobody typed today. The two are
 * deliberately different answers.
 */

import { describe, expect, test } from 'vitest'
import {
  DEFAULT_SETTINGS,
  freeLauncherId,
  launcherFor,
  MAX_LAUNCHERS,
  repairSettings,
  validateSettings,
  type Launcher,
  type Settings,
} from './settings.js'

const launcher = (id: string, command = id): Launcher => ({ id, label: id, command })

const settings = (ids: readonly string[], defaultLauncherId = ids[0] ?? ''): Settings => ({
  launchers: ids.map((id) => launcher(id)),
  defaultLauncherId,
  noteTag: 'eddy',
})

describe('validateSettings', () => {
  test('a list with a default in it passes through unchanged', () => {
    const input = settings(['claude', 'codex'], 'codex')
    expect(validateSettings(input)).toEqual({ ok: true, value: input })
  })

  test('an empty list is refused rather than repaired — the sheet must say so', () => {
    expect(validateSettings({ launchers: [], defaultLauncherId: 'claude', noteTag: 'eddy' })).toEqual({
      ok: false,
      error: { kind: 'no-launchers' },
    })
  })

  test.each([
    [{ id: 'a', label: '  ', command: 'claude' }, { kind: 'empty-field', field: 'label' }],
    [{ id: 'a', label: 'a', command: '   ' }, { kind: 'empty-field', field: 'command' }],
    [{ id: 'a', label: 'x'.repeat(41), command: 'c' }, { kind: 'too-long', field: 'label' }],
    [{ id: 'a', label: 'a', command: 'c'.repeat(201) }, { kind: 'too-long', field: 'command' }],
  ])('a blank or oversized field is named, not trimmed away', (row, error) => {
    expect(validateSettings({ launchers: [row], defaultLauncherId: 'a', noteTag: 'eddy' })).toEqual({
      ok: false,
      error,
    })
  })

  test('two rows with one id is a refusal — an id is what the wire carries', () => {
    expect(validateSettings(settings(['a', 'a']))).toEqual({ ok: false, error: { kind: 'duplicate-id' } })
  })

  test('more rows than the menu can hold is a refusal', () => {
    const many = Array.from({ length: MAX_LAUNCHERS + 1 }, (_, index) => `a${String(index)}`)
    expect(validateSettings(settings(many))).toEqual({ ok: false, error: { kind: 'too-many-launchers' } })
  })

  test('a default naming a deleted row falls to the first, because deleting it is ordinary', () => {
    const result = validateSettings(settings(['codex', 'pi'], 'claude'))
    expect(result.ok && result.value.defaultLauncherId).toBe('codex')
  })
})

describe('repairSettings — a file nobody typed today', () => {
  test('an unusable row is dropped and the rest survive', () => {
    const repaired = repairSettings({
      launchers: [launcher('claude'), { id: 'broken', label: '', command: '' }, launcher('codex')],
      defaultLauncherId: 'codex',
      noteTag: 'eddy',
    })

    expect(repaired.launchers.map((l) => l.id)).toEqual(['claude', 'codex'])
    expect(repaired.defaultLauncherId).toBe('codex')
  })

  test('a duplicate id keeps the first row only', () => {
    const repaired = repairSettings({
      launchers: [launcher('a', 'first'), launcher('a', 'second')],
      defaultLauncherId: 'a',
      noteTag: 'eddy',
    })

    expect(repaired.launchers).toEqual([launcher('a', 'first')])
  })

  test('a file with nothing usable in it is the defaults, never an empty menu', () => {
    expect(repairSettings({ launchers: [], defaultLauncherId: 'x', noteTag: 'eddy' })).toEqual(DEFAULT_SETTINGS)
  })

  test('a list past the ceiling is cut to it rather than refused', () => {
    const many = Array.from({ length: MAX_LAUNCHERS + 3 }, (_, index) => `a${String(index)}`)
    expect(repairSettings(settings(many)).launchers).toHaveLength(MAX_LAUNCHERS)
  })
})

describe('the note tag', () => {
  test('a name the app cannot write into a file is refused, in its own words', () => {
    expect(validateSettings({ ...settings(['claude']), noteTag: 'has space' })).toEqual({
      ok: false,
      error: { kind: 'bad-tag' },
    })
    expect(validateSettings({ ...settings(['claude']), noteTag: '' })).toEqual({
      ok: false,
      error: { kind: 'bad-tag' },
    })
  })

  test('a hand-edited file with a broken tag keeps its launchers and takes the default tag', () => {
    const repaired = repairSettings({ ...settings(['claude', 'codex']), noteTag: '<oops>' })

    expect(repaired.noteTag).toBe(DEFAULT_SETTINGS.noteTag)
    expect(repaired.launchers).toHaveLength(2)
  })

  test('a good tag survives both paths unchanged', () => {
    const input = settings(['claude'])
    expect(validateSettings(input)).toEqual({ ok: true, value: input })
    expect(repairSettings(input).noteTag).toBe('eddy')
  })
})

describe('launcherFor', () => {
  const two = settings(['claude', 'codex'], 'codex')

  test('names one, gets that one', () => {
    expect(launcherFor(two, 'claude')?.id).toBe('claude')
  })

  test('names none, gets the default — not the first row', () => {
    expect(launcherFor(two, undefined)?.id).toBe('codex')
  })

  test('names one that is gone, gets the default rather than nothing', () => {
    expect(launcherFor(two, 'deleted')?.id).toBe('codex')
  })
})

describe('freeLauncherId', () => {
  test('a label becomes a slug', () => {
    expect(freeLauncherId(settings([]), 'Codex CLI')).toBe('codex-cli')
  })

  test('a taken slug is numbered from 2', () => {
    expect(freeLauncherId(settings(['codex']), 'codex')).toBe('codex-2')
    expect(freeLauncherId(settings(['codex', 'codex-2']), 'codex')).toBe('codex-3')
  })

  test('a label with nothing sluggable in it still yields an id', () => {
    expect(freeLauncherId(settings([]), '···')).toBe('agent')
  })
})
