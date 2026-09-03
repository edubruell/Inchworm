/**
 * The four states a draft can be in, and the words that go with them. "Both
 * sides moved" is the one that must never be reported as anything else.
 */

import { describe, expect, test } from 'vitest'
import type { Draft } from './edit.js'
import { canSave, editLabel, editRole, editState } from './edit.js'

const draft = (over: Partial<Draft>): Draft => ({
  path: '00_state.md',
  text: 'a',
  savedText: 'a',
  baseSha: 'sha1',
  ...over,
})

describe('editState', () => {
  test('nothing moved on either side', () => {
    expect(editState(draft({}), 'sha1')).toBe('clean')
  })

  test('edited here only', () => {
    expect(editState(draft({ text: 'b' }), 'sha1')).toBe('dirty')
  })

  test('written there only — the draft can take the new bytes for free', () => {
    expect(editState(draft({}), 'sha2')).toBe('stale')
  })

  test('both sides moved: the case the whole guard exists for', () => {
    expect(editState(draft({ text: 'b' }), 'sha2')).toBe('diverged')
  })

  test('a file the store has not read yet is not evidence of a change', () => {
    // Undefined is "no answer", not "the file is gone": treating it as a move
    // would put a conflict banner over every draft during the first read.
    expect(editState(draft({}), undefined)).toBe('clean')
    expect(editState(draft({ text: 'b' }), undefined)).toBe('dirty')
  })
})

describe('canSave', () => {
  test('only a draft that holds something unwritten', () => {
    expect(canSave('dirty')).toBe(true)
    expect(canSave('diverged')).toBe(true)
    expect(canSave('clean')).toBe(false)
    // Stale with no local edits: there is nothing of ours to write.
    expect(canSave('stale')).toBe(false)
  })
})

describe('editLabel and editRole', () => {
  test('every state has a sentence, and no sentence is a colour', () => {
    for (const state of ['clean', 'dirty', 'stale', 'diverged'] as const) {
      expect(editLabel(state).length).toBeGreaterThan(0)
    }
    expect(editLabel('diverged')).toContain('overwrite')
  })

  test('a live region only where both sides hold something', () => {
    expect(editRole('clean')).toBeUndefined()
    expect(editRole('dirty')).toBeUndefined()
    expect(editRole('stale')).toBe('status')
    expect(editRole('diverged')).toBe('status')
  })
})
