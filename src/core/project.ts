/**
 * The project layout, read from the machine-readable block the `/llmwiki`
 * skill writes into every project's CLAUDE.md:
 *
 * ```
 * - Wiki root: local_context/wiki/
 * - Journal: local_context/notes/
 * - Kind: software
 * ```
 *
 * The app has no path configuration of its own: a folder without this block is
 * not an llmwiki project, and the picker says so rather than guessing.
 */

import type { Result } from './result.js'
import { err, ok } from './result.js'
import { asDirPrefix } from './paths.js'

/** `budgets.md`/`deletions.md` and the architecture note are software-only. */
export type ProjectKind = 'research' | 'software'

export type ProjectLayout = {
  /** Project-relative directory, with a trailing `/`. */
  readonly wikiRoot: string
  /** Project-relative directory, with a trailing `/`. */
  readonly journal: string
  readonly kind: ProjectKind
}

export type ClaudeBlockError =
  | { readonly kind: 'no-wiki-root' }
  | { readonly kind: 'no-journal' }
  /** A syntactically unusable root: absolute, escaping, or the project itself. */
  | { readonly kind: 'unsafe-root'; readonly field: string; readonly path: string }

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * The block is read from the prose, never from an illustration of it. A
 * CLAUDE.md that documents the block before declaring it — every template does,
 * and every project that documents its own conventions does — would otherwise
 * hand back the example, because the match is first-wins.
 */
const withoutFences = (text: string): string => {
  let open: string | undefined
  return text
    .split('\n')
    .map((line) => {
      const run = FENCE.exec(line)?.[1]
      if (open === undefined) {
        if (run === undefined) return line
        open = run
        return ''
      }
      if (run?.startsWith(open) === true) open = undefined
      return ''
    })
    .join('\n')
}

/**
 * `- Wiki root: <path>` — tolerant of leading bullet, bold and extra spaces, but
 * **not across the line break**: `\s` matches `\n`, so the original pattern read
 * an empty value as the next bullet, so `- Wiki root:` followed by
 * `- Journal: n/` parses as a wiki root of `- Journal: n/`.
 * The value may be an inline code span, as several projects' CLAUDE.md write it
 * and the skill's own hooks accept: backticks are markup, not path, so they come
 * off before the safety check, which would else pass a root nothing is under.
 */
const lineValue = (text: string, label: string): string | undefined => {
  const h = String.raw`[^\S\n]*`
  const pattern = new RegExp(String.raw`^${h}[-*]${h}\**${label}\**${h}:${h}([^\n]+?)${h}$`, 'im')
  const value = pattern.exec(withoutFences(text))?.[1]?.replace(/^[\s`]+|[\s`]+$/g, '')
  // A label with a blank value is a label that was never filled in, not a value.
  return value === undefined || value === '' ? undefined : value
}

/**
 * `Kind:` is the only optional line: the two software registers are an
 * extension, so a block without it is a research project rather than a
 * malformed one.
 */
const parseKind = (raw: string | undefined): ProjectKind => (raw?.trim() === 'software' ? 'software' : 'research')

/**
 * `core` cannot stat anything, but it can refuse a *syntactic* escape — and it
 * must, because main builds its filesystem allow-list from this layout and
 * CLAUDE.md is agent-written, untrusted input. Absolute and `~` roots match no
 * project-relative path (the tree would be silently empty), `..` escapes the
 * project, and the project root itself would classify every file in the repo as
 * a wiki file.
 */
const safeRoot = (raw: string, field: string): Result<string, ClaudeBlockError> => {
  const value = raw.trim()
  const prefix = asDirPrefix(value)
  const escapes = value.startsWith('/') || value.startsWith('~') || prefix.split('/').includes('..')
  return prefix === '' || escapes ? err({ kind: 'unsafe-root', field, path: value }) : ok(prefix)
}

export const parseClaudeBlock = (text: string): Result<ProjectLayout, ClaudeBlockError> => {
  const wikiRoot = lineValue(text, 'Wiki root')
  if (wikiRoot === undefined) return err({ kind: 'no-wiki-root' })

  const journal = lineValue(text, 'Journal')
  if (journal === undefined) return err({ kind: 'no-journal' })

  const safeWiki = safeRoot(wikiRoot, 'Wiki root')
  if (!safeWiki.ok) return safeWiki
  const safeJournal = safeRoot(journal, 'Journal')
  if (!safeJournal.ok) return safeJournal

  return ok({
    wikiRoot: safeWiki.value,
    journal: safeJournal.value,
    kind: parseKind(lineValue(text, 'Kind')),
  })
}
