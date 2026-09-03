/**
 * `[[wikilinks]]`: what counts as one, what does not, and why the AST has to be
 * consulted at all. Every case here is one a plain regex over the file gets
 * wrong.
 */

import { describe, expect, test } from 'vitest'
import type { ProjectLayout } from './project.js'
import { backlinkIndex, buildLinkIndex, extractLinks, resolveLink } from './links.js'
import { toMdast } from './markdown.js'

const layout: ProjectLayout = { wikiRoot: 'wiki/', journal: 'notes/', kind: 'software' }
const linksIn = (text: string): ReturnType<typeof extractLinks> => extractLinks(toMdast(text), text)

describe('extractLinks', () => {
  test('reads target, anchor and label', () => {
    expect(linksIn('see [[04_storage#Format|the storage note]] today')).toEqual([
      {
        raw: '04_storage#Format|the storage note',
        target: '04_storage',
        anchor: 'Format',
        label: 'the storage note',
        line: 1,
        column: 5,
        offset: 4,
      },
    ])
  })

  test.each([
    // A markdown escape is the writer's habit, not a different file, and an
    // empty label is no label.
    ['[[05\\_plan]]', { target: '05_plan', anchor: undefined, label: undefined }],
    ['[[a#b\\_c]]', { target: 'a', anchor: 'b_c', label: undefined }],
    ['[[a|the \\*starred\\* one]]', { target: 'a', anchor: undefined, label: 'the *starred* one' }],
    ['[[a|]]', { target: 'a', anchor: undefined, label: undefined }],
    ['[[a| ]]', { target: 'a', anchor: undefined, label: undefined }],
    ['[[decisions]]', { target: 'decisions', anchor: undefined, label: undefined }],
    ['[[contentions#C1]]', { target: 'contentions', anchor: 'C1', label: undefined }],
    ['[[04_storage|storage]]', { target: '04_storage', anchor: undefined, label: 'storage' }],
    ['[[ a_note ]]', { target: 'a_note', anchor: undefined, label: undefined }],
  ])('%s parses its parts', (text, expected) => {
    expect(linksIn(text)[0]).toMatchObject(expected)
  })

  /**
   * The reason the AST is consulted at all: the wiki's own notes illustrate the
   * syntax inside code spans and fenced blocks. A plain regex over the file
   * reports these as dangling links.
   */
  test('a wikilink inside an inline code span is syntax, not a link', () => {
    expect(linksIn('the form `[[target|label]]` is a wikilink')).toEqual([])
  })

  test('a wikilink inside a fenced block is syntax, not a link', () => {
    expect(linksIn('```md\nSee [[99_missing]] for the shape.\n```\n')).toEqual([])
  })

  test('a link beside a code span is still found', () => {
    const found = linksIn('`[[not_a_link]]` but [[01_scope]] is one')
    expect(found.map((link) => link.target)).toEqual(['01_scope'])
  })

  test('finds every link in document order, across lines', () => {
    const found = linksIn('- [[a]] and [[b]]\n\n- [[c]]\n')
    expect(found.map((link) => link.target)).toEqual(['a', 'b', 'c'])
    expect(found.map((link) => link.line)).toEqual([1, 1, 3])
  })

  test('reports a usable column for the editor decoration', () => {
    const found = linksIn('xx [[a]]')
    expect(found[0]).toMatchObject({ line: 1, column: 4 })
  })

  // A node built by hand (a future transform, a test) has no position and so
  // marks no code range; the links in the source text are still found.
  test('a node without position hides nothing', () => {
    expect(extractLinks({ type: 'text', value: 'x' }, 'see [[01_scope]]')).toEqual([
      { raw: '01_scope', target: '01_scope', anchor: undefined, label: undefined, line: 1, column: 5, offset: 4 },
    ])
  })

  test.each([['[[]]'], ['[[a'], ['[ [a] ]'], ['[[a\nb]]']])('%j yields no link', (text) => {
    expect(linksIn(text)).toEqual([])
  })

  describe('links the AST-only walk used to lose silently (`findings` 2026-08-19)', () => {
    test('a label containing inline markup is still a link', () => {
      // remark splits the text run at the emphasis, so a scan over text nodes
      // never sees a whole `[[...]]` and the link vanishes — no marker, no
      // backlink.
      expect(linksIn('see [[04_storage|the *storage* note]] today')[0]).toMatchObject({
        target: '04_storage',
        label: 'the *storage* note',
      })
    })

    test('a link beside a matching link-reference definition survives', () => {
      const found = linksIn('[decisions]: http://example.com\n\nSee [[decisions]] here.\n')
      expect(found.map((link) => link.target)).toEqual(['decisions'])
    })

    test('a strikethrough label does not lose the link', () => {
      expect(linksIn('see [[04_storage|~~old~~ name]]').map((link) => link.target)).toEqual(['04_storage'])
    })

    test('a label containing brackets is still not a link: the syntax forbids them', () => {
      // Deliberately not a link — `[[a|[b]]]` has no
      // unambiguous end, so it is not a wikilink.
      expect(linksIn('see [[04_storage|[bracketed]]]')).toEqual([])
    })

    test('an indented code block is still code', () => {
      expect(linksIn('text\n\n    [[99_missing]]\n')).toEqual([])
    })

    test('an HTML block is not a link either', () => {
      expect(linksIn('<div>\n[[99_missing]]\n</div>\n')).toEqual([])
    })

    test('a wikilink in the frontmatter is frontmatter, not a body link', () => {
      expect(linksIn('---\nlinks: [[04_storage]]\n---\n\n# t\n')).toEqual([])
    })

    test.each([['[[#C1]]'], ['[[ ]]'], ['[[|label]]'], ['[[#]]']])(
      '%j names no file and so is not a link — it must not show as dangling',
      (text) => {
        expect(linksIn(text)).toEqual([])
      },
    )
  })
})

