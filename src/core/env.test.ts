/**
 * The pane environment. The bug this guards against left no trace on disk: an
 * app launched from inside a Claude Code session made every pane's agent a
 * child session, and transcripts stopped being saved app-wide.
 */

import { describe, expect, test } from 'vitest'
import { isParentSessionVar, paneEnv } from './env.js'

describe('isParentSessionVar', () => {
  test('matches every marker a real Claude Code session sets', () => {
    const observed = [
      'CLAUDE_CODE_CHILD_SESSION',
      'CLAUDECODE',
      'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_CODE_BRIDGE_SESSION_ID',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_MESSAGING_SOCKET',
      'CLAUDE_CODE_MESSAGING_TOKEN',
      'CLAUDE_CODE_EXECPATH',
      'CLAUDE_PID',
      'CLAUDE_EFFORT',
    ]
    for (const name of observed) expect(isParentSessionVar(name)).toBe(true)
  })

  test('leaves credentials and the reader’s own configuration alone', () => {
    const kept = ['ANTHROPIC_API_KEY', 'PATH', 'SHELL', 'HOME', 'LANG', 'MY_CLAUDE_NOTES', 'CLAUDE_LIKE']
    for (const name of kept) expect(isParentSessionVar(name)).toBe(false)
  })
})

describe('paneEnv', () => {
  test('drops the parent session and keeps everything else', () => {
    expect(
      paneEnv({
        PATH: '/usr/bin',
        CLAUDE_CODE_CHILD_SESSION: '1',
        CLAUDECODE: '1',
        ANTHROPIC_API_KEY: 'sk-test',
      }),
    ).toEqual({ PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-test' })
  })

  test('drops unset values rather than passing the string "undefined" on', () => {
    expect(paneEnv({ PATH: '/usr/bin', EDITOR: undefined })).toEqual({ PATH: '/usr/bin' })
  })

  test('copies rather than mutates — the app’s own environment is untouched', () => {
    const source = { PATH: '/usr/bin', CLAUDE_CODE_SESSION_ID: 'abc' }
    paneEnv(source)
    expect(source.CLAUDE_CODE_SESSION_ID).toBe('abc')
  })

  test('an environment with nothing to strip survives whole', () => {
    const source = { PATH: '/usr/bin', HOME: '/Users/x' }
    expect(paneEnv(source)).toEqual(source)
  })
})
