/**
 * The sidebar model: **schema order, never alphabetical**.
 * State first because it is the read-first file, then notes by number,
 * registers in the order the schema lists them, the journal newest-first, and
 * the archive last.
 *
 * Paths only — status dots and cap gauges need file *contents*, so they are
 * layered on by the caller from `parseNote`. This function stays cheap enough
 * to run on every watcher event.
 */

import type { WikiFileKind } from './classify.js'
import type { ProjectLayout } from './project.js'
import type { Section } from './schema.js'
import { classify } from './classify.js'
import { basename } from './paths.js'
import { isAgentFile, REGISTERS, SECTIONS } from './schema.js'

export type NavEntry = {
  /** Project-relative, `/`-separated. */
  readonly path: string
  readonly name: string
  readonly kind: WikiFileKind
}

export type NavGroup = {
  readonly section: Section
  readonly entries: readonly NavEntry[]
}

const sectionOf = (kind: WikiFileKind): Section | undefined => {
  switch (kind.kind) {
    case 'state':
      return 'state'
    case 'note':
      return 'notes'
    case 'register':
      return 'registers'
    case 'journal':
      return 'journal'
    case 'archive':
      return 'archive'
    // CLAUDE.md is reachable from the project header, not the file tree, and
    // `other` has no section by definition — the five sections are fixed.
    case 'claudeMd':
    case 'other':
      return undefined
  }
}

/** Sort key within a section; ties fall back to the path, so the order is total. */
const orderOf = (entry: NavEntry): number => {
  const kind = entry.kind
  switch (kind.kind) {
    case 'note':
      return kind.number
    case 'register':
      return REGISTERS.indexOf(kind.register)
    // Journal entries never reach here: `compare` orders them by date first.
    default:
      return 0
  }
}

const compare = (a: NavEntry, b: NavEntry): number => {
  if (a.kind.kind === 'journal' && b.kind.kind === 'journal') {
    return b.kind.date.localeCompare(a.kind.date) || b.path.localeCompare(a.path)
  }
  return orderOf(a) - orderOf(b) || a.path.localeCompare(b.path)
}

export const buildNavigation = (paths: readonly string[], layout: ProjectLayout): readonly NavGroup[] => {
  const entries = paths.flatMap((path): readonly NavEntry[] => {
    const kind = classify(path, layout)
    return sectionOf(kind) === undefined ? [] : [{ path, name: basename(path), kind }]
  })

  // One pass per section over a list a few dozen files long: cheaper to read
  // than a keyed accumulator, and the five sections are always present even
  // when the project has nothing in them.
  return SECTIONS.map((section) => ({
    section,
    entries: entries.filter((entry) => sectionOf(entry.kind) === section).sort(compare),
  }))
}

/**
 * Everything ⌘K can jump to: the sidebar in schema order, plus CLAUDE.md —
 * which `buildNavigation` excludes by design, because it hangs off the project
 * header rather than the file tree. The palette is a jump to *anything the
 * window can open*, so it is the one place the two lists are the same list.
 */
export const jumpTargets = (paths: readonly string[], layout: ProjectLayout): readonly NavEntry[] => [
  ...buildNavigation(paths, layout).flatMap((group) => group.entries),
  ...paths
    .filter((path) => isAgentFile(path))
    .map((path): NavEntry => ({ path, name: path, kind: classify(path, layout) })),
]

/**
 * The palette's filter: substring, case-insensitive, ranked name-first. Not
 * fuzzy — these are `04_ui_layout.md` and `decisions.md`, where a subsequence
 * match over 30-odd files buys nothing and puts `deletions.md` above
 * `decisions.md` for "dec". An empty query keeps schema order, so ⌘K with no
 * typing is the sidebar.
 */
export const filterEntries = (entries: readonly NavEntry[], query: string): readonly NavEntry[] => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return entries
  const rank = (entry: NavEntry): number => {
    const name = entry.name.toLowerCase()
    if (name.startsWith(needle)) return 0
    if (name.includes(needle)) return 1
    return entry.path.toLowerCase().includes(needle) ? 2 : 3
  }
  return entries
    .map((entry, index) => ({ entry, index, rank: rank(entry) }))
    .filter((scored) => scored.rank < 3)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((scored) => scored.entry)
}
