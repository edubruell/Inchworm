/**
 * Numbered-note frontmatter:
 *
 * ```yaml
 * status: active | proposal | superseded-by-NN
 * updated: YYYY-MM-DD
 * links: [03_simplification, decisions#YYYY-MM-DD]
 * covers: ["src/**"]        # software projects only
 * ```
 *
 * Registers carry none, which is normal and not a failure — see
 * `note.ts` for how the two cases are kept apart.
 */

import { parse as parseYaml } from 'yaml'
import type { Result } from './result.js'
import { err, ok } from './result.js'

/** A union rather than a string, so every `switch` over it is exhaustive. */
export type NoteStatus =
  | { readonly kind: 'active' }
  | { readonly kind: 'proposal' }
  | { readonly kind: 'superseded'; readonly by: number }

export type Frontmatter = {
  /**
   * `undefined` where the schema does not ask for one: journal entries carry
   * session-log frontmatter (`date`/`kind`/`outcome`) and no `status:`. Absent
   * is not the same as wrong — a *malformed* status is still a field error.
   */
  readonly status: NoteStatus | undefined
  /** `YYYY-MM-DD`, verbatim: the app compares it, it never reformats it. */
  readonly updated: string | undefined
  /** Note and register names, possibly with a `#anchor`. */
  readonly links: readonly string[]
  /** Globs of the source paths this note describes; the drift signal. */
  readonly covers: readonly string[]
}

export type FrontmatterError =
  | { readonly kind: 'yaml'; readonly message: string }
  | { readonly kind: 'not-a-mapping' }
  | { readonly kind: 'field'; readonly field: string; readonly message: string }

/** Bounded digits: a note number is two, and `superseded-by-<20 digits>` must
 * not parse into a float. */
const SUPERSEDED = /^superseded-by-0*(\d{1,3})$/

export const parseStatus = (raw: unknown): Result<NoteStatus, FrontmatterError> => {
  // Trimmed once, up front, so the literal arms and the `superseded` arm cannot
  // disagree about whether `'active '` is `active`.
  const value = typeof raw === 'string' ? raw.trim() : raw
  if (value === 'active') return ok({ kind: 'active' })
  if (value === 'proposal') return ok({ kind: 'proposal' })
  if (typeof value === 'string') {
    const superseded = SUPERSEDED.exec(value)
    if (superseded?.[1] !== undefined) return ok({ kind: 'superseded', by: Number(superseded[1]) })
  }
  return err({
    kind: 'field',
    field: 'status',
    message: `expected active | proposal | superseded-by-NN, got ${JSON.stringify(raw)}`,
  })
}

/** `links:`/`covers:` are lists of strings; anything else is a malformed note, not a silent []. */
const parseStringList = (raw: unknown, field: string): Result<readonly string[], FrontmatterError> => {
  if (raw === undefined || raw === null) return ok([])
  if (Array.isArray(raw) && raw.every((item): item is string => typeof item === 'string')) return ok(raw)
  return err({ kind: 'field', field, message: 'expected a list of strings' })
}

const parseUpdated = (raw: unknown): Result<string | undefined, FrontmatterError> => {
  if (raw === undefined || raw === null) return ok(undefined)
  // `yaml`'s core schema leaves an unquoted YYYY-MM-DD as a string (unlike
  // js-yaml, which constructs a Date) — so the bytes the author typed survive,
  // which is what the schema wants.
  if (typeof raw === 'string') return ok(raw)
  return err({ kind: 'field', field: 'updated', message: 'expected YYYY-MM-DD' })
}

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Every field, in one place: the failures short-circuit and keep their field name. */
const readFields = (raw: Record<string, unknown>): Result<Frontmatter, FrontmatterError> => {
  const status = raw.status === undefined ? ok(undefined) : parseStatus(raw.status)
  if (!status.ok) return status
  const updated = parseUpdated(raw.updated)
  if (!updated.ok) return updated
  const links = parseStringList(raw.links, 'links')
  if (!links.ok) return links
  const covers = parseStringList(raw.covers, 'covers')
  if (!covers.ok) return covers

  return ok({ status: status.value, updated: updated.value, links: links.value, covers: covers.value })
}

/** `yamlText` is the body between the `---` fences, without them. */
export const parseFrontmatter = (yamlText: string): Result<Frontmatter, FrontmatterError> => {
  let raw: unknown
  try {
    raw = parseYaml(yamlText) as unknown
  } catch (error: unknown) {
    // `String` rather than a narrowing branch: yaml's parse error stringifies
    // to its own message, and an unreachable branch cannot be tested.
    return err({ kind: 'yaml', message: String(error) })
  }
  // An empty or comment-only block parses to `null`. That is a note with a
  // placeholder header, not a broken one, and flagging it red is a false alarm.
  if (raw === null || raw === undefined) return readFields({})
  return isMapping(raw) ? readFields(raw) : err({ kind: 'not-a-mapping' })
}
