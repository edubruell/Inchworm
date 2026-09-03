/**
 * The containment primitives, and the shapes that must never become an `fs`
 * call. Refusal is half the contract.
 */

import { describe, expect, test } from 'vitest'
import { insideRoot, isContained, isDotPath, relativePosix } from './paths.js'

describe('isContained', () => {
  test.each([
    ['/a/project', '/a/project', true, 'the root itself'],
    ['/a/project', '/a/project/wiki/00_state.md', true, 'a file beneath it'],
    ['/a/project', '/a/project-evil/secrets.md', false, 'a sibling with the root as a prefix'],
    ['/a/project', '/a/pro', false, 'a shorter sibling'],
    ['/a/project', '/etc/passwd', false, 'somewhere else entirely'],
    ['/a/project/', '/a/project/note.md', true, 'a root spelled with a trailing slash'],
  ])('%s contains %s → %s (%s)', (root, candidate, expected, _why: string) => {
    expect(isContained(root, candidate)).toBe(expected)
  })
})

describe('insideRoot', () => {
  test('resolves a project-relative path', () => {
    expect(insideRoot('/a/project', 'local_context/wiki/00_state.md')).toBe(
      '/a/project/local_context/wiki/00_state.md',
    )
  })

  // Refusal is half the contract: these are the shapes
  // that must never become an `fs` call, whatever else the app gets wrong.
  test.each([
    ['../../../etc/passwd', 'a traversal'],
    ['wiki/../../outside.md', 'a traversal that starts inside'],
    ['/etc/passwd', 'an absolute path'],
    ['..', 'the parent itself'],
  ])('refuses %s (%s)', (relPath, _why: string) => {
    expect(insideRoot('/a/project', relPath)).toBeUndefined()
  })

  test('a normalised path that stays inside is accepted', () => {
    expect(insideRoot('/a/project', 'wiki/../notes/x.md')).toBe('/a/project/notes/x.md')
  })
})

describe('isDotPath', () => {
  test.each(['.git/config', 'wiki/.git/config', '.DS_Store', 'wiki/.hidden.md', 'a/b/.c/d.md'])(
    '%s is dotted',
    (path) => {
      expect(isDotPath(path)).toBe(true)
    },
  )

  // The question is asked of the project-relative path on purpose: the absolute
  // path of a project living under `~/.claude/` is dotted and its files are not.
  test.each(['wiki/00_state.md', 'CLAUDE.md', 'notes/2026-08-19_x.md', 'a.b/c.md'])('%s is not', (path) => {
    expect(isDotPath(path)).toBe(false)
  })
})

describe('relativePosix', () => {
  test('is project-relative and slash-separated', () => {
    expect(relativePosix('/a/project', '/a/project/local_context/wiki/00_state.md')).toBe(
      'local_context/wiki/00_state.md',
    )
  })
})
