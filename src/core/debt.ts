/**
 * What wiki *debt* is: work that landed in the project and was never written up.
 * Two checkers answer the question — the sweep sentinel and the trigger checker
 * — and this file is the only place that knows their record shapes, so no
 * component ever reads a checker's JSON.
 *
 * It is also the **spawn allow-list**: the app runs only checkers it ships and
 * never a project's own script, so `CHECKERS` is a constant here and
 * `main/debt.ts` may build an argv from nothing else. A project's files are
 * data; a project must not be able to name the program that reads them.
 */

import { SKILL_FILES } from './skill.js'

/**
 * The checkers the app may spawn, by their name in the bundle. Both are members
 * of `SKILL_FILES` — the app runs what it installs, and `debt.test.ts` asserts
 * that containment rather than trusting these two strings to stay in step.
 *
 * `wiki-contentions.py` and `wiki-overdue.py` are deliberately absent: they
 * answer questions the sidebar does not ask, and a spawn list is only a limit
 * while it is shorter than the manifest.
 */
export const CHECKERS = ['wiki-sweepcheck.py', 'wiki-trigger.py'] as const

export type Checker = (typeof CHECKERS)[number]

/**
 * The four shapes of "landed but not written up", in the order a reader should
 * meet them. `unstamped` comes from the sweep sentinel — a register entry whose
 * note edit never happened; the other three come from the trigger checker and
 * are about artefacts: a marker still marked, a marker never filed, an artefact
 * named nowhere.
 */
export type DebtKind = 'unstamped' | 'unswept' | 'unfiled' | 'unlinked'

export const DEBT_KINDS: readonly DebtKind[] = ['unstamped', 'unswept', 'unfiled', 'unlinked']

export type DebtItem = {
  readonly kind: DebtKind
  /** What the row says: a register line, or an artefact's project-relative path. */
  readonly label: string
  /** Why it is debt, in the checker's own words. */
  readonly detail: string
  /**
   * The project-relative file this row opens, when the app can open it at all.
   * A payload round under `payload/incoming/` is real debt the app must show
   * and must not pretend it can display, so it comes back without one.
   */
  readonly path?: string | undefined
}

/** A field of an unknown record, or `undefined` — the whole of this file's trust in a checker. */
const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

/**
 * The rows a checker reported, or `undefined` for a payload that is **not an
 * answer at all**. The distinction is the whole point: `wiki-sweepcheck.py`
 * emits `{ok: false, note: "no wiki root in CLAUDE.md", wiki: null}` — with no
 * `debt` key — for a project it could not read, and reading that as an empty
 * list would draw a project whose checker is broken exactly like a project with
 * nothing owed. The key's presence is the answer.
 */
const rows = (payload: unknown, key: string): readonly unknown[] | undefined => {
  // `wiki: null` is a checker saying it never found a wiki to look at. It is
  // the one case where a checker reports an *empty list* for a project it could
  // not read at all — `wiki-trigger.py` does exactly this for a folder with no
  // CLAUDE.md — so the list has to be disbelieved rather than drawn as clean.
  if (field(payload, 'wiki') === null) return undefined
  const list = field(payload, key)
  return Array.isArray(list) ? list : undefined
}

/**
 * The project-relative path of a file the window already lists, matched on the
 * basename the checker reports. A checker names `findings.md`; the sidebar
 * knows `local_context/wiki/findings.md`, and only the project's own file list
 * can bridge the two — which is why it is passed in rather than guessed at.
 */
const known = (files: readonly string[], name: string | undefined): string | undefined => {
  if (name === undefined) return undefined
  const exact = files.find((path) => path === name)
  if (exact !== undefined) return exact
  const ending = files.filter((path) => path.endsWith(`/${name}`))
  // Two files can share a basename — a `findings.md` in the wiki and one in the
  // journal — and opening the wrong one is worse than opening none, so an
  // ambiguous name gets no link at all rather than a coin flip.
  return ending.length === 1 ? ending[0] : undefined
}

/** The last segment of a posix path, or the whole of it when there is only one. */
const leaf = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path

/**
 * `wiki-sweepcheck.py --json` → the entries whose paired note edit is missing.
 * Only `debt` is read: `pending` is deferred by design, and `unanchored` is a
 * warning the schema explicitly refuses to treat as debt — showing either in a
 * list headed "not written up" would make the section cry wolf on every wiki
 * that predates the sentinel.
 */
export const sweepDebt = (payload: unknown, files: readonly string[]): readonly DebtItem[] | undefined =>
  rows(payload, 'debt')?.flatMap((row) => {
    const register = text(field(row, 'register'))
    const problem = text(field(row, 'problem'))
    if (register === undefined || problem === undefined) return []
    const line = field(row, 'line')
    const at = typeof line === 'number' ? `${register}:${String(line)}` : register
    return [{ kind: 'unstamped' as const, label: at, detail: problem, path: known(files, register) }]
  })

/**
 * `wiki-trigger.py --json` → the artefacts that landed and were never written
 * up. `stale` is the pre-cutoff backlog and is never shown: backlog is not
 * debt, which is the rule that keeps the section from burying a new project.
 */
export const triggerDebt = (payload: unknown, files: readonly string[]): readonly DebtItem[] | undefined =>
  rows(payload, 'open')?.flatMap((row) => {
    const path = text(field(row, 'path'))
    const detail = text(field(row, 'detail'))
    const kind = field(row, 'kind')
    if (path === undefined || detail === undefined) return []
    const named = DEBT_KINDS.find((candidate) => candidate === kind)
    // A kind this build does not know is still debt — the checker ships in the
    // same bundle, but an installed copy may be newer than the app reading it.
    return [
      {
        kind: named ?? 'unlinked',
        // The **leaf**, not the path: artefacts of one trigger share a folder,
        // so a truncated path renders every row as the same `payload/incom…`.
        // The path is kept, in full, in the detail
        // the row spells out on hover — nothing is lost, it is just not the
        // part competing for 20 characters of sidebar.
        label: leaf(path),
        detail: `${path} — ${detail}`,
        path: known(files, path),
      },
    ]
  })

/** Schema order, never alphabetical, and stable inside a kind: the checkers' own. */
export const orderDebt = (items: readonly DebtItem[]): readonly DebtItem[] =>
  DEBT_KINDS.flatMap((kind) => items.filter((item) => item.kind === kind))

/** Whether `CHECKERS` is still a subset of what the app ships. */
export const checkersAreShipped = (): boolean =>
  CHECKERS.every((name) => SKILL_FILES.some((file) => file.source === name))