describe('buildLinkIndex + resolveLink', () => {
  const paths = [
    'wiki/00_state.md',
    'wiki/01_scope.md',
    'wiki/decisions.md',
    'wiki/archive/03_storage.md',
    'wiki/03_storage.md',
    'notes/2026-08-18_swap.md',
    'CLAUDE.md',
    'src/core/note.ts',
  ]
  const index = buildLinkIndex(paths, layout)

  test.each([
    ['01_scope', 'wiki/01_scope.md'],
    ['decisions', 'wiki/decisions.md'],
    ['00_state', 'wiki/00_state.md'],
    ['2026-08-18_swap', 'notes/2026-08-18_swap.md'],
  ])('[[%s]] resolves to %s', (target, path) => {
    expect(resolveLink(target, index)).toEqual({ status: 'resolved', path })
  })

  // The note is the live document; the archive holds its old body.
  test('the wiki note wins over an archived file of the same name', () => {
    expect(resolveLink('03_storage', index)).toEqual({ status: 'resolved', path: 'wiki/03_storage.md' })
  })

  test('files with no schema meaning are not link targets', () => {
    expect(resolveLink('note', index)).toEqual({ status: 'unresolved' })
    expect(resolveLink('CLAUDE', index)).toEqual({ status: 'unresolved' })
  })

  // A dangling link is a to-do in this schema, not an error.
  test('an unknown target is unresolved rather than a failure', () => {
    expect(resolveLink('99_missing', index)).toEqual({ status: 'unresolved' })
  })
})

describe('backlinkIndex', () => {
  const paths = ['wiki/00_state.md', 'wiki/01_scope.md', 'wiki/04_storage.md']
  const index = buildLinkIndex(paths, layout)
  const notes = [
    { path: 'wiki/00_state.md', links: linksIn('[[01_scope]] and [[04_storage|storage]] and [[99_missing]]') },
    { path: 'wiki/01_scope.md', links: linksIn('[[04_storage]]\n\n[[01_scope]]') },
  ]
  const backlinks = backlinkIndex(notes, index)

  test('reverses the link graph, keeping the label the author wrote', () => {
    expect(backlinks.get('wiki/04_storage.md')).toEqual([
      { from: 'wiki/00_state.md', line: 1, label: 'storage' },
      { from: 'wiki/01_scope.md', line: 1, label: undefined },
    ])
  })

  test('a note is not its own backlink', () => {
    expect(backlinks.get('wiki/01_scope.md')).toEqual([{ from: 'wiki/00_state.md', line: 1, label: undefined }])
  })

  test('an unresolved link has no page to hang on', () => {
    expect([...backlinks.keys()]).not.toContain('99_missing')
  })

  test('a note nobody links to has no entry', () => {
    expect(backlinks.get('wiki/00_state.md')).toBeUndefined()
  })

  test('the same target linked twice from one line is one backlink, not a doubled row', () => {
    const index = buildLinkIndex(['wiki/01_a.md', 'wiki/02_b.md'], layout)
    const notes = [{ path: 'wiki/01_a.md', links: linksIn('[[02_b]] and again [[02_b]]') }]
    expect(backlinkIndex(notes, index).get('wiki/02_b.md')).toEqual([
      { from: 'wiki/01_a.md', line: 1, label: undefined },
    ])
  })

  test('the same target linked from two lines is two backlinks', () => {
    const index = buildLinkIndex(['wiki/01_a.md', 'wiki/02_b.md'], layout)
    const notes = [{ path: 'wiki/01_a.md', links: linksIn('[[02_b]]\n\n[[02_b]]\n') }]
    expect(backlinkIndex(notes, index).get('wiki/02_b.md')).toHaveLength(2)
  })
})
