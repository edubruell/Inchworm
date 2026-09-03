/**
 * The other half of the markdown pipeline: the mdast `parseNote` already built
 * → sanitised HTML for the viewer. Nothing here re-parses: `renderHtml` takes
 * the AST *and the links `parseNote` found*, so a note is parsed once per
 * change no matter how many panes show it.
 *
 * Three responsibilities, all of them safety:
 *
 * 1. **Raw HTML never survives.** `remark-rehype` drops `html` nodes (we never
 *    pass `allowDangerousHtml`) and `rehype-sanitize` runs anyway as the second
 *    wall — a note is untrusted input, because an agent writes it.
 * 2. **`[[links]]` become elements here**, so no component pattern-matches the
 *    schema — and they are placed by the *source offsets* `extractLinks`
 *    reported, not by a second regex over the rendered text. Scanning text
 *    nodes is the same rule one layer too low: remark splits a run of text at
 *    every inline construct, so `[[a|the *b* note]]` would render literally
 *    while the backlink panel counted it as a link. Offsets make that drift
 *    unrepresentable.
 * 3. **An unresolved link is not clickable** — it renders as a `span`, so "a
 *    dangling link is a to-do" is the *type* of the node rather than a class
 *    name a stylesheet might forget.
 */

import type { Root as MdastRoot } from 'mdast'
import type { Element, ElementContent, Nodes as HastNodes, Root as HastRoot } from 'hast'
import { unified } from 'unified'
import remarkRehype from 'remark-rehype'
import type { Options as SanitizeSchema } from 'rehype-sanitize'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import type { LinkResolution, WikiLink } from './links.js'
import type { Result } from './result.js'
import { err, ok } from './result.js'

/**
 * GitHub's schema plus exactly the two shapes we mint. The class values are
 * pinned as literals rather than allowing `className` through: a note then
 * cannot hand-write markup that *looks* like a resolved wikilink, and the
 * viewer's click handler can trust what it finds in the DOM.
 */
const SANITIZE_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // One `className` rule per tag wins, so the footnote class the default
    // schema allows has to be re-stated here rather than appended after it.
    a: [
      ...(defaultSchema.attributes?.a ?? []).filter((rule) => !Array.isArray(rule) || rule[0] !== 'className'),
      ['className', 'wikilink', 'data-footnote-backref'],
      'dataTarget',
      'dataPath',
    ],
    span: [['className', 'wikilink-broken'], 'dataTarget'],
  },
}

const toHast = unified().use(remarkRehype)
const toHtml = unified().use(rehypeSanitize, SANITIZE_SCHEMA).use(rehypeStringify)

/** The viewer falls back to the raw text it already has, exactly as for an unparsed note. */
export type RenderRefusal = { readonly kind: 'too-deep' }

const text = (value: string): ElementContent => ({ type: 'text', value })

/**
 * One `[[link]]` as an element. The resolved arm carries the project-relative
 * path, so the viewer navigates by path and never re-derives a target; the
 * unresolved arm carries a sentence, because red alone is not a signal.
 *
 * The shown text is plain: a label may span inline markup (`[[a|the *b* note]]`)
 * and a link's own emphasis is not worth a second tree walk.
 */
const linkElement = (link: WikiLink, resolve: (target: string) => LinkResolution): ElementContent => {
  const shown = link.label ?? (link.anchor === undefined ? link.target : `${link.target}#${link.anchor}`)
  const resolution = resolve(link.target)

  if (resolution.status === 'unresolved') {
    return {
      type: 'element',
      tagName: 'span',
      properties: {
        className: ['wikilink-broken'],
        dataTarget: link.target,
        title: `Unresolved link: no file named ${link.target}`,
      },
      children: [text(shown)],
    }
  }
  // `href` is a fragment, not a route: the viewer intercepts the click and the
  // window never navigates (main confines navigation as the backstop). It is an
  // anchor at all so that the link is focusable and announced as one.
  return {
    type: 'element',
    tagName: 'a',
    properties: {
      className: ['wikilink'],
      href: '#',
      dataTarget: link.target,
      dataPath: resolution.path,
      title: resolution.path,
    },
    children: [text(shown)],
  }
}

type Positioned = { readonly start: number; readonly end: number }

/**
 * A node's source span. Both ends come from the position remark recorded —
 * **never from the length of the text**: inside an indented list item the value
 * of a text node is shorter than the source it covers, because the continuation
 * line's indentation is not part of it. Deriving the end by arithmetic puts the
 * cut two characters off, which leaks half a link's source into the page.
 */
