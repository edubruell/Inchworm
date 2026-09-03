/**
 * `parseNote`: one file's text → everything the UI shows about it. Total by
 * design — any bytes are a parseable note, and the things that can be *wrong*
 * (malformed frontmatter, a dangling link, a file too pathological to parse)
 * are represented as states rather than raised as failures.
 */

import type { Nodes, Root } from 'mdast'
import type { ParseBudget, ParseRefusal } from './budget.js'
import type { Frontmatter, FrontmatterError } from './frontmatter.js'
import { PARSE_BUDGET, checkParseBudget } from './budget.js'
import type { WikiLink } from './links.js'
import type { Heading } from './outline.js'
import { parseFrontmatter } from './frontmatter.js'
import { extractLinks } from './links.js'
import { lineOf, toMdast, walk } from './markdown.js'
import { countLines } from './paths.js'

/**
 * Registers carry no frontmatter, so `absent` is the normal case for half the
 * schema — it is a state, not an error.
 */
export type FrontmatterState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'parsed'; readonly fields: Frontmatter }
  | { readonly kind: 'invalid'; readonly error: FrontmatterError }

export type ParsedNote = {
  readonly frontmatter: FrontmatterState
  readonly headings: readonly Heading[]
  readonly links: readonly WikiLink[]
  /** The unit the schema's caps are written in — see `countLines`. */
  readonly lineCount: number
  /** The first `#` heading, which is the note's own name for it. */
  readonly title: string | undefined
  readonly ast: Root
}

/**
 * A file the parse budget refused, and everything that can still be said about
 * it without a parse. `lineCount` is on both arms because the cap gauge is a
 * `wc -l`, not a parse: an oversized register still shows how far over it is.
 *
 * The file is **shown, not hidden** — the viewer falls back to raw text. The
 * failure the budget guards against is a frozen window; dropping the file would
 * trade that for a silent hole in the reader's memory, which is worse.
 */
export type NoteState =
  | ({ readonly kind: 'parsed' } & ParsedNote)
  | { readonly kind: 'unparsed'; readonly refusal: ParseRefusal; readonly lineCount: number }

/** The plain text of a heading, with inline markup flattened. */
const headingText = (node: Nodes): string => {
  const parts: string[] = []
  walk(node, (child) => {
    if (child.type === 'text' || child.type === 'inlineCode') parts.push(child.value)
  })
  return parts.join('').trim()
}

const collect = (root: Root): { headings: readonly Heading[]; frontmatter: FrontmatterState } => {
  const headings: Heading[] = []
  let frontmatter: FrontmatterState = { kind: 'absent' }

  walk(root, (node) => {
    if (node.type === 'heading') {
      headings.push({ depth: node.depth, text: headingText(node), line: lineOf(node) })
      return
    }
    // remark-frontmatter yields the block as a `yaml` node only when it opens
    // the file; a `---` fence further down stays a thematic break.
    if (node.type === 'yaml') {
      const parsed = parseFrontmatter(node.value)
      frontmatter = parsed.ok ? { kind: 'parsed', fields: parsed.value } : { kind: 'invalid', error: parsed.error }
    }
  })

  return { headings, frontmatter }
}

/**
 * The budget is checked **before** `toMdast`, not after: the whole point is
 * that the parse it guards cannot be interrupted once it has started.
 */
export const parseNote = (text: string, budget: ParseBudget = PARSE_BUDGET): NoteState => {
  const refusal = checkParseBudget(text, budget)
  if (refusal !== undefined) return { kind: 'unparsed', refusal, lineCount: countLines(text) }

  try {
    return parsed(text)
  } catch (error) {
    // The budget reads line prefixes, so it bounds container nesting and not
    // inline nesting, and the parse pipeline recurses over both. Totality is
    // the contract, so an overflow is a refusal.
    if (error instanceof RangeError) return { kind: 'unparsed', refusal: { kind: 'stack' }, lineCount: countLines(text) }
    throw error
  }
}

const parsed = (text: string): NoteState => {
  const ast = toMdast(text)
  const { headings, frontmatter } = collect(ast)
  return {
    kind: 'parsed',
    frontmatter,
    headings,
    links: extractLinks(ast, text),
    lineCount: countLines(text),
    title: headings.find((heading) => heading.depth === 1)?.text,
    ast,
  }
}
