/**
 * Path arithmetic with no `node:path`. `isInside` is a *prefix* test and says so
 * here, because the containment check the app relies on is main's — reaching for
 * this one instead is the mistake worth documenting.
 */

import { describe, expect, test } from 'vitest'
import {
  asDirPrefix,
  basename,
  countLines,
  isInside,
  isMarkdown,
  isUnder,
  parentDir,
  relativeTo,
  stem,
} from './paths.js'

describe('paths', () => {
  test.each([
    ['a/b/c.md', 'c.md'],
    ['c.md', 'c.md'],
    ['a/b/', ''],
  ])('basename(%s) is %s', (path, expected) => {
    expect(basename(path)).toBe(expected)
  })

  test.each([
    ['wiki/01_scope.md', '01_scope'],
    ['wiki/00_state.md', '00_state'],
    ['README', 'README'],
    // A dotfile is all name, not all extension.
    ['.gitignore', '.gitignore'],
    ['a/b.test.ts', 'b.test'],
  ])('stem(%s) is %s', (path, expected) => {
    expect(stem(path)).toBe(expected)
  })

  test.each([
    ['/Users/ebr/projects/wikiviewer', '/Users/ebr/projects'],
    // A trailing slash is not a level of its own.
    ['/Users/ebr/projects/wikiviewer/', '/Users/ebr/projects'],
    // Nothing above the root, and nothing above a bare name: `''`, never `/`.
    ['/wikiviewer', ''],
    ['wikiviewer', ''],
    ['/', ''],
  ])('parentDir(%s) is %s', (path, expected) => {
    expect(parentDir(path)).toBe(expected)
  })

  test.each([
    ['a/b.md', true],
    ['a/b.MD', true],
    ['a/b.markdown', false],
    ['a/md', false],
  ])('isMarkdown(%s) is %s', (path, expected) => {
    expect(isMarkdown(path)).toBe(expected)
  })

  test.each([
    ['local_context/wiki/', 'local_context/wiki/'],
    ['local_context/wiki', 'local_context/wiki/'],
    ['./local_context/wiki//', 'local_context/wiki/'],
    ['', ''],
    ['/', ''],
  ])('asDirPrefix(%s) is %s', (dir, expected) => {
    expect(asDirPrefix(dir)).toBe(expected)
  })

  describe('isInside', () => {
    test('matches at any depth and rejects a sibling with a shared prefix', () => {
      expect(isInside('wiki/a.md', 'wiki')).toBe(true)
      expect(isInside('wiki/archive/a.md', 'wiki')).toBe(true)
      expect(isInside('wikipedia/a.md', 'wiki')).toBe(false)
      expect(isInside('other/a.md', 'wiki')).toBe(false)
    })

    test('a directory is not inside itself', () => {
      expect(isInside('wiki', 'wiki')).toBe(false)
    })

    test('nothing is inside the empty prefix — "no directory" must never mean "everything"', () => {
      for (const dir of ['', '.', './', './/']) expect(isInside('anything/at/all.md', dir)).toBe(false)
    })

    test('`..` is not a containment check: it is a prefix test, and says so', () => {
      // Absolute-path containment is main's; this documents that `isInside` is
      // not the function to reach for.
      expect(isInside('wiki/../../etc/passwd', 'wiki')).toBe(true)
    })
  })

  describe('isUnder', () => {
    test('an empty layout root is the project root and contains everything', () => {
      for (const dir of ['', '.', './']) expect(isUnder('anything/at/all.md', dir)).toBe(true)
    })

    test('a named layout root behaves exactly like isInside', () => {
      expect(isUnder('wiki/a.md', 'wiki/')).toBe(true)
      expect(isUnder('notes/a.md', 'wiki/')).toBe(false)
    })
  })

  describe('relativeTo', () => {
    test('strips the prefix, and leaves a path from elsewhere alone', () => {
      expect(relativeTo('wiki/archive/a.md', 'wiki/')).toBe('archive/a.md')
      expect(relativeTo('notes/a.md', 'wiki/')).toBe('notes/a.md')
    })
  })

  describe('countLines', () => {
    // These are the numbers every cap badge is computed from: `wc -l`.
    test.each([
      ['', 0],
      ['a\n', 1],
      ['a', 1],
      ['a\nb\n', 2],
      ['a\nb', 2],
      ['\n', 1],
      ['a\n\n', 2],
    ])('countLines(%j) is %i', (text, expected) => {
      expect(countLines(text)).toBe(expected)
    })
  })
})
