/**
 * `[[wikilinks]]`, the schema's cross-references. Two rules matter:
 *
 * 1. **Code is not a link, and the AST is what says where code is.** The wiki's
 *    own notes illustrate the syntax inside code spans and fenced blocks; a
 *    plain regex over the file reports those as dangling. So the scan runs over
 *    the source text and subtracts the ranges the AST marks as code — rather
 *    than reading `text` nodes, which is the same rule one layer too low:
 *    remark splits a run of text at every inline construct, so `[[a|the *b*
 *    note]]` and any `[[a]]` beside a link-reference definition silently
 *    produce no link at all.
 * 2. **A dangling link is a to-do, not an error**: it
 *    resolves to `unresolved` and the viewer shows it in red. Nothing throws.
 */

import type { Nodes } from 'mdast'
import type { ProjectLayout } from './project.js'
import { classify } from './classify.js'
import { stem } from './paths.js'
import { walk } from './markdown.js'

export type WikiLink = {
  /** The text between the brackets, verbatim. */
  readonly raw: string
  /** The file part: `decisions` in `[[decisions#2026-08-18|the ruling]]`. */
  readonly target: string
  readonly anchor: string | undefined
  readonly label: string | undefined
  /** 1-based, counted from the source text, so exact in every case. */
  readonly line: number
  readonly column: number
  /**
   * Source offset of the opening `[[`. The viewer places its link elements by
   * this rather than re-scanning the rendered text, which is what keeps what is
   * clickable and what is counted as a backlink the same set (`render.ts`).
   */
  readonly offset: number
}

/** Shared with `render.ts`, so the syntax the viewer makes clickable and the
 * syntax the backlink index counts can never drift apart. */
export const WIKILINK = /\[\[[^[\]\n]+\]\]/g

/**
 * Markdown escapes are the writer's, not the schema's: `[[05\_plan]]` names the
 * same file as `[[05_plan]]`, and an agent writing a note escapes underscores
 * out of habit. Undone here so that the link index, the backlink panel and the
 * viewer all read one target.
 */
const unescape = (part: string): string => part.replace(/\\(.)/g, '$1')

/** `target#anchor|label`, all parts optional but the target. */
export const splitTarget = (raw: string): Pick<WikiLink, 'target' | 'anchor' | 'label'> => {
  const bar = raw.indexOf('|')
  const address = bar === -1 ? raw : raw.slice(0, bar)
  const hash = address.indexOf('#')
  return {
    target: unescape((hash === -1 ? address : address.slice(0, hash)).trim()),
    anchor: hash === -1 ? undefined : unescape(address.slice(hash + 1).trim()),
    // An empty label (`[[a|]]`) is no label, not a label of nothing: rendering
    // it would produce a focusable anchor with no accessible name.
    label: bar === -1 || raw.slice(bar + 1).trim() === '' ? undefined : unescape(raw.slice(bar + 1).trim()),
  }
}

/** 1-based line and column of a source offset. */
const positionAt = (text: string, offset: number): Pick<WikiLink, 'line' | 'column'> => {
  const before = text.slice(0, offset)
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') }
}

/** Node types whose source text illustrates the syntax rather than using it. */
const CODE = new Set(['code', 'inlineCode', 'html', 'yaml'])

type Range = readonly [number, number]

const codeRanges = (root: Nodes): readonly Range[] => {
  const ranges: Range[] = []
  walk(root, (node) => {
    const position = node.position
    // A synthetic node carries no offsets and covers no source; it hides nothing.
    if (!CODE.has(node.type) || position?.start.offset === undefined || position.end.offset === undefined) return
    ranges.push([position.start.offset, position.end.offset])
  })
  return ranges
}

/**
 * Every `[[link]]` in a note, in document order. `text` must be the source the
 * AST was parsed from — the offsets are read against it.
 *
 * A link with no target (`[[#anchor]]`, `[[ ]]`, `[[|label]]`) names no file, so
 * it is not a link; reporting it as one would leave it permanently red in the
 * viewer, with nothing the writer could do about it.
 */
export const extractLinks = (root: Nodes, text: string): readonly WikiLink[] => {
  const code = codeRanges(root)
  return [...text.matchAll(WIKILINK)]
    .filter((match) => !code.some(([from, to]) => match.index >= from && match.index < to))
    // The match includes its brackets; slicing them off needs no capture group
    // and therefore no unreachable "the group did not match" branch.
    .map((match): WikiLink => {
      const raw = match[0].slice(2, -2)
      return { raw, ...splitTarget(raw), ...positionAt(text, match.index), offset: match.index }
    })
    .filter((link) => link.target !== '')
}

/** Link target (a file stem) → project-relative path. */
export type LinkIndex = ReadonlyMap<string, string>

/**
 * Built from the project's file list. A wiki-root file wins over an archived
 * one of the same name: `[[03_storage]]` means the note, and the archive holds
 * its old body.
 */
export const buildLinkIndex = (paths: readonly string[], layout: ProjectLayout): LinkIndex => {
  const index = new Map<string, string>()
  for (const path of paths) {
    const kind = classify(path, layout).kind
    if (kind === 'other' || kind === 'claudeMd') continue
    const key = stem(path)
    if (kind === 'archive' && index.has(key)) continue
    index.set(key, path)
  }
  return index
}

export type LinkResolution =
  | { readonly status: 'resolved'; readonly path: string }
  | { readonly status: 'unresolved' }

export const resolveLink = (target: string, index: LinkIndex): LinkResolution => {
  const path = index.get(target)
  return path === undefined ? { status: 'unresolved' } : { status: 'resolved', path }
}

export type Backlink = {
  /** The note the link was written in. */
  readonly from: string
  readonly line: number
  readonly label: string | undefined
}

export type NoteLinks = { readonly path: string; readonly links: readonly WikiLink[] }

/**
 * Reverse the link graph: target path → the notes pointing at it. Unresolved
 * links contribute nothing (there is no page to hang them on), a note that
 * links to itself is not its own backlink, and one note linking the same target
 * twice from one line is one backlink, not a doubled sidebar row.
 */
export const backlinkIndex = (
  notes: readonly NoteLinks[],
  index: LinkIndex,
): ReadonlyMap<string, readonly Backlink[]> => {
  const backlinks = new Map<string, Backlink[]>()
  for (const note of notes) {
    for (const link of note.links) {
      const resolved = resolveLink(link.target, index)
      if (resolved.status === 'unresolved' || resolved.path === note.path) continue
      const entry = backlinks.get(resolved.path) ?? []
      if (entry.some((seen) => seen.from === note.path && seen.line === link.line)) continue
      entry.push({ from: note.path, line: link.line, label: link.label })
      backlinks.set(resolved.path, entry)
    }
  }
  return backlinks
}
