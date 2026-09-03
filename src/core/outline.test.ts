/**
 * The heading tree, and its refusal to have an opinion: real notes skip levels
 * and start at `##`, and an outline that throws on one is worse than an outline
 * that indents oddly.
 */

import { describe, expect, test } from 'vitest'
import type { Heading } from './outline.js'
import { outline } from './outline.js'

const h = (depth: number, text: string, line = depth): Heading => ({ depth, text, line })

const shape = (nodes: ReturnType<typeof outline>): unknown =>
  nodes.map((node) => ({ text: node.heading.text, children: shape(node.children) }))

describe('outline', () => {
  test('nests by depth', () => {
    expect(shape(outline([h(1, 'title'), h(2, 'a'), h(3, 'a1'), h(2, 'b')]))).toEqual([
      {
        text: 'title',
        children: [
          { text: 'a', children: [{ text: 'a1', children: [] }] },
          { text: 'b', children: [] },
        ],
      },
    ])
  })

  test('a note that starts at ## has several roots', () => {
    expect(shape(outline([h(2, 'a'), h(2, 'b')]))).toEqual([
      { text: 'a', children: [] },
      { text: 'b', children: [] },
    ])
  })

  // Real notes skip levels; an outline that throws on one is worse than an
  // outline that indents oddly.
  test('a skipped level does not lose a heading', () => {
    expect(shape(outline([h(1, 'title'), h(4, 'deep'), h(2, 'back')]))).toEqual([
      { text: 'title', children: [{ text: 'deep', children: [] }, { text: 'back', children: [] }] },
    ])
  })

  test('a deeper first heading still roots the tree', () => {
    expect(shape(outline([h(3, 'deep'), h(1, 'title')]))).toEqual([
      { text: 'deep', children: [] },
      { text: 'title', children: [] },
    ])
  })

  test('no headings is an empty outline', () => {
    expect(outline([])).toEqual([])
  })
})
