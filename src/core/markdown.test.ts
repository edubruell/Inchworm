/**
 * The one parse, and the walk over what it produces. Both must be total: a file
 * an agent wrote is untrusted input, and a note deep enough to overflow a
 * recursive walk is a file, not an attack.
 */

import type { Nodes } from 'mdast'
import { describe, expect, test } from 'vitest'
import { lineOf, toMdast, walk } from './markdown.js'

describe('toMdast', () => {
  test('an opening --- block is a yaml node, not a thematic break', () => {
    const root = toMdast('---\nstatus: active\n---\n\n# title\n')
    expect(root.children[0]).toMatchObject({ type: 'yaml', value: 'status: active' })
  })

  test('a --- further down the file stays a thematic break', () => {
    const root = toMdast('# title\n\n---\n\nbody\n')
    expect(root.children.map((child) => child.type)).toEqual(['heading', 'thematicBreak', 'paragraph'])
  })
})

describe('walk', () => {
  test('visits the root and every descendant, depth first', () => {
    const seen: string[] = []
    walk(toMdast('# a\n\n- b\n'), (node) => seen.push(node.type))
    expect(seen).toEqual(['root', 'heading', 'text', 'list', 'listItem', 'paragraph', 'text'])
  })

  test('a leaf node is visited once', () => {
    const seen: string[] = []
    walk({ type: 'text', value: 'x' }, (node) => seen.push(node.type))
    expect(seen).toEqual(['text'])
  })

  test('a deeply nested document does not blow the stack — `parseNote` is total', () => {
    // A recursive walk throws a RangeError on a 5 KB file of this shape.
    // Built rather than parsed: since `remark-gfm` joined the pipeline the
    // parser itself overflows on this shape, which is `parseNote`'s problem to
    // refuse and not this walk's to survive.
    let deep: Nodes = { type: 'text', value: 'x' }
    for (let i = 0; i < 20000; i += 1) deep = { type: 'blockquote', children: [deep as never] }
    let visited = 0
    expect(() => {
      walk(deep, () => {
        visited += 1
      })
    }).not.toThrow()
    expect(visited).toBeGreaterThan(20000)
  })

  test('children are visited in document order', () => {
    const seen: string[] = []
    walk(toMdast('# a\n\nb\n\n## c\n'), (node) => {
      if (node.type === 'text') seen.push(node.value)
    })
    expect(seen).toEqual(['a', 'b', 'c'])
  })

  describe('lineOf', () => {
    test('reports a parsed node\'s 1-based source line', () => {
      const headings = toMdast('\n\n# a\n').children
      expect(headings[0] && lineOf(headings[0])).toBe(3)
    })

    test('a synthetic node has no position and reports line 1', () => {
      expect(lineOf({ type: 'text', value: 'x' })).toBe(1)
    })
  })
})
