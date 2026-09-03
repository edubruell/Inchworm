/**
 * The two strings a human reads out of the demo script: the cap badge and the
 * status label. They are pure, so they live apart from the script that prints
 * them and can be tested without running a report.
 */

import type { ParseRefusal } from '@core/budget.js'
import type { CapStatus } from '@core/caps.js'
import type { WikiFileKind } from '@core/classify.js'
import type { NoteState } from '@core/note.js'

export const badge = (status: CapStatus): string => {
  if (status.kind === 'uncapped') return `${String(status.lines)}ℓ`
  const mark = status.kind === 'over' ? '  ← over cap' : status.kind === 'near' ? '  ← near cap' : ''
  return `${String(status.lines)}/${String(status.cap)}${mark}`
}

/**
 * A file over the parse budget still gets a line — shown as unparsed, never
 * dropped — and it carries both numbers, because "too complex" on its own is
 * not something a reader can act on.
 */
const refusalLabel = (refusal: ParseRefusal): string => {
  switch (refusal.kind) {
    case 'too-large':
      return `UNPARSED: ${String(refusal.bytes)} chars over the ${String(refusal.limit)} budget`
    case 'too-nested':
      return `UNPARSED: ${refusal.measure} nesting ${String(refusal.depth)} over ${String(refusal.limit)}`
    case 'stack':
      return 'UNPARSED: the parse overflowed the stack'
  }
}

export const statusLabel = (note: NoteState, kind: WikiFileKind): string => {
  if (note.kind === 'unparsed') return refusalLabel(note.refusal)
  const frontmatter = note.frontmatter
  if (frontmatter.kind === 'invalid') return 'BROKEN FRONTMATTER'
  if (frontmatter.kind === 'absent') return kind.kind === 'register' ? 'register' : ''
  const status = frontmatter.fields.status
  if (status === undefined) return kind.kind === 'journal' ? 'session log' : ''
  return status.kind === 'superseded' ? `superseded-by-${String(status.by)}` : status.kind
}
