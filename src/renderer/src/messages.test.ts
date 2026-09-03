/**
 * Every wire error as a sentence. The renderer invents no failures of its own,
 * so this file is where a new error kind is noticed missing.
 */

import { describe, expect, test } from 'vitest'
import type { FileError, OpenProjectError, SettingsError, SkillError } from '@shared/api.js'
import { fileMessage, markerAdvice, openProjectMessage, ptyMessage, settingsMessage, skillMessage, skillStateMessage } from './messages.js'

const fileErrors: readonly FileError[] = [
  { kind: 'bad-request' },
  { kind: 'outside-project' },
  { kind: 'not-found' },
  { kind: 'too-large', bytes: 2_500_000 },
  { kind: 'unreadable', detail: 'EACCES' },
  { kind: 'conflict', currentSha: 'abc' },
  { kind: 'no-project' },
]

const openErrors: readonly OpenProjectError[] = [
  { kind: 'bad-request' },
  { kind: 'not-a-directory' },
  { kind: 'no-llmwiki', dir: '/p', markers: { agentFiles: [], wiki: false } },
  { kind: 'no-llmwiki', dir: '/p', markers: { agentFiles: ['CLAUDE.md'], wiki: true }, detail: 'no-wiki-root' },
]

const settingsErrors: readonly SettingsError[] = [
  { kind: 'bad-request' },
  { kind: 'no-launchers' },
  { kind: 'too-many-launchers' },
  { kind: 'empty-field', field: 'label' },
  { kind: 'too-long', field: 'command' },
  { kind: 'duplicate-id' },
  { kind: 'bad-tag' },
]

const skillErrors: SkillError[] = [
  { kind: 'bad-request' },
  { kind: 'no-bundle', detail: '/nowhere' },
  { kind: 'conflict', currentSha: 'abc' },
  { kind: 'unreadable', detail: 'EACCES' },
  { kind: 'unwritable', detail: 'EROFS' },
]

describe('every wire error becomes a sentence', () => {
  test.each(skillErrors)('skillMessage($kind)', (error) => {
    const message = skillMessage(error)
    expect(message.length).toBeGreaterThan(10)
    expect(message).not.toContain(error.kind)
  })

  test.each(['absent', 'current', 'differs'] as const)('skillStateMessage(%s)', (state) => {
    const message = skillStateMessage({ state, sha: '', files: 6 })
    expect(message.length).toBeGreaterThan(10)
    expect(message).not.toContain(state)
  })

  // The refusal the guard exists for must not read as "it worked".
  test('a conflict says nothing was written', () => {
    expect(skillMessage({ kind: 'conflict', currentSha: 'abc' })).toContain('nothing was written')
  })
  // A message that leaks `kind` is a message nobody wrote — the union is
  // exhaustive here so the compiler catches a new arm, and this catches a
  // placeholder that shipped.
  test.each(fileErrors)('fileMessage($kind)', (error) => {
    const message = fileMessage(error)
    expect(message.length).toBeGreaterThan(10)
    expect(message).not.toContain(error.kind)
  })

  test.each(openErrors)('openProjectMessage($kind)', (error) => {
    expect(fileMessage({ kind: 'not-found' })).not.toBe(openProjectMessage(error))
    expect(openProjectMessage(error).length).toBeGreaterThan(10)
  })

  test('the size a file was refused at is shown in kB', () => {
    expect(fileMessage({ kind: 'too-large', bytes: 2_500_000 })).toContain('2500 kB')
  })

  test.each(settingsErrors)('settingsMessage($kind)', (error) => {
    const message = settingsMessage(error)
    expect(message.length).toBeGreaterThan(10)
    expect(message).not.toContain(error.kind)
  })

  test('a parse failure names the shape that was wrong, for the person who has to fix it', () => {
    expect(
      openProjectMessage({
        kind: 'no-llmwiki',
        dir: '/p',
        markers: { agentFiles: ['CLAUDE.md'], wiki: false },
        detail: 'unsafe-root',
      }),
    ).toContain('unsafe-root')
  })

  test('an empty folder and a half-finished init are told apart', () => {
    const empty = { kind: 'no-llmwiki', dir: '/p', markers: { agentFiles: [], wiki: false } } as const
    const halfway = { kind: 'no-llmwiki', dir: '/p', markers: { agentFiles: [], wiki: true } } as const

    expect(markerAdvice(empty)).toContain('Nothing here')
    expect(markerAdvice(halfway)).toContain('half-way')
    expect(markerAdvice(empty)).not.toBe(markerAdvice(halfway))
  })

  test('an agent file with no block gets advice about the block, not about the file', () => {
    const noBlock = {
      kind: 'no-llmwiki',
      dir: '/p',
      markers: { agentFiles: ['AGENTS.md'], wiki: false },
      detail: 'no-journal',
    } as const

    expect(markerAdvice(noBlock)).toContain('block')
  })
})

describe('ptyMessage', () => {
  test('every way a pane can fail to start has a sentence', () => {
    expect(ptyMessage({ kind: 'bad-request' })).toContain('bug in the app')
    expect(ptyMessage({ kind: 'no-project' })).toContain('no project')
    expect(ptyMessage({ kind: 'too-many' })).toContain('as many panes')
    // The detail is the whole point of this one: `claude` not being on PATH is
    // the ordinary case.
    expect(ptyMessage({ kind: 'spawn-failed', detail: 'claude: not found' })).toContain('claude: not found')
  })
})
