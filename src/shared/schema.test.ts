/**
 * The schemas are the boundary, so they are tested the way the boundary is
 * attacked: the happy path once, and every refusal the app depends on
 * — refusal is half the contract.
 */

import { describe, expect, test } from 'vitest'
import { MAX_FILE_BYTES } from './api.js'
import {
  hueSchema,
  killPtyInput,
  openExternalInput,
  installSkillInput,
  openProjectInput,
  readFileInput,
  resizePtyInput,
  startPtyInput,
  wikiPathSchema,
  writeFileInput,
  writePtyInput,
} from './schema.js'

describe('wikiPathSchema', () => {
  test.each(['local_context/wiki/00_state.md', 'CLAUDE.md', 'notes/2026-08-19_x.md', 'a b/c d.md'])(
    'accepts %s',
    (path) => {
      expect(wikiPathSchema.safeParse(path).success).toBe(true)
    },
  )

  test.each([
    ['', 'the empty path'],
    ['/etc/passwd', 'an absolute path'],
    ['~/secrets.md', 'a home-relative path'],
    ['../outside.md', 'a traversal'],
    ['wiki/../../outside.md', 'a traversal in the middle'],
    ['wiki\\..\\..\\outside.md', 'backslash separators'],
    ['wiki/00_state.md\0.png', 'a NUL byte'],
    [`${'a/'.repeat(600)}x.md`, 'a path past the length cap'],
    [42, 'a number'],
    [null, 'null'],
  ])('refuses %s (%s)', (path, _why: string) => {
    expect(wikiPathSchema.safeParse(path).success).toBe(false)
  })

  // `..` as a *name component* is a traversal; as a substring it is a filename.
  test('accepts a filename that merely contains dots', () => {
    expect(wikiPathSchema.safeParse('wiki/..hidden..md').success).toBe(true)
  })
})

describe('hueSchema', () => {
  test.each([0, 210, 359])('accepts %d', (hue) => {
    expect(hueSchema.safeParse(hue).success).toBe(true)
  })

  test.each([-1, 360, 210.5, Number.NaN, '210'])('refuses %s', (hue) => {
    expect(hueSchema.safeParse(hue).success).toBe(false)
  })
})

describe('openProjectInput', () => {
  test('takes an absolute directory', () => {
    expect(openProjectInput.safeParse({ dir: '/Users/x/project' }).success).toBe(true)
  })

  test.each([{ dir: 'project' }, { dir: '' }, {}, { dir: 4 }, undefined])('refuses %o', (payload) => {
    expect(openProjectInput.safeParse(payload).success).toBe(false)
  })
})

describe('installSkillInput', () => {
  test('takes the digest the sheet was shown', () => {
    expect(installSkillInput.safeParse({ baseSha: 'a'.repeat(64) }).success).toBe(true)
  })

  // `''` is the honest guard for "nothing was installed when I last looked", so
  // it is the one place a sha field must NOT be `min(1)`.
  test('takes an empty digest, which is what an uninstalled copy has', () => {
    expect(installSkillInput.safeParse({ baseSha: '' }).success).toBe(true)
  })

  test.each([{ baseSha: 'x'.repeat(65) }, { baseSha: 4 }, {}, undefined, null])('refuses %o', (payload) => {
    expect(installSkillInput.safeParse(payload).success).toBe(false)
  })
})

describe('writeFileInput', () => {
  test('takes a path, the text and the sha it started from', () => {
    expect(writeFileInput.safeParse({ path: 'wiki/x.md', text: '', baseSha: '' }).success).toBe(true)
  })

  // The sha guard is what makes concurrent editing safe;
  // a payload without one must not be accepted as "no base".
  test('refuses a payload with no baseSha', () => {
    expect(writeFileInput.safeParse({ path: 'wiki/x.md', text: 'x' }).success).toBe(false)
  })

  test('refuses text that is not a string', () => {
    expect(writeFileInput.safeParse({ path: 'wiki/x.md', text: null, baseSha: '' }).success).toBe(false)
  })

  // The schema's ceiling is deliberately coarse — code units, not bytes. The
  // cap that decides whether the file stays readable is `writeWikiFile`'s, so
  // that an oversized save is answered `too-large` and not `bad-request`
  // (`files.test.ts`, re-immersion 2026-09-02).
  test('a payload the bridge should not carry at all is refused here', () => {
    const text = 'x'.repeat(MAX_FILE_BYTES + 1)
    expect(writeFileInput.safeParse({ path: 'wiki/x.md', text, baseSha: '' }).success).toBe(false)
  })
})

describe('readFileInput', () => {
  test('is the path schema in a payload', () => {
    expect(readFileInput.safeParse({ path: '../escape.md' }).success).toBe(false)
    expect(readFileInput.safeParse({ path: 'wiki/x.md' }).success).toBe(true)
  })
})

describe('openExternalInput', () => {
  test('bounds the string and nothing more — the scheme allow-list is core’s', () => {
    expect(openExternalInput.safeParse({ url: 'https://example.com/' }).success).toBe(true)
    expect(openExternalInput.safeParse({ url: '' }).success).toBe(false)
    expect(openExternalInput.safeParse({ url: 'x'.repeat(2049) }).success).toBe(false)
    expect(openExternalInput.safeParse({}).success).toBe(false)
  })
})

describe('the terminal inputs', () => {
  test('the preset is an enum, so nothing a renderer sends can become a command line', () => {
    expect(startPtyInput.safeParse({ preset: 'agent', cols: 80, rows: 24 }).success).toBe(true)
    expect(startPtyInput.safeParse({ preset: '/bin/sh', cols: 80, rows: 24 }).success).toBe(false)
  })

  test('a geometry is bounded at both ends: `ioctl` takes a short, and zero columns reflow forever', () => {
    for (const bad of [0, -1, 1001, 1.5]) {
      expect(startPtyInput.safeParse({ preset: 'shell', cols: bad, rows: 24 }).success).toBe(false)
      expect(resizePtyInput.safeParse({ id: 1, cols: 80, rows: bad }).success).toBe(false)
    }
    expect(resizePtyInput.safeParse({ id: 1, cols: 1000, rows: 1000 }).success).toBe(true)
  })

  test('one message cannot push an unbounded string into a shell', () => {
    expect(writePtyInput.safeParse({ id: 1, data: 'ls\r' }).success).toBe(true)
    expect(writePtyInput.safeParse({ id: 1, data: 'x'.repeat(100_001) }).success).toBe(false)
  })

  test('a pane id is a positive integer, so a missing one cannot read as pane zero', () => {
    for (const bad of [0, -1, 1.5, '1']) {
      expect(killPtyInput.safeParse({ id: bad }).success).toBe(false)
      expect(writePtyInput.safeParse({ id: bad, data: 'x' }).success).toBe(false)
    }
    expect(killPtyInput.safeParse({ id: 1 }).success).toBe(true)
  })
})
