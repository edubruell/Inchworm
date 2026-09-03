/**
 * The one markdown parse in the app. We need an AST anyway — headings for the
 * outline, `[[links]]` for backlinks, frontmatter, line counts — so the
 * pipeline that hands one back is strictly better than a string→HTML renderer.
 *
 * Parsing only; `render.ts` turns this AST into sanitised HTML.
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import type { Nodes, Root } from 'mdast'

// GFM is in the pipeline because the schema is written in it: every register
// index, every budget row and half the design notes are tables, and without it
// the viewer would show them as literal pipes.
const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm)

export const toMdast = (text: string): Root => processor.parse(text)

const hasChildren = (node: Nodes): node is Extract<Nodes, { children: unknown[] }> => 'children' in node

/**
 * Depth-first walk, in document order. `core` carries its own visitor rather
 * than `unist-util-visit`: one fewer runtime dependency against a tight budget.
 *
 * **Iterative, not recursive.** The recursive version blows the stack on a 5 KB
 * file — `'>'.repeat(5000)` nests 5000 blockquotes — and throws a `RangeError`
 * out of `parseNote`, whose contract is totality.
 */
export const walk = (node: Nodes, visit: (node: Nodes) => void): void => {
  const stack: Nodes[] = [node]
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    visit(next)
    // Reversed, so the children come back off the stack in document order.
    if (hasChildren(next)) for (const child of [...next.children].reverse()) stack.push(child)
  }
}

/**
 * 1-based source line of a node. Everything remark parses carries a position;
 * a hand-built node does not, and reports line 1 rather than forcing every
 * caller to invent a fallback in a branch no test of *its* can reach.
 */
export const lineOf = (node: Nodes): number => node.position?.start.line ?? 1