const spanOf = (node: ElementContent): Positioned | undefined => {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  return start === undefined || end === undefined ? undefined : { start, end }
}

/** What splitting one text node produced, plus a link left open past its end. */
type Split = { readonly nodes: readonly ElementContent[]; readonly open: WikiLink | undefined }

/** A split in progress: where in the value it has got to, and what is open. */
type Step = Split & { readonly cursor: number }

/**
 * The forms a link's source can take once remark has decoded the text it lives
 * in. The value of a text node is **markdown-decoded** — `\_` is `_`, `&amp;` is
 * `&` — while `raw` came from the source, so the literal is not always there to
 * find. The escaped form is worth a second candidate because a note is written
 * by an agent that escapes underscores; anything past that renders as literal
 * text, which is a link that does not light up rather than a paragraph that
 * vanishes.
 */
const markersFor = (link: WikiLink): readonly string[] => {
  const literal = `[[${link.raw}]]`
  const unescaped = `[[${link.raw.replace(/\\(.)/g, '$1')}]]`
  return literal === unescaped ? [literal] : [literal, unescaped]
}

/** The marker that occurs first at or after `cursor`, and where — both, so the
 * caller never has to look the marker up again against a branch it cannot reach. */
const findMarker = (
  value: string,
  markers: readonly string[],
  cursor: number,
): { readonly at: number; readonly marker: string } | undefined => {
  for (const marker of markers) {
    const at = value.indexOf(marker, cursor)
    if (at !== -1) return { at, marker }
  }
  return undefined
}

/**
 * Where a link *opens* in this node without closing in it — remark split the
 * label at inline markup (`[[a|the *b* note]]`). Detected positively: the value
 * must end with a run that is a proper prefix of the marker. The earlier
 * tempting negative rule — "marker not found ⇒ split here" — cuts at the first
 * `[[` it sees, deleting every character after an unrelated `[[#anchor]]` and
 * after any link whose source was escaped.
 */
const findOpening = (value: string, markers: readonly string[], cursor: number): number => {
  for (let at = value.indexOf('[[', cursor); at !== -1; at = value.indexOf('[[', at + 2)) {
    const tail = value.slice(at)
    if (markers.some((marker) => marker.startsWith(tail))) return at
  }
  return -1
}

/** The tail of a link that opened in an earlier sibling, if it closes in this node. */
const closeCarried = (value: string, open: WikiLink, resolve: (target: string) => LinkResolution): Step => {
  const close = value.indexOf(']]')
  return close === -1
    ? { nodes: [], open, cursor: value.length }
    : { nodes: [linkElement(open, resolve)], open: undefined, cursor: close + 2 }
}

/**
 * Place one link inside a text node's value. `undefined` means "not here" —
 * and "not here" always means *leave the text alone*: a link that cannot be
 * placed renders as the literal `[[…]]` the file contains.
 */
const placeLink = (
  value: string,
  link: WikiLink,
  cursor: number,
  resolve: (target: string) => LinkResolution,
): Step | undefined => {
  const markers = markersFor(link)
  const before = (upto: number): readonly ElementContent[] => (upto > cursor ? [text(value.slice(cursor, upto))] : [])

  const found = findMarker(value, markers, cursor)
  if (found !== undefined) {
    return {
      nodes: [...before(found.at), linkElement(link, resolve)],
      cursor: found.at + found.marker.length,
      open: undefined,
    }
  }
  const opening = findOpening(value, markers, cursor)
  return opening === -1 ? undefined : { nodes: before(opening), cursor: value.length, open: link }
}

/**
 * One text node, cut at the links whose source range starts inside it.
 *
 * Offsets say *which* links belong to this node; the cut itself is made by
 * searching for the link's own source text, because value indices and source
 * offsets are not the same coordinate system (see `spanOf`).
 */
const splitTextNode = (
  value: string,
  span: Positioned,
  links: readonly WikiLink[],
  resolve: (target: string) => LinkResolution,
  carried: WikiLink | undefined,
): Split => {
  const head: Step = carried === undefined ? { nodes: [], open: undefined, cursor: 0 } : closeCarried(value, carried, resolve)
  const out: ElementContent[] = [...head.nodes]
  let cursor = head.cursor
  let open = head.open

  for (const link of links) {
    if (link.offset < span.start || link.offset >= span.end) continue
    const step = placeLink(value, link, cursor, resolve)
    if (step === undefined) continue
    out.push(...step.nodes)
    cursor = step.cursor
    open = step.open
    if (open !== undefined) break
  }

  if (cursor < value.length) out.push(text(value.slice(cursor)))
  return { nodes: out, open }
}

