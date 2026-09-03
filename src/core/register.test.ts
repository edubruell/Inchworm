/**
 * What a register contains, as opposed to how long it is. A fenced block is
 * illustration, not content — the number a new entry gets depends on it.
 */

import { describe, expect, test } from 'vitest'
import type { ProjectLayout } from './project.js'
import { contentionsFile, headings, openContentions } from './register.js'

const layout: ProjectLayout = { wikiRoot: 'wiki/', journal: 'notes/', kind: 'software' }

describe('openContentions', () => {
  const register = [
    '# contentions',
    '',
    'Never resolved silently.',
    '',
    '## C1 — a thing (existential)',
    'body',
    '### a sub-heading, which is inside C1',
    '',
    '## C2 — another thing (fragile)',
    '',
    '## C3 — settled (RESOLVED 2026-08-19)',
    '',
    '## Not a contention — a prose section of the register itself',
    '',
  ].join('\n')

  test('counts the `Cx` entries that carry no RESOLVED marker', () => {
    expect(openContentions(register)).toBe(2)
  })

  test('a heading that is not a `Cx` is not a contention', () => {
    expect(openContentions('## Notes on this register\n')).toBe(0)
  })

  test('a heading needs its space: `##nope` is not an entry', () => {
    expect(openContentions('##nope — C1\n## C1 — yes\n')).toBe(1)
  })

  test('double-digit contentions: the register does not stop at C9', () => {
    const many = ['## C9 — nine', '## C10 — ten', '## C15 — fifteen (RESOLVED 2026-08-19)'].join('\n')

    expect(openContentions(many)).toBe(2)
  })

  test('the marker is matched with its bracket and case-insensitively', () => {
    expect(openContentions('## C1 — done (Resolved 2026-01-01)\n')).toBe(0)
    // …but a contention *about* resolving something is still open.
    expect(openContentions('## C2 — when is a RESOLVED entry ever reopened?\n')).toBe(1)
  })

  test('a fenced example is illustration, not an entry', () => {
    const withTemplate = [
      '# contentions',
      '',
      'The shape of an entry:',
      '',
      '```markdown',
      '## Cx — <fragile assumption>',
      '```',
      '',
      '## C1 — a real one',
      '',
      '~~~',
      '## C2 — also an example, in a tilde fence',
      '~~~',
      '',
    ].join('\n')

    expect(openContentions(withTemplate)).toBe(1)
  })

  test('the shapes a wiki file can be at all: empty, CRLF, no trailing newline', () => {
    expect(openContentions('')).toBe(0)
    expect(openContentions('## C1 — one\r\n## C2 — two (RESOLVED 2026-08-19)\r\n')).toBe(1)
    expect(openContentions('## C1 — no newline at the end')).toBe(1)
  })
})

describe('contentionsFile', () => {
  test('finds the register wherever the wiki root is, and by kind, not by name', () => {
    const paths = ['wiki/00_state.md', 'wiki/contentions.md', 'notes/2026-08-19_contentions.md']

    expect(contentionsFile(paths, layout)).toBe('wiki/contentions.md')
  })

  test('a project without one gets undefined, not a guess', () => {
    expect(contentionsFile(['wiki/00_state.md'], layout)).toBeUndefined()
  })

  test('a file called contentions.md outside the wiki root is not the register', () => {
    expect(contentionsFile(['src/contentions.md', 'CLAUDE.md'], layout)).toBeUndefined()
  })
})

describe('headings', () => {
  test('an entry template shown in a fenced block is illustration, not an entry', () => {
    // The number a new entry gets is a function of this, so a fenced `## C9`
    // would otherwise push the next real contention to C10 (`templates.ts`).
    const register = ['# contentions', '', '## C1 — one', '', '```markdown', '## C9 — the template', '```', ''].join(
      '\n',
    )
    expect(headings(register)).toEqual(['C1 — one'])
  })

  test('`###` is inside an entry, not an entry', () => {
    expect(headings('## C1 — one\n\n### a sub-heading\n')).toEqual(['C1 — one'])
  })
})
