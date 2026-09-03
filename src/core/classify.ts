/**
 * The single place that turns a path into schema meaning: **no component may
 * test a filename with a regex** — it asks here, so a schema change is one edit
 * and one test file.
 */

import type { ProjectLayout } from './project.js'
import type { RegisterName } from './schema.js'
import { AGENT_FILES, ARCHIVE_DIR, isRegisterName, STATE_FILE } from './schema.js'
import { isInside, isMarkdown, isUnder, relativeTo, stem } from './paths.js'

export type WikiFileKind =
  /** `00_state.md` — the read-first file. */
  | { readonly kind: 'state' }
  /** A numbered design note: `NN_topic.md`. */
  | { readonly kind: 'note'; readonly number: number; readonly topic: string }
  | { readonly kind: 'register'; readonly register: RegisterName }
  /** Anything under `<wiki>/archive/` — overflow and superseded bodies. */
  | { readonly kind: 'archive' }
  /** `<journal>/YYYY-MM-DD_slug.md`. */
  | { readonly kind: 'journal'; readonly date: string; readonly slug: string }
  | { readonly kind: 'claudeMd' }
  /** A markdown file in a wiki folder that the schema does not name, or a non-note. */
  | { readonly kind: 'other' }

const OTHER = { kind: 'other' } as const

const NOTE_NAME = /^(\d{2})_(.+)$/
const JOURNAL_NAME = /^(\d{4}-\d{2}-\d{2})(?:[_-](.*))?$/

/**
 * macOS filesystems are case-insensitive, so `Decisions.md` and `decisions.md`
 * are one file, and treating them as two kinds would make a `[[decisions]]`
 * link resolve or dangle depending on how the agent capitalised the file.
 * Only the schema's own names are folded; the topic and
 * slug keep the author's capitalisation, because they are shown.
 */
const fold = (name: string): string => name.toLowerCase()

/**
 * The shape is a date; this asks whether it is also a day. The round trip is
 * what catches `2026-02-30`, which `Date.parse` accepts and rolls over to March.
 */
const isCalendarDate = (date: string): boolean => {
  const time = Date.parse(`${date}T00:00:00Z`)
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(date)
}

const classifyInWiki = (path: string, wikiRoot: string): WikiFileKind => {
  const within = relativeTo(path, wikiRoot)
  if (isInside(fold(within), ARCHIVE_DIR)) return { kind: 'archive' }
  // Only the top level of the wiki carries schema meaning; a note in a
  // sub-folder is `other`, not a note that happens to be filed oddly.
  if (within.includes('/')) return OTHER
  if (fold(within) === fold(STATE_FILE)) return { kind: 'state' }

  const name = stem(within)
  const folded = fold(name)
  if (isRegisterName(folded)) return { kind: 'register', register: folded }

  const note = NOTE_NAME.exec(name)
  if (note?.[1] === undefined || note[2] === undefined) return OTHER
  return { kind: 'note', number: Number(note[1]), topic: note[2] }
}

const classifyInJournal = (path: string, journal: string): WikiFileKind => {
  const within = relativeTo(path, journal)
  // Symmetry with the wiki: only the top level carries schema meaning. `stem`
  // would take the basename and silently discard the depth.
  if (within.includes('/')) return OTHER

  const dated = JOURNAL_NAME.exec(stem(within))
  if (dated?.[1] === undefined || !isCalendarDate(dated[1])) return OTHER
  return { kind: 'journal', date: dated[1], slug: dated[2] ?? '' }
}

/**
 * `path` is project-relative and `/`-separated. Non-markdown files are
 * deliberately `other` rather than absent: the caller decides what to hide.
 */
export const classify = (path: string, layout: ProjectLayout): WikiFileKind => {
  if (!isMarkdown(path)) return OTHER
  // Either spelling of the agent file is the same *kind*: the same cap, the
  // same slot on the header card. Which one a project uses is which one it has.
  if (AGENT_FILES.some((name) => fold(path) === fold(name))) return { kind: 'claudeMd' }
  if (isUnder(path, layout.wikiRoot)) return classifyInWiki(path, layout.wikiRoot)
  if (isUnder(path, layout.journal)) return classifyInJournal(path, layout.journal)
  return OTHER
}