/**
 * One child of a parent, given whatever link is still open from its siblings.
 * The nodes *between* a link's opening and closing brackets are whatever remark
 * found inside the label, and they are swallowed by the element that replaces
 * the range.
 */
const stepChild = (
  child: ElementContent,
  links: readonly WikiLink[],
  resolve: (target: string) => LinkResolution,
  open: WikiLink | undefined,
): Split => {
  const span = spanOf(child)
  // Not a text node: swallowed while a link is open, otherwise passed through —
  // its own children are rebuilt when the walk reaches it.
  if (child.type !== 'text' || span === undefined) return { nodes: open === undefined ? [child] : [], open }
  return splitTextNode(child.value, span, links, resolve, open)
}

/** Every `[[link]]` in one parent's children, replaced by its element. */
const rebuild = (
  children: readonly ElementContent[],
  links: readonly WikiLink[],
  resolve: (target: string) => LinkResolution,
): readonly ElementContent[] => {
  const out: ElementContent[] = []
  let open: WikiLink | undefined
  for (const child of children) {
    const step = stepChild(child, links, resolve, open)
    out.push(...step.nodes)
    open = step.open
  }
  // An unterminated link means a link opened and never closed, so the nodes it
  // swallowed are not accounted for. **The original children are returned
  // untouched**: no arrangement of link elements is worth losing a line of the
  // reader's memory.
  return open === undefined ? out : children
}

const isParent = (node: HastNodes): node is Element | HastRoot => node.type === 'element' || node.type === 'root'

/**
 * The note is a document *inside* a view that already has a heading — the file
 * path, which is the `h1` — one `h1` per view. Every wiki note opens with
 * `# Title`, so without this every project window has two, and
 * a screen reader's document outline says the view is two documents.
 *
 * Relative structure is preserved and `h6` has nowhere left to go; the outline
 * rail is unaffected because it scrolls by *ordinal*, not by level.
 */
const DEMOTED: Readonly<Record<string, string | undefined>> = {
  h1: 'h2',
  h2: 'h3',
  h3: 'h4',
  h4: 'h5',
  h5: 'h6',
}

/**
 * One walk, two jobs: link elements in, headings one level down.
 *
 * **In place, and iterative.** The tree is one `toHast` call old and has not
 * left this module, so nothing observable is mutated — and a recursive walk is
 * what blows the stack on a deeply nested file.
 */
const reshape = (root: HastRoot, links: readonly WikiLink[], resolve: (t: string) => LinkResolution): HastRoot => {
  const stack: (Element | HastRoot)[] = [root]
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    // A `[[link]]` written inside a markdown link stays literal text: an anchor
    // inside an anchor is invalid HTML, and `innerHTML` repairs it by closing
    // the outer one early, which silently unlinks the rest of its text.
    if (node.type === 'element') node.tagName = DEMOTED[node.tagName] ?? node.tagName
    const inAnchor = node.type === 'element' && node.tagName === 'a'
    const rebuilt = inAnchor
      ? (node.children as readonly ElementContent[])
      : rebuild(node.children as readonly ElementContent[], links, resolve)
    node.children = [...rebuilt]
    for (const child of rebuilt) if (isParent(child)) stack.push(child)
  }
  return root
}

/**
 * Sanitised HTML for one note. `links` is `parseNote`'s own list and `resolve`
 * the window's link index — `core` knows what a link *is*, the window knows
 * which files exist.
 *
 * **Total, and that is not decoration.** `mdast-util-to-hast` and
 * `hast-util-to-html` both recurse, so a note nested deeply enough overflows
 * the stack *inside a dependency* — at a depth `PARSE_BUDGET` admits, and at a
 * different depth in Chromium than in node, which is precisely why the fix is a
 * refusal rather than a fourth budget number. The viewer then shows the raw
 * text, exactly as it does for an unparsed note.
 */
export const renderHtml = (
  ast: MdastRoot,
  links: readonly WikiLink[],
  resolve: (target: string) => LinkResolution,
): Result<string, RenderRefusal> => {
  try {
    const hast = reshape(toHast.runSync(ast), links, resolve)
    return ok(toHtml.stringify(toHtml.runSync(hast)))
  } catch (error) {
    if (error instanceof RangeError) return err({ kind: 'too-deep' })
    throw error
  }
}
